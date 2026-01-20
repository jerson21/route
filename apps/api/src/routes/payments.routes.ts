import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database.js';
import { authenticate } from '../middleware/auth.middleware.js';
import { requireRole } from '../middleware/rbac.middleware.js';
import { AppError } from '../middleware/errorHandler.js';
import * as notificationService from '../services/notification.service.js';

const router = Router();

// =============================================================================
// WEBHOOK - Verificación de transferencias (no requiere auth, usa secret)
// =============================================================================

const webhookVerifySchema = z.object({
  customerRut: z.string().min(1),
  amount: z.number().positive(),
  transactionId: z.string().optional(),
  bankReference: z.string().optional(),
  verifiedAt: z.string().datetime().optional()
});

/**
 * POST /payments/webhooks/online-payment
 * Webhook llamado por sistema PHP cuando un pago WebPay es confirmado
 * Notifica al conductor en ruta que el cliente ya pagó online
 *
 * Headers: X-Webhook-Secret
 * Body: { stopId, amount, transactionId?, customerName?, paymentMethod? }
 */
const onlinePaymentSchema = z.object({
  stopId: z.string().min(1, 'stopId es requerido'),
  amount: z.number().positive('amount debe ser positivo'),
  transactionId: z.string().optional(),
  customerName: z.string().optional(),
  paymentMethod: z.string().optional().default('ONLINE') // ONLINE, WEBPAY, etc.
});

router.post('/webhooks/online-payment', async (req: Request, res: Response, next: NextFunction) => {
  const requestId = `REQ-${Date.now()}`;
  console.log(`\n[${requestId}] ========== ONLINE PAYMENT WEBHOOK ==========`);
  console.log(`[${requestId}] Timestamp: ${new Date().toISOString()}`);
  console.log(`[${requestId}] IP: ${req.ip || req.connection.remoteAddress}`);
  console.log(`[${requestId}] Headers:`, JSON.stringify({
    'content-type': req.headers['content-type'],
    'x-webhook-secret': req.headers['x-webhook-secret'] ? '***PRESENT***' : 'MISSING',
    'user-agent': req.headers['user-agent']
  }, null, 2));
  console.log(`[${requestId}] Body:`, JSON.stringify(req.body, null, 2));

  try {
    // Verificar secret
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    const providedSecret = req.headers['x-webhook-secret'];

    if (!webhookSecret) {
      console.error(`[${requestId}] ERROR: PAYMENT_WEBHOOK_SECRET not configured in environment`);
      throw new AppError(500, 'Webhook no configurado');
    }

    if (providedSecret !== webhookSecret) {
      console.warn(`[${requestId}] ERROR: Invalid webhook secret provided`);
      throw new AppError(401, 'Secret inválido');
    }

    console.log(`[${requestId}] Secret validation: OK`);

    // Validar body
    const parseResult = onlinePaymentSchema.safeParse(req.body);
    if (!parseResult.success) {
      console.error(`[${requestId}] Validation error:`, parseResult.error.errors);
      throw new AppError(400, parseResult.error.errors[0].message);
    }

    const { stopId, amount, transactionId, customerName, paymentMethod } = parseResult.data;
    console.log(`[${requestId}] Parsed data: stopId=${stopId}, amount=${amount}, method=${paymentMethod}`);

    // Buscar la parada
    const stop = await prisma.stop.findUnique({
      where: { id: stopId },
      include: {
        route: {
          select: {
            id: true,
            name: true,
            status: true,
            assignedToId: true,
            assignedTo: {
              select: { id: true, firstName: true, lastName: true, fcmToken: true }
            }
          }
        },
        address: {
          select: { customerName: true, fullAddress: true }
        }
      }
    });

    if (!stop) {
      console.error(`[${requestId}] ERROR: Stop not found with id=${stopId}`);
      return res.status(404).json({
        success: false,
        requestId,
        error: 'Parada no encontrada',
        stopId
      });
    }

    console.log(`[${requestId}] Stop found:`, {
      stopId: stop.id,
      currentIsPaid: stop.isPaid,
      currentPaymentStatus: stop.paymentStatus,
      routeId: stop.route?.id,
      routeName: stop.route?.name,
      routeStatus: stop.route?.status,
      driverId: stop.route?.assignedToId,
      driverName: stop.route?.assignedTo ? `${stop.route.assignedTo.firstName} ${stop.route.assignedTo.lastName}` : 'No asignado',
      hasFcmToken: !!stop.route?.assignedTo?.fcmToken
    });

    // Si ya está pagado, solo informar
    if (stop.isPaid) {
      console.log(`[${requestId}] Stop already marked as paid - no update needed`);
      return res.json({
        success: true,
        requestId,
        alreadyPaid: true,
        message: 'Esta parada ya estaba marcada como pagada'
      });
    }

    // Actualizar la parada
    console.log(`[${requestId}] Updating stop payment status...`);
    const updatedStop = await prisma.stop.update({
      where: { id: stopId },
      data: {
        isPaid: true,
        paymentStatus: 'PAID',
        paymentMethod: paymentMethod,
        paymentAmount: amount,
        paidAt: new Date(),
        notes: stop.notes
          ? `${stop.notes} | Pago online: $${amount.toLocaleString('es-CL')} (${transactionId || 'sin ID'})`
          : `Pago online: $${amount.toLocaleString('es-CL')} (${transactionId || 'sin ID'})`
      }
    });

    console.log(`[${requestId}] Stop updated successfully:`, {
      isPaid: updatedStop.isPaid,
      paymentStatus: updatedStop.paymentStatus,
      paymentMethod: updatedStop.paymentMethod,
      paymentAmount: updatedStop.paymentAmount,
      paidAt: updatedStop.paidAt
    });

    // Notificar al conductor via push notification
    let notificationSent = false;
    const driverId = stop.route?.assignedToId;
    const displayName = customerName || stop.address?.customerName || 'Cliente';

    if (driverId) {
      console.log(`[${requestId}] Sending push notification to driver ${driverId}...`);

      notificationSent = await notificationService.sendToUser(driverId, {
        title: 'Pago online recibido',
        body: `${displayName} pagó $${amount.toLocaleString('es-CL')} - Solo entrega`,
        data: {
          type: 'online_payment_received',
          stopId: stopId,
          routeId: stop.route?.id || '',
          amount: amount.toString(),
          transactionId: transactionId || '',
          timestamp: new Date().toISOString()
        }
      });

      console.log(`[${requestId}] Push notification result: ${notificationSent ? 'SENT' : 'FAILED (no FCM token or error)'}`);
    } else {
      console.log(`[${requestId}] No driver assigned to route - skipping notification`);
    }

    const response = {
      success: true,
      requestId,
      stopId,
      routeId: stop.route?.id,
      updated: {
        isPaid: true,
        paymentStatus: 'PAID',
        paymentMethod,
        paymentAmount: amount,
        paidAt: updatedStop.paidAt
      },
      notification: {
        sent: notificationSent,
        driverId: driverId || null
      },
      message: notificationSent
        ? 'Pago registrado y conductor notificado'
        : 'Pago registrado (conductor no notificado - sin FCM token o no asignado)'
    };

    console.log(`[${requestId}] Response:`, JSON.stringify(response, null, 2));
    console.log(`[${requestId}] ========== END WEBHOOK ==========\n`);

    res.json(response);
  } catch (error) {
    console.error(`[${requestId}] Unhandled error:`, error);
    console.log(`[${requestId}] ========== END WEBHOOK (ERROR) ==========\n`);

    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

/**
 * POST /payments/webhooks/verified
 * Webhook llamado por Lambda/Intranet cuando una transferencia es verificada
 *
 * Headers: X-Webhook-Secret
 */
router.post('/webhooks/verified', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Verificar secret
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    const providedSecret = req.headers['x-webhook-secret'];

    if (!webhookSecret) {
      console.error('[Payment Webhook] PAYMENT_WEBHOOK_SECRET not configured');
      throw new AppError(500, 'Webhook no configurado');
    }

    if (providedSecret !== webhookSecret) {
      console.warn('[Payment Webhook] Invalid secret provided');
      throw new AppError(401, 'Secret inválido');
    }

    const data = webhookVerifySchema.parse(req.body);
    const { customerRut, amount, transactionId, bankReference, verifiedAt } = data;

    console.log(`[Payment Webhook] Verificando transferencia: RUT=${customerRut}, monto=${amount}`);

    // Buscar pagos pendientes que coincidan con RUT y monto
    // Buscar con tolerancia de ±1 por redondeo
    const pendingPayments = await prisma.payment.findMany({
      where: {
        customerRut: customerRut,
        status: 'PENDING',
        method: 'TRANSFER',
        amount: {
          gte: amount - 1,
          lte: amount + 1
        }
      },
      include: {
        stop: {
          include: {
            route: {
              select: { assignedToId: true, name: true }
            },
            address: {
              select: { customerName: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' } // Oldest first
    });

    if (pendingPayments.length === 0) {
      console.log(`[Payment Webhook] No se encontraron pagos pendientes para RUT=${customerRut}, monto=${amount}`);
      return res.json({
        success: true,
        matched: false,
        message: 'No se encontraron pagos pendientes que coincidan'
      });
    }

    // Actualizar el primer pago que coincide (FIFO)
    const paymentToUpdate = pendingPayments[0];

    const updatedPayment = await prisma.payment.update({
      where: { id: paymentToUpdate.id },
      data: {
        status: 'VERIFIED',
        transactionId: transactionId || null,
        bankReference: bankReference || null,
        verifiedAt: verifiedAt ? new Date(verifiedAt) : new Date(),
        verifiedBy: 'webhook'
      }
    });

    // Actualizar el Stop como pagado
    await prisma.stop.update({
      where: { id: paymentToUpdate.stopId },
      data: {
        isPaid: true,
        paymentStatus: 'PAID',
        paidAt: new Date()
      }
    });

    // Notificar al conductor via FCM
    const driverId = paymentToUpdate.stop.route?.assignedToId;
    const customerName = paymentToUpdate.stop.address?.customerName || 'Cliente';

    if (driverId) {
      await notificationService.sendToUser(driverId, {
        title: 'Transferencia verificada',
        body: `Pago de ${customerName} ($${amount.toLocaleString('es-CL')}) verificado`,
        data: {
          type: 'payment_verified',
          paymentId: updatedPayment.id,
          stopId: paymentToUpdate.stopId,
          amount: amount.toString()
        }
      });
    }

    console.log(`[Payment Webhook] Pago ${updatedPayment.id} verificado exitosamente`);

    res.json({
      success: true,
      matched: true,
      paymentId: updatedPayment.id,
      stopId: paymentToUpdate.stopId,
      message: 'Pago verificado y actualizado'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// =============================================================================
// WEBHOOK - Notificación de pago recibido desde PHP (ruta alternativa)
// =============================================================================

/**
 * POST /stops/:id/payment-received
 * Alias para compatibilidad con sistema PHP (Intranet)
 * PHP llama a esta URL cuando valida un pago en la cartola bancaria
 *
 * Headers: X-Webhook-Secret
 * Body: { amount, transactionId?, customerName?, method?, bankReference? }
 */
const paymentReceivedSchema = z.object({
  amount: z.number().positive('amount debe ser positivo'),
  transactionId: z.string().optional(),
  customerName: z.string().optional(),
  method: z.string().optional().default('TRANSFER'),
  bankReference: z.string().optional()
});

router.post('/:id/payment-received', async (req: Request, res: Response, next: NextFunction) => {
  const requestId = `REQ-${Date.now()}`;
  const stopId = req.params.id;

  console.log(`\n[${requestId}] ========== PAYMENT RECEIVED (PHP) ==========`);
  console.log(`[${requestId}] Stop ID: ${stopId}`);
  console.log(`[${requestId}] Headers:`, JSON.stringify({
    'content-type': req.headers['content-type'],
    'x-webhook-secret': req.headers['x-webhook-secret'] ? '***PRESENT***' : 'MISSING'
  }, null, 2));
  console.log(`[${requestId}] Body:`, JSON.stringify(req.body, null, 2));

  try {
    // Verificar secret
    const webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET;
    const providedSecret = req.headers['x-webhook-secret'];

    if (!webhookSecret) {
      console.error(`[${requestId}] ERROR: PAYMENT_WEBHOOK_SECRET not configured`);
      throw new AppError(500, 'Webhook no configurado');
    }

    if (providedSecret !== webhookSecret) {
      console.warn(`[${requestId}] ERROR: Invalid webhook secret`);
      throw new AppError(401, 'Secret inválido');
    }

    console.log(`[${requestId}] Secret validation: OK`);

    // Validar body
    const parseResult = paymentReceivedSchema.safeParse(req.body);
    if (!parseResult.success) {
      console.error(`[${requestId}] Validation error:`, parseResult.error.errors);
      throw new AppError(400, parseResult.error.errors[0].message);
    }

    const { amount, transactionId, customerName, method, bankReference } = parseResult.data;
    console.log(`[${requestId}] Parsed data: amount=${amount}, method=${method}, bank=${bankReference}`);

    // Buscar la parada
    const stop = await prisma.stop.findUnique({
      where: { id: stopId },
      include: {
        route: {
          select: {
            id: true,
            name: true,
            status: true,
            assignedToId: true,
            assignedTo: {
              select: { id: true, firstName: true, lastName: true, fcmToken: true }
            }
          }
        },
        address: {
          select: { customerName: true, fullAddress: true }
        }
      }
    });

    if (!stop) {
      console.error(`[${requestId}] ERROR: Stop not found with id=${stopId}`);
      return res.status(404).json({
        success: false,
        requestId,
        error: 'Parada no encontrada',
        stopId
      });
    }

    console.log(`[${requestId}] Stop found:`, {
      stopId: stop.id,
      currentIsPaid: stop.isPaid,
      routeId: stop.route?.id,
      routeName: stop.route?.name,
      driverId: stop.route?.assignedToId
    });

    // Si ya está pagado, solo informar
    if (stop.isPaid) {
      console.log(`[${requestId}] Stop already marked as paid - no update needed`);
      return res.json({
        success: true,
        requestId,
        alreadyPaid: true,
        message: 'Esta parada ya estaba marcada como pagada'
      });
    }

    // Actualizar la parada
    console.log(`[${requestId}] Updating stop payment status...`);
    const updatedStop = await prisma.stop.update({
      where: { id: stopId },
      data: {
        isPaid: true,
        paymentStatus: 'PAID',
        paymentMethod: method,
        paymentAmount: amount,
        paidAt: new Date(),
        notes: stop.notes
          ? `${stop.notes} | Pago verificado: $${amount.toLocaleString('es-CL')} - ${bankReference || transactionId || 'online'}`
          : `Pago verificado: $${amount.toLocaleString('es-CL')} - ${bankReference || transactionId || 'online'}`
      }
    });

    console.log(`[${requestId}] Stop updated:`, {
      isPaid: updatedStop.isPaid,
      paymentStatus: updatedStop.paymentStatus,
      paymentAmount: updatedStop.paymentAmount
    });

    // Notificar al conductor via push notification
    let notificationSent = false;
    const driverId = stop.route?.assignedToId;
    const displayName = customerName || stop.address?.customerName || 'Cliente';

    if (driverId) {
      console.log(`[${requestId}] Sending push notification to driver ${driverId}...`);

      notificationSent = await notificationService.sendToUser(driverId, {
        title: 'Pago verificado',
        body: `${displayName} - $${amount.toLocaleString('es-CL')} - Solo entrega`,
        data: {
          type: 'payment_received',
          stopId: stopId,
          routeId: stop.route?.id || '',
          amount: amount.toString(),
          transactionId: transactionId || '',
          bankReference: bankReference || '',
          timestamp: new Date().toISOString()
        }
      });

      console.log(`[${requestId}] Push notification result: ${notificationSent ? 'SENT' : 'FAILED'}`);
    } else {
      console.log(`[${requestId}] No driver assigned - skipping notification`);
    }

    const response = {
      success: true,
      requestId,
      stopId,
      routeId: stop.route?.id,
      updated: {
        isPaid: true,
        paymentStatus: 'PAID',
        paymentMethod: method,
        paymentAmount: amount,
        paidAt: updatedStop.paidAt
      },
      notification: {
        sent: notificationSent,
        driverId: driverId || null
      },
      message: notificationSent
        ? 'Pago registrado y conductor notificado'
        : 'Pago registrado (conductor no notificado - sin FCM token o no asignado)'
    };

    console.log(`[${requestId}] Response:`, JSON.stringify(response, null, 2));
    console.log(`[${requestId}] ========== END WEBHOOK ==========\n`);

    res.json(response);
  } catch (error) {
    console.error(`[${requestId}] Unhandled error:`, error);
    console.log(`[${requestId}] ========== END WEBHOOK (ERROR) ==========\n`);

    if (error instanceof z.ZodError) {
      return next(new AppError(400, error.errors[0].message));
    }
    next(error);
  }
});

// =============================================================================
// RUTAS AUTENTICADAS
// =============================================================================

router.use(authenticate);

/**
 * GET /payments/pending
 * Lista pagos de transferencia pendientes de verificación
 * Para uso de Lambda que hace polling
 */
router.get('/pending', requireRole('ADMIN', 'OPERATOR'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { hoursAgo = '48' } = req.query;
    const hoursLimit = parseInt(hoursAgo as string) || 48;

    const cutoffDate = new Date();
    cutoffDate.setHours(cutoffDate.getHours() - hoursLimit);

    const pendingPayments = await prisma.payment.findMany({
      where: {
        method: 'TRANSFER',
        status: 'PENDING',
        createdAt: { gte: cutoffDate }
      },
      select: {
        id: true,
        stopId: true,
        amount: true,
        customerRut: true,
        createdAt: true,
        stop: {
          select: {
            id: true,
            recipientName: true,
            address: {
              select: {
                customerName: true,
                customerPhone: true
              }
            },
            route: {
              select: {
                id: true,
                name: true,
                assignedToId: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    res.json({
      success: true,
      data: pendingPayments,
      count: pendingPayments.length
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /payments/:id/verify
 * Verificación manual por conductor - llama a endpoint PHP de gestión
 * El conductor presiona "Validar" en la app Android
 *
 * Body opcional:
 * - customerRut: RUT alternativo si la transferencia fue desde otro RUT
 */
router.post('/:id/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { customerRut: alternativeRut } = req.body;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        stop: {
          include: {
            route: { select: { assignedToId: true } },
            address: { select: { externalOrderId: true, customerRut: true } }
          }
        }
      }
    });

    if (!payment) {
      throw new AppError(404, 'Pago no encontrado');
    }

    // Solo el conductor asignado o admin puede verificar
    if (req.user!.role === 'DRIVER' && payment.stop.route?.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No tienes permiso para verificar este pago');
    }

    if (payment.status !== 'PENDING') {
      throw new AppError(400, `El pago ya tiene estado: ${payment.status}`);
    }

    if (payment.method !== 'TRANSFER') {
      throw new AppError(400, 'Solo se pueden verificar pagos por transferencia');
    }

    // Obtener num_orden de la parada o dirección
    const numOrden = payment.stop.externalOrderId || payment.stop.address?.externalOrderId;
    if (!numOrden) {
      throw new AppError(400, 'Esta parada no tiene número de orden vinculado');
    }

    // Usar RUT alternativo si se proporciona, sino el del pago o dirección
    const rutToVerify = alternativeRut || payment.customerRut || payment.stop.address?.customerRut;
    if (!rutToVerify) {
      throw new AppError(400, 'Se requiere RUT para verificar. Proporciona customerRut en el body.');
    }

    // Llamar a endpoint PHP de gestión
    const phpEndpoint = process.env.PAYMENT_VERIFICATION_PHP_URL;

    if (!phpEndpoint) {
      console.error('[Payment Verify] PAYMENT_VERIFICATION_PHP_URL not configured');
      throw new AppError(500, 'Servicio de verificación no configurado');
    }

    console.log(`[Payment Verify] Verificando num_orden=${numOrden}, RUT=${rutToVerify}`);

    try {
      // Construir form-data para PHP
      const formData = new URLSearchParams();
      formData.append('opcion', 'validacion');
      formData.append('num_orden', numOrden);
      formData.append('rut', rutToVerify);
      formData.append('origen', 'gestion');

      const phpResponse = await fetch(phpEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: formData
      });

      const result = await phpResponse.json() as {
        ok: boolean;
        message: string;
        codigo?: string;
        pago_completo?: boolean;
        total_pedido?: number;
        total_pagado?: number;
        monto_faltante?: number;
        data?: {
          id: string;
          monto: number;
          banco: string;
          nombre: string;
        };
      };

      console.log(`[Payment Verify] PHP response:`, result);

      if (result.ok) {
        // Transferencia encontrada y procesada en sistema PHP
        // Solo marcar como VERIFIED si el pago está completo
        const paymentStatus = result.pago_completo ? 'VERIFIED' : 'PENDING';

        const updates: any[] = [
          prisma.payment.update({
            where: { id },
            data: {
              status: paymentStatus,
              customerRut: rutToVerify,
              transactionId: result.data?.id || null,
              bankReference: result.data?.banco || null,
              verifiedAt: result.pago_completo ? new Date() : null,
              verifiedBy: result.pago_completo ? 'php_endpoint' : null,
              notes: result.pago_completo
                ? `Pago completo. Monto: ${result.data?.monto}`
                : `Pago parcial. Pagado: ${result.total_pagado}/${result.total_pedido}`
            }
          })
        ];

        // Solo marcar stop como pagado si pago completo
        if (result.pago_completo) {
          updates.push(
            prisma.stop.update({
              where: { id: payment.stopId },
              data: {
                isPaid: true,
                paymentStatus: 'PAID',
                paidAt: new Date()
              }
            })
          );
        }

        await prisma.$transaction(updates);

        res.json({
          success: true,
          verified: result.pago_completo,
          pago_completo: result.pago_completo,
          total_pedido: result.total_pedido,
          total_pagado: result.total_pagado,
          monto_faltante: result.monto_faltante,
          message: result.message,
          usedAlternativeRut: !!alternativeRut,
          data: result.data
        });
      } else {
        // Transferencia no encontrada o error
        res.json({
          success: true,
          verified: false,
          message: result.message,
          codigo: result.codigo
        });
      }
    } catch (fetchError) {
      console.error('[Payment Verify] Error calling PHP endpoint:', fetchError);
      throw new AppError(502, 'Error al conectar con servicio de verificación');
    }
  } catch (error) {
    next(error);
  }
});

/**
 * GET /payments/:id
 * Obtener detalles de un pago
 */
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: {
        stop: {
          include: {
            address: true,
            route: {
              select: {
                id: true,
                name: true,
                assignedToId: true
              }
            }
          }
        }
      }
    });

    if (!payment) {
      throw new AppError(404, 'Pago no encontrado');
    }

    // Verificar permisos
    if (req.user!.role === 'DRIVER' && payment.stop.route?.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No tienes acceso a este pago');
    }

    res.json({ success: true, data: payment });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /payments/stop/:stopId
 * Obtener pagos de una parada específica
 */
router.get('/stop/:stopId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { stopId } = req.params;

    const stop = await prisma.stop.findUnique({
      where: { id: stopId },
      include: {
        route: { select: { assignedToId: true } }
      }
    });

    if (!stop) {
      throw new AppError(404, 'Parada no encontrada');
    }

    // Verificar permisos
    if (req.user!.role === 'DRIVER' && stop.route?.assignedToId !== req.user!.id) {
      throw new AppError(403, 'No tienes acceso a esta parada');
    }

    const payments = await prisma.payment.findMany({
      where: { stopId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: payments });
  } catch (error) {
    next(error);
  }
});

export { router as paymentsRoutes };
