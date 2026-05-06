import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import swaggerUi from 'swagger-ui-express';
import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { PrismaClient } from '@prisma/client';
import { findAuthorizedKey, getApiKeysFilePath, getMasterApiKey } from './auth';
import { setupRoutes } from './routes';
import { startCleanupJob } from './cleanup';
import { logger, httpLogger } from './logger';

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;
export const prisma = new PrismaClient();

const DEFAULT_ALLOWED_ORIGINS = [
  'https://kojumi.com',
  'https://www.kojumi.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

const allowedCorsOrigins = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedCorsOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  }
}));
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    httpLogger.info({
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: duration,
      ip: req.ip,
    });
  });
  next();
});

try {
  const file = fs.readFileSync(path.resolve(__dirname, './swagger.yaml'), 'utf8');
  const swaggerDocument = YAML.parse(file);
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
} catch (e) {
  logger.warn("Swagger documentation file not found or invalid.");
}

// ヘルスチェック
app.get('/health', (req, res) => {
  res.json({ status: 'ok', environment: 'beta1' });
});

const PUBLIC_GET_PATHS = new Set([
  '/skill',
  '/leaderboard',
  '/activities',
  '/benchmarks',
  '/benchmark-cups',
  '/agents',
]);

const isPublicGetPath = (req: express.Request) => {
  if (req.query.include_trial === 'true') {
    return false;
  }
  return PUBLIC_GET_PATHS.has(req.path) || /^\/agents\/[^/]+$/.test(req.path);
};

// Beta1用のミドルウェア: 公開GETは明示allowlistのみ、それ以外はAPIキー必須
export const requireApiKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.method === 'OPTIONS') {
    return next();
  }

  if (req.method === 'POST' && req.path === '/trial-keys') {
    return next();
  }

  if (req.method === 'GET' && isPublicGetPath(req)) {
    return next();
  }

  const providedKeyRaw = req.headers['x-api-key'];
  const providedKey = (Array.isArray(providedKeyRaw) ? providedKeyRaw[0] : providedKeyRaw)?.trim();
  if (!getMasterApiKey() && !providedKey) {
    return res.status(503).json({ error: 'Authenticated API access is disabled until API key management is configured on the server.' });
  }

  const authorizedKey = findAuthorizedKey(providedKey);
  if (!authorizedKey) {
    return res.status(401).json({ error: 'Unauthorized. Valid x-api-key header is required for this Beta1 API endpoint.' });
  }

  req.headers['x-auth-role'] = authorizedKey.role;
  req.headers['x-auth-key-kind'] = authorizedKey.kind;
  req.headers['x-auth-key-id'] = authorizedKey.id;
  req.headers['x-auth-requester-tags'] = authorizedKey.requesterTags.join(',');
  if (authorizedKey.expiresAt) {
    req.headers['x-auth-key-expires-at'] = authorizedKey.expiresAt;
  }
  req.headers['x-auth-contract-creation'] = authorizedKey.capabilities.contractCreation ? 'true' : 'false';
  req.headers['x-auth-benchmark-publishing'] = authorizedKey.capabilities.benchmarkPublishing ? 'true' : 'false';
  req.headers['x-auth-benchmark-heartbeat'] = authorizedKey.capabilities.benchmarkHeartbeat ? 'true' : 'false';
  next();
};

app.use('/v1', requireApiKey);

// ルーティングの登録
setupRoutes(app);

if (process.env.NODE_ENV !== 'test') {
  if (!getMasterApiKey()) {
    logger.warn('MASTER_API_KEY is not configured. Only previously issued participant keys will be accepted.');
  }

  app.listen(port, () => {
    logger.info({ port }, 'Kojumi Beta1 API Server started');
    logger.info({ docs_url: `http://0.0.0.0:${port}/docs` }, 'API Documentation');
    logger.warn('Beta1 environment: All settlements are MOCKED and use virtual credits.');
    logger.info({ keys_file: getApiKeysFilePath() }, 'Participant API key store');
    startCleanupJob();
  });
}

export default app;
