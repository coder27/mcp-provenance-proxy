import { join } from 'node:path';
import type { StoredRecord } from '../provenance/record.js';
import { readSessionRecords } from '../provenance/store.js';

function describeRecord(record: StoredRecord): string {
  if (record.kind === 'drift') {
    const parts = [`DRIFT[${record.severity}]`, record.driftType, `tool=${record.toolName}`];
    if (record.descriptionDiff) {
      parts.push(`old="${record.descriptionDiff.old}"`, `new="${record.descriptionDiff.new}"`);
    }
    if (record.schemaDiff) {
      parts.push(`schemaDiff=${JSON.stringify(record.schemaDiff)}`);
    }
    return parts.join(' ');
  }

  const parts: string[] = [record.kind, record.direction, record.method ?? '(response)'];
  if (record.toolName) parts.push(`tool=${record.toolName}`);
  if (record.toolArguments !== undefined) parts.push(`args=${JSON.stringify(record.toolArguments)}`);
  if (record.latencyMs !== undefined) parts.push(`${record.latencyMs}ms`);
  if (record.error) parts.push(`ERROR ${record.error.code} ${record.error.message}`);
  return parts.join(' ');
}

/**
 * Renders a session as an ordered, indented call chain using parentSeq to nest
 * children under the call they belong to.
 */
export function replaySession(storageDir: string, sessionId: string): string {
  const sessionFile = join(storageDir, 'sessions', `${sessionId}.jsonl`);
  const records = readSessionRecords(sessionFile);
  if (records.length === 0) {
    return `No records found for session "${sessionId}" in ${sessionFile}`;
  }

  const childrenOf = new Map<number | null, StoredRecord[]>();
  for (const record of records) {
    const list = childrenOf.get(record.parentSeq) ?? [];
    list.push(record);
    childrenOf.set(record.parentSeq, list);
  }
  for (const list of childrenOf.values()) list.sort((a, b) => a.seq - b.seq);

  const lines: string[] = [];
  function walk(parentSeq: number | null, depth: number): void {
    for (const record of childrenOf.get(parentSeq) ?? []) {
      lines.push(`${'  '.repeat(depth)}[#${record.seq}] ${describeRecord(record)}`);
      walk(record.seq, depth + 1);
    }
  }
  walk(null, 0);
  return lines.join('\n');
}
