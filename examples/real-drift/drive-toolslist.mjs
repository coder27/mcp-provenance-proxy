import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const configPath = process.argv[2];
const proxy = spawn(
  '/Users/jatingarg/Documents/personal/mcp-provenance-proxy/dist/cli.js',
  ['run', '--config', configPath],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);

const rl = createInterface({ input: proxy.stdout });
const lines = [];
const waiters = [];
rl.on('line', (line) => {
  const w = waiters.shift();
  if (w) w(line);
  else lines.push(line);
});
function next() {
  const l = lines.shift();
  if (l !== undefined) return Promise.resolve(l);
  return new Promise((resolve) => waiters.push(resolve));
}
function send(obj) {
  proxy.stdin.write(`${JSON.stringify(obj)}\n`);
}

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'drift-demo', version: '0.0.1' } } });
await next();
send({ jsonrpc: '2.0', method: 'notifications/initialized' });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
await next();
proxy.stdin.end();
proxy.on('exit', () => process.exit(0));
