# Specification: Git Commit Preparation (Hybrid)

## Goal

Add a two-layer git commit preparation system to the Haikai workflow: a deterministic safety net in `GitManager.commit_all()` that always runs, and an intelligent Claude skill (`/git-commit-preparation`) that runs as orchestrator step 4 to detect frameworks, tailor `.gitignore`, clean artifacts from the index, and scan for secrets.

## User Stories

- As an operator running orchestrations on Docker, I want `commit_all()` to never stage `node_modules/`, build output, or secrets so that git operations don't timeout or leak credentials.
- As a developer using Claude Code CLI, I want to run `/git-commit-preparation` manually to get a framework-aware cleanup and secrets scan before I commit.

## Specific Requirements

**Deterministic layer: `prepare_for_commit()` in GitManager**
- New method on `GitManager` called as the first operation inside `commit_all()`, before `git add`
- Removes stale `.git/index.lock` if present
- Creates or appends to `.gitignore` with critical language-agnostic patterns (dependencies, build output, env files, IDE files, logs, lock files with allowlist)
- Appends under `# --- Added by Haikai ---` marker; never removes existing patterns; skips patterns already present
- Runs `git rm -r --cached --ignore-unmatch .` to unstage newly-ignored tracked files (index only, never disk)
- Makes no network calls and no LLM calls

**`_run_git()` timeout parameter**
- `_run_git()` accepts an optional `timeout` keyword argument (default 120s)
- `commit_all()` passes a larger timeout to `git add -A` to handle large workspaces
- All existing `_run_git()` callers continue to work without changes (default applies)

**Claude skill: `/git-commit-preparation`**
- Markdown skill file at `haikai-profiles/default/commands/git-commit-preparation/single-agent/git-commit-preparation.md`
- Detects project language/framework from manifest files (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`); multiple detected = union of patterns
- Writes framework-specific `.gitignore` patterns beyond the critical set, appended under `# --- Added by Haikai (framework-specific) ---` marker
- Identifies build/test artifact directories that exist but aren't gitignored; adds them to `.gitignore` and runs `git rm --cached` to unstage; never deletes files from disk
- Scans tracked files for secret patterns (`sk-`, `sk-ant-`, `ghp_`, `AKIA`, `-----BEGIN.*PRIVATE KEY-----`, high-entropy strings in env-like files); reports findings as warnings only — does not auto-ignore or auto-fix
- Writes a summary report to `haikai/specs/[this-spec]/implementation/git-commit-preparation.md` listing: frameworks detected, patterns added, files unstaged, secrets found

**Orchestrator integration**
- Add step 4 `"/git-commit-preparation"` to `HaikaiOrchestrator.COMMANDS` after implement-tasks
- Step 4 failure is non-fatal: log warning and proceed to `commit_all()`; the deterministic layer catches anything the skill missed
- `BRAIN_COMMANDS` is unchanged (write-spec + create-tasks only, no commit follows)
- `_execute_step_with_session()` already handles arbitrary steps — no structural change needed

**Skill deployment**
- New directory: `haikai-profiles/default/commands/git-commit-preparation/single-agent/`
- `setup_claude_commands.sh` updated to copy `git-commit-preparation.md` into Claude commands directory
- Skill is available standalone via `/git-commit-preparation` in Claude Code CLI

**SSE/API surface**
- Step 4 emits standard event types: `skill_invoked`, `content`, `file_modified`, `error`
- Secrets detection emits `{"type": "warning", "message": "Potential secret found in <file>:<line>"}` events
- `StepResult` for step 4 includes `output_paths` pointing to the summary report file

## Existing Code to Leverage

**`src/git/git_manager.py` — GitManager class**
- `commit_all()` at line 180 is the insertion point for `prepare_for_commit()` call
- `_run_git()` at line 319 needs the `timeout` parameter added (currently hardcoded to 120)
- All branch/commit/push methods already exist and work

**`src/haikai_orchestrator.py` — COMMANDS list**
- `COMMANDS` at line 42 is the list to extend with step 4
- `_execute_step_with_session()` at line 295 already handles any command via `chat_executor.stream_message()` — adding step 4 requires no changes to this method
- `BRAIN_COMMANDS` at line 481 stays as-is

**`scripts/docker/setup_claude_commands.sh` — skill deployment**
- Follows the established pattern: check directory exists, call `setup_command()` with source path
- Add a block for `git-commit-preparation` matching the existing pattern

**`haikai-profiles/default/commands/` — existing skill structure**
- Each skill is a directory containing `single-agent/<skill-name>.md`
- The skill markdown uses `{{workflows/...}}` includes for shared logic
- `/git-commit-preparation` follows this same structure

**`api_workspace/acme/backend/.claude/commands/implement-tasks.md` — skill template**
- Shows the established skill format: phased instructions, display confirmation, reference to spec/tasks files
- `/git-commit-preparation` skill follows this same conversational pattern

## Out of Scope

- Pre-commit hooks (linting, formatting)
- Git LFS for large files
- Commit message generation or validation
- Auto-fixing or auto-ignoring detected secrets (report only)
- Language-specific build tool invocation (`mvn clean`, `npm prune`, etc.)
- Deleting any files from the working tree
- Changes to the brain-only workflow
