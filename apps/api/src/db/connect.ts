import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export async function connectMongo(uri: string): Promise<void> {
  mongoose.set('strictQuery', true);
  // Queries issued while the database is unreachable fail after 5 s instead of hanging for the
  // default 10 s; the error handler turns them into a 503 DATABASE_UNAVAILABLE.
  mongoose.set('bufferTimeoutMS', 5000);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info('MongoDB reconnected'));
  logger.info('MongoDB connected');
}

export async function disconnectMongo(): Promise<void> {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
