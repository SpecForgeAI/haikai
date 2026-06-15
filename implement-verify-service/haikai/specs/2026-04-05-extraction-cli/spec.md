# Specification: Extraction CLI Commands

## Summary

Add three CLI commands (`analyze`, `extract-endpoints`, `list-stores`) to `src/cli.py` that expose the structural analysis pipeline and endpoint/interaction extraction for standalone, scriptable use. Wraps existing pipeline code — no new analysis logic.

---

## Commands

### `standards-extractor analyze`

Runs the full structural pipeline (ctags → store → tree-sitter) on a codebase directory.

```bash
# Minimal
standards-extractor analyze --project-dir /path/to/repo

# With overrides
standards-extractor analyze \
  --project-dir /path/to/repo \
  --store-dir /tmp/analysis-output \
  --repo-name my-service \
  --no-treesitter
```

**What it does:**
1. Discover source files in `--project-dir` (Python, Java, TypeScript, Go, C#, Rust, C, C++)
2. Run ctags via `CtagsProvider.analyze_batch()`
3. Create `FileStore` pointing at `--store-dir` (or default `.specforge/structural/`)
4. Call `run_structural_pipeline()` — ctags snapshot → tree-sitter imports → tree-sitter calls
5. Print snapshot path + summary stats

**Output:**
```
Analyzing /path/to/repo...
  Files discovered: 142
  Running ctags...
  Running tree-sitter enrichment...
  Snapshot written: /path/to/repo/.specforge/structural/my-service/abc1234/

Summary:
  Symbols:     1,284
  Imports:       312
  Calls:         567
  Inheritance:    45
```

### `standards-extractor extract-endpoints`

Extracts endpoints and interactions from an existing structural store snapshot. Requires the snapshot to already exist (run `analyze` first).

```bash
# Extract both endpoints and interactions
standards-extractor extract-endpoints \
  --store-path /path/to/.specforge/structural/my-service/abc1234

# Endpoints only, JSON output
standards-extractor extract-endpoints \
  --store-path /path/to/snapshot \
  --endpoints-only \
  --format json

# YAML-only (skip LLM even if API keys are configured)
standards-extractor extract-endpoints \
  --store-path /path/to/snapshot \
  --no-llm
```

**What it does:**
1. Validate store path contains required files (`_index.txt`, `_calls.txt`)
2. Run `FrameworkDetector` to identify active frameworks from `_imports.txt`
3. Run per-language endpoint extractors on `_index.txt` + `_calls.txt`
4. Run per-language interaction extractors on `_calls.txt` + `_inheritance.txt`
5. Classify interactions — YAML patterns always run; LLM runs automatically if API keys configured (uses `_get_llm_client()` from `structural_endpoints.py`). `--no-llm` forces YAML-only.
6. Write `_endpoints.txt`, `_interactions.txt`, `_extraction_meta.yaml`, `_classification_meta.yaml` to store path
7. Print summary

**Output:**
```
Extracting from /path/to/snapshot...
  Frameworks detected: spring-web (0.95), spring-kafka (0.80)

  Endpoints:     14 (12 REST, 1 MQ_CONSUMER, 1 SCHEDULED)
  Interactions:  23 (8 DATABASE, 6 HTTP_SERVICE, 5 MESSAGE_QUEUE, 3 CACHE, 1 FILE_SYSTEM)

  Written: _endpoints.txt, _interactions.txt, _extraction_meta.yaml
```

### `standards-extractor list-stores`

Lists available structural store snapshots for a project.

```bash
standards-extractor list-stores --project-dir /path/to/repo
```

**Output:**
```
Snapshots for my-service:
  * abc1234  2026-04-05 10:30  main     142 files  (latest)
    def5678  2026-04-04 14:15  main     140 files
    ghi9012  2026-04-03 09:00  feature  138 files
```

---

## Implementation

### File Changes

**Modified:** `src/cli.py` — add three new commands to the existing click group

No new files. All analysis logic already exists in:
- `src/ast/pipeline.py` — `run_structural_pipeline()`
- `src/ast/ctags_provider.py` — `CtagsProvider`
- `src/ast/store.py` — `FileStore`, `get_git_info()`
- `src/ast/provider.py` — `ProviderRegistry`
- `src/ast/extractors/` — per-language endpoint/interaction extractors
- `src/ast/interaction_classifier.py` — LLM classification (from feature branch)

### File Discovery

The `analyze` command needs to discover source files. Use the same glob patterns already used by the pipeline:

```python
SUPPORTED_EXTENSIONS = {
    '.py', '.java', '.ts', '.tsx', '.js', '.jsx',
    '.go', '.cs', '.rs', '.c', '.cpp', '.h', '.hpp'
}

def discover_files(project_dir: Path, pattern: str = None) -> list[str]:
    """Find all source files in project directory."""
    files = []
    for ext in SUPPORTED_EXTENSIONS:
        files.extend(project_dir.rglob(f"*{ext}"))
    return [str(f) for f in files if not _is_excluded(f)]

def _is_excluded(path: Path) -> bool:
    """Skip common non-source directories."""
    excluded = {'node_modules', '.git', '__pycache__', 'venv', '.venv', 'dist', 'build'}
    return any(part in excluded for part in path.parts)
```

### Store Path Resolution

For `list-stores`, walk the `.specforge/structural/<repo>/` directory:

```python
def list_snapshots(store_base: Path, repo_name: str) -> list[dict]:
    """List snapshots for a repo, sorted newest first."""
    repo_dir = store_base / repo_name
    if not repo_dir.exists():
        return []
    
    snapshots = []
    latest = (repo_dir / "latest").resolve() if (repo_dir / "latest").exists() else None
    
    for snap_dir in sorted(repo_dir.iterdir(), reverse=True):
        if snap_dir.name == "latest" or not snap_dir.is_dir():
            continue
        meta_file = snap_dir / "_meta.yaml"
        # Parse meta for timestamp, branch, file count
        snapshots.append({
            "commit": snap_dir.name[:7],
            "path": snap_dir,
            "is_latest": snap_dir.resolve() == latest,
            # ... from _meta.yaml
        })
    return snapshots
```

### Extract-Endpoints Flow

```python
@cli.command("extract-endpoints")
@click.option('--store-path', required=True, type=click.Path(exists=True, path_type=Path))
@click.option('--no-llm', is_flag=True, help='Disable LLM classification (YAML patterns only)')
@click.option('--format', 'output_format', type=click.Choice(['tsv', 'json']), default='tsv')
@click.option('--endpoints-only', is_flag=True)
@click.option('--interactions-only', is_flag=True)
@click.option('--env-file', default='.env', type=click.Path(), help='Environment file path')
def extract_endpoints_cmd(store_path, no_llm, output_format, endpoints_only, interactions_only, env_file):
    # 1. Validate store path
    # 2. Load _index.txt, _calls.txt, _imports.txt, _inheritance.txt
    # 3. Detect frameworks
    # 4. Run extractors
    # 5. Classify: YAML always; LLM via _get_llm_client() unless --no-llm
    # 6. Write output files
    # 7. Print summary
```

---

## Key Design Decisions

1. **Thin wrappers only** — CLI commands call existing pipeline/extractor code. No business logic in the CLI layer.

2. **Store path is explicit** — `extract-endpoints` takes a store path, not a project dir. This keeps the commands composable: `analyze` creates the store, `extract-endpoints` reads it. No implicit coupling.

3. **Classification is always-on** — YAML patterns run unconditionally (zero cost). LLM classification runs automatically when API keys are configured in the environment (via `_get_llm_client()` pattern from `structural_endpoints.py`). `--no-llm` flag disables the LLM path for cost control or offline use.

4. **Progress output on stderr** — Progress messages go to stderr so stdout can be piped/captured for scripting. Summary stats always go to stdout.

5. **No JSON streaming** — JSON format writes a single object to the output files, not streaming. TSV remains the default for grep compatibility.

---

## Haikai Skill: `/analyze-repo`

An Haikai command skill that wraps the CLI commands into a conversational workflow, matching the pattern of existing skills like `/shape-spec`, `/write-spec`, and `/story-component-anchor`.

### Skill File

`haikai-profiles/default/commands/analyze-repo/single-agent/analyze-repo.md`

### Flow

```
User invokes /analyze-repo
  │
  ▼
Step 1: Resolve target
  - Ask user for repo path, or default to current project directory
  - Check if .specforge/structural/ already exists
  - If exists: ask user to reuse existing store or re-analyze
  │
  ▼
Step 2: Run structural analysis
  - Execute: standards-extractor analyze --project-dir <path>
  - Stream progress to user (files discovered, ctags, tree-sitter)
  - Report snapshot path + summary stats
  │
  ▼
Step 3: Extract endpoints & interactions (classification is automatic)
  - Execute: standards-extractor extract-endpoints --store-path <snapshot>
  - YAML classification always runs; LLM runs if API keys are configured
  - Present results: frameworks detected, endpoints by type, interactions by category
  │
  ▼
Step 4: Summary & next steps
  - Print final stats table
  - Suggest next actions: "review _endpoints.txt", "run on another repo", etc.
```

### Registration

Add to `src/chat/claude_chat_executor.py` commands list:

```python
("analyze-repo", "analyze-repo/single-agent/analyze-repo.md"),
```

### Skill Template

```markdown
# Haikai Skill: /analyze-repo

**Author:** Agent
**Date:** 2026-04-05
**Version:** 1.0

## 1. Description

Runs structural analysis on a codebase, extracts endpoints + interactions, and
writes a summary REPORT.md to the structural store. Wraps the `analyze` and
`extract-endpoints` CLI commands into a guided workflow.

## 2. Usage

Invoke via `/analyze-repo` or through the API SSE endpoint.

### 2.1. Input

- **repo_path** (optional): Path to the repository. Defaults to current project.

### 2.2. Output

All output is persisted to `.specforge/structural/<repo>/<commit>/`:

- `_index.txt` — symbols (from ctags)
- `_calls.txt` — call graph (from tree-sitter)
- `_imports.txt` — import graph (from tree-sitter)
- `_inheritance.txt` — type hierarchies (from ctags)
- `_endpoints.txt` — detected endpoints (REST, WebSocket, MQ, gRPC, scheduled)
- `_interactions.txt` — detected data movements with provenance
- `_extraction_meta.yaml` — framework detection stats + extraction metadata
- **`REPORT.md`** — human-readable analysis summary (the skill's primary deliverable)

## 3. Workflow

### Step 1: Resolve target
- Ask user for repo path, or default to current project directory
- Check if `.specforge/structural/` already exists
- If exists: ask user to reuse existing store or re-analyze

### Step 2: Run structural analysis
- Execute: `standards-extractor analyze --project-dir <path>`
- Note the snapshot path from output

### Step 3: Extract endpoints & interactions
- Execute: `standards-extractor extract-endpoints --store-path <snapshot>`
- Classification is automatic: YAML always, LLM if API keys configured
- If no API keys: inform user that YAML-only classification ran (this is fine for most cases)

### Step 4: Read results and write REPORT.md
**CRITICAL:** Read back the generated files and synthesize a summary report.

1. Read `_extraction_meta.yaml` for framework stats
2. Read `_endpoints.txt` and count by type (REST, MQ, WebSocket, gRPC, SCHEDULED)
3. Read `_interactions.txt` and count by category (DATABASE, HTTP_SERVICE, MESSAGE_QUEUE, CACHE, FILE_SYSTEM)
4. Read `_classification_meta.yaml` for provenance stats (YAML vs LLM counts)
5. Read `_index.txt` line count for total symbols
6. Read `_calls.txt` line count for total call edges

Write the report to `<snapshot>/REPORT.md` using this structure:

```
# Structural Analysis Report

**Repository:** <repo-name>
**Commit:** <commit-sha>
**Branch:** <branch>
**Analyzed:** <timestamp>
**Files:** <count>

## Frameworks Detected

| Framework | Confidence | Import Count |
|-----------|-----------|-------------|
| spring-web | 0.95 | 42 |
| spring-kafka | 0.80 | 5 |

## Structural Summary

| Metric | Count |
|--------|-------|
| Symbols | 1,284 |
| Imports | 312 |
| Call edges | 567 |
| Inheritance | 45 |

## Endpoints

**Total: 14**

| Type | Count | Examples |
|------|-------|---------|
| REST | 12 | GET /api/orders, POST /api/users |
| MQ_CONSUMER | 1 | order.created (Kafka) |
| SCHEDULED | 1 | */5 * * * * (ReportJob) |

## Interactions

**Total: 23**

| Category | Count | Direction |
|----------|-------|-----------|
| DATABASE | 8 | 5 READ, 3 WRITE |
| HTTP_SERVICE | 6 | 6 READ |
| MESSAGE_QUEUE | 5 | 3 PUBLISH, 2 SUBSCRIBE |
| CACHE | 3 | 2 READ, 1 WRITE |
| FILE_SYSTEM | 1 | 1 WRITE |

## Classification Provenance

| Source | Count |
|--------|-------|
| YAML patterns | 18 |
| LLM classified | 5 |

## Store Location

All raw data available at:
`<snapshot-path>/`
```

### Step 5: Confirm to user
Output the snapshot path and a brief summary. Point user to REPORT.md for details.

## 4. Error Handling

- Missing ctags: "ctags is required. Install via: apt install universal-ctags"
- No source files found: "No supported source files found in <path>. Supported: .py, .java, .ts, .go, .cs, .rs, .c, .cpp"
- No API keys configured: classification runs YAML-only (inform user, not an error)
```

---

## API Endpoint: `POST /api/v1/analyze-repo/stream`

SSE streaming endpoint that triggers the `/analyze-repo` skill via `ClaudeChatExecutor`. Follows the same pattern as `/api/v1/story-component-anchor/stream`.

### Request

```python
class AnalyzeRepoRequest(BaseModel):
    """Request model for analyze-repo endpoint."""
    company: str                          # Company name (workspace scoping)
    project: str                          # Project name (workspace scoping)
    repo_path: Optional[str] = None       # Path to repo. Default: project workspace dir
    no_llm: bool = False                  # Disable LLM classification (YAML-only)
    session_mode: str = "new"             # "new" = fresh analysis, "resume" = continue previous
```

### Example Request

```json
{
  "company": "acme",
  "project": "order-service",
  "repo_path": "/repos/order-service",
  "session_mode": "new"
}
```

### Execution Chain

```
POST /api/v1/analyze-repo/stream
  │
  ▼
api.py: analyze_repo_stream()
  - Load config, validate API key
  - Resolve workspace dir: API_WORKSPACE_DIR / company / project
  - Build prompt from request fields
  │
  ▼
ClaudeChatExecutor(company, project, workspace_dir, command_name="analyze-repo")
  - Setup: copies analyze-repo.md skill to .claude/commands/
  - Spawns Claude CLI subprocess with --session-id, --print, --output-format stream-json
  - Prefixes message with /analyze-repo (is_new_session=True)
  │
  ▼
Claude CLI (subprocess)
  - Reads /analyze-repo skill markdown
  - Runs bash: standards-extractor analyze --project-dir <repo_path>
  - Runs bash: standards-extractor extract-endpoints --store-path <snapshot> [--classify]
  - Streams JSON events to stdout
  │
  ▼
ClaudeChatExecutor.stream_message()
  - Parses newline-delimited JSON from Claude CLI stdout
  - Yields SSE events back to the HTTP response
  │
  ▼
Client receives SSE stream
```

### SSE Event Types

```
event: content
data: {"type": "content", "delta": "Analyzing /repos/order-service...\n  Files discovered: 142\n"}

event: content
data: {"type": "content", "delta": "Frameworks detected: spring-web (0.95), spring-kafka (0.80)\n"}

event: content
data: {"type": "content", "delta": "Endpoints: 14 (12 REST, 1 MQ_CONSUMER, 1 SCHEDULED)\n"}

event: file_modified
data: {"type": "file_modified", "path": ".specforge/structural/order-service/abc1234/_endpoints.txt"}

event: error
data: {"type": "error", "message": "ctags binary not found"}
```

### Prompt Construction

```python
ANALYZE_REPO_PROMPT = '''Analyze this repository and extract endpoints + interactions.

Repository path: {repo_path}
LLM classification: {llm_mode}'''

def build_prompt(request: AnalyzeRepoRequest, workspace_dir: Path) -> str:
    repo_path = request.repo_path or str(workspace_dir)
    llm_mode = "disabled (use --no-llm)" if request.no_llm else "automatic (LLM if API keys configured)"
    return ANALYZE_REPO_PROMPT.format(repo_path=repo_path, llm_mode=llm_mode)
```

### Implementation in `api.py`

```python
@app.post(
    "/api/v1/analyze-repo/stream",
    tags=["Skills"],
    summary="Analyze repo structure and extract endpoints/interactions (streaming SSE)",
    responses={401: {"description": "Invalid or missing API key"}, 500: {"description": "Server error"}},
    response_description="Server-Sent Events stream",
)
async def analyze_repo_stream(
    request: AnalyzeRepoRequest,
    authenticated: bool = Depends(verify_api_key)
):
    # Same pattern as story_component_anchor_stream:
    # 1. Load config, get API key
    # 2. Create ClaudeChatExecutor with command_name="analyze-repo"
    # 3. Build prompt from request
    # 4. Return StreamingResponse wrapping executor.stream_message()
```
