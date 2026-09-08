# Contributing

Thanks for considering a contribution. This is a small, young project, so please open an issue before starting anything non-trivial — it's a quick way to avoid work that doesn't fit the project's scope (see the README's [Limitations / non-goals](README.md#limitations--non-goals) for what's explicitly out of scope for now).

## Reporting a bug or requesting a feature

Open a GitHub issue. For bugs, include: what you expected, what happened, and if possible a minimal config/repro (a fake or real upstream server plus the input that triggers it).

For a suspected security or integrity issue (anything that could make tampering go undetected), see [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Development setup

```bash
git clone https://github.com/coder27/mcp-provenance-proxy.git
cd mcp-provenance-proxy
npm install
npm run build
```

Requires Node >= 22.12 (see `.nvmrc`).

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run dev          # tsx src/cli.ts, for quick manual runs without building
```

## Before opening a PR

- `npm run typecheck` and `npm test` must both pass — CI runs the same checks.
- Add or update tests for any behavior change. Most of the test suite is either pure unit tests (no I/O) or real integration tests that spawn the actual proxy/CLI against a fake or real MCP server over stdio — see `test/fixtures/fake-server.ts` for the pattern used to test proxy/drift behavior without a network dependency.
- Keep the change scoped. A bug fix doesn't need an accompanying refactor; a new command doesn't need speculative options nobody asked for yet.
- If the change affects observable behavior (a new CLI flag, a new record field, a new drift type), update the README too — it's meant to stay accurate, not aspirational.

## Code style

TypeScript, strict mode, ESM (`"type": "module"`). No enforced linter/formatter yet — match the style of the surrounding code. Comments are used sparingly, only where the *why* isn't obvious from the code itself (a non-obvious invariant, a workaround, a deliberate simplification) — not to restate what a well-named function already says.

## License

By contributing, you agree your contribution is licensed under this project's [MIT license](LICENSE).
