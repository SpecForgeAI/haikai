# Requirements: AST Code Analysis Skill

## Feature Description

A structural code analysis skill that leverages existing language tooling (universal-ctags, LSP servers) to extract deep structural patterns from codebases. Uses a two-tier provider model: universal-ctags as a fast, always-available baseline for symbol extraction (100+ languages), and auto-installed LSP servers for rich analysis (call hierarchies, references, type info, 13 languages). Three analysis providers — ctags, LSP, and LLM — are independently toggleable via configuration. When structural providers are enabled, the LLM receives structural output (symbol trees, inheritance graphs, pattern evidence) instead of raw source code, shifting from code parser to structural interpreter. This delivers ~99% token reduction and deterministic pattern detection.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- **Tier 1 — universal-ctags**: CLI-based symbol indexing, 100+ languages, zero config, ~5MB
- **Tier 2 — LSP servers** (auto-detect and auto-install, 13 languages):
  - `pyright` (Python), `typescript-language-server` (TypeScript/JS/React)
  - `gopls` (Go), `rust-analyzer` (Rust), `clangd` (C/C++)
  - `jdt.ls` (Java), `OmniSharp` (C#), `solargraph` (Ruby)
  - `phpactor` (PHP), `kotlin-language-server` (Kotlin), `sourcekit-lsp` (Swift)
  - `lua-language-server` (Lua), `elixir-ls` (Elixir)
- `lsprotocol` / `pygls` for Python LSP client communication
- Existing `file_analyzer.py` and `file_parser.py` as integration points
- Existing chunking pipeline (`src/chunking/`) for AST-aware chunk boundaries

## Requirements

### Provider Abstraction Layer
- New module at `src/ast/provider.py`
- Abstract interface: `AnalysisProvider.analyze(file_path) -> StructuralAnalysis`
- Concrete providers: `CtagsProvider`, `LSPProvider`
- Three providers independently toggleable: ctags, LSP, LLM (via `config/analysis_providers.yaml` or env vars `AST_CTAGS_ENABLED`, `AST_LSP_ENABLED`, `AST_LLM_ENABLED`)
- Provider registry: configurable per language
- All providers output the same `StructuralAnalysis` model — consumers don't know the source

### Tier 1: universal-ctags Integration
- New module at `src/ast/ctags_provider.py`
- Runs `ctags --output-format=json --fields=+niaSstKz --kinds-all=*` on project files
- Extracts: symbol names, kinds (class/function/method/variable), scope, inheritance, signatures
- Batch mode: index entire project in one CLI call (~1 second for 10K files)
- Parse JSON output into `StructuralAnalysis` model
- Always available — ctags installed in Docker image at build time (~5MB)
- Auto-install on local dev: detect missing ctags, run platform-appropriate install (apt/brew/choco/winget)

### Tier 2: LSP Server Integration
- New module at `src/ast/lsp_provider.py`
- LSP client using `lsprotocol` for typed request/response models
- Lifecycle: spin up LSP server per analysis run → initialize → query → shutdown
- Per-server configurable install mode in `config/lsp_servers.yaml`:
  - `auto_install: true` — auto-detect and auto-install when missing (default)
  - `auto_install: false` — manual install only (for IT-managed or restricted environments)
- Configurable install sources per server — `install_command` can be overridden to point to corporate mirrors, private registries (Artifactory, Nexus), or custom install scripts
- Global source overrides: `defaults.pip_index_url`, `defaults.npm_registry`, `defaults.go_proxy` redirect all installs through corporate proxies
- Auto-install flow: detect project languages → check if LSP binary in PATH → if `auto_install: true` and missing, run `install_command` via `subprocess.run()` → fall back to ctags if install fails or `auto_install: false`
- Queries used:
  - `textDocument/documentSymbol` — file-level symbol tree
  - `textDocument/references` — find all references to a symbol
  - `callHierarchy/incomingCalls` + `outgoingCalls` — call graph
  - `workspace/symbol` — project-wide symbol search
  - `textDocument/hover` — type information
- Server configuration: `config/lsp_servers.yaml` maps language → server binary + install command + package manager + auto_install flag
- 13 languages supported: Python, TypeScript/JS/React, Go, Rust, C/C++, Java, C#, Ruby, PHP, Kotlin, Swift, Lua, Elixir
- Timeout: 30s per file, 5min per project — kill server if unresponsive
- Language version detection: LSP servers read project config files (pyproject.toml, tsconfig.json, .csproj, etc.) to determine target language version; captured in `StructuralAnalysis.language_version`

### Structural Pattern Extraction
- Extract class hierarchies (inheritance, interfaces, abstract classes) — ctags provides this
- Extract decorator/annotation usage patterns with frequency counts — ctags `kind:decorator`
- Build import/dependency graphs per file and per module — ctags + import analysis
- Extract function/method signatures (params, return types, async markers) — ctags `signature` field
- Identify design patterns: factory, singleton, observer, strategy, repository, decorator — heuristic rules on symbol data
- Confidence scoring: name-match (0.5) → structural-match via ctags (0.8) → LSP-confirmed (1.0)
- Extract type annotation coverage percentage — LSP tier only

### LLM as Structural Interpreter (not code parser)
- When structural providers are enabled, LLM receives structural output — never raw source code
- LLM input: symbol trees, inheritance graphs, import maps, pattern evidence (~200 tokens per file)
- LLM task: interpret structures, identify conventions, assess quality, infer intent
- Triage phase: structural data identifies high-value files for LLM interpretation, skipping trivial/boilerplate
- Legacy mode: when no structural providers enabled, LLM receives raw code (current behavior, backward compatible)

### Integration with Existing Pipeline
- New strategy: `src/strategies/ast_analysis_strategy.py` extending `BaseGlobalStandardStrategy`
- `file_analyzer.py` calls provider abstraction before LLM analysis
- Structural output replaces raw code in LLM prompts (LLM interprets structure, not syntax)
- Results cached per file content hash to avoid re-analysis of unchanged files
- Internal capability only — not exposed as client-facing API endpoints
- Enriches existing flows: product tech standards, global standards, metamodel generation, reverse engineering

### AST-Aware Chunking
- New chunker: `src/chunking/ast_chunker.py` extending `BaseChunker`
- Chunk boundaries aligned to symbol nodes (never split mid-function/mid-class)
- Uses ctags symbol ranges to determine boundaries
- `chunker_factory.py` selects AST chunker when structural data is available
- Fallback to `GenericChunker` for files without structural data

### Output Format
- Structured JSON output alongside existing markdown standards
- Dependency graph exportable as DOT format for visualization
- Pattern frequency tables included in generated standard documents
- Integration with existing `report_generator.py` for unified output

### Toggle Configuration
- `config/analysis_providers.yaml` with per-provider `enabled` flag
- Environment variable overrides: `AST_CTAGS_ENABLED`, `AST_LSP_ENABLED`, `AST_LLM_ENABLED`
- Any combination valid: all three, any two, any one
- Recommended default: ctags + LLM (fast structure + semantic interpretation)

### Parallel Execution
- ctags indexes full project in batch (~1 second) while LLM can start processing early files
- LSP runs after ctags, uses ctags output to prioritize which files to deeply analyze
- When only structural providers enabled (no LLM), analysis is deterministic and completes in seconds

## Constraints
- ctags is fast but shallow — no type inference, no call graphs, no cross-file resolution
- LSP servers add 2-10s startup per language (amortized across all files of that language)
- LSP memory usage varies: pyright ~200MB, jdt.ls ~500MB — released after analysis completes
- No semantic analysis in ctags tier (type inference, control flow) — LSP tier only
- Auto-install requires the language's package manager to be available in the environment
- Docker default image only has pip — additional package managers require rich-analysis image variant
- Corporate environments may require custom install sources (private registries, mirrors) — configurable per server in yaml

## Out of Scope
- Running LSP servers as persistent background services (spin up per analysis only)
- IDE features (completions, diagnostics, formatting)
- Custom grammar or query authoring
- Cross-project symbol resolution
- Refactoring suggestions based on analysis
- Extracting LSP servers from VS Code extensions (use standalone open-source servers only)
