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
 * Verificación manual por conductor - llama a Lambda
 * El conductor presiona "Validar" en la app Android
 */
router.post('/:id/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        stop: {
          include: {
            route: { select: { assignedToId: true } }
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

    if (!payment.customerRut) {
      throw new AppError(400, 'El pago no tiene RUT asociado para verificar');
    }

    // Llamar a Lambda para verificar
    const lambdaUrl = process.env.PAYMENT_VERIFICATION_LAMBDA_URL;

    if (!lambdaUrl) {
      console.error('[Payment Verify] PAYMENT_VERIFICATION_LAMBDA_URL not configured');
      throw new AppError(500, 'Servicio de verificación no configurado');
    }

    try {
      const lambdaResponse = await fetch(lambdaUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': process.env.PAYMENT_VERIFICATION_API_KEY || ''
        },
        body: JSON.stringify({
          customerRut: payment.customerRut,
          amount: Number(payment.amount)
        })
      });

      const lambdaResult = await lambdaResponse.json() as {
        found: boolean;
        transactionId?: string;
        bankReference?: string;
      };

      if (lambdaResult.found) {
        // Transferencia encontrada - actualizar como verificada
        await prisma.$transaction([
          prisma.payment.update({
            where: { id },
            data: {
              status: 'VERIFIED',
              transactionId: lambdaResult.transactionId || null,
              bankReference: lambdaResult.bankReference || null,
              verifiedAt: new Date(),
              verifiedBy: 'driver'
            }
          }),
          prisma.stop.update({
            where: { id: payment.stopId },
            data: {
              isPaid: true,
              paymentStatus: 'PAID',
              paidAt: new Date()
            }
          })
        ]);

        res.json({
          success: true,
          verified: true,
          message: 'Transferencia verificada correctamente'
        });
      } else {
        // Transferencia no encontrada
        res.json({
          success: true,
          verified: false,
          message: 'Transferencia no encontrada. El cliente debe verificar en su portal.'
        });
      }
    } catch (fetchError) {
      console.error('[Payment Verify] Error calling Lambda:', fetchError);
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
