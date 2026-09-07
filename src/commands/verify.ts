import { join } from 'node:path';
import { verifySessionFile } from '../provenance/verify.js';

export interface VerifyCommandResult {
  ok: boolean;
  message: string;
}

export function verifyCommand(storageDir: string, sessionId: string): VerifyCommandResult {
  const sessionFile = join(storageDir, 'sessions', `${sessionId}.jsonl`);
  const result = verifySessionFile(sessionFile);

  if (result.ok) {
    return {
      ok: true,
      message: `OK: ${result.recordCount} record(s) verified, chain intact (final hash ${result.finalHash.slice(0, 16)}...)`,
    };
  }

  if (result.reason === 'unreadable-line' && result.lineNumber === 0) {
    return { ok: false, message: `NOT FOUND: session file does not exist: ${sessionFile}` };
  }

  const detail =
    result.expected !== undefined
      ? ` (expected ${JSON.stringify(result.expected)}, got ${JSON.stringify(result.actual)})`
      : '';
  return { ok: false, message: `TAMPERED: line ${result.lineNumber}: ${result.reason}${detail}` };
}
