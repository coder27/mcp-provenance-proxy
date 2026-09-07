import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listDrift } from '../src/commands/drift.js';
import { replaySession } from '../src/commands/replay.js';
import { verifyCommand } from '../src/commands/verify.js';
import { main } from '../src/cli.js';
import { buildDriftRecord, buildMessageRecord } from '../src/provenance/record.js';
import { ProvenanceStore } from '../src/provenance/store.js';

let storageDir: string;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'mcp-provenance-commands-test-'));
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
      latencyMs: 1000,
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

describe('replaySession', () => {
  it('renders an indented call chain nesting the response under its request', () => {
    seedSession('sess-1');
    const output = replaySession(storageDir, 'sess-1');
    const lines = output.split('\n');
    expect(lines[0]).toMatch(/^\[#1\] request client->server tools\/call tool=search_notes/);
    expect(lines[1]).toMatch(/^\s+\[#2\] response server->client \(response\) 1000ms/);
    expect(lines[2]).toMatch(/^\s+\[#3\] DRIFT\[high\] description-changed tool=search_notes/);
  });

  it('reports a clear message for a missing session', () => {
    expect(replaySession(storageDir, 'nope')).toMatch(/No records found/);
  });
});

describe('verifyCommand', () => {
  it('reports OK for a valid chain', () => {
    seedSession('sess-1');
    const result = verifyCommand(storageDir, 'sess-1');
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/^OK: 3 record\(s\) verified/);
  });

  it('reports TAMPERED with line/reason for a corrupted chain', () => {
    seedSession('sess-1');
    const filePath = join(storageDir, 'sessions', 'sess-1.jsonl');
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    const tampered = JSON.parse(lines[0]);
    tampered.toolName = 'evil_tool';
    lines[0] = JSON.stringify(tampered);
    writeFileSync(filePath, `${lines.join('\n')}\n`);

    const result = verifyCommand(storageDir, 'sess-1');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^TAMPERED: line 1: hash-mismatch-tampered/);
  });

  it('reports NOT FOUND for a missing session', () => {
    const result = verifyCommand(storageDir, 'nope');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/^NOT FOUND/);
  });
});

describe('listDrift', () => {
  it('lists drift events across all sessions when unscoped', () => {
    seedSession('sess-1');
    seedSession('sess-2');
    const output = listDrift(storageDir);
    expect(output.split('\n')).toHaveLength(2);
    expect(output).toMatch(/\[sess-1\] #3 HIGH description-changed tool=search_notes/);
    expect(output).toMatch(/\[sess-2\] #3 HIGH description-changed tool=search_notes/);
  });

  it('scopes to a single session when given one', () => {
    seedSession('sess-1');
    seedSession('sess-2');
    const output = listDrift(storageDir, 'sess-1');
    expect(output.split('\n')).toHaveLength(1);
    expect(output).toMatch(/\[sess-1\]/);
  });

  it('reports a clear message when there are no drift events', () => {
    expect(listDrift(storageDir)).toBe('No drift events found.');
  });
});

describe('cli main() dispatch', () => {
  it('returns 0 and prints OK for a valid verify', async () => {
    seedSession('sess-1');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await main(['verify', 'sess-1', '--storage-dir', storageDir]);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/^OK:/));
    logSpy.mockRestore();
  });

  it('returns 1 and prints usage for an unknown subcommand', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['bogus']);
    expect(code).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringMatching(/^Usage:/));
    errSpy.mockRestore();
  });

  it('returns 1 for replay/verify missing a sessionId argument', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await main(['replay'])).toBe(1);
    expect(await main(['verify'])).toBe(1);
    errSpy.mockRestore();
  });
});
