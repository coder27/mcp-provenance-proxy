import { existsSync, readFileSync } from 'node:fs';

export interface ProxyConfig {
  upstream: { command: string; args: string[]; env?: Record<string, string> };
  storageDir: string;
}

export function loadConfig(filePath: string): ProxyConfig {
  if (!existsSync(filePath)) {
    throw new Error(`Config file not found: ${filePath}`);
  }
  const raw: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Config must be a JSON object');
  }
  const obj = raw as Record<string, unknown>;
  const upstream = obj.upstream as Record<string, unknown> | undefined;
  if (!upstream || typeof upstream.command !== 'string') {
    throw new Error('Config must specify upstream.command (string)');
  }
  const args = Array.isArray(upstream.args) ? upstream.args.map((a) => String(a)) : [];
  const storageDir = typeof obj.storageDir === 'string' ? obj.storageDir : '.mcp-provenance';
  const env =
    typeof upstream.env === 'object' && upstream.env !== null
      ? (upstream.env as Record<string, string>)
      : undefined;
  return { upstream: { command: upstream.command, args, ...(env && { env }) }, storageDir };
}
