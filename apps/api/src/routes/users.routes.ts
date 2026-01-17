import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { hashPassword } from '../utils/password.js';
import { AppError } from '../middleware/errorHandler.js';
import * as notificationService from '../services/notification.service.js';

const router = Router();

// All routes require authentication
router.use(authenticate);

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  firstName: z.string().min(2),
  lastName: z.string().min(2),
  role: z.enum(['ADMIN', 'OPERATOR', 'DRIVER']),
  phone: z.string().optional()
});

const updateUserSchema = z.object({
  firstName: z.string().min(2).optional(),
  lastName: z.string().min(2).optional(),
  role: z.enum(['ADMIN', 'OPERATOR', 'DRIVER']).optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional()
});

// GET /users - List all users (Admin only)
router.get('/', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { role, search, page = '1', limit = '20' } = req.query;

    const where: any = {};

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { firstName: { contains: search as string, mode: 'insensitive' } },
        { lastName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          phone: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true
        },
        skip: (parseInt(page as string) - 1) * parseInt(limit as string),
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.user.count({ where })
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: parseInt(page as string),
        limit: parseInt(limit as string),
        total,
        pages: Math.ceil(total / parseInt(limit as string))
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /users/drivers - List only active drivers (Admin, Operator)
router.get('/drivers', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const drivers = await prisma.user.findMany({
      where: {
        role: 'DRIVER',
        isActive: true
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true
      },
      orderBy: { firstName: 'asc' }
    });

    res.json({ success: true, data: drivers });
  } catch (error) {
    next(error);
  }
});

// GET /users/connected - Get users with active sessions (valid refresh tokens)
// IMPORTANT: This must be before /:id route to avoid matching "connected" as an id
router.get('/connected', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Find users with at least one valid (non-revoked, non-expired) refresh token
    const activeUsers = await prisma.user.findMany({
      where: {
        isActive: true,
        refreshTokens: {
          some: {
            revokedAt: null,
            expiresAt: { gt: new Date() }
          }
        }
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        fcmToken: true,
        lastLoginAt: true,
        refreshTokens: {
          where: {
            revokedAt: null,
            expiresAt: { gt: new Date() }
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true }
        }
      },
      orderBy: { lastLoginAt: 'desc' }
    });

    res.json({
      success: true,
      data: activeUsers.map(user => ({
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        email: user.email,
        role: user.role,
        hasFcmToken: !!user.fcmToken,
        tokenPreview: user.fcmToken ? `${user.fcmToken.substring(0, 20)}...` : null,
        lastLogin: user.lastLoginAt,
        lastTokenRefresh: user.refreshTokens[0]?.createdAt || null
      })),
      total: activeUsers.length
    });
  } catch (error) {
    next(error);
  }
});

// GET /users/:id
router.get('/:id', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true
      }
    });

    if (!user) {
      throw new AppError(404, 'Usuario no encontrado');
    }

    res.json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
});

// POST /users - Create user (Admin only)
router.post('/', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createUserSchema.parse(req.body);

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() }
    });

    if (existingUser) {
      throw new AppError(400, 'El email ya está registrado');
    }

    const passwordHash = await hashPassword(data.password);

    const user = await prisma.user.create({
      data: {
        email: data.email.toLowerCase(),
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        role: data.role,
        phone: data.phone
      },
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

    res.status(201).json({ success: true, data: user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// PUT /users/:id
router.put('/:id', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = updateUserSchema.parse(req.body);

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        phone: true,
        isActive: true
      }
    });

    res.json({ success: true, data: user });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// DELETE /users/:id (soft delete)
router.delete('/:id', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Prevent self-deletion
    if (req.params.id === req.user!.id) {
      throw new AppError(400, 'No puedes eliminar tu propia cuenta');
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false }
    });

    res.json({ success: true, message: 'Usuario desactivado' });
  } catch (error) {
    next(error);
  }
});

// GET /users/:id/preferences - Get user preferences (user can see own, admin can see all)
router.get('/:id/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetUserId = req.params.id;

    // Users can only see their own preferences, admin can see all
    if (req.user!.role !== 'ADMIN' && req.user!.id !== targetUserId) {
      throw new AppError(403, 'No tienes permiso para ver estas preferencias');
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, preferences: true }
    });

    if (!user) {
      throw new AppError(404, 'Usuario no encontrado');
    }

    // Default preferences if none set
    const defaultPreferences = {
      autoNavigateAfterDelivery: true,
      autoNavigateExcludesPOD: true,
      navigationApp: 'google_maps', // google_maps | waze | apple_maps
      soundEnabled: true,
      vibrationEnabled: true,
      keepScreenOn: true,
      arrivalAlertIntrusive: false // false = notificación no intrusiva al llegar
    };

    const preferences = user.preferences
      ? { ...defaultPreferences, ...(user.preferences as object) }
      : defaultPreferences;

    res.json({ success: true, data: preferences });
  } catch (error) {
    next(error);
  }
});

// PATCH /users/:id/preferences - Update user preferences (user can update own, admin can update all)
router.patch('/:id/preferences', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const targetUserId = req.params.id;

    // Users can only update their own preferences, admin can update all
    if (req.user!.role !== 'ADMIN' && req.user!.id !== targetUserId) {
      throw new AppError(403, 'No tienes permiso para modificar estas preferencias');
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, preferences: true }
    });

    if (!user) {
      throw new AppError(404, 'Usuario no encontrado');
    }

    // Validate incoming preferences
    const allowedKeys = [
      'autoNavigateAfterDelivery',
      'autoNavigateExcludesPOD',
      'navigationApp',
      'soundEnabled',
      'vibrationEnabled',
      'keepScreenOn',
      'arrivalAlertIntrusive'
    ];

    const newPreferences = req.body;

    // Filter only allowed keys
    const filteredPreferences: Record<string, any> = {};
    for (const key of allowedKeys) {
      if (key in newPreferences) {
        filteredPreferences[key] = newPreferences[key];
      }
    }

    // Merge with existing preferences
    const currentPreferences = (user.preferences as object) || {};
    const mergedPreferences = { ...currentPreferences, ...filteredPreferences };

    // Update user
    const updatedUser = await prisma.user.update({
      where: { id: targetUserId },
      data: { preferences: mergedPreferences },
      select: { id: true, preferences: true }
    });

    // Notify the user if their preferences were changed by someone else (admin)
    // This allows the Android app to reload preferences without re-login
    if (req.user!.id !== targetUserId) {
      notificationService.notifyPreferencesUpdated(targetUserId);
    }

    res.json({ success: true, data: updatedUser.preferences });
  } catch (error) {
    next(error);
  }
});

// POST /users/:id/notify - Send push notification to user (Admin, Operator)
const notifySchema = z.object({
  title: z.string().min(1, 'Título requerido').max(100),
  body: z.string().min(1, 'Mensaje requerido').max(500),
  data: z.record(z.string()).optional() // Optional custom data
});

router.post('/:id/notify', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, body, data } = notifySchema.parse(req.body);
    const targetUserId = req.params.id;

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, firstName: true, fcmToken: true }
    });

    if (!user) {
      throw new AppError(404, 'Usuario no encontrado');
    }

    if (!user.fcmToken) {
      throw new AppError(400, 'El usuario no tiene notificaciones habilitadas');
    }

    // Send notification with type 'message' for Android to handle
    const success = await notificationService.sendToUser(targetUserId, {
      title,
      body,
      data: {
        type: 'message',
        message: body,
        senderName: title, // The title often contains sender info
        timestamp: new Date().toISOString(),
        ...(data || {})
      }
    });

    if (!success) {
      throw new AppError(500, 'Error al enviar la notificación');
    }

    res.json({ success: true, message: 'Notificación enviada' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

export { router as userRoutes };
