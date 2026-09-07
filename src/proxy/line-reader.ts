import type { Readable } from 'node:stream';

export const DEFAULT_MAX_LINE_BYTES = 10 * 1024 * 1024;

export interface BoundedLineReaderCallbacks {
  onLine: (line: string) => void;
  /** Fired once, in place of any further onLine calls, when a single line exceeds maxLineBytes. */
  onOversized: (maxLineBytes: number) => void;
  onClose?: () => void;
}

export interface BoundedLineReaderOptions {
  maxLineBytes?: number;
}

export interface BoundedLineReaderHandle {
  dispose(): void;
}

/**
 * Reads newline-delimited lines off a raw byte stream, like readline, but enforces
 * a hard cap on a single line's size. Without this, a broken or malicious upstream
 * or client emitting a never-terminated line grows this proxy's memory unboundedly —
 * the MCP SDK's own StdioServerTransport guards against exactly this (a bounded read
 * buffer that errors and closes on overflow), so this mirrors that rather than
 * inventing new recovery behavior. On overflow, reading stops and the incomplete
 * line is never forwarded or recorded — better to stop pass-through cleanly than to
 * silently drop or truncate bytes, which would break the "unmodified relay" contract.
 */
export function readBoundedLines(
  stream: Readable,
  callbacks: BoundedLineReaderCallbacks,
  options?: BoundedLineReaderOptions,
): BoundedLineReaderHandle {
  const maxLineBytes = options?.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES;
  let chunks: Buffer[] = [];
  let length = 0;
  let stopped = false;

  function onData(chunk: Buffer): void {
    if (stopped) return;
    let start = 0;
    for (;;) {
      const newlineIndex = chunk.indexOf(0x0a, start);
      if (newlineIndex === -1) {
        const remainder = chunk.subarray(start);
        if (length + remainder.length > maxLineBytes) {
          overflow();
          return;
        }
        if (remainder.length > 0) {
          chunks.push(Buffer.from(remainder));
          length += remainder.length;
        }
        return;
      }

      const piece = chunk.subarray(start, newlineIndex);
      if (length + piece.length > maxLineBytes) {
        overflow();
        return;
      }
      chunks.push(Buffer.from(piece));
      length += piece.length;

      const lineBuf = Buffer.concat(chunks, length);
      chunks = [];
      length = 0;

      const hasTrailingCR = lineBuf.length > 0 && lineBuf[lineBuf.length - 1] === 0x0d;
      const line = (hasTrailingCR ? lineBuf.subarray(0, lineBuf.length - 1) : lineBuf).toString('utf8');
      callbacks.onLine(line);

      start = newlineIndex + 1;
    }
  }

  function overflow(): void {
    stopped = true;
    stream.removeListener('data', onData);
    stream.removeListener('end', onEnd);
    callbacks.onOversized(maxLineBytes);
  }

  function onEnd(): void {
    stream.removeListener('data', onData);
    callbacks.onClose?.();
  }

  stream.on('data', onData);
  stream.once('end', onEnd);

  return {
    dispose(): void {
      stopped = true;
      stream.removeListener('data', onData);
      stream.removeListener('end', onEnd);
    },
  };
}
