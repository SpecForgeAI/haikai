# GitNexus vs V2 (head-to-head)

Empirical comparison from 2026-05-01 session. See [[../tools/gitnexus]] and [[../../raw/2026-05-01_gitnexus_session]].

## Repos tested

| Repo | Size | GitNexus | V2 |
|---|---|---|---|
| spring-petclinic | 30 files | indexed (44 MB `.gitnexus/`) | 17 endpoints |
| openmrs-core | 1,273 files | analyzed in 78.9s | 13 endpoints |
| kibana | 6,652 files | **OOM** at 18.7 GB after 75+ min | analyzed (streaming) |

## Capability matrix

| Capability | GitNexus | V2 | Notes |
|---|---|---|---|
| AST symbol extraction | ✅ tree-sitter | ✅ ctags + tree-sitter | Comparable |
| Call graph | ✅ persisted | ✅ via SQLite projection | Comparable |
| HTTP route extraction | ❌ 0 routes | ✅ playbook-driven | See [[../findings/gitnexus-no-routes]] |
| Annotation capture | ⚠️ declarations only | ✅ applied annotations | GitNexus only stores `@interface` defs |
| Cypher querying | ✅ | ❌ | V2 gap |
| Hybrid semantic search | ✅ BM25 + vector (1150ms) | ❌ | V2 gap |
| Symbol-level impact | ✅ `impact <UID>` | ⚠️ partial | UID disambiguation required |
| Call neighborhood (`context`) | ✅ | ⚠️ partial | V2 has structural store probes |
| Process discovery | ✅ Leiden, 300 on openmrs | ✅ Louvain, coarser | Different algorithms |
| MCP server | ✅ built-in | ⚠️ in progress | |
| Generated wiki | ✅ `gitnexus wiki <repo>` | ❌ | V2 has Haikai + (now) this LLM Wiki |
| Streaming pipeline | ❌ in-memory, OOM-prone | ✅ streaming-to-disk | V2 handles repos GitNexus cannot |
| Incremental analysis | `detect-changes` (untested) | partial via depgraph commit-sha | |

## Architectural divergence

**GitNexus:** 12-phase in-memory KnowledgeGraph → flush to LadybugDB once. Optimized for query-time access via Cypher and graph algorithms. Single-pass, deterministic, regenerated from source state.

**V2:** Streaming subprocess (ctags) → TSV files → SQLite projection → playbook-driven LLM discovery → endpoint/interaction records. Separates mechanical extraction (AST layer) from framework interpretation (LLM layer) per [[../../../CLAUDE.md]] architecture principle.

The architectures reflect different bets:
- GitNexus bets that **graph completeness** (every symbol, every call, persisted) plus **flexible query** (Cypher, semantic) lets downstream agents derive any answer.
- V2 bets that **first-class semantic abstractions** (endpoints, interactions) extracted via LLM-driven playbooks deliver more directly useful answers, at the cost of upfront framework support.

## Cross-cutting failure modes observed

- **Kibana OOM (GitNexus):** in-memory architecture cannot scale past ~6,000 files on commodity hardware. Hard cliff, no graceful degradation.
- **Symbol disambiguation (GitNexus):** short names match many UIDs in `impact` queries. Requires fully-qualified `Method:path/to/file:Class.method#N` syntax.
- **Multi-repo state (GitNexus):** Cypher requires explicit `--repo` flag once more than one repo is indexed; otherwise throws.

## What V2 should consider adopting

- **Cypher-like graph querying** over the SQLite projection. Today V2 exposes structured probes; a more general query layer would enable richer agent workflows.
- **Hybrid BM25+vector semantic search** over symbols. GitNexus's `query` returned relevant results in ~1s; V2 has no equivalent.
- **Symbol-level impact analysis with UID disambiguation** — direct overlap with spec #91.

## What GitNexus should consider adopting

(Out of scope for us, but informs V2 positioning)

- **Streaming pipeline architecture** — would lift the Kibana ceiling.
- **First-class route abstraction** — see [[../findings/gitnexus-no-routes]].
- **LLM-driven framework interpretation layer** — V2's [[../../../CLAUDE.md]] principle.

## Sources

- [[../../raw/2026-05-01_gitnexus_session]]
