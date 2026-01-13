/**
 * Simple logger that respects LOG_LEVEL environment variable
 *
 * LOG_LEVEL options:
 * - debug: all logs (debug, info, warn, error, optimize, api)
 * - info: info and above (info, warn, error)
 * - warn: warnings and errors only
 * - error: errors only (default in production)
 * - none: no logs
 *
 * If LOG_LEVEL is not set, uses NODE_ENV:
 * - development: shows all logs
 * - production: shows only errors
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

function getLogLevel(): LogLevel {
  const envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel;
  if (['debug', 'info', 'warn', 'error', 'none'].includes(envLevel)) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'development' ? 'debug' : 'error';
}

const logLevel = getLogLevel();

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 999
};

function shouldLog(level: LogLevel): boolean {
  return levelPriority[level] >= levelPriority[logLevel];
}

export const logger = {
  /**
   * Debug logs - verbose debugging info
   */
  debug: (...args: any[]) => {
    if (shouldLog('debug')) {
      console.log('[DEBUG]', ...args);
    }
  },

  /**
   * Info logs - general information
   */
  info: (...args: any[]) => {
    if (shouldLog('info')) {
      console.log('[INFO]', ...args);
    }
  },

  /**
   * Warning logs - warnings
   */
  warn: (...args: any[]) => {
    if (shouldLog('warn')) {
      console.warn('[WARN]', ...args);
    }
  },

  /**
   * Error logs - errors
   */
  error: (...args: any[]) => {
    if (shouldLog('error')) {
      console.error('[ERROR]', ...args);
    }
  },

  /**
   * Optimization logs - route optimization details
   */
  optimize: (...args: any[]) => {
    if (shouldLog('debug')) {
      console.log('[OPTIMIZE]', ...args);
    }
  },

  /**
   * API/Webhook logs - API request/response info
   */
  api: (...args: any[]) => {
    if (shouldLog('debug')) {
      console.log('[API]', ...args);
    }
  }
};

export default logger;
