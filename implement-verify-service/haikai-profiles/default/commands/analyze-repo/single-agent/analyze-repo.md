# Haikai Skill: /analyze-repo

**Author:** Agent
**Date:** 2026-04-05
**Version:** 1.0

## 1. Description

Runs structural analysis on a codebase and extracts endpoints + interactions.
Wraps the `standards-extractor analyze` and `standards-extractor extract-endpoints`
CLI commands into a guided workflow. The primary deliverable is a `REPORT.md`
written to the structural store snapshot directory.

## 2. Usage

Invoke via `/analyze-repo` in Claude CLI or through the API SSE endpoint.

### 2.1. Input

- **repo_path** (optional): Path to the repository to analyze. Defaults to current project directory.

### 2.2. Output

All output is persisted to `.specforge/structural/<repo>/<commit>/`:

- `_index.txt` — symbols (from ctags)
- `_calls.txt` — call graph (from tree-sitter)
- `_imports.txt` — import graph (from tree-sitter)
- `_inheritance.txt` — type hierarchies (from ctags)
- `_endpoints.txt` — detected endpoints (REST, WebSocket, MQ, gRPC, scheduled)
- `_interactions.txt` — detected data movements with provenance
- `_extraction_meta.yaml` — framework detection stats + extraction metadata
- **`REPORT.md`** — human-readable analysis summary (primary deliverable)

## 3. Workflow

Follow these steps IN SEQUENCE.

### Step 1: Resolve target repository

IF the user provided a repo path, use that path.

OTHERWISE, default to the current project directory (the working directory).

Check if `.specforge/structural/` already exists in the target directory:
- If it exists: Ask the user whether to reuse the existing store or re-analyze.
- If the user wants to reuse: skip to Step 3 using the latest snapshot.

### Step 2: Run structural analysis

Execute the following command:

```bash
standards-extractor analyze --project-dir <repo_path> --env-file .env
```

Note the snapshot path from the output. If the command fails:
- **ctags not found**: Tell the user to install universal-ctags:
  - Ubuntu/Debian: `sudo apt install universal-ctags`
  - macOS: `brew install universal-ctags`
  - Windows: `choco install universal-ctags`
- **No source files**: Tell the user no supported source files were found. Supported extensions: `.py, .java, .ts, .tsx, .js, .jsx, .go, .cs, .rs, .c, .cpp, .h, .hpp`

### Step 3: Extract endpoints and interactions

Execute the following command using the snapshot path from Step 2:

```bash
standards-extractor extract-endpoints --store-path <snapshot_path> --env-file .env
```

Endpoint and interaction discovery is LLM-driven (agentic):
- The LLM agent reads the structural store and source code to discover endpoints and interactions
- It uses its framework knowledge — no hard-coded patterns
- API keys (ANTHROPIC_API_KEY or OPENAI_API_KEY) must be configured for discovery to run
- If no API keys are configured, inform the user that endpoint/interaction discovery requires an LLM

### Step 4: Read results and write REPORT.md

**CRITICAL:** This is the primary deliverable. Read back the generated files and synthesize a summary report.

1. Read `_extraction_meta.yaml` for framework stats
2. Read `_endpoints.txt` and count by type (REST, MQ_CONSUMER, MQ_PRODUCER, WEBSOCKET, SCHEDULED, gRPC)
3. Read `_interactions.txt` and count by category (DATABASE, HTTP_SERVICE, MESSAGE_QUEUE, CACHE, FILE_SYSTEM) and by direction (READ, WRITE, PUBLISH, SUBSCRIBE, REQUEST_RESPONSE)
4. Read `_index.txt` — count total lines (excluding comments) for symbol count
5. Read `_calls.txt` — count total lines (excluding comments) for call edge count
6. Read `_meta.yaml` for repo name, commit, branch, timestamp, file count

Write the report to `<snapshot_path>/REPORT.md` using this exact structure:

```markdown
# Structural Analysis Report

**Repository:** <repo-name>
**Commit:** <commit-sha>
**Branch:** <branch>
**Analyzed:** <timestamp>
**Files:** <file-count>

## Frameworks Detected

| Framework | Confidence |
|-----------|-----------|
| <name> | <score> |

## Structural Summary

| Metric | Count |
|--------|-------|
| Symbols | <count> |
| Imports | <count> |
| Call edges | <count> |
| Inheritance | <count> |

## Endpoints

**Total: <count>**

| Type | Count | Examples |
|------|-------|---------|
| REST | <n> | GET /api/orders, POST /api/users |
| MQ_CONSUMER | <n> | order.created (Kafka) |

## Interactions

**Total: <count>**

| Category | Count | Direction |
|----------|-------|-----------|
| DATABASE | <n> | <x> READ, <y> WRITE |
| HTTP_SERVICE | <n> | <x> READ |

## Store Location

All raw data available at:
`<snapshot-path>/`
```

### Step 5: Confirm to user

Output a brief summary and point the user to the REPORT.md:

```
Analysis complete!

Snapshot: <snapshot-path>
Report: <snapshot-path>/REPORT.md

Summary: <N> endpoints, <M> interactions across <K> frameworks.
```

## 4. Error Handling

- **Missing ctags:** "ctags is required. Install via: apt install universal-ctags"
- **No source files:** "No supported source files found in <path>. Supported: .py, .java, .ts, .go, .cs, .rs, .c, .cpp"
- **No API keys configured:** Not an error. Inform user: "Running YAML-only classification (no LLM API keys configured). This covers most common frameworks."
