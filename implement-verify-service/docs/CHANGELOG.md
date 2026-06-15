# CHANGELOG

All notable changes to the Standards Extractor project will be documented in this file.

## [Unreleased]

### Added — Multi-Repo Product Support (Polyrepo) (2026-05-26)

Spec: `haikai/specs/2026-05-25-polyrepo-analysis/`
Branch: `spec/multi-repo-product-orchestration`
User docs: `docs/POLYREPO.md`

Lands the data layer, CRUD surface, and orchestrator session-mount
changes for treating a product as N≥1 repositories. The system never
branches on N — mono is the degenerate case of poly.

- **KV-map data model** — `ProjectInitRequest.repos: Dict[str, str]`
  (folder → URL) with folder-regex + URL-uniqueness validators. Legacy
  `repo_url: str` body still accepted and auto-promoted.
- **`coordination.yaml`** — persisted at the product workspace root.
  Atomic writes (temp-file + fsync + rename); deterministic key ordering
  for diff-stability.
- **`POST /projects/init`** — loops the KV map, instantiates N
  `GitManager` objects (class itself unchanged), atomic rollback on any
  per-repo clone failure.
- **CRUD on `/projects/{c}/{p}/repos`** — `GET`, `POST` (add + clone),
  `PUT` (update URL + re-clone the affected sub-directory; folder alias
  is not renamable), `DELETE` (rejects last-entry removal).
- **Orchestrator `--add-dir` per repo** — Claude chat session mounts
  one `--add-dir` per folder in `coordination.yaml`, in addition to the
  default project_dir + haikai-profiles mounts. One mount for mono,
  N for poly. The mapping is snapshotted at session-build time so
  CRUD mutations during a run apply to the next run.
- **Convention enforcement** —
  `tests/test_polyrepo_no_mode_branches.py` greps `src/` for forbidden
  mono/poly branching patterns.
- **125 tests passing** across the polyrepo + legacy git surface.

What is *not* in this release:
- write-spec NN attribution (Phase 5), create-tasks `[@repo:]`
  annotation (Phase 6), implement-tasks fan-out (Phase 7) — all paused
  on three open implementation-detail decisions; see
  `haikai/specs/2026-05-25-polyrepo-analysis/planning/open-decisions.md`.
- Auto-migration of legacy single-repo projects — manual procedure
  documented in `docs/POLYREPO.md`; an explicit endpoint is a follow-up.

### Added — Structural Analysis Pipeline (2026-03-29 → 2026-03-31)
- **Tree-sitter Call Graph Integration**: Two-tier code intelligence — ctags (symbols) + tree-sitter (call edges, imports, assignments)
- **8 Language Extractors**: Python, TypeScript, Go, Java, C#, C, Rust, C++ — covering 17 file extensions
- **Structural Store**: Flat-file snapshots (`_index.txt`, `_calls.txt`, `_imports.txt`, `_inheritance.txt`, `_patterns.txt`, `_stats.txt`)
- **8 Diagram Builders**: class, inheritance, dependency, component, package, pattern-map, sequence, data-flow
- **4 Serialisers**: Mermaid (`.mmd`), PlantUML (`.puml`), Graphviz (`.dot`), Metamodel (`.json`)
- **LLM Formatter**: Compact structural output for LLM prompts — symbols + imports + inheritance + call edges (replaces raw source)
- **Structural API Endpoints**: `POST /structural/analyze`, `POST /structural/{repo}/raw`, `POST /structural/{repo}/diagrams/generate`
- **Config-driven language support**: `config/treesitter_languages.yaml` — add a language with YAML entry + extractor class
- **DataFlowBuilder**: Classifies nodes as external/process/store/output, traces data movement paths
- **Test Coverage Skill**: `src/skills/test_coverage/` — discovers tests, classifies types, maps coverage, generates reports

### Added
- **Conversational Chat API (v3.3)**: Streaming SSE endpoints for interactive conversations
  - `POST /api/v1/shape-spec/stream` — Shape specification through dialogue
  - `POST /api/v1/plan-product/stream` — Product planning through dialogue
  - `POST /api/v1/story-component-anchor/stream` — Generate Storybook stories from component contracts
  - History and clear endpoints for shape-spec and plan-product sessions
  - New SSE event types: `questions`, `folder` for orchestrated workflows
  - Automatic skill prefix for new sessions
- **Async Job Queue**: Background job processing for long-running orchestrations
  - `POST /api/v1/jobs/orchestrations` — Submit async orchestration jobs
  - `GET /api/v1/jobs/{job_id}` — Poll job status and results
  - `GET /api/v1/jobs` — List jobs with filtering
  - `DELETE /api/v1/jobs/{job_id}` — Cancel jobs
  - SQLite-based storage with background worker process
- **`/ask-questions` Skill**: Structured question extraction for Planner-Implementation LLM orchestration

### Changed
- **Orchestration Workflow Simplification**: Removed `/shape-spec` (step 0) from orchestration workflow
  - Orchestration now starts directly with `/write-spec` (step 1)
  - Spec folders with `planning/requirements.md` must be created by upstream process before orchestration
  - Removed `_verify_product_files()` method - no longer checks for product planning files
  - Removed `_execute_shape_spec()` method and `_parse_spec_name_from_output()` method
  - Simplified workflow: write-spec → create-tasks → implement-tasks
  - Maintains all path handling, logging, and CLI configuration improvements from previous releases

## [2.5.0] - 2026-01-11

### Breaking Changes
- **API Endpoint Alignment**: All endpoints now use consistent `company/project` hierarchy
  - Parameter renames: `global_dir` → `company`, `project_dir` → `project`, `spec_name` → `spec_id`
  - Metamodel endpoint: `GET /api/v1/metamodels/{company}/{project}/{metamodel_id}`
  - Write spec endpoint: `POST /api/v1/specs/{company}/{project}/write-spec` (renamed from `/write`)
  - Orchestrate endpoint: `POST /api/v1/orchestrations` with `spec_ids` array (removed `/api/v1/haikai/orchestrate`)
  - Directory structure: All resources now under `/app/api_workspace/{company}/{project}/`

### Changed
- **Default LLM Model**: Updated to `claude-haiku-4-5-20251001`
  - Updated in all config files (.env, .env.example, .env.test, .env.docker)
  - Updated defaults in run.py, api.py, cli.py

### Updated
- **Documentation**: Updated API_DESIGN.md, HAIKAI_CRUD_API.md, README.md with breaking changes

## [2.4.3] - 2025-01-03

### Fixed
- **ChatOpenAI Timeout Parameter**: Changed `request_timeout` to `timeout` for OpenAI provider (critical bug)
- Timeout configuration now actually works for OpenAI API calls

## [2.4.0] - 2025-01-03

### Added
- **Intelligent File Chunking System**: Automatically splits large files (>3,000 tokens) into manageable chunks
  - `src/chunking/` module with 7 classes (650 lines)
  - PackageJsonChunker, RequirementsChunker, MarkdownChunker, GenericChunker
  - Smart result merging with deduplication
  - Prevents LLM timeouts on large files

### Changed
- Chunk sizes optimized for GPT-4o-mini and other fast models

## [2.3.6] - 2025-01-03

### Changed
- **Removed max_tokens Limits**: All LLM calls now have unlimited output
  - Removed from `file_analyzer.py`, `content_extractor.py`, `standards_synthesizer.py`
  - Allows complete extraction of large dependency lists

## [2.3.5] - 2025-01-03

### Added
- **Enhanced Error Logging**: Try/except blocks around all LLM calls
  - Logs file path, message count, character count, exception details
  - Better debugging of LLM failures

### Fixed
- Temperature variable bug in `llm_client.py` (lines 250, 281)

## [2.3.3] - 2025-01-03

### Added
- **GitHub URL Normalization**: Converts `github.com/blob/` URLs to `raw.githubusercontent.com`
  - Downloads raw markdown instead of HTML pages
  - Method: `_normalize_github_url()` in `technical_doc_repository.py`

### Changed
- **Content Truncation Limit**: Increased from 50,000 to 200,000 characters
  - Technical documents no longer truncated at 19%

## [2.3.2] - 2025-01-03

### Added
- **Document Parsing Dependencies**: `pymupdf`, `python-docx`, `beautifulsoup4`

### Fixed
- **Synthesis Data Loss**: Updated system prompt to preserve ALL extracted data (0% loss, was 65%)
- **Synthesis Hallucinations**: Prevents using template examples as actual values
- **Missing Logger Import**: Added to `file_analyzer.py`
- **Wrong get_metadata() Signature**: Fixed in `technical_doc_strategy.py`

### Changed
- **Unified Download Paths**: Repository files use same URL-based structure as technical docs
- **Simplified run.py**: Removed confusing `use_technical_docs` flag, added `run_simple.py`

## [2.0.0] - 2025-12-31

### Major Refactoring - DRY Principles

#### Added
- **Centralized Categories** (`src/categories.py`)
  - Single source of truth for all file categories
  - Utility methods for category operations
  - Type-safe category constants

- **Centralized Dependency Definitions** (`config/dependency_files.yaml`)
  - Comprehensive dependency file type definitions
  - Ecosystem and purpose metadata
  - Lock file support

- **Programmatic Interface** (`run.py`)
  - IDE-friendly execution without CLI
  - Example configurations
  - Programmatic API for integration

#### Changed
- **Unified Analysis Methods**
  - Merged `analyze_batch()` and `analyze_dependency_batch()` into single method
  - Category-driven behavior selection
  - Reduced code duplication

- **Simplified File Scanning**
  - Remote scanning now reuses local scanning logic
  - Downloads to temp directory first
  - Consistent behavior across sources

- **Removed Temperature Parameter**
  - Removed from all LLM calls
  - Using model defaults for deterministic results
  - Simpler API

#### Updated
- `src/file_scanner.py` - Uses centralized categories and dependency definitions
- `src/file_analyzer.py` - Unified analysis method
- `src/standards_orchestrator.py` - Simplified remote scanning
- `src/report_generator.py` - Uses centralized categories
- `src/llm_client.py` - Removed temperature parameter
- `src/standards_synthesizer.py` - Removed temperature parameter

#### Benefits
- 8% code reduction (~200 lines)
- 87% reduction in hardcoded values (15 → 2)
- Significantly improved maintainability
- Easier to extend with new categories/file types
- Better separation of concerns

#### Migration Guide
No breaking changes! External API remains the same. Internal changes only affect those who customized the code.

---

## [1.3.0] - 2025-12-23

### Changed - LangChain Integration (Hybrid Approach)
- **BREAKING**: Replaced custom LLM client factory with LangChain-based hybrid wrapper
- LLMClient now wraps LangChain's chat models internally while maintaining the same simple API
- Removed custom factory classes (LLMClientFactory, OpenAIClient, AnthropicClient, AzureOpenAIClient)

### Added
- **Google Gemini Support**: Added support for Google's Gemini models via LangChain
- **60+ LLM Providers**: Access to all LangChain-supported providers (Together AI, Cohere, Replicate, local models, etc.)
- **Battle-Tested Retry Logic**: Exponential backoff with jitter from LangChain
- **Accurate Token Counting**: Uses LangChain's tokenizers for precise token counts
- **Foundation for Streaming**: Infrastructure ready for streaming support in future releases
- **Foundation for Caching**: Infrastructure ready for caching support in future releases

### Improved
- **Error Handling**: Provider-specific error handling and recovery
- **Rate Limit Handling**: Optimized rate limit detection and backoff per provider
- **Maintenance**: Community maintains LangChain, reducing our maintenance burden
- **Code Quality**: Cleaner, more maintainable codebase with single LLMClient class

### Dependencies
- **Added**: `langchain-core`, `langchain-openai`, `langchain-anthropic`, `langchain-google-genai`
- **Removed**: Direct usage of `openai` and `anthropic` SDKs (now via LangChain)
- **Size**: Minimal LangChain installation (~50MB vs 200MB+ for full LangChain)

### Migration Guide
```python
# Old (v1.2.0 - Deprecated)
from src.llm_client_factory import LLMClientFactory
client = LLMClientFactory.create('openai', 'gpt-4', api_key='sk-...')

# New (v1.3.0 - Current)
from src.llm_client import LLMClient
client = LLMClient('openai', 'gpt-4', api_key='sk-...')
```

**Note**: API is backward compatible - same parameters and methods work as before.

### Documentation
- Added `LANGCHAIN_INTEGRATION.md` with comprehensive guide
- Updated examples to show new provider support
- Added troubleshooting section for common issues

---

## [1.1.2] - 2024-12-22

### Fixed
- **Trailing Slash Handling**: URLs with trailing slashes now work correctly (e.g., `.../Gateway/` and `.../Gateway` both work)
- Path filtering now properly handles all URL formats regardless of trailing slashes

### Technical Details
Added `path.rstrip('/')` in `parse_repo_url()` for all platforms (GitHub, GitLab, Bitbucket) to normalize paths before filtering.

---

## [1.1.1] - 2024-12-22

### Fixed
- **Monorepo Support**: Removed `packages/` from directory exclusions to support monorepo structures like React, Lerna, and Nx
- **JavaScript/TypeScript Categorization**: Added `.js` and `.ts` extensions to frontend category
- **Source Directory Recognition**: Added `/src/` to frontend directory patterns for better categorization

### Impact
These fixes ensure that:
- Files in `packages/react/src/` and similar monorepo structures are no longer excluded
- Plain `.js` and `.ts` files are properly categorized as frontend code
- Common source directory structures are recognized correctly

---

## [1.1.0] - 2024-12-22

### Added
- **Smart URL Detection**: Application now intelligently detects and handles different URL types
  - Single file URLs (`/blob/branch/path/to/file`)
  - Directory URLs (`/tree/branch/path/to/directory`)
  - Repository URLs (base URL)
- **Path-Based Filtering**: Automatically filters files based on the path specified in the URL
- **Anonymous GitHub Access**: Public repositories can now be accessed without requiring a GitHub token
- **Auto-Branch Detection**: Automatically detects and uses the default branch when not specified
- **README_URL_FORMATS.md**: Comprehensive guide for all supported URL formats

### Fixed
- **YAML Syntax Error**: Fixed wildcard patterns in `config/exclusions.yaml` that caused parsing errors
- **GitHub Rate Limiting**: Single file and directory URLs no longer trigger rate limits
- **URL Parsing**: Improved regex patterns to correctly extract branch, path, and file information from URLs
- **Branch Detection**: Now properly handles repositories with `master` as default branch instead of `main`

### Changed
- **Repository Fetcher**: Complete rewrite of `parse_repo_url()` to return 6 values instead of 4:
  - Added `path` parameter (path within repository)
  - Added `is_file` parameter (boolean indicating if URL points to a single file)
- **File Listing**: `list_repository_files()` now returns a single file when URL points to a file
- **Download Method**: Added `download_file()` method to handle single file downloads

### Technical Details

#### URL Parsing Enhancement
The application now parses URLs to extract:
1. Platform (github/gitlab/bitbucket)
2. Owner
3. Repository name
4. Branch (optional, auto-detected if not specified)
5. Path within repository (optional)
6. Whether it's a single file or directory

#### Supported URL Patterns

**GitHub:**
- Single file: `github.com/{owner}/{repo}/blob/{branch}/{path}`
- Directory: `github.com/{owner}/{repo}/tree/{branch}/{path}`
- Repository: `github.com/{owner}/{repo}`

**GitLab:**
- Single file: `gitlab.com/{owner}/{repo}/-/blob/{branch}/{path}`
- Directory: `gitlab.com/{owner}/{repo}/-/tree/{branch}/{path}`
- Repository: `gitlab.com/{owner}/{repo}`

**Bitbucket:**
- Single file/directory: `bitbucket.org/{owner}/{repo}/src/{branch}/{path}`
- Repository: `bitbucket.org/{owner}/{repo}`

### Testing
- ✅ Single file analysis tested and working
- ✅ Directory filtering tested and working
- ✅ Full repository analysis tested and working
- ✅ Anonymous GitHub access tested and working
- ✅ Branch auto-detection tested and working
- ✅ Monorepo structures tested and working
- ✅ JavaScript/TypeScript files tested and working

### Documentation Updates
- Updated README.md with new URL format examples
- Added README_URL_FORMATS.md with comprehensive URL guide
- Updated examples to show single file and directory analysis

---

## [1.0.0] - 2024-12-22

### Initial Release
- Multi-source support (local directories and remote repositories)
- Intelligent file categorization (backend, frontend, testing, global)
- AI-powered analysis using multiple LLM providers (OpenAI, Anthropic, Azure)
- Two-stage processing (individual analysis → synthesis)
- Template-based standard generation
- Comprehensive reporting (Markdown and JSON)
- GitHub, GitLab, and Bitbucket support
- Configurable exclusion patterns
- Dependency file extraction for tech stack
- CLI interface with progress indicators
