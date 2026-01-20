import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { errorHandler } from './middleware/errorHandler.js';
import { authRoutes } from './routes/auth.routes.js';
import { userRoutes } from './routes/users.routes.js';
import { addressRoutes } from './routes/addresses.routes.js';
import { routeRoutes } from './routes/routes.routes.js';
import { depotRoutes } from './routes/depot.routes.js';
import { settingsRoutes } from './routes/settings.routes.js';
import { uploadsRoutes } from './routes/uploads.routes.js';
import { paymentsRoutes } from './routes/payments.routes.js';
import { apiKeysRoutes } from './routes/apikeys.routes.js';

const app = express();

// Security middleware
app.use(helmet());

// CORS - permitir origenes para desarrollo movil y produccion
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:5173',
  'http://localhost:3001',
  'http://localhost',
  'https://apiroutes.respaldoschile.cl',
  'http://apiroutes.respaldoschile.cl',
];

app.use(cors({
  origin: (origin, callback) => {
    // Permitir requests sin origin (mobile apps, Postman, curl)
    if (!origin) return callback(null, true);

    // Permitir origenes en la lista o cualquier IP local (192.168.x.x)
    if (allowedOrigins.includes(origin) || /^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|localhost)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }

    // En desarrollo, permitir todo
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    callback(new Error('CORS not allowed'));
  },
  credentials: true
}));

// Body parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger (when LOG_LEVEL=debug)
if (process.env.LOG_LEVEL === 'debug') {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} ${duration}ms - ${req.ip || req.connection.remoteAddress}`);
    });
    next();
  });
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/addresses', addressRoutes);
app.use('/api/v1/routes', routeRoutes);
app.use('/api/v1/depots', depotRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/uploads', uploadsRoutes);
app.use('/api/v1/payments', paymentsRoutes);
app.use('/api/v1/stops', paymentsRoutes);  // Alias para webhook PHP: POST /stops/:id/payment-received
app.use('/api/v1/api-keys', apiKeysRoutes);

// Error handler (must be last)
app.use(errorHandler);

export default app;
