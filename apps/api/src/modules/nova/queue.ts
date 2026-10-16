import { AppError } from '../../utils/errors';

export class InferenceQueue {
  active = 0;
  private waiting: Array<() => void> = [];
  constructor(
    readonly concurrency: number,
    private readonly capacity: number,
  ) {}
  get queued() {
    return this.waiting.length;
  }
  async run<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.capacity)
        throw new AppError(429, 'RATE_LIMITED', 'Nova inference queue is full. Retry shortly.');
      await new Promise<void>((resolve, reject) => {
        const resume = () => {
          signal.removeEventListener('abort', cancel);
          resolve();
        };
        const cancel = () => {
          this.waiting = this.waiting.filter((item) => item !== resume);
          reject(signal.reason);
        };
        this.waiting.push(resume);
        signal.addEventListener('abort', cancel, { once: true });
      });
      // The releasing job transferred its active slot to this waiter.
    } else this.active++;
    try {
      signal.throwIfAborted();
      return await task();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}
