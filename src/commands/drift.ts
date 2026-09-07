import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readSessionRecords } from '../provenance/store.js';

/** Lists DRIFT records, scoped to one session or scanning every session in storageDir. */
export function listDrift(storageDir: string, sessionId?: string): string {
  const sessionsDir = join(storageDir, 'sessions');
  const files = sessionId
    ? [`${sessionId}.jsonl`]
    : existsSync(sessionsDir)
      ? readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'))
      : [];

  const lines: string[] = [];
  for (const file of files) {
    const records = readSessionRecords(join(sessionsDir, file));
    const sid = file.replace(/\.jsonl$/, '');
    for (const record of records) {
      if (record.kind !== 'drift') continue;
      const parts = [`[${sid}] #${record.seq}`, record.severity.toUpperCase(), record.driftType, `tool=${record.toolName}`];
      if (record.descriptionDiff) {
        parts.push(`old="${record.descriptionDiff.old}"`, `new="${record.descriptionDiff.new}"`);
      }
      if (record.schemaDiff) {
        parts.push(`schemaDiff=${JSON.stringify(record.schemaDiff)}`);
      }
      lines.push(parts.join(' '));
    }
  }

  return lines.length > 0 ? lines.join('\n') : 'No drift events found.';
}
