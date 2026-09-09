import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { toolHistory } from '../src/commands/history.js';
import { buildDriftRecord, buildMessageRecord } from '../src/provenance/record.js';
import { ProvenanceStore } from '../src/provenance/store.js';

let storageDir: string;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'mcp-provenance-history-test-'));
});

function toolsListRequestAndResponse(
  sessionId: string,
  seqStart: number,
  timestamp: string,
  tools: { name: string; description?: string; inputSchema?: unknown }[],
): void {
  const store = new ProvenanceStore(join(storageDir, 'sessions', `${sessionId}.jsonl`));
  store.append(
    buildMessageRecord({
      sessionId,
      seq: seqStart,
      timestamp,
      parentSeq: null,
      kind: 'request',
      direction: 'client->server',
      jsonrpcId: 1,
      method: 'tools/list',
    }),
  );
  store.append(
    buildMessageRecord({
      sessionId,
      seq: seqStart + 1,
      timestamp,
      parentSeq: seqStart,
      kind: 'response',
      direction: 'server->client',
      jsonrpcId: 1,
      method: null,
      result: { tools },
      requestSeq: seqStart,
      latencyMs: 1,
    }),
  );
}

function appendDrift(
  sessionId: string,
  seq: number,
  timestamp: string,
  driftType: 'new-tool' | 'description-changed' | 'schema-changed',
  toolName: string,
  extra: Record<string, unknown> = {},
): void {
  const store = new ProvenanceStore(join(storageDir, 'sessions', `${sessionId}.jsonl`));
  store.append(
    buildDriftRecord({
      sessionId,
      seq,
      timestamp,
      parentSeq: seq - 1,
      driftType,
      toolName,
      severity: driftType === 'new-tool' ? 'low' : 'high',
      ...extra,
    }),
  );
}

describe('toolHistory', () => {
  it('reports no history for an unknown tool or missing storage', () => {
    expect(toolHistory(storageDir, 'nope')).toMatch(/No history found/);
  });

  it('shows a single first-seen entry for a tool that never drifted', () => {
    toolsListRequestAndResponse('sess-1', 1, '2026-01-01T00:00:00.000Z', [
      { name: 'search_notes', description: 'Searches notes.', inputSchema: { type: 'object' } },
    ]);
    const output = toolHistory(storageDir, 'search_notes');
    expect(output).toMatch(/^v1\s+2026-01-01T00:00:00\.000Z\s+\[sess-1\]\s+first-seen/);
    expect(output).toMatch(/description: Searches notes\./);
    expect(output.split('\n\n')).toHaveLength(1);
  });

  it('orders first-seen, then description-changed, then schema-changed across sessions', () => {
    toolsListRequestAndResponse('sess-1', 1, '2026-01-01T00:00:00.000Z', [
      { name: 'search_notes', description: 'benign', inputSchema: { type: 'object' } },
    ]);
    appendDrift('sess-2', 1, '2026-01-02T00:00:00.000Z', 'description-changed', 'search_notes', {
      descriptionDiff: { old: 'benign', new: 'escalated' },
    });
    appendDrift('sess-3', 1, '2026-01-03T00:00:00.000Z', 'schema-changed', 'search_notes', {
      schemaDiff: [{ path: 'properties.scope', change: 'added', newValue: { type: 'string' } }],
    });

    const output = toolHistory(storageDir, 'search_notes');
    const blocks = output.split('\n\n');
    expect(blocks).toHaveLength(3);
    expect(blocks[0]).toMatch(/^v1.*first-seen/s);
    expect(blocks[1]).toMatch(/^v2.*description-changed/s);
    expect(blocks[1]).toMatch(/old: benign/);
    expect(blocks[1]).toMatch(/new: escalated/);
    expect(blocks[2]).toMatch(/^v3.*schema-changed/s);
    expect(blocks[2]).toMatch(/properties\.scope/);
  });

  it('does not duplicate first-seen when a tool is genuinely new (skips the new-tool drift record)', () => {
    // session 1: baseline bootstrap, search_notes only
    toolsListRequestAndResponse('sess-1', 1, '2026-01-01T00:00:00.000Z', [
      { name: 'search_notes', description: 'd', inputSchema: {} },
    ]);
    // session 2: send_email appears for the first time -> both a tools/list response
    // containing it AND a new-tool drift record exist in the same session
    toolsListRequestAndResponse('sess-2', 1, '2026-01-02T00:00:00.000Z', [
      { name: 'search_notes', description: 'd', inputSchema: {} },
      { name: 'send_email', description: 'Sends an email.', inputSchema: { type: 'object' } },
    ]);
    appendDrift('sess-2', 3, '2026-01-02T00:00:00.000Z', 'new-tool', 'send_email');

    const output = toolHistory(storageDir, 'send_email');
    const blocks = output.split('\n\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatch(/^v1\s+2026-01-02T00:00:00\.000Z\s+\[sess-2\]\s+first-seen/);
    expect(blocks[0]).toMatch(/description: Sends an email\./);
  });

  it('ignores sessions/tools unrelated to the queried tool', () => {
    toolsListRequestAndResponse('sess-1', 1, '2026-01-01T00:00:00.000Z', [
      { name: 'other_tool', description: 'x', inputSchema: {} },
    ]);
    expect(toolHistory(storageDir, 'search_notes')).toMatch(/No history found/);
  });
});
