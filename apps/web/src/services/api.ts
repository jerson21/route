import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

// ============ DEVICE ID MANAGEMENT ============
// Generate or retrieve a unique device ID for this browser
function getDeviceId(): string {
  let deviceId = localStorage.getItem('deviceId');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem('deviceId', deviceId);
  }
  return deviceId;
}

export function getStoredDeviceId(): string {
  return getDeviceId();
}
// ==============================================

// ============ TOKEN CHANGE EVENTS ============
// Allow other parts of the app (like SSE) to subscribe to token changes
type TokenChangeListener = (newToken: string | null) => void;
const tokenChangeListeners: Set<TokenChangeListener> = new Set();

export function onTokenChange(listener: TokenChangeListener): () => void {
  tokenChangeListeners.add(listener);
  return () => tokenChangeListeners.delete(listener);
}

function notifyTokenChange(newToken: string | null) {
  tokenChangeListeners.forEach(listener => {
    try {
      listener(newToken);
    } catch (e) {
      console.error('[API] Token change listener error:', e);
    }
  });
}

export function getAccessToken(): string | null {
  return localStorage.getItem('accessToken');
}
// ==============================================

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('accessToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ============ REFRESH TOKEN LOCK ============
// Prevents race condition when multiple requests receive 401 simultaneously
let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;

const processRefresh = async (): Promise<string> => {
  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) {
    throw new Error('No refresh token');
  }

  const deviceId = getDeviceId();
  console.log('[AUTH] Calling refresh endpoint...');

  const response = await axios.post(`${API_URL}/auth/refresh`, {
    refreshToken,
    deviceId
  });

  const { accessToken, refreshToken: newRefreshToken } = response.data.data;
  console.log('[AUTH] Refresh successful, saving new tokens');

  // Save BOTH tokens
  localStorage.setItem('accessToken', accessToken);
  if (newRefreshToken) {
    localStorage.setItem('refreshToken', newRefreshToken);
  }

  // Notify listeners (SSE, etc.) about the new token
  notifyTokenChange(accessToken);

  return accessToken;
};
// ============================================

// Response interceptor - handle token refresh with lock
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If not 401 or already retried, reject immediately
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    console.log('[AUTH] 401 received, checking refresh state...');

    // If refresh is already in progress, wait for it
    if (isRefreshing && refreshPromise) {
      console.log('[AUTH] Refresh in progress, waiting...');
      try {
        const newToken = await refreshPromise;
        console.log('[AUTH] Got new token from ongoing refresh');
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        originalRequest._retry = true;
        return api(originalRequest);
      } catch (err) {
        console.log('[AUTH] Ongoing refresh failed');
        return Promise.reject(err);
      }
    }

    // Start new refresh
    originalRequest._retry = true;
    isRefreshing = true;
    console.log('[AUTH] Starting token refresh...');

    refreshPromise = processRefresh()
      .then((token) => {
        isRefreshing = false;
        refreshPromise = null;
        return token;
      })
      .catch((err) => {
        isRefreshing = false;
        refreshPromise = null;
        // Clear tokens and redirect to login
        console.log('[AUTH] Refresh failed:', err.message || err);
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        notifyTokenChange(null);
        window.location.href = '/login';
        throw err;
      });

    try {
      const newToken = await refreshPromise;
      originalRequest.headers.Authorization = `Bearer ${newToken}`;
      return api(originalRequest);
    } catch (refreshError) {
      return Promise.reject(refreshError);
    }
  }
);

// ============ MANUAL REFRESH FUNCTION ============
// Can be called proactively (e.g., before token expires)
export async function refreshTokenIfNeeded(): Promise<string | null> {
  // Don't refresh if already refreshing
  if (isRefreshing && refreshPromise) {
    return refreshPromise;
  }

  const accessToken = localStorage.getItem('accessToken');
  if (!accessToken) {
    return null;
  }

  // Check if token is about to expire (within 2 minutes)
  try {
    const payload = JSON.parse(atob(accessToken.split('.')[1]));
    const expiresAt = payload.exp * 1000;
    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;

    // If more than 2 minutes until expiry, no need to refresh
    if (timeUntilExpiry > 2 * 60 * 1000) {
      return accessToken;
    }

    console.log('[AUTH] Token expiring soon, proactively refreshing...');
    isRefreshing = true;
    refreshPromise = processRefresh()
      .finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });

    return refreshPromise;
  } catch (e) {
    console.error('[AUTH] Error checking token expiry:', e);
    return accessToken;
  }
}
// ================================================
