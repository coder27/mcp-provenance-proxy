#!/usr/bin/env node
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { listDrift } from './commands/drift.js';
import { replaySession } from './commands/replay.js';
import { listSessions } from './commands/sessions.js';
import { verifyCommand } from './commands/verify.js';
import { runProxy } from './proxy/run.js';

const USAGE = `Usage:
  mcp-provenance-proxy run --config <path>
  mcp-provenance-proxy sessions [--storage-dir <dir>]
  mcp-provenance-proxy replay <sessionId> [--storage-dir <dir>]
  mcp-provenance-proxy verify <sessionId> [--storage-dir <dir>]
  mcp-provenance-proxy drift [--session <sessionId>] [--storage-dir <dir>]

Options:
  -h, --help     Show this help
  -v, --version  Show the installed version`;

const DEFAULT_STORAGE_DIR = '.mcp-provenance';

function getVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

export async function main(argv: string[]): Promise<number> {
  const [subcommand, ...rest] = argv;

  if (subcommand === '--help' || subcommand === '-h') {
    console.log(USAGE);
    return 0;
  }
  if (subcommand === '--version' || subcommand === '-v') {
    console.log(getVersion());
    return 0;
  }

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

    case 'sessions': {
      const { values } = parseArgs({
        args: rest,
        options: { 'storage-dir': { type: 'string', default: DEFAULT_STORAGE_DIR } },
      });
      console.log(listSessions(values['storage-dir'] as string));
      return 0;
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

// process.argv[1] is the path Node was invoked with — for an npm-installed bin this is a
// symlink (e.g. bin/mcp-provenance-proxy -> .../dist/cli.js), while import.meta.url resolves
// through it to the real file. Resolve both to the same real path before comparing, or a
// symlinked global install silently never runs main() at all.
function isDirectRun(): boolean {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    });
}
