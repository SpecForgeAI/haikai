# Requirements: Git Commit Preparation (Hybrid)

**Spec:** 2026-03-16-git-commit-preparation-hybrid
**Date:** 2026-03-16

---

## Overview

Add a hybrid git commit preparation step to the Haikai workflow that combines a deterministic safety net (`prepare_for_commit()` in GitManager) with an intelligent Claude skill (`/git-commit-preparation`) that reasons about the project and cleans up before committing.

The two layers are independent. The deterministic layer always runs inside `commit_all()` regardless of whether the skill ran. The skill adds intelligence on top but is never the only line of defense.

---

## Functional Requirements

### FR-1: Deterministic Layer — `prepare_for_commit()` in GitManager

Runs inside `commit_all()` as the first operation, before `git add -A`. Every commit path benefits — no opt-in required.

**FR-1.1** Remove stale `.git/index.lock` if present.

**FR-1.2** Ensure `.gitignore` exists with language-agnostic critical patterns:
- Dependencies: `node_modules/`, `vendor/`, `__pycache__/`, `.venv/`, `venv/`, `target/`, `.cargo/`
- Build output: `dist/`, `build/`, `.next/`, `out/`
- Environment/secrets: `.env`, `.env.*`, `!.env.example`, `*.pem`, `*.key`
- IDE/OS: `.DS_Store`, `Thumbs.db`, `.idea/`, `.vscode/`, `*.swp`
- Logs: `*.log`, `npm-debug.log*`
- Git locks: `*.lock` with allowlist for `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `Gemfile.lock`, `Cargo.lock`

**FR-1.3** If `.gitignore` exists, append missing critical patterns under a `# --- Added by Haikai ---` marker. Never remove existing patterns. Do not duplicate patterns already present.

**FR-1.4** Run `git rm -r --cached --ignore-unmatch .` after updating `.gitignore` to unstage newly-ignored tracked files. This only removes files from the git index, never from disk.

**FR-1.5** `_run_git()` accepts an optional `timeout` parameter (default 120s). `commit_all()` uses a larger timeout for `git add -A` to handle large workspaces.

### FR-2: Intelligent Layer — `/git-commit-preparation` Claude Skill

A standalone Claude skill at `.claude/commands/git-commit-preparation.md` that can be invoked by the orchestrator as step 4, or manually by a user via Claude Code CLI.

**FR-2.1 — Framework detection.** Detect project language/framework from manifest files:
- `package.json` → Node.js/JavaScript/TypeScript
- `requirements.txt` / `pyproject.toml` / `setup.py` → Python
- `Cargo.toml` → Rust
- `go.mod` → Go
- `pom.xml` / `build.gradle` → Java
- `Gemfile` → Ruby
- Multiple detected → union of all patterns

**FR-2.2 — Framework-specific .gitignore.** Write or update `.gitignore` with framework-specific patterns beyond the critical set. Examples:
- Node: `.turbo/`, `.cache/`, `coverage/`, `.nyc_output/`
- Python: `*.egg-info/`, `.pytest_cache/`, `.mypy_cache/`, `htmlcov/`
- Rust: `target/debug/`, `target/release/`
- Java: `*.class`, `*.jar`, `.gradle/`

Append under `# --- Added by Haikai (framework-specific) ---` marker. Never remove existing patterns.

**FR-2.3 — Artifact cleanup.** Identify test/build artifacts created during implementation and exclude them from the commit:
- Scan for build output directories that exist but aren't in `.gitignore`
- Add discovered artifacts to `.gitignore`
- Run `git rm --cached` to unstage them from the index
- Do NOT delete any files from disk
- Do NOT touch source code or user-authored files

**FR-2.4 — Secrets scanning (report only).** Scan tracked files for accidentally committed secrets:
- Pattern match for: `sk-`, `sk-ant-`, `ghp_`, `AKIA`, `-----BEGIN.*PRIVATE KEY-----`, high-entropy strings in `.env`-like files
- Report findings as warnings — do NOT auto-ignore, do NOT auto-fix
- The user/operator decides what to do with the reported secrets

**FR-2.5 — Summary report.** Produce a summary of what was prepared:
- Framework(s) detected
- Patterns added to `.gitignore`
- Files unstaged from git index
- Secrets detected (if any) — file paths and line numbers
- Write summary to `haikai/specs/[this-spec]/implementation/git-commit-preparation.md`

**FR-2.6 — Standalone availability.** The skill is usable outside the orchestrator — users can run `/git-commit-preparation` from Claude Code CLI directly at any time.

### FR-3: Orchestrator Integration

**FR-3.1** Add step 4 to the full orchestrator workflow: `/git-commit-preparation`, executed after `/implement-tasks` (step 3) and before `commit_all()`.

**FR-3.2** Updated `COMMANDS` list:
```python
COMMANDS = [
    {"step": 1, "command": "/write-spec", "description": "Write specification"},
    {"step": 2, "command": "/create-tasks", "description": "Create task list"},
    {"step": 3, "command": "/implement-tasks", "description": "Implement all tasks"},
    {"step": 4, "command": "/git-commit-preparation", "description": "Prepare workspace for git commit"},
]
```

**FR-3.3** Step 4 failure is non-fatal. If the skill fails, errors, or produces no output, log a warning and proceed to `commit_all()`. The deterministic layer in `commit_all()` is the safety net that catches anything the skill missed.

**FR-3.4** The brain-only workflow (`BRAIN_COMMANDS`) is unchanged — it only runs write-spec + create-tasks, no commit step follows.

### FR-4: SSE/API Surface

**FR-4.1** Step 4 emits the same SSE event types as other steps: `skill_invoked`, `content`, `file_modified`, `error`.

**FR-4.2** Secrets detection warnings are emitted as `{"type": "warning", "message": "Potential secret found in <file>:<line>"}` events so the client can surface them to the user.

**FR-4.3** `StepResult` for step 4 includes `output_paths` pointing to the git-commit-preparation summary file.

---

## Non-Functional Requirements

**NFR-1** `prepare_for_commit()` makes no network calls and no LLM calls. Pure filesystem and git operations.

**NFR-2** The skill must not delete files from disk. It only modifies `.gitignore` and the git index.

**NFR-3** The skill must be idempotent — running it twice produces the same result.

**NFR-4** Both layers must work on Linux (Docker container) and Windows (local dev).

---

## Out of Scope

- Pre-commit hooks (linting, formatting)
- Git LFS for large files
- Commit message generation/validation (separate concern)
- Auto-fixing or auto-ignoring detected secrets (report only)
- Language-specific build tool invocation (e.g., `mvn clean`, `npm prune`)
- Deleting files from the working tree
