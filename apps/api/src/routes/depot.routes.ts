import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

router.use(authenticate);

const createDepotSchema = z.object({
  name: z.string().min(2),
  address: z.string().min(5),
  latitude: z.number(),
  longitude: z.number(),
  isDefault: z.boolean().optional(),
  defaultDepartureTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional().default('08:00'),
  defaultServiceMinutes: z.number().min(1).max(120).optional().default(15)
});

const updateDepotSchema = z.object({
  name: z.string().min(2).optional(),
  address: z.string().min(5).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  defaultDepartureTime: z.string().regex(/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/).optional(),
  defaultServiceMinutes: z.number().min(1).max(120).optional()
});

// GET /depots - List all depots
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const depots = await prisma.depot.findMany({
      where: { isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }]
    });

    res.json({ success: true, data: depots });
  } catch (error) {
    next(error);
  }
});

// GET /depots/default - Get default depot
router.get('/default', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const depot = await prisma.depot.findFirst({
      where: { isDefault: true, isActive: true }
    });

    res.json({ success: true, data: depot });
  } catch (error) {
    next(error);
  }
});

// GET /depots/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const depot = await prisma.depot.findUnique({
      where: { id: req.params.id }
    });

    if (!depot) {
      throw new AppError(404, 'Depot no encontrado');
    }

    res.json({ success: true, data: depot });
  } catch (error) {
    next(error);
  }
});

// POST /depots - Create depot
router.post('/', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createDepotSchema.parse(req.body);

    // Si es default, quitar default de los demas
    if (data.isDefault) {
      await prisma.depot.updateMany({
        where: { isDefault: true },
        data: { isDefault: false }
      });
    }

    // Si es el primer depot, hacerlo default
    const existingCount = await prisma.depot.count();
    const isDefault = data.isDefault ?? existingCount === 0;

    const depot = await prisma.depot.create({
      data: {
        ...data,
        isDefault
      }
    });

    res.status(201).json({ success: true, data: depot });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// PUT /depots/:id - Update depot
router.put('/:id', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = updateDepotSchema.parse(req.body);

    const existing = await prisma.depot.findUnique({
      where: { id: req.params.id }
    });

    if (!existing) {
      throw new AppError(404, 'Depot no encontrado');
    }

    // Si se esta marcando como default, quitar default de los demas
    if (data.isDefault) {
      await prisma.depot.updateMany({
        where: { isDefault: true, id: { not: req.params.id } },
        data: { isDefault: false }
      });
    }

    const depot = await prisma.depot.update({
      where: { id: req.params.id },
      data
    });

    res.json({ success: true, data: depot });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// DELETE /depots/:id - Soft delete depot
router.delete('/:id', requireRole('ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const depot = await prisma.depot.findUnique({
      where: { id: req.params.id }
    });

    if (!depot) {
      throw new AppError(404, 'Depot no encontrado');
    }

    // Verificar si tiene rutas asociadas
    const routesCount = await prisma.route.count({
      where: { depotId: req.params.id }
    });

    if (routesCount > 0) {
      // Soft delete
      await prisma.depot.update({
        where: { id: req.params.id },
        data: { isActive: false }
      });
    } else {
      // Hard delete si no tiene rutas
      await prisma.depot.delete({
        where: { id: req.params.id }
      });
    }

    res.json({ success: true, message: 'Depot eliminado' });
  } catch (error) {
    next(error);
  }
});

export { router as depotRoutes };
