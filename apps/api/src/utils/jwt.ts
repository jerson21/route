import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import type { UserRole } from '@route-optimizer/shared';

const ACCESS_TOKEN_EXPIRY = '4h';
const REFRESH_TOKEN_EXPIRY = '7d';

interface TokenPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export function generateAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, process.env.JWT_ACCESS_SECRET!, {
    expiresIn: ACCESS_TOKEN_EXPIRY
  });
}

export function generateRefreshToken(userId: string): string {
  return jwt.sign(
    { sub: userId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET!,
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}

export function verifyRefreshToken(token: string): { sub: string } {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as { sub: string };
}

export function generateTokens(user: { id: string; email: string; role: UserRole }) {
  const accessToken = generateAccessToken({
    sub: user.id,
    email: user.email,
    role: user.role
  });

  const refreshToken = generateRefreshToken(user.id);

  return { accessToken, refreshToken };
}

/**
 * Hash a refresh token for secure storage in the database.
 * Uses SHA-256 which is fast and suitable for tokens (unlike passwords which need bcrypt).
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a unique device ID for session tracking.
 * This allows multiple devices to have separate sessions.
 */
export function generateDeviceId(): string {
  return crypto.randomUUID();
}
