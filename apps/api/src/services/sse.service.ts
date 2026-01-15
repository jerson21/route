import { Response } from 'express';

// Store active SSE connections per route
const routeConnections = new Map<string, Set<Response>>();

/**
 * Add a client connection for a specific route
 */
export function addRouteConnection(routeId: string, res: Response): void {
  if (!routeConnections.has(routeId)) {
    routeConnections.set(routeId, new Set());
  }
  routeConnections.get(routeId)!.add(res);

  console.log(`[SSE] Client connected to route ${routeId}. Total connections: ${routeConnections.get(routeId)!.size}`);
}

/**
 * Remove a client connection
 */
export function removeRouteConnection(routeId: string, res: Response): void {
  const connections = routeConnections.get(routeId);
  if (connections) {
    connections.delete(res);
    console.log(`[SSE] Client disconnected from route ${routeId}. Remaining: ${connections.size}`);

    // Clean up empty sets
    if (connections.size === 0) {
      routeConnections.delete(routeId);
    }
  }
}

/**
 * Broadcast an event to all clients watching a specific route
 */
export function broadcastToRoute(routeId: string, event: string, data: any): void {
  const connections = routeConnections.get(routeId);
  if (!connections || connections.size === 0) {
    return;
  }

  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

  console.log(`[SSE] Broadcasting "${event}" to ${connections.size} clients on route ${routeId}`);

  connections.forEach((res) => {
    try {
      res.write(message);
    } catch (error) {
      console.error('[SSE] Error writing to client:', error);
      // Remove dead connection
      connections.delete(res);
    }
  });
}

/**
 * Send a heartbeat to keep connections alive
 */
export function sendHeartbeat(routeId: string): void {
  const connections = routeConnections.get(routeId);
  if (!connections) return;

  const message = `: heartbeat\n\n`;

  connections.forEach((res) => {
    try {
      res.write(message);
    } catch (error) {
      connections.delete(res);
    }
  });
}

/**
 * Get number of active connections for a route
 */
export function getConnectionCount(routeId: string): number {
  return routeConnections.get(routeId)?.size || 0;
}

// Event types for type safety
export type SSEEventType =
  | 'route.updated'
  | 'route.loaded'
  | 'route.started'
  | 'route.sent'
  | 'stop.status_changed'
  | 'stop.in_transit'
  | 'stop.completed'
  | 'stop.failed'
  | 'stop.skipped'
  | 'driver.location_updated'
  | 'route.completed';
