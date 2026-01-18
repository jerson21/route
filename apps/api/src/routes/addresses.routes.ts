import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { AppError } from '../middleware/errorHandler.js';
import { geocodeAddress } from '../services/geocoding.service.js';
import { parseExcelBuffer } from '../services/excel.service.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv'
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos Excel (.xlsx, .xls) o CSV'));
    }
  }
});

router.use(authenticate);

const createAddressSchema = z.object({
  street: z.string().min(3),
  number: z.string().optional(),
  unit: z.string().optional(), // Depto, Casa, Oficina, Local, etc.
  city: z.string().min(2),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().default('México'),
  customerName: z.string().optional(),
  customerPhone: z.string().optional(),
  customerRut: z.string().optional(), // RUT del cliente para verificación de transferencias
  externalOrderId: z.string().optional(), // num_orden del sistema de gestión
  paymentMethod: z.string().optional(), // CASH, CARD, TRANSFER
  notes: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional()
});

const updateLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number()
});

// GET /addresses
router.get('/', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, status, page = '1', limit = '50' } = req.query;

    const where: any = {};

    if (search) {
      where.OR = [
        { fullAddress: { contains: search as string, mode: 'insensitive' } },
        { customerName: { contains: search as string, mode: 'insensitive' } }
      ];
    }

    if (status) {
      where.geocodeStatus = status;
    }

    const [addresses, total] = await Promise.all([
      prisma.address.findMany({
        where,
        skip: (parseInt(page as string) - 1) * parseInt(limit as string),
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.address.count({ where })
    ]);

    res.json({
      success: true,
      data: addresses,
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

// POST /addresses
router.post('/', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createAddressSchema.parse(req.body);

    // Construir fullAddress incluyendo unit si existe
    const streetPart = data.unit
      ? `${data.street} ${data.number || ''}, ${data.unit}`.trim()
      : `${data.street} ${data.number || ''}`.trim();

    const fullAddress = [
      streetPart,
      data.city,
      data.state,
      data.postalCode,
      data.country
    ].filter(Boolean).join(', ');

    const address = await prisma.address.create({
      data: {
        ...data,
        fullAddress,
        geocodeStatus: data.latitude && data.longitude ? 'MANUAL' : 'PENDING',
        isManualLocation: Boolean(data.latitude && data.longitude),
        createdById: req.user!.id
      }
    });

    res.status(201).json({ success: true, data: address });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// POST /addresses/bulk - Import multiple addresses
router.post('/bulk', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { addresses } = req.body;

    if (!Array.isArray(addresses) || addresses.length === 0) {
      throw new AppError(400, 'Se requiere un array de direcciones');
    }

    if (addresses.length > 100) {
      throw new AppError(400, 'Máximo 100 direcciones por importación');
    }

    const createdAddresses = await prisma.$transaction(
      addresses.map((addr: any) => {
        const data = createAddressSchema.parse(addr);

        // Construir fullAddress incluyendo unit si existe
        const streetPart = data.unit
          ? `${data.street} ${data.number || ''}, ${data.unit}`.trim()
          : `${data.street} ${data.number || ''}`.trim();

        const fullAddress = [
          streetPart,
          data.city,
          data.state,
          data.postalCode,
          data.country
        ].filter(Boolean).join(', ');

        return prisma.address.create({
          data: {
            ...data,
            fullAddress,
            geocodeStatus: 'PENDING',
            createdById: req.user!.id
          }
        });
      })
    );

    res.status(201).json({
      success: true,
      data: createdAddresses,
      count: createdAddresses.length
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// POST /addresses/import-excel - Importar desde archivo Excel
router.post('/import-excel', requireRole('ADMIN', 'OPERATOR'), upload.single('file'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.file) {
      throw new AppError(400, 'No se ha enviado ningún archivo');
    }

    const parseResult = parseExcelBuffer(req.file.buffer);

    if (!parseResult.success) {
      throw new AppError(400, parseResult.errors.join(', '));
    }

    if (parseResult.data.length > 100) {
      throw new AppError(400, 'Máximo 100 direcciones por importación');
    }

    // Crear las direcciones en la base de datos
    const createdAddresses = await prisma.$transaction(
      parseResult.data.map((addr) => {
        // Construir fullAddress incluyendo unit si existe
        const streetPart = addr.unit
          ? `${addr.street} ${addr.number || ''}, ${addr.unit}`.trim()
          : `${addr.street} ${addr.number || ''}`.trim();

        const fullAddress = [
          streetPart,
          addr.city,
          addr.state,
          addr.postalCode,
          addr.country
        ].filter(Boolean).join(', ');

        return prisma.address.create({
          data: {
            street: addr.street,
            number: addr.number,
            unit: addr.unit,
            city: addr.city,
            state: addr.state,
            postalCode: addr.postalCode,
            country: addr.country || 'Chile',
            customerName: addr.customerName,
            customerPhone: addr.customerPhone,
            customerRut: addr.customerRut,
            externalOrderId: addr.externalOrderId,
            paymentMethod: addr.paymentMethod,
            notes: addr.notes,
            fullAddress,
            geocodeStatus: 'PENDING',
            createdById: req.user!.id
          }
        });
      })
    );

    res.status(201).json({
      success: true,
      data: createdAddresses,
      count: createdAddresses.length,
      totalRows: parseResult.totalRows,
      errors: parseResult.errors
    });
  } catch (error) {
    next(error);
  }
});

// GET /addresses/:id
router.get('/:id', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = await prisma.address.findUnique({
      where: { id: req.params.id }
    });

    if (!address) {
      throw new AppError(404, 'Dirección no encontrada');
    }

    res.json({ success: true, data: address });
  } catch (error) {
    next(error);
  }
});

// PUT /addresses/:id
router.put('/:id', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createAddressSchema.partial().parse(req.body);

    const address = await prisma.address.update({
      where: { id: req.params.id },
      data
    });

    res.json({ success: true, data: address });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// PUT /addresses/:id/location - Manual location adjustment
router.put('/:id/location', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = updateLocationSchema.parse(req.body);

    const address = await prisma.address.update({
      where: { id: req.params.id },
      data: {
        latitude: data.latitude,
        longitude: data.longitude,
        geocodeStatus: 'MANUAL',
        isManualLocation: true
      }
    });

    res.json({ success: true, data: address });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// POST /addresses/:id/geocode - Geocodificar dirección
router.post('/:id/geocode', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = await prisma.address.findUnique({
      where: { id: req.params.id }
    });

    if (!address) {
      throw new AppError(404, 'Dirección no encontrada');
    }

    const result = await geocodeAddress(address.fullAddress);

    if (result.success) {
      const updated = await prisma.address.update({
        where: { id: req.params.id },
        data: {
          latitude: result.latitude,
          longitude: result.longitude,
          geocodeStatus: 'SUCCESS',
          geocodeSource: 'google'
        }
      });
      res.json({ success: true, data: updated });
    } else {
      await prisma.address.update({
        where: { id: req.params.id },
        data: {
          geocodeStatus: 'FAILED'
        }
      });
      throw new AppError(400, result.error || 'Error al geocodificar');
    }
  } catch (error) {
    next(error);
  }
});

// POST /addresses/geocode-pending - Geocodificar todas las pendientes
router.post('/geocode-pending', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const pending = await prisma.address.findMany({
      where: { geocodeStatus: 'PENDING' },
      take: 50 // Limitar a 50 por request
    });

    const results = {
      total: pending.length,
      success: 0,
      failed: 0
    };

    for (const address of pending) {
      const result = await geocodeAddress(address.fullAddress);

      if (result.success) {
        await prisma.address.update({
          where: { id: address.id },
          data: {
            latitude: result.latitude,
            longitude: result.longitude,
            geocodeStatus: 'SUCCESS',
            geocodeSource: 'google'
          }
        });
        results.success++;
      } else {
        await prisma.address.update({
          where: { id: address.id },
          data: { geocodeStatus: 'FAILED' }
        });
        results.failed++;
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    res.json({ success: true, data: results });
  } catch (error) {
    next(error);
  }
});

// DELETE /addresses/:id
router.delete('/:id', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.address.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Dirección eliminada' });
  } catch (error) {
    next(error);
  }
});

export { router as addressRoutes };
