import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { listDrift } from './commands/drift.js';
import { replaySession } from './commands/replay.js';
import { listSessions } from './commands/sessions.js';
import { verifyCommand } from './commands/verify.js';
import { getVersion } from './version.js';

const TOOLS = [
  {
    name: 'list_sessions',
    description: 'List recorded MCP provenance sessions, newest first, with a record/drift count summary.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'replay_session',
    description:
      'Render one session as an ordered, indented call chain: every request, response, and notification, plus any DRIFT events, nested under the call they belong to.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'Session ID, e.g. from list_sessions' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'verify_session',
    description:
      "Verify a session's tamper-evident hash chain. Reports OK, or the first line where the chain was broken by an edit, deletion, or reordering.",
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'Session ID, e.g. from list_sessions' } },
      required: ['sessionId'],
    },
  },
  {
    name: 'list_drift',
    description:
      "List detected tool contract drift events — a tool's description or input schema changing, or a new tool appearing — across all sessions, or one session if sessionId is given.",
    inputSchema: {
      type: 'object',
      properties: { sessionId: { type: 'string', description: 'Optional: scope to one session' } },
    },
  },
] as const;

function textResult(text: string): { content: { type: 'text'; text: string }[]; isError?: boolean } {
  return { content: [{ type: 'text', text }] };
}

function errorResult(text: string): { content: { type: 'text'; text: string }[]; isError: boolean } {
  return { content: [{ type: 'text', text }], isError: true };
}

/**
 * A read-only MCP server exposing this tool's own provenance data (sessions, call
 * chains, hash-chain verification, drift events) as MCP tools, so an agent can query
 * its own audit trail conversationally instead of shelling out to the CLI. No tool
 * here mutates anything — consistent with v1's observe-and-record-only scope.
 */
export function createProvenanceServer(storageDir: string): Server {
  const server = new Server({ name: 'mcp-provenance-proxy', version: getVersion() }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const sessionId = typeof (args as Record<string, unknown> | undefined)?.sessionId === 'string'
      ? (args as { sessionId: string }).sessionId
      : undefined;

    switch (name) {
      case 'list_sessions':
        return textResult(listSessions(storageDir));

      case 'replay_session':
        if (!sessionId) return errorResult('sessionId is required');
        return textResult(replaySession(storageDir, sessionId));

      case 'verify_session': {
        if (!sessionId) return errorResult('sessionId is required');
        const result = verifyCommand(storageDir, sessionId);
        return result.ok ? textResult(result.message) : errorResult(result.message);
      }

      case 'list_drift':
        return textResult(listDrift(storageDir, sessionId));

      default:
        return errorResult(`Unknown tool: ${String(name)}`);
    }
  });

  return server;
}

export async function runServe(storageDir: string): Promise<void> {
  const server = createProvenanceServer(storageDir);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
