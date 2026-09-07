import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  CreateMessageResultSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

interface FakeTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const tools: FakeTool[] = JSON.parse(process.env.FAKE_TOOLS_JSON ?? '[]');

const server = new Server({ name: 'fake-upstream', version: '0.0.1' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'plan_and_search') {
    const samplingResult = await server.request(
      {
        method: 'sampling/createMessage',
        params: {
          messages: [{ role: 'user', content: { type: 'text', text: `plan for: ${JSON.stringify(args)}` } }],
          maxTokens: 100,
        },
      },
      CreateMessageResultSchema,
    );
    return {
      content: [{ type: 'text', text: `planned using sampling result: ${JSON.stringify(samplingResult)}` }],
    };
  }

  return {
    content: [{ type: 'text', text: `called ${name} with ${JSON.stringify(args ?? {})}` }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
