# Example: wrapping the official filesystem MCP server

This wraps [`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) — a real, third-party MCP server, not the in-repo test fixture — to show the proxy working against genuine upstream behavior.

`sandbox/` is the directory the filesystem server is allowed to touch; `mcp-provenance-proxy.config.json` points the proxy at it via `npx`.

## Run it

From this directory (after `npm run build` in the repo root):

```bash
node ../../dist/cli.js run --config ./mcp-provenance-proxy.config.json
```

This blocks, waiting for a client on stdin — point your MCP client's server config at this command, or drive it by hand by piping newline-delimited JSON-RPC into it. A real run produced:

```
$ echo '{"jsonrpc":"2.0","id":1,"method":"initialize", ...}' | node ../../dist/cli.js run --config ./mcp-provenance-proxy.config.json
Secure MCP Filesystem Server running on stdio
{"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"secure-filesystem-server","version":"0.2.0"}},"jsonrpc":"2.0","id":1}
{"result":{"tools":[{"name":"read_file", ...}, {"name":"read_text_file", ...}, ...]},"jsonrpc":"2.0","id":2}
{"result":{"content":[{"type":"text","text":"- Buy groceries\n- Finish the quarterly budget review\n- Call the bank about the mortgage\n"}], ...},"jsonrpc":"2.0","id":3}
```

Every line reaching the client is exactly what `secure-filesystem-server` sent — the proxy changed nothing.

## Inspect what got recorded

```bash
$ node ../../dist/cli.js replay <sessionId>
[#1] request client->server initialize
  [#2] response server->client (response) 2757ms
[#3] notification client->server notifications/initialized
[#4] request client->server tools/list
  [#5] response server->client (response) 4ms
[#6] request client->server tools/call tool=read_text_file args={"path":"todo.txt"}
  [#7] response server->client (response) 2ms

$ node ../../dist/cli.js verify <sessionId>
OK: 7 record(s) verified, chain intact (final hash 070baac3093ad26b...)
```

`<sessionId>` is whatever's under `./.mcp-provenance/sessions/` after a run — the proxy prints nothing about it itself in v1 (see the main README's [Limitations](../../README.md#limitations--non-goals)); find it with `ls .mcp-provenance/sessions/`.

Run it twice and `mcp-provenance-proxy drift` will report nothing, since `server-filesystem`'s tool contracts don't change between runs — see the main README's [worked drift example](../../README.md#tool-contract-drift-detection--a-worked-example) for what it looks like when they do.
