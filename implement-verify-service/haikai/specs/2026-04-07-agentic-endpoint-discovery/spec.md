# Specification: Agentic Endpoint Discovery — Replace AST Hard-Coding

## Summary

Remove all hard-coded framework-specific endpoint detection from the AST extractors and replace it with LLM-driven agentic discovery. The AST layer should be purely mechanical (structural extraction). The LLM interprets what it sees in the structural store to identify endpoints — for *any* framework, *any* language, without new code.

This is not a 5-language fix. The old approach was locked to Python, Java, TypeScript, Go, and C# because each language needed hand-written detection code. The agentic approach works for every language and every framework the LLM has knowledge of — Ruby/Rails, PHP/Laravel, Rust/Actix, Kotlin/Ktor, Swift/Vapor, Elixir/Phoenix, and anything that emerges in the future. Zero code changes required to support new languages or frameworks.

---

## Problem

The current architecture has two contradictory approaches:

1. **AST extractors** (5 languages × `extract_endpoints()`) — hard-coded pattern matching for specific frameworks: FastAPI decorators, Spring annotations, Express `router.get()`, Go `http.HandleFunc()`, C# `[HttpGet]` attributes.

2. **Agentic enrichment loop** — LLM with structural store tools (`read_calls`, `read_source`, `read_index`, `read_imports`, `read_inheritance`) that can reason about any code.

The hard-coded approach is:
- **Brittle** — each new framework requires new AST code
- **Incomplete** — missed Django `urlpatterns`, NestJS decorators, and will miss the next framework
- **Limited to 5 languages** — Ruby, PHP, Rust, Kotlin, Swift, Elixir and every other language gets nothing, because nobody wrote the detection code
- **Redundant** — the LLM can already see decorators, annotations, and call patterns in the structural store
- **Anti-agentic** — the whole point is that the LLM figures it out

---

## Current State

### What's on `main` (to be removed)

| File | Lines | Endpoint methods | What it detects |
|------|-------|-----------------|-----------------|
| `python.py` | 441 | `extract_endpoints`, `_walk_endpoints`, `_check_decorated_endpoint` | FastAPI/Flask decorators, Celery tasks |
| `java.py` | 469 | `extract_endpoints`, `_walk_endpoint_annotations`, `_check_java_method_endpoint` | Spring `@GetMapping`/`@PostMapping`/`@RequestMapping` |
| `typescript.py` | 517 | `extract_endpoints`, `_walk_ts_endpoints`, `_check_ts_endpoint_call` | Express `router.get`/`app.post` call patterns |
| `go.py` | 515 | `extract_endpoints`, `_walk_go_endpoints`, `_check_go_endpoint` | `http.HandleFunc`, `mux.Handle`, Gin `r.GET`/`r.POST` |
| `csharp.py` | 531 | `extract_endpoints`, `_walk_cs_endpoints`, `_check_cs_endpoint_call` | `[HttpGet]`/`[HttpPost]` attributes, `MapGet`/`MapPost` minimal API |

Also `extract_interactions()` methods in all 5 — hard-coded data movement detection (HTTP clients, DB access, MQ patterns, gRPC stubs). Same problem.

Supporting code on `main`:
- `src/ast/extractors/endpoint_config.py` (115 lines) — YAML loader for framework patterns
- `tests/ast/test_endpoint_extraction.py` (599 lines) — tests for hard-coded detection

### What's on `feature/extraction-data-quality` (partially done)

- All 5 extractors already stripped of endpoint/interaction methods (222–327 lines each, down from 441–531)
- `treesitter_provider.py` — endpoint extraction calls commented out
- `endpoint_discoverer.py` — agentic endpoint discovery module exists (209 lines) but NOT wired into pipeline
- `interaction_classifier.py` / `interaction_enricher.py` / `interaction_agent.py` — agentic interaction classification already wired into pipeline
- `enrichment_tools.py` — shared tool functions for structural store access
- `endpoint_patterns.yaml` — YAML config exists as LLM reference data

### What already works agentically

- **Interaction classification** — LLM classifies raw calls as external interactions (DB, HTTP, MQ, etc.)
- **Interaction enrichment** — LLM resolves `target` and `data_hint` via hypothesis→probe→assess
- **Endpoint discovery module** — `endpoint_discoverer.py` built but not wired in

---

## Architecture: Before vs After

```
BEFORE (hard-coded):

  Source Files (.py .java .ts .go .cs)
       │
       ▼
  ┌─────────────────────────────┐
  │  1. Parse with tree-sitter  │  ← stays
  └──────────────┬──────────────┘
                 │
       ┌─────────┴─────────┐
       ▼                   ▼
  Structural            Framework-specific
  extraction            endpoint detection
  (calls,imports,       (walk AST for
   assignments,          @app.get, @GetMapping,
   annotations)          router.post, etc.)
       │                   │
       ▼                   ▼
  _calls.txt           EndpointInfo[]
  _index.txt           InteractionInfo[]
  _imports.txt              │
  _inherit.txt              │
       │                    │
       └────────┬───────────┘
                ▼
         StructuralAnalysis
         (stored to disk)


AFTER (agentic):

  Source Files (any language)
       │
       ▼
  ┌────────────────────────────────────┐
  │  1. Parse with tree-sitter         │
  │  (where grammar exists)            │
  └─────────────────┬──────────────────┘
                 │
                 ▼
  Structural extraction ONLY
  (calls, imports, assignments,
   annotations — no framework
   knowledge whatsoever)
       │
       ▼
  ┌────────────────────────────┐
  │   Structural Store          │
  │                              │
  │  _calls.txt                  │
  │  _index.txt                  │
  │  _imports.txt                │
  │  _inheritance.txt            │
  │  + raw source files          │
  └─────────────┬──────────────┘
             │
             ▼
  ┌──────────────────────────────┐
  │  2. LLM Agentic Discovery   │
  │                              │
  │  Tools:                      │
  │   read_index(pattern)        │
  │   read_calls(pattern)        │
  │   read_imports(pattern)      │
  │   read_source(file, lines)   │
  │                              │
  │  Works for ANY language:     │
  │   Python  → FastAPI, Django  │
  │   Java    → Spring, Quarkus  │
  │   TS/JS   → Express, NestJS  │
  │   Go      → net/http, Gin    │
  │   C#      → ASP.NET          │
  │   Ruby    → Rails, Sinatra   │
  │   PHP     → Laravel, Symfony │
  │   Rust    → Actix, Axum      │
  │   Kotlin  → Ktor, Spring     │
  │   ...any framework the LLM   │
  │      has knowledge of        │
  │                              │
  │  Returns:                    │
  │   EndpointInfo[]             │
  │   InteractionInfo[]          │
  └──────────┬───────────────────┘
             │
             ▼
       StructuralAnalysis
       (stored to disk)
```

Same input, same output shape. The middle changes from 1784 lines of pattern matching to LLM reads and interprets.

---

## End-to-End Pipeline Flow

When a user requests repo analysis (via API, CLI, or chat):

```
User → "Analyze this repo"
       │
       ▼
┌───────────────────────────────┐
│  API / CLI / Chat entry point   │
│                                  │
│  POST /api/v1/structural/analyze │
│  or: CLI `extract --repo ...`   │
│  or: chat `/analyze-repo`       │
└──────────────┬────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│  StandardsOrchestrator.run()     │
│  → FileAnalyzer.analyze_file()  │
│  → run_structural_pipeline()    │
└──────────────┬───────────────────┘
               │
    ═══════════╪═══════════════════
    STEP 1: ctags (fast, universal)
    ═══════════╪═══════════════════
               │
               ▼
    Scan all source files
    → _index.txt (symbols, signatures)
    → Write initial snapshot to disk
               │
    ═══════════╪═══════════════════
    STEP 2: tree-sitter (per-language)
    ═══════════╪═══════════════════
               │
         ┌─────┴─────┐
         ▼           ▼
    2a: Imports    2b: Calls
    extraction    resolution
    (fresh        (uses imports
     _imports.txt) for cross-file
         │        resolution)
         ▼           │
    _imports.txt     ▼
                  _calls.txt
                  _inheritance.txt
               │
    ═══════════╪═══════════════════
    STEP 3: Interaction classification
    (agentic — already working)
    ═══════════╪═══════════════════
               │
         ┌─────┴──────────┐
         ▼                ▼
    YAML fast path    LLM classifier
    (known patterns   (unknown calls →
     → instant)        LLM decides if
         │             external)
         ▼                │
    InteractionInfo[]     ▼
         │          InteractionInfo[]
         └─────┬──────────┘
               │
    ═══════════╪═══════════════════
    STEP 4: Interaction enrichment
    (agentic — already working)
    ═══════════╪═══════════════════
               │
               ▼
    LLM reads structural store
    → resolves target ("orders table")
    → resolves data_hint ("Order entity")
    → hypothesis→probe→assess loop
               │
    ═══════════╪═══════════════════
    STEP 5: Endpoint discovery   ← NEW
    (agentic — built, NOT wired)
    ═══════════╪═══════════════════
               │
               ▼
    LLM reads structural store
    → identifies endpoints for
       ANY framework/language
    → returns EndpointInfo[]
               │
    ═══════════╪═══════════════════
               │
               ▼
    ┌────────────────────────┐
    │  Structural Store      │
    │  (snapshot on disk)    │
    │                        │
    │  _index.txt            │
    │  _calls.txt            │
    │  _imports.txt          │
    │  _inheritance.txt      │
    │  _endpoints.txt        │
    │  _interactions.txt     │
    │  _extraction_meta.yaml │
    └───────────┬────────────┘
                │
                ▼
    Available for: metamodel population,
    diagram generation, standards extraction,
    chat queries, API responses
```

Steps 1–2 are mechanical (fast, deterministic). Steps 3–4 are already agentic and working. Step 5 is the gap — `endpoint_discoverer.py` exists but isn't wired into the pipeline yet. That's Phase 1 of the migration.

---

## Design

### Principle

The AST layer extracts **structural data** — what any parser can extract without knowing what framework you're using:
- Function/method signatures (name, params, return type)
- Call sites (caller → callee, line number)
- Import statements
- Class hierarchy (extends, implements)
- Decorators/annotations as raw data (name, arguments)
- Type annotations

The LLM layer interprets **framework semantics** — what these structures mean in context:
- "This `@app.get('/users')` decorator means a REST GET endpoint at `/users`"
- "This `urlpatterns = [path('products/', views.product_list)]` means a Django route"
- "This `@Controller('users')` class with `@Get(':id')` method means a NestJS endpoint"
- "This `kafkaTemplate.send('order.created', ...)` call is publishing to a Kafka topic"
- "This `get '/users' => 'users#index'` in `routes.rb` is a Rails route"
- "This `Route::get('/users', [UserController::class, 'index'])` is a Laravel route"
- "This `#[get("/users")]` attribute in Rust is an Actix-web endpoint"

The LLM's framework knowledge covers every major web framework across all languages. When a new framework appears, the LLM learns about it from its training data — no code changes needed.

### Pipeline change

```
BEFORE:
  AST extractors → [hard-coded endpoint/interaction detection] → structural store
  LLM enricher → [resolve target/data_hint only]

AFTER:
  AST extractors → [structural data only] → structural store
  LLM discoverer → [read structural store] → endpoints + interactions (all frameworks)
  LLM enricher → [resolve target/data_hint] → enriched interactions
```

### What the LLM gets

The structural store already contains everything needed:
- `_index.txt` — all symbols with decorators, annotations, signatures
- `_calls.txt` — all call sites (who calls what, at what line)
- `_imports.txt` — all imports (reveals frameworks in use)
- `_inheritance.txt` — class hierarchies
- Source files — available via `read_source` tool when needed

The LLM reads `_imports.txt` to identify frameworks, then reads `_index.txt` and `_calls.txt` to find endpoint patterns. It can peek at source for ambiguous cases.

---

## Impact Analysis

### Code to remove (from `main`, when merging)

| Item | Lines | Impact |
|------|-------|--------|
| `python.py` endpoint+interaction methods | ~220 | Extract calls/imports/assignments remain |
| `java.py` endpoint+interaction methods | ~210 | Extract calls/imports/assignments remain |
| `typescript.py` endpoint+interaction methods | ~190 | Extract calls/imports/assignments remain |
| `go.py` endpoint+interaction methods | ~195 | Extract calls/imports/assignments remain |
| `csharp.py` endpoint+interaction methods | ~245 | Extract calls/imports/assignments remain |
| `endpoint_config.py` | 115 | Delete entirely — YAML loading moves to LLM reference |
| `test_endpoint_extraction.py` | 599 | Rewrite as agentic discovery tests |
| `treesitter_provider.py` endpoint calls | ~10 | Already commented out on feature branch |
| **Total removed** | **~1784** | |

### Code to wire in

| Item | Status | Work needed |
|------|--------|-------------|
| `endpoint_discoverer.py` | Built (209 lines) | Wire into pipeline, test |
| `enrichment_tools.py` | Built | Already shared with enricher |
| Skill file (discover-endpoints.md) | Needs creation | LLM strategy prompt |
| Pipeline integration (`pipeline.py`) | Existing entry point | Call `discover_endpoints` after structural extraction |
| Tests | Existing tests invalid | New agentic tests (mock LLM, verify tool use) |

### What stays in AST extractors

Each extractor keeps its core structural extraction (no framework knowledge):
- `extract_calls()` — all function/method calls
- `extract_imports()` — all import statements
- `extract_assignments()` — variable assignments for type resolution
- `extract_annotations()` — type annotations

### Downstream consumers

| Consumer | Impact |
|----------|--------|
| `FileStore.write_endpoints()` | No change — still writes `_endpoints.txt` from `EndpointInfo` objects |
| `FileStore.write_interactions()` | No change — still writes `_interactions.txt` |
| `FileStore.write_extraction_meta()` | No change — counts from whatever's found |
| `StructuralAnalysis` model | No change — `endpoints` and `interactions` fields stay |
| `interaction_classifier.py` | Already agentic — no change |
| `interaction_enricher.py` | Already agentic — no change |

### Performance considerations

- **AST detection was instant** (pattern matching) — agentic discovery adds LLM latency
- Mitigation: batch endpoints across files, cache results, run in parallel with interaction classification
- Expected: ~10-30s per repo depending on size (same as interaction enrichment)
- Trade-off is worth it: correctness > speed for a code analysis tool

---

## Migration Path

### Phase 1: Wire agentic endpoint discovery into pipeline
- Connect `endpoint_discoverer.py` to `pipeline.py`
- Create the skill file (strategy prompt)
- Test on real repos (piggymetrics, saleor, vendure)

### Phase 2: Wire agentic interaction discovery
- Move interaction detection from AST extractors to the agentic loop
- The interaction classifier already handles this for unclassified calls — expand its scope

### Phase 3: Clean up AST extractors (on merge to main)
- Remove all `extract_endpoints()` and `extract_interactions()` overrides
- Delete `endpoint_config.py`
- Rewrite `test_endpoint_extraction.py` as agentic discovery tests
- Update all specs referencing AST-based detection

### Phase 4: Unit tests for agentic discovery
- Mock-LLM tests for `endpoint_discoverer.py` (same pattern as enricher tests)
  - Direct FINAL_ANSWER → EndpointInfo[] parsed correctly
  - TOOL_CALL → tool executes → result fed back → FINAL_ANSWER
  - Max turns limit, LLM errors, empty repos, malformed JSON
  - Skips when no source files present
- Mock-LLM tests for `interaction_discoverer.py` (same pattern)
- Tool function tests against temp fixture files

### Phase 5: Integration tests (real LLM, real repos)
- *API integration:* `POST /api/v1/structural/analyze` with a real repo → verify `_endpoints.txt` and `_interactions.txt` contain expected results
- *CLI integration:* `extract --repo <path>` → verify snapshot files on disk contain discovered endpoints
- Run against benchmark repos (piggymetrics, saleor, vendure + at least 1 Ruby/PHP/Rust repo)
- Compare endpoint counts vs old AST detection baseline
- Verify no regressions in downstream metamodel population
- Add to existing `test-harness.ps1` integration suite

### Phase 6: Validate
- Full regression run on all 7 benchmark repos
- Agentic discovery finds ≥95% of what AST found + new ones AST missed
- All downstream consumers (diagrams, metamodel, standards) work unchanged

---

## Risk

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| LLM misses endpoints AST would catch | Medium | Benchmark against old AST results; iterate on skill prompt |
| Slower extraction | High | Acceptable trade-off; batch and cache |
| LLM hallucinates endpoints | Low | Confidence scoring + source verification in skill prompt |
| Merge conflicts with main | Low | Feature branch already clean; merge = delete AST endpoint code |

---

## Success Criteria

1. Agentic discovery finds ≥95% of endpoints that AST detection found on benchmark repos
2. Agentic discovery finds endpoints AST missed (Django, NestJS, other frameworks)
3. Zero framework-specific code in AST extractors
4. All existing downstream consumers work unchanged
5. `endpoint_patterns.yaml` is reference data only — deleting it doesn't break anything (LLM has built-in framework knowledge)
6. Works for languages beyond the original 5 — test with at least one repo in Ruby, PHP, or Rust to validate language-agnostic discovery
