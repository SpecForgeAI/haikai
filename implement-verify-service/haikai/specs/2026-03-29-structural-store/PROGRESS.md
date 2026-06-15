# Progress: Structural Store + Tree-sitter Call Graph

**Branch:** `main` (all merged)
**Date:** 2026-03-31
**Tests:** 697+ (34 new skill tests + 271 existing structural/AST tests)
**Latest commit:** `c1fcbd1`

---

## Done and Integration Tested

| Feature | Unit Tests | Integration Tests | Endpoint Tested |
|---------|-----------|------------------|----------------|
| Ctags provider (symbols, inheritance) | 16 | via diagram integration | `/analyze` |
| FileStore (all writers, pruning, latest pointer) | 27 | via diagram integration | `/analyze`, `/raw` |
| Tree-sitter call graph (5-stage resolution) | 34 | 19 real-data tests | `/analyze` |
| Tree-sitter import extraction | 5 + 3 integration | 19 real-data tests | `/analyze`, `/raw` |
| Provider merging (ctags + tree-sitter) | 6 + 1 integration | via diagram integration | `/analyze` |
| Structural diff (`_diff.txt`) | 8 | — | `/analyze` x2 |
| Diagrams: all 7 builders | 24 | 35 end-to-end pipeline tests | `/diagrams/generate` |
| Serialisers: Mermaid, PlantUML, Graphviz, Metamodel | 40 | 35 end-to-end pipeline tests | `/diagrams/generate` |
| Metamodel engine | 12 | 1 real-data test | `/metamodel/populate` |
| **TypeScript extractor** | 21 | 9 cross-language | — |
| **Go extractor** | 17 | 9 cross-language | — |
| **Multi-language regression** | 13 | 13 (baseline comparison) | — |
| **Resilience scenarios** | — | 8 functional scenarios | — |
| **Test coverage analysis skill** | — | 34 (all integration, real test suite) | CLI |
| Query endpoint | — | — | `/query` |
| Sequence diagram filtering | Integration | via diagram integration | — |
| Path normalization | Integration | via diagram integration | All endpoints |

---

## Recently Completed (2026-03-31)

| Item | Commit | Notes |
|------|--------|-------|
| Merged multi-language branch to main | `cb386c2` | Python/TS/Go extractors, 271 tests passing |
| Language expansion spec | `20dd22a` | Java, C#, C, Rust, C++ — spec + tasks |
| Test coverage analysis skill | `c1fcbd1` | Full pipeline: discover → classify → map → report |
| Test coverage skill spec | `d3cb868` | Spec + requirements + tasks |

---

## Outstanding

| Item | Effort | Notes |
|------|--------|-------|
| Snapshot pruning integration test | Small | Unit tested but never hit `max_snapshots` via endpoint |
| Update docs (CHANGELOG, ARCHITECTURE, API, README) | Medium | Reflect multi-language + pipeline + skill changes |
| Revisit test coverage numbers | Medium | 160 synthetic-only tests (23%) — review gaps, push real-data backing higher |

---

## Not Done (specced, not implemented)

| Item | Spec Location | Effort | Priority |
|------|--------------|--------|----------|
| Tree-sitter language expansion (Java/C#/C/Rust/C++) | `2026-03-31-treesitter-language-expansion/` | Large — 5 phases, 63 tasks | Next |
| Pattern detection refactor (signal-based scoring) | `2026-03-29-pattern-detection/` | Medium — 2 phases, 17 tasks | — |
| Chat session memory (SQLite persistence) | `2026-03-15-chat-session-memory/` | Medium | — |
| Diff/delta standards (version tracking) | `2026-03-15-diff-delta-standards/` | Medium | — |
| Git history analysis (temporal patterns) | `2026-03-15-git-history-analysis/` | Large | — |
| Metamodel validation (JSON schema, hallucination detection) | `2026-03-15-metamodel-validation/` | Medium | — |
| RAG/embeddings (ChromaDB vector store) | `2026-03-15-rag-embeddings/` | Large | — |
| Deferred branch creation | `2026-03-15-deferred-branch-creation/` | Small | — |

---

## Out of Scope (explicitly excluded)

- ML-based pattern detection
- Language-specific patterns (Python descriptors, Java annotations)
- Anti-pattern detection (god class, spaghetti)
- Custom user-defined patterns
- Cross-file data flow analysis
- Dynamic dispatch resolution (`strategies[key].execute()`)
- Async/await-specific call tracking
- Cross-repo queries
- Interactive exploration UI
- LSP-based call graph (parked on `feature/lsp-call-graph-2026-03-29`)

---

## Branches

| Branch | Status | Contents |
|--------|--------|----------|
| `main` | Active | All features merged |
| `feature/treesitter-multi-language-2026-03-30` | Merged | Phase 1+2, all tests, resilience |
| `fix/outstanding-remediation-2026-03-30` | Merged | pipeline.py, two-pass imports |
| `feature/structural-store-2026-03-29` | Merged | Original structural store |
| `feature/lsp-call-graph-2026-03-29` | Parked | LSP provider, replaced by tree-sitter |
| `feature/benchmarking-harness` | Active | AIMultiple benchmark work |
