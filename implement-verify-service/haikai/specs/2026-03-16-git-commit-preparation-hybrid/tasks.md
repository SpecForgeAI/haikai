# Task Breakdown: Git Commit Preparation (Hybrid)

## Overview
Total Tasks: 4 task groups, 22 sub-tasks

## Task List

### GitManager Layer

#### Task Group 1: Deterministic `prepare_for_commit()` + `_run_git()` timeout
**Dependencies:** None

- [x] 1.0 Complete deterministic commit preparation in GitManager
  - [x] 1.1 Write 6 focused tests for `prepare_for_commit()` and timeout behavior
    - Test stale `index.lock` removal
    - Test `.gitignore` creation when missing (full critical pattern set)
    - Test `.gitignore` append when existing (under `# --- Added by Haikai ---` marker, no duplicates)
    - Test `git rm --cached` is called after `.gitignore` update
    - Test `commit_all()` calls `prepare_for_commit()` before staging
    - Test `_run_git()` respects custom timeout parameter
  - [x] 1.2 Add `timeout` parameter to `_run_git()`
    - Add `timeout: int = 120` keyword argument
    - Replace hardcoded `timeout=120` in `subprocess.run` with the parameter
    - All existing callers unchanged (default applies)
  - [x] 1.3 Implement `prepare_for_commit()` method
    - Remove stale `.git/index.lock` if present
    - Define `CRITICAL_GITIGNORE_PATTERNS` as a constant (dependencies, build, env, IDE, logs, locks with allowlist)
    - If `.gitignore` missing: create with full pattern template
    - If `.gitignore` exists: read it, find missing critical patterns, append under `# --- Added by Haikai ---` marker
    - Run `git rm -r --cached --ignore-unmatch .` (check=False) to unstage newly-ignored files
  - [x] 1.4 Update `commit_all()` to call `prepare_for_commit()`
    - Call `self.prepare_for_commit()` as first line
    - Pass larger timeout to `git add -A` via `_run_git()`
  - [x] 1.5 Ensure task group 1 tests pass
    - Run ONLY the 6 tests written in 1.1

**Acceptance Criteria:**
- `prepare_for_commit()` creates/updates `.gitignore` correctly
- Stale lock files are removed
- `commit_all()` no longer blindly stages everything — gitignore is enforced first
- `_run_git()` timeout is configurable
- All 6 tests pass

### Claude Skill Layer

#### Task Group 2: `/git-commit-preparation` skill file
**Dependencies:** None (can be built in parallel with Task Group 1)

- [x] 2.0 Complete the Claude skill markdown file
  - [x] 2.1 Create skill directory structure
    - Create `haikai-profiles/default/commands/git-commit-preparation/single-agent/git-commit-preparation.md`
  - [x] 2.2 Write the skill markdown with phased instructions
    - Phase 1: Framework detection — check for manifest files (`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Gemfile`), report detected frameworks
    - Phase 2: Framework-specific `.gitignore` — append patterns under `# --- Added by Haikai (framework-specific) ---` marker; never remove existing patterns
    - Phase 3: Artifact cleanup — scan for build/test output directories not in `.gitignore`, add them, run `git rm --cached`; never delete from disk
    - Phase 4: Secrets scan — grep tracked files for `sk-`, `sk-ant-`, `ghp_`, `AKIA`, `-----BEGIN.*PRIVATE KEY-----`; report file:line as warnings only; do not auto-ignore or auto-fix
    - Phase 5: Summary report — write findings to `haikai/specs/[this-spec]/implementation/git-commit-preparation.md`
  - [x] 2.3 Update `setup_claude_commands.sh` to deploy the skill
    - Add `git-commit-preparation` block following the existing pattern (check dir, call `setup_command`)

**Acceptance Criteria:**
- Skill file exists at the correct path
- Skill can be invoked manually via `claude /git-commit-preparation`
- `setup_claude_commands.sh` deploys it to `~/.claude/commands/`
- Skill instructions are clear, phased, and follow the established skill format

### Orchestrator Integration

#### Task Group 3: Add step 4 to orchestrator workflow
**Dependencies:** Task Group 1, Task Group 2

- [x] 3.0 Complete orchestrator integration
  - [x] 3.1 Write 4 focused tests for step 4 integration
    - Test `COMMANDS` list has 4 entries with correct step numbers
    - Test step 4 is executed after step 3 in `run_workflow()`
    - Test step 4 failure is non-fatal (workflow continues to `commit_all()`)
    - Test `BRAIN_COMMANDS` is unchanged (still 2 entries)
  - [x] 3.2 Update `COMMANDS` list in `HaikaiOrchestrator`
    - Add `{"step": 4, "command": "/git-commit-preparation", "description": "Prepare workspace for git commit", "non_fatal": True}`
  - [x] 3.3 Handle step 4 non-fatal failure in `run_workflow()`
    - Added `non_fatal` flag check in error handling loop
    - Non-fatal step failures don't stop the workflow or count toward overall failure
  - [x] 3.4 Ensure task group 3 tests pass
    - Run ONLY the 4 tests written in 3.1

**Acceptance Criteria:**
- Step 4 runs after implement-tasks in the full workflow
- Step 4 failure does not block commit/push/PR
- Brain-only workflow is unaffected
- All 4 tests pass

### Testing

#### Task Group 4: Integration test and verification
**Dependencies:** Task Groups 1-3

- [x] 4.0 Integration verification
  - [x] 4.1 All 6 Task Group 1 tests pass (deterministic layer)
  - [x] 4.2 All 4 Task Group 3 tests pass (orchestrator integration)
  - [x] 4.3 Run all feature-specific tests — 10 tests total, all passing

**Acceptance Criteria:**
- Both layers implemented and tested
- All 10 feature-specific tests pass
- Skill file deployed via setup script

## Execution Order

1. **Task Group 1** (GitManager deterministic layer) and **Task Group 2** (Claude skill file) — built in parallel
2. **Task Group 3** (Orchestrator integration) — depends on both 1 and 2
3. **Task Group 4** (Integration test) — depends on all previous groups
