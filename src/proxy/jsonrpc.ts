import type { ClassifiedMessage, JsonRpcErrorBody, JsonRpcId } from '../types.js';

/**
 * Classifies one raw JSON-RPC line into a request, response, or notification.
 * Throws on malformed input — callers on the hot path (proxy/run.ts) must treat
 * that as "pass through, skip recording" rather than a fatal error.
 */
export function classifyLine(raw: string): ClassifiedMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`not valid JSON: ${(err as Error).message}`);
  }
  return classifyParsed(raw, parsed);
}

function classifyParsed(raw: string, parsed: unknown): ClassifiedMessage {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('message must be a JSON object');
  }
  const msg = parsed as Record<string, unknown>;
  const hasMethod = typeof msg.method === 'string';
  const hasId = Object.prototype.hasOwnProperty.call(msg, 'id');

  if (hasMethod) {
    const method = msg.method as string;
    if (hasId) {
      const record: ClassifiedMessage = { raw, kind: 'request', id: msg.id as JsonRpcId | null, method };
      if ('params' in msg) record.params = msg.params;
      return record;
    }
    const record: ClassifiedMessage = { raw, kind: 'notification', id: null, method };
    if ('params' in msg) record.params = msg.params;
    return record;
  }

  if (hasId) {
    const record: ClassifiedMessage = { raw, kind: 'response', id: msg.id as JsonRpcId | null, method: null };
    if ('error' in msg) {
      record.error = msg.error as JsonRpcErrorBody;
    } else if ('result' in msg) {
      record.result = msg.result;
    }
    return record;
  }

  throw new Error('message has neither "method" nor "id"');
}
