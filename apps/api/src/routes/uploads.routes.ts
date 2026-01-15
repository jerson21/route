import { Router, Request, Response, NextFunction } from 'express';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { authenticate } from '../middleware/auth.middleware.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

router.use(authenticate);

// Configurar cliente S3 para R2
const getR2Client = () => {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new AppError(500, 'R2 no está configurado');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

// Tipos de archivo permitidos
const ALLOWED_TYPES = {
  photo: {
    contentType: 'image/jpeg',
    folder: 'photos',
    maxSize: 10 * 1024 * 1024 // 10MB
  },
  signature: {
    contentType: 'image/png',
    folder: 'signatures',
    maxSize: 2 * 1024 * 1024 // 2MB
  },
  document: {
    contentType: 'application/pdf',
    folder: 'documents',
    maxSize: 20 * 1024 * 1024 // 20MB
  }
};

// GET /uploads/presigned-url - Generar URL presignada para subir archivo
router.get('/presigned-url', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { type, stopId, routeId, filename } = req.query;

    if (!type || !ALLOWED_TYPES[type as keyof typeof ALLOWED_TYPES]) {
      throw new AppError(400, 'Tipo de archivo inválido. Usar: photo, signature, document');
    }

    const fileConfig = ALLOWED_TYPES[type as keyof typeof ALLOWED_TYPES];
    const bucket = process.env.R2_BUCKET_NAME;

    if (!bucket) {
      throw new AppError(500, 'R2_BUCKET_NAME no configurado');
    }

    // Generar key único para el archivo
    const timestamp = Date.now();
    const uniqueId = randomUUID().slice(0, 8);
    const extension = type === 'signature' ? 'png' : (type === 'document' ? 'pdf' : 'jpg');

    let key = `${fileConfig.folder}/${timestamp}-${uniqueId}`;

    // Agregar contexto si se proporciona
    if (routeId) key = `routes/${routeId}/${key}`;
    if (stopId) key = `${key}-stop-${stopId}`;
    key = `${key}.${extension}`;

    const client = getR2Client();

    // Crear comando para PUT
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ContentType: fileConfig.contentType,
    });

    // Generar URL presignada (válida por 15 minutos)
    const presignedUrl = await getSignedUrl(client, command, { expiresIn: 900 });

    // URL pública para acceder después (si el bucket es público)
    const publicUrl = process.env.R2_PUBLIC_URL
      ? `${process.env.R2_PUBLIC_URL}/${key}`
      : null;

    res.json({
      success: true,
      data: {
        uploadUrl: presignedUrl,
        key,
        publicUrl,
        contentType: fileConfig.contentType,
        maxSize: fileConfig.maxSize,
        expiresIn: 900 // segundos
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /uploads/view-url/:key - Generar URL presignada para ver archivo (si bucket es privado)
router.get('/view-url/*', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = req.params[0]; // Captura todo después de /view-url/

    if (!key) {
      throw new AppError(400, 'Key del archivo requerido');
    }

    const bucket = process.env.R2_BUCKET_NAME;
    if (!bucket) {
      throw new AppError(500, 'R2_BUCKET_NAME no configurado');
    }

    const client = getR2Client();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });

    // URL válida por 1 hora
    const viewUrl = await getSignedUrl(client, command, { expiresIn: 3600 });

    res.json({
      success: true,
      data: {
        viewUrl,
        expiresIn: 3600
      }
    });
  } catch (error) {
    next(error);
  }
});

export { router as uploadsRoutes };
