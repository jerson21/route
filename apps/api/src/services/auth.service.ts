import { prisma } from '../config/database.js';
import { hashPassword, comparePassword } from '../utils/password.js';
import { generateTokens, verifyRefreshToken } from '../utils/jwt.js';
import { AppError } from '../middleware/errorHandler.js';
import type { UserRole } from '@route-optimizer/shared';

interface LoginInput {
  email: string;
  password: string;
}

interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  phone?: string;
}

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

  // Store refresh token
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: tokens.refreshToken, // In production, hash this
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
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
    ...tokens
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

export async function refreshAccessToken(refreshToken: string) {
  try {
    const payload = verifyRefreshToken(refreshToken);

    // Verify token exists in database and not revoked
    const storedToken = await prisma.refreshToken.findFirst({
      where: {
        userId: payload.sub,
        tokenHash: refreshToken,
        revokedAt: null,
        expiresAt: { gt: new Date() }
      },
      include: { user: true }
    });

    if (!storedToken || !storedToken.user.isActive) {
      throw new AppError(401, 'Token de refresh inválido');
    }

    const tokens = generateTokens({
      id: storedToken.user.id,
      email: storedToken.user.email,
      role: storedToken.user.role as UserRole
    });

    // Revocar token viejo y guardar el nuevo en BD
    await prisma.$transaction([
      prisma.refreshToken.update({
        where: { id: storedToken.id },
        data: { revokedAt: new Date() }
      }),
      prisma.refreshToken.create({
        data: {
          userId: storedToken.user.id,
          tokenHash: tokens.refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
        }
      })
    ]);

    return tokens;
  } catch (error) {
    throw new AppError(401, 'Token de refresh inválido');
  }
}

export async function logout(userId: string, refreshToken: string) {
  // Revoke refresh token and clear FCM token in a transaction
  await prisma.$transaction([
    prisma.refreshToken.updateMany({
      where: {
        userId,
        tokenHash: refreshToken
      },
      data: {
        revokedAt: new Date()
      }
    }),
    // Clear FCM token so this device stops receiving notifications for this user
    prisma.user.update({
      where: { id: userId },
      data: { fcmToken: null }
    })
  ]);
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
