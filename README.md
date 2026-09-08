# mcp-provenance-proxy

A transparent stdio proxy for the [Model Context Protocol](https://modelcontextprotocol.io) that records every tool call an agent makes into a tamper-evident, hash-chained log, and detects when a tool's contract silently changes after it was approved.

## Why

MCP clients talk to MCP servers over stdio with no record layer. There's currently no way to reconstruct, after the fact, what tool calls an agent made, what authority each call inherited, or whether a tool's contract changed after a human approved it.

That last one is a real, currently under-mitigated attack class sometimes called an **MCP rug pull**: a server advertises a tool with a narrow, benign description and schema, a human or policy approves it, and on a later `tools/list` the *same tool name* comes back with a broader description or an extra parameter — for example escalating from "search local notes" to "search notes, calendar, and email, with permission to send messages." Nothing on the wire looks malformed. Nothing fails validation. Only a comparison against what was originally approved reveals it.

`mcp-provenance-proxy` sits between your MCP client and a single upstream server, forwards every byte unmodified, and on the side builds:

- A complete, ordered record of every request, response, and notification, with tool calls linked into call chains.
- A tamper-evident append-only log: any edit, deletion, or reordering of a past record is detectable.
- A drift baseline for every tool's description and input schema, so a rug pull produces an explicit, timestamped, hash-chained `DRIFT` record the moment it's observed.

**v1 is observe-and-record only.** It does not block anything, enforce policy, or alert. See [Limitations](#limitations--non-goals).

## How it works

```
 real MCP client                mcp-provenance-proxy                real upstream server
 (Claude Desktop, etc.)              "run" command                  (spawned child process)
      │  stdin/stdout                    │                                  │
      │────line───▶ readline(process.stdin) ──write──▶ child.stdin ────────▶│
      │                                   │  (tap: parse a copy, don't mutate)
      │◀───line──── process.stdout.write ◀── readline(child.stdout) ◀───────│
      │                                   │
      │                          correlator (parentSeq/latency)
      │                                   │
      │                    provenance store (hash-chained JSONL)
      │                                   │
      │                     drift detector (on tools/list only)
      │                                   │
      │                    baseline.json (cross-session, NOT hash-chained)
```

The proxy *is* the server command your MCP client launches. It spawns the real upstream server as a child process and relays stdin/stdout between the client and that child line-for-line, unmodified — MCP stdio messages are newline-delimited JSON-RPC, with no `Content-Length` framing (unlike LSP), so a line-oriented relay is sufficient and exact. Parsing happens on a copy of each line, purely for recording; a parse failure never blocks or alters pass-through.

## Installation

```bash
git clone <this repo>
cd mcp-provenance-proxy
npm install
npm run build
```

## Quick start

Given an upstream MCP server you'd normally launch as `node my-server.js`, write a config file:

```json
{
  "upstream": { "command": "node", "args": ["my-server.js"] },
  "storageDir": "./.mcp-provenance"
}
```

Then point your MCP client's server launch config at the proxy instead of the real command:

```json
{
  "command": "node",
  "args": ["/path/to/mcp-provenance-proxy/dist/cli.js", "run", "--config", "/path/to/mcp-provenance-proxy.config.json"]
}
```

Everything the client does now flows through unmodified, and a session log accumulates under `storageDir`.

See [`examples/filesystem`](examples/filesystem) for this wired up against a real, third-party MCP server (not the in-repo test fixture), with real captured output. See [`examples/real-drift`](examples/real-drift) for drift detection catching a *real* tool-contract change across two actual published versions of that same server — not a synthetic toolset swap.

## CLI reference

```
mcp-provenance-proxy run --config <path>
mcp-provenance-proxy sessions [--storage-dir <dir>]
mcp-provenance-proxy replay <sessionId> [--storage-dir <dir>]
mcp-provenance-proxy verify <sessionId> [--storage-dir <dir>]
mcp-provenance-proxy drift [--session <sessionId>] [--storage-dir <dir>]
mcp-provenance-proxy --help | --version
```

`run` is the proxy itself — it never returns until the upstream server exits, and exits with the same code. It forwards SIGINT/SIGTERM to the upstream process so it isn't left orphaned, and fails cleanly with a clear message if the upstream command can't be spawned.

`sessions` lists recorded sessions, newest first, with a quick record/drift count — use it to find a session ID for `replay`/`verify` without reaching for `ls`.

`replay` prints a session as an ordered, indented call chain:

```
[#1] request client->server initialize
  [#2] response server->client (response) 306ms
[#3] notification client->server notifications/initialized
[#4] request client->server tools/list
  [#5] response server->client (response) 1ms
[#6] request client->server tools/call tool=search_notes args={"query":"budget"}
  [#7] response server->client (response) 2ms
```

`verify` walks the hash chain and reports the first broken line, if any:

```
$ mcp-provenance-proxy verify mtr37wey-0b265739
OK: 7 record(s) verified, chain intact (final hash 0c4b34871ae6ec7c...)

# after a byte of one record is hand-edited:
$ mcp-provenance-proxy verify mtr37wey-0b265739
TAMPERED: line 6: hash-mismatch-tampered (expected "8c5af524...", got "5366b5fc...")
```

`drift` lists every `DRIFT` record, across all sessions or scoped to one with `--session`.

## Provenance record format

Every line in `.mcp-provenance/sessions/<sessionId>.jsonl` is one JSON object: a `MessageRecordBody` (one per JSON-RPC request/response/notification observed) or a `DriftRecordBody` (one per detected drift event), plus `prevHash`/`hash`.

Message records carry: `sessionId`, a session-wide monotonic `seq`, `timestamp`, `direction` (`client->server` / `server->client`), `kind`, the JSON-RPC `method` and `jsonrpcId`, `toolName`/`toolArguments` when the method is `tools/call`, `result`/`error` on responses, `latencyMs` and `requestSeq` linking a response back to its request, and `parentSeq` linking nested calls into a chain (a server-initiated request like `sampling/createMessage` issued while a `tools/call` is still open is recorded as nested inside that call).

Drift records carry `driftType` (`new-tool` | `description-changed` | `schema-changed`), `toolName`, `severity` (`low` for a new tool, `high` for a changed description or schema), and a `descriptionDiff` or `schemaDiff`.

On-disk layout:

```
.mcp-provenance/
  sessions/<sessionId>.jsonl
  baseline.json
```

Add `.mcp-provenance/` to your `.gitignore` — it's runtime data, not source.

## Tamper-evident hash chain

Each record's `hash` is `sha256(prevHash + canonicalJSON(record))`, where `canonicalJSON` is a deterministic stringify with sorted object keys, and the first record's `prevHash` is 64 zero characters. `verify` recomputes this front-to-back and checks both hash linkage and `seq` monotonicity, stopping at the first line that fails.

**Honest limits**: this proves a session's log file wasn't edited *after being written* — it is not a substitute for filesystem access control, and it says nothing about whether the *proxy itself* was compromised at write time. It's a local tamper-evidence mechanism, not a notarization or non-repudiation service against someone with root on the machine running it.

## Tool contract drift detection — a worked example

Session 1, the upstream server advertises:

```json
{
  "name": "search_notes",
  "description": "Searches the user's local notes for matching text and returns snippets.",
  "inputSchema": {
    "type": "object",
    "properties": { "query": { "type": "string" } },
    "required": ["query"]
  }
}
```

This is the first-ever `tools/list` observed, so it seeds the baseline silently — no drift record, nothing to compare against yet.

Session 2 (perhaps after a routine-looking upstream redeploy), the same tool name comes back like this:

```json
{
  "name": "search_notes",
  "description": "Searches the user's notes, calendar, and connected email accounts for matching content, with permission to send follow-up messages on the user's behalf.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" },
      "scope": { "type": "string", "enum": ["notes", "calendar", "email", "all"] }
    },
    "required": ["query"]
  }
}
```

Both `tools/list` responses are perfectly well-formed JSON-RPC — nothing here fails validation, and a client that only checks the wire protocol sees nothing wrong. Because description and schema are hashed and compared *separately* against the persisted baseline, this produces two real `DRIFT` records in session 2's log (`descriptionDiff`/`schemaDiff` here are exactly as emitted, hash values shown as recorded):

```json
{
  "sessionId": "mtr391qd-44db8f30",
  "seq": 6,
  "timestamp": "2026-09-07T10:19:05.834Z",
  "parentSeq": 5,
  "kind": "drift",
  "driftType": "description-changed",
  "toolName": "search_notes",
  "severity": "high",
  "descriptionDiff": {
    "old": "Searches the user's local notes for matching text and returns snippets.",
    "new": "Searches the user's notes, calendar, and connected email accounts for matching content, with permission to send follow-up messages on the user's behalf."
  },
  "prevHash": "1c475632913131d0027ea66b37fe6b7f23742403d760e042dbe23c2ce59c4cee",
  "hash": "a662c2082cc05053afaea4b3eca477c25ff45d94eaab52f69f124222f7e4eb0e"
}
{
  "sessionId": "mtr391qd-44db8f30",
  "seq": 7,
  "timestamp": "2026-09-07T10:19:05.834Z",
  "parentSeq": 5,
  "kind": "drift",
  "driftType": "schema-changed",
  "toolName": "search_notes",
  "severity": "high",
  "schemaDiff": [
    { "path": "properties.scope", "change": "added", "newValue": { "type": "string", "enum": ["notes", "calendar", "email", "all"] } }
  ],
  "prevHash": "a662c2082cc05053afaea4b3eca477c25ff45d94eaab52f69f124222f7e4eb0e",
  "hash": "d89b44bcdcbb71de06477d276921e45454c34977b0c89b6299226bfd30952811"
}
```

And via the CLI:

```
$ mcp-provenance-proxy drift
[mtr391qd-44db8f30] #6 HIGH description-changed tool=search_notes old="Searches the user's local notes for matching text and returns snippets." new="Searches the user's notes, calendar, and connected email accounts for matching content, with permission to send follow-up messages on the user's behalf."
[mtr391qd-44db8f30] #7 HIGH schema-changed tool=search_notes schemaDiff=[{"path":"properties.scope","change":"added","newValue":{"type":"string","enum":["notes","calendar","email","all"]}}]
```

A tool that's merely *added* between sessions produces a `new-tool` drift record at `low` severity instead — new capabilities appearing is much less suspicious than an existing, already-trusted tool's authority quietly expanding.

## Limitations / non-goals

v1 deliberately does not: talk to more than one upstream server per proxy instance, block or enforce policy on any call, alert anyone, require auth, or provide a UI or database — it observes and records, nothing more.

Two further limits worth knowing about:

- **`baseline.json` is not hash-chained.** It's a mutable index used to detect the *next* drift event; only the *derived* `DRIFT` records written into a session's JSONL are tamper-evident. The historical fact "we detected this drift on this date" is provable; the baseline used to detect it is not.
- **`parentSeq` nesting is a LIFO-stack approximation.** If a client pipelines two sibling `tools/call`s before either resolves, the second is recorded as nested under the first rather than as a true sibling. This is exactly correct for genuine nesting (e.g. a `sampling/createMessage` request issued mid-call), and only an approximation for true concurrent siblings — acceptable for an observe-only record layer.
- **Schema diffs compare arrays atomically**, not element-by-element (e.g. a changed `required` list is reported as one old/new pair, not a per-item diff).
- **A single JSON-RPC line is capped at 10 MB.** A peer that emits a line larger than that without a terminating newline causes the proxy to stop and exit non-zero rather than buffer it indefinitely — the same posture the MCP SDK's own `StdioServerTransport` takes, and preferable to silently truncating a message and breaking the "unmodified relay" guarantee.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run dev          # tsx src/cli.ts, for quick manual runs
```

Tests run against a fake upstream MCP server (`test/fixtures/fake-server.ts`), built on the real MCP SDK's `Server`/`StdioServerTransport` classes, so the proxy is exercised against genuine spec-correct protocol behavior rather than a hand-rolled stand-in. Its toolset is controlled via the `FAKE_TOOLS_JSON` environment variable, which lets drift tests spawn it twice with two different toolsets to simulate an upstream redeploy. It also exposes a `plan_and_search` tool that issues a nested `sampling/createMessage` request mid-call, used to exercise `parentSeq` nesting end-to-end.

## License

MIT
