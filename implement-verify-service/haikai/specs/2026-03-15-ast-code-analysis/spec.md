# Specification: AST Code Analysis Skill

## Summary

Add structural code analysis to the standards extraction pipeline using existing language tooling rather than building custom parsers. A two-tier provider model gives us universal-ctags as a fast, zero-config baseline (symbols, signatures, inheritance for 100+ languages) and optional LSP servers for deep analysis (call graphs, references, type info). Both tiers feed into a unified `StructuralAnalysis` model that enriches LLM prompts, improves chunking, and enables deterministic pattern detection.

---

## What is universal-ctags?

[universal-ctags](https://ctags.io/) is a command-line tool that reads source code and outputs a structured index of every symbol — classes, functions, methods, variables, their signatures, inheritance, and scope. It supports 100+ languages out of the box with zero configuration. Think of it as `grep` but it understands code structure.

Example: running `ctags --output-format=json` on a Python file produces:
```json
{"name": "UserService", "kind": "class", "inherits": "BaseService", "line": 15, "signature": "(db: Database)"}
{"name": "get_user", "kind": "method", "scope": "UserService", "line": 22, "signature": "(self, user_id: int) -> User"}
{"name": "save_user", "kind": "method", "scope": "UserService", "line": 35, "signature": "(self, user: User) -> None"}
```

This gives us structured metadata about code without running a full language server — fast enough to index 10K files in ~1 second, at a cost of ~5MB installed.

---

## Current Flow

```
1. file_scanner.py → discovers files
2. file_parser.py → reads raw content, splits by generic chunking rules
3. file_analyzer.py → sends raw chunks to LLM for analysis
4. strategies/*.py → LLM interprets raw code text to find patterns
5. standards_synthesizer.py → combines LLM outputs into standard docs
```

### Current flow issues

- LLM receives raw source code — expensive in tokens, noisy
- Pattern detection is non-deterministic (LLM may miss patterns on different runs)
- No structural metadata available before LLM call
- Chunking is line-count based — can split mid-function or mid-class
- Same file re-analyzed on every run even if unchanged

---

## Proposed Flow

The pipeline has three analysis providers that can be toggled independently via configuration. Any combination is valid — use all three for maximum depth, or just ctags for fast lightweight analysis, or ctags + LLM to skip LSP overhead, etc.

### Analysis Providers (independently toggleable)

| Provider | What it does | Speed | Memory | Always available? |
|----------|-------------|-------|--------|-------------------|
| **ctags** | Symbol extraction — classes, functions, methods, signatures, inheritance, scope | ~1s for 10K files | Zero (CLI runs and exits) | Yes — ~5MB binary, baked into Docker, auto-installed locally |
| **LSP** | Deep analysis — call graphs, cross-file references, type info, language version detection | 2-10s startup + ~1s/file | 200-500MB while running (shuts down after analysis) | Auto-installed per language when package manager available |
| **LLM** | Semantic interpretation — pattern reasoning, intent analysis, naming convention judgment | Seconds per file (API call) | None locally (remote API) | Yes — existing behavior |

### Toggle Configuration

```yaml
# config/analysis_providers.yaml (or env vars)
providers:
  ctags:
    enabled: true          # AST_CTAGS_ENABLED=true
  lsp:
    enabled: true          # AST_LSP_ENABLED=true
  llm:
    enabled: true          # AST_LLM_ENABLED=true
```

**Example toggle combinations:**

| Combination | Use case | What the LLM receives |
|-------------|----------|----------------------|
| **ctags + LLM** (recommended) | Best balance — fast structure + LLM interpretation | ctags structural output (symbols, inheritance, patterns) — no raw code |
| ctags + LSP + LLM | Maximum depth — all three providers | ctags + LSP structural output (call graphs, references, types) — no raw code |
| ctags + LSP | Fast, deterministic — no LLM cost | N/A — pure structural analysis, no LLM involved |
| ctags only | Fastest — symbol index only, quick project scanning | N/A |
| LSP + LLM | Rich analysis + interpretation, without ctags | LSP structural output — no raw code |
| LLM only | Current behavior — raw code to LLM, no structural enrichment | Raw source code (legacy mode) |

**Key principle: when structural providers are enabled, the LLM never sees raw source code.** Instead, the LLM receives the structured output from ctags/LSP — symbol trees, inheritance graphs, import maps, pattern evidence — and reasons over that. This is fundamentally different from the current approach:

```
Current (LLM only):
  LLM input: raw source code (thousands of tokens of Python/Java/etc.)
  LLM task: "parse this code and find patterns"

Proposed (ctags + LLM):
  LLM input: ctags structural output (~200 tokens of structured JSON)
  LLM task: "interpret these symbols and patterns — what conventions does this reveal?"

Proposed (ctags + LSP + LLM):
  LLM input: merged structural output (~400 tokens of structured data with call graphs)
  LLM task: "interpret these symbols, patterns, and relationships — what standards apply?"
```

The LLM shifts from **code parser** to **structural interpreter**. It never needs to understand syntax — ctags/LSP already did that. The LLM adds semantic reasoning that tools can't: "this inheritance pattern suggests a clean architecture approach" or "these naming conventions indicate a DDD-influenced codebase."

### Detailed Pipeline Flow

```
1. file_scanner.py → discovers files, detects languages

2. Structural analysis phase (ctags + LSP, if enabled):
   ├─ ctags (if enabled): index all project files in one batch call (~1 second)
   │   → symbols, signatures, inheritance, scope for every file
   ├─ LSP (if enabled): spin up per-language servers, query each file
   │   → call graphs, references, type info, language version
   └─ Merge results into unified StructuralAnalysis per file

3. Triage phase (when structural data available):
   ├─ Identify high-value targets for LLM interpretation:
   │   complex classes (deep inheritance, many methods),
   │   unusual patterns, cross-cutting concerns
   ├─ Skip trivial files from LLM:
   │   simple data classes, generated code, boilerplate
   └─ This is the key token savings — LLM only sees what matters

4. ast_chunker.py → chunks at symbol boundaries (function/class level)
   Falls back to GenericChunker when no structural data

5. LLM interpretation phase (if enabled):
   ├─ file_analyzer.py → sends structural output to LLM (NOT raw code)
   │   LLM receives: symbol trees, inheritance graphs, import maps, pattern evidence
   │   LLM task: interpret structures, identify conventions, assess quality
   ├─ ast_analysis_strategy.py → LLM reasons over structural data
   └─ Other strategies → receive structural context instead of raw code

6. standards_synthesizer.py → combines structural + LLM outputs
```

**When LLM-only mode is active** (no ctags/LSP), the pipeline falls back to current behavior: raw code sent to LLM, generic chunking, full token cost. This is the legacy path — structural providers should be enabled for all new analysis.

### Parallel Execution

ctags and LLM can run concurrently:
- ctags indexes the full project in ~1 second (batch mode)
- While ctags runs, LLM can start processing early files using raw content
- Once ctags completes, remaining LLM calls switch to enriched prompts with structural context
- LSP runs after ctags (uses ctags output to prioritize which files to deeply analyze)

When only structural providers are enabled (no LLM), the entire analysis is deterministic and completes in seconds.

### LLM Targeting Based on Structural Analysis

When both structural and LLM providers are enabled, structural data drives what the LLM sees — and the LLM receives structural output, never raw code:

```
Example: 500-file Python project

Without structural providers (LLM-only, current):
  → LLM parses all 500 files (raw source code)
  → ~500 API calls, ~2000 tokens per file = ~1M total tokens

With ctags + LLM:
  → ctags indexes all 500 files in ~1 second
  → Triage: 45 files have complex structures worth LLM interpretation
  → 380 files are trivial → structural data sufficient, no LLM needed
  → 75 files are moderate → structural data sufficient, no LLM needed
  → LLM interprets 45 structural outputs (~200 tokens each, no raw code)
  → ~45 API calls, ~9K tokens total = ~99% token reduction
```

---

## Key Differences

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Input to LLM** | Raw source code | Structured symbol data + targeted snippets |
| **Token usage** | Full file content per chunk | Condensed structural metadata |
| **Chunking** | Line-count based | Symbol boundaries (function/class) |
| **Pattern detection** | LLM-only (non-deterministic) | Deterministic symbols + LLM interpretation |
| **Language support** | LLM infers from content | 100+ languages via ctags, deep analysis via LSP |
| **Caching** | None | Per-file content hash |
| **Tooling** | Custom code | Existing battle-tested tools |

---

## Provider Architecture

```
┌─────────────────────────────────────────────────────┐
│              ProviderRegistry                       │
│  Manages enabled providers per toggle config        │
└───────┬──────────────┬──────────────┬───────────────┘
        │              │              │
 ┌──────┴───┐   ┌──────┴────┐   ┌────┴─────┐
 │ LSPProv  │   │ CtagsProv │   │ LLMProv  │
 │ (toggle) │   │ (toggle)  │   │ (toggle) │
 │ Rich     │   │ Fast      │   │ Semantic │
 │ Deep     │   │ Universal │   │ Current  │
 └──────────┘   └───────────┘   └──────────┘
       │              │              │
       └──────────────┴──────────────┘
                      │
              StructuralAnalysis
            (merged from all enabled)
```

**Provider execution per file:**

1. **ctags (if enabled)** — always available: baked into Docker, auto-installed locally. Runs as a CLI call, outputs JSON, exits. Zero memory footprint after execution. Provides: symbols, signatures, inheritance, scope.
2. **LSP (if enabled)** — look up language in `config/lsp_servers.yaml`, check `shutil.which(server_binary)`. If not found, auto-install when package manager is available. Provides: call graphs, references, type info. Memory: 200-500MB while running, released after analysis completes.
3. **LLM (if enabled)** — receives structural output from ctags/LSP as input (not raw code). Interprets structural data semantically: identifies conventions, assesses quality, infers intent. When no structural providers are enabled, falls back to parsing raw code (legacy mode). Can be **targeted**: structural data identifies which files are worth LLM interpretation, skipping trivial/boilerplate files.

All enabled providers contribute to the same `StructuralAnalysis` model. ctags provides the baseline, LSP enriches it, LLM interprets it. The LLM never parses source code when structural data is available — it reasons over the already-parsed structural output. Any combination works — disable any provider and the pipeline adapts.
---

## Installation & Auto-Setup

### ctags (Tier 1 — always available)

ctags supports **all mainstream languages** out of the box — no per-language configuration needed. The full list includes: Python, JavaScript, TypeScript, Java, C, C++, C#, Go, Rust, Ruby, PHP, Perl, Swift, Kotlin, Scala, Haskell, Lua, R, SQL, HTML, CSS, YAML, JSON, Markdown, Shell/Bash, PowerShell, Objective-C, Dart, Elixir, Erlang, Clojure, F#, Fortran, COBOL, and 70+ more. If a language exists and has been used in production, ctags almost certainly supports it. Full list: `ctags --list-languages`.

| Environment | Installation | When |
|-------------|-------------|------|
| **Docker** | `apt-get install -y universal-ctags` in Dockerfile | Build time, ~5MB |
| **Local (Linux)** | `apt-get install universal-ctags` | Auto-install on first run if missing |
| **Local (macOS)** | `brew install universal-ctags` | Auto-install on first run if missing |
| **Local (Windows)** | `choco install universal-ctags` or `winget install universal-ctags` | Auto-install on first run if missing |

On first run, if `shutil.which("ctags")` returns `None`, the system attempts platform-appropriate installation. If auto-install fails (permissions, no package manager), log a clear error with the one-liner install command and continue with text fallback.

### LSP Servers (Tier 2 — auto-detect and auto-install)

**Where do LSP servers come from?**

There is no single unified registry for LSP servers. They are standalone open-source projects distributed via standard package managers (pip, npm, dotnet). Microsoft maintains an official catalog at [microsoft.github.io/language-server-protocol/implementors/servers](https://microsoft.github.io/language-server-protocol/implementors/servers/) — the closest thing to a directory.

VS Code extensions often bundle LSP servers inside them (e.g., Pylance bundles Pyright, the TypeScript extension bundles tsserver). A `.vsix` file is just a ZIP, so the server binary can be extracted. However, this approach is fragile (extension internal structure changes between versions) and has licensing complications (Pylance is proprietary; Pyright is open source). We use the standalone open-source servers installed via standard package managers — more reliable, clearer licensing, easier to version-pin.

**Available servers (13 languages, see `config/lsp_servers.yaml` for full list):**

| Server | Language | Install Command | Package Manager |
|--------|----------|----------------|-----------------|
| pyright | Python | `pip install pyright` | pip |
| typescript-language-server | TypeScript/JS/React | `npm i -g typescript-language-server typescript` | npm |
| gopls | Go | `go install golang.org/x/tools/gopls@latest` | go |
| rust-analyzer | Rust | `rustup component add rust-analyzer` | rustup |
| clangd | C/C++ | `apt-get install -y clangd` | apt |
| jdt.ls | Java | `pip install jdtls` | pip |
| OmniSharp | C# | `dotnet tool install -g omnisharp` | dotnet |
| solargraph | Ruby | `gem install solargraph` | gem |
| phpactor | PHP | `composer global require phpactor/phpactor` | composer |
| kotlin-language-server | Kotlin | `npm i -g kotlin-language-server` | npm |
| sourcekit-lsp | Swift | Bundled with Xcode/Swift toolchain | — |
| lua-language-server | Lua | `brew install lua-language-server` | brew |
| elixir-ls | Elixir | `mix escript.install hex elixir_ls` | mix |

**How the app runs install commands:**

The Python app executes installs via `subprocess.run()` — the same mechanism used to run ctags. But the required package manager must already exist in the environment:

| Environment | Available package managers | What auto-installs |
|-------------|--------------------------|-------------------|
| **Docker** (default image) | pip | pyright, jdt.ls |
| **Docker** (rich-analysis image) | pip, npm, apt | pyright, typescript-language-server, clangd, jdt.ls, kotlin-language-server |
| **Local dev** | Depends on host | Any server whose package manager is already installed |

The auto-install logic checks for the package manager before attempting installation: `shutil.which("pip")`, `shutil.which("npm")`, `shutil.which("go")`, etc. If the package manager isn't present, it skips that LSP server silently and uses ctags for that language — no error, no degradation.

**Auto-detect and auto-install flow:**

When analyzing a project, the system detects which languages are present (via file extensions from `file_scanner.py`), then for each language:

1. Look up the language in `config/lsp_servers.yaml`
2. Check if the server binary exists in PATH (`shutil.which()`)
3. If missing and `install_command` is defined → **auto-install** (run the install command, e.g., `pip install pyright`)
4. If install succeeds → use LSP for rich analysis
5. If install fails (no package manager, permissions, network) → log warning, fall back to ctags (no degradation — ctags handles the language)
6. If no entry in yaml for this language → ctags only (no LSP available, and that's fine)
**Language version handling:**

LSP servers handle language versions internally — we don't manage versions ourselves:

| Server | How it determines language version |
|--------|-----------------------------------|
| pyright | Reads `pythonVersion` from `pyproject.toml` / `setup.cfg`, or defaults to latest |
| typescript-language-server | Uses whichever `typescript` package is in the project's `node_modules/` |
| jdt.ls | Reads source/target level from `.classpath` / `pom.xml` / `build.gradle` |
| OmniSharp | Reads `TargetFramework` from `.csproj` |

The detected language version is captured in the `StructuralAnalysis` model (`language_version` field) and available to downstream consumers (e.g., "this project targets Python 3.8" informs which patterns and idioms to expect).

For ctags (Tier 1), language version is irrelevant — symbol extraction is syntax-level and works identically across all versions of a language.

**Adding a new language:** Add an entry to `config/lsp_servers.yaml` with the server binary, install command, and size. ctags already handles 100+ languages for Tier 1, so a new LSP entry only adds Tier 2 depth. If no LSP server exists for a language, ctags provides full symbol-level analysis — the system works without any LSP servers installed.

---

## Code Changes

### 1. New: `src/ast/provider.py`

Abstract provider interface.

- `AnalysisProvider` ABC with `analyze(file_path: str, source: str) -> StructuralAnalysis`
- `ProviderRegistry` class mapping language → ordered list of providers
- `get_best_provider(language: str) -> AnalysisProvider` — returns highest-tier available
- `analyze_file(file_path: str) -> StructuralAnalysis` — convenience method using registry
- Provider health check: `is_available() -> bool` — calls `shutil.which()` for the provider's binary


### 2. New: `src/ast/ctags_provider.py`

Tier 1: universal-ctags integration. Guaranteed available in Docker (installed at build time). Auto-installed on local dev environments on first run.

- `CtagsProvider` implementing `AnalysisProvider`
- `ensure_installed()` — checks `shutil.which("ctags")`, attempts platform-appropriate auto-install if missing, raises clear error with install instructions on failure
- `analyze()` flow:
  1. Run `ctags --output-format=json --fields=+niaSstKz --kinds-all=* -f - {file}`
  2. Parse JSON lines output
  3. Map ctags kinds to `SymbolInfo` model (class, function, method, variable, interface, etc.)
  4. Extract inheritance from `inherits` field
  5. Extract signatures from `signature` field
  6. Build scope tree from `scope`/`scopeKind` fields
- Batch mode: `analyze_project(directory)` indexes all files in one ctags invocation
- Performance: ~1 second for 10K files (ctags is extremely fast)

### 3. New: `src/ast/lsp_provider.py`

Tier 2: LSP server integration. Auto-detected per language and auto-installed when `install_command` is available. Falls back to ctags if installation fails or no server is configured for the language.

- `LSPProvider` implementing `AnalysisProvider`
- `LSPServerManager` for lifecycle:
  - `start(language, root_path)` → spawn server subprocess, initialize LSP handshake
  - `stop()` → shutdown request + process kill after timeout
  - Server configs loaded from `config/lsp_servers.yaml`
- `analyze()` flow:
  1. Ensure server running for file's language
  2. `textDocument/didOpen` → notify server of file
  3. `textDocument/documentSymbol` → get symbol tree
  4. `callHierarchy/incomingCalls` + `outgoingCalls` for each function (if supported)
  5. `textDocument/hover` on class names for type details
  6. Map LSP responses to `StructuralAnalysis` model
  7. `textDocument/didClose` → cleanup
- Connection via stdio (subprocess) using JSON-RPC
- Server reused across files of same language within one analysis run

### 4. New: `src/ast/models.py`

Unified structural analysis models (provider-agnostic).

- `SymbolInfo`: name, kind (class/function/method/variable/interface/decorator), scope, line_range, signature, is_async, is_abstract, decorators, visibility (public/private/protected)
- `InheritanceInfo`: class_name, bases, interfaces, is_abstract
- `ImportInfo`: module, names, is_relative, line_number
- `CallInfo`: caller, callee, line_number (LSP tier only)
- `StructuralAnalysis`: symbols (list), inheritance (list), imports (list), calls (list, optional), type_coverage (float, optional), provider_used (str), analysis_depth (basic/rich), language_version (str, optional — e.g., "python 3.11", "typescript 5.3")
- `PatternMatch`: pattern_type, confidence, evidence (list of symbol names + locations)

### 5. New: `src/ast/pattern_detector.py`

Design pattern detection from structural data. The `PatternDetector` runs heuristic rules against the unified `StructuralAnalysis` model — it works the same regardless of whether the data came from ctags or LSP. LSP data doesn't detect patterns differently; it provides **richer evidence** that raises confidence scores.

- `PatternDetector` class consuming `StructuralAnalysis`
- Heuristic rules (work with ctags-level data):
  - **Factory**: class/function with "factory"/"create"/"build" in name returning other class instances
  - **Singleton**: class with `_instance` attribute + `get_instance`/`getInstance` method
  - **Strategy**: abstract class/interface with multiple concrete implementations (inheritance tree)
  - **Repository**: class with CRUD-like method names (get, find, save, delete, update) + data layer scope
  - **Observer**: class with subscribe/notify/on_event method patterns
  - **Decorator pattern**: classes wrapping other classes with same interface (inheritance + delegation)

**Confidence scoring by evidence tier:**

| Evidence Source | Confidence | Example |
|----------------|-----------|---------|
| Name match only | 0.5 | Class named `UserFactory` |
| Structural match (ctags) | 0.8 | `UserFactory` has method `create_user()` + inherits `BaseFactory` |
| LSP-confirmed | 1.0 | Call graph shows `create_user()` instantiates `User` class, references confirm cross-file usage |

**Example — Repository pattern detection:**

```
Input (from ctags StructuralAnalysis):
  symbols: [
    {name: "UserRepository", kind: "class", inherits: "BaseRepository"},
    {name: "get",    kind: "method", scope: "UserRepository"},
    {name: "find",   kind: "method", scope: "UserRepository"},
    {name: "save",   kind: "method", scope: "UserRepository"},
    {name: "delete", kind: "method", scope: "UserRepository"},
  ]

PatternDetector output:
  PatternMatch(
    pattern_type="repository",
    confidence=0.8,          # structural match: CRUD methods + BaseRepository inheritance
    evidence=["UserRepository extends BaseRepository", "CRUD methods: get, find, save, delete"]
  )

With LSP data added (call graph available):
  confidence=1.0             # call graph confirms save() calls Database.execute()
  evidence += ["save() → Database.execute() (confirmed data access layer)"]
```

- Returns `list[PatternMatch]` with evidence

### 6. New: `src/strategies/ast_analysis_strategy.py`

Strategy extending `BaseGlobalStandardStrategy`, following the same 3-pass pattern used by existing strategies like `CodingStyleStrategy` and `ConventionsStrategy`.

**How current strategies work (for comparison):**

Current strategies (e.g., `CodingStyleStrategy`) follow this flow:
1. **Pass 1** — `build_context_from_samples()`: sample ~15 files, send raw code to LLM, get back a `GlobalAnalysisContext` with tech_stack, languages, frameworks, baseline_practices
2. **Pass 2** — `get_extraction_prompts()`: for each file, send raw code + context to LLM, ask it to extract patterns. LLM parses raw text to find things like naming conventions, error handling patterns, etc.
3. **Pass 3** — `synthesize()`: combine all per-file analyses into a standards document

**What AST analysis strategy changes:**

Pass 1 is replaced with **deterministic structural analysis** — no LLM needed. Instead of sampling files and asking the LLM "what's in this codebase?", we run ctags/LSP and get precise answers:

```
Current (CodingStyleStrategy Pass 1 — LLM-based, non-deterministic):
  "Here are 15 code samples. What tech stack, languages, frameworks do you see?"
  → LLM response: {"tech_stack": "Python backend", "languages": ["python"], "frameworks": ["fastapi"]}
  (May miss things, different answers on different runs)

Proposed (AstAnalysisStrategy — deterministic, no LLM):
  ctags indexes all project files in ~1 second
  → Exact counts: 45 classes, 312 methods, 89 functions
  → Inheritance tree: UserService → BaseService → ABC
  → Import graph: fastapi (used in 12 files), sqlalchemy (8 files), pydantic (15 files)
  → Patterns: 3x Repository, 2x Factory, 1x Observer (with evidence)
  → Always the same result for the same code
```

Pass 2 becomes **targeted**: instead of sending raw code, we send the structural summary + only the relevant code snippets the LLM needs to interpret.

- Generates deterministic structural analysis section in standards output
- Dependency graph summary (most imported modules, circular deps via import analysis)
- Decorator/annotation usage frequency table
- Type annotation coverage percentage (LSP tier)
- Design pattern inventory with evidence
- Symbol distribution: classes vs functions vs methods breakdown
- Inheritance depth statistics

### 7. New: `src/chunking/ast_chunker.py`

Symbol-aware chunker extending `BaseChunker`, replacing line-count-based splitting with structure-aware splitting.

**Current behavior (GenericChunker):**

GenericChunker splits files into fixed-size character chunks (default 75,000 chars). It has no knowledge of code structure — it can split a file mid-function, mid-class, or even mid-statement:

```
# GenericChunker splits at character boundary:
Chunk 1 (chars 0-75000):
  class UserService:
      def get_user(self, user_id):
          result = self.db.query(
              "SELECT * FROM users "        # ← chunk boundary falls HERE
─────────────────────────────────────────
Chunk 2 (chars 75001-150000):
              "WHERE id = %s", user_id)     # ← continuation of split statement
          return User(**result)

      def save_user(self, user):
          ...
```

**Proposed behavior (ASTChunker):**

ASTChunker uses symbol line ranges from `StructuralAnalysis` to split at function/class boundaries. A function is never split across chunks:

```
# ASTChunker splits at symbol boundaries:
Chunk 1 (symbols: UserService.get_user, UserService.save_user):
  class UserService:
      def get_user(self, user_id):
          result = self.db.query(
              "SELECT * FROM users WHERE id = %s", user_id)
          return User(**result)

      def save_user(self, user):
          self.db.execute("INSERT INTO users ...", user.dict())
─────────────────────────────────────────
Chunk 2 (symbols: UserService.delete_user, UserService.list_users):
      def delete_user(self, user_id):
          ...
      def list_users(self, limit=100):
          ...
```

- Uses `StructuralAnalysis.symbols` line ranges for chunk boundaries
- Never splits mid-function or mid-class
- Groups decorator + function/class as single chunk
- Nested symbols (methods inside classes) kept together up to token limit
- Falls back to `GenericChunker` for files without structural data

### 8. Modified: `src/chunking/chunker_factory.py`

**Current behavior:**

`ChunkerFactory.get_chunker()` uses a chain-of-responsibility pattern, testing chunkers in order: PackageJson → Requirements → Markdown → Generic. Selection is based on file type only:

```python
# Current factory logic:
def get_chunker(file_path, content):
    for chunker_class in [PackageJsonChunker, RequirementsChunker, MarkdownChunker]:
        chunker = chunker_class()
        if chunker.supports(file_path, content):
            return chunker
    return GenericChunker()  # fallback for all other files
```

**Proposed change:**

Add `ASTChunker` as the highest-priority option when structural data is available. The factory receives an optional `StructuralAnalysis` parameter:

```python
# Proposed factory logic:
def get_chunker(file_path, content, structural_analysis=None):
    if structural_analysis and structural_analysis.symbols:
        return ASTChunker(structural_analysis)
    # existing chain unchanged:
    for chunker_class in [PackageJsonChunker, RequirementsChunker, MarkdownChunker]:
        chunker = chunker_class()
        if chunker.supports(file_path, content):
            return chunker
    return GenericChunker()
```

- Fallback chain: AST → PackageJson/Requirements/Markdown → Generic
- Zero impact when structural data is unavailable (existing behavior preserved)

### 9. Modified: `src/file_analyzer.py`

**Current behavior:**

`FileAnalyzer.analyze_file()` reads the raw file, gets a chunker, selects a strategy, and sends raw content to the LLM:

```python
# Current flow in analyze_file():
content = read_file(context.path)                    # raw file content
chunker = self.chunker_factory.get_chunker(path, content)
strategy = self.strategies[context.category]
system_prompt, user_prompt, max_tokens = strategy.get_prompts(path, content, context)
# user_prompt contains the full raw source code
response = self.llm_client.generate([
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": user_prompt}         # ← raw code, expensive in tokens
])
```

**Proposed change:**

Add a structural analysis step before the LLM call. When structural data is available, the LLM receives the structural output — not raw source code. The LLM's role shifts from code parser to structural interpreter.

```python
# Proposed flow in analyze_file():
content = read_file(context.path)

# NEW: structural analysis (fast, deterministic, cached)
structural = self.provider_registry.analyze_file(context.path)

# Pass structural data to chunker for symbol-aware splitting
chunker = self.chunker_factory.get_chunker(path, content, structural_analysis=structural)

strategy = self.strategies[context.category]

if structural:
    # STRUCTURAL MODE: LLM interprets structural output, not raw code
    structural_output = format_structural_output(structural)
    # e.g.:
    #   Symbols: UserService (class, extends BaseService), UserRepository (class),
    #            get_user (method, async, scope: UserService), save_user (method, scope: UserService)
    #   Inheritance: UserService → BaseService → ABC
    #   Imports: fastapi (12 files), sqlalchemy (8 files), pydantic (15 files)
    #   Patterns: Repository (0.8 confidence), Factory (0.5 confidence)
    #   Call graph: save_user → Database.execute (LSP only)

    system_prompt, user_prompt, max_tokens = strategy.get_prompts(
        path, structural_output, context,      # structural output replaces raw code
        structural_analysis=structural
    )
    response = self.llm_client.generate([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}   # ← structural data, ~200 tokens
    ])
else:
    # LEGACY MODE: no structural data, send raw code (current behavior)
    system_prompt, user_prompt, max_tokens = strategy.get_prompts(path, content, context)
    response = self.llm_client.generate([
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_prompt}   # ← raw code, ~2000+ tokens
    ])
```

- Cache structural results by file content hash (`cache_manager.py`) — re-analysis skipped for unchanged files
- Existing strategies work unchanged in legacy mode (no structural data = current behavior)
- Token reduction: ~200 tokens (structural output) vs ~2000+ tokens (raw code) = **~90% reduction per file**
- LLM never parses syntax — ctags/LSP already did that. LLM adds semantic reasoning only.

### 10. Internal integration (not a public API)

AST analysis is an **internal capability** — it is not exposed as a client-facing API endpoint. Instead, it enriches multiple existing internal flows:

- **Product tech standards** — structural data feeds into strategy prompts during `POST /api/v1/standards/product/generate`
- **Global standards** — structural analysis available as context during global extraction passes
- **Metamodel generation** — deterministic symbol/inheritance data improves metamodel accuracy
- **Reverse engineering** — structural analysis provides the skeleton for code understanding

No new API endpoints. The provider registry is called internally by `file_analyzer.py` and strategies. The existing API surface remains unchanged.

### 11. New: `config/lsp_servers.yaml`

LSP server configuration with per-server install mode and configurable sources. Covers all major programming languages. Full registry of available servers: [langserver.org](https://langserver.org/).

Each server entry supports:
- **`auto_install`** (`true`/`false`) — whether to automatically download and install when missing. Default: `true`. Set to `false` for manual-only installation (e.g., when IT manages tooling, or for servers requiring manual setup).
- **`install_command`** — the command to run for auto-install. Configurable so corporate environments can point to internal mirrors, private registries, or custom install scripts.
- **`package_manager`** — which package manager is required. The system checks `shutil.which()` before attempting install.

```yaml
# Global defaults (can be overridden per server)
defaults:
  auto_install: true           # auto-install missing servers by default
  # Corporate environments: override package sources globally
  # pip_index_url: "https://artifactory.corp.com/pypi/simple"
  # npm_registry: "https://artifactory.corp.com/npm/"
  # go_proxy: "https://goproxy.corp.com"

servers:
  # Python
  python:
    command: ["pyright-langserver", "--stdio"]
    auto_install: true
    install_command: "pip install pyright"
    package_manager: "pip"
    # Corporate override example:
    # install_command: "pip install pyright --index-url https://artifactory.corp.com/pypi/simple"

  # JavaScript / TypeScript / React / Vue / Angular
  typescript:
    command: ["typescript-language-server", "--stdio"]
    auto_install: true
    install_command: "npm i -g typescript-language-server typescript"
    package_manager: "npm"
    # Corporate override example:
    # install_command: "npm i -g typescript-language-server typescript --registry https://artifactory.corp.com/npm/"

  # Go
  go:
    command: ["gopls", "serve"]
    auto_install: true
    install_command: "go install golang.org/x/tools/gopls@latest"
    package_manager: "go"
    # Corporate override example:
    # install_command: "GOPROXY=https://goproxy.corp.com go install golang.org/x/tools/gopls@latest"

  # Rust
  rust:
    command: ["rust-analyzer"]
    auto_install: true
    install_command: "rustup component add rust-analyzer"
    package_manager: "rustup"

  # C / C++
  cpp:
    command: ["clangd"]
    auto_install: true
    install_command: "apt-get install -y clangd"
    package_manager: "apt"

  # Java
  java:
    command: ["jdtls"]
    auto_install: true
    install_command: "pip install jdtls"
    package_manager: "pip"

  # C#
  csharp:
    command: ["OmniSharp", "--languageserver"]
    auto_install: true
    install_command: "dotnet tool install -g omnisharp"
    package_manager: "dotnet"

  # Ruby
  ruby:
    command: ["solargraph", "stdio"]
    auto_install: true
    install_command: "gem install solargraph"
    package_manager: "gem"

  # PHP
  php:
    command: ["phpactor", "language-server"]
    auto_install: true
    install_command: "composer global require phpactor/phpactor"
    package_manager: "composer"

  # Kotlin
  kotlin:
    command: ["kotlin-language-server"]
    auto_install: true
    install_command: "npm i -g kotlin-language-server"
    package_manager: "npm"

  # Swift
  swift:
    command: ["sourcekit-lsp"]
    auto_install: false          # bundled with Xcode / Swift toolchain, no install needed
    install_command: null
    package_manager: null

  # Lua
  lua:
    command: ["lua-language-server"]
    auto_install: true
    install_command: "brew install lua-language-server"
    package_manager: "brew"

  # Elixir
  elixir:
    command: ["elixir-ls"]
    auto_install: true
    install_command: "mix escript.install hex elixir_ls"
    package_manager: "mix"
```

**Corporate environment configuration:**

The yaml is designed so that corporate environments can override install sources without changing the server definitions:

1. **Private registries** — change `install_command` per server to point to internal mirrors (Artifactory, Nexus, etc.)
2. **Global source overrides** — set `defaults.pip_index_url`, `defaults.npm_registry`, `defaults.go_proxy` to redirect all installs through corporate proxies
3. **Disable auto-install entirely** — set `defaults.auto_install: false` to require IT-managed server installations. The system still uses whatever servers are already in PATH.
4. **Mixed mode** — some servers auto-install (e.g., pyright via pip), others manual-only (e.g., clangd managed by IT)

**Adding a new language:** Add an entry to this file with the server binary, install command, and package manager. ctags already handles the language for Tier 1 (100+ languages). The new entry only enables Tier 2 depth.

**Install behavior per server:**
- `auto_install: true` + server missing → check package manager available → run `install_command` → fall back to ctags on failure
- `auto_install: false` + server missing → skip silently, use ctags (no install attempted)
- `auto_install: true` + `install_command: null` → skip install, use ctags (server must be pre-installed, e.g., Swift)
- Install happens once per environment — subsequent runs find the binary in PATH

### 12. Docker changes

- Add `universal-ctags` to Dockerfile (`apt-get install -y universal-ctags` — ~5MB)
- Add `lsprotocol` to `requirements.txt`
- LSP servers NOT bundled in default image (ctags handles all languages at Tier 1)
- Optional: `Dockerfile.rich-analysis` variant with pyright + typescript-language-server pre-installed for teams wanting Tier 2 out of the box

---

## Caching Strategy

- Key: SHA-256 of file content + provider name
- Store: `StructuralAnalysis` as JSON in `{project_dir}/.cache/ast/`
- Invalidation: automatic on content change (hash mismatch)
- Shared across runs for same project
- Separate cache entries per provider tier (ctags result ≠ LSP result)
- Integrated with existing `cache_manager.py`

---

## Error Handling

- ctags not in Docker image → build-time error (Dockerfile enforces installation)
- ctags not on local dev → auto-install attempt, clear error with install command if that fails, text fallback
- LSP server not installed → auto-install if `install_command` defined; if install fails or no command → use ctags tier, log warning
- LSP server crashes → kill process, fall back to ctags for remaining files, log error
- LSP server timeout (>30s per file) → kill query, use ctags result, log warning
- ctags parse error → skip file structural data, use text fallback, continue
- Unsupported language (no ctags kinds defined) → generic symbol extraction, reduced accuracy
