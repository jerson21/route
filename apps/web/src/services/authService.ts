import { api } from './api';
import type { LoginRequest, LoginResponse, User } from '@route-optimizer/shared';

export async function login(data: LoginRequest): Promise<LoginResponse> {
  const response = await api.post('/auth/login', data);
  return response.data.data;
}

export async function getCurrentUser(): Promise<User> {
  const response = await api.get('/auth/me');
  return response.data.data;
}

export async function logout(): Promise<void> {
  const refreshToken = localStorage.getItem('refreshToken');
  await api.post('/auth/logout', { refreshToken });
}
