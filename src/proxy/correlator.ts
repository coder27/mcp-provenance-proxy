import type { Direction, JsonRpcId, MessageKind, SeqSource } from '../types.js';
import { SeqCounter } from '../types.js';

export interface PendingRequestEntry {
  seq: number;
  jsonrpcId: JsonRpcId;
  direction: Direction;
  method: string;
  toolName?: string;
  startedAt: number;
  parentSeq: number | null;
}

export interface CorrelationInput {
  kind: MessageKind;
  direction: Direction;
  id: JsonRpcId | null;
  method: string | null;
  toolName?: string;
  /** Timestamp in ms (Date.now() or a monotonic clock), used only for latency arithmetic. */
  now: number;
}

export interface CorrelationResult {
  seq: number;
  parentSeq: number | null;
  /** Present only on a response: the seq of the request it answers. */
  requestSeq?: number;
  /** Present only on a response: elapsed ms since the matching request was seen. */
  latencyMs?: number;
}

function oppositeOf(direction: Direction): Direction {
  return direction === 'client->server' ? 'server->client' : 'client->server';
}

/**
 * Tracks a single global sequence counter and a LIFO stack of in-flight requests,
 * shared across both directions of one stdio pipe, to derive parentSeq/latency.
 *
 * parentSeq models causal nesting, not JSON-RPC structure: a server->client request
 * (e.g. sampling/createMessage) issued while a client->server tools/call is still open
 * is a child of that call. A response is always nested inside the call it answers.
 *
 * Known v1 limitation: two pipelined sibling requests opened before either resolves
 * will nest the second under the first via the LIFO stack. Correct for genuine nesting,
 * an approximation for true sibling concurrency — acceptable for observe-only v1.
 */
export class Correlator {
  private readonly seqSource: SeqSource;
  private readonly pendingByKey = new Map<string, PendingRequestEntry>();
  private readonly openStack: PendingRequestEntry[] = [];
  private readonly onWarning: (message: string) => void;

  constructor(opts?: { seqSource?: SeqSource; onWarning?: (message: string) => void }) {
    this.seqSource = opts?.seqSource ?? new SeqCounter();
    this.onWarning = opts?.onWarning ?? (() => {});
  }

  correlate(input: CorrelationInput): CorrelationResult {
    const seq = this.seqSource.next();
    const top = this.openStack[this.openStack.length - 1];
    const parentSeq = top ? top.seq : null;

    if (input.kind === 'request') {
      const entry: PendingRequestEntry = {
        seq,
        jsonrpcId: input.id as JsonRpcId,
        direction: input.direction,
        method: input.method as string,
        startedAt: input.now,
        parentSeq,
      };
      if (input.toolName !== undefined) entry.toolName = input.toolName;
      this.pendingByKey.set(this.key(input.direction, entry.jsonrpcId), entry);
      this.openStack.push(entry);
      return { seq, parentSeq };
    }

    if (input.kind === 'notification') {
      return { seq, parentSeq };
    }

    // response
    const key = this.key(oppositeOf(input.direction), input.id as JsonRpcId);
    const entry = this.pendingByKey.get(key);
    if (!entry) {
      this.onWarning(`response on ${input.direction} for unmatched request id ${String(input.id)}`);
      return { seq, parentSeq };
    }
    this.pendingByKey.delete(key);
    const idx = this.openStack.indexOf(entry);
    if (idx !== -1) this.openStack.splice(idx, 1);
    return { seq, parentSeq: entry.seq, requestSeq: entry.seq, latencyMs: input.now - entry.startedAt };
  }

  private key(direction: Direction, id: JsonRpcId): string {
    return `${direction}:${String(id)}`;
  }
}
