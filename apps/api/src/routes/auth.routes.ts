import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as authService from '../services/auth.service.js';
import * as notificationService from '../services/notification.service.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  deviceId: z.string().optional(),
  deviceInfo: z.string().optional()
});

const registerSchema = z.object({
  email: z.string().email('Email inválido'),
  password: z.string().min(6, 'La contraseña debe tener al menos 6 caracteres'),
  firstName: z.string().min(2, 'Nombre requerido'),
  lastName: z.string().min(2, 'Apellido requerido'),
  role: z.enum(['ADMIN', 'OPERATOR', 'DRIVER']).optional(),
  phone: z.string().optional()
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token requerido'),
  deviceId: z.string().optional()
});

const logoutSchema = z.object({
  refreshToken: z.string().optional(),
  logoutAll: z.boolean().optional()
});

// POST /auth/login
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = loginSchema.parse(req.body);
    const result = await authService.login(data);
    res.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// POST /auth/register (admin only in production)
router.post('/register', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = registerSchema.parse(req.body);
    const user = await authService.register(data);
    res.status(201).json({ success: true, data: user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// POST /auth/refresh
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = refreshSchema.parse(req.body);
    const tokens = await authService.refreshAccessToken(data);
    res.json({ success: true, data: tokens });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// POST /auth/logout
router.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = logoutSchema.parse(req.body);
    await authService.logout({
      userId: req.user!.id,
      refreshToken: data.refreshToken,
      logoutAll: data.logoutAll
    });
    res.json({ success: true, message: 'Sesión cerrada' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// GET /auth/me
router.get('/me', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await authService.getCurrentUser(req.user!.id);
    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// GET /auth/sessions - Get all active sessions for current user
router.get('/sessions', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const sessions = await authService.getActiveSessions(req.user!.id);
    res.json({ success: true, data: sessions });
  } catch (error) {
    next(error);
  }
});

// DELETE /auth/sessions/:id - Revoke a specific session
router.delete('/sessions/:id', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await authService.revokeSession(req.user!.id, req.params.id);
    res.json({ success: true, message: 'Sesión revocada' });
  } catch (error) {
    next(error);
  }
});

// POST /auth/fcm-token - Save FCM token for push notifications
// Accepts both { token: "..." } and { fcmToken: "..." } for compatibility
const fcmTokenSchema = z.object({
  token: z.string().min(10, 'Token inválido').optional(),
  fcmToken: z.string().min(10, 'Token inválido').optional()
}).refine(data => data.token || data.fcmToken, {
  message: 'Se requiere token o fcmToken'
});

router.post('/fcm-token', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = fcmTokenSchema.parse(req.body);
    const token = data.token || data.fcmToken!;
    await notificationService.saveFcmToken(req.user!.id, token);
    res.json({ success: true, message: 'Token guardado' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// DELETE /auth/fcm-token - Remove FCM token (on logout from device)
router.delete('/fcm-token', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await notificationService.removeFcmToken(req.user!.id);
    res.json({ success: true, message: 'Token eliminado' });
  } catch (error) {
    next(error);
  }
});

export { router as authRoutes };
