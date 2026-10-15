import { createApp } from './app';
import { loadEnv } from './config/env';
import { createContainer } from './container';
import { mongoCollectionFactory } from './db/collection';
import { connectMongo, disconnectMongo } from './db/connect';
import { logger } from './utils/logger';

async function main() {
  const env = loadEnv();

  let container;
  if (env.MONGODB_URI) {
    try {
      await connectMongo(env.MONGODB_URI);
      container = createContainer(env, {
        collections: mongoCollectionFactory,
        database: 'mongodb',
      });
    } catch (err) {
      logger.error('MongoDB connection failed; falling back to in-memory store', {
        message: (err as Error).message,
      });
    }
  }
  container ??= createContainer(env);
  if (container.health().database === 'memory') {
    logger.warn('Running with in-memory storage: history and favorites are lost on restart.');
  }

  const app = createApp(container);
  const server = app.listen(env.API_PORT, () => {
    const ai = container.health().ai;
    logger.info(`API listening on http://localhost:${env.API_PORT}`, {
      aiProvider: ai.provider,
      aiConfigured: ai.configured,
      simulated: ai.simulated,
    });
  });

  const purgeTimer = setInterval(
    () => void container.purge().catch(() => undefined),
    10 * 60 * 1000,
  );
  purgeTimer.unref();
  void container.purge().catch(() => undefined);

  const shutdown = () => {
    clearInterval(purgeTimer);
    server.close(() => void disconnectMongo().finally(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Failed to start API', { message: (err as Error).message });
  process.exit(1);
});
