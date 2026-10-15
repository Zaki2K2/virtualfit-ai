/**
 * Minimal logger. Callers must only pass non-sensitive metadata:
 * never image bytes, file contents, tokens or personal measurements.
 */
type Level = 'info' | 'warn' | 'error';

function write(level: Level, message: string, meta?: Record<string, unknown>) {
  if (process.env.NODE_ENV === 'test') return;
  const line = JSON.stringify({ level, time: new Date().toISOString(), message, ...meta });
  (level === 'error' ? console.error : console.log)(line);
}

export const logger = {
  info: (m: string, meta?: Record<string, unknown>) => write('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write('error', m, meta),
};
