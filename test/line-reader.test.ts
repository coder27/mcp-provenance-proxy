import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readBoundedLines } from '../src/proxy/line-reader.js';

function collect() {
  const lines: string[] = [];
  const oversized: number[] = [];
  let closed = false;
  return {
    lines,
    oversized,
    get closed() {
      return closed;
    },
    callbacks: {
      onLine: (line: string) => lines.push(line),
      onOversized: (max: number) => oversized.push(max),
      onClose: () => {
        closed = true;
      },
    },
  };
}

describe('readBoundedLines', () => {
  it('splits a single chunk containing multiple lines', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks);
    stream.write('one\ntwo\nthree\n');
    expect(c.lines).toEqual(['one', 'two', 'three']);
  });

  it('reassembles a line split across multiple chunks', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks);
    stream.write('hel');
    stream.write('lo wor');
    stream.write('ld\n');
    expect(c.lines).toEqual(['hello world']);
  });

  it('strips a trailing CR for CRLF line endings', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks);
    stream.write('a\r\nb\r\n');
    expect(c.lines).toEqual(['a', 'b']);
  });

  it('forwards a genuinely empty line unchanged', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks);
    stream.write('one\n\ntwo\n');
    expect(c.lines).toEqual(['one', '', 'two']);
  });

  it('does not emit a final unterminated fragment (matches "no invented recovery")', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks);
    stream.write('complete\n');
    stream.write('trailing fragment, no newline');
    stream.end();
    expect(c.lines).toEqual(['complete']);
  });

  it('fires onClose when the stream ends', async () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks);
    stream.write('x\n');
    stream.end();
    await new Promise((resolve) => setImmediate(resolve));
    expect(c.closed).toBe(true);
  });

  it('stays under the cap for a line right at the limit', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks, { maxLineBytes: 10 });
    stream.write(`${'a'.repeat(10)}\n`);
    expect(c.lines).toEqual(['a'.repeat(10)]);
    expect(c.oversized).toEqual([]);
  });

  it('reports overflow for a single chunk exceeding maxLineBytes with no newline', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks, { maxLineBytes: 10 });
    stream.write('a'.repeat(11));
    expect(c.oversized).toEqual([10]);
    expect(c.lines).toEqual([]);
  });

  it('reports overflow for accumulation across multiple small chunks', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks, { maxLineBytes: 10 });
    stream.write('aaaaa');
    expect(c.oversized).toEqual([]);
    stream.write('aaaaaa'); // 5 + 6 = 11 > 10
    expect(c.oversized).toEqual([10]);
  });

  it('stops processing after overflow: no further onLine calls even if more data arrives', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks, { maxLineBytes: 5 });
    stream.write('x'.repeat(6));
    expect(c.oversized).toEqual([5]);
    stream.write('more\ndata\n');
    expect(c.lines).toEqual([]);
  });

  it('dispose() stops delivering further lines', () => {
    const c = collect();
    const stream = new PassThrough();
    const handle = readBoundedLines(stream, c.callbacks);
    stream.write('one\n');
    handle.dispose();
    stream.write('two\n');
    expect(c.lines).toEqual(['one']);
  });

  it('a line exactly at the cap followed by another line does not falsely overflow', () => {
    const c = collect();
    const stream = new PassThrough();
    readBoundedLines(stream, c.callbacks, { maxLineBytes: 4 });
    stream.write('abcd\nabcd\n');
    expect(c.lines).toEqual(['abcd', 'abcd']);
    expect(c.oversized).toEqual([]);
  });
});
