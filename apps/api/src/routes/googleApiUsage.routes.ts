import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { GoogleApiType } from '@prisma/client';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  getUsageStats,
  getDailyUsage,
  getUsageLogs,
  getQuickStats,
} from '../services/googleApiTracker.service.js';

const router = Router();

router.use(authenticate);
router.use(requireRole('ADMIN'));

// Query schemas
const dateRangeSchema = z.object({
  startDate: z.string().optional().transform(val => val ? new Date(val) : undefined),
  endDate: z.string().optional().transform(val => val ? new Date(val) : undefined),
  apiType: z.enum(['GEOCODING', 'DIRECTIONS', 'DISTANCE_MATRIX']).optional(),
});

const paginationSchema = z.object({
  page: z.string().optional().transform(val => parseInt(val || '1', 10)),
  limit: z.string().optional().transform(val => parseInt(val || '50', 10)),
  startDate: z.string().optional().transform(val => val ? new Date(val) : undefined),
  endDate: z.string().optional().transform(val => val ? new Date(val) : undefined),
  apiType: z.enum(['GEOCODING', 'DIRECTIONS', 'DISTANCE_MATRIX']).optional(),
  routeId: z.string().optional(),
});

// GET /google-usage/quick-stats - Get quick stats (today, week, month)
router.get('/quick-stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await getQuickStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    next(error);
  }
});

// GET /google-usage/stats - Get aggregated statistics
router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = dateRangeSchema.parse(req.query);

    // Default to last 30 days if no dates provided
    const endDate = params.endDate || new Date();
    const startDate = params.startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const stats = await getUsageStats(startDate, endDate, params.apiType as GoogleApiType);
    res.json({ success: true, data: stats });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// GET /google-usage/daily - Get daily usage for charts
router.get('/daily', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = dateRangeSchema.parse(req.query);

    // Default to last 30 days if no dates provided
    const endDate = params.endDate || new Date();
    const startDate = params.startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    const data = await getDailyUsage(startDate, endDate, params.apiType as GoogleApiType);
    res.json({ success: true, data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// GET /google-usage/logs - Get paginated detailed logs
router.get('/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = paginationSchema.parse(req.query);

    // Validate pagination
    if (params.page < 1) params.page = 1;
    if (params.limit < 1 || params.limit > 100) params.limit = 50;

    const result = await getUsageLogs(params.page, params.limit, {
      startDate: params.startDate,
      endDate: params.endDate,
      apiType: params.apiType as GoogleApiType,
      routeId: params.routeId,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

export { router as googleApiUsageRoutes };
