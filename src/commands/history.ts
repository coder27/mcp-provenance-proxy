import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SchemaDiffEntry } from '../provenance/record.js';
import { readSessionRecords } from '../provenance/store.js';

interface HistoryEntry {
  sessionId: string;
  timestamp: string;
  change: 'first-seen' | 'description-changed' | 'schema-changed';
  description?: string;
  inputSchema?: unknown;
  descriptionDiff?: { old: string; new: string };
  schemaDiff?: SchemaDiffEntry[];
}

interface ToolsListResult {
  tools?: { name: string; description?: string; inputSchema?: unknown }[];
}

/**
 * Reconstructs a tool's version history purely from existing session records: the
 * first tools/list response that ever mentioned it (full description/schema, whether
 * that was session 1's bootstrap or a later new-tool appearance), plus every
 * description-changed/schema-changed DRIFT record for it since. No new capture logic
 * or storage format — this is a read-side view over data the proxy already records.
 * ('new-tool' drift records are skipped in favor of the richer first-seen entry,
 * which carries the actual description/schema instead of just "a tool appeared".)
 */
export function toolHistory(storageDir: string, toolName: string): string {
  const sessionsDir = join(storageDir, 'sessions');
  if (!existsSync(sessionsDir)) return `No history found for tool "${toolName}".`;

  const files = readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  if (files.length === 0) return `No history found for tool "${toolName}".`;

  const entries: HistoryEntry[] = [];
  let sawFirstSeen = false;

  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, '');
    const records = readSessionRecords(join(sessionsDir, file));
    const bySeq = new Map(records.map((r) => [r.seq, r]));

    for (const record of records) {
      if (!sawFirstSeen && record.kind === 'response' && record.method === null && record.requestSeq !== undefined) {
        const req = bySeq.get(record.requestSeq);
        if (req?.kind === 'request' && req.method === 'tools/list') {
          const tools = (record.result as ToolsListResult | undefined)?.tools;
          const match = tools?.find((t) => t.name === toolName);
          if (match) {
            sawFirstSeen = true;
            entries.push({
              sessionId,
              timestamp: record.timestamp,
              change: 'first-seen',
              description: match.description ?? '',
              inputSchema: match.inputSchema ?? null,
            });
          }
        }
        continue;
      }

      if (record.kind === 'drift' && record.toolName === toolName && record.driftType !== 'new-tool') {
        const entry: HistoryEntry = { sessionId, timestamp: record.timestamp, change: record.driftType };
        if (record.descriptionDiff !== undefined) entry.descriptionDiff = record.descriptionDiff;
        if (record.schemaDiff !== undefined) entry.schemaDiff = record.schemaDiff;
        entries.push(entry);
      }
    }
  }

  if (entries.length === 0) return `No history found for tool "${toolName}".`;

  const lines = entries.map((entry, i) => {
    const header = `v${i + 1}  ${entry.timestamp}  [${entry.sessionId}]  ${entry.change}`;
    if (entry.change === 'first-seen') {
      return `${header}\n  description: ${entry.description}\n  inputSchema: ${JSON.stringify(entry.inputSchema)}`;
    }
    if (entry.change === 'description-changed') {
      return `${header}\n  old: ${entry.descriptionDiff?.old}\n  new: ${entry.descriptionDiff?.new}`;
    }
    return `${header}\n  schemaDiff: ${JSON.stringify(entry.schemaDiff)}`;
  });

  return lines.join('\n\n');
}
