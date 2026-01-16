import admin from 'firebase-admin';
import { prisma } from '../config/database.js';

let firebaseInitialized = false;

// Initialize Firebase Admin SDK
function initializeFirebase() {
  if (firebaseInitialized) return true;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;

  if (!serviceAccountJson) {
    console.warn('[FCM] FIREBASE_SERVICE_ACCOUNT not configured - push notifications disabled');
    return false;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountJson);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    firebaseInitialized = true;
    console.log('[FCM] Firebase Admin initialized successfully');
    return true;
  } catch (error) {
    console.error('[FCM] Failed to initialize Firebase Admin:', error);
    return false;
  }
}

// Initialize on module load
initializeFirebase();

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Send push notification to a specific user
 */
export async function sendToUser(userId: string, payload: NotificationPayload): Promise<boolean> {
  if (!firebaseInitialized) {
    console.warn('[FCM] Firebase not initialized, skipping notification');
    return false;
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true, firstName: true }
    });

    if (!user?.fcmToken) {
      console.log(`[FCM] No FCM token for user ${userId}`);
      return false;
    }

    // DATA-ONLY message (no 'notification' field)
    // This ensures onMessageReceived() is ALWAYS called (foreground AND background)
    // The Android app must create the notification manually
    const message: admin.messaging.Message = {
      token: user.fcmToken,
      data: {
        // Include title and body in data so Android can create notification
        title: payload.title,
        body: payload.body,
        ...(payload.data || {})
      },
      android: {
        priority: 'high',
        // TTL of 1 hour for message delivery
        ttl: 3600000
      }
    };

    const response = await admin.messaging().send(message);
    console.log(`[FCM] Notification sent to ${user.firstName}:`, response);
    return true;
  } catch (error: unknown) {
    // Handle invalid/expired tokens
    if (error && typeof error === 'object' && 'code' in error) {
      const fcmError = error as { code: string };
      if (fcmError.code === 'messaging/registration-token-not-registered' ||
          fcmError.code === 'messaging/invalid-registration-token') {
        console.log(`[FCM] Invalid token for user ${userId}, clearing...`);
        await prisma.user.update({
          where: { id: userId },
          data: { fcmToken: null }
        });
      }
    }
    console.error(`[FCM] Failed to send notification to user ${userId}:`, error);
    return false;
  }
}

/**
 * Send push notification to multiple users
 */
export async function sendToUsers(userIds: string[], payload: NotificationPayload): Promise<number> {
  let successCount = 0;
  for (const userId of userIds) {
    const success = await sendToUser(userId, payload);
    if (success) successCount++;
  }
  return successCount;
}

// ============================================
// Pre-built notification types
// ============================================

/**
 * Notify driver that a new route has been assigned/sent to them
 */
export async function notifyNewRoute(driverId: string, routeName: string, routeId: string, stopsCount: number): Promise<boolean> {
  return sendToUser(driverId, {
    title: 'Nueva ruta asignada',
    body: `Tienes una nueva ruta: ${routeName} con ${stopsCount} paradas`,
    data: {
      type: 'new_route',
      routeId,
      routeName
    }
  });
}

/**
 * Notify driver that their route has been cancelled
 */
export async function notifyRouteCancelled(driverId: string, routeName: string, routeId: string): Promise<boolean> {
  return sendToUser(driverId, {
    title: 'Ruta cancelada',
    body: `La ruta "${routeName}" ha sido cancelada`,
    data: {
      type: 'route_cancelled',
      routeId,
      routeName
    }
  });
}

/**
 * Notify driver that a stop was added to their active route
 */
export async function notifyStopAdded(driverId: string, routeName: string, routeId: string, stopAddress: string): Promise<boolean> {
  return sendToUser(driverId, {
    title: 'Nueva parada agregada',
    body: `Se agregó una parada a tu ruta: ${stopAddress}`,
    data: {
      type: 'stop_added',
      routeId,
      routeName
    }
  });
}

/**
 * Notify driver that a stop was removed from their active route
 */
export async function notifyStopRemoved(driverId: string, routeName: string, routeId: string): Promise<boolean> {
  return sendToUser(driverId, {
    title: 'Parada eliminada',
    body: `Se eliminó una parada de tu ruta "${routeName}"`,
    data: {
      type: 'stop_removed',
      routeId,
      routeName
    }
  });
}

/**
 * Notify driver that route was re-optimized
 */
export async function notifyRouteReoptimized(driverId: string, routeName: string, routeId: string): Promise<boolean> {
  return sendToUser(driverId, {
    title: 'Ruta actualizada',
    body: `El orden de las paradas de "${routeName}" ha cambiado`,
    data: {
      type: 'route_reoptimized',
      routeId,
      routeName
    }
  });
}

/**
 * Save FCM token for a user
 */
export async function saveFcmToken(userId: string, fcmToken: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { fcmToken }
  });
  console.log(`[FCM] Token saved for user ${userId}`);
}

/**
 * Remove FCM token for a user (on logout)
 */
export async function removeFcmToken(userId: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { fcmToken: null }
  });
  console.log(`[FCM] Token removed for user ${userId}`);
}

/**
 * Send a text message to driver (from admin/operator or system)
 */
export async function sendMessageToDriver(
  driverId: string,
  message: string,
  routeId: string,
  senderName?: string
): Promise<boolean> {
  return sendToUser(driverId, {
    title: senderName ? `Mensaje de ${senderName}` : 'Nuevo mensaje',
    body: message,
    data: {
      type: 'message',
      routeId,
      message,
      senderName: senderName || 'Sistema',
      timestamp: new Date().toISOString()
    }
  });
}
