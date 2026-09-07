import { readdirSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProxyConfig } from '../src/config.js';
import { runProxy } from '../src/proxy/run.js';
import { readSessionRecords } from '../src/provenance/store.js';
import { verifySessionFile } from '../src/provenance/verify.js';
import { LineReader } from './fixtures/line-reader.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const fakeServerPath = join(testDir, 'fixtures', 'fake-server.ts');
const tsxBin = join(testDir, '..', 'node_modules', '.bin', 'tsx');

let storageDir: string;

beforeEach(() => {
  storageDir = mkdtempSync(join(tmpdir(), 'mcp-provenance-proxy-test-'));
});

function makeConfig(fakeTools: unknown[]): ProxyConfig {
  return {
    upstream: {
      command: tsxBin,
      args: [fakeServerPath],
      env: { FAKE_TOOLS_JSON: JSON.stringify(fakeTools) },
    },
    storageDir,
  };
}

describe('runProxy: transparent pass-through + provenance recording', () => {
  it('relays a full session unmodified and records a verifiable, correctly-nested chain', async () => {
    const clientInput = new PassThrough();
    const clientOutput = new PassThrough();
    const stderr = new PassThrough();
    const stderrLines: string[] = [];
    stderr.on('data', (chunk: Buffer) => stderrLines.push(chunk.toString()));

    const reader = new LineReader(clientOutput);
    const exitPromise = runProxy({ config: makeConfig([]), clientInput, clientOutput, stderr });

    clientInput.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'test-client', version: '0.0.1' },
        },
      })}\n`,
    );
    const initResponse = JSON.parse(await reader.next());
    expect(initResponse.id).toBe(1);
    expect(initResponse.result.serverInfo.name).toBe('fake-upstream');

    clientInput.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

    clientInput.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'plan_and_search', arguments: { query: 'find budget docs' } },
      })}\n`,
    );

    const samplingRequest = JSON.parse(await reader.next());
    expect(samplingRequest.method).toBe('sampling/createMessage');
    expect(samplingRequest.id).toBeDefined();

    clientInput.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: samplingRequest.id,
        result: {
          role: 'assistant',
          model: 'fake-model',
          content: { type: 'text', text: 'plan: search notes for budget' },
        },
      })}\n`,
    );

    const callResponse = JSON.parse(await reader.next());
    expect(callResponse.id).toBe(2);
    expect(callResponse.result.content[0].text).toMatch(/planned using sampling result/);

    clientInput.end();
    const exitCode = await exitPromise;
    expect(exitCode).toBe(0);
    expect(stderrLines.join('')).toBe('');

    const sessionsDir = join(storageDir, 'sessions');
    const files = readdirSync(sessionsDir);
    expect(files).toHaveLength(1);
    const sessionFile = join(sessionsDir, files[0]!);

    const verifyResult = verifySessionFile(sessionFile);
    expect(verifyResult.ok).toBe(true);

    const records = readSessionRecords(sessionFile);

    const toolCallReq = records.find((r) => r.kind === 'request' && r.method === 'tools/call');
    expect(toolCallReq).toBeDefined();
    expect(toolCallReq).toMatchObject({ toolName: 'plan_and_search', toolArguments: { query: 'find budget docs' } });
    expect(toolCallReq!.parentSeq).toBeNull();

    const samplingReq = records.find((r) => r.kind === 'request' && r.method === 'sampling/createMessage');
    expect(samplingReq).toBeDefined();
    expect(samplingReq!.parentSeq).toBe(toolCallReq!.seq);

    const samplingResp = records.find((r) => r.kind === 'response' && r.requestSeq === samplingReq!.seq);
    expect(samplingResp).toBeDefined();
    expect(samplingResp!.parentSeq).toBe(samplingReq!.seq);

    const toolCallResp = records.find((r) => r.kind === 'response' && r.requestSeq === toolCallReq!.seq);
    expect(toolCallResp).toBeDefined();
    expect(toolCallResp!.parentSeq).toBe(toolCallReq!.seq);

    // seq is contiguous and gapless across the whole file (verify() already checked this,
    // this just spells out the expectation for readability)
    const seqs = records.map((r) => r.seq).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
  }, 20000);
});
