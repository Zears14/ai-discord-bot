import 'winston-daily-rotate-file';
import path from 'path';
import { fileURLToPath } from 'url';
import winston from 'winston';
import 'dotenv/config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logDirectory = path.join(__dirname, '..', '..', 'logs');
const isDevelopment = process.env.IS_DEVEL === 'true';
const level = isDevelopment ? 'debug' : 'info';

// Remove kernel level mappings - use Winston levels directly

// Custom format for logs
const format = winston.format.printf(({ message, timestamp, module, ...meta }) => {
  // Convert timestamp to kernel-style format
  const date = new Date(timestamp);

  // Format like kernel logs: [timestamp] [module] message
  const timeStr = date.toISOString().replace('T', ' ').slice(0, 19);
  const moduleStr = module ? `[${module}] ` : '';

  let logLine = `[${timeStr}] ${moduleStr}${message}`;

  // Add metadata if present
  if (Object.keys(meta).length > 0) {
    const metaStr = Object.entries(meta)
      .filter(([key]) => key !== 'timestamp' && key !== 'level' && key !== 'module')
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(' ');

    if (metaStr) {
      logLine += ` {${metaStr}}`;
    }
  }

  return logLine;
});

// Console format with colors
const consoleFormat = winston.format.printf(({ level, message, timestamp, module, ...meta }) => {
  const date = new Date(timestamp);
  const timeStr = date.toISOString().replace('T', ' ').slice(0, 19);

  // Color codes for different log levels
  const colors = {
    error: '\x1b[91m', // Bright Red
    warn: '\x1b[93m', // Bright Yellow
    info: '\x1b[96m', // Bright Cyan
    http: '\x1b[95m', // Bright Magenta
    verbose: '\x1b[97m', // Bright White
    debug: '\x1b[90m', // Gray
    silly: '\x1b[37m', // White
  };

  const reset = '\x1b[0m';
  const dimColor = '\x1b[2m';
  const color = colors[level] || '';
  const moduleStr = module ? `[${module}] ` : '';

  let logLine = `${dimColor}[${timeStr}]${reset} ${moduleStr}${color}${message}${reset}`;

  // Add metadata if present
  if (Object.keys(meta).length > 0) {
    const metaStr = Object.entries(meta)
      .filter(([key]) => key !== 'timestamp' && key !== 'level' && key !== 'module')
      .map(([key, value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`)
      .join(' ');

    if (metaStr) {
      logLine += ` ${dimColor}{${metaStr}}${reset}`;
    }
  }

  return logLine;
});

// File transports with custom formatting
const infoTransport = new winston.transports.DailyRotateFile({
  level: 'info',
  filename: path.join(logDirectory, 'bot-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  format: winston.format.combine(winston.format.timestamp(), format),
});

const errorTransport = new winston.transports.DailyRotateFile({
  level: 'error',
  filename: path.join(logDirectory, 'bot-error-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d',
  format: winston.format.combine(winston.format.timestamp(), format),
});

// Debug transport for development
const debugTransport = new winston.transports.DailyRotateFile({
  level: 'debug',
  filename: path.join(logDirectory, 'bot-debug-%DATE%.log'),
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '10m',
  maxFiles: '7d',
  format: winston.format.combine(winston.format.timestamp(), format),
});

// Create logger with custom formatting
const logger = winston.createLogger({
  level: level,
  transports: [
    infoTransport,
    errorTransport,
    ...(isDevelopment ? [debugTransport] : []),
    new winston.transports.Console({
      level: level,
      format: winston.format.combine(winston.format.timestamp(), consoleFormat),
    }),
  ],
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logDirectory, 'bot-crash-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: winston.format.combine(winston.format.timestamp(), format),
    }),
  ],
  rejectionHandlers: [
    new winston.transports.DailyRotateFile({
      filename: path.join(logDirectory, 'bot-crash-%DATE%.log'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '30d',
      format: winston.format.combine(winston.format.timestamp(), format),
    }),
  ],
});

// Add convenience methods for Discord bot modules
logger.discord = {
  // Bot lifecycle events
  ready: (msg, meta = {}) => logger.info(msg, { ...meta, module: 'discord' }),
  connect: (msg, meta = {}) => logger.info(msg, { ...meta, module: 'discord' }),
  disconnect: (msg, meta = {}) => logger.warn(msg, { ...meta, module: 'discord' }),
  error: (msg, meta = {}) => logger.error(msg, { ...meta, module: 'discord' }),

  // Command handling
  command: (msg, meta = {}) => logger.info(msg, { ...meta, module: 'commands' }),
  cmdError: (msg, meta = {}) => logger.error(msg, { ...meta, module: 'commands' }),

  // Event handling
  event: (msg, meta = {}) => logger.debug(msg, { ...meta, module: 'events' }),

  // Database operations
  db: (msg, meta = {}) => logger.info(msg, { ...meta, module: 'database' }),
  dbError: (msg, meta = {}) => logger.error(msg, { ...meta, module: 'database' }),

  // API calls
  api: (msg, meta = {}) => logger.debug(msg, { ...meta, module: 'api' }),
  apiError: (msg, meta = {}) => logger.error(msg, { ...meta, module: 'api' }),
};

// Bot startup log
logger.info('Discord bot logger initialized', {
  environment: isDevelopment ? 'development' : 'production',
  logLevel: level,
});

export default logger;
