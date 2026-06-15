# Git Commit Preparation

## Summary

Add a dynamic pre-commit preparation step to `GitManager` that cleans and
sanitizes the working tree before `git add` + `commit`. This runs
automatically as part of `commit_all()` — no manual intervention needed.

---

## Problem

The orchestrator calls `commit_all()` after `/implement-tasks` completes.
`commit_all()` blindly runs `git add -A`, which stages everything in the
working tree. This fails when:

- **`node_modules/`** exists (122MB, 437 packages → `git add` times out)
- **Large generated artifacts** exist (build output, `.next/`, `dist/`)
- **Secrets or env files** are present (`.env`, credentials)
- **IDE/OS files** are present (`.DS_Store`, `.idea/`, `.vscode/`)
- **Stale `index.lock`** exists from a previous failed git operation
- **Session/log files** that shouldn't be committed

This is not limited to `node_modules`. Any project that runs `npm install`,
`pip install`, `cargo build`, etc. during `/implement-tasks` will produce
large untracked directories that shouldn't be committed.

### Root cause from the 2026-03-15 incident

The notification system orchestration job ran `npm install socket.io` during
`/implement-tasks`, creating `node_modules/` (122MB). The workspace had no
`.gitignore`. `git add -A` tried to stage all 437 packages and timed out
after 120 seconds, leaving a stale `index.lock` that blocked any retry.

Previous jobs (auth system) succeeded because they didn't run
`npm install` — no `node_modules` existed yet.

---

## Design

### Where it fits in the workflow

```
Orchestration completes (write-spec → create-tasks → implement-tasks)
    │
    ▼
git_manager.create_feature_branch()
    │
    ▼
git_manager.prepare_for_commit()    ← NEW
    │
    ▼
git_manager.commit_all()
    │
    ▼
git_manager.push_branch()
    │
    ▼
git_manager.create_pull_request()
```

`prepare_for_commit()` is called inside `commit_all()` as the first
operation, before `git add -A`. This ensures every commit path benefits
from it — whether called from `tasks.py`, `api.py`, or future callers.

### What `prepare_for_commit()` does

**1. Remove stale lock files**

```python
index_lock = Path(self.project_dir) / ".git" / "index.lock"
if index_lock.exists():
    index_lock.unlink()
    logger.warning("Removed stale .git/index.lock")
```

**2. Ensure `.gitignore` exists with standard exclusions**

If no `.gitignore` exists, create one. If one exists, ensure critical
patterns are present. This is language/framework agnostic:

```gitignore
# Dependencies
node_modules/
vendor/
__pycache__/
*.pyc
.venv/
venv/
target/
.cargo/

# Build output
dist/
build/
.next/
out/

# Environment and secrets
.env
.env.*
!.env.example
*.pem
*.key

# IDE and OS
.DS_Store
Thumbs.db
.idea/
.vscode/
*.swp
*.swo

# Logs
*.log
npm-debug.log*

# Lock files (git)
*.lock
!package-lock.json
!yarn.lock
!pnpm-lock.yaml
!Gemfile.lock
!Cargo.lock
```

The approach:
- If `.gitignore` doesn't exist → create it with the full template
- If `.gitignore` exists → append any missing critical patterns under a
  clearly marked section (`# --- Added by Haikai ---`)
- Critical patterns (always enforced): `node_modules/`, `__pycache__/`,
  `.venv/`, `dist/`, `.env`, `.DS_Store`

**3. Run `git rm --cached` for already-tracked ignored files**

After updating `.gitignore`, any files matching the new patterns that
are already tracked need to be unstaged:

```python
self._run_git(
    ["git", "rm", "-r", "--cached", "--ignore-unmatch", "."],
    check=False
)
```

This is safe — it only removes files from the index, not from disk.

**4. Increase timeout for `git add`**

The default 120s timeout in `_run_git` is too tight for large repos.
`prepare_for_commit` should set a longer timeout for the add operation,
or `commit_all` should use a specific timeout for staging:

```python
self._run_git(["git", "add", "-A"], check=True, timeout=300)
```

### What `prepare_for_commit()` does NOT do

- Does not delete files from the working tree (only from git index)
- Does not modify project code
- Does not run any build or install commands
- Does not require Claude CLI or any AI interaction
- Does not depend on the project's language or framework

---

## Changes

### `src/git/git_manager.py`

**Add `prepare_for_commit()` method:**

```python
def prepare_for_commit(self):
    """Prepare working tree for a clean commit.

    1. Remove stale .git/index.lock
    2. Ensure .gitignore has standard exclusions
    3. Unstage any newly-ignored tracked files
    """
```

**Update `commit_all()` to call it:**

```python
def commit_all(self, message: str) -> str:
    self.prepare_for_commit()
    self._run_git(["git", "add", "-A"], check=True, timeout=300)
    ...
```

**Update `_run_git()` to accept optional timeout:**

```python
def _run_git(
    self, cmd: list, check: bool = True, timeout: int = 120
) -> subprocess.CompletedProcess:
```

### `src/job_queue/tasks.py`

No changes needed — `commit_all()` handles preparation internally.

---

## .gitignore strategy

The `.gitignore` template is designed to be:

- **Language-agnostic** — covers Node, Python, Rust, Go, Java, Ruby
- **Additive** — never removes patterns the user already has
- **Marked** — additions are under `# --- Added by Haikai ---` so users
  know what was auto-added
- **Safe** — preserves lock files that should be committed
  (`package-lock.json`, `yarn.lock`, etc.)

### Detection-based approach (future enhancement)

A future version could detect the project's language from existing files
(`package.json`, `requirements.txt`, `Cargo.toml`, `go.mod`) and apply
only the relevant patterns. For now, the universal template is sufficient
since unused patterns have no effect.

---

## Testing

### Unit tests

```python
def test_prepare_removes_stale_lock(tmp_path):
    """Stale index.lock is removed."""

def test_prepare_creates_gitignore_when_missing(tmp_path):
    """Creates .gitignore with standard patterns when none exists."""

def test_prepare_appends_to_existing_gitignore(tmp_path):
    """Appends missing critical patterns to existing .gitignore."""

def test_prepare_does_not_duplicate_patterns(tmp_path):
    """Running prepare twice doesn't duplicate .gitignore entries."""

def test_commit_all_calls_prepare(tmp_path):
    """commit_all() calls prepare_for_commit() before staging."""

def test_commit_all_with_node_modules(tmp_path):
    """commit_all succeeds when node_modules exists (ignored)."""
```

### Integration test

```bash
# 1. Create a workspace with node_modules
docker exec standards-extractor-api bash -c '
  cd /app/workspace/testco/testproj &&
  mkdir -p node_modules/fake-package &&
  echo "{}" > node_modules/fake-package/package.json
'

# 2. Run commit_all — should succeed
# (previously would timeout)

# 3. Verify node_modules was not committed
docker exec standards-extractor-api bash -c '
  cd /app/workspace/testco/testproj &&
  git log --stat -1 | grep node_modules && echo "FAIL" || echo "PASS"
'
```

---

## Files to modify

| File                       | Change                                               |
|----------------------------|------------------------------------------------------|
| `src/git/git_manager.py`   | Add `prepare_for_commit()`, update `commit_all()`,   |
|                            | add `timeout` param to `_run_git()`                  |

---

## Out of scope

- Language-specific `.gitignore` detection (future enhancement)
- Pre-commit hooks (linting, formatting)
- Git LFS for large files
- Commit message validation
