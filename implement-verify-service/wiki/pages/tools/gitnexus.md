# GitNexus

Third-party code-analysis tool used as the primary external comparison baseline for V2. Located at `/d/temp/gitnexus`.

## What it is

A TypeScript monorepo that ingests a git repository, builds a `KnowledgeGraph` via tree-sitter AST extraction across 12 in-memory pipeline phases, then flushes the result to **LadybugDB** (their embedded graph database) under `.gitnexus/` in the target repo. Exposes Cypher querying, hybrid BM25+vector semantic search, an MCP server, and an `impact` / `context` CLI.

## What it produces

| Artifact | Where | Notes |
|---|---|---|
| KnowledgeGraph | `.gitnexus/` (LadybugDB) | Persisted nodes + edges |
| `Process` nodes | Graph | Leiden community detection — fine-grained (300 on openmrs-core) |
| `Annotation` nodes | Graph | Captures custom `@interface` declarations |
| Markdown wiki | via `gitnexus wiki <repo>` | Generated from the graph (not exercised this session) |

## What it doesn't produce

- **No `Route` nodes.** Zero across both Java repos tested.
- **No standard HTTP framework annotations** (no `@Mapping`, `@Controller`, `@Path`, `@GET`, `@POST`, `@Rest*`). See [[../findings/gitnexus-no-routes]].
- No human-curated synthesis between runs — every `analyze` regenerates the graph from current source state.

## Strengths (relative to V2)

- **Cypher access** to the full graph.
- **Hybrid semantic query** (BM25 + vector) — `query "patient management"` returned relevant methods in 1150ms on openmrs.
- **Symbol-level `impact`** with full UID disambiguation.
- **`context` neighborhood walks** for incoming/outgoing call analysis.
- **Built-in MCP server** for agent integration.
- **Process discovery** via Leiden — much finer than V2's Louvain.

## Weaknesses (relative to V2)

- **Scaling cliff.** In-memory pipeline OOM'd on Kibana (~6,652 files) at 18.7 GB RAM after 75+ min, with zero output flushed. V2's streaming-to-disk architecture handles repos of this size.
- **No HTTP route abstraction.** Cannot answer "what endpoints does this service expose?" without re-running discovery on raw source.
- **No incremental human synthesis.** The graph reflects code; project-level decisions, comparison findings, and architectural rationale are not captured.

## Operational notes

- CLI surface: `setup`, `analyze`, `index`, `serve`, `mcp`, `list`, `status`, `clean`, `remove`, `wiki`, `augment`, `query`, `context`, `impact`, `cypher`, `detect-changes`, `eval-server`, `group`.
- Multi-repo state requires `--repo <name>` on `cypher` calls (otherwise throws "Multiple repositories indexed").
- Cypher property names are unstable — use `RETURN n.*` first to discover schema before querying specific fields.

## Sources

- [[../../raw/2026-05-01_gitnexus_session]]
