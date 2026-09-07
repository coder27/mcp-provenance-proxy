#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadConfig } from './config.js';
import { listDrift } from './commands/drift.js';
import { replaySession } from './commands/replay.js';
import { verifyCommand } from './commands/verify.js';
import { runProxy } from './proxy/run.js';

const USAGE = `Usage:
  mcp-provenance-proxy run --config <path>
  mcp-provenance-proxy replay <sessionId> [--storage-dir <dir>]
  mcp-provenance-proxy verify <sessionId> [--storage-dir <dir>]
  mcp-provenance-proxy drift [--session <sessionId>] [--storage-dir <dir>]`;

const DEFAULT_STORAGE_DIR = '.mcp-provenance';

export async function main(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  switch (subcommand) {
    case 'run': {
      const { values } = parseArgs({ args: rest, options: { config: { type: 'string' } } });
      if (!values.config) {
        console.error(USAGE);
        return 1;
      }
      const config = loadConfig(values.config);
      return runProxy({ config, clientInput: process.stdin, clientOutput: process.stdout });
    }

    case 'replay': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { 'storage-dir': { type: 'string', default: DEFAULT_STORAGE_DIR } },
      });
      const sessionId = positionals[0];
      if (!sessionId) {
        console.error(USAGE);
        return 1;
      }
      console.log(replaySession(values['storage-dir'] as string, sessionId));
      return 0;
    }

    case 'verify': {
      const { values, positionals } = parseArgs({
        args: rest,
        allowPositionals: true,
        options: { 'storage-dir': { type: 'string', default: DEFAULT_STORAGE_DIR } },
      });
      const sessionId = positionals[0];
      if (!sessionId) {
        console.error(USAGE);
        return 1;
      }
      const result = verifyCommand(values['storage-dir'] as string, sessionId);
      console.log(result.message);
      return result.ok ? 0 : 1;
    }

    case 'drift': {
      const { values } = parseArgs({
        args: rest,
        options: {
          'storage-dir': { type: 'string', default: DEFAULT_STORAGE_DIR },
          session: { type: 'string' },
        },
      });
      console.log(listDrift(values['storage-dir'] as string, values.session as string | undefined));
      return 0;
    }

    default: {
      console.error(USAGE);
      return 1;
    }
  }
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
if (isDirectRun) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
