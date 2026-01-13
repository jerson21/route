import { PrismaClient, StopStatus } from '@prisma/client';
import {
  sendWebhook,
  buildStopPayload,
  buildRoutePayload,
  buildDriverPayload,
  WebhookPayload,
} from './webhookService';
import { getWebhookConfig } from '../routes/settings.routes.js';

const prisma = new PrismaClient();

interface RecalculationResult {
  success: boolean;
  updatedStops: number;
  newDepotReturnTime?: Date;
  error?: string;
}

/**
 * Recalculates ETAs for remaining stops after a stop is completed/skipped.
 * Uses Google Directions API to get real travel times from the completed stop
 * to all remaining stops.
 */
export async function recalculateETAs(
  routeId: string,
  completedStopId: string,
  completedAt: Date,
  apiKey: string
): Promise<RecalculationResult> {
  try {
    // Get route with all stops and depot
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      include: {
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' },
        },
        depot: true,
        assignedTo: true,
      },
    });

    if (!route) {
      return { success: false, updatedStops: 0, error: 'Route not found' };
    }

    // Find the completed stop and remaining pending stops
    const completedStop = route.stops.find(s => s.id === completedStopId);
    if (!completedStop) {
      return { success: false, updatedStops: 0, error: 'Stop not found' };
    }

    const remainingStops = route.stops.filter(
      s => s.sequenceOrder > completedStop.sequenceOrder &&
           (s.status === StopStatus.PENDING || s.status === StopStatus.IN_TRANSIT)
    );

    if (remainingStops.length === 0) {
      console.log('[RECALC] No remaining stops to recalculate');

      // Calculate return to depot time if depot exists
      if (route.depot && completedStop.address.latitude && completedStop.address.longitude) {
        const returnTime = await getReturnToDepotTime(
          { lat: completedStop.address.latitude, lng: completedStop.address.longitude },
          { lat: route.depot.latitude, lng: route.depot.longitude },
          completedAt,
          completedStop.estimatedMinutes,
          apiKey
        );

        if (returnTime) {
          await prisma.route.update({
            where: { id: routeId },
            data: { depotReturnTime: returnTime },
          });

          return { success: true, updatedStops: 0, newDepotReturnTime: returnTime };
        }
      }

      return { success: true, updatedStops: 0 };
    }

    console.log(`[RECALC] Recalculating ETAs for ${remainingStops.length} remaining stops`);

    // Get travel times from completed stop to all remaining stops
    const completedLocation = {
      lat: completedStop.address.latitude!,
      lng: completedStop.address.longitude!,
    };

    // Calculate departure time from completed stop (completion time + service time)
    const serviceMinutes = completedStop.estimatedMinutes || 15;
    let currentTime = new Date(completedAt.getTime() + serviceMinutes * 60000);
    let previousLocation = completedLocation;

    const updates: { id: string; estimatedArrival: Date }[] = [];

    for (const stop of remainingStops) {
      if (!stop.address.latitude || !stop.address.longitude) continue;

      const stopLocation = { lat: stop.address.latitude, lng: stop.address.longitude };

      // Get travel time from previous location
      const travelMinutes = await getTravelTime(previousLocation, stopLocation, currentTime, apiKey);

      // Calculate arrival time
      const arrivalTime = new Date(currentTime.getTime() + travelMinutes * 60000);
      updates.push({ id: stop.id, estimatedArrival: arrivalTime });

      // Update for next iteration
      const stopServiceMinutes = stop.estimatedMinutes || 15;
      currentTime = new Date(arrivalTime.getTime() + stopServiceMinutes * 60000);
      previousLocation = stopLocation;
    }

    // Batch update all stops
    for (const update of updates) {
      await prisma.stop.update({
        where: { id: update.id },
        data: { estimatedArrival: update.estimatedArrival },
      });
    }

    // Calculate new depot return time
    let newDepotReturnTime: Date | undefined;
    if (route.depot) {
      const lastStop = remainingStops[remainingStops.length - 1];
      if (lastStop.address.latitude && lastStop.address.longitude) {
        const lastUpdate = updates.find(u => u.id === lastStop.id);
        const lastServiceMinutes = lastStop.estimatedMinutes || 15;
        const departureFromLast = new Date(
          (lastUpdate?.estimatedArrival || new Date()).getTime() + lastServiceMinutes * 60000
        );

        const returnTravelMinutes = await getTravelTime(
          { lat: lastStop.address.latitude, lng: lastStop.address.longitude },
          { lat: route.depot.latitude, lng: route.depot.longitude },
          departureFromLast,
          apiKey
        );

        newDepotReturnTime = new Date(departureFromLast.getTime() + returnTravelMinutes * 60000);

        await prisma.route.update({
          where: { id: routeId },
          data: { depotReturnTime: newDepotReturnTime },
        });
      }
    }

    console.log(`[RECALC] Updated ${updates.length} stops with new ETAs`);

    // Send webhook if enabled
    const webhookConfig = await getWebhookConfig();
    if (webhookConfig.enabled && webhookConfig.url) {
      await sendETAUpdateWebhook(route, remainingStops, newDepotReturnTime, webhookConfig);
    }

    return {
      success: true,
      updatedStops: updates.length,
      newDepotReturnTime,
    };
  } catch (error) {
    console.error('[RECALC] Error recalculating ETAs:', error);
    return {
      success: false,
      updatedStops: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get travel time between two points using Google Directions API
 */
async function getTravelTime(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  departureTime: Date,
  apiKey: string
): Promise<number> {
  try {
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', `${origin.lat},${origin.lng}`);
    url.searchParams.set('destination', `${destination.lat},${destination.lng}`);
    url.searchParams.set('mode', 'driving');

    // Only use departure_time if in the future
    const now = new Date();
    if (departureTime.getTime() > now.getTime()) {
      url.searchParams.set('departure_time', Math.floor(departureTime.getTime() / 1000).toString());
    } else {
      url.searchParams.set('departure_time', 'now');
    }

    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    const data = await response.json() as {
      status: string;
      routes?: Array<{
        legs?: Array<{
          duration?: { value: number };
          duration_in_traffic?: { value: number };
        }>;
      }>;
    };

    if (data.status === 'OK' && data.routes?.[0]?.legs?.[0]) {
      const leg = data.routes[0].legs[0];
      // Prefer duration_in_traffic if available
      const durationSeconds = leg.duration_in_traffic?.value || leg.duration?.value || 0;
      return Math.ceil(durationSeconds / 60);
    }

    // Fallback: estimate based on straight-line distance
    const distance = haversineDistance(origin, destination);
    return Math.ceil(distance / 500); // Assume ~30 km/h average speed
  } catch (error) {
    console.error('[RECALC] Error getting travel time:', error);
    // Fallback
    const distance = haversineDistance(origin, destination);
    return Math.ceil(distance / 500);
  }
}

/**
 * Calculate return to depot time
 */
async function getReturnToDepotTime(
  lastStopLocation: { lat: number; lng: number },
  depotLocation: { lat: number; lng: number },
  completedAt: Date,
  serviceMinutes: number,
  apiKey: string
): Promise<Date | null> {
  try {
    const departureTime = new Date(completedAt.getTime() + serviceMinutes * 60000);
    const travelMinutes = await getTravelTime(lastStopLocation, depotLocation, departureTime, apiKey);
    return new Date(departureTime.getTime() + travelMinutes * 60000);
  } catch (error) {
    console.error('[RECALC] Error calculating return time:', error);
    return null;
  }
}

/**
 * Haversine distance in meters
 */
function haversineDistance(
  point1: { lat: number; lng: number },
  point2: { lat: number; lng: number }
): number {
  const R = 6371000; // Earth radius in meters
  const lat1 = (point1.lat * Math.PI) / 180;
  const lat2 = (point2.lat * Math.PI) / 180;
  const deltaLat = ((point2.lat - point1.lat) * Math.PI) / 180;
  const deltaLng = ((point2.lng - point1.lng) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

/**
 * Send webhook notification for ETA updates
 */
async function sendETAUpdateWebhook(
  route: {
    id: string;
    name: string;
    status: string;
    scheduledDate: Date | null;
    depotReturnTime: Date | null;
    assignedTo: { id: string; firstName: string; lastName: string; phone: string | null } | null;
  },
  remainingStops: Array<{
    id: string;
    sequenceOrder: number;
    status: string;
    estimatedArrival: Date | null;
    completedAt: Date | null;
    recipientName: string | null;
    recipientPhone: string | null;
    recipientEmail: string | null;
    address: { fullAddress: string };
  }>,
  newDepotReturnTime: Date | undefined,
  webhookConfig: { url: string | null; enabled: boolean; secret: string | null }
): Promise<void> {
  if (!webhookConfig.url) return;

  // Refetch updated stops to get new ETAs
  const updatedStops = await prisma.stop.findMany({
    where: { id: { in: remainingStops.map(s => s.id) } },
    include: { address: true },
    orderBy: { sequenceOrder: 'asc' },
  });

  const payload: WebhookPayload = {
    event: 'eta.updated',
    timestamp: new Date().toISOString(),
    route: {
      ...buildRoutePayload(route),
      depotReturnTime: newDepotReturnTime?.toISOString() || route.depotReturnTime?.toISOString(),
    },
    driver: buildDriverPayload(route.assignedTo),
    remainingStops: updatedStops.map(s => buildStopPayload(s)),
    metadata: {
      reason: 'stop_completed',
      updatedAt: new Date().toISOString(),
    },
  };

  await sendWebhook(webhookConfig.url, payload, webhookConfig.secret);
}

/**
 * Send webhook notification when a stop is completed
 */
export async function sendStopCompletedWebhook(
  routeId: string,
  stopId: string
): Promise<void> {
  // Check webhook config first
  const webhookConfig = await getWebhookConfig();
  if (!webhookConfig.enabled || !webhookConfig.url) return;

  const route = await prisma.route.findUnique({
    where: { id: routeId },
    include: {
      assignedTo: true,
    },
  });

  if (!route) return;

  const stop = await prisma.stop.findUnique({
    where: { id: stopId },
    include: { address: true },
  });

  if (!stop) return;

  const remainingStops = await prisma.stop.findMany({
    where: {
      routeId,
      sequenceOrder: { gt: stop.sequenceOrder },
      status: { in: [StopStatus.PENDING, StopStatus.IN_TRANSIT] },
    },
    include: { address: true },
    orderBy: { sequenceOrder: 'asc' },
  });

  const payload: WebhookPayload = {
    event: 'stop.completed',
    timestamp: new Date().toISOString(),
    route: buildRoutePayload(route),
    driver: buildDriverPayload(route.assignedTo),
    stop: buildStopPayload(stop),
    remainingStops: remainingStops.map(s => buildStopPayload(s)),
  };

  await sendWebhook(webhookConfig.url, payload, webhookConfig.secret);
}
