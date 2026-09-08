# Security Policy

`mcp-provenance-proxy` is a tamper-evidence and audit tool — its integrity properties are the whole point, so a bug that lets tampering go undetected (a hash-chain bypass, a drift event that should fire but doesn't, a way to make `verify` report `OK` on a corrupted log) is treated as a security issue, not just a bug.

## Reporting a vulnerability

Please report suspected vulnerabilities privately via [GitHub's private security advisory feature](../../security/advisories/new) on this repository, rather than opening a public issue. Include:

- What you found and why it matters (what integrity/detection property it breaks).
- Steps to reproduce, or a minimal example log/config that demonstrates it.
- Any suggested fix, if you have one.

You should get an acknowledgment within a few days. There's no bug bounty — this is a small open-source project — but responsibly reported issues will be credited in the changelog once fixed, unless you'd prefer otherwise.

## Scope

In scope: the hash-chain and `verify` logic, drift detection and baseline comparison, and the proxy's pass-through fidelity (anything that causes it to silently alter, drop, or misattribute a message).

Out of scope (see the README's [Limitations](README.md#limitations--non-goals) for the full list): this is v1, observe-and-record only — it does not authenticate, authorize, or block anything, and `baseline.json` itself is a mutable index, not part of the hash chain. Reports about missing features in those areas are welcome as regular issues, just not as security reports.

## Supported versions

Pre-1.0: only the latest published version is supported. There is no long-term support branch yet.
