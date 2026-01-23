import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { AppError } from '../middleware/errorHandler.js';
import { sendWebhook } from '../services/webhookService.js';

const router = Router();

router.use(authenticate);

// Settings keys
const WEBHOOK_SETTINGS_KEY = 'webhook';
const NOTIFICATIONS_SETTINGS_KEY = 'notifications';
const DELIVERY_SETTINGS_KEY = 'delivery';

// Schemas
const webhookSettingsSchema = z.object({
  url: z.string().url().nullable().optional(),
  enabled: z.boolean().optional(),
  secret: z.string().nullable().optional()
});

const notificationsSettingsSchema = z.object({
  etaWindowBefore: z.number().min(0).max(120).optional(),
  etaWindowAfter: z.number().min(0).max(180).optional()
});

const deliverySettingsSchema = z.object({
  requireSignature: z.boolean().optional(),
  requirePhoto: z.boolean().optional(),
  proofEnabled: z.boolean().optional(),
  serviceMinutes: z.number().min(1).max(120).optional()
});

// GET /settings/webhook - Get webhook settings
router.get('/webhook', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const setting = await prisma.settings.findUnique({
      where: { key: WEBHOOK_SETTINGS_KEY }
    });

    const defaultValue = {
      url: null,
      enabled: false,
      secret: null
    };

    res.json({
      success: true,
      data: setting?.value || defaultValue
    });
  } catch (error) {
    next(error);
  }
});

// PUT /settings/webhook - Update webhook settings
router.put('/webhook', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = webhookSettingsSchema.parse(req.body);

    // Validate URL if provided
    if (data.url) {
      try {
        new URL(data.url);
      } catch {
        throw new AppError(400, 'URL de webhook invalida');
      }
    }

    const setting = await prisma.settings.upsert({
      where: { key: WEBHOOK_SETTINGS_KEY },
      update: { value: data as any },
      create: { key: WEBHOOK_SETTINGS_KEY, value: data as any }
    });

    res.json({ success: true, data: setting.value });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// POST /settings/webhook/test - Test webhook
router.post('/webhook/test', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const setting = await prisma.settings.findUnique({
      where: { key: WEBHOOK_SETTINGS_KEY }
    });

    const webhookConfig = setting?.value as { url?: string; secret?: string } | null;

    if (!webhookConfig?.url) {
      throw new AppError(400, 'Webhook URL no configurada');
    }

    const testPayload = {
      event: 'test' as const,
      timestamp: new Date().toISOString(),
      route: {
        id: 'test-route-id',
        name: 'Ruta de Prueba',
        status: 'IN_PROGRESS',
      },
      driver: {
        id: 'test-driver-id',
        name: 'Conductor de Prueba',
      },
      stop: {
        id: 'test-stop-id',
        sequenceOrder: 1,
        address: 'Direccion de Prueba, Santiago',
        status: 'COMPLETED',
        estimatedArrival: new Date().toISOString(),
      },
      metadata: {
        isTest: true,
      },
    };

    const result = await sendWebhook(
      webhookConfig.url,
      testPayload as any,
      webhookConfig.secret || null,
      1
    );

    if (result.success) {
      res.json({
        success: true,
        message: 'Webhook de prueba enviado correctamente',
        statusCode: result.statusCode
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'Error al enviar webhook de prueba',
        error: result.error,
        statusCode: result.statusCode
      });
    }
  } catch (error) {
    next(error);
  }
});

// GET /settings/notifications - Get notification settings
router.get('/notifications', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const setting = await prisma.settings.findUnique({
      where: { key: NOTIFICATIONS_SETTINGS_KEY }
    });

    const defaultValue = {
      etaWindowBefore: 20,
      etaWindowAfter: 60
    };

    res.json({
      success: true,
      data: setting?.value || defaultValue
    });
  } catch (error) {
    next(error);
  }
});

// PUT /settings/notifications - Update notification settings
router.put('/notifications', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = notificationsSettingsSchema.parse(req.body);

    const setting = await prisma.settings.upsert({
      where: { key: NOTIFICATIONS_SETTINGS_KEY },
      update: { value: data as any },
      create: { key: NOTIFICATIONS_SETTINGS_KEY, value: data as any }
    });

    res.json({ success: true, data: setting.value });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// GET /settings/delivery - Get delivery default settings
router.get('/delivery', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const setting = await prisma.settings.findUnique({
      where: { key: DELIVERY_SETTINGS_KEY }
    });

    // Get serviceMinutes from the default depot (this is what optimization actually uses)
    const defaultDepot = await prisma.depot.findFirst({
      where: { isDefault: true, isActive: true },
      select: { defaultServiceMinutes: true }
    });

    const settingValue = setting?.value as { requireSignature?: boolean; requirePhoto?: boolean; proofEnabled?: boolean; serviceMinutes?: number } | null;

    const data = {
      requireSignature: settingValue?.requireSignature ?? false,
      requirePhoto: settingValue?.requirePhoto ?? false,
      proofEnabled: settingValue?.proofEnabled ?? true,
      // Use depot's value as source of truth for serviceMinutes
      serviceMinutes: defaultDepot?.defaultServiceMinutes ?? settingValue?.serviceMinutes ?? 15
    };

    res.json({
      success: true,
      data
    });
  } catch (error) {
    next(error);
  }
});

// PUT /settings/delivery - Update delivery default settings
router.put('/delivery', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = deliverySettingsSchema.parse(req.body);

    const setting = await prisma.settings.upsert({
      where: { key: DELIVERY_SETTINGS_KEY },
      update: { value: data as any },
      create: { key: DELIVERY_SETTINGS_KEY, value: data as any }
    });

    // Also update the default depot's serviceMinutes if provided
    // This ensures the optimization uses the updated value
    if (data.serviceMinutes !== undefined) {
      const defaultDepot = await prisma.depot.findFirst({
        where: { isDefault: true, isActive: true }
      });

      if (defaultDepot) {
        await prisma.depot.update({
          where: { id: defaultDepot.id },
          data: { defaultServiceMinutes: data.serviceMinutes }
        });
        console.log(`[SETTINGS] Updated default depot (${defaultDepot.name}) serviceMinutes to ${data.serviceMinutes}`);
      }
    }

    res.json({ success: true, data: setting.value });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// Helper function to get webhook config (used by other services)
export async function getWebhookConfig(): Promise<{ url: string | null; enabled: boolean; secret: string | null }> {
  const setting = await prisma.settings.findUnique({
    where: { key: WEBHOOK_SETTINGS_KEY }
  });

  const config = setting?.value as { url?: string; enabled?: boolean; secret?: string } | null;

  return {
    url: config?.url || null,
    enabled: config?.enabled || false,
    secret: config?.secret || null
  };
}

// Helper function to get notification config
export async function getNotificationConfig(): Promise<{ etaWindowBefore: number; etaWindowAfter: number }> {
  const setting = await prisma.settings.findUnique({
    where: { key: NOTIFICATIONS_SETTINGS_KEY }
  });

  const config = setting?.value as { etaWindowBefore?: number; etaWindowAfter?: number } | null;

  return {
    etaWindowBefore: config?.etaWindowBefore ?? 30,
    etaWindowAfter: config?.etaWindowAfter ?? 30
  };
}

export { router as settingsRoutes };
