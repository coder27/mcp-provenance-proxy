import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RecordBody, StoredRecord, UnhashedRecord } from './record.js';

export const GENESIS_HASH = '0'.repeat(64);

/**
 * Deterministic, dependency-free JSON stringify with sorted object keys. Sufficient
 * because every record's field set is fully controlled by record.ts's builders and
 * all keys are ASCII identifiers — no undefined/NaN/circular refs ever reach it.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJSON(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${canonicalJSON(k)}:${canonicalJSON(obj[k])}`).join(',')}}`;
  }
  throw new Error(`canonicalJSON: unsupported value type "${typeof value}"`);
}

/** hash = sha256(prevHash + canonicalJSON(record-with-prevHash-set, hash field excluded)). */
export function computeHash(record: UnhashedRecord): string {
  return createHash('sha256').update(record.prevHash + canonicalJSON(record), 'utf8').digest('hex');
}

/** Appends hash-chained records to a session's JSONL file. */
export class ProvenanceStore {
  private prevHash: string;

  constructor(private readonly filePath: string) {
    if (existsSync(filePath)) {
      const lines = readFileSync(filePath, 'utf8').split('\n').filter((l) => l.length > 0);
      const last = lines[lines.length - 1];
      this.prevHash = last ? (JSON.parse(last) as StoredRecord).hash : GENESIS_HASH;
    } else {
      mkdirSync(dirname(filePath), { recursive: true });
      this.prevHash = GENESIS_HASH;
    }
  }

  append(body: RecordBody): StoredRecord {
    const withPrevHash: UnhashedRecord = { ...body, prevHash: this.prevHash };
    const hash = computeHash(withPrevHash);
    const stored: StoredRecord = { ...withPrevHash, hash };
    appendFileSync(this.filePath, `${JSON.stringify(stored)}\n`, 'utf8');
    this.prevHash = hash;
    return stored;
  }
}

export function readSessionRecords(filePath: string): StoredRecord[] {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as StoredRecord);
}
