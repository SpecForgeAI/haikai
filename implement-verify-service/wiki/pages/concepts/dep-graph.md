# Dependency graph

A SQLite projection of an extraction snapshot. Lives in `src/dep/` and writes one database per snapshot at `<snapshot>/_depgraph.sqlite`.

## Why a SQL projection of an already-extracted store?

The [[structural-store]] is optimized for **LLM grep**: flat text files, human-diffable, cheap to read fragmentarily. The dep-graph is optimized for **structured queries**: "give me the call subgraph rooted at `OrderService.placeOrder`", "which symbols import `org.springframework.web`", "what endpoints exist with `framework='spring-boot'`".

Both views exist deliberately. The text store feeds [[agentic-discovery]] and discovery skills; the SQL store feeds [[refactoring-engines]] and impact analysis ([[refactoring-engines]] → change_detector → "what breaks if I rename this?").

## Schema

7 tables + a meta table. From `src/dep/schema.sql`:

| Table | Rows are | Key fields |
|---|---|---|
| `files` | one per source file | `path`, `language`, `byte_size`, `n_symbols` |
| `symbols` | one per function/class/method | `qualified_name` (canonical id), `name`, `kind`, `file_id`, `line` |
| `imports` | one per import statement | `package`, `imported_name`, `file_id` |
| `calls` | one per call edge | `caller_symbol_id` → `callee_symbol_id` (or `callee_qualified_name` when unresolved), `confidence` |
| `inheritance` | one per `extends` / `implements` / `mixin` / `uses` | `child_symbol_id` → `parent_symbol_id` (or `parent_qualified_name`) |
| `endpoints` | one per discovered HTTP endpoint | `operation`, `path`, `framework`, `handler_symbol_id` |
| `interactions` | one per DB / queue / HTTP-outbound call | `mechanism` (`db_query`/`db_write`/`http_outbound`/`queue_publish`/`queue_consume`/...), `direction`, `target`, `data_hint` |
| `meta` | key/value | snapshot metadata — commit SHA, builder version |

Key invariants from `schema.sql`:
- `caller_symbol_id` may be `NULL` when the caller is a file-level statement.
- `callee_qualified_name` is **always** populated, even when `callee_symbol_id` is `NULL` (cross-file calls that didn't resolve).
- `parent_qualified_name` is similarly always populated.

These nullable-FK + always-populated-name patterns mean queries can answer "what does X call?" even when X's callees couldn't be resolved to symbols in the snapshot.

## Build is pure projection

`src/dep/builder.py:run(snapshot_path)`:
- Reads the snapshot's TSV outputs (files, symbols, imports, calls, inheritance, endpoints, interactions).
- Inserts in dependency order: files → symbols → everything-else.
- Single transaction, file-locked, idempotent.
- **No LLM. No semantic analysis.** Same input → same output (modulo VACUUM).

This is the boundary between V2's [[v2-extraction-pipeline]] / [[agentic-discovery]] (which produce the TSVs, possibly using LLMs) and the dep-graph (which is just the SQL view of those TSVs).

## SQLite settings

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;     -- concurrent reads while one writer
PRAGMA synchronous = NORMAL;   -- WAL-safe + faster than FULL
```

WAL mode is what lets concurrent rebuilds work — last writer wins, but the result is identical because the build is deterministic.

## Commit SHA pinning

Each snapshot is keyed by a real git commit SHA, not a placeholder timestamp. See [[depgraph-commit-sha]] for why this matters. The SHA lives in the `meta` table and in the snapshot path itself.

## Consumers

- **[[refactoring-engines]]** — `change_detector` queries `symbols` + `calls` + `imports` to identify what a code change breaks. `staleness` compares the live tree against the snapshot's pinned SHA.
- **api_impact** (planned, spec `2026-04-28-api-impact-routes`) — joins `endpoints` + `calls` to answer "what API consumers does this PR break?"
- **CLI**: `src/dep/cli.py` exposes ad-hoc queries against the database.

## Sources

- `src/dep/schema.sql`, `src/dep/builder.py`, `src/dep/db.py`
- [[depgraph-commit-sha]] — the SHA-pinning decision
- [[refactoring-engines]] — primary consumer
- [[../../raw/2026-05-04_codebase-walk]]
