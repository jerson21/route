import { Request, Response, NextFunction } from 'express';
import { AppError } from './errorHandler.js';
import type { UserRole } from '@route-optimizer/shared';

type Permission =
  | 'routes:create'
  | 'routes:read'
  | 'routes:read:own'
  | 'routes:update'
  | 'routes:delete'
  | 'routes:optimize'
  | 'routes:assign'
  | 'users:manage'
  | 'addresses:create'
  | 'addresses:read'
  | 'addresses:update'
  | 'addresses:delete'
  | 'reports:view'
  | 'tracking:view'
  | 'tracking:send';

const rolePermissions: Record<UserRole, Permission[]> = {
  ADMIN: [
    'routes:create', 'routes:read', 'routes:update', 'routes:delete',
    'routes:optimize', 'routes:assign',
    'users:manage',
    'addresses:create', 'addresses:read', 'addresses:update', 'addresses:delete',
    'reports:view',
    'tracking:view', 'tracking:send'
  ],
  OPERATOR: [
    'routes:create', 'routes:read', 'routes:update',
    'routes:optimize', 'routes:assign',
    'addresses:create', 'addresses:read', 'addresses:update',
    'tracking:view'
  ],
  DRIVER: [
    'routes:read:own',
    'tracking:send'
  ]
};

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;

    if (!userRole) {
      return next(new AppError(401, 'No autenticado'));
    }

    const userPermissions = rolePermissions[userRole];
    const hasPermission = permissions.some(p => userPermissions.includes(p));

    if (!hasPermission) {
      return next(new AppError(403, 'No tienes permisos para esta acción'));
    }

    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const userRole = req.user?.role;

    if (!userRole) {
      return next(new AppError(401, 'No autenticado'));
    }

    if (!roles.includes(userRole)) {
      return next(new AppError(403, 'Rol no autorizado'));
    }

    next();
  };
}
