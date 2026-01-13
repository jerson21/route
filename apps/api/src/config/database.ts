import { PrismaClient, Prisma } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' | 'none'
// - debug: shows all queries, info, warnings and errors
// - info: shows info, warnings and errors
// - warn: shows warnings and errors
// - error: shows only errors (default in production)
// - none: no logs
function getPrismaLogConfig(): Prisma.LogDefinition[] {
  const logLevel = process.env.LOG_LEVEL?.toLowerCase();
  const isDebug = logLevel === 'debug' || (process.env.NODE_ENV === 'development' && logLevel !== 'error' && logLevel !== 'warn' && logLevel !== 'none');

  if (logLevel === 'none') {
    return [];
  }

  const config: Prisma.LogDefinition[] = [];

  if (isDebug) {
    config.push({ emit: 'stdout', level: 'query' });
  }

  // Info level logs
  if (isDebug || logLevel === 'info') {
    config.push({ emit: 'stdout', level: 'info' });
  }

  // Warn level logs
  if (isDebug || logLevel === 'info' || logLevel === 'warn') {
    config.push({ emit: 'stdout', level: 'warn' });
  }

  // Error logs (always unless 'none')
  config.push({ emit: 'stdout', level: 'error' });

  return config;
}

const prismaLogConfig = getPrismaLogConfig();
console.log('[DATABASE] Prisma log levels:', prismaLogConfig.map(c => c.level).join(', ') || 'none');

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: prismaLogConfig,
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
