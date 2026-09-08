# Changelog

All notable changes to this project are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [0.2.0] - 2026-09-08

### Added

- `mcp-provenance-proxy serve`: a second, separate read-only MCP server exposing this tool's own provenance data as MCP tools — `list_sessions`, `replay_session`, `verify_session`, `list_drift` — so an agent can query its own audit trail conversationally instead of shelling out to the CLI.
- `examples/real-drift`: drift detection run against two real, published versions of `@modelcontextprotocol/server-filesystem` (2025.7.1 vs 2026.8.31), demonstrating actual tool-contract drift rather than a synthetic toolset swap.
- `CONTRIBUTING.md`.
- `package.json` metadata (`repository`, `author`, `homepage`, `bugs`, `keywords`) for GitHub/npm discoverability.

## [0.1.0] - 2026-09-08

Initial release.

### Added

- Transparent stdio proxy: spawns the configured upstream MCP server and relays JSON-RPC lines between client and server byte-for-byte, unmodified.
- Tamper-evident provenance log: every request, response, and notification is recorded to an append-only, hash-chained JSONL file per session, with a `verify` command that detects any edit, deletion, or reordering and reports the first broken line.
- Call-chain correlation: responses are linked back to their request (`requestSeq`, `latencyMs`), and nested calls (e.g. a server-initiated `sampling/createMessage` issued mid-`tools/call`) are linked via `parentSeq`.
- Tool contract drift detection: description and input schema are hashed and compared separately against a persisted baseline on every `tools/list`, producing `DRIFT` records (`new-tool` at low severity; `description-changed`/`schema-changed` at high severity, with a structured diff) — surfacing "MCP rug pulls" where a tool's authority quietly expands after approval.
- CLI: `run`, `sessions`, `replay`, `verify`, `drift`, plus `--help`/`--version`.
- Hardening: clean failure (not a crash) when the upstream command can't be spawned; SIGINT/SIGTERM forwarded to the upstream process so it's never left orphaned; a single JSON-RPC line is capped at 10 MB to bound memory against a broken or malicious peer.
- `examples/filesystem`: the proxy wrapping the real `@modelcontextprotocol/server-filesystem` package, with captured real output.
- CI (GitHub Actions): typecheck, test, and build on every push/PR to `main`.

### Known limitations (see README for detail)

- Single upstream server per proxy instance; no policy enforcement or blocking — observe-and-record only.
- `baseline.json` itself is not hash-chained; only the derived `DRIFT` records are.
- `parentSeq` nesting is a LIFO-stack approximation for genuinely concurrent sibling calls.
- Schema diffs compare arrays atomically, not element-by-element.
