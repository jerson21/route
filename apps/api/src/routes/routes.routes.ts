import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { AppError } from '../middleware/errorHandler.js';
import { optimizeRouteWithTimeWindows, optimizeRouteWith2Opt } from '../services/vrpOptimizer.js';
import { recalculateETAs, sendStopCompletedWebhook } from '../services/etaRecalculationService.js';
import {
  sendWebhook,
  buildRoutePayload,
  buildDriverPayload,
  buildStopWithWindowPayload,
  buildStopPayload,
  WebhookPayload,
} from '../services/webhookService.js';
import { getWebhookConfig, getNotificationConfig } from './settings.routes.js';
import { addRouteConnection, removeRouteConnection, broadcastToRoute, sendHeartbeat } from '../services/sse.service.js';
import * as notificationService from '../services/notification.service.js';
import { geocodeAddress } from '../services/geocoding.service.js';
import { calculateEtaWindow, formatTimeHHMM } from '../utils/timeUtils.js';

const router = Router();

// GET /routes/:id/events - SSE endpoint for real-time updates
// IMPORTANT: This must be BEFORE router.use(authenticate) because EventSource doesn't support headers
// Token is passed via query param instead
router.get('/:id/events', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const routeId = req.params.id;

    // Handle auth via query param since EventSource doesn't support headers
    let user: { id: string; email: string; role: string } | null = null;

    if (req.query.token) {
      try {
        const token = req.query.token as string;
        const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as { sub: string; role: string };
        const dbUser = await prisma.user.findUnique({
          where: { id: payload.sub },
          select: { id: true, role: true, isActive: true }
        });
        if (dbUser && dbUser.isActive) {
          user = { id: dbUser.id, email: '', role: dbUser.role };
        }
      } catch (e) {
        res.status(401).json({ error: 'Token inválido' });
        return;
      }
    }

    if (!user) {
      res.status(401).json({ error: 'Token requerido' });
      return;
    }

    // Verify route exists and user has access
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      select: { id: true, assignedToId: true, status: true }
    });

    if (!route) {
      res.status(404).json({ error: 'Ruta no encontrada' });
      return;
    }

    // Drivers can only watch their own routes
    if (user.role === 'DRIVER' && route.assignedToId !== user.id) {
      res.status(403).json({ error: 'No tienes acceso a esta ruta' });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ routeId, status: route.status })}\n\n`);

    // Add this connection to the route's listeners
    addRouteConnection(routeId, res);

    // Send heartbeat every 30 seconds to keep connection alive
    const heartbeatInterval = setInterval(() => {
      sendHeartbeat(routeId);
    }, 30000);

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(heartbeatInterval);
      removeRouteConnection(routeId, res);
    });

  } catch (error) {
    next(error);
  }
});

router.use(authenticate);

const createRouteSchema = z.object({
  name: z.string().min(3),
  description: z.string().optional(),
  scheduledDate: z.string().datetime().optional(),
  depotId: z.string().uuid().optional(),
  originLatitude: z.number().optional(),
  originLongitude: z.number().optional(),
  originAddress: z.string().optional()
});

const addStopsSchema = z.object({
  addressIds: z.array(z.string().uuid())
});

// GET /routes - List routes
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, driverId, date, page = '1', limit = '20' } = req.query;

    const where: any = {};

    // Drivers can only see their own routes that have been sent to them
    if (req.user!.role === 'DRIVER') {
      where.assignedToId = req.user!.id;
      where.sentAt = { not: null }; // Solo rutas enviadas
    } else if (driverId) {
      where.assignedToId = driverId;
    }

    if (status) {
      where.status = status;
    }

    if (date) {
      const targetDate = new Date(date as string);
      where.scheduledDate = {
        gte: new Date(targetDate.setHours(0, 0, 0, 0)),
        lt: new Date(targetDate.setHours(23, 59, 59, 999))
      };
    }

    const [routes, total] = await Promise.all([
      prisma.route.findMany({
        where,
        include: {
          assignedTo: {
            select: { id: true, firstName: true, lastName: true }
          },
          depot: {
            select: { id: true, name: true }
          },
          _count: { select: { stops: true } }
        },
        skip: (parseInt(page as string) - 1) * parseInt(limit as string),
        take: parseInt(limit as string),
        orderBy: { createdAt: 'desc' }
      }),
      prisma.route.count({ where })
    ]);

    res.json({
      success: true,
      data: routes,
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

// GET /routes/active - Obtener la ruta activa del conductor autenticado
router.get('/active', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Buscar ruta activa (IN_PROGRESS o PAUSED) del usuario que haya sido enviada
    const activeRoute = await prisma.route.findFirst({
      where: {
        assignedToId: req.user!.id,
        status: { in: ['IN_PROGRESS', 'PAUSED'] },
        sentAt: { not: null } // Solo rutas enviadas
      },
      include: {
        depot: { select: { id: true, name: true, address: true, latitude: true, longitude: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        },
        _count: { select: { stops: true } }
      }
    });

    res.json({
      success: true,
      data: activeRoute || null
    });
  } catch (error) {
    next(error);
  }
});

// GET /routes/driver-dashboard - Dashboard para conductores con rutas organizadas
router.get('/driver-dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const routeInclude = {
      depot: { select: { id: true, name: true, address: true, latitude: true, longitude: true } },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
      stops: {
        include: { address: true },
        orderBy: { sequenceOrder: 'asc' as const }
      },
      _count: { select: { stops: true } }
    };

    // Buscar ruta activa (IN_PROGRESS o PAUSED) que haya sido enviada
    const activeRoute = await prisma.route.findFirst({
      where: {
        assignedToId: userId,
        status: { in: ['IN_PROGRESS', 'PAUSED'] },
        sentAt: { not: null } // Solo rutas enviadas
      },
      include: routeInclude
    });

    // Rutas de hoy (SCHEDULED) que han sido enviadas - excluyendo la activa si existe
    const todayRoutes = await prisma.route.findMany({
      where: {
        assignedToId: userId,
        status: 'SCHEDULED', // Solo SCHEDULED (ya enviadas y optimizadas)
        sentAt: { not: null }, // Solo rutas enviadas
        scheduledDate: {
          gte: today,
          lt: tomorrow
        },
        ...(activeRoute ? { id: { not: activeRoute.id } } : {})
      },
      include: routeInclude,
      orderBy: { scheduledDate: 'asc' }
    });

    // Rutas próximas (futuras, no hoy) que han sido enviadas
    const upcomingRoutes = await prisma.route.findMany({
      where: {
        assignedToId: userId,
        status: 'SCHEDULED', // Solo SCHEDULED (ya enviadas)
        sentAt: { not: null }, // Solo rutas enviadas
        scheduledDate: {
          gte: tomorrow
        }
      },
      include: {
        depot: { select: { id: true, name: true } },
        _count: { select: { stops: true } }
      },
      orderBy: { scheduledDate: 'asc' },
      take: 5
    });

    // Rutas pasadas (completadas o de días anteriores)
    const pastRoutes = await prisma.route.findMany({
      where: {
        assignedToId: userId,
        OR: [
          { status: 'COMPLETED' },
          { status: 'CANCELLED' },
          {
            scheduledDate: { lt: today },
            status: { notIn: ['IN_PROGRESS', 'PAUSED'] }
          }
        ]
      },
      include: {
        depot: { select: { id: true, name: true } },
        _count: { select: { stops: true } }
      },
      orderBy: { scheduledDate: 'desc' },
      take: 10
    });

    res.json({
      success: true,
      data: {
        activeRoute,
        todayRoutes,
        upcomingRoutes,
        pastRoutes,
        hasActiveRoute: !!activeRoute
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /routes/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: {
        createdBy: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true, phone: true } },
        depot: { select: { id: true, name: true, address: true, latitude: true, longitude: true, defaultDepartureTime: true, defaultServiceMinutes: true, etaWindowBefore: true, etaWindowAfter: true } },
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        }
      }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Drivers can only see their own routes
    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No tienes acceso a esta ruta');
    }

    // Calculate ETA window for each stop using depot configuration
    const windowBefore = route.depot?.etaWindowBefore ?? 30;
    const windowAfter = route.depot?.etaWindowAfter ?? 30;

    const stopsWithEtaWindow = route.stops.map(stop => {
      if (stop.estimatedArrival) {
        const { etaWindowStart, etaWindowEnd } = calculateEtaWindow(
          stop.estimatedArrival,
          windowBefore,
          windowAfter
        );
        return {
          ...stop,
          etaWindowStart,
          etaWindowEnd
        };
      }
      return stop;
    });

    res.json({
      success: true,
      data: {
        ...route,
        stops: stopsWithEtaWindow
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /routes - Create route
router.post('/', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createRouteSchema.parse(req.body);

    // Si se proporciona depotId, obtener las coordenadas del depot
    let depotData = {};
    if (data.depotId) {
      const depot = await prisma.depot.findUnique({ where: { id: data.depotId } });
      if (depot) {
        depotData = {
          depotId: depot.id,
          originAddress: depot.address,
          originLatitude: depot.latitude,
          originLongitude: depot.longitude
        };
      }
    }

    const route = await prisma.route.create({
      data: {
        name: data.name,
        description: data.description,
        scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
        originLatitude: data.originLatitude,
        originLongitude: data.originLongitude,
        originAddress: data.originAddress,
        ...depotData,
        createdById: req.user!.id
      },
      include: {
        depot: { select: { id: true, name: true, address: true, latitude: true, longitude: true } }
      }
    });

    res.status(201).json({ success: true, data: route });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// Schema para crear ruta completa con paradas
const createCompleteRouteSchema = z.object({
  // Datos de la ruta
  name: z.string().min(3),
  description: z.string().optional(),
  scheduledDate: z.string().datetime().optional(),
  depotId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(), // Asignar conductor directamente
  // Paradas con datos de dirección inline
  stops: z.array(z.object({
    // Datos de dirección (obligatorios)
    street: z.string().min(3),
    city: z.string().min(2),
    // Datos de dirección (opcionales)
    number: z.string().optional(),
    unit: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().default('Chile'),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    // Datos del cliente
    customerName: z.string().optional(),
    customerPhone: z.string().optional(),
    customerRut: z.string().optional(),
    // Datos del pedido
    externalOrderId: z.string().optional(), // num_orden del sistema de gestión
    products: z.string().optional(), // JSON string o descripción de productos
    packageCount: z.number().default(1),
    orderNotes: z.string().optional(),
    // Pago
    paymentMethod: z.enum(['CASH', 'CARD', 'TRANSFER']).optional(),
    paymentAmount: z.number().optional(),
    isPaid: z.boolean().default(false),
    // Configuración de parada
    estimatedMinutes: z.number().default(15),
    requireSignature: z.boolean().default(false),
    requirePhoto: z.boolean().default(false),
    timeWindowStart: z.string().datetime().optional(),
    timeWindowEnd: z.string().datetime().optional()
  })).min(1)
});

// POST /routes/create-complete - Crear ruta con paradas en una sola llamada
// Este endpoint es ideal para integraciones externas (PHP, etc.)
router.post('/create-complete', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = createCompleteRouteSchema.parse(req.body);

    // Obtener datos del depot si se proporciona
    let depotData: {
      depotId?: string;
      originAddress?: string;
      originLatitude?: number;
      originLongitude?: number;
    } = {};
    if (data.depotId) {
      const depot = await prisma.depot.findUnique({ where: { id: data.depotId } });
      if (depot) {
        depotData = {
          depotId: depot.id,
          originAddress: depot.address,
          originLatitude: depot.latitude,
          originLongitude: depot.longitude
        };
      }
    }

    // Crear todo en una transacción
    const result = await prisma.$transaction(async (tx) => {
      // 1. Crear la ruta
      const route = await tx.route.create({
        data: {
          name: data.name,
          description: data.description,
          scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null,
          assignedToId: data.assignedToId,
          createdById: req.user!.id,
          ...depotData
        }
      });

      // 2. Crear direcciones y paradas
      const stopsWithAddresses = [];
      for (let i = 0; i < data.stops.length; i++) {
        const stopData = data.stops[i];

        // Construir fullAddress
        const fullAddress = [
          stopData.street,
          stopData.number,
          stopData.unit,
          stopData.city,
          stopData.state,
          stopData.country
        ].filter(Boolean).join(', ');

        // Crear dirección
        const address = await tx.address.create({
          data: {
            street: stopData.street,
            number: stopData.number,
            unit: stopData.unit,
            city: stopData.city,
            state: stopData.state,
            postalCode: stopData.postalCode,
            country: stopData.country,
            fullAddress,
            latitude: stopData.latitude,
            longitude: stopData.longitude,
            geocodeStatus: stopData.latitude && stopData.longitude ? 'SUCCESS' : 'PENDING',
            customerName: stopData.customerName,
            customerPhone: stopData.customerPhone,
            customerRut: stopData.customerRut,
            externalOrderId: stopData.externalOrderId,
            paymentMethod: stopData.paymentMethod,
            createdById: req.user!.id
          }
        });

        // Crear parada
        const stop = await tx.stop.create({
          data: {
            routeId: route.id,
            addressId: address.id,
            sequenceOrder: i + 1,
            // Datos del pedido
            externalOrderId: stopData.externalOrderId,
            products: stopData.products,
            packageCount: stopData.packageCount,
            orderNotes: stopData.orderNotes,
            clientName: stopData.customerName,
            recipientName: stopData.customerName,
            recipientPhone: stopData.customerPhone,
            // Pago
            paymentMethod: stopData.paymentMethod,
            paymentAmount: stopData.paymentAmount,
            isPaid: stopData.isPaid,
            paymentStatus: stopData.isPaid ? 'PAID' : 'PENDING',
            // Configuración
            estimatedMinutes: stopData.estimatedMinutes,
            requireSignature: stopData.requireSignature,
            requirePhoto: stopData.requirePhoto,
            timeWindowStart: stopData.timeWindowStart ? new Date(stopData.timeWindowStart) : null,
            timeWindowEnd: stopData.timeWindowEnd ? new Date(stopData.timeWindowEnd) : null
          },
          include: { address: true }
        });

        stopsWithAddresses.push(stop);
      }

      return { route, stops: stopsWithAddresses };
    });

    // Geocodificar direcciones sin coordenadas en background
    const addressesWithoutCoords = result.stops
      .filter(s => !s.address.latitude || !s.address.longitude)
      .map(s => s.address);

    if (addressesWithoutCoords.length > 0) {
      // Geocodificar en background (no bloquea la respuesta)
      Promise.all(
        addressesWithoutCoords.map(async (addr) => {
          try {
            const coords = await geocodeAddress(addr.fullAddress);
            if (coords.success && coords.latitude && coords.longitude) {
              await prisma.address.update({
                where: { id: addr.id },
                data: {
                  latitude: coords.latitude,
                  longitude: coords.longitude,
                  geocodeStatus: 'SUCCESS'
                }
              });
            }
          } catch (e) {
            console.error(`Error geocoding address ${addr.id}:`, e);
          }
        })
      ).catch(console.error);
    }

    // Obtener ruta completa para la respuesta
    const completeRoute = await prisma.route.findUnique({
      where: { id: result.route.id },
      include: {
        depot: { select: { id: true, name: true, address: true, latitude: true, longitude: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        },
        _count: { select: { stops: true } }
      }
    });

    res.status(201).json({
      success: true,
      data: completeRoute,
      message: `Ruta creada con ${result.stops.length} paradas`
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// POST /routes/:id/stops - Add stops to route
router.post('/:id/stops', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { addressIds } = addStopsSchema.parse(req.body);

    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: { stops: { orderBy: { sequenceOrder: 'desc' }, take: 1 } }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (route.status !== 'DRAFT' && route.status !== 'SCHEDULED' && route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'Solo se pueden agregar paradas a rutas en borrador, programadas o en progreso');
    }

    const lastOrder = route.stops[0]?.sequenceOrder ?? 0;

    const stops = await prisma.$transaction(
      addressIds.map((addressId, index) =>
        prisma.stop.create({
          data: {
            routeId: route.id,
            addressId,
            sequenceOrder: lastOrder + index + 1
          },
          include: { address: true }
        })
      )
    );

    // Notify driver if route is active
    if ((route.status === 'IN_PROGRESS' || route.status === 'SCHEDULED') && route.assignedToId && route.sentAt) {
      const firstStop = stops[0];
      const stopAddress = firstStop?.address?.fullAddress || 'Nueva dirección';
      notificationService.notifyStopAdded(
        route.assignedToId,
        route.name,
        route.id,
        addressIds.length > 1 ? `${addressIds.length} paradas agregadas` : stopAddress
      );
    }

    res.status(201).json({ success: true, data: stops });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// POST /routes/:id/assign - Assign driver
router.post('/:id/assign', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { driverId } = req.body;

    if (!driverId) {
      throw new AppError(400, 'Se requiere el ID del chofer');
    }

    // Verify driver exists and is active
    const driver = await prisma.user.findFirst({
      where: { id: driverId, role: 'DRIVER', isActive: true }
    });

    if (!driver) {
      throw new AppError(404, 'Chofer no encontrado');
    }

    const route = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        assignedToId: driverId,
        status: 'SCHEDULED'
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    res.json({ success: true, data: route });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/load - Conductor marca que cargó el camión
router.post('/:id/load', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Solo el conductor asignado o admin puede marcar carga
    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No puedes marcar carga en esta ruta');
    }

    if (route.status !== 'SCHEDULED') {
      throw new AppError(400, 'La ruta debe estar programada para marcar carga');
    }

    const updatedRoute = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        loadedAt: new Date()
      }
    });

    // Broadcast SSE event for truck loaded
    broadcastToRoute(req.params.id, 'route.loaded', {
      routeId: updatedRoute.id,
      loadedAt: updatedRoute.loadedAt
    });

    res.json({ success: true, data: updatedRoute });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/send - Enviar ruta al conductor (hacerla visible en la app)
router.post('/:id/send', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } }
      }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Validaciones
    if (!route.optimizedAt) {
      throw new AppError(400, 'La ruta debe estar optimizada antes de enviarla al conductor');
    }

    if (!route.assignedToId) {
      throw new AppError(400, 'La ruta debe tener un conductor asignado');
    }

    if (route.sentAt) {
      throw new AppError(409, 'La ruta ya fue enviada al conductor');
    }

    // Cambiar estado a SCHEDULED y marcar como enviada
    const updatedRoute = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        status: 'SCHEDULED',
        sentAt: new Date()
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        depot: { select: { id: true, name: true } },
        _count: { select: { stops: true } }
      }
    });

    // Broadcast SSE event
    broadcastToRoute(req.params.id, 'route.sent', {
      routeId: updatedRoute.id,
      sentAt: updatedRoute.sentAt,
      assignedTo: updatedRoute.assignedTo
    });

    // Send push notification to driver
    if (updatedRoute.assignedTo) {
      notificationService.notifyNewRoute(
        updatedRoute.assignedTo.id,
        updatedRoute.name,
        updatedRoute.id,
        updatedRoute._count.stops
      );
    }

    res.json({ success: true, data: updatedRoute });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/unsend - Retirar ruta del conductor (antes de que inicie)
router.post('/:id/unsend', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (!route.sentAt) {
      throw new AppError(400, 'La ruta no ha sido enviada');
    }

    if (route.status === 'IN_PROGRESS' || route.status === 'COMPLETED') {
      throw new AppError(400, 'No se puede retirar una ruta que ya está en progreso o completada');
    }

    const updatedRoute = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        sentAt: null,
        status: 'DRAFT' // Volver a borrador
      }
    });

    res.json({ success: true, data: updatedRoute });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/start - Iniciar ruta (congela ETAs originales y notifica a todos los clientes)
router.post('/:id/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: {
        depot: true,
        assignedTo: true,
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        }
      }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Solo el conductor asignado o admin puede iniciar
    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No puedes iniciar esta ruta');
    }

    if (route.status !== 'SCHEDULED') {
      throw new AppError(400, 'La ruta debe estar programada para iniciarla');
    }

    // Verificar si el driver ya tiene una ruta activa (IN_PROGRESS o PAUSED)
    if (route.assignedToId) {
      const activeRoute = await prisma.route.findFirst({
        where: {
          assignedToId: route.assignedToId,
          status: { in: ['IN_PROGRESS', 'PAUSED'] },
          id: { not: route.id }
        },
        select: { id: true, name: true, status: true }
      });

      if (activeRoute) {
        return res.status(409).json({
          success: false,
          error: 'El conductor ya tiene una ruta activa',
          activeRoute: {
            id: activeRoute.id,
            name: activeRoute.name,
            status: activeRoute.status
          }
        });
      }
    }

    const now = new Date();

    // RECALCULAR ETAs basándose en la hora REAL de inicio (now), no en la hora planificada
    // Esto es crucial para que las comparaciones "A tiempo / +X min tarde" sean precisas
    const stopsOrdered = route.stops.sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    let currentTime = now; // La hora real de inicio es el punto de partida

    for (const stop of stopsOrdered) {
      // Agregar tiempo de viaje desde la parada anterior (o desde el depot)
      const travelMinutes = stop.travelMinutesFromPrevious || 0;
      const arrivalTime = new Date(currentTime.getTime() + travelMinutes * 60 * 1000);

      // Guardar la ETA calculada basándose en la hora real de inicio
      await prisma.stop.update({
        where: { id: stop.id },
        data: {
          estimatedArrival: arrivalTime,
          originalEstimatedArrival: arrivalTime // Congelar ETA real para comparaciones
        }
      });

      // Para la siguiente parada, agregar el tiempo de servicio (usar config de depot)
      const serviceMinutes = stop.estimatedMinutes || route.depot?.defaultServiceMinutes || 15;
      currentTime = new Date(arrivalTime.getTime() + serviceMinutes * 60 * 1000);
    }

    // Actualizar ruta a IN_PROGRESS
    const updatedRoute = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        status: 'IN_PROGRESS',
        startedAt: now,
        actualStartTime: now
      },
      include: {
        depot: true,
        assignedTo: true,
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        }
      }
    });

    // Enviar webhook route.started con ETAs a todos los clientes
    const webhookConfig = await getWebhookConfig();
    if (webhookConfig.enabled && webhookConfig.url) {
      const notifConfig = await getNotificationConfig();

      // Refetch paradas con originalEstimatedArrival actualizado
      const updatedStops = await prisma.stop.findMany({
        where: { routeId: route.id, status: 'PENDING' },
        include: { address: true },
        orderBy: { sequenceOrder: 'asc' }
      });

      const payload: WebhookPayload = {
        event: 'route.started',
        timestamp: now.toISOString(),
        route: buildRoutePayload(updatedRoute),
        driver: buildDriverPayload(route.assignedTo),
        remainingStops: updatedStops.map(s => buildStopWithWindowPayload(s, notifConfig.etaWindowBefore, notifConfig.etaWindowAfter)),
        metadata: {
          totalStops: updatedStops.length,
          etaWindowBefore: notifConfig.etaWindowBefore,
          etaWindowAfter: notifConfig.etaWindowAfter
        }
      };

      // Enviar webhook (async, no esperamos)
      sendWebhook(webhookConfig.url, payload, webhookConfig.secret).catch(err => {
        console.error('[START] Webhook route.started error:', err);
      });
    }

    // Broadcast SSE para actualizar la web en tiempo real
    broadcastToRoute(req.params.id, 'route.started', {
      routeId: updatedRoute.id,
      status: updatedRoute.status,
      startedAt: updatedRoute.startedAt,
      stops: updatedRoute.stops.map(s => ({
        id: s.id,
        estimatedArrival: s.estimatedArrival,
        originalEstimatedArrival: s.originalEstimatedArrival
      }))
    });

    res.json({ success: true, data: updatedRoute });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/resend-notifications - Reenviar notificaciones WhatsApp a clientes
router.post('/:id/resend-notifications', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const routeId = req.params.id;

    // Obtener la ruta con todas sus relaciones
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      include: {
        depot: true,
        assignedTo: true,
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        }
      }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Solo permitir reenvío en rutas activas (IN_PROGRESS o SCHEDULED con ETAs)
    if (!['IN_PROGRESS', 'SCHEDULED'].includes(route.status)) {
      throw new AppError(400, 'Solo se pueden reenviar notificaciones de rutas programadas o en progreso');
    }

    // Verificar que hay paradas pendientes
    const pendingStops = route.stops.filter(s => s.status === 'PENDING');
    if (pendingStops.length === 0) {
      throw new AppError(400, 'No hay paradas pendientes para notificar');
    }

    // Verificar que las paradas tienen ETAs calculadas
    const stopsWithEta = pendingStops.filter(s => s.estimatedArrival || s.originalEstimatedArrival);
    if (stopsWithEta.length === 0) {
      throw new AppError(400, 'Las paradas no tienen ETAs calculadas. Optimiza la ruta primero.');
    }

    // Obtener configuración de webhook
    const webhookConfig = await getWebhookConfig();
    if (!webhookConfig.enabled || !webhookConfig.url) {
      throw new AppError(400, 'Webhook no configurado. Configura la URL del webhook en Settings.');
    }

    const notifConfig = await getNotificationConfig();

    // Construir payload igual que route.started
    const payload: WebhookPayload = {
      event: 'route.started', // Usamos el mismo evento para que PHP lo procese igual
      timestamp: new Date().toISOString(),
      route: buildRoutePayload(route),
      driver: buildDriverPayload(route.assignedTo),
      remainingStops: stopsWithEta.map(s => buildStopWithWindowPayload(s, notifConfig.etaWindowBefore, notifConfig.etaWindowAfter)),
      metadata: {
        totalStops: stopsWithEta.length,
        etaWindowBefore: notifConfig.etaWindowBefore,
        etaWindowAfter: notifConfig.etaWindowAfter,
        isResend: true, // Marcar como reenvío
        resendBy: req.user!.email,
        resendAt: new Date().toISOString()
      }
    };

    console.log(`[RESEND] Reenviando notificaciones para ruta ${routeId} (${stopsWithEta.length} paradas)`);
    console.log(`[RESEND] Webhook URL: ${webhookConfig.url}`);

    // Enviar webhook (esperamos la respuesta para informar al usuario)
    const result = await sendWebhook(webhookConfig.url, payload, webhookConfig.secret);

    if (result.success) {
      console.log(`[RESEND] Webhook enviado exitosamente`);
      res.json({
        success: true,
        message: `Notificaciones reenviadas a ${stopsWithEta.length} clientes`,
        data: {
          stopsNotified: stopsWithEta.length,
          webhookStatus: result.statusCode
        }
      });
    } else {
      console.error(`[RESEND] Error enviando webhook: ${result.error}`);
      throw new AppError(502, `Error al enviar notificaciones: ${result.error}`);
    }
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/complete - Complete route
router.post('/:id/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No puedes completar esta ruta');
    }

    if (route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'La ruta debe estar en progreso para completarla');
    }

    const updatedRoute = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date()
      }
    });

    res.json({ success: true, data: updatedRoute });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/pause - Pausar ruta en progreso
router.post('/:id/pause', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Solo el conductor asignado o admin puede pausar
    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No puedes pausar esta ruta');
    }

    if (route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'Solo se pueden pausar rutas en progreso');
    }

    const updatedRoute = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        status: 'PAUSED',
        pausedAt: new Date()
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { stops: true } }
      }
    });

    res.json({ success: true, data: updatedRoute });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/resume - Reanudar ruta pausada
router.post('/:id/resume', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Solo el conductor asignado o admin puede reanudar
    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No puedes reanudar esta ruta');
    }

    if (route.status !== 'PAUSED') {
      throw new AppError(400, 'Solo se pueden reanudar rutas pausadas');
    }

    // Verificar que no haya otra ruta activa del mismo driver
    if (route.assignedToId) {
      const otherActiveRoute = await prisma.route.findFirst({
        where: {
          assignedToId: route.assignedToId,
          status: 'IN_PROGRESS',
          id: { not: route.id }
        },
        select: { id: true, name: true }
      });

      if (otherActiveRoute) {
        return res.status(409).json({
          success: false,
          error: 'El conductor ya tiene otra ruta en progreso',
          activeRoute: {
            id: otherActiveRoute.id,
            name: otherActiveRoute.name
          }
        });
      }
    }

    const updatedRoute = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        status: 'IN_PROGRESS',
        pausedAt: null
      },
      include: {
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { stops: true } }
      }
    });

    res.json({ success: true, data: updatedRoute });
  } catch (error) {
    next(error);
  }
});

// PUT /routes/:id - Update route
router.put('/:id', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name, description, departureTime, depotId, originAddress, originLatitude, originLongitude } = req.body;

    const route = await prisma.route.findUnique({
      where: { id: req.params.id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (route.status !== 'DRAFT' && route.status !== 'SCHEDULED' && route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'Solo se pueden editar rutas en borrador, programadas o en progreso');
    }

    // Validate departureTime format if provided
    if (departureTime !== undefined && departureTime !== null) {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      if (departureTime && !timeRegex.test(departureTime)) {
        throw new AppError(400, 'Formato de hora inválido. Use HH:mm');
      }
    }

    // If changing depot, get depot coordinates
    let depotData: any = {};
    if (depotId !== undefined) {
      if (depotId === null) {
        // Clear depot
        depotData = { depotId: null };
      } else {
        // Set new depot and copy its coordinates
        const depot = await prisma.depot.findUnique({ where: { id: depotId } });
        if (!depot) {
          throw new AppError(404, 'Depot no encontrado');
        }
        depotData = {
          depotId: depot.id,
          originAddress: depot.address,
          originLatitude: depot.latitude,
          originLongitude: depot.longitude
        };
      }
    }

    const updatedRoute = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(departureTime !== undefined && { departureTime }),
        ...depotData,
        // Custom origin (when clearing depot or not setting one)
        ...((depotId === undefined || depotId === null) && originAddress !== undefined && { originAddress }),
        ...((depotId === undefined || depotId === null) && originLatitude !== undefined && { originLatitude }),
        ...((depotId === undefined || depotId === null) && originLongitude !== undefined && { originLongitude })
      },
      include: {
        depot: { select: { id: true, name: true, address: true, latitude: true, longitude: true, defaultDepartureTime: true } }
      }
    });

    res.json({ success: true, data: updatedRoute });
  } catch (error) {
    next(error);
  }
});

// GET /routes/:id/stops/:stopId - Get stop details
router.get('/:id/stops/:stopId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, stopId } = req.params;

    const stop = await prisma.stop.findFirst({
      where: { id: stopId, routeId: id },
      include: { address: true }
    });

    if (!stop) {
      throw new AppError(404, 'Parada no encontrada');
    }

    res.json({ success: true, data: stop });
  } catch (error) {
    next(error);
  }
});

// PUT /routes/:id/stops/:stopId - Update stop configuration
router.put('/:id/stops/:stopId', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, stopId } = req.params;
    const {
      stopType,
      estimatedMinutes,
      priority,
      timeWindowStart,
      timeWindowEnd,
      recipientName,
      recipientPhone,
      recipientEmail,
      requireSignature,
      requirePhoto,
      proofEnabled,
      clientName,
      packageCount,
      products,
      externalId,
      barcodeIds,
      sellerName,
      orderNotes,
      notes
    } = req.body;

    const route = await prisma.route.findUnique({
      where: { id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (route.status !== 'DRAFT' && route.status !== 'SCHEDULED' && route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'Solo se pueden editar paradas de rutas en borrador, programadas o en progreso');
    }

    const stop = await prisma.stop.findFirst({
      where: { id: stopId, routeId: id }
    });

    if (!stop) {
      throw new AppError(404, 'Parada no encontrada');
    }

    const updatedStop = await prisma.stop.update({
      where: { id: stopId },
      data: {
        ...(stopType !== undefined && { stopType }),
        ...(estimatedMinutes !== undefined && { estimatedMinutes }),
        ...(priority !== undefined && { priority }),
        ...(timeWindowStart !== undefined && { timeWindowStart: timeWindowStart ? new Date(timeWindowStart) : null }),
        ...(timeWindowEnd !== undefined && { timeWindowEnd: timeWindowEnd ? new Date(timeWindowEnd) : null }),
        ...(recipientName !== undefined && { recipientName }),
        ...(recipientPhone !== undefined && { recipientPhone }),
        ...(recipientEmail !== undefined && { recipientEmail }),
        ...(requireSignature !== undefined && { requireSignature }),
        ...(requirePhoto !== undefined && { requirePhoto }),
        ...(proofEnabled !== undefined && { proofEnabled }),
        ...(clientName !== undefined && { clientName }),
        ...(packageCount !== undefined && { packageCount }),
        ...(products !== undefined && { products }),
        ...(externalId !== undefined && { externalId }),
        ...(barcodeIds !== undefined && { barcodeIds }),
        ...(sellerName !== undefined && { sellerName }),
        ...(orderNotes !== undefined && { orderNotes }),
        ...(notes !== undefined && { notes })
      },
      include: { address: true }
    });

    res.json({ success: true, data: updatedStop });
  } catch (error) {
    next(error);
  }
});

// DELETE /routes/:id/stops/:stopId - Remove stop from route
router.delete('/:id/stops/:stopId', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, stopId } = req.params;

    const route = await prisma.route.findUnique({
      where: { id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (route.status !== 'DRAFT' && route.status !== 'SCHEDULED' && route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'Solo se pueden eliminar paradas de rutas en borrador, programadas o en progreso');
    }

    const stop = await prisma.stop.findFirst({
      where: { id: stopId, routeId: id }
    });

    if (!stop) {
      throw new AppError(404, 'Parada no encontrada');
    }

    await prisma.stop.delete({
      where: { id: stopId }
    });

    // Notify driver if route is active
    if ((route.status === 'IN_PROGRESS' || route.status === 'SCHEDULED') && route.assignedToId && route.sentAt) {
      notificationService.notifyStopRemoved(
        route.assignedToId,
        route.name,
        route.id
      );
    }

    res.json({ success: true, message: 'Parada eliminada' });
  } catch (error) {
    next(error);
  }
});

// PUT /routes/:id/stops/reorder - Reorder stops
router.put('/:id/stops/reorder', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stopIds } = req.body;

    if (!Array.isArray(stopIds) || stopIds.length === 0) {
      throw new AppError(400, 'Se requiere un array de IDs de paradas');
    }

    const route = await prisma.route.findUnique({
      where: { id: req.params.id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (route.status !== 'DRAFT' && route.status !== 'SCHEDULED' && route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'Solo se pueden reordenar paradas de rutas en borrador, programadas o en progreso');
    }

    // First set all to negative values to avoid unique constraint conflicts
    // Then set to final values
    await prisma.$transaction(async (tx) => {
      // Step 1: Set temporary negative values
      for (let i = 0; i < stopIds.length; i++) {
        await tx.stop.update({
          where: { id: stopIds[i] },
          data: { sequenceOrder: -(i + 1000) }
        });
      }
      // Step 2: Set final values
      for (let i = 0; i < stopIds.length; i++) {
        await tx.stop.update({
          where: { id: stopIds[i] },
          data: { sequenceOrder: i + 1 }
        });
      }
    });

    res.json({ success: true, message: 'Paradas reordenadas' });
  } catch (error) {
    next(error);
  }
});

// Generate optimization hash from stops
function generateOptimizationHash(stops: any[]): string {
  // Hash based on stop IDs, order, and coordinates
  const data = stops.map(s => `${s.id}:${s.address.latitude}:${s.address.longitude}:${s.timeWindowStart || ''}:${s.timeWindowEnd || ''}`).join('|');
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    const char = data.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

// POST /routes/:id/optimize - Optimize route with time windows
router.post('/:id/optimize', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { driverStartTime, driverEndTime, force, firstStopId, lastStopId, useHaversine: useHaversineParam } = req.body;

    console.log(`[OPTIMIZE] Request received for route ${req.params.id}`);
    console.log(`[OPTIMIZE] Request body:`, JSON.stringify(req.body, null, 2));
    console.log(`[OPTIMIZE] firstStopId from body:`, firstStopId, `(type: ${typeof firstStopId})`);
    console.log(`[OPTIMIZE] lastStopId from body:`, lastStopId, `(type: ${typeof lastStopId})`);

    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: {
        depot: true,
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        }
      }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (route.status !== 'DRAFT' && route.status !== 'SCHEDULED' && route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'Solo se pueden optimizar rutas en borrador, programadas o en progreso');
    }

    if (route.stops.length < 2) {
      throw new AppError(400, 'Se necesitan al menos 2 paradas para optimizar');
    }

    // Check if optimization is needed (unless force=true or firstStopId/lastStopId is specified)
    // If firstStopId or lastStopId is specified, always re-optimize since the order will change
    const currentHash = generateOptimizationHash(route.stops);
    if (!force && !firstStopId && !lastStopId && route.optimizationHash === currentHash && route.optimizedAt) {
      // Route hasn't changed since last optimization
      console.log(`[OPTIMIZE] Skipping - route already optimized with same hash`);
      return res.json({
        success: true,
        data: route,
        optimization: {
          totalDistance: route.totalDistanceKm ? route.totalDistanceKm * 1000 : null,
          totalDuration: route.totalDurationMin,
          warnings: [],
          alreadyOptimized: true,
          message: 'La ruta ya está optimizada. No hay cambios desde la última optimización.'
        }
      });
    }

    // Get depot coordinates - depot is ALWAYS required for optimization
    if (!route.depot) {
      throw new AppError(400, 'Se requiere un depot/bodega configurado para optimizar la ruta. Configúralo en Configuraciones.');
    }
    const depot = { lat: route.depot.latitude, lng: route.depot.longitude };

    // Filter stops with valid coordinates
    const validStops = route.stops.filter(s => s.address.latitude && s.address.longitude);

    // Validate firstStopId if provided
    let forcedFirstStop: typeof validStops[0] | null = null;
    if (firstStopId) {
      forcedFirstStop = validStops.find(s => s.id === firstStopId) || null;
      if (!forcedFirstStop) {
        throw new AppError(400, 'La parada seleccionada como primera no existe o no tiene coordenadas válidas');
      }
    }

    // Validate lastStopId if provided
    let forcedLastStop: typeof validStops[0] | null = null;
    if (lastStopId) {
      forcedLastStop = validStops.find(s => s.id === lastStopId) || null;
      if (!forcedLastStop) {
        throw new AppError(400, 'La parada seleccionada como última no existe o no tiene coordenadas válidas');
      }
      // Verify firstStopId and lastStopId are not the same
      if (firstStopId && firstStopId === lastStopId) {
        throw new AppError(400, 'La primera y última parada no pueden ser la misma');
      }
    }

    if (validStops.length < 1) {
      throw new AppError(400, 'No hay suficientes paradas con coordenadas válidas (mínimo 1 después de excluir el origen)');
    }

    // Auto-switch to Haversine for routes with many stops to avoid Distance Matrix API limits
    // Google Distance Matrix API limit: 100 elements per request (origins × destinations)
    // For N stops + depot: (N+1)² elements. 10 stops = 121 elements > 100 limit
    const MAX_STOPS_FOR_GOOGLE_MATRIX = 9;
    let useHaversine = useHaversineParam;

    if (useHaversine === undefined && validStops.length > MAX_STOPS_FOR_GOOGLE_MATRIX) {
      useHaversine = true;
      console.log(`[OPTIMIZE] Auto-switching to Haversine mode: ${validStops.length} stops exceeds Google Matrix limit (${MAX_STOPS_FOR_GOOGLE_MATRIX})`);
    }

    console.log(`[OPTIMIZE] Mode: ${useHaversine ? 'Haversine (GRATIS)' : 'Google Matrix API'}`);
    console.log(`[OPTIMIZE] Stops count: ${validStops.length}`);

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw new AppError(500, 'Google Maps API key no configurada');
    }

    // Check if any stop has time windows or high priority
    const hasTimeWindows = validStops.some(s => s.timeWindowStart || s.timeWindowEnd);
    const hasPriorityStops = validStops.some(s => s.priority && s.priority > 0);

    // If there's a forced first or last stop, separate them from the rest
    const stopsToOptimize = validStops.filter(s => {
      if (forcedFirstStop && s.id === forcedFirstStop.id) return false;
      if (forcedLastStop && s.id === forcedLastStop.id) return false;
      return true;
    });

    console.log(`\n[OPTIMIZE] ========== ROUTE OPTIMIZATION ==========`);
    console.log(`[OPTIMIZE] Route ID: ${req.params.id}`);
    console.log(`[OPTIMIZE] Depot config:`);
    console.log(`  - Name: ${route.depot?.name || 'none'}`);
    console.log(`  - Location: ${depot.lat}, ${depot.lng}`);
    console.log(`  - defaultServiceMinutes: ${route.depot?.defaultServiceMinutes ?? 'not set (default 15)'}`);
    console.log(`  - defaultDepartureTime: ${route.depot?.defaultDepartureTime || '08:00 (default)'}`);
    console.log(`  - etaWindowBefore: ${route.depot?.etaWindowBefore ?? 'not set'} min`);
    console.log(`  - etaWindowAfter: ${route.depot?.etaWindowAfter ?? 'not set'} min`);
    console.log(`[OPTIMIZE] Route config:`);
    console.log(`  - Valid stops: ${validStops.length}`);
    console.log(`  - Has time windows: ${hasTimeWindows}`);
    console.log(`  - Has priority stops: ${hasPriorityStops}`);
    console.log(`  - Forced first stop: ${forcedFirstStop ? `${forcedFirstStop.id} (${forcedFirstStop.address.latitude}, ${forcedFirstStop.address.longitude})` : 'none'}`);
    console.log(`  - Forced last stop: ${forcedLastStop ? `${forcedLastStop.id} (${forcedLastStop.address.latitude}, ${forcedLastStop.address.longitude})` : 'none'}`);
    console.log(`  - Stops to optimize: ${stopsToOptimize.length}`);
    console.log(`  - Algorithm: ${(hasTimeWindows || hasPriorityStops) ? 'VRP with Time Windows' : '2-opt + Simulated Annealing'}`);

    let optimizedStopIds: string[];
    let optimizationResult: any = null;

    try {
      // Use VRP optimization when there are time windows OR priority stops
      if (hasTimeWindows || hasPriorityStops) {
        // Use VRP optimization with time windows
        // Get departure time: route override > depot default > 08:00
        const routeDepartureTime = route.departureTime || route.depot?.defaultDepartureTime || '08:00';
        const [depotHours, depotMinutes] = routeDepartureTime.split(':').map(Number);
        const scheduledDate = route.scheduledDate ? new Date(route.scheduledDate) : new Date();

        let startTime: Date;
        if (driverStartTime) {
          startTime = new Date(driverStartTime);
        } else if (route.status === 'IN_PROGRESS') {
          // For active routes, use actual start time or current time
          startTime = route.actualStartTime
            ? new Date(route.actualStartTime)
            : (route.startedAt ? new Date(route.startedAt) : new Date());
          console.log(`[OPTIMIZE] Route IN_PROGRESS - using start time: ${startTime.toISOString()}`);
        } else {
          scheduledDate.setHours(depotHours, depotMinutes, 0, 0);
          startTime = new Date(scheduledDate);
        }

        const endTime = driverEndTime
          ? new Date(driverEndTime)
          : new Date(new Date(scheduledDate).setHours(18, 0, 0, 0));

        // Ensure proper dates
        const driverStart = new Date(startTime);
        const driverEnd = new Date(endTime);

        if (isNaN(driverStart.getTime())) {
          driverStart.setHours(8, 0, 0, 0);
        }
        if (isNaN(driverEnd.getTime())) {
          driverEnd.setHours(18, 0, 0, 0);
        }

        // If there's a forced first stop, use it as the optimization origin
        const vrpOrigin = forcedFirstStop
          ? { lat: forcedFirstStop.address.latitude!, lng: forcedFirstStop.address.longitude! }
          : depot;

        // SIEMPRE usar defaultServiceMinutes del depot para que cambios de config se apliquen
        const vrpDefaultServiceMinutes = route.depot?.defaultServiceMinutes || 15;
        console.log(`[OPTIMIZE-VRP] Using defaultServiceMinutes: ${vrpDefaultServiceMinutes} (from depot: ${route.depot?.name || 'none'})`);

        const result = await optimizeRouteWithTimeWindows({
          depot: vrpOrigin,
          stops: stopsToOptimize.map(s => ({
            id: s.id,
            lat: s.address.latitude!,
            lng: s.address.longitude!,
            timeWindowStart: s.timeWindowStart,
            timeWindowEnd: s.timeWindowEnd,
            serviceMinutes: vrpDefaultServiceMinutes,
            priority: s.priority || 0
          })),
          driverStartTime: driverStart,
          driverEndTime: driverEnd,
          apiKey
        });

        // Build optimized stop IDs with forced first/last stops
        let resultIds = result.optimizedStops.map(s => s.id);
        if (forcedFirstStop) {
          resultIds = [forcedFirstStop.id, ...resultIds];
        }
        if (forcedLastStop) {
          resultIds = [...resultIds, forcedLastStop.id];
        }
        optimizedStopIds = resultIds;
        optimizationResult = result;

        // Update estimated arrival times and travel durations for each stop
        for (const optimizedStop of result.optimizedStops) {
          await prisma.stop.update({
            where: { id: optimizedStop.id },
            data: {
              estimatedArrival: optimizedStop.estimatedArrival,
              travelMinutesFromPrevious: optimizedStop.travelTimeFromPrevious
            }
          });
        }
      } else {
        // Use 2-opt algorithm for better route optimization
        // This eliminates crossings and produces more "circular" routes

        // Get departure time: route override > depot default > 08:00
        const routeDepartureTime = route.departureTime || route.depot?.defaultDepartureTime || '08:00';
        const [depotHours, depotMinutes] = routeDepartureTime.split(':').map(Number);

        const scheduledDate = route.scheduledDate ? new Date(route.scheduledDate) : new Date();
        scheduledDate.setHours(depotHours, depotMinutes, 0, 0);

        let departureTime: Date;
        if (driverStartTime) {
          departureTime = new Date(driverStartTime);
        } else if (route.status === 'IN_PROGRESS') {
          // For active routes, use actual start time or current time
          departureTime = route.actualStartTime
            ? new Date(route.actualStartTime)
            : (route.startedAt ? new Date(route.startedAt) : new Date());
          console.log(`[OPTIMIZE] Route IN_PROGRESS (2-opt) - using start time: ${departureTime.toISOString()}`);
        } else {
          departureTime = scheduledDate;
        }

        // Get default service minutes from depot
        const defaultServiceMinutes = route.depot?.defaultServiceMinutes || 15;
        console.log(`[OPTIMIZE] Using defaultServiceMinutes: ${defaultServiceMinutes} (from depot: ${route.depot?.name || 'none'})`);

        // If there's a forced first stop, use it as the optimization origin
        const optimizationOrigin = forcedFirstStop
          ? { lat: forcedFirstStop.address.latitude!, lng: forcedFirstStop.address.longitude! }
          : depot;

        // Determine return point for optimization:
        // - If lastStopId is set, optimize towards the last stop location
        // - If firstStopId is set but no lastStopId, return to depot
        // - Otherwise, return to depot (default)
        const returnPoint = forcedLastStop
          ? { lat: forcedLastStop.address.latitude!, lng: forcedLastStop.address.longitude! }
          : (forcedFirstStop ? depot : undefined);

        // Use 2-opt algorithm (Nearest Neighbor + 2-opt improvement)
        // SIEMPRE usar defaultServiceMinutes del depot para que cambios de config se apliquen
        const result = await optimizeRouteWith2Opt(
          optimizationOrigin,
          stopsToOptimize.map((s: any) => ({
            id: s.id,
            lat: s.address.latitude!,
            lng: s.address.longitude!,
            serviceMinutes: defaultServiceMinutes
          })),
          apiKey,
          departureTime,
          defaultServiceMinutes,
          returnPoint,  // Punto de retorno: última parada forzada o depot
          useHaversine === true  // Modo económico (Haversine) o Google Matrix API
        );

        // If there's a forced first stop, we need to calculate travel time from depot to it
        let depotToFirstStopMinutes = 0;
        let depotToFirstStopDistance = 0;

        if (forcedFirstStop) {
          // Get travel time from depot to forced first stop
          const depotToFirstUrl = new URL('https://maps.googleapis.com/maps/api/directions/json');
          depotToFirstUrl.searchParams.set('origin', `${depot.lat},${depot.lng}`);
          depotToFirstUrl.searchParams.set('destination', `${forcedFirstStop.address.latitude},${forcedFirstStop.address.longitude}`);
          depotToFirstUrl.searchParams.set('mode', 'driving');
          // Only use departure_time if it's in the future (Google rejects past times)
          const now = new Date();
          if (departureTime.getTime() > now.getTime()) {
            depotToFirstUrl.searchParams.set('departure_time', Math.floor(departureTime.getTime() / 1000).toString());
          } else {
            // Use 'now' for current/past times
            depotToFirstUrl.searchParams.set('departure_time', 'now');
          }
          depotToFirstUrl.searchParams.set('key', apiKey);

          console.log(`[OPTIMIZE] Calling Directions API: depot(${depot.lat},${depot.lng}) -> firstStop(${forcedFirstStop.address.latitude},${forcedFirstStop.address.longitude})`);

          const depotResponse = await fetch(depotToFirstUrl.toString());
          const depotData = await depotResponse.json() as any;

          console.log(`[OPTIMIZE] Directions API response status: ${depotData.status}`);

          if (depotData.status === 'OK' && depotData.routes?.[0]?.legs?.[0]) {
            const leg = depotData.routes[0].legs[0];
            depotToFirstStopMinutes = Math.ceil((leg.duration_in_traffic?.value || leg.duration.value) / 60);
            depotToFirstStopDistance = leg.distance.value;
            console.log(`[OPTIMIZE] Travel time depot->first: ${depotToFirstStopMinutes} min, distance: ${depotToFirstStopDistance}m`);
          } else {
            console.log(`[OPTIMIZE] Directions API failed or no route found:`, JSON.stringify(depotData).substring(0, 500));
          }

          // Build order with first stop prepended
          let orderWithFirst = [forcedFirstStop.id, ...result.order];

          // Calculate arrival time at forced first stop
          const firstStopArrival = new Date(departureTime.getTime() + depotToFirstStopMinutes * 60000);

          // Update forced first stop
          await prisma.stop.update({
            where: { id: forcedFirstStop.id },
            data: {
              estimatedArrival: firstStopArrival,
              travelMinutesFromPrevious: depotToFirstStopMinutes
            }
          });

          console.log(`[OPTIMIZE] Depot -> First stop: ${depotToFirstStopMinutes} min, arrival: ${firstStopArrival.toISOString()}`);
          optimizedStopIds = orderWithFirst;
        } else {
          optimizedStopIds = result.order;
        }

        // If there's a forced last stop, append it to the result and calculate travel time
        if (forcedLastStop) {
          // Get the last stop in the current optimized order
          const lastOptimizedStopId = optimizedStopIds[optimizedStopIds.length - 1];
          const lastOptimizedStop = validStops.find(s => s.id === lastOptimizedStopId);

          if (lastOptimizedStop) {
            // Calculate travel time from last optimized stop to forced last stop
            const lastToForcedUrl = new URL('https://maps.googleapis.com/maps/api/directions/json');
            lastToForcedUrl.searchParams.set('origin', `${lastOptimizedStop.address.latitude},${lastOptimizedStop.address.longitude}`);
            lastToForcedUrl.searchParams.set('destination', `${forcedLastStop.address.latitude},${forcedLastStop.address.longitude}`);
            lastToForcedUrl.searchParams.set('mode', 'driving');
            const now = new Date();
            if (departureTime.getTime() > now.getTime()) {
              lastToForcedUrl.searchParams.set('departure_time', Math.floor(departureTime.getTime() / 1000).toString());
            } else {
              lastToForcedUrl.searchParams.set('departure_time', 'now');
            }
            lastToForcedUrl.searchParams.set('key', apiKey);

            console.log(`[OPTIMIZE] Calling Directions API: lastOptimized(${lastOptimizedStop.address.latitude},${lastOptimizedStop.address.longitude}) -> forcedLast(${forcedLastStop.address.latitude},${forcedLastStop.address.longitude})`);

            const lastResponse = await fetch(lastToForcedUrl.toString());
            const lastData = await lastResponse.json() as any;

            let lastToForcedMinutes = 0;
            if (lastData.status === 'OK' && lastData.routes?.[0]?.legs?.[0]) {
              const leg = lastData.routes[0].legs[0];
              lastToForcedMinutes = Math.ceil((leg.duration_in_traffic?.value || leg.duration.value) / 60);
              console.log(`[OPTIMIZE] Travel time lastOptimized->forcedLast: ${lastToForcedMinutes} min`);
            }

            // Calculate arrival time at forced last stop
            // Get the estimated arrival of the last optimized stop and add service time + travel time
            const lastStopData = await prisma.stop.findUnique({ where: { id: lastOptimizedStopId } });
            const lastArrival = lastStopData?.estimatedArrival || departureTime;
            const serviceTime = lastStopData?.estimatedMinutes || defaultServiceMinutes;
            const forcedLastArrival = new Date(new Date(lastArrival).getTime() + (serviceTime + lastToForcedMinutes) * 60000);

            // Update forced last stop
            await prisma.stop.update({
              where: { id: forcedLastStop.id },
              data: {
                estimatedArrival: forcedLastArrival,
                travelMinutesFromPrevious: lastToForcedMinutes
              }
            });

            console.log(`[OPTIMIZE] Last optimized -> Forced last: ${lastToForcedMinutes} min, arrival: ${forcedLastArrival.toISOString()}`);
          }

          // Append forced last stop to the order
          optimizedStopIds = [...optimizedStopIds, forcedLastStop.id];
        }

        // Calcular depotReturnTime ajustado si hay primera parada forzada
        let adjustedDepotReturnTime = result.depotReturnTime;
        if (forcedFirstStop && result.depotReturnTime) {
          // Offset = tiempo viaje depot->primera + servicio en primera
          const serviceMinAtFirstStop = forcedFirstStop.estimatedMinutes || defaultServiceMinutes;
          const timeOffset = (depotToFirstStopMinutes + serviceMinAtFirstStop) * 60000;
          adjustedDepotReturnTime = new Date(result.depotReturnTime.getTime() + timeOffset);
        }

        optimizationResult = {
          success: true,
          totalDistance: result.totalDistance + depotToFirstStopDistance,
          totalDuration: result.totalDuration + depotToFirstStopMinutes,
          usedTraffic: result.usedTraffic,
          warnings: [],
          estimatedArrivals: result.estimatedArrivals,
          legDurations: result.legDurations,
          depotReturnTime: adjustedDepotReturnTime,
          returnLegDuration: result.returnLegDuration
        };

        // Update estimated arrival times and travel durations for remaining stops
        // If there's a forced first stop, we need to offset the times by the depot-to-first travel + service time
        const serviceMinAtFirstStop = forcedFirstStop?.estimatedMinutes || defaultServiceMinutes;
        const timeOffset = forcedFirstStop ? (depotToFirstStopMinutes + serviceMinAtFirstStop) * 60000 : 0;

        console.log(`[OPTIMIZE] Saving ${result.estimatedArrivals.length} ETAs (serviceMin=${defaultServiceMinutes}, speed=50km/h):`);
        for (let i = 0; i < result.estimatedArrivals.length; i++) {
          const arrivalInfo = result.estimatedArrivals[i];
          const travelMinutes = result.legDurations[i] || 0;

          // Offset the arrival time if there's a forced first stop
          const adjustedArrival = forcedFirstStop
            ? new Date(new Date(arrivalInfo.arrival).getTime() + timeOffset)
            : arrivalInfo.arrival;

          console.log(`  ${i + 1}. Stop ${arrivalInfo.id.slice(-6)} -> ETA: ${adjustedArrival.toISOString()} (travel: ${travelMinutes}min)`);

          await prisma.stop.update({
            where: { id: arrivalInfo.id },
            data: {
              estimatedArrival: adjustedArrival,
              travelMinutesFromPrevious: travelMinutes
            }
          });
        }

        console.log(`Optimized with Directions API: ${result.totalDistance / 1000} km, ${result.totalDuration} min, traffic: ${result.usedTraffic}`);
      }
    } catch (optimizeError: any) {
      console.error('Optimization error:', optimizeError);
      if (optimizeError.message?.includes('REQUEST_DENIED')) {
        throw new AppError(500, 'Directions API no habilitada. Habilita la API en Google Cloud Console.');
      }
      throw new AppError(500, `Error en optimizacion: ${optimizeError.message}`);
    }

    // Log final order before saving
    console.log(`\n[OPTIMIZE] ========== FINAL OPTIMIZED ORDER ==========`);
    console.log(`[OPTIMIZE] Total stops: ${optimizedStopIds.length}`);
    for (let i = 0; i < optimizedStopIds.length; i++) {
      const stop = validStops.find(s => s.id === optimizedStopIds[i]);
      const shortAddr = stop?.address?.fullAddress?.substring(0, 40) || 'unknown';
      console.log(`  ${String(i + 1).padStart(2)}. ${shortAddr}...`);
    }

    // Reorder stops in database
    await prisma.$transaction(async (tx) => {
      // Step 1: Set temporary negative values
      for (let i = 0; i < optimizedStopIds.length; i++) {
        await tx.stop.update({
          where: { id: optimizedStopIds[i] },
          data: { sequenceOrder: -(i + 1000) }
        });
      }
      // Step 2: Set final values
      for (let i = 0; i < optimizedStopIds.length; i++) {
        await tx.stop.update({
          where: { id: optimizedStopIds[i] },
          data: { sequenceOrder: i + 1 }
        });
      }
    });

    // Update route with optimization info and hash
    await prisma.route.update({
      where: { id: req.params.id },
      data: {
        optimizedAt: new Date(),
        optimizationHash: currentHash,
        totalDistanceKm: optimizationResult.totalDistance ? optimizationResult.totalDistance / 1000 : null,
        totalDurationMin: optimizationResult.totalDuration || null,
        depotReturnTime: optimizationResult.depotReturnTime || null
      }
    });

    // Fetch updated route
    const updatedRoute = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: {
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        }
      }
    });

    // Log final ETA summary
    console.log(`\n[OPTIMIZE] ========== ETA SUMMARY ==========`);
    console.log(`[OPTIMIZE] Service time used: ${route.depot?.defaultServiceMinutes || 15} min/stop`);
    console.log(`[OPTIMIZE] Departure: ${optimizationResult.estimatedArrivals?.[0]?.departure || 'N/A'}`);
    if (updatedRoute?.stops) {
      for (const stop of updatedRoute.stops) {
        const eta = stop.estimatedArrival
          ? new Date(stop.estimatedArrival).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
          : 'N/A';
        const addr = stop.address?.fullAddress?.substring(0, 35) || 'unknown';
        console.log(`  ${String(stop.sequenceOrder).padStart(2)}. ${eta} | ${addr}...`);
      }
    }
    console.log(`[OPTIMIZE] Depot return: ${optimizationResult.depotReturnTime ? new Date(optimizationResult.depotReturnTime).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : 'N/A'}`);
    console.log(`[OPTIMIZE] ============================================\n`);

    res.json({
      success: true,
      data: updatedRoute,
      optimization: {
        totalDistance: optimizationResult.totalDistance,
        totalDuration: optimizationResult.totalDuration,
        totalWaitTime: optimizationResult.totalWaitTime || 0,
        unserviceableStops: optimizationResult.unserviceableStops || [],
        warnings: optimizationResult.warnings || [],
        hasTimeWindows,
        hasPriorityStops,
        usedTraffic: optimizationResult.usedTraffic || false,
        depotReturnTime: optimizationResult.depotReturnTime || null,
        returnLegDuration: optimizationResult.returnLegDuration || null
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/stops/:stopId/complete - Complete a stop and recalculate ETAs
router.post('/:id/stops/:stopId/complete', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: routeId, stopId } = req.params;
    const { notes, failureReason, status = 'COMPLETED', signatureUrl, photoUrl } = req.body;

    // Validate status
    const validStatuses = ['COMPLETED', 'FAILED', 'SKIPPED'];
    if (!validStatuses.includes(status)) {
      throw new AppError(400, `Estado inválido. Debe ser: ${validStatuses.join(', ')}`);
    }

    // Get route and stop
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      include: { depot: true }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (route.status !== 'IN_PROGRESS' && route.status !== 'SCHEDULED') {
      throw new AppError(400, 'La ruta debe estar en progreso o programada');
    }

    const stop = await prisma.stop.findUnique({
      where: { id: stopId },
      include: { address: true }
    });

    if (!stop || stop.routeId !== routeId) {
      throw new AppError(404, 'Parada no encontrada en esta ruta');
    }

    if (stop.status === 'COMPLETED' || stop.status === 'FAILED' || stop.status === 'SKIPPED') {
      throw new AppError(400, 'Esta parada ya fue procesada');
    }

    // POD (Proof of Delivery) validation - only required for COMPLETED status
    if (status === 'COMPLETED') {
      if (stop.requireSignature && !signatureUrl) {
        throw new AppError(400, 'Se requiere firma para completar esta entrega');
      }
      if (stop.requirePhoto && !photoUrl) {
        throw new AppError(400, 'Se requiere foto para completar esta entrega');
      }
    }

    const now = new Date();

    // Update stop status with POD data
    const updatedStop = await prisma.stop.update({
      where: { id: stopId },
      data: {
        status: status as 'COMPLETED' | 'FAILED' | 'SKIPPED',
        completedAt: now,
        arrivedAt: stop.arrivedAt || now,
        notes: notes || stop.notes,
        failureReason: status === 'FAILED' ? failureReason : null,
        signatureUrl: signatureUrl || stop.signatureUrl,
        photoUrl: photoUrl || stop.photoUrl
      },
      include: { address: true }
    });

    // Start route if not already in progress
    if (route.status === 'SCHEDULED') {
      await prisma.route.update({
        where: { id: routeId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: now
        }
      });
    }

    // Recalculate ETAs for remaining stops
    let recalcResult = null;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (apiKey && status === 'COMPLETED') {
      recalcResult = await recalculateETAs(routeId, stopId, now, apiKey);
      console.log(`[COMPLETE] ETA recalculation result:`, recalcResult);
    }

    // Send webhook notification (async, don't wait)
    sendStopCompletedWebhook(routeId, stopId).catch(err => {
      console.error('[COMPLETE] Webhook error:', err);
    });

    // Check if all stops are completed
    const remainingStops = await prisma.stop.count({
      where: {
        routeId,
        status: 'PENDING'
      }
    });

    if (remainingStops === 0) {
      await prisma.route.update({
        where: { id: routeId },
        data: {
          status: 'COMPLETED',
          completedAt: now
        }
      });
    }

    // Get updated route with all stops
    const updatedRoute = await prisma.route.findUnique({
      where: { id: routeId },
      include: {
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        },
        depot: true,
        assignedTo: true
      }
    });

    // Broadcast SSE event to web clients
    broadcastToRoute(routeId, 'stop.status_changed', {
      stop: updatedStop,
      route: updatedRoute,
      remainingStops
    });

    // If route completed, send route.completed event
    if (remainingStops === 0) {
      broadcastToRoute(routeId, 'route.completed', {
        route: updatedRoute
      });
    }

    res.json({
      success: true,
      data: {
        stop: updatedStop,
        route: updatedRoute,
        recalculation: recalcResult
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/stops/:stopId/arrive - Mark driver arrived at stop
router.post('/:id/stops/:stopId/arrive', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: routeId, stopId } = req.params;

    const stop = await prisma.stop.findUnique({
      where: { id: stopId }
    });

    if (!stop || stop.routeId !== routeId) {
      throw new AppError(404, 'Parada no encontrada');
    }

    const updatedStop = await prisma.stop.update({
      where: { id: stopId },
      data: {
        status: 'ARRIVED',
        arrivedAt: new Date()
      },
      include: { address: true }
    });

    // Broadcast SSE event
    broadcastToRoute(routeId, 'stop.status_changed', {
      stop: updatedStop
    });

    res.json({ success: true, data: updatedStop });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/stops/:stopId/payment - Registrar pago de una parada
router.post('/:id/stops/:stopId/payment', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: routeId, stopId } = req.params;
    const { amount, method, notes, paymentAmount, customerRut, collectedBy } = req.body;

    // Validar que la parada pertenece a la ruta
    const stop = await prisma.stop.findFirst({
      where: { id: stopId, routeId },
      include: { address: true }
    });

    if (!stop) {
      throw new AppError(404, 'Parada no encontrada en esta ruta');
    }

    // Verificar permisos - solo el conductor asignado o admin
    const route = await prisma.route.findUnique({
      where: { id: routeId },
      select: { assignedToId: true, status: true }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No tienes permiso para registrar pagos en esta ruta');
    }

    // Validar método de pago
    const validMethods = ['CASH', 'CARD', 'TRANSFER', 'ONLINE', 'CHECK', 'OTHER'];
    const upperMethod = method?.toUpperCase() || 'CASH';
    if (!validMethods.includes(upperMethod)) {
      throw new AppError(400, `Método de pago inválido. Debe ser: ${validMethods.join(', ')}`);
    }

    const collectionAmount = amount || 0;
    const expectedAmount = paymentAmount || stop.paymentAmount || 0;

    // Para TRANSFER: crear registro Payment y dejar pendiente verificación
    if (upperMethod === 'TRANSFER') {
      // Validar que tiene RUT para verificación
      const rutToUse = customerRut || stop.customerRut;
      if (!rutToUse) {
        throw new AppError(400, 'Se requiere RUT del cliente para pagos por transferencia');
      }

      // Determinar método de pago válido para el enum
      const prismaMethod = upperMethod as 'CASH' | 'CARD' | 'TRANSFER' | 'ONLINE';

      // Crear registro de pago pendiente
      const payment = await prisma.payment.create({
        data: {
          stopId,
          amount: collectionAmount || expectedAmount,
          method: prismaMethod,
          status: 'PENDING',
          customerRut: rutToUse,
          notes: notes || null,
          collectedBy: collectedBy || 'driver'
        }
      });

      // Actualizar Stop con RUT (para referencia) pero NO marcar como pagado
      await prisma.stop.update({
        where: { id: stopId },
        data: {
          customerRut: rutToUse,
          paymentMethod: upperMethod,
          paymentAmount: expectedAmount || null,
          collectionAmount: collectionAmount || null,
          paymentNotes: notes || null
          // isPaid y paymentStatus NO se actualizan hasta verificar
        }
      });

      return res.json({
        success: true,
        message: 'Pago registrado, pendiente verificación de transferencia',
        data: {
          paymentId: payment.id,
          status: 'PENDING',
          requiresVerification: true,
          customerRut: rutToUse
        }
      });
    }

    // Para otros métodos (CASH, CARD, etc.): pago inmediato
    let paymentStatus: 'PAID' | 'PARTIAL' | 'PENDING' = 'PAID';
    if (collectionAmount > 0 && expectedAmount > 0 && collectionAmount < expectedAmount) {
      paymentStatus = 'PARTIAL';
    }

    // Determinar método de pago válido para el enum
    const prismaMethod = ['CASH', 'CARD', 'TRANSFER', 'ONLINE'].includes(upperMethod)
      ? (upperMethod as 'CASH' | 'CARD' | 'TRANSFER' | 'ONLINE')
      : 'CASH';

    // Crear registro de pago confirmado
    const payment = await prisma.payment.create({
      data: {
        stopId,
        amount: collectionAmount || expectedAmount,
        method: prismaMethod,
        status: 'VERIFIED', // Pagos en efectivo/tarjeta se verifican al instante
        customerRut: customerRut || stop.customerRut || null,
        notes: notes || null,
        collectedBy: collectedBy || 'driver',
        verifiedAt: new Date(),
        verifiedBy: 'driver'
      }
    });

    // Actualizar Stop como pagado
    const updatedStop = await prisma.stop.update({
      where: { id: stopId },
      data: {
        isPaid: true,
        paymentStatus,
        paymentMethod: upperMethod,
        paymentAmount: expectedAmount || null,
        collectionAmount: collectionAmount || null,
        paymentNotes: notes || null,
        paidAt: new Date(),
        customerRut: customerRut || stop.customerRut || null
      },
      include: { address: true }
    });

    res.json({
      success: true,
      message: 'Pago registrado correctamente',
      data: {
        ...updatedStop,
        paymentId: payment.id
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /routes/:id/driver-location - Obtener ubicación actual del conductor
router.get('/:id/driver-location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        status: true,
        driverLatitude: true,
        driverLongitude: true,
        driverLocationAt: true,
        driverHeading: true,
        driverSpeed: true,
        assignedToId: true
      }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Verificar permisos - conductor solo puede ver su propia ruta
    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No tienes acceso a esta ruta');
    }

    // Solo retornar ubicación si la ruta está en progreso
    if (route.status !== 'IN_PROGRESS') {
      return res.json({
        success: true,
        data: null,
        message: 'La ruta no está en progreso'
      });
    }

    res.json({
      success: true,
      data: route.driverLatitude && route.driverLongitude ? {
        latitude: route.driverLatitude,
        longitude: route.driverLongitude,
        heading: route.driverHeading,
        speed: route.driverSpeed,
        updatedAt: route.driverLocationAt
      } : null
    });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/location - Actualizar ubicación en vivo del conductor
router.post('/:id/location', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { latitude, longitude, heading, speed, accuracy } = req.body;

    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      throw new AppError(400, 'Se requieren latitude y longitude');
    }

    const route = await prisma.route.findUnique({
      where: { id: req.params.id }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Solo el conductor asignado puede actualizar ubicación
    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No puedes actualizar ubicación en esta ruta');
    }

    if (route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'La ruta debe estar en progreso');
    }

    const now = new Date();

    // Actualizar ubicación del conductor en la ruta
    const updatedRoute = await prisma.route.update({
      where: { id: req.params.id },
      data: {
        driverLatitude: latitude,
        driverLongitude: longitude,
        driverLocationAt: now,
        driverHeading: heading || null,
        driverSpeed: speed || null
      }
    });

    // Guardar punto de tracking para historial
    await prisma.trackingPoint.create({
      data: {
        routeId: route.id,
        userId: req.user!.id,
        latitude,
        longitude,
        accuracy: accuracy || null,
        speed: speed || null,
        heading: heading || null,
        recordedAt: now
      }
    });

    // Broadcast location update via SSE to web clients
    broadcastToRoute(req.params.id, 'driver.location_updated', {
      latitude,
      longitude,
      heading: heading || null,
      speed: speed || null,
      updatedAt: now.toISOString()
    });

    res.json({
      success: true,
      data: {
        latitude: updatedRoute.driverLatitude,
        longitude: updatedRoute.driverLongitude,
        locationAt: updatedRoute.driverLocationAt,
        heading: updatedRoute.driverHeading,
        speed: updatedRoute.driverSpeed
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/stops/:stopId/in-transit - Marcar conductor en camino a parada (notifica al cliente)
router.post('/:id/stops/:stopId/in-transit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: routeId, stopId } = req.params;

    const route = await prisma.route.findUnique({
      where: { id: routeId },
      include: {
        depot: true,
        assignedTo: true
      }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Solo el conductor asignado puede marcar en tránsito
    if (req.user!.role === 'DRIVER' && route.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No puedes actualizar esta parada');
    }

    if (route.status !== 'IN_PROGRESS') {
      throw new AppError(400, 'La ruta debe estar en progreso');
    }

    const stop = await prisma.stop.findUnique({
      where: { id: stopId },
      include: { address: true }
    });

    if (!stop || stop.routeId !== routeId) {
      throw new AppError(404, 'Parada no encontrada en esta ruta');
    }

    if (stop.status !== 'PENDING') {
      throw new AppError(400, 'Solo se pueden marcar en tránsito paradas pendientes');
    }

    // Actualizar estado de la parada a IN_TRANSIT
    let updatedStop = await prisma.stop.update({
      where: { id: stopId },
      data: {
        status: 'IN_TRANSIT'
      },
      include: { address: true }
    });

    // Calculate real ETA using Google Maps if driver location is available
    let realEta: Date | null = null;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;

    if (apiKey && route.driverLatitude && route.driverLongitude &&
        updatedStop.address.latitude && updatedStop.address.longitude) {
      try {
        const origin = `${route.driverLatitude},${route.driverLongitude}`;
        const destination = `${updatedStop.address.latitude},${updatedStop.address.longitude}`;

        const response = await fetch(
          `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin}&destinations=${destination}&mode=driving&departure_time=now&key=${apiKey}`
        );

        const data = await response.json() as {
          status: string;
          rows: Array<{
            elements: Array<{
              status: string;
              duration: { value: number };
              duration_in_traffic?: { value: number };
            }>;
          }>;
        };

        if (data.status === 'OK' && data.rows[0]?.elements[0]?.status === 'OK') {
          const durationInSeconds = data.rows[0].elements[0].duration_in_traffic?.value
            || data.rows[0].elements[0].duration.value;

          realEta = new Date(Date.now() + durationInSeconds * 1000);

          // Update stop with real ETA
          updatedStop = await prisma.stop.update({
            where: { id: stopId },
            data: {
              estimatedArrival: realEta
            },
            include: { address: true }
          });

          console.log(`[IN-TRANSIT] Real ETA calculated: ${realEta.toISOString()} (${Math.round(durationInSeconds / 60)} min)`);
        }
      } catch (etaError) {
        console.error('[IN-TRANSIT] Error calculating real ETA:', etaError);
        // Continue without ETA - not critical
      }
    }

    // Obtener paradas restantes
    const remainingStops = await prisma.stop.findMany({
      where: {
        routeId,
        sequenceOrder: { gt: stop.sequenceOrder },
        status: 'PENDING'
      },
      include: { address: true },
      orderBy: { sequenceOrder: 'asc' }
    });

    // Enviar webhook stop.in_transit para notificar al cliente
    const webhookConfig = await getWebhookConfig();
    if (webhookConfig.enabled && webhookConfig.url) {
      const notifConfig = await getNotificationConfig();

      const payload: WebhookPayload = {
        event: 'stop.in_transit',
        timestamp: new Date().toISOString(),
        route: buildRoutePayload(route),
        driver: buildDriverPayload(route.assignedTo),
        stop: buildStopWithWindowPayload(updatedStop, notifConfig.etaWindowBefore, notifConfig.etaWindowAfter),
        remainingStops: remainingStops.map(s => buildStopWithWindowPayload(s, notifConfig.etaWindowBefore, notifConfig.etaWindowAfter)),
        metadata: {
          driverLocation: route.driverLatitude && route.driverLongitude ? {
            latitude: route.driverLatitude,
            longitude: route.driverLongitude,
            updatedAt: route.driverLocationAt?.toISOString()
          } : null,
          realEta: realEta?.toISOString() || null,
          realEtaMinutes: realEta ? Math.round((realEta.getTime() - Date.now()) / 60000) : null
        }
      };

      // Enviar webhook (async, no esperamos)
      sendWebhook(webhookConfig.url, payload, webhookConfig.secret).catch(err => {
        console.error('[IN-TRANSIT] Webhook error:', err);
      });
    }

    // Broadcast SSE event to web clients watching this route
    broadcastToRoute(routeId, 'stop.in_transit', {
      stop: updatedStop,
      remainingStops: remainingStops.length,
      realEta: realEta?.toISOString() || null,
      driverLocation: route.driverLatitude && route.driverLongitude ? {
        latitude: route.driverLatitude,
        longitude: route.driverLongitude
      } : null
    });

    res.json({
      success: true,
      data: {
        ...updatedStop,
        realEta: realEta?.toISOString() || null
      }
    });
  } catch (error) {
    next(error);
  }
});

// POST /routes/:id/duplicate - Duplicar ruta (crear copia con nueva fecha)
router.post('/:id/duplicate', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { scheduledDate, name: customName } = req.body;

    const sourceRoute = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: {
        depot: true,
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        }
      }
    });

    if (!sourceRoute) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Generar nombre para la copia
    const newName = customName || `${sourceRoute.name} (copia)`;
    const newScheduledDate = scheduledDate ? new Date(scheduledDate) : null;

    // Crear nueva ruta con los datos de la original
    const newRoute = await prisma.route.create({
      data: {
        name: newName,
        description: sourceRoute.description,
        status: 'DRAFT',
        scheduledDate: newScheduledDate,
        depotId: sourceRoute.depotId,
        originLatitude: sourceRoute.originLatitude,
        originLongitude: sourceRoute.originLongitude,
        originAddress: sourceRoute.originAddress,
        departureTime: sourceRoute.departureTime,
        createdById: req.user!.id
      }
    });

    // Copiar paradas
    if (sourceRoute.stops.length > 0) {
      await prisma.stop.createMany({
        data: sourceRoute.stops.map(stop => ({
          routeId: newRoute.id,
          addressId: stop.addressId,
          sequenceOrder: stop.sequenceOrder,
          status: 'PENDING',
          stopType: stop.stopType,
          estimatedMinutes: stop.estimatedMinutes,
          priority: stop.priority,
          timeWindowStart: stop.timeWindowStart,
          timeWindowEnd: stop.timeWindowEnd,
          recipientName: stop.recipientName,
          recipientPhone: stop.recipientPhone,
          recipientEmail: stop.recipientEmail,
          requireSignature: stop.requireSignature,
          requirePhoto: stop.requirePhoto,
          proofEnabled: stop.proofEnabled,
          clientName: stop.clientName,
          packageCount: stop.packageCount,
          products: stop.products,
          externalId: stop.externalId,
          barcodeIds: stop.barcodeIds,
          sellerName: stop.sellerName,
          orderNotes: stop.orderNotes
        }))
      });
    }

    // Obtener la ruta creada con todas sus relaciones
    const createdRoute = await prisma.route.findUnique({
      where: { id: newRoute.id },
      include: {
        depot: { select: { id: true, name: true, address: true } },
        stops: {
          include: { address: true },
          orderBy: { sequenceOrder: 'asc' }
        },
        _count: { select: { stops: true } }
      }
    });

    res.status(201).json({
      success: true,
      data: createdRoute,
      message: `Ruta duplicada: ${sourceRoute.stops.length} paradas copiadas`
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /routes/:id
// Si la ruta no está en DRAFT, requiere adminPassword para eliminar
router.delete('/:id', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { adminPassword } = req.body;
    const FORCE_DELETE_PASSWORD = process.env.ROUTE_DELETE_PASSWORD || '123';

    const route = await prisma.route.findUnique({
      where: { id: req.params.id },
      include: {
        stops: { select: { id: true } }
      }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Si no es DRAFT, requiere clave de admin
    if (route.status !== 'DRAFT') {
      if (!adminPassword) {
        throw new AppError(400, 'Se requiere clave de administrador para eliminar rutas que no están en borrador');
      }
      if (adminPassword !== FORCE_DELETE_PASSWORD) {
        throw new AppError(403, 'Clave de administrador incorrecta');
      }
      console.log(`[DELETE ROUTE] Force delete authorized by ${req.user?.email} for route ${route.id} (status: ${route.status})`);
    }

    // Eliminar paradas primero (por FK constraint)
    if (route.stops.length > 0) {
      await prisma.stop.deleteMany({
        where: { routeId: route.id }
      });
    }

    await prisma.route.delete({
      where: { id: req.params.id }
    });

    res.json({ success: true, message: 'Ruta eliminada' });
  } catch (error) {
    next(error);
  }
});

// ============================================================================
// POST /routes/import - Import route with stops from external system
// ============================================================================

const importStopSchema = z.object({
  address: z.object({
    fullAddress: z.string().min(5, 'Dirección requerida'),
    unit: z.string().optional(), // Depto, Of., Casa, etc.
    latitude: z.number().optional(), // Si ya tienes coordenadas, envíalas para evitar geocoding
    longitude: z.number().optional(),
  }),
  customer: z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    externalId: z.string().optional(), // RUT del cliente
    rut: z.string().optional(), // RUT (alias más claro)
  }).optional(),
  order: z.object({
    orderId: z.string(), // num_orden o AGENCIA-codigo - se usa para verificar pagos con PHP
    products: z.array(z.string()).optional(),
    notes: z.string().optional(),
    sellerName: z.string().optional(), // RespaldosChile - DOMICILIO/AGENCIA
    packageCount: z.number().optional(),
  }),
  // Payment information
  payment: z.object({
    method: z.enum(['CASH', 'CARD', 'TRANSFER']).optional(), // Método de pago
    amount: z.number().optional(), // Monto a cobrar
    isPaid: z.boolean().default(false), // Ya está pagado?
  }).optional(),
  // Optional time window
  timeWindowStart: z.string().optional(), // HH:mm format
  timeWindowEnd: z.string().optional(),
  priority: z.number().optional(),
  estimatedMinutes: z.number().optional(),
});

const importRouteSchema = z.object({
  route: z.object({
    name: z.string().min(1, 'Nombre de ruta requerido'),
    scheduledDate: z.string().optional(), // YYYY-MM-DD
    description: z.string().optional(),
    depotId: z.string().optional(),
    externalId: z.string().optional(), // ID externo de la ruta
  }),
  stops: z.array(importStopSchema).min(1, 'Se requiere al menos una parada'),
  options: z.object({
    autoOptimize: z.boolean().optional(), // Auto-optimizar después de importar
    assignToDriverId: z.string().optional(), // Asignar a un conductor
  }).optional(),
});

router.post('/import', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = importRouteSchema.parse(req.body);
    const { route: routeData, stops: stopsData, options } = data;

    console.log(`[IMPORT] Starting import of route "${routeData.name}" with ${stopsData.length} stops`);

    // 1. Get depot - use provided depotId or default to first available depot
    let depotId = routeData.depotId || null;
    let depot = null;

    if (depotId) {
      depot = await prisma.depot.findUnique({ where: { id: depotId } });
    } else {
      // No depot specified - use first available depot as default
      depot = await prisma.depot.findFirst({ orderBy: { createdAt: 'asc' } });
      if (depot) {
        depotId = depot.id;
        console.log(`[IMPORT] No depot specified, using default: "${depot.name}" (serviceMinutes: ${depot.defaultServiceMinutes})`);
      }
    }

    // 2. Create the route with depot data
    const route = await prisma.route.create({
      data: {
        name: routeData.name,
        description: routeData.description,
        scheduledDate: routeData.scheduledDate ? new Date(routeData.scheduledDate) : null,
        depotId: depotId,
        // Set origin from depot if available
        originLatitude: depot?.latitude || null,
        originLongitude: depot?.longitude || null,
        originAddress: depot?.address || null,
        createdById: req.user!.id,
        status: 'DRAFT',
      },
    });

    console.log(`[IMPORT] Route created with ID: ${route.id}, depot: ${depot?.name || 'none'}`);

    // 2. Process each stop: geocode addresses and create stops
    const stopResults: Array<{
      orderId: string;
      stopId: string;
      addressId: string;
      geocodeSuccess: boolean;
      error?: string;
    }> = [];

    let sequenceOrder = 1;

    for (const stopData of stopsData) {
      try {
        // Check if address already exists (by fullAddress)
        let address = await prisma.address.findFirst({
          where: {
            fullAddress: {
              equals: stopData.address.fullAddress,
              mode: 'insensitive'
            }
          }
        });

        let geocodeSuccess = true;
        let geocodeError: string | undefined;

        if (!address) {
          // Parse address parts from fullAddress (format: "Street, City, Region" or similar)
          const addressParts = stopData.address.fullAddress.split(',').map(p => p.trim());
          const street = addressParts[0] || stopData.address.fullAddress;
          const city = addressParts[1] || 'Santiago'; // Default to Santiago if not provided
          const state = addressParts[2] || null;

          let latitude: number | null = null;
          let longitude: number | null = null;

          // Check if coordinates were provided - skip geocoding if so
          if (stopData.address.latitude && stopData.address.longitude) {
            latitude = stopData.address.latitude;
            longitude = stopData.address.longitude;
            geocodeSuccess = true;
            console.log(`[IMPORT] Using provided coordinates: ${latitude}, ${longitude}`);
          } else {
            // Geocode the address
            const geocodeResult = await geocodeAddress(stopData.address.fullAddress);
            geocodeSuccess = geocodeResult.success;
            geocodeError = geocodeResult.error;
            latitude = geocodeResult.latitude || null;
            longitude = geocodeResult.longitude || null;
            console.log(`[IMPORT] Geocoded address: ${geocodeSuccess ? 'success' : 'failed'}`);
          }

          // Create address regardless of geocode result
          address = await prisma.address.create({
            data: {
              street,
              city,
              state,
              country: 'Chile',
              fullAddress: stopData.address.fullAddress,
              unit: stopData.address.unit,
              latitude,
              longitude,
              geocodeStatus: geocodeSuccess ? 'SUCCESS' : 'FAILED',
              customerName: stopData.customer?.name,
              customerPhone: stopData.customer?.phone,
              customerRut: stopData.customer?.rut || stopData.customer?.externalId, // RUT del cliente
              externalOrderId: stopData.order.orderId, // num_orden para verificación PHP
              paymentMethod: stopData.payment?.method,
              createdById: req.user!.id,
            }
          });

          console.log(`[IMPORT] Address created: ${address.id}`);
        } else {
          // Update address with customer info if provided
          if (stopData.customer?.name || stopData.customer?.phone || stopData.address.unit) {
            address = await prisma.address.update({
              where: { id: address.id },
              data: {
                ...(stopData.customer?.name && { customerName: stopData.customer.name }),
                ...(stopData.customer?.phone && { customerPhone: stopData.customer.phone }),
                ...(stopData.address.unit && { unit: stopData.address.unit }),
              }
            });
          }
          console.log(`[IMPORT] Address found: ${address.id}`);
        }

        // Parse time windows if provided
        let timeWindowStart: Date | null = null;
        let timeWindowEnd: Date | null = null;

        if (stopData.timeWindowStart && routeData.scheduledDate) {
          const [hours, minutes] = stopData.timeWindowStart.split(':').map(Number);
          timeWindowStart = new Date(routeData.scheduledDate);
          timeWindowStart.setHours(hours, minutes, 0, 0);
        }

        if (stopData.timeWindowEnd && routeData.scheduledDate) {
          const [hours, minutes] = stopData.timeWindowEnd.split(':').map(Number);
          timeWindowEnd = new Date(routeData.scheduledDate);
          timeWindowEnd.setHours(hours, minutes, 0, 0);
        }

        // Create the stop
        const stop = await prisma.stop.create({
          data: {
            routeId: route.id,
            addressId: address.id,
            sequenceOrder: sequenceOrder++,
            status: 'PENDING',
            // Customer info
            recipientName: stopData.customer?.name,
            recipientPhone: stopData.customer?.phone,
            clientName: stopData.customer?.name,
            // Order info
            externalId: stopData.order.orderId,
            externalOrderId: stopData.order.orderId, // num_orden para verificación PHP
            products: stopData.order.products ? JSON.stringify(stopData.order.products) : null,
            orderNotes: stopData.order.notes,
            sellerName: stopData.order.sellerName,
            packageCount: stopData.order.packageCount || 1,
            // Payment info
            paymentMethod: stopData.payment?.method,
            paymentAmount: stopData.payment?.amount,
            isPaid: stopData.payment?.isPaid || false,
            paymentStatus: stopData.payment?.isPaid ? 'PAID' : 'PENDING',
            // Time window
            timeWindowStart,
            timeWindowEnd,
            priority: stopData.priority || 0,
            estimatedMinutes: stopData.estimatedMinutes || depot?.defaultServiceMinutes || 15,
          },
        });

        stopResults.push({
          orderId: stopData.order.orderId,
          stopId: stop.id,
          addressId: address.id,
          geocodeSuccess,
          error: geocodeError,
        });

        console.log(`[IMPORT] Stop created: ${stop.id} for order ${stopData.order.orderId}`);

        // Rate limiting for geocoding
        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (stopError: any) {
        console.error(`[IMPORT] Error processing stop for order ${stopData.order.orderId}:`, stopError);
        stopResults.push({
          orderId: stopData.order.orderId,
          stopId: '',
          addressId: '',
          geocodeSuccess: false,
          error: stopError.message,
        });
      }
    }

    // 3. Count successes and failures
    const successCount = stopResults.filter(r => r.stopId).length;
    const failedCount = stopResults.filter(r => !r.stopId).length;
    const geocodeFailedCount = stopResults.filter(r => !r.geocodeSuccess && r.stopId).length;

    // 4. Optional: Auto-optimize the route
    if (options?.autoOptimize && successCount >= 2) {
      console.log(`[IMPORT] Auto-optimizing route...`);
      // Note: Optimization would need to be called separately or integrated here
    }

    // 5. Optional: Assign to driver
    if (options?.assignToDriverId) {
      await prisma.route.update({
        where: { id: route.id },
        data: {
          assignedToId: options.assignToDriverId,
          status: 'SCHEDULED',
        }
      });
      console.log(`[IMPORT] Route assigned to driver: ${options.assignToDriverId}`);
    }

    // 6. Fetch complete route with stops for response
    const completeRoute = await prisma.route.findUnique({
      where: { id: route.id },
      include: {
        stops: {
          orderBy: { sequenceOrder: 'asc' },
          include: {
            address: {
              select: {
                id: true,
                fullAddress: true,
                unit: true,
                latitude: true,
                longitude: true,
                customerName: true,
                customerPhone: true,
                customerRut: true,
                externalOrderId: true,
              }
            }
          }
        },
        depot: {
          select: { id: true, name: true, address: true }
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true }
        }
      }
    });

    // 7. Return response in format expected by PHP
    res.status(201).json({
      success: true,
      data: {
        id: route.id,              // ID de la ruta para guardar en rutas.id_routes_api
        name: route.name,
        externalId: routeData.externalId,
        status: options?.assignToDriverId ? 'SCHEDULED' : 'DRAFT',
        depot: completeRoute?.depot,
        assignedTo: completeRoute?.assignedTo,
        stops: completeRoute?.stops.map((stop, index) => ({
          id: stop.id,             // ID de la parada para guardar en rutas_paradas.id_routes_api
          position: index + 1,
          externalOrderId: stop.externalOrderId,  // num_orden original
          status: stop.status,
          paymentStatus: stop.paymentStatus,
          isPaid: stop.isPaid,
          address: stop.address
        })) || [],
        summary: {
          total: stopsData.length,
          created: successCount,
          failed: failedCount,
          geocodeFailed: geocodeFailedCount,
        },
        // Mantener stopResults para debugging si es necesario
        _debug: {
          stopResults: stopResults
        }
      }
    });

    console.log(`[IMPORT] Import completed: ${successCount}/${stopsData.length} stops created`);

  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')));
    }
    next(error);
  }
});

// ============================================================================
// GET /routes/:id/optimized-order - Get optimized stop order for external sync
// ============================================================================

router.get('/:id/optimized-order', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const route = await prisma.route.findUnique({
      where: { id },
      include: {
        stops: {
          orderBy: { sequenceOrder: 'asc' },
          include: {
            address: {
              select: {
                fullAddress: true,
                latitude: true,
                longitude: true,
              }
            }
          }
        }
      }
    });

    if (!route) {
      throw new AppError(404, 'Ruta no encontrada');
    }

    // Build response with order mapping
    const stopsOrder = route.stops.map((stop, index) => ({
      position: index + 1,
      orderId: stop.externalId, // This is the orderId from import
      stopId: stop.id,
      sequenceOrder: stop.sequenceOrder,
      status: stop.status,
      address: stop.address?.fullAddress,
      customerName: stop.recipientName || stop.clientName,
      eta: stop.estimatedArrival,
    }));

    res.json({
      success: true,
      data: {
        routeId: route.id,
        routeName: route.name,
        status: route.status,
        totalStops: stopsOrder.length,
        stops: stopsOrder
      }
    });

  } catch (error) {
    next(error);
  }
});

export { router as routeRoutes };
