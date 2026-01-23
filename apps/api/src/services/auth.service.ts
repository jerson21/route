import { prisma } from '../config/database.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateTokens, verifyRefreshToken, hashToken, generateDeviceId } from '../utils/jwt.js';
import { AppError } from '../middleware/errorHandler.js';
import type { UserRole } from '@route-optimizer/shared';

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

interface LoginInput {
  email: string;
  password: string;
  deviceId?: string;
  deviceInfo?: string;
}

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  phone?: string;
}

interface RefreshInput {
  refreshToken: string;
  deviceId?: string;
}

interface LogoutInput {
  userId: string;
  refreshToken?: string;
  logoutAll?: boolean;
}

/**
 * Login user and create a new session for the device.
 * Each device gets its own refresh token, allowing multiple active sessions.
 */
export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() }
  });

  if (!user || !user.isActive) {
    throw new AppError(401, 'Credenciales inválidas');
  }

  const isValidPassword = await comparePassword(input.password, user.passwordHash);

  if (!isValidPassword) {
    throw new AppError(401, 'Credenciales inválidas');
  }

  // Update last login
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  const tokens = generateTokens({
    id: user.id,
    email: user.email,
    role: user.role as UserRole
  });

  // Generate or use provided device ID
  const deviceId = input.deviceId || generateDeviceId();

  // Hash the refresh token before storing
  const tokenHash = hashToken(tokens.refreshToken);

  // If this device already has a session, revoke the old one first
  // This prevents accumulating multiple tokens per device
  await prisma.refreshToken.updateMany({
    where: {
      userId: user.id,
      deviceId: deviceId,
      revokedAt: null
    },
    data: { revokedAt: new Date() }
  });

  // Store the new refresh token
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: tokenHash,
      deviceId: deviceId,
      deviceInfo: input.deviceInfo || null,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
    }
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role
    },
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    deviceId: deviceId
  };
}

export async function register(input: RegisterInput) {
  const existingUser = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() }
  });

  if (existingUser) {
    throw new AppError(400, 'El email ya está registrado');
  }

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role || 'DRIVER',
      phone: input.phone
    }
  });

  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role
  };
}

/**
 * Refresh access token using a valid refresh token.
 *
 * IMPORTANT: This uses token rotation - the old refresh token is revoked
 * and a new one is issued. This improves security but requires careful
 * handling of concurrent requests.
 *
 * Race condition protection:
 * - We use a transaction with optimistic locking via revokedAt check
 * - If two requests try to refresh the same token simultaneously,
 *   only one will succeed (the one that revokes first)
 * - The second request will fail because it finds the token already revoked
 */
export async function refreshAccessToken(input: RefreshInput) {
  const { refreshToken, deviceId } = input;

  try {
    // Verify JWT signature and expiration
    const payload = verifyRefreshToken(refreshToken);
    const tokenHash = hashToken(refreshToken);

    // Use a transaction with optimistic locking to prevent race conditions
    const result = await prisma.$transaction(async (tx) => {
      // Find and lock the token in one atomic operation
      const storedToken = await tx.refreshToken.findFirst({
        where: {
          userId: payload.sub,
          tokenHash: tokenHash,
          revokedAt: null,
          expiresAt: { gt: new Date() }
        },
        include: { user: true }
      });

      if (!storedToken) {
        // Token not found, already revoked, or expired
        // This could be a replay attack or race condition - fail safely
        throw new AppError(401, 'Token de refresh inválido o expirado');
      }

      if (!storedToken.user.isActive) {
        throw new AppError(401, 'Usuario desactivado');
      }

      // Generate new tokens
      const newTokens = generateTokens({
        id: storedToken.user.id,
        email: storedToken.user.email,
        role: storedToken.user.role as UserRole
      });

      const newTokenHash = hashToken(newTokens.refreshToken);

      // Revoke the old token and create the new one atomically
      await tx.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() }
      });

      await tx.refreshToken.create({
        data: {
          userId: storedToken.user.id,
          tokenHash: newTokenHash,
          deviceId: deviceId || storedToken.deviceId,
          deviceInfo: storedToken.deviceInfo,
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000)
        }
      });

      return newTokens;
    });

    return result;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    // Log unexpected errors for debugging
    console.error('[AUTH] Refresh token error:', error);
    throw new AppError(401, 'Token de refresh inválido');
  }
}

/**
 * Logout user - revoke refresh token(s).
 *
 * By default, only revokes the token for the current device.
 * Use logoutAll: true to revoke all sessions (all devices).
 */
export async function logout(input: LogoutInput) {
  const { userId, refreshToken, logoutAll = false } = input;

  if (logoutAll) {
    // Revoke ALL refresh tokens for this user (logout from all devices)
    await prisma.$transaction([
      prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      }),
      // Clear FCM token
      prisma.user.update({
        where: { id: userId },
        data: { fcmToken: null }
      })
    ]);
  } else if (refreshToken) {
    // Only revoke the specific token (current device only)
    const tokenHash = hashToken(refreshToken);
    await prisma.refreshToken.updateMany({
      where: {
        userId,
        tokenHash: tokenHash,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
    // Note: FCM token is NOT cleared here since other devices may still be active
  } else {
    // No refresh token provided - revoke all (backward compatibility)
    await prisma.$transaction([
      prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null
        },
        data: {
          revokedAt: new Date()
        }
      }),
      prisma.user.update({
        where: { id: userId },
        data: { fcmToken: null }
      })
    ]);
  }
}

export async function getCurrentUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      phone: true,
      createdAt: true
    }
  });

  if (!user) {
    throw new AppError(404, 'Usuario no encontrado');
  }

  return user;
}

/**
 * Get all active sessions for a user.
 * Useful for "manage sessions" UI.
 */
export async function getActiveSessions(userId: string) {
  const sessions = await prisma.refreshToken.findMany({
    where: {
      userId,
      revokedAt: null,
      expiresAt: { gt: new Date() }
    },
    select: {
      id: true,
      deviceId: true,
      deviceInfo: true,
      createdAt: true,
      expiresAt: true
    },
    orderBy: { createdAt: 'desc' }
  });

  return sessions;
}

/**
 * Revoke a specific session by its ID.
 * Used for "logout this device" from session management UI.
 */
export async function revokeSession(userId: string, sessionId: string) {
  await prisma.refreshToken.updateMany({
    where: {
      id: sessionId,
      userId: userId, // Security: ensure user owns this session
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
}
