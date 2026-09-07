import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readSessionRecords } from '../provenance/store.js';

/** Lists every session under storageDir, newest first, with a quick-glance summary. */
export function listSessions(storageDir: string): string {
  const sessionsDir = join(storageDir, 'sessions');
  if (!existsSync(sessionsDir)) return 'No sessions found.';

  const files = readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .reverse();
  if (files.length === 0) return 'No sessions found.';

  const lines = files.map((file) => {
    const sessionId = file.replace(/\.jsonl$/, '');
    const records = readSessionRecords(join(sessionsDir, file));
    const driftCount = records.filter((r) => r.kind === 'drift').length;
    const start = records[0]?.timestamp ?? '-';
    const end = records[records.length - 1]?.timestamp ?? '-';
    const driftSuffix = driftCount > 0 ? `  drift=${driftCount}` : '';
    return `${sessionId}  records=${records.length}${driftSuffix}  ${start} -> ${end}`;
  });

  return lines.join('\n');
}
