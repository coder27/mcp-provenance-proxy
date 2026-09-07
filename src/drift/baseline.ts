import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DriftSeverity, DriftType, SchemaDiffEntry } from '../provenance/record.js';
import { canonicalJSON } from '../provenance/store.js';
import { diffSchemas } from './diff.js';

export interface BaselineEntry {
  toolName: string;
  descriptionHash: string;
  inputSchemaHash: string;
  description: string;
  inputSchema: unknown;
  firstSeenSessionId: string;
  firstSeenAt: string;
  lastUpdatedSessionId: string;
  lastUpdatedAt: string;
}

export interface Baseline {
  version: 1;
  tools: Record<string, BaselineEntry>;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface DriftEvent {
  driftType: DriftType;
  toolName: string;
  severity: DriftSeverity;
  descriptionDiff?: { old: string; new: string };
  schemaDiff?: SchemaDiffEntry[];
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function loadBaseline(filePath: string): Baseline {
  if (!existsSync(filePath)) return { version: 1, tools: {} };
  return JSON.parse(readFileSync(filePath, 'utf8')) as Baseline;
}

export function saveBaseline(filePath: string, baseline: Baseline): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(baseline, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

/**
 * Compares a tools/list observation against the baseline, seeded/updated in place.
 * Description and inputSchema are hashed and compared SEPARATELY, so a single tool
 * can produce up to two drift events from one observation. The very first-ever
 * tools/list (empty baseline) seeds silently — every later one (same or later
 * session) compares and reports.
 */
export function processToolsList(
  baseline: Baseline,
  tools: ToolDefinition[],
  context: { sessionId: string; timestamp: string },
): { baseline: Baseline; driftEvents: DriftEvent[] } {
  const isBootstrap = Object.keys(baseline.tools).length === 0;
  const driftEvents: DriftEvent[] = [];
  const nextTools: Record<string, BaselineEntry> = { ...baseline.tools };
  let changed = false;

  for (const tool of tools) {
    const description = tool.description ?? '';
    const inputSchema = tool.inputSchema ?? null;
    const descriptionHash = sha256Hex(description);
    const inputSchemaHash = sha256Hex(canonicalJSON(inputSchema));
    const existing = nextTools[tool.name];

    if (!existing) {
      nextTools[tool.name] = {
        toolName: tool.name,
        descriptionHash,
        inputSchemaHash,
        description,
        inputSchema,
        firstSeenSessionId: context.sessionId,
        firstSeenAt: context.timestamp,
        lastUpdatedSessionId: context.sessionId,
        lastUpdatedAt: context.timestamp,
      };
      changed = true;
      if (!isBootstrap) {
        driftEvents.push({ driftType: 'new-tool', toolName: tool.name, severity: 'low' });
      }
      continue;
    }

    let toolChanged = false;

    if (existing.descriptionHash !== descriptionHash) {
      driftEvents.push({
        driftType: 'description-changed',
        toolName: tool.name,
        severity: 'high',
        descriptionDiff: { old: existing.description, new: description },
      });
      nextTools[tool.name] = { ...existing, description, descriptionHash };
      toolChanged = true;
    }

    if (existing.inputSchemaHash !== inputSchemaHash) {
      driftEvents.push({
        driftType: 'schema-changed',
        toolName: tool.name,
        severity: 'high',
        schemaDiff: diffSchemas(existing.inputSchema, inputSchema),
      });
      nextTools[tool.name] = { ...nextTools[tool.name], inputSchema, inputSchemaHash };
      toolChanged = true;
    }

    if (toolChanged) {
      nextTools[tool.name] = {
        ...nextTools[tool.name],
        lastUpdatedSessionId: context.sessionId,
        lastUpdatedAt: context.timestamp,
      };
      changed = true;
    }
  }

  return { baseline: changed ? { version: 1, tools: nextTools } : baseline, driftEvents };
}
