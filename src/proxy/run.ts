import { spawn as defaultSpawn, type ChildProcessByStdio } from 'node:child_process';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { ProxyConfig } from '../config.js';
import { loadBaseline, processToolsList, saveBaseline } from '../drift/baseline.js';
import { buildDriftRecord, buildMessageRecord } from '../provenance/record.js';
import { ProvenanceStore } from '../provenance/store.js';
import { SeqCounter, newSessionId } from '../types.js';
import type { ClassifiedMessage, Direction } from '../types.js';
import { Correlator } from './correlator.js';
import { classifyLine } from './jsonrpc.js';
import { type BoundedLineReaderHandle, readBoundedLines } from './line-reader.js';

export interface RunProxyOptions {
  config: ProxyConfig;
  /** Stands in for process.stdin in production; a test drives this to play the client. */
  clientInput: Readable;
  /** Stands in for process.stdout in production; a test reads this to see what the client receives. */
  clientOutput: Writable;
  stderr?: Writable;
  spawn?: typeof defaultSpawn;
  /** Hard cap on a single JSON-RPC line's size, guarding against unbounded memory growth
   * from a broken/malicious peer that never sends a newline. Defaults to 10 MB, matching
   * the MCP SDK's own StdioServerTransport default. */
  maxLineBytes?: number;
}

interface ToolCallParams {
  name?: string;
  arguments?: unknown;
}

interface ToolsListResult {
  tools?: { name: string; description?: string; inputSchema?: unknown }[];
}

/**
 * Spawns the configured upstream server and relays JSON-RPC lines between
 * clientInput/clientOutput and the child's stdio, byte-for-byte, while tapping
 * the stream on the side to build provenance records. Resolves with the exit
 * code the upstream process terminated with once both sides have closed.
 */
export function runProxy(options: RunProxyOptions): Promise<number> {
  const spawnFn = options.spawn ?? defaultSpawn;
  const stderr = options.stderr ?? process.stderr;
  const warn = (message: string): void => {
    stderr.write(`[mcp-provenance-proxy] ${message}\n`);
  };

  const sessionId = newSessionId();
  const sessionFilePath = join(options.config.storageDir, 'sessions', `${sessionId}.jsonl`);
  const baselineFilePath = join(options.config.storageDir, 'baseline.json');

  const store = new ProvenanceStore(sessionFilePath);
  const seqSource = new SeqCounter();
  const correlator = new Correlator({ seqSource, onWarning: warn });
  let baseline = loadBaseline(baselineFilePath);
  const pendingToolsListIds = new Set<string>();

  const child = spawnFn(options.config.upstream.command, options.config.upstream.args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...options.config.upstream.env },
  }) as ChildProcessByStdio<Writable, Readable, Readable>;

  child.stderr.pipe(stderr, { end: false });

  function writeWithBackpressure(dest: Writable, source: Readable, line: string): void {
    const ok = dest.write(`${line}\n`);
    if (!ok) {
      source.pause();
      dest.once('drain', () => source.resume());
    }
  }

  function recordMessage(direction: Direction, classified: ClassifiedMessage): void {
    let toolName: string | undefined;
    let toolArguments: unknown;
    if (classified.kind === 'request' && classified.method === 'tools/call') {
      const params = classified.params as ToolCallParams | undefined;
      if (params && typeof params.name === 'string') toolName = params.name;
      if (params && Object.prototype.hasOwnProperty.call(params, 'arguments')) {
        toolArguments = params.arguments;
      }
    }

    const now = Date.now();
    const correlation = correlator.correlate({
      kind: classified.kind,
      direction,
      id: classified.id,
      method: classified.method,
      toolName,
      now,
    });

    const record = buildMessageRecord({
      sessionId,
      seq: correlation.seq,
      timestamp: new Date(now).toISOString(),
      parentSeq: correlation.parentSeq,
      kind: classified.kind,
      direction,
      jsonrpcId: classified.id,
      method: classified.method,
      ...(toolName !== undefined && { toolName }),
      ...(toolArguments !== undefined && { toolArguments }),
      ...(classified.params !== undefined && toolName === undefined && { params: classified.params }),
      ...(classified.result !== undefined && { result: classified.result }),
      ...(classified.error !== undefined && { error: classified.error }),
      ...(correlation.latencyMs !== undefined && { latencyMs: correlation.latencyMs }),
      ...(correlation.requestSeq !== undefined && { requestSeq: correlation.requestSeq }),
    });
    store.append(record);

    if (
      direction === 'client->server' &&
      classified.kind === 'request' &&
      classified.method === 'tools/list' &&
      classified.id !== null
    ) {
      pendingToolsListIds.add(String(classified.id));
      return;
    }

    if (
      direction !== 'server->client' ||
      classified.kind !== 'response' ||
      classified.id === null ||
      !pendingToolsListIds.has(String(classified.id))
    ) {
      return;
    }
    pendingToolsListIds.delete(String(classified.id));

    const tools = (classified.result as ToolsListResult | undefined)?.tools;
    if (!Array.isArray(tools)) return;

    const { baseline: nextBaseline, driftEvents } = processToolsList(baseline, tools, {
      sessionId,
      timestamp: new Date(now).toISOString(),
    });
    baseline = nextBaseline;
    saveBaseline(baselineFilePath, baseline);

    for (const event of driftEvents) {
      const driftRecord = buildDriftRecord({
        sessionId,
        seq: seqSource.next(),
        timestamp: new Date().toISOString(),
        parentSeq: correlation.seq,
        driftType: event.driftType,
        toolName: event.toolName,
        severity: event.severity,
        ...(event.descriptionDiff !== undefined && { descriptionDiff: event.descriptionDiff }),
        ...(event.schemaDiff !== undefined && { schemaDiff: event.schemaDiff }),
      });
      store.append(driftRecord);
    }
  }

  function handleLine(direction: Direction, raw: string, forwardTo: Writable, source: Readable): void {
    writeWithBackpressure(forwardTo, source, raw);
    try {
      const classified = classifyLine(raw);
      recordMessage(direction, classified);
    } catch (err) {
      warn(`failed to record ${direction} line: ${(err as Error).message}`);
    }
  }

  let settled = false;
  let clientReader: BoundedLineReaderHandle | undefined;
  let serverReader: BoundedLineReaderHandle | undefined;
  let resolveExit: (code: number) => void;
  const exitPromise = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  const onSignal = (signal: NodeJS.Signals): void => {
    child.kill(signal);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  function finish(code: number): void {
    if (settled) return;
    settled = true;
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    clientReader?.dispose();
    serverReader?.dispose();
    // Harmless if the child already exited or never started (kill() on it is then a no-op) —
    // but required when finish() is triggered by something other than the child's own exit
    // (e.g. an oversized line), where the child would otherwise be left running as an orphan.
    child.kill();
    resolveExit(code);
  }

  child.on('error', (err) => {
    warn(`failed to start upstream command "${options.config.upstream.command}": ${err.message}`);
    finish(1);
  });

  child.on('exit', (code, signal) => {
    finish(code ?? (signal ? 1 : 0));
  });

  clientReader = readBoundedLines(
    options.clientInput,
    {
      onLine: (line) => handleLine('client->server', line, child.stdin, options.clientInput),
      onOversized: (maxLineBytes) => {
        warn(`client->server line exceeded ${maxLineBytes} bytes without a terminating newline; stopping`);
        finish(1);
      },
      onClose: () => {
        child.stdin.end();
      },
    },
    { maxLineBytes: options.maxLineBytes },
  );

  serverReader = readBoundedLines(
    child.stdout,
    {
      onLine: (line) => handleLine('server->client', line, options.clientOutput, child.stdout),
      onOversized: (maxLineBytes) => {
        warn(`server->client line exceeded ${maxLineBytes} bytes without a terminating newline; stopping`);
        finish(1);
      },
    },
    { maxLineBytes: options.maxLineBytes },
  );

  return exitPromise;
}
