import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import type { Container } from './container';
import { createErrorHandler, notFoundHandler } from './middleware/error-handler';
import { guestSession } from './middleware/guest-session';
import { createUpload } from './middleware/upload';
import { ClothingController } from './modules/clothing/clothing.controller';
import { clothingRoutes } from './modules/clothing/clothing.routes';
import { FavoritesController } from './modules/favorites/favorites.controller';
import { favoritesRoutes } from './modules/favorites/favorites.routes';
import { healthRoutes } from './modules/health/health.routes';
import { HistoryController } from './modules/history/history.controller';
import { historyRoutes } from './modules/history/history.routes';
import { TryOnController } from './modules/try-on/try-on.controller';
import { tryOnRoutes } from './modules/try-on/try-on.routes';
import { UsersController } from './modules/users/users.controller';
import { usersRoutes } from './modules/users/users.routes';

export function createApp(c: Container) {
  const { env } = c;
  const isProd = env.NODE_ENV === 'production';
  const upload = createUpload(env.maxUploadBytes);
  const limitedMessage = {
    error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down.' },
  };
  const noLimit = (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
    next();
  const tryOnLimiter =
    env.NODE_ENV === 'test'
      ? noLimit
      : rateLimit({
          windowMs: 60 * 60 * 1000,
          limit: 30,
          standardHeaders: 'draft-8',
          legacyHeaders: false,
          message: limitedMessage,
        });
  const generalLimiter =
    env.NODE_ENV === 'test'
      ? noLimit
      : rateLimit({
          windowMs: 15 * 60 * 1000,
          limit: 600,
          standardHeaders: 'draft-8',
          legacyHeaders: false,
          message: limitedMessage,
        });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // the Next.js server proxies /api and sets X-Forwarded-For
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(generalLimiter);
  api.use('/health', healthRoutes(c.health));
  api.use(guestSession(isProd));
  api.use('/clothing', clothingRoutes(new ClothingController(c.clothing), upload.single('image')));
  api.use(
    '/try-on',
    tryOnRoutes(
      new TryOnController(c.tryOns),
      upload.fields([
        { name: 'person', maxCount: 1 },
        { name: 'garment', maxCount: 1 },
      ]),
      tryOnLimiter,
    ),
  );
  api.use('/history', historyRoutes(new HistoryController(c.history)));
  api.use('/favorites', favoritesRoutes(new FavoritesController(c.favorites)));
  api.use('/profile', usersRoutes(new UsersController(c.users, c.eraser)));

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(createErrorHandler(env.MAX_UPLOAD_MB));
  return app;
}
