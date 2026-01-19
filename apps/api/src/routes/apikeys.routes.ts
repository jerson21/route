import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

router.use(authenticate);
router.use(requireRole('ADMIN')); // Solo admins pueden gestionar API keys

// Permisos disponibles
const AVAILABLE_PERMISSIONS = [
  'addresses:read',
  'addresses:write',
  'routes:read',
  'routes:write',
  'users:read',
  '*' // Full access
];

const createApiKeySchema = z.object({
  name: z.string().min(3).max(100),
  permissions: z.array(z.string()).default(['addresses:write', 'routes:read']),
  expiresInDays: z.number().optional() // null = no expira
});

const updateApiKeySchema = z.object({
  name: z.string().min(3).max(100).optional(),
  permissions: z.array(z.string()).optional(),
  isActive: z.boolean().optional()
});

// Generar API key segura
function generateApiKey(): string {
  // Formato: route_xxxxxxxxxxxxxxxxxxxxxxxxxxxx (32 caracteres random)
  const randomPart = crypto.randomBytes(24).toString('base64url');
  return `route_${randomPart}`;
}

// Hash API key
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// GET /api-keys - Listar API keys
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const apiKeys = await prisma.apiKey.findMany({
      where: { createdById: req.user!.id },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        isActive: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      success: true,
      data: apiKeys
    });
  } catch (error) {
    next(error);
  }
});

// POST /api-keys - Crear nueva API key
router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createApiKeySchema.parse(req.body);

    // Validar permisos
    for (const perm of data.permissions) {
      if (!AVAILABLE_PERMISSIONS.includes(perm)) {
        throw new AppError(400, `Permiso inválido: ${perm}. Permisos válidos: ${AVAILABLE_PERMISSIONS.join(', ')}`);
      }
    }

    // Generar key
    const rawKey = generateApiKey();
    const keyHash = hashApiKey(rawKey);
    const keyPrefix = rawKey.substring(0, 10); // route_xxxx

    // Calcular expiración
    let expiresAt: Date | null = null;
    if (data.expiresInDays) {
      expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + data.expiresInDays);
    }

    const apiKey = await prisma.apiKey.create({
      data: {
        name: data.name,
        keyHash,
        keyPrefix,
        permissions: data.permissions,
        expiresAt,
        createdById: req.user!.id
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        expiresAt: true,
        isActive: true,
        createdAt: true
      }
    });

    // IMPORTANTE: La key completa solo se muestra una vez
    res.status(201).json({
      success: true,
      data: {
        ...apiKey,
        key: rawKey // Solo se muestra una vez!
      },
      message: 'API Key creada. Guárdala en un lugar seguro, no se mostrará de nuevo.'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// PUT /api-keys/:id - Actualizar API key
router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = updateApiKeySchema.parse(req.body);

    // Verificar que la key pertenece al usuario
    const existing = await prisma.apiKey.findFirst({
      where: {
        id: req.params.id,
        createdById: req.user!.id
      }
    });

    if (!existing) {
      throw new AppError(404, 'API Key no encontrada');
    }

    // Validar permisos si se proporcionan
    if (data.permissions) {
      for (const perm of data.permissions) {
        if (!AVAILABLE_PERMISSIONS.includes(perm)) {
          throw new AppError(400, `Permiso inválido: ${perm}`);
        }
      }
    }

    const apiKey = await prisma.apiKey.update({
      where: { id: req.params.id },
      data: {
        name: data.name,
        permissions: data.permissions,
        isActive: data.isActive
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        permissions: true,
        lastUsedAt: true,
        expiresAt: true,
        isActive: true,
        createdAt: true
      }
    });

    res.json({
      success: true,
      data: apiKey
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// DELETE /api-keys/:id - Revocar API key
router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Verificar que la key pertenece al usuario
    const existing = await prisma.apiKey.findFirst({
      where: {
        id: req.params.id,
        createdById: req.user!.id
      }
    });

    if (!existing) {
      throw new AppError(404, 'API Key no encontrada');
    }

    await prisma.apiKey.delete({
      where: { id: req.params.id }
    });

    res.json({
      success: true,
      message: 'API Key revocada correctamente'
    });
  } catch (error) {
    next(error);
  }
});

// GET /api-keys/permissions - Listar permisos disponibles
router.get('/permissions', async (req: Request, res: Response) => {
  res.json({
    success: true,
    data: AVAILABLE_PERMISSIONS.map(perm => ({
      value: perm,
      description: getPermissionDescription(perm)
    }))
  });
});

function getPermissionDescription(perm: string): string {
  const descriptions: Record<string, string> = {
    'addresses:read': 'Leer direcciones',
    'addresses:write': 'Crear, actualizar y eliminar direcciones',
    'routes:read': 'Leer rutas y paradas',
    'routes:write': 'Crear, actualizar y eliminar rutas',
    'users:read': 'Leer información de usuarios',
    '*': 'Acceso completo a todos los recursos'
  };
  return descriptions[perm] || perm;
}

export { router as apiKeysRoutes };
