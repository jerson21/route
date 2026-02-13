import crypto from 'crypto';
import { calculateEtaWindow } from '../utils/timeUtils.js';

// Webhook event types
export type WebhookEventType =
  | 'route.started'
  | 'route.completed'
  | 'stop.completed'
  | 'stop.failed'
  | 'stop.skipped'
  | 'stop.in_transit'
  | 'stop.approaching'
  | 'eta.updated';

// Webhook payload structures
export interface WebhookStopPayload {
  id: string;
  sequenceOrder: number;
  address: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  status: string;
  estimatedArrival?: string; // ISO datetime
  completedAt?: string; // ISO datetime
}

export interface WebhookDriverPayload {
  id: string;
  name: string;
  phone?: string;
}

export interface WebhookRoutePayload {
  id: string;
  name: string;
  status: string;
  scheduledDate?: string;
  depotReturnTime?: string; // ISO datetime
}

export interface WebhookPayload {
  event: WebhookEventType;
  timestamp: string;
  route: WebhookRoutePayload;
  driver?: WebhookDriverPayload;
  stop?: WebhookStopPayload;
  remainingStops?: WebhookStopPayload[];
  metadata?: Record<string, unknown>;
}

// Generate HMAC signature for webhook payload
function generateSignature(payload: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Send webhook with retry logic
export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  secret?: string | null,
  maxRetries: number = 3
): Promise<{ success: boolean; statusCode?: number; error?: string }> {
  const payloadString = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Webhook-Event': payload.event,
    'X-Webhook-Timestamp': payload.timestamp,
  };

  // Add HMAC signature if secret is provided
  if (secret) {
    headers['X-Webhook-Signature'] = `sha256=${generateSignature(payloadString, secret)}`;
  }

  let lastError: string | undefined;
  let lastStatusCode: number | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[WEBHOOK] Sending ${payload.event} to ${url} (attempt ${attempt}/${maxRetries})`);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payloadString,
        signal: AbortSignal.timeout(10000), // 10 second timeout
      });

      lastStatusCode = response.status;

      if (response.ok) {
        console.log(`[WEBHOOK] Successfully sent ${payload.event} to ${url}`);
        return { success: true, statusCode: response.status };
      }

      lastError = `HTTP ${response.status}: ${response.statusText}`;
      console.warn(`[WEBHOOK] Failed attempt ${attempt}: ${lastError}`);

      // Don't retry on 4xx errors (client errors)
      if (response.status >= 400 && response.status < 500) {
        break;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[WEBHOOK] Failed attempt ${attempt}: ${lastError}`);
    }

    // Wait before retry (exponential backoff)
    if (attempt < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }

  console.error(`[WEBHOOK] Failed to send ${payload.event} to ${url} after ${maxRetries} attempts: ${lastError}`);
  return { success: false, statusCode: lastStatusCode, error: lastError };
}

// Helper to build stop payload from database stop
export function buildStopPayload(stop: {
  id: string;
  sequenceOrder: number;
  status: string;
  estimatedArrival?: Date | null;
  completedAt?: Date | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  address: { fullAddress: string };
}): WebhookStopPayload {
  return {
    id: stop.id,
    sequenceOrder: stop.sequenceOrder,
    address: stop.address.fullAddress,
    recipientName: stop.recipientName || undefined,
    recipientPhone: stop.recipientPhone || undefined,
    recipientEmail: stop.recipientEmail || undefined,
    status: stop.status,
    estimatedArrival: stop.estimatedArrival?.toISOString(),
    completedAt: stop.completedAt?.toISOString(),
  };
}

// Helper to build route payload
export function buildRoutePayload(route: {
  id: string;
  name: string;
  status: string;
  scheduledDate?: Date | null;
  depotReturnTime?: Date | null;
}): WebhookRoutePayload {
  return {
    id: route.id,
    name: route.name,
    status: route.status,
    scheduledDate: route.scheduledDate?.toISOString(),
    depotReturnTime: route.depotReturnTime?.toISOString(),
  };
}

// Helper to build driver payload
export function buildDriverPayload(driver: {
  id: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
} | null | undefined): WebhookDriverPayload | undefined {
  if (!driver) return undefined;
  return {
    id: driver.id,
    name: `${driver.firstName} ${driver.lastName}`,
    phone: driver.phone || undefined,
  };
}

// Extended stop payload with ETA window for customer notifications
export interface WebhookStopWithWindowPayload extends WebhookStopPayload {
  etaWindowStart?: string; // ISO datetime - earliest expected arrival
  etaWindowEnd?: string;   // ISO datetime - latest expected arrival
}

// Helper to build stop payload with ETA window (rounded to 10-minute intervals)
export function buildStopWithWindowPayload(
  stop: {
    id: string;
    sequenceOrder: number;
    status: string;
    estimatedArrival?: Date | null;
    originalEstimatedArrival?: Date | null;
    completedAt?: Date | null;
    recipientName?: string | null;
    recipientPhone?: string | null;
    recipientEmail?: string | null;
    address: { fullAddress: string };
  },
  etaWindowBefore: number = 30,
  etaWindowAfter: number = 30
): WebhookStopWithWindowPayload {
  const basePayload = buildStopPayload(stop);

  // Use original ETA if available (frozen at route start), otherwise current ETA
  const etaDate = stop.originalEstimatedArrival || stop.estimatedArrival;

  if (etaDate) {
    // Use the rounding function for professional display (e.g., 16:00 - 17:00 instead of 16:03 - 17:23)
    const { etaWindowStart, etaWindowEnd } = calculateEtaWindow(etaDate, etaWindowBefore, etaWindowAfter);
    return {
      ...basePayload,
      etaWindowStart: etaWindowStart.toISOString(),
      etaWindowEnd: etaWindowEnd.toISOString(),
    };
  }

  return basePayload;
}
