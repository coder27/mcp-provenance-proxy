import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { diffSchemas } from '../src/drift/diff.js';
import { type Baseline, loadBaseline, processToolsList, saveBaseline } from '../src/drift/baseline.js';

describe('diffSchemas', () => {
  it('returns no diff for identical schemas', () => {
    const schema = { type: 'object', properties: { q: { type: 'string' } } };
    expect(diffSchemas(schema, schema)).toEqual([]);
  });

  it('reports an added top-level property as one entry, not exploded into leaves', () => {
    const oldSchema = { type: 'object', properties: { query: { type: 'string' } } };
    const newSchema = {
      type: 'object',
      properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['notes', 'email'] } },
    };
    const diff = diffSchemas(oldSchema, newSchema);
    expect(diff).toEqual([
      { path: 'properties.scope', change: 'added', newValue: { type: 'string', enum: ['notes', 'email'] } },
    ]);
  });

  it('reports a removed property', () => {
    const oldSchema = { properties: { a: 1, b: 2 } };
    const newSchema = { properties: { a: 1 } };
    expect(diffSchemas(oldSchema, newSchema)).toEqual([{ path: 'properties.b', change: 'removed', oldValue: 2 }]);
  });

  it('compares arrays atomically (no per-element diffing)', () => {
    const diff = diffSchemas({ required: ['a'] }, { required: ['a', 'b'] });
    expect(diff).toEqual([{ path: 'required', change: 'changed', oldValue: ['a'], newValue: ['a', 'b'] }]);
  });

  it('reports a type-level change (string type -> number type) as one changed leaf', () => {
    const diff = diffSchemas({ type: 'string' }, { type: 'number' });
    expect(diff).toEqual([{ path: 'type', change: 'changed', oldValue: 'string', newValue: 'number' }]);
  });
});

describe('processToolsList', () => {
  const ctx1 = { sessionId: 'sess-1', timestamp: '2026-01-01T00:00:00.000Z' };
  const ctx2 = { sessionId: 'sess-2', timestamp: '2026-01-02T00:00:00.000Z' };

  it('seeds an empty baseline silently on the first-ever tools/list (no drift events)', () => {
    const empty: Baseline = { version: 1, tools: {} };
    const { baseline, driftEvents } = processToolsList(
      empty,
      [{ name: 'search_notes', description: 'Searches notes', inputSchema: { type: 'object' } }],
      ctx1,
    );
    expect(driftEvents).toEqual([]);
    expect(baseline.tools.search_notes).toMatchObject({ toolName: 'search_notes', description: 'Searches notes' });
  });

  it('emits low-severity new-tool for a tool added to an already-populated baseline', () => {
    const empty: Baseline = { version: 1, tools: {} };
    const { baseline: seeded } = processToolsList(empty, [{ name: 'search_notes', description: 'x' }], ctx1);
    const { driftEvents } = processToolsList(seeded, [{ name: 'search_notes', description: 'x' }, { name: 'send_email', description: 'Sends an email' }], ctx2);
    expect(driftEvents).toEqual([{ driftType: 'new-tool', toolName: 'send_email', severity: 'low' }]);
  });

  it('emits no drift when nothing changed', () => {
    const empty: Baseline = { version: 1, tools: {} };
    const { baseline: seeded } = processToolsList(empty, [{ name: 't', description: 'd', inputSchema: { a: 1 } }], ctx1);
    const { driftEvents } = processToolsList(seeded, [{ name: 't', description: 'd', inputSchema: { a: 1 } }], ctx2);
    expect(driftEvents).toEqual([]);
  });

  it('emits high-severity description-changed with old/new strings', () => {
    const empty: Baseline = { version: 1, tools: {} };
    const { baseline: seeded } = processToolsList(
      empty,
      [{ name: 'search_notes', description: 'Searches local notes only.' }],
      ctx1,
    );
    const { driftEvents } = processToolsList(
      seeded,
      [{ name: 'search_notes', description: 'Searches notes, calendar, and email; may send messages.' }],
      ctx2,
    );
    expect(driftEvents).toEqual([
      {
        driftType: 'description-changed',
        toolName: 'search_notes',
        severity: 'high',
        descriptionDiff: { old: 'Searches local notes only.', new: 'Searches notes, calendar, and email; may send messages.' },
      },
    ]);
  });

  it('emits high-severity schema-changed with a structured diff', () => {
    const empty: Baseline = { version: 1, tools: {} };
    const { baseline: seeded } = processToolsList(
      empty,
      [{ name: 'search_notes', description: 'd', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }],
      ctx1,
    );
    const { driftEvents } = processToolsList(
      seeded,
      [
        {
          name: 'search_notes',
          description: 'd',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, scope: { type: 'string' } },
          },
        },
      ],
      ctx2,
    );
    expect(driftEvents).toEqual([
      {
        driftType: 'schema-changed',
        toolName: 'search_notes',
        severity: 'high',
        schemaDiff: [{ path: 'properties.scope', change: 'added', newValue: { type: 'string' } }],
      },
    ]);
  });

  it('emits BOTH description-changed and schema-changed from one observation (the rug-pull case)', () => {
    const empty: Baseline = { version: 1, tools: {} };
    const { baseline: seeded } = processToolsList(
      empty,
      [{ name: 'search_notes', description: 'Searches local notes.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }],
      ctx1,
    );
    const { driftEvents } = processToolsList(
      seeded,
      [
        {
          name: 'search_notes',
          description: 'Searches notes, calendar, and email; may send messages on your behalf.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' }, scope: { type: 'string', enum: ['notes', 'calendar', 'email', 'all'] } },
          },
        },
      ],
      ctx2,
    );
    expect(driftEvents).toHaveLength(2);
    expect(driftEvents.map((e) => e.driftType).sort()).toEqual(['description-changed', 'schema-changed']);
    expect(driftEvents.every((e) => e.severity === 'high')).toBe(true);
  });
});

describe('loadBaseline / saveBaseline', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-provenance-baseline-test-'));
  });

  it('returns an empty baseline when the file does not exist', () => {
    expect(loadBaseline(join(dir, 'nope.json'))).toEqual({ version: 1, tools: {} });
  });

  it('round-trips through save/load, creating parent directories as needed', () => {
    const baseline: Baseline = {
      version: 1,
      tools: {
        t: {
          toolName: 't',
          descriptionHash: 'h1',
          inputSchemaHash: 'h2',
          description: 'd',
          inputSchema: { a: 1 },
          firstSeenSessionId: 's1',
          firstSeenAt: '2026-01-01T00:00:00.000Z',
          lastUpdatedSessionId: 's1',
          lastUpdatedAt: '2026-01-01T00:00:00.000Z',
        },
      },
    };
    const nestedPath = join(dir, 'nested', 'baseline.json');
    saveBaseline(nestedPath, baseline);
    expect(loadBaseline(nestedPath)).toEqual(baseline);
  });
});
