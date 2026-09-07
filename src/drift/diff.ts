import { canonicalJSON } from '../provenance/store.js';
import type { SchemaDiffEntry } from '../provenance/record.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Path-level structured diff for two JSON-Schema-like values. A subtree that appears
 * or disappears wholesale is reported as ONE entry at that path, not exploded into
 * every leaf underneath. Anything that isn't a plain-object-vs-plain-object comparison
 * (including arrays, e.g. a schema's `required` list) is compared atomically via
 * canonicalJSON equality — no per-element array diffing in v1.
 */
export function diffSchemas(oldValue: unknown, newValue: unknown, path = ''): SchemaDiffEntry[] {
  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    const entries: SchemaDiffEntry[] = [];
    const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      const hasOld = Object.prototype.hasOwnProperty.call(oldValue, key);
      const hasNew = Object.prototype.hasOwnProperty.call(newValue, key);
      if (hasOld && !hasNew) {
        entries.push({ path: childPath, change: 'removed', oldValue: oldValue[key] });
      } else if (hasNew && !hasOld) {
        entries.push({ path: childPath, change: 'added', newValue: newValue[key] });
      } else {
        entries.push(...diffSchemas(oldValue[key], newValue[key], childPath));
      }
    }
    return entries;
  }

  if (canonicalJSON(oldValue ?? null) === canonicalJSON(newValue ?? null)) return [];
  return [{ path: path || '<root>', change: 'changed', oldValue, newValue }];
}
