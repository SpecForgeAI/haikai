# Standards pipeline

The original product purpose: read a codebase (or a set of codebases), extract coding-standard documents from observed practice. Lives behind `src/standards_orchestrator.py`. Predates the Haikai chat layer and the AST/V2 work; coexists with them.

## Three mutually exclusive modes

The orchestrator runs in exactly one mode per invocation, set via `config['mode']`:

| Mode | Method | Output |
|---|---|---|
| `create_global_standards` | `run()` | Cross-codebase baseline standards (`global-standards/`) |
| `create_product_standards` | `run_product_standards_only()` | Product-specific standards layered on top of a pre-existing global baseline |
| `fetch_metamodel` | `fetch_metamodel_only()` | Architectural metamodel pulled from an external system (e.g. SpecForge) — see [[metamodel-system]] |

Each mode has a corresponding CLI subcommand and REST endpoint.

## Pipeline stages (the `run()` path)

```
sources (local paths or URLs)
   │
   ▼
┌─────────────────────────────┐
│ RepositoryFetcher           │  if URL: fetch via GitHub/GitLab/Bitbucket API
└─────────────┬───────────────┘  ([[repo-fetcher]])
              ▼
┌─────────────────────────────┐
│ FileScanner                 │  walk tree, categorize: backend/frontend/testing/global/dependency
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ FileAnalyzer + Strategies   │  per-file LLM analysis using the Strategy pattern
│                             │  — coding_style, commenting, conventions,
│                             │    error_handling, validation, ast_analysis,
│                             │    tech_stack_synthesis, technical_doc, metamodel
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ StandardsSynthesizer        │  aggregate per-file findings into per-category standards
└─────────────┬───────────────┘
              ▼
┌─────────────────────────────┐
│ ReportGenerator             │  emit Markdown / JSON outputs
└─────────────────────────────┘
```

## File categorization

`src/file_scanner.py` + `src/categories.py` classify every file into one of:

| Category | Examples |
|---|---|
| backend | `.py`, `.java`, `.go`, `.cs`, server-side code |
| frontend | `.ts`, `.tsx`, `.jsx`, `.vue`, client-side code |
| testing | files matching test patterns (`test_*.py`, `*.spec.ts`, etc.) |
| global | docs, configs, manifests applicable across categories |
| dependency | lockfiles, vendored code (skipped from analysis) |

Categorization uses extension + path heuristics, not content. Strategies are picked per category.

## Strategies

The Strategy pattern is load-bearing here — see [[strategies]] for the pattern detail. Each strategy in `src/strategies/` answers one question about one category of file:

| Strategy | Asks |
|---|---|
| `coding_style_strategy` | naming, formatting, structural conventions |
| `commenting_strategy` | docstring/comment patterns |
| `conventions_strategy` | architectural conventions |
| `error_handling_strategy` | how errors are raised/caught/logged |
| `validation_strategy` | input validation patterns |
| `ast_analysis_strategy` | uses [[structural-store]] data instead of raw source |
| `tech_stack_synthesis_strategy` | library/framework choices (uses Provider pattern: DependencyProvider, MetamodelProvider, GlobalStandardProvider) |
| `technical_doc_strategy` | analysis of project README/architecture docs |
| `metamodel_strategy` | two-pass extraction of architectural metamodel facts |

All implement `BaseStrategy` (or `BaseGlobalStrategy`) — the base classes in `src/strategies/`.

## Where LLMs enter

Each strategy uses [[llm-client]] (via `LLMClient.invoke`) for one-shot LLM calls. Files larger than the chunker threshold pass through [[chunking]] first, so each LLM call gets a self-contained, format-aware chunk rather than a naïvely truncated block. **Strategies are not chat sessions** — they're stateless prompts with templated inputs. The strategy layer is the heaviest LLM consumer in the codebase.

Per [[../decisions/use-claude-proxy]]: `LLM_PROVIDER` and `LLM_MODEL` are required, no fallbacks. `standards_orchestrator.py:74-` raises `ValueError` if either is missing.

## Auxiliary services

- **`CacheManager`** — TTL-keyed cache for LLM results and document downloads; saves cost on re-runs.
- **`EarlyExitDetector`** — cheap pre-check that filters non-technical files before they reach an LLM (skips images, generated lockfile chunks, etc.).
- **`FileParser`** — handles non-source content: `.pdf`, `.docx`, `.html`, `.md`, `.txt`, `.json`, `.xml`, `.yaml`, `.properties`, `.cfg`, `.ini`, `.toml`, `.gradle`.
- **`TechnicalDocRepository`** — fetch + cache technical documents (architecture diagrams, RFCs, ADRs) referenced from `technical_documents` config.
- **`MetamodelGateway`** — talks to external metamodel systems (SpecForge etc.) for the `fetch_metamodel` mode.
- **`ContentExtractor`** — chunking + extraction helpers used across strategies.

## How this interacts with the AST/V2 work

The standards pipeline is the *original* product. The AST work ([[structural-store]], [[agentic-discovery]], [[v2-extraction-pipeline]]) and the chat work ([[chat-executors]], [[haikai-sdd]]) are layered on top.

Concretely:
- `ast_analysis_strategy` is one of the strategies — it consumes [[structural-store]] data instead of raw source, which is cheaper and more precise for code-pattern questions.
- `metamodel_strategy` overlaps with what V2 does for endpoints/interactions, but with a different output shape (architectural metamodel facts rather than discovery records).
- The pipeline produces *standards documents*. The Haikai lifecycle produces *specs and code*. They're separate workflows that happen to share infrastructure (`LLMClient`, `RepositoryFetcher`, file categorization).

## Sources

- `src/standards_orchestrator.py`, `src/file_scanner.py`, `src/file_analyzer.py`, `src/standards_synthesizer.py`, `src/report_generator.py`
- `src/strategies/`
- `docs/ARCHITECTURE.md` § "Standards Pipeline"
- [[../../raw/2026-05-04_codebase-walk]]
