import type { Direction, JsonRpcErrorBody, JsonRpcId } from '../types.js';

export interface RecordEnvelope {
  sessionId: string;
  seq: number;
  timestamp: string;
  parentSeq: number | null;
}

export interface MessageRecordBody extends RecordEnvelope {
  kind: 'request' | 'response' | 'notification';
  direction: Direction;
  jsonrpcId: JsonRpcId | null;
  method: string | null;
  toolName?: string;
  toolArguments?: unknown;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcErrorBody;
  latencyMs?: number;
  requestSeq?: number;
}

export interface SchemaDiffEntry {
  path: string;
  change: 'added' | 'removed' | 'changed';
  oldValue?: unknown;
  newValue?: unknown;
}

export type DriftType = 'new-tool' | 'description-changed' | 'schema-changed';
export type DriftSeverity = 'low' | 'high';

export interface DriftRecordBody extends RecordEnvelope {
  kind: 'drift';
  driftType: DriftType;
  toolName: string;
  severity: DriftSeverity;
  descriptionDiff?: { old: string; new: string };
  schemaDiff?: SchemaDiffEntry[];
}

export type RecordBody = MessageRecordBody | DriftRecordBody;

/** A RecordBody as it's about to be hashed: prevHash present, hash not yet computed. */
export type UnhashedRecord = RecordBody & { prevHash: string };

/** A RecordBody as it's persisted: hash-chained and immutable. */
export type StoredRecord = RecordBody & { prevHash: string; hash: string };

export interface BuildMessageRecordInput {
  sessionId: string;
  seq: number;
  timestamp: string;
  parentSeq: number | null;
  kind: 'request' | 'response' | 'notification';
  direction: Direction;
  jsonrpcId: JsonRpcId | null;
  method: string | null;
  toolName?: string;
  toolArguments?: unknown;
  params?: unknown;
  result?: unknown;
  error?: JsonRpcErrorBody;
  latencyMs?: number;
  requestSeq?: number;
}

/** Omits optional fields entirely when absent — never sets them to `undefined` — so
 * canonicalJSON never has to special-case missing-vs-undefined. */
export function buildMessageRecord(input: BuildMessageRecordInput): MessageRecordBody {
  const record: MessageRecordBody = {
    sessionId: input.sessionId,
    seq: input.seq,
    timestamp: input.timestamp,
    parentSeq: input.parentSeq,
    kind: input.kind,
    direction: input.direction,
    jsonrpcId: input.jsonrpcId,
    method: input.method,
  };
  if (input.toolName !== undefined) record.toolName = input.toolName;
  if (input.toolArguments !== undefined) record.toolArguments = input.toolArguments;
  if (input.params !== undefined) record.params = input.params;
  if (input.result !== undefined) record.result = input.result;
  if (input.error !== undefined) record.error = input.error;
  if (input.latencyMs !== undefined) record.latencyMs = input.latencyMs;
  if (input.requestSeq !== undefined) record.requestSeq = input.requestSeq;
  return record;
}

export interface BuildDriftRecordInput {
  sessionId: string;
  seq: number;
  timestamp: string;
  parentSeq: number | null;
  driftType: DriftType;
  toolName: string;
  severity: DriftSeverity;
  descriptionDiff?: { old: string; new: string };
  schemaDiff?: SchemaDiffEntry[];
}

export function buildDriftRecord(input: BuildDriftRecordInput): DriftRecordBody {
  const record: DriftRecordBody = {
    sessionId: input.sessionId,
    seq: input.seq,
    timestamp: input.timestamp,
    parentSeq: input.parentSeq,
    kind: 'drift',
    driftType: input.driftType,
    toolName: input.toolName,
    severity: input.severity,
  };
  if (input.descriptionDiff !== undefined) record.descriptionDiff = input.descriptionDiff;
  if (input.schemaDiff !== undefined) record.schemaDiff = input.schemaDiff;
  return record;
}
