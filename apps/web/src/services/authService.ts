import { api, getStoredDeviceId } from './api';
import type { LoginRequest, LoginResponse, User } from '@route-optimizer/shared';

export async function login(data: LoginRequest): Promise<LoginResponse & { deviceId?: string }> {
  const deviceId = getStoredDeviceId();
  const deviceInfo = navigator.userAgent;

  const response = await api.post('/auth/login', {
    ...data,
    deviceId,
    deviceInfo
  });
  return response.data.data;
}

export async function getCurrentUser(): Promise<User> {
  const response = await api.get('/auth/me');
  return response.data.data;
}

export async function logout(logoutAll = false): Promise<void> {
  const refreshToken = localStorage.getItem('refreshToken');
  await api.post('/auth/logout', { refreshToken, logoutAll });
}

export interface Session {
  id: string;
  deviceId: string | null;
  deviceInfo: string | null;
  createdAt: string;
  expiresAt: string;
}

export async function getActiveSessions(): Promise<Session[]> {
  const response = await api.get('/auth/sessions');
  return response.data.data;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await api.delete(`/auth/sessions/${sessionId}`);
}
