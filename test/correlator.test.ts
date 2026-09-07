import { describe, expect, it } from 'vitest';
import { Correlator } from '../src/proxy/correlator.js';

describe('Correlator', () => {
  it('assigns monotonic seq numbers and null parentSeq with no open calls', () => {
    const c = new Correlator();
    const r1 = c.correlate({ kind: 'request', direction: 'client->server', id: 1, method: 'ping', now: 0 });
    const r2 = c.correlate({ kind: 'response', direction: 'server->client', id: 1, method: null, now: 5 });
    expect(r1).toEqual({ seq: 1, parentSeq: null });
    expect(r2).toEqual({ seq: 2, parentSeq: 1, requestSeq: 1, latencyMs: 5 });
  });

  it('notifications inherit parentSeq from the open stack but never push/pop it', () => {
    const c = new Correlator();
    c.correlate({ kind: 'request', direction: 'client->server', id: 1, method: 'tools/call', now: 0 });
    const notif = c.correlate({
      kind: 'notification',
      direction: 'server->client',
      id: null,
      method: 'notifications/progress',
      now: 1,
    });
    expect(notif).toEqual({ seq: 2, parentSeq: 1 });
    // stack still just has the tools/call open — a later response to it must still match seq 1
    const resp = c.correlate({ kind: 'response', direction: 'server->client', id: 1, method: null, now: 2 });
    expect(resp.requestSeq).toBe(1);
  });

  it('reproduces the nested sampling/createMessage worked trace', () => {
    const c = new Correlator();
    // client tools/call opens (seq 1)
    const call = c.correlate({
      kind: 'request',
      direction: 'client->server',
      id: 1,
      method: 'tools/call',
      toolName: 'plan_and_search',
      now: 0,
    });
    expect(call).toEqual({ seq: 1, parentSeq: null });

    // server issues a nested sampling request while the call is still open (seq 2)
    const sampling = c.correlate({
      kind: 'request',
      direction: 'server->client',
      id: 1,
      method: 'sampling/createMessage',
      now: 10,
    });
    expect(sampling).toEqual({ seq: 2, parentSeq: 1 });

    // client answers the sampling request (seq 3) — travels client->server, matches the
    // server->client:1 pending entry (opposite direction lookup)
    const samplingResp = c.correlate({ kind: 'response', direction: 'client->server', id: 1, method: null, now: 40 });
    expect(samplingResp).toEqual({ seq: 3, parentSeq: 2, requestSeq: 2, latencyMs: 30 });

    // server finally answers the original tools/call (seq 4) — travels server->client,
    // matches the client->server:1 pending entry
    const callResp = c.correlate({ kind: 'response', direction: 'server->client', id: 1, method: null, now: 100 });
    expect(callResp).toEqual({ seq: 4, parentSeq: 1, requestSeq: 1, latencyMs: 100 });
  });

  it('splices a resolved entry out of the stack by identity, not just pop()', () => {
    const c = new Correlator();
    // A opens (seq 1), B opens while A is still open (seq 2, nests under A per the
    // documented sibling-pipelining limitation)
    c.correlate({ kind: 'request', direction: 'client->server', id: 1, method: 'tools/call', now: 0 });
    const b = c.correlate({ kind: 'request', direction: 'client->server', id: 2, method: 'tools/call', now: 1 });
    expect(b.parentSeq).toBe(1);

    // A resolves first even though B is on top of the stack
    const aResp = c.correlate({ kind: 'response', direction: 'server->client', id: 1, method: null, now: 2 });
    expect(aResp).toEqual({ seq: 3, parentSeq: 1, requestSeq: 1, latencyMs: 2 });

    // B is still open and must now be the (only) stack top for a new nested call
    const nested = c.correlate({
      kind: 'request',
      direction: 'server->client',
      id: 99,
      method: 'sampling/createMessage',
      now: 3,
    });
    expect(nested.parentSeq).toBe(2);
  });

  it('warns and does not crash on a response with no matching request', () => {
    const warnings: string[] = [];
    const c = new Correlator({ onWarning: (m) => warnings.push(m) });
    const resp = c.correlate({ kind: 'response', direction: 'client->server', id: 42, method: null, now: 0 });
    expect(resp).toEqual({ seq: 1, parentSeq: null });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/unmatched request id 42/);
  });

  it('keeps client->server and server->client ids independent', () => {
    const c = new Correlator();
    c.correlate({ kind: 'request', direction: 'client->server', id: 1, method: 'tools/call', now: 0 });
    c.correlate({ kind: 'request', direction: 'server->client', id: 1, method: 'sampling/createMessage', now: 1 });
    // resolve the server->client one first; must not accidentally match the client->server entry
    const resp = c.correlate({ kind: 'response', direction: 'client->server', id: 1, method: null, now: 2 });
    expect(resp.requestSeq).toBe(2);
  });
});
