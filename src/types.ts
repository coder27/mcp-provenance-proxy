import { randomUUID } from 'node:crypto';

export type Direction = 'client->server' | 'server->client';
export type MessageKind = 'request' | 'response' | 'notification';
export type JsonRpcId = string | number;

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

/** Result of classifying one raw JSON-RPC line read off the wire. */
export interface ClassifiedMessage {
  /** Exact original line, unmodified, so pass-through never depends on re-serialization. */
  raw: string;
  kind: MessageKind;
  id: JsonRpcId | null;
  method: string | null;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcErrorBody;
}

export function newSessionId(): string {
  return `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

/**
 * A single monotonic counter shared by every record writer within one proxy run —
 * message records (via Correlator) and derived drift records both draw from it, so
 * `seq` stays contiguous and gapless across the whole session JSONL file.
 */
export interface SeqSource {
  next(): number;
}

export class SeqCounter implements SeqSource {
  private n = 1;

  next(): number {
    return this.n++;
  }
}
