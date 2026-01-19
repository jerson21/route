import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { AppError } from './errorHandler.js';
import type { UserRole } from '@route-optimizer/shared';

interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        role: UserRole;
      };
      apiKey?: {
        id: string;
        name: string;
        permissions: string[];
      };
    }
  }
}

// Hash API key for comparison
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Authenticate via API Key
async function authenticateApiKey(apiKey: string): Promise<{
  user: { id: string; email: string; role: UserRole };
  apiKeyInfo: { id: string; name: string; permissions: string[] };
} | null> {
  const keyHash = hashApiKey(apiKey);

  const apiKeyRecord = await prisma.apiKey.findUnique({
    where: { keyHash },
    include: {
      createdBy: {
        select: { id: true, email: true, role: true, isActive: true }
      }
    }
  });

  if (!apiKeyRecord) return null;
  if (!apiKeyRecord.isActive) return null;
  if (!apiKeyRecord.createdBy.isActive) return null;
  if (apiKeyRecord.expiresAt && apiKeyRecord.expiresAt < new Date()) return null;

  // Update last used
  await prisma.apiKey.update({
    where: { id: apiKeyRecord.id },
    data: { lastUsedAt: new Date() }
  });

  return {
    user: {
      id: apiKeyRecord.createdBy.id,
      email: apiKeyRecord.createdBy.email,
      role: apiKeyRecord.createdBy.role as UserRole
    },
    apiKeyInfo: {
      id: apiKeyRecord.id,
      name: apiKeyRecord.name,
      permissions: apiKeyRecord.permissions as string[]
    }
  };
}

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Check for API Key first (X-API-Key header)
    const apiKey = req.headers['x-api-key'] as string;
    if (apiKey) {
      const result = await authenticateApiKey(apiKey);
      if (!result) {
        throw new AppError(401, 'API Key inválida o expirada');
      }

      req.user = result.user;
      req.apiKey = result.apiKeyInfo;
      return next();
    }

    // Fall back to JWT Bearer token
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'Token no proporcionado');
    }

    const token = authHeader.split(' ')[1];

    const payload = jwt.verify(
      token,
      process.env.JWT_ACCESS_SECRET!
    ) as JwtPayload;

    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, role: true, isActive: true }
    });

    if (!user || !user.isActive) {
      throw new AppError(401, 'Usuario no válido');
    }

    req.user = {
      id: user.id,
      email: user.email,
      role: user.role as UserRole
    };

    next();
  } catch (error) {
    next(error);
  }
}
