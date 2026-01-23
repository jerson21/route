import { useEffect, useRef, useCallback, useState } from 'react';
import { getAccessToken, onTokenChange, refreshTokenIfNeeded } from '../services/api';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

// How often to proactively refresh token to keep SSE alive (10 minutes)
const TOKEN_REFRESH_INTERVAL = 10 * 60 * 1000;

// How long to wait before reconnecting after an error
const RECONNECT_DELAY = 3000;

// Maximum reconnect attempts before giving up
const MAX_RECONNECT_ATTEMPTS = 5;

interface SSEOptions {
  onOpen?: () => void;
  onError?: (error: Event) => void;
  onMessage?: (event: MessageEvent) => void;
  enabled?: boolean;
}

interface SSEEventHandlers {
  [eventName: string]: (data: any) => void;
}

interface UseSSEReturn {
  isConnected: boolean;
  error: string | null;
  reconnect: () => void;
}

/**
 * Hook for managing Server-Sent Events (SSE) connections with automatic
 * token refresh and reconnection.
 *
 * This hook solves the problem of SSE connections dying when the access token
 * expires (15 minutes) by:
 *
 * 1. Proactively refreshing the token every 10 minutes
 * 2. Reconnecting with a fresh token when the connection dies
 * 3. Listening for token changes from the axios interceptor
 *
 * @param endpoint - The SSE endpoint path (e.g., '/routes/123/events')
 * @param eventHandlers - Object mapping event names to handler functions
 * @param options - Additional options (onOpen, onError, onMessage, enabled)
 */
export function useSSE(
  endpoint: string,
  eventHandlers: SSEEventHandlers,
  options: SSEOptions = {}
): UseSSEReturn {
  const { onOpen, onError, onMessage, enabled = true } = options;

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const tokenRefreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isManuallyClosedRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create SSE connection with current token
  const connect = useCallback(() => {
    // Don't connect if manually closed or disabled
    if (isManuallyClosedRef.current || !enabled) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      console.log('[SSE] No auth token available, cannot connect');
      setError('No auth token');
      return;
    }

    // Close existing connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    console.log('[SSE] Connecting to', endpoint);
    const url = `${API_URL}${endpoint}?token=${encodeURIComponent(token)}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('[SSE] Connected');
      setIsConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;
      onOpen?.();
    };

    eventSource.onerror = (event) => {
      console.log('[SSE] Connection error');
      setIsConnected(false);

      // Check if we should try to reconnect
      if (!isManuallyClosedRef.current && enabled) {
        // EventSource readyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
        if (eventSource.readyState === EventSource.CLOSED) {
          // Connection was closed by server (likely 401 or other error)
          handleReconnect();
        }
        // If readyState is CONNECTING, EventSource will auto-retry
      }

      onError?.(event);
    };

    eventSource.onmessage = (event) => {
      onMessage?.(event);
    };

    // Register all custom event handlers
    Object.entries(eventHandlers).forEach(([eventName, handler]) => {
      eventSource.addEventListener(eventName, (event: MessageEvent) => {
        try {
          const data = event.data ? JSON.parse(event.data) : null;
          handler(data);
        } catch (e) {
          // If JSON parsing fails, pass raw data
          handler(event.data);
        }
      });
    });
  }, [endpoint, eventHandlers, enabled, onOpen, onError, onMessage]);

  // Handle reconnection with exponential backoff
  const handleReconnect = useCallback(async () => {
    if (isManuallyClosedRef.current || !enabled) {
      return;
    }

    if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
      console.log('[SSE] Max reconnect attempts reached');
      setError('Connection failed after multiple attempts');
      return;
    }

    reconnectAttemptsRef.current++;
    const delay = RECONNECT_DELAY * Math.pow(1.5, reconnectAttemptsRef.current - 1);

    console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);

    // Clear any existing reconnect timeout
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectTimeoutRef.current = setTimeout(async () => {
      // Try to refresh token before reconnecting
      console.log('[SSE] Refreshing token before reconnect...');
      try {
        await refreshTokenIfNeeded();
      } catch (e) {
        console.log('[SSE] Token refresh failed, will try anyway');
      }
      connect();
    }, delay);
  }, [connect, enabled]);

  // Manual reconnect (resets attempt counter)
  const reconnect = useCallback(() => {
    console.log('[SSE] Manual reconnect requested');
    reconnectAttemptsRef.current = 0;
    isManuallyClosedRef.current = false;
    connect();
  }, [connect]);

  // Setup token refresh interval
  useEffect(() => {
    if (!enabled) return;

    // Refresh token periodically to keep SSE connection alive
    tokenRefreshIntervalRef.current = setInterval(async () => {
      if (isConnected && eventSourceRef.current) {
        console.log('[SSE] Proactive token refresh...');
        try {
          const newToken = await refreshTokenIfNeeded();
          if (newToken && eventSourceRef.current) {
            // Reconnect with fresh token
            console.log('[SSE] Reconnecting with fresh token');
            reconnectAttemptsRef.current = 0;
            connect();
          }
        } catch (e) {
          console.error('[SSE] Proactive token refresh failed:', e);
        }
      }
    }, TOKEN_REFRESH_INTERVAL);

    return () => {
      if (tokenRefreshIntervalRef.current) {
        clearInterval(tokenRefreshIntervalRef.current);
      }
    };
  }, [enabled, isConnected, connect]);

  // Listen for token changes from axios interceptor
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = onTokenChange((newToken) => {
      if (newToken && eventSourceRef.current) {
        // Token was refreshed by another part of the app
        // Reconnect with the new token
        console.log('[SSE] Token changed externally, reconnecting...');
        reconnectAttemptsRef.current = 0;
        connect();
      } else if (!newToken) {
        // Token was cleared (user logged out)
        console.log('[SSE] Token cleared, closing connection');
        isManuallyClosedRef.current = true;
        if (eventSourceRef.current) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
        setIsConnected(false);
      }
    });

    return unsubscribe;
  }, [enabled, connect]);

  // Initial connection and cleanup
  useEffect(() => {
    if (enabled) {
      isManuallyClosedRef.current = false;
      connect();
    }

    return () => {
      console.log('[SSE] Cleaning up connection');
      isManuallyClosedRef.current = true;

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }

      if (tokenRefreshIntervalRef.current) {
        clearInterval(tokenRefreshIntervalRef.current);
      }

      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [enabled, connect]);

  return { isConnected, error, reconnect };
}

export default useSSE;
