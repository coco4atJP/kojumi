import pino from 'pino';
import path from 'path';

const logDir = path.resolve(__dirname, '../logs');
const maxFiles = Number(process.env.KOJUMI_LOG_MAX_FILES || 7);
const maxSize = process.env.KOJUMI_LOG_MAX_SIZE ? Number(process.env.KOJUMI_LOG_MAX_SIZE) : '10m';

export const logger = pino(
  { level: process.env.KOJUMI_LOG_LEVEL || 'info' },
  pino.transport({
    target: 'pino-roll',
    options: {
      file: path.join(logDir, 'kojumi'),
      size: maxSize,
      frequency: 'daily',
      extension: '.log',
      mkdir: true,
      limit: { count: maxFiles }
    }
  })
);

export const httpLogger = pino(
  { level: 'info' },
  pino.transport({
    target: 'pino-roll',
    options: {
      file: path.join(logDir, 'http'),
      size: maxSize,
      frequency: 'daily',
      extension: '.log',
      mkdir: true,
      limit: { count: maxFiles }
    }
  })
);
