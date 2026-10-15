import mongoose from 'mongoose';
import { createApp } from './app';
import { loadEnv } from './config/env';
import { createContainer } from './container';
import { mongoCollectionFactory } from './db/collection';
import { connectMongo, disconnectMongo } from './db/connect';
import { logger } from './utils/logger';
import { isPortInUse } from './utils/port';

async function main() {
  const env = loadEnv();

  // Fail fast and loudly if another process already owns the port (stale dev server, etc.).
  if (await isPortInUse(env.API_PORT)) {
    throw new Error(
      `Port ${env.API_PORT} is already in use by another process. Stop it (or set API_PORT) and retry.`,
    );
  }

  let container;
  if (env.MONGODB_URI) {
    try {
      await connectMongo(env.MONGODB_URI);
      container = createContainer(env, {
        collections: mongoCollectionFactory,
        database: 'mongodb',
        databaseUp: () => mongoose.connection.readyState === 1,
      });
    } catch (err) {
      logger.error('MongoDB connection failed; falling back to in-memory store', {
        message: (err as Error).message,
      });
    }
  }
  container ??= createContainer(env);
  const status = await container.health();
  if (status.database === 'memory') {
    logger.warn('Running with in-memory storage: history and favorites are lost on restart.');
  }

  await container.recoverInterruptedJobs();

  const app = createApp(container);
  const server = app.listen(env.API_PORT, () => {
    const ai = status.ai;
    logger.info(`API listening on http://localhost:${env.API_PORT}`, {
      aiProvider: ai.provider,
      aiConfigured: ai.configured,
      simulated: ai.simulated,
    });
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.error(
      err.code === 'EADDRINUSE'
        ? `Port ${env.API_PORT} is already in use by another process.`
        : `HTTP server error: ${err.message}`,
    );
    process.exit(1);
  });

  const purgeTimer = setInterval(
    () => void container.purge().catch(() => undefined),
    10 * 60 * 1000,
  );
  purgeTimer.unref();
  void container.purge().catch(() => undefined);

  const shutdown = () => {
    clearInterval(purgeTimer);
    // Never wait for idle keep-alive connections (browsers, the Next proxy): a hung shutdown
    // leaves the old process holding the port while a restarted one fails to take over.
    const force = setTimeout(() => process.exit(0), 3000);
    force.unref();
    server.close(() => void disconnectMongo().finally(() => process.exit(0)));
    server.closeIdleConnections();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.error('Failed to start API', { message: (err as Error).message });
  process.exit(1);
});
