import { describe, expect, it } from 'vitest';
import { classifyLine } from '../src/proxy/jsonrpc.js';

describe('classifyLine', () => {
  it('classifies a request', () => {
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } });
    const msg = classifyLine(line);
    expect(msg).toEqual({ raw: line, kind: 'request', id: 1, method: 'tools/call', params: { name: 'x' } });
  });

  it('classifies a notification (no id)', () => {
    const line = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const msg = classifyLine(line);
    expect(msg).toEqual({ raw: line, kind: 'notification', id: null, method: 'notifications/initialized' });
  });

  it('classifies a success response', () => {
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } });
    const msg = classifyLine(line);
    expect(msg).toEqual({ raw: line, kind: 'response', id: 1, method: null, result: { tools: [] } });
  });

  it('classifies an error response', () => {
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } });
    const msg = classifyLine(line);
    expect(msg).toEqual({
      raw: line,
      kind: 'response',
      id: 1,
      method: null,
      error: { code: -32601, message: 'Method not found' },
    });
  });

  it('preserves string ids', () => {
    const line = JSON.stringify({ jsonrpc: '2.0', id: 'abc-123', result: {} });
    const msg = classifyLine(line);
    expect(msg.id).toBe('abc-123');
  });

  it('omits params when absent from a request', () => {
    const line = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
    const msg = classifyLine(line);
    expect(msg).not.toHaveProperty('params');
  });

  it('throws on invalid JSON', () => {
    expect(() => classifyLine('{not json')).toThrow(/not valid JSON/);
  });

  it('throws on a JSON array', () => {
    expect(() => classifyLine('[1,2,3]')).toThrow(/must be a JSON object/);
  });

  it('throws when neither method nor id is present', () => {
    expect(() => classifyLine(JSON.stringify({ jsonrpc: '2.0', foo: 'bar' }))).toThrow(/neither "method" nor "id"/);
  });
});
