# Dep-graph commit SHA pinning

**Spec:** [[../../../haikai/specs/2026-04-27-depgraph-commit-sha]]
**Shipped:** 2026-05-01 (commit f97e021)

## The change

Before: `_depgraph.meta.json` recorded `commit_sha: "head"` — a placeholder string.
After: `_depgraph.meta.json` records the actual 40-char git SHA at snapshot time, plus `repo_remote` (the upstream URL).

The benchmark runner (`scripts/run_v2_50_repos.py`) gained `_resolve_head_sha()` which calls `git rev-parse HEAD` in the target repo. Snapshot directories now use the short SHA in their path (e.g. `v2_50run_snapshots/openmrs-core/abc1234/`) instead of the literal string `head`.

## Why it matters

Without a real SHA, downstream tools cannot answer "is this snapshot stale?" with precision. They have to fall back to file mtimes, which:
- lie when files are touched without content change (e.g. `chmod`, line-ending normalization)
- are unavailable across machine boundaries (snapshot built on machine A, queried on machine B)
- have no relationship to what git considers the codebase state

A real SHA gives every downstream tool a stable identity for the snapshot's source state.

## What it unlocked

[[refactoring-engines]] — the staleness engine immediately uses `commit_sha` when present, falling back to mtime only when absent. The fallback is intentional (older snapshots from before this change still work) but every new snapshot gets the precise version.

## Validation

40-char SHA validation in the loader rejects invalid values: anything that's not exactly 40 hex chars is dropped. This catches the placeholder case ("head", "main", empty string) explicitly rather than letting bad data flow through.

## Why it was a separate spec

It could have been a one-line fix inside the refactoring spec, but it has independent value: any tool that consumes the dep-graph metadata benefits, not just the refactoring engines. Splitting it out kept both specs focused and let the change land first as an unblocker.

## Sources

- [[../../raw/2026-05-01_commit-batch]]
- [[../../../haikai/specs/2026-04-27-depgraph-commit-sha/spec]]
