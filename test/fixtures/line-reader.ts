import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';

/** Lets a test await the next newline-delimited line out of a stream, queuing lines
 * that arrive before they're asked for. */
export class LineReader {
  private readonly queue: string[] = [];
  private readonly waiters: ((line: string) => void)[] = [];

  constructor(stream: Readable) {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on('line', (line) => {
      const waiter = this.waiters.shift();
      if (waiter) waiter(line);
      else this.queue.push(line);
    });
  }

  next(): Promise<string> {
    const queued = this.queue.shift();
    if (queued !== undefined) return Promise.resolve(queued);
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
