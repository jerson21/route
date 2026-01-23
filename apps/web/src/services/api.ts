import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api/v1';

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
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: Error) => void;
}> = [];

const processQueue = (error: Error | null, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token!);
    }
  });
  failedQueue = [];
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

    // If refresh is already in progress, queue this request
    if (isRefreshing) {
      console.log('[AUTH] Refresh in progress, queuing request...');
      return new Promise((resolve, reject) => {
        failedQueue.push({
          resolve: (token: string) => {
            console.log('[AUTH] Processing queued request with new token');
            originalRequest.headers.Authorization = `Bearer ${token}`;
            resolve(api(originalRequest));
          },
          reject: (err: Error) => {
            console.log('[AUTH] Queued request rejected:', err.message);
            reject(err);
          }
        });
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;
    console.log('[AUTH] Starting token refresh...');

    try {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) {
        console.log('[AUTH] No refresh token found in localStorage');
        throw new Error('No refresh token');
      }

      console.log('[AUTH] Calling refresh endpoint...');
      const response = await axios.post(`${API_URL}/auth/refresh`, {
        refreshToken
      });

      const { accessToken, refreshToken: newRefreshToken } = response.data.data;
      console.log('[AUTH] Refresh successful, saving new tokens');

      // Save BOTH tokens
      localStorage.setItem('accessToken', accessToken);
      if (newRefreshToken) {
        localStorage.setItem('refreshToken', newRefreshToken);
      }

      // Process queued requests with new token
      console.log(`[AUTH] Processing ${failedQueue.length} queued requests`);
      processQueue(null, accessToken);

      originalRequest.headers.Authorization = `Bearer ${accessToken}`;
      return api(originalRequest);
    } catch (refreshError: any) {
      // Only logout if refresh actually failed
      console.log('[AUTH] Refresh failed:', refreshError.message || refreshError);
      processQueue(refreshError as Error, null);
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      window.location.href = '/login';
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
      console.log('[AUTH] Refresh process completed');
    }
  }
);
