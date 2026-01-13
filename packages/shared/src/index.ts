// User types
export type UserRole = 'ADMIN' | 'OPERATOR' | 'DRIVER';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone?: string;
  isActive: boolean;
  createdAt: string;
}

// Route types
export type RouteStatus = 'DRAFT' | 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export interface Route {
  id: string;
  name: string;
  description?: string;
  status: RouteStatus;
  scheduledDate?: string;
  startedAt?: string;
  completedAt?: string;
  totalDistanceKm?: number;
  totalDurationMin?: number;
  originLatitude?: number;
  originLongitude?: number;
  originAddress?: string;
  createdById: string;
  assignedToId?: string;
  createdAt: string;
}

// Address types
export type GeocodeStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'MANUAL';

export interface Address {
  id: string;
  street: string;
  number?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  fullAddress: string;
  latitude?: number;
  longitude?: number;
  geocodeStatus: GeocodeStatus;
  isManualLocation: boolean;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  createdAt: string;
}

// Stop types
export type StopStatus = 'PENDING' | 'IN_TRANSIT' | 'ARRIVED' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

export interface Stop {
  id: string;
  routeId: string;
  addressId: string;
  sequenceOrder: number;
  status: StopStatus;
  estimatedArrival?: string;
  arrivedAt?: string;
  completedAt?: string;
  notes?: string;
  address?: Address;
}

// API Response types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

// Auth types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface CreateUserRequest {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  phone?: string;
}

// Route creation
export interface CreateRouteRequest {
  name: string;
  description?: string;
  scheduledDate?: string;
  originLatitude?: number;
  originLongitude?: number;
  originAddress?: string;
}

// Address creation
export interface CreateAddressRequest {
  street: string;
  number?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  customerName?: string;
  customerPhone?: string;
  notes?: string;
  latitude?: number;
  longitude?: number;
}
