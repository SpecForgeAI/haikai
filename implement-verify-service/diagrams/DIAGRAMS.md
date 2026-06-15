# Standards Extractor - Architecture Diagrams

This directory contains comprehensive architecture diagrams for the **Standards Extractor** project, documenting the **3-pass architecture** for global standards extraction.

## 📊 Diagrams Overview

### 1. Chat API Architecture Diagram (`chat_api_diagram.mmd` / `.png`)
**Format:** Mermaid | **Type:** Component Architecture

Comprehensive architecture of the conversational chat API:
- **Client Layer** - HTTP clients (curl, SDK, UI)
- **API Layer** - FastAPI server with authentication
- **Chat Endpoints** - Stream, history, and clear endpoints
- **Chat Core Components** - ClaudeChatExecutor, AuditLogger, Pydantic models
- **Claude CLI Integration** - Process management, session persistence, Haikai skills
- **Workspace Structure** - Project directories, session storage, audit logs
- **Streaming Protocol** - Server-Sent Events (SSE) with event types
- **Haikai Integration** - Full access to all skills (/write-spec, /create-tasks, etc.)
- **Audit Trail** - JSONL format with message types and system events
- **Design Patterns** - CLI Wrapper, Observer, Repository, Strategy, Facade

**Key Features:**
- Real-time streaming via SSE
- Session persistence per company/project
- Full Haikai skills access during conversation
- Complete audit trail in JSONL format
- Iterative specification refinement workflow

### 2. Chat API Sequence Diagram (`chat_sequence_diagram.mmd` / `.png`)
**Format:** Mermaid | **Type:** Sequence Diagram

Detailed interaction flow for chat API operations:

**Streaming Conversation Flow:**
1. Client sends POST request with message
2. Authentication verification
3. Session initialization with workspace setup
4. User message logged to JSONL
5. Claude CLI process started with Haikai skills
6. Streaming response loop:
   - Content events (text chunks)
   - Skill invocation events (Haikai commands)
   - File modification events (file operations)
   - Error events (error handling)
7. Complete assistant message logged
8. Session state saved

**Get Conversation History Flow:**
1. Client requests history with company/project
2. Authentication verification
3. Read and parse messages.jsonl
4. Return list of message entries

**Clear Conversation Flow:**
1. Client requests session clear
2. Authentication verification
3. Delete session directory
4. Delete audit logs
5. Return success confirmation

### 3. UML Class Diagram (`uml_diagram.puml` / `.png`)
**Size:** 510 KB | **Format:** PlantUML

Complete class diagram showing:
- **Core standards_orchestrator** (StandardsOrchestrator with global context cache)
- **5 stages** of processing (Scanning, Context Building, Analysis, Synthesis, Reporting)
- **Strategy pattern** implementation (8 strategies including 4 global standards strategies)
- **Factory pattern** (ChunkerFactory)
- **Chunking system** (4 specialized chunkers)
- **3-pass architecture** components (GlobalAnalysisContext, BaseGlobalStandardStrategy)
- **LLM integration** (LLMClient, AgentPrompts with 8 prompts)
- **All relationships** between components

**Key Components:**
- `StandardsOrchestrator` - Main standards_orchestrator with global context cache
- `BaseGlobalStandardStrategy` - Abstract base for 3-pass extraction
- `GlobalAnalysisContext` - Dataclass for structured context (NEW)
- `ErrorHandlingStrategy`, `ValidationStrategy`, `CodingStyleStrategy`, `ConventionsStrategy`
- `FileAnalyzer` with strategy registration
- `StandardsSynthesizer` with 3-pass synthesis methods

### 2. Dataflow Diagram (`dataflow_diagram.mmd` / `.png`)
**Size:** 197 KB | **Format:** Mermaid

Data flow through all 5 stages:
- **Stage 0:** Technical Documents Processing
- **Stage 1:** Scanning & Categorization
- **Stage 1.5:** Context Building (Pass 1: Analyze Codebase)
- **Stage 2:** File Analysis (Pass 2: Extract Candidates)
- **Stage 3:** Synthesis (Pass 3a: Filter Baseline, Pass 3b: Consolidate)
- **Stage 4:** Reporting

**Key Flows:**
- Sample files → Context Builder → Global Context Cache
- Global Context Cache → File Analyzer (context injection)
- File Analyses → Pass 3a (aggressive filtering) → Pass 3b (consolidation)
- Chunking support for large repositories (25 files per chunk)

### 3. State Diagram (`state_diagram.puml` / `.png`)
**Size:** 189 KB | **Format:** PlantUML

State machine showing:
- **Initialized** → Register global strategies
- **ScanningPhase** → Process tech docs, scan sources
- **ContextBuildingPhase** → Pass 1: Analyze codebase context
- **AnalysisPhase** → Pass 2: Extract pattern candidates with context injection
- **SynthesisPhase** → Pass 3a: Filter baseline, Pass 3b: Consolidate
- **ReportingPhase** → Generate reports
- **Completed**

**Key States:**
- `ContextBuildingPhase` - Sample files, analyze context, cache results
- `AnalysisPhase` - Inject context, extract candidates with confidence scores
- `SynthesisPhase` - Route to 3-pass synthesis, aggressive filtering, consolidation

### 4. Architecture Diagram (`architecture_diagram.mmd` / `.png`)
**Size:** 52 KB | **Format:** Mermaid

Layered architecture:
- **Client Layer** - CLI interface
- **Orchestration Layer** - StandardsOrchestrator with global context cache and 3-pass routing
- **Stage 1 Layer** - Scanning & Discovery
- **Stage 1.5 Layer** - Context Building (Pass 1)
- **Stage 2 Layer** - Analysis (Pass 2)
- **Stage 3 Layer** - Synthesis (Pass 3a + 3b)
- **Stage 4 Layer** - Reporting
- **Output Layer** - Standards documents (concise, company-specific)
- **Cross-Cutting Concerns** - GlobalAnalysisContext, ContentExtractor, Logging
- **Design Patterns** - 10 patterns including 3-Pass Pattern, Caching Pattern
- **Martin Fowler Principles** - 8 principles applied

> **Generated from the structural pipeline self-snapshot.** The three diagrams
> below (`haikai_workflow`, `haikai_use_cases`, `repo_endpoint_map`) are
> regenerated by running the repo's OWN structural engine
> (`run_structural_pipeline` in `src/ast/pipeline.py`, ctags + tree-sitter)
> against this repo's `src/` tree, plus an AST enumeration of the FastAPI routes
> actually wired into the app. Driver: `scripts/extract_self.py`. Raw data:
> `ast-reports/self-snapshot/summary.json` and `.../routes.json`.
>
> **Real counts (self-snapshot):**
> - **179** Python files analyzed; **10,959** symbols (**270** classes, **1,319**
>   functions/methods); **122** inheritance edges; **12,993** call sites
>   (3,242 cross-file resolved).
> - **64** HTTP routes wired into the app (verified by booting FastAPI), split as:
>   **47** in `src/api/__init__.py` + **5** `structural_endpoints.py`
>   (`/api/v1/structural`) + **5** `dep_routes.py` (`/api/dep`) + **4**
>   `refactor_routes.py` (`/api/refactor`) + **3** `discovery_routes.py`
>   (`/api/discovery`). **0** WebSocket routes — streaming endpoints are SSE over POST.
> - Every workflow/use-case node is grounded in a class confirmed present by the
>   snapshot (e.g. `StandardsOrchestrator`, `HaikaiOrchestrator`,
>   `OperationExecutor`, `JobQueue`, `GitManager`, `CtagsProvider`,
>   `TreeSitterProvider`, `FileStore`, `DiagramGenerator`, `DepGraph`, the three
>   chat executors). Tree-sitter ran for real (Python grammar): it wrote 12,994
>   call-graph lines and 928 import lines to the snapshot store — not a ctags-only
>   fallback.
>
> **Extraction gap:** the pipeline's *endpoint/interaction discovery* stages are
> LLM-driven (per `CLAUDE.md`: AST does mechanical extraction, the LLM interprets
> frameworks). The self-snapshot ran with `llm_client=None`, so the pipeline
> discovered **0** endpoints/interactions on its own. The route counts above
> therefore come from the deterministic AST route enumeration / FastAPI boot, not
> from the LLM discovery loop. Tree-sitter grammars for non-Python languages
> (ts/go/java/c#/c/cpp/rust) were not installed, but this repo is Python-only so
> there was nothing for them to parse.

### 5. Haikai Workflow Diagram (`haikai_workflow.mmd` / `.png`)
**Format:** Mermaid | **Type:** Flowchart

The entire Haikai spec-driven-development workflow and all components:
- **Precondition** - interactive `/shape-spec` (initialize-spec, research-spec, `/ask-questions`) producing the spec folder, `requirements.md`, and `initialization.md`
- **Orchestrator** - `HaikaiOrchestrator` pre-check + COMMANDS pipeline (and v2 BRAIN_COMMANDS)
- **Command Pipeline** - `/write-spec` → `/create-tasks` → `/implement-tasks` → `/git-commit-preparation` (non-fatal)
- **Chat Executors** - Claude / OAuth / OpenAI selected via `CHAT_EXECUTOR` through `backend_registry`
- **LLM / CLI Layer** - Claude CLI subprocess (stream-json → SSE) and `LLMClient`
- **Verification & Self-Repair** - `verify-implementation` report and the retry → `/explain-failure` mechanism
- **Async Job Queue** - SQLite-backed enqueue, checkpoint, resume
- **Structural Pipeline** - `run_structural_pipeline`: `CtagsProvider` + `TreeSitterProvider` → `FileStore` snapshot → `InteractionClassifier`/endpoint discovery → `DiagramGenerator` + `DepGraph` (drives the analyze-repo / `/api/v1/structural/*` / `/api/discovery/*` routes)
- **Outputs** - `spec.md`, `tasks.md`, implementation + verification report, ZIP/JSON ImplementationPackage, git-ready workspace, structural diagrams/endpoints

### 6. Haikai Use Cases Diagram (`haikai_use_cases.mmd` / `.png`)
**Format:** Mermaid | **Type:** Flowchart (one labelled path per use case)

Distinct end-to-end paths through the system (each starts at a route verified in `routes.json`):
1. **Generate global standards** - `POST /api/v1/standards/global/generate` → `OperationExecutor` → `StandardsOrchestrator` → standards docs
2. **Full orchestration for a spec (sync)** - `POST /api/v1/orchestrations` → `HaikaiOrchestrator.run_workflow` → write-spec → create-tasks → implement-tasks → git prep
3. **Interactive shape-spec chat (SSE over POST)** - `POST /api/v1/shape-spec/stream` → `ClaudeChatExecutor` → `/ask-questions` loop → requirements.md
4. **Async job submit + poll** - `POST /api/v1/jobs/orchestrations` → `JobQueue` worker → poll `GET /api/v1/jobs/{job_id}` / `DELETE` to cancel
5. **Brain-only + package export (v2)** - `POST /api/v2/orchestrations/brain-only` → `run_brain_workflow` → ImplementationPackage ZIP/JSON
6. **Structural analysis + discovery (mounted routers)** - `POST /api/v1/structural/analyze` → `run_structural_pipeline` (`CtagsProvider`/`TreeSitterProvider`/`FileStore`), plus `/api/discovery/*`, `/api/v1/structural/{repo}/diagrams/generate`, `/api/dep/*`

### 7. Repo Endpoint Map (`repo_endpoint_map.mmd` / `.png`)
**Format:** Mermaid | **Type:** Flowchart

"My repo as a set of configured endpoints" view. Maps real routes (AST-enumerated from `src/api/__init__.py` and the 4 mounted routers) → the handler/service each routes to. All **64** routes are accounted for, grouped by their actual source module:
- **src/api/__init__.py (47):** Health + git-init, Standards + Metamodel, Spec/Task CRUD (v1: 7 routes + v2: 6 routes), Orchestration, Streaming Chat (SSE over POST — v1: 10 routes + v2: 5 routes), Async Job Queue
- **Mounted routers (17):** `structural_endpoints.py` (5, `/api/v1/structural`), `dep_routes.py` (5, `/api/dep`), `refactor_routes.py` (4, `/api/refactor`), `discovery_routes.py` (3, `/api/discovery`)
- Handlers (real classes from the snapshot): `OperationExecutor`/`StandardsOrchestrator`, `MetamodelGateway`, `HaikaiService`/`APICommandExecutor`, `HaikaiOrchestrator`, the three Chat Executors, `JobQueue`, `GitManager`, the AST pipeline (`CtagsProvider`/`TreeSitterProvider`/`FileStore`/`DiagramGenerator`), `DepGraph`

### 8. Async Verification Orchestration (PROPOSED) (`async_verification_orch.mmd` / `.png`)
**Format:** Mermaid | **Type:** Flowchart | **Status:** PROPOSED — design, not yet implemented

Static mirror of the interactive React Flow visualization at `haikai/specs/2026-05-20-async-verification-orchestration/flow-diagram.html`. Visualizes the proposed async verification + self-repair model:
- **Spec lifecycle:** `/shape-spec` → `/create-tasks` → `/create-rubrics` (NEW) → `/orchestrate` (compile YAML) → operator CLI launches `standards-extractor orchestrate run`
- **Per task group:** scheduler picks group → implementer → commit → fan-out to FOUR verifiers (inline-runner [shell tools], ci-trigger-runner → connectors, rubric-verifier [non-det], observe-runner [long-lived]) → AND gate evaluates `inline ∧ ci-trigger ∧ rubric ∧ observe` → PASS advances DAG, FAIL routes to repair-engine (capped attempts) → loop back to implementer
- **Observer drift:** long-lived observer flips verdict after DAG advanced → `observer-drift` hook fires → reopens AND gate + spawns compensating fix-task
- **All 9 orchestration hooks shown:** `spec-frozen` (#1), `post-implement` (#2), `pre-verify` (#3), `verdict-landed` (#4 — fires ONCE PER VERIFIER), `gate-evaluated` (#5), `pre-repair` (#6), `post-repair` (#7), `task-group-done` (#8), `observer-drift` (#9)
- **Surface colour mapping** matches the spec's A/B/X/Y model: `[A]` git hooks (orange), `[B]` orchestration hooks (purple), `[X]` operator CLI (blue), `[Y]` agent slash commands (green), runtime (grey)

Compare with `haikai_workflow.mmd` (the CURRENT runtime) to see the design delta. See also `haikai/specs/2026-05-20-async-verification-orchestration/{spec.md, hooks-design.md}`.

> **Note on endpoint count (corrected from self-snapshot):** `docs/ARCHITECTURE.md`
> summarises the API as "27 endpoints across 6 groups" — this is **stale**. The app
> actually wires **64 HTTP routes** (verified by booting FastAPI and by AST-parsing
> every `@app.*` / `@router.*` decorator): **47** in `src/api/__init__.py` plus
> **17** across four mounted routers — `structural_endpoints.py` (5, `/api/v1/structural`),
> `dep_routes.py` (5, `/api/dep`), `refactor_routes.py` (4, `/api/refactor`),
> `discovery_routes.py` (3, `/api/discovery`). There are **0** WebSocket routes
> (the "stream" endpoints are SSE over POST). Note `src/chat/memory_endpoints.py`
> exists but is **not** mounted in the app, so there is no live `/api/v1/chat/*`
> surface — the previous diagram's claim of a mounted chat router was incorrect.
> The endpoint-map diagram groups by the real source module/router and shows true
> per-module counts. See `ast-reports/self-snapshot/routes.json`.

## 🆕 3-Pass Architecture (NEW)

The system now implements a sophisticated **3-pass approach** for extracting global standards:

### Pass 1: Analyze Codebase Context
**Location:** Stage 1.5 - Context Building  
**Method:** `BaseGlobalStandardStrategy.build_context_from_samples()`  
**Output:** `GlobalAnalysisContext` dataclass

**Process:**
1. Sample 15 random code files
2. Filter documentation with ContentExtractor
3. Analyze samples to identify:
   - Tech stack (languages, frameworks)
   - Baseline practices (to be filtered out)
   - Distinctive patterns (to be extracted)
   - Filtering guidance (specific rules)
4. Cache context for Stage 2

**Prompts:**
- `ANALYZE_CODEBASE_CONTEXT_SYSTEM_PROMPT`
- `ANALYZE_CODEBASE_CONTEXT_USER_PROMPT_TEMPLATE`

### Pass 2: Extract Pattern Candidates
**Location:** Stage 2 - File Analysis  
**Method:** `BaseGlobalStandardStrategy.get_prompts()` with context injection  
**Output:** Pattern candidates with confidence scores

**Process:**
1. Inject cached context from Pass 1
2. Analyze each file guided by context
3. Extract potential company-specific patterns
4. Conservative filtering (collect candidates)
5. Save analyses with confidence scores

**Prompts:**
- `EXTRACT_PATTERN_CANDIDATES_SYSTEM_PROMPT`
- `EXTRACT_PATTERN_CANDIDATES_USER_PROMPT_TEMPLATE`

### Pass 3: Filter and Consolidate
**Location:** Stage 3 - Synthesis  
**Method:** `StandardsSynthesizer.synthesize_global_standard_3pass()`  
**Output:** Concise standards document (15-25 lines)

**Process:**

**Pass 3a: Filter Baseline Patterns**
1. Load all pattern candidates
2. Apply aggressive filtering using context
3. Reject 90-95% of generic patterns
4. Keep only company-specific patterns

**Prompts:**
- `FILTER_BASELINE_PATTERNS_SYSTEM_PROMPT`
- `FILTER_BASELINE_PATTERNS_USER_PROMPT_TEMPLATE`

**Pass 3b: Consolidate Patterns**
1. Merge duplicate patterns
2. Group by theme
3. Format output
4. Align with template structure
5. Generate concise document

**Prompts:**
- `CONSOLIDATE_PATTERNS_SYSTEM_PROMPT`
- `CONSOLIDATE_PATTERNS_USER_PROMPT_TEMPLATE`

**Chunking Support:**
- Large repositories: 25 files per chunk
- Process chunks in parallel
- Consolidate results across chunks

## 🏗️ Design Patterns

### 1. Strategy Pattern
**Applied to:** `AnalysisStrategy` hierarchy  
**Purpose:** Different analysis strategies for different file types  
**Benefit:** Easy to add new analysis strategies

**Strategies:**
- `CodeAnalysisStrategy` - Code file analysis
- `DependencyAnalysisStrategy` - Dependency file analysis
- `TechnicalDocAnalysisStrategy` - Technical document analysis
- `BaseGlobalStandardStrategy` - Abstract base for global standards (3-pass)
  - `ErrorHandlingStrategy`
  - `ValidationStrategy`
  - `CodingStyleStrategy`
  - `ConventionsStrategy`

### 2. Factory Pattern
**Applied to:** `ChunkerFactory`  
**Purpose:** Create appropriate chunker based on file type  
**Benefit:** Centralized chunker creation logic

### 3. Parameter Object Pattern
**Applied to:** `FileAnalysisContext`, `GlobalAnalysisContext` (NEW)  
**Purpose:** Reduce parameter coupling, structured context  
**Benefit:** Easier to extend context without changing signatures

### 4. Template Method Pattern
**Applied to:** `BaseChunker`, `BaseGlobalStandardStrategy`  
**Purpose:** Define algorithm structure in base class  
**Benefit:** Subclasses customize specific steps

### 5. Facade Pattern
**Applied to:** `StandardsOrchestrator`  
**Purpose:** Provide simple interface to complex subsystem  
**Benefit:** Hide complexity from clients

### 6. 3-Pass Pattern (NEW)
**Applied to:** Global standards extraction  
**Purpose:** Context → Extract → Filter+Consolidate  
**Benefit:** Improved accuracy, consistency, and conciseness

**Phases:**
1. **Context Building** - Understand codebase characteristics
2. **Candidate Extraction** - Collect potential patterns
3. **Filtering & Consolidation** - Aggressive filtering, merge duplicates

### 7. Caching Pattern (NEW)
**Applied to:** Global context cache  
**Purpose:** Build context once, reuse for all files  
**Benefit:** Performance improvement, consistency

### 8. Chunking Pattern (NEW)
**Applied to:** Large repository handling  
**Purpose:** Process 25 files per chunk  
**Benefit:** Handle large codebases, manage token limits

### 9. Dependency Injection
**Applied to:** Throughout the system  
**Purpose:** Inject dependencies via constructor  
**Benefit:** Loose coupling, easier testing

### 10. Single Responsibility Principle
**Applied to:** All modules  
**Purpose:** Each module has one reason to change  
**Benefit:** Maintainability, testability

## 📚 Martin Fowler Principles Applied

### 1. Separation of Concerns
Each module handles a single aspect:
- `FileScanner` - File discovery
- `FileAnalyzer` - File analysis
- `StandardsSynthesizer` - Standards synthesis
- `ReportGenerator` - Report generation

### 2. Dependency Inversion
Depend on abstractions, not concretions:
- `AnalysisStrategy` interface
- `BaseChunker` interface
- Strategy registration pattern

### 3. Interface Segregation
Minimal required interfaces:
- `AnalysisStrategy` - Only `get_prompts()` and `get_metadata()`
- `BaseChunker` - Only `should_chunk()`, `chunk()`, `merge()`

### 4. Composition Over Inheritance
Favor composition:
- `FileAnalyzer` composes strategies
- `StandardsOrchestrator` composes all components
- No deep inheritance hierarchies

### 5. Tell, Don't Ask
Objects manage their own state:
- Strategies know how to analyze their file types
- Chunkers know when to chunk and how to merge

### 6. DRY Principle (Don't Repeat Yourself)
3-pass logic centralized:
- `BaseGlobalStandardStrategy` - Shared Pass 1 & 2 logic
- `StandardsSynthesizer` - Shared Pass 3 logic
- No duplication across global strategies

### 7. Refactoring for Clarity
Clean, testable code structure:
- Clear method names (`build_context_from_samples`, `synthesize_global_standard_3pass`)
- Small, focused methods
- Comprehensive logging

### 8. Modularity & Extensibility
Easy to extend:
- Add new global standards by subclassing `BaseGlobalStandardStrategy`
- Add new file analysis strategies by implementing `AnalysisStrategy`
- Add new chunkers by implementing `BaseChunker`

## 🔍 Key Architectural Decisions

### Why 3-Pass Instead of 2-Pass?

**Problem:** 2-pass approach was generating verbose, generic patterns

**Solution:** Add Pass 3 with aggressive filtering and consolidation

**Benefits:**
1. **Improved Accuracy** - Context-guided extraction is more accurate
2. **Better Filtering** - Reject 90-95% of generic patterns
3. **Consistency** - All files analyzed with same context understanding
4. **Conciseness** - Output is 15-25 lines, not 100+ lines
5. **Performance** - Context built once, reused for all files

### Why GlobalAnalysisContext Dataclass?

**Problem:** Context was passed as unstructured strings

**Solution:** Structured dataclass with clear fields

**Benefits:**
1. **Type Safety** - IDE autocomplete, type checking
2. **Clarity** - Clear what context contains
3. **Serialization** - Easy to convert to JSON for prompts
4. **Extensibility** - Easy to add new context fields

### Why Chunking Support?

**Problem:** Large repositories (1000+ files) hit token limits

**Solution:** Process 25 files per chunk, consolidate results

**Benefits:**
1. **Scalability** - Handle any repository size
2. **Token Management** - Stay within LLM limits
3. **Parallelization** - Can process chunks in parallel (future)

## 🎯 How to Use These Diagrams

### For Developers
1. **Chat API Architecture Diagram** - Understand conversational interface components
2. **Chat API Sequence Diagram** - Trace conversation flow and interactions
3. **UML Diagram** - Understand class relationships and dependencies
4. **Dataflow Diagram** - Trace data through the system
5. **State Diagram** - Understand workflow and state transitions
6. **Architecture Diagram** - See the big picture and design patterns

### For Architects
1. **Chat API Architecture Diagram** - Evaluate streaming and session management design
2. **Architecture Diagram** - Evaluate overall design decisions
3. **Design Patterns Section** - Understand pattern applications
4. **Martin Fowler Principles** - Verify principle adherence

### For API Integration
1. **Chat API Sequence Diagram** - Understand request/response flow
2. **Chat API Architecture Diagram** - Understand components and data flow
3. **CHAT_API.md** - Complete API documentation with examples

### For Documentation
1. **All Diagrams** - Include in technical documentation
2. **README** - Reference in project README
3. **Onboarding** - Help new developers understand the system

## 🛠️ Rendering Diagrams

### PlantUML Diagrams (UML, State)
```bash
# Install PlantUML
sudo apt-get install plantuml

# Render to PNG
plantuml -Tpng uml_diagram.puml
plantuml -Tpng state_diagram.puml
```

### Mermaid Diagrams (Dataflow, Architecture, Chat API)
```bash
# Install Mermaid CLI
npm install -g @mermaid-js/mermaid-cli

# Render to PNG
mmdc -i dataflow_diagram.mmd -o dataflow_diagram.png
mmdc -i architecture_diagram.mmd -o architecture_diagram.png
mmdc -i chat_api_diagram.mmd -o chat_api_diagram.png
mmdc -i chat_sequence_diagram.mmd -o chat_sequence_diagram.png
```

### Using the Utility
```bash
# Render any diagram
manus-render-diagram uml_diagram.puml uml_diagram.png
manus-render-diagram dataflow_diagram.mmd dataflow_diagram.png
```

## 📚 Additional Resources

- **ARCHITECTURE.md** - Detailed architecture documentation
- **CHAT_API.md** - Conversational chat API documentation
- **Source Code** - `src/` directory with implementation
- **Chat Components** - `src/chat/` directory with chat implementation
- **Tests** - `tests/` directory with test suite
- **Templates** - `templates/standards/` with standard templates

## 🤔 Discussion Questions

1. **Why separate Pass 3a and Pass 3b?**  
   Separation of concerns: filtering is different from consolidation. Easier to debug and improve each step independently.

2. **Why cache context instead of rebuilding for each file?**  
   Performance and consistency. Context built once from samples, reused for all files. Ensures all files analyzed with same understanding.

3. **Why 15 sample files for context building?**  
   Balance between coverage and performance. 15 files provide enough variety without excessive LLM calls.

4. **Why aggressive filtering (90-95% rejection)?**  
   Most patterns are baseline practices. Only 5-10% are truly company-specific. Aggressive filtering ensures concise, valuable output.

5. **Why 25 files per chunk?**  
   Token limit management. 25 files fit comfortably within LLM context limits while providing enough data for pattern identification.

6. **Why GlobalAnalysisContext instead of Dict?**  
   Type safety, clarity, and extensibility. Dataclass provides structure and makes code more maintainable.

7. **Why route global standards to 3-pass synthesis?**  
   Global standards require different approach than file-specific standards. 3-pass ensures company-specific patterns, not generic best practices.

8. **Why inject context in Pass 2?**  
   Context guides extraction. Analyzer knows what's baseline (skip) and what's distinctive (extract). Improves accuracy and reduces false positives.

---

**Last Updated:** May 23, 2026  
**Version:** 3.3 — corrections from deep audit (v2 spec count 8→6, v2 stream count 6→5, `write-spec` path expanded, SSE factory renamed to `create_chat_executor`); added `async_verification_orch.mmd` covering the PROPOSED design from spec `2026-05-20-async-verification-orchestration`  
**Maintainer:** Standards Extractor Team
