import { existsSync, readFileSync } from 'node:fs';
import type { StoredRecord, UnhashedRecord } from './record.js';
import { GENESIS_HASH, computeHash } from './store.js';

export type VerifyFailureReason = 'unreadable-line' | 'sequence-gap' | 'broken-hash-link' | 'hash-mismatch-tampered';

export interface VerifyFailure {
  ok: false;
  lineNumber: number;
  reason: VerifyFailureReason;
  expected?: unknown;
  actual?: unknown;
}

export interface VerifySuccess {
  ok: true;
  recordCount: number;
  finalHash: string;
}

export type VerifyResult = VerifySuccess | VerifyFailure;

/**
 * Walks a session JSONL file line by line, checking (in order) seq monotonicity,
 * prevHash linkage, and recomputed-hash match. Stops and reports the FIRST failing
 * line — once the chain is broken, every subsequent line trivially fails the
 * prevHash check too, so cascading reports would add nothing.
 */
export function verifySessionFile(filePath: string): VerifyResult {
  if (!existsSync(filePath)) {
    return { ok: false, lineNumber: 0, reason: 'unreadable-line', expected: 'file to exist', actual: 'missing' };
  }

  const lines = readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0);

  let runningPrevHash = GENESIS_HASH;
  let expectedSeq = 1;

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    let record: StoredRecord;
    try {
      record = JSON.parse(lines[i]) as StoredRecord;
    } catch {
      return { ok: false, lineNumber, reason: 'unreadable-line' };
    }

    if (record.seq !== expectedSeq) {
      return { ok: false, lineNumber, reason: 'sequence-gap', expected: expectedSeq, actual: record.seq };
    }
    if (record.prevHash !== runningPrevHash) {
      return {
        ok: false,
        lineNumber,
        reason: 'broken-hash-link',
        expected: runningPrevHash,
        actual: record.prevHash,
      };
    }

    const { hash, ...rest } = record;
    const recomputed = computeHash(rest as UnhashedRecord);
    if (recomputed !== hash) {
      return { ok: false, lineNumber, reason: 'hash-mismatch-tampered', expected: recomputed, actual: hash };
    }

    runningPrevHash = hash;
    expectedSeq += 1;
  }

  return { ok: true, recordCount: expectedSeq - 1, finalHash: runningPrevHash };
}
