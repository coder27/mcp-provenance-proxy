import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDriftRecord, buildMessageRecord } from '../src/provenance/record.js';
import { ProvenanceStore } from '../src/provenance/store.js';
import { LineReader } from './fixtures/line-reader.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const cliPath = join(testDir, '..', 'src', 'cli.ts');
const tsxBin = join(testDir, '..', 'node_modules', '.bin', 'tsx');

let storageDir: string;
let proc: ReturnType<typeof spawn>;
let reader: LineReader;
let nextId = 1;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'mcp-provenance-server-test-'));
});

afterEach(() => {
  proc?.kill();
});

function seedSession(sessionId: string): void {
  const store = new ProvenanceStore(join(storageDir, 'sessions', `${sessionId}.jsonl`));
  store.append(
    buildMessageRecord({
      sessionId,
      seq: 1,
      timestamp: '2026-01-01T00:00:00.000Z',
      parentSeq: null,
      kind: 'request',
      direction: 'client->server',
      jsonrpcId: 1,
      method: 'tools/call',
      toolName: 'search_notes',
      toolArguments: { query: 'x' },
    }),
  );
  store.append(
    buildMessageRecord({
      sessionId,
      seq: 2,
      timestamp: '2026-01-01T00:00:01.000Z',
      parentSeq: 1,
      kind: 'response',
      direction: 'server->client',
      jsonrpcId: 1,
      method: null,
      result: { content: [] },
      latencyMs: 5,
      requestSeq: 1,
    }),
  );
  store.append(
    buildDriftRecord({
      sessionId,
      seq: 3,
      timestamp: '2026-01-01T00:00:02.000Z',
      parentSeq: 2,
      driftType: 'description-changed',
      toolName: 'search_notes',
      severity: 'high',
      descriptionDiff: { old: 'benign', new: 'escalated' },
    }),
  );
}

function startServer(): LineReader {
  proc = spawn(tsxBin, [cliPath, 'serve', '--storage-dir', storageDir], { stdio: ['pipe', 'pipe', 'inherit'] });
  reader = new LineReader(proc.stdout!);
  return reader;
}

function send(obj: unknown): void {
  proc.stdin!.write(`${JSON.stringify(obj)}\n`);
}

async function callTool(name: string, args: Record<string, unknown> = {}): Promise<any> {
  const id = nextId++;
  send({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  const line = await reader.next();
  return JSON.parse(line);
}

async function initialize(): Promise<void> {
  send({
    jsonrpc: '2.0',
    id: nextId++,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test-client', version: '0.0.1' } },
  });
  await reader.next();
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

describe('mcp-provenance-proxy serve', () => {
  it('advertises list_sessions, replay_session, verify_session, list_drift, tool_history', async () => {
    startServer();
    await initialize();
    send({ jsonrpc: '2.0', id: nextId++, method: 'tools/list', params: {} });
    const response = JSON.parse(await reader.next());
    const names = response.result.tools.map((t: { name: string }) => t.name).sort();
    expect(names).toEqual(['list_drift', 'list_sessions', 'replay_session', 'tool_history', 'verify_session']);
  }, 20000);

  it('tool_history surfaces the drift record for a real tool and rejects a missing toolName', async () => {
    seedSession('sess-1');
    startServer();
    await initialize();

    const history = await callTool('tool_history', { toolName: 'search_notes' });
    expect(history.result.content[0].text).toMatch(/description-changed/);
    expect(history.result.content[0].text).toMatch(/old: benign/);
    expect(history.result.content[0].text).toMatch(/new: escalated/);

    const missingArg = await callTool('tool_history', {});
    expect(missingArg.result.isError).toBe(true);
    expect(missingArg.result.content[0].text).toMatch(/toolName is required/);
  }, 20000);

  it('list_sessions reflects real session files on disk', async () => {
    seedSession('sess-1');
    startServer();
    await initialize();
    const response = await callTool('list_sessions');
    expect(response.result.content[0].text).toMatch(/^sess-1\s+records=3\s+drift=1/);
  }, 20000);

  it('replay_session returns the indented call chain for a real session', async () => {
    seedSession('sess-1');
    startServer();
    await initialize();
    const response = await callTool('replay_session', { sessionId: 'sess-1' });
    const text = response.result.content[0].text;
    expect(text).toMatch(/\[#1\] request client->server tools\/call tool=search_notes/);
    expect(text).toMatch(/\[#3\] DRIFT\[high\] description-changed tool=search_notes/);
  }, 20000);

  it('verify_session reports OK for an intact chain and isError for a tampered one', async () => {
    seedSession('sess-1');
    startServer();
    await initialize();

    const ok = await callTool('verify_session', { sessionId: 'sess-1' });
    expect(ok.result.content[0].text).toMatch(/^OK:/);
    expect(ok.result.isError).toBeFalsy();

    // tamper with the file on disk, then ask again over the same connection
    const { readFileSync, writeFileSync } = await import('node:fs');
    const filePath = join(storageDir, 'sessions', 'sess-1.jsonl');
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    const tampered = JSON.parse(lines[0]!);
    tampered.toolName = 'evil_tool';
    lines[0] = JSON.stringify(tampered);
    writeFileSync(filePath, `${lines.join('\n')}\n`);

    const tamperedResp = await callTool('verify_session', { sessionId: 'sess-1' });
    expect(tamperedResp.result.content[0].text).toMatch(/^TAMPERED:/);
    expect(tamperedResp.result.isError).toBe(true);
  }, 20000);

  it('list_drift lists events and rejects a missing sessionId for replay/verify', async () => {
    seedSession('sess-1');
    startServer();
    await initialize();

    const drift = await callTool('list_drift');
    expect(drift.result.content[0].text).toMatch(/HIGH description-changed tool=search_notes/);

    const missingArg = await callTool('replay_session', {});
    expect(missingArg.result.isError).toBe(true);
    expect(missingArg.result.content[0].text).toMatch(/sessionId is required/);
  }, 20000);
});
