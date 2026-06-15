# Architecture Documentation

## Overview

Standards Extractor is a FastAPI application that uses AI to extract coding standards from codebases and provides Haikai workflows for spec-driven development. It exposes 27 REST endpoints organized into 6 functional groups.

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                      FastAPI Application                         │
│                         (src/api.py)                            │
│                                                                  │
│  27 endpoints across 6 groups:                                   │
│  • Standards Generation (global, product, metamodel)             │
│  • Haikai CRUD (specs, tasks, implement)                      │
│  • Orchestrations (full workflows)                              │
│  • Streaming Chat (shape-spec, plan-product, story-anchor)      │
│  • Async Job Queue                                              │
│  • Health                                                        │
└──────────┬────────────┬─────────────┬────────────────────────────┘
           │            │             │
     ┌─────▼─────┐ ┌───▼────┐  ┌────▼──────────────┐
     │Operation   │ │Haikai│  │Chat Executors      │
     │Executor    │ │Service │  │(SSE Streaming)     │
     │            │ │        │  │                    │
     │Standards   │ │CRUD    │  │• ClaudeChatExecutor│
     │Orchestrator│ │layer   │  │• OAuthChatExecutor │
     │            │ │        │  │• OpenAIChatExecutor│
     └─────┬──────┘ └───┬────┘  └────┬──────────────┘
           │            │             │
     ┌─────▼────────────▼─────────────▼──────────┐
     │              Core Services                  │
     │                                             │
     │ • LLMClient (Anthropic/OpenAI/Azure)       │
     │ • APICommandExecutor (Claude CLI wrapper)   │
     │ • ClaudeCLIExecutor (subprocess management) │
     │ • FileScanner / FileAnalyzer / FileParser   │
     │ • StandardsSynthesizer / ReportGenerator    │
     │ • TechnicalDocRepository                    │
     │ • MetamodelGateway                         │
     │ • CacheManager / EarlyExitDetector          │
     │ • JobQueue (SQLite-backed)                  │
     └────────────────────────────────────────────┘
```

## Core Components

### 1. API Layer (`src/api.py`)
- FastAPI app with Bearer token auth (`STANDARDS_API_KEY`)
- CORS configured for localhost:5173
- ThreadPoolExecutor for async operation dispatch
- SSE StreamingResponse for chat endpoints

### 2. Standards Pipeline

**StandardsOrchestrator** (`src/standards_orchestrator.py`)
- Coordinates multi-stage extraction pipeline
- Modes: `fetch_metamodel_only()`, `run_product_standards_only()`, `run()` (full)
- Processes technical documents (PDF, DOCX, JSON)

**Pipeline stages:**
1. **FileScanner** → categorizes files (backend, frontend, testing, global, dependency)
2. **FileAnalyzer** → per-file analysis using strategy pattern
3. **StandardsSynthesizer** → aggregates into standard docs
4. **ReportGenerator** → produces Markdown/JSON reports

**Supporting:**
- **LLMClient** (`src/llm_client.py`) — unified wrapper for Anthropic (API key + OAuth), OpenAI, Azure
- **CacheManager** — document + LLM result caching with TTL
- **EarlyExitDetector** — skips non-technical content cheaply
- **FileParser** — handles `.pdf`, `.docx`, `.html`, `.md`, `.txt`, `.json`, `.xml`, `.yaml`, `.yml`, `.properties`, `.cfg`, `.ini`, `.toml`, `.gradle`

### 3. Haikai CRUD

**HaikaiService** (`src/haikai_service.py`) — spec lifecycle management
- List, read, create, delete specs
- Delegates command execution to APICommandExecutor

**APICommandExecutor** (`src/api_command_executor.py`) — wraps Anthropic SDK
- Handles OAuth tokens (`sk-ant-oat`) and standard API keys
- Executes Haikai commands: `/write-spec`, `/create-tasks`, `/implement-tasks`

**HaikaiOrchestrator** (`src/haikai_orchestrator.py`) — workflow automation
- Chains: write-spec → create-tasks → implement-tasks
- Stop-on-error, retry, timeout options
- Generates orchestration logs per step

### 4. Streaming Chat

Three chat executors share a common pattern: subprocess management, SSE event generation, session persistence.

**ClaudeChatExecutor** (`src/chat/claude_chat_executor.py`)
- Wraps Claude CLI with `--output-format stream-json`
- Deterministic UUID sessions per company/project
- Parses NDJSON events → SSE stream
- Supports `command_name` parameter (shape-spec, plan-product, etc.)

**OAuthChatExecutor** (`src/chat/oauth_chat_executor.py`)
- Direct Anthropic SDK streaming with OAuth tokens
- No Claude CLI dependency

**OpenAIChatExecutor** (`src/chat/openai_chat_executor.py`)
- OpenAI SDK streaming fallback

**Supporting:**
- **AuditLogger** (`src/chat/audit_logger.py`) — JSONL conversation logging
- **ToolExecutor** (`src/chat/tool_executor.py`) — file I/O tool execution
- **ChatModels** (`src/chat/chat_models.py`) — request/response Pydantic models

### 5. Async Job Queue

**JobQueue** (`src/job_queue/`) — SQLite-backed async job processing
- `job_queue.py` — queue management
- `job_storage.py` — SQLite persistence
- `job_models.py` — Pydantic models (Job, JobResponse, JobDetailResponse)
- `worker.py` — background worker
- `tasks.py` — task definitions

### 6. Structural Analysis Pipeline (`src/ast/`)

Two-tier code intelligence: ctags (symbols) + tree-sitter (call graphs).

**Providers:**
- **CtagsProvider** (`ctags_provider.py`) — Universal Ctags subprocess, extracts symbols, inheritance, signatures. Fast, 100+ languages.
- **TreeSitterProvider** (`treesitter_provider.py`) — AST-level extraction of call edges, imports, assignments, annotations. 8 languages.
- **ProviderRegistry** (`provider.py`) — merges ctags + tree-sitter results into unified `StructuralAnalysis`.

**Language Extractors** (`extractors/`):
| Extractor | Extensions | Key Features |
|-----------|-----------|--------------|
| Python | `.py`, `.pyi` | f-strings, decorators, comprehensions |
| TypeScript | `.js`, `.jsx`, `.ts`, `.tsx` | JSX, optional chaining, template literals |
| Go | `.go` | goroutines, defer, multi-return |
| Java | `.java` | generics, wildcard imports, constructors |
| C# | `.cs` | `var` inference, LINQ, `using` directives |
| C | `.c`, `.h` | `#include` in `#ifdef`, pointer calls |
| Rust | `.rs` | nested `use` trees, macros, `impl` scope |
| C++ | `.cpp`, `.cc`, `.cxx`, `.hpp`, `.hxx` | templates, namespaces, `new` expressions |

All extractors implement `LanguageExtractor` base class with 4 methods: `extract_calls`, `extract_imports`, `extract_assignments`, `extract_annotations`.

**Structural Store** (`store.py`):
- `FileStore` writes snapshots to disk as flat text files:
  - `_index.txt` — symbols (ctags)
  - `_calls.txt` — call edges (tree-sitter)
  - `_imports.txt` — import relationships (tree-sitter)
  - `_inheritance.txt` — class hierarchy (ctags)
  - `_patterns.txt` — detected design patterns
  - `_stats.txt` — summary statistics
  - Per-file `.struct` files

**Diagram Generation** (`diagram_generator.py`, `diagram_builders.py`):
8 builders produce `DiagramModel` objects from store index files:

| Builder | Input | Output |
|---------|-------|--------|
| ClassDiagramBuilder | `_index.txt` + `_inheritance.txt` | Class relationships |
| InheritanceTreeBuilder | `_inheritance.txt` | Class hierarchy |
| DependencyGraphBuilder | `_imports.txt` | Module dependencies |
| ComponentDiagramBuilder | `_imports.txt` | Package groupings |
| PackageStructureBuilder | `_index.txt` | Directory layout |
| PatternMapBuilder | `_patterns.txt` | Design patterns |
| SequenceDiagramBuilder | `_calls.txt` | Call chains (control flow) |
| DataFlowBuilder | `_calls.txt` + `_imports.txt` + `_index.txt` | Data movement paths |

4 serialisers convert DiagramModels to output formats:
- **MermaidSerialiser** → `.mmd`
- **PlantUMLSerialiser** → `.puml`
- **GraphvizSerialiser** → `.dot`
- **MetamodelSerialiser** → `.json`

**LLM Formatter** (`formatter.py`):
Converts `StructuralAnalysis` to compact text for LLM prompts (replaces raw source). Includes Imports, Symbols, Inheritance, and Calls sections.

**API Endpoints** (`structural_endpoints.py`):
- `POST /structural/analyze` — run pipeline on a repo
- `POST /structural/{repo}/raw` — read store files
- `POST /structural/{repo}/diagrams/generate` — generate diagrams

**Configuration** (`config/treesitter_languages.yaml`):
Language → grammar mapping, file extensions, grammar packages. Adding a language requires only a YAML entry + extractor class.

### 7. Strategy Layer (`src/strategies/`)

Analysis strategies implementing the Strategy Pattern:
- `base_strategy.py` / `base_global_strategy.py` — abstract base
- `coding_style_strategy.py` — code style extraction
- `commenting_strategy.py` — documentation patterns
- `conventions_strategy.py` — naming/structural conventions
- `error_handling_strategy.py` — error handling patterns
- `validation_strategy.py` — validation patterns
- `tech_stack_synthesis_strategy.py` — tech stack synthesis with provider pattern
- `technical_doc_strategy.py` — technical document analysis
- `metamodel_strategy.py` — two-pass metamodel extraction

### 7. Chunking Layer (`src/chunking/`)

File content chunking for LLM context management:
- `generic_chunker.py` — default chunking
- `markdown_chunker.py` — Markdown-aware chunking
- `package_json_chunker.py` — package.json specific
- `requirements_chunker.py` — requirements.txt specific
- `chunker_factory.py` — factory pattern for chunker selection

## Haikai Profiles

```
haikai-profiles/
└── default/
    ├── commands/           # Skill commands
    │   ├── shape-spec/     # Requirements shaping
    │   ├── plan-product/   # Product planning
    │   ├── write-spec/     # Spec generation
    │   ├── create-tasks/   # Task generation
    │   └── implement-tasks/# Implementation
    ├── workflows/          # Multi-step workflows
    │   ├── specification/  # Spec workflows
    │   └── planning/       # Planning workflows
    ├── standards/          # Generated standards
    └── skills/             # Shared skill definitions
```

## Workspace Structure

```
api_workspace/
└── {company}/
    └── {project}/
        ├── haikai/
        │   ├── specs/{spec-name}/
        │   │   ├── planning/requirements.md
        │   │   ├── spec.md
        │   │   ├── tasks.md
        │   │   └── verification-report.md
        │   ├── standards/
        │   └── product/
        ├── .claude/
        │   ├── settings.json
        │   └── commands/     # Copied from haikai-profiles
        └── chat_logs/
            └── messages.jsonl
```

## Authentication Architecture

Two separate auth layers:

1. **API Layer** — `STANDARDS_API_KEY` in Bearer header protects all endpoints
2. **LLM Provider Layer** — API key or OAuth token for Anthropic/OpenAI
   - OAuth detection: `sk-ant-oat` prefix → Bearer auth via `auth_token`
   - Standard: `sk-ant-api` prefix → `X-Api-Key` header

See [AUTHENTICATION.md](AUTHENTICATION.md) for full details.

## Design Patterns

| Pattern | Where | Purpose |
|---------|-------|---------|
| Strategy | Analysis strategies | Pluggable file analysis |
| Provider | Tech stack synthesis | Decoupled data sources |
| Gateway | MetamodelGateway | External API encapsulation |
| Repository | TechnicalDocRepository | Document lifecycle |
| Orchestrator | StandardsOrchestrator, HaikaiOrchestrator | Workflow coordination |
| Factory | ChunkerFactory, create_chat_executor | Object creation |
| CLI Wrapper | ClaudeChatExecutor, ClaudeCLIExecutor | Subprocess management |
| Observer/SSE | Streaming endpoints | Real-time event delivery |

## Key Configuration

| Variable | Purpose |
|----------|---------|
| `STANDARDS_API_KEY` | API authentication |
| `ANTHROPIC_API_KEY` | Anthropic LLM (API key or OAuth token) |
| `OPENAI_API_KEY` | OpenAI LLM (fallback) |
| `LLM_PROVIDER` | Provider selection (anthropic/openai/azure) |
| `LLM_MODEL` | Model for strategy calls |
| `CHAT_MODEL` | Model for streaming chat |
| `API_WORKSPACE_DIR` | Base workspace directory |
