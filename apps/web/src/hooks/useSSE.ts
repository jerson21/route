import { useEffect, useRef, useCallback, useState } from 'react';
import { getAccessToken, onTokenChange, refreshTokenIfNeeded } from '../services/api';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

// How often to proactively refresh token to keep SSE alive (50 minutes, since token now lasts 4 hours)
const TOKEN_REFRESH_INTERVAL = 50 * 60 * 1000;

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
 * expires by:
 *
 * 1. Proactively refreshing the token every 50 minutes (token lasts 4 hours)
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
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isManuallyClosedRef = useRef(false);
  const currentTokenRef = useRef<string | null>(null); // Track token used by current SSE connection

  // Use refs for callbacks to avoid reconnection on every render
  const onOpenRef = useRef(onOpen);
  const onErrorRef = useRef(onError);
  const onMessageRef = useRef(onMessage);
  const eventHandlersRef = useRef(eventHandlers);

  // Keep refs updated
  useEffect(() => {
    onOpenRef.current = onOpen;
    onErrorRef.current = onError;
    onMessageRef.current = onMessage;
    eventHandlersRef.current = eventHandlers;
  });

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

    // Save the token being used for this connection
    currentTokenRef.current = token;

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
      onOpenRef.current?.();
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

      onErrorRef.current?.(event);
    };

    eventSource.onmessage = (event) => {
      onMessageRef.current?.(event);
    };

    // Register all custom event handlers using ref (to get latest handlers)
    Object.keys(eventHandlersRef.current).forEach((eventName) => {
      eventSource.addEventListener(eventName, (event: MessageEvent) => {
        try {
          const data = event.data ? JSON.parse(event.data) : null;
          // Use the handler from the ref to always call the latest version
          eventHandlersRef.current[eventName]?.(data);
        } catch (e) {
          // If JSON parsing fails, pass raw data
          eventHandlersRef.current[eventName]?.(event.data);
        }
      });
    });
  }, [endpoint, enabled]); // Only reconnect when endpoint or enabled changes

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

  // Setup token refresh interval - uses ref to avoid recreating interval
  useEffect(() => {
    if (!enabled) return;

    // Refresh token periodically to keep SSE connection alive
    tokenRefreshIntervalRef.current = setInterval(async () => {
      // Check connection state directly from ref, not from state
      if (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.OPEN) {
        console.log('[SSE] Proactive token refresh check...');
        try {
          const tokenBeforeRefresh = currentTokenRef.current;
          const newToken = await refreshTokenIfNeeded();
          // Only reconnect if we got a DIFFERENT token (actual refresh happened)
          if (newToken && newToken !== tokenBeforeRefresh && eventSourceRef.current) {
            console.log('[SSE] Token was actually refreshed, reconnecting...');
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
  }, [enabled, connect]);

  // Listen for token changes from axios interceptor
  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = onTokenChange((newToken) => {
      // Only reconnect if token actually changed (not just same token notified again)
      if (newToken && newToken !== currentTokenRef.current && eventSourceRef.current) {
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
