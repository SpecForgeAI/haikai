# Review Playbook — Phase A.1–A.5 (api/__init__.py modularization)

Five PRs landed on `main` between commits **`a14ca58`** (A.1) and
**`d6b1b14`** (A.5). Each one is a pure structural extraction (no
intended behaviour change). This playbook tells you what to run and
what to look for to verify that claim.

**Minimum-viable review:** §2 + §3 + §5 + §7 — about 20 minutes if
everything checks out.

---

## 1. Per-PR static review on GitHub

Open each merge commit at:

```
https://github.com/SpecForgeAI/standards-extractor/commits/main
```

PRs to review (in landing order):

| Phase | Merge SHA  | What moved                                                 |
|-------|------------|------------------------------------------------------------|
| A.1   | `a14ca58`  | `factories.py` — `create_chat_executor`, `_build_claude_chat_executor` |
| A.2   | `c062d19`  | `gates.py` — `require_credentials_or_503`                  |
| A.3   | `2e4ca6a`  | `recovery.py` — `_recover_interrupted_jobs` + 2 helpers    |
| A.4   | `dcfa69a`  | `packages.py` — 2 implementation-package endpoints (APIRouter) |
| A.5   | `d6b1b14`  | `routes/orchestration.py` — 5 orchestration endpoints (APIRouter) |

**What to scan in each diff:**

- **Net LOC delta of `src/api/__init__.py` ≈ size of the moved
  block.** Mismatch = something was rewritten, not just moved. (See
  §6 for what "rewritten" red-flags look like.)
- **The new file's top-level imports** — anything not strictly needed
  by the moved code is scope creep.
- **The new file's lazy imports** (inside function bodies) — each one
  is a load-cycle break that needs a one-line justification.

**Quick LOC check locally:**

```bash
git log --oneline a14ca58^..d6b1b14 -- src/api/__init__.py
for sha in a14ca58 c062d19 2e4ca6a dcfa69a d6b1b14; do
    echo "=== $sha ==="
    git show $sha --stat | grep -E '(src/api|tests/)' | head -5
done
```

---

## 2. Behavioural equivalence — diff the OpenAPI schema

The strongest cheap check that no caller-visible behaviour changed:

```bash
# Pre-refactor baseline (the parent of A.1's merge commit, a14ca58^):
git stash push --include-untracked
git checkout 19e9030
.venv/Scripts/python.exe -c "from src.api import app; import json; print(json.dumps(app.openapi(), indent=2, sort_keys=True))" > ./openapi-before.json

# After all 5 phases:
git checkout main
.venv/Scripts/python.exe -c "from src.api import app; import json; print(json.dumps(app.openapi(), indent=2, sort_keys=True))" > ./openapi-after.json
git stash pop

# Diff:
diff ./openapi-before.json ./openapi-after.json
```

**Expected delta: zero.** Any line difference is a regression — paths,
status codes, response schemas, tags, descriptions should all be
identical. (Operation IDs MIGHT shift if FastAPI derives them from
function names that moved — that's cosmetic but worth confirming.)

---

## 3. Route-registration audit

The full route table should be identical before/after:

```bash
.venv/Scripts/python.exe -c "
from src.api import app
for r in sorted(app.routes, key=lambda x: (x.path, ','.join(sorted(getattr(x, 'methods', set()))))):
    if hasattr(r, 'methods'):
        methods = ','.join(sorted(r.methods))
        print(f'{methods:20s} {r.path}')
"
```

Run on `main` and on `19e9030` (the parent of A.1's merge, `a14ca58^`). Diff — should be line-for-line identical.

---

## 4. Import-graph audit — cycles + lazy-import justification

**All lazy imports inside function bodies:**

```bash
grep -rnE "^\s{4,}from \." src/api/ src/backend_registry.py
```

For each hit, ask: *"If this was a top-level import, what would
cycle?"* If you can't answer, the lazy import is unnecessary
indirection and can be lifted later.

Documented load-cycle breaks (expected):
- `recovery.py` lazy-imports `load_env_config`, `_safe_project_dir`,
  `API_WORKSPACE_DIR`, `job_queue`, `_run_job_in_background` from
  `src.api` — all module-level state defined in `api/__init__.py`.
- `packages.py` lazy-imports `_safe_project_dir`.
- `routes/orchestration.py` lazy-imports `API_WORKSPACE_DIR`,
  `ORCHESTRATION_LOG_DIR`, `executor_pool`, `_safe_orchestration_id`,
  `_require_git_manager`.
- `backend_registry.py` lazy-imports `_build_claude_chat_executor`
  from `src.api` (via the `_build_claude_chat_executor_shim`).
- `gates.py` lazy-imports `load_env_config`.

Each is the same pattern: a peer module would create a load cycle if
the import were at module top. Lazy `from .. import X` reads the api
namespace at call time, which also keeps `@patch("src.api.X")` mocks
working (see §5).

**Programmatic cycle check:**

```bash
.venv/Scripts/python.exe -c "
import src.api
import src.api.factories
import src.api.gates
import src.api.recovery
import src.api.packages
import src.api.routes.orchestration
import src.backend_registry
print('All modules imported cleanly')
"
```

If any of these fails with `ImportError: partially initialized module`,
there's a cycle to fix.

---

## 5. Test-patch ecology audit

Test mocks couple to the production module structure. Each extraction
forces test patches to retarget OR rely on call-time re-resolution.
Verify no stale targets:

**Patches pointing at `src.api.X` for symbols that moved out:**

```bash
for sym in create_chat_executor _build_claude_chat_executor _credentials_satisfied _executor_backend BackendDescriptor BACKEND_REGISTRY _recover_interrupted_jobs _determine_last_completed_step _dispatch_recovered_job require_credentials_or_503; do
    echo "=== $sym ==="
    grep -rn "@patch.*src\.api\.${sym}" tests/ || echo "  (none)"
done
```

For each hit: check whether `src.api.X` still exists as a re-export.
Reachable + works = fine. Stale (no re-export) = silently broken
patch.

**Patches pointing at new homes — confirm they exist there:**

```bash
grep -rn "src\.api\.factories\." tests/ | head
grep -rn "src\.api\.gates\." tests/ | head
grep -rn "src\.api\.recovery\." tests/ | head
grep -rn "src\.api\.packages\." tests/ | head
grep -rn "src\.api\.routes\.orchestration\." tests/ | head
```

**Sharper sanity test** (catches `unittest.mock` patching non-existent
attributes):

```bash
.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/manual --ignore=tests/integration -W error::DeprecationWarning -W error::UserWarning 2>&1 | tail -5
```

### The patch-target rule (learned the hard way in A.5)

| Import style in extracted module                                | Patch target that works                                |
|-----------------------------------------------------------------|--------------------------------------------------------|
| Top-level `from src.git.config import load_git_config`          | `@patch("src.api.routes.orchestration.load_git_config")` — points at the new home |
| Lazy `from .. import _require_git_manager` inside function body | `@patch("src.api._require_git_manager")` — call-time resolution keeps it working |

Class-scoped retargeting is too coarse — `TestV2Endpoints` had a mix
of tests hitting moved routes and tests hitting routes that hadn't
moved. The fix that worked: per-test scoping (check the test body for
the moved URL before retargeting its decorator).

---

## 6. Per-PR red-flag scan in the diffs

For each merge commit, look in the new module's diff for:

- **Logic edits inside a moved block.** A pure extract should be a
  clean `git diff` of "removed from A, added to B" — any third change
  is suspicious.
- **`# TODO`, `# HACK`, `# FIXME`** added during the move. Each one
  is a deferred problem.
- **Caught-and-swallowed exceptions** added during refactor. Often
  signals the move surfaced something the author didn't want to deal
  with.
- **Test assertions weakened.** Diff each test file; look for `>= N`
  becoming `>= N-1`, `==` becoming `>=`, or tests being removed/skipped.

```bash
# Test-file changes across all 5 merge commits:
for sha in a14ca58 c062d19 2e4ca6a dcfa69a d6b1b14; do
    echo "=== $sha ==="
    git show $sha --stat -- tests/
done
```

---

## 7. Spec adherence check

Re-read the spec's success criteria:

```bash
cat haikai/specs/2026-05-18-api-and-stream-modularize/spec.md | sed -n '/## Success criteria/,/##/p'
```

Verify each criterion is currently true:

| Criterion | Verify | Current status |
|---|---|---|
| **G1**: no file > ~800 LOC after Phase A | `wc -l src/api/**/*.py \| sort -n \| tail -3` | `api/__init__.py` = **3418** LOC. **Not yet met** — Phase A.6 (chat/jobs/standards/specs routes) still pending. |
| **G2**: `stream_message` ≤ 150 LOC | AST scan of `src/chat/claude_chat_executor.py:stream_message` | **773** LOC. **Not yet met** — Phase B not started. |
| **G3**: public import surface unchanged | `.venv/Scripts/python.exe -c "from src.api import create_chat_executor, BACKEND_REGISTRY, ClaudeChatExecutor, _recover_interrupted_jobs; print('all exports resolve')"` | ✅ Verified at last regression. |
| **G4**: regression count unchanged | `.venv/Scripts/python.exe -m pytest tests/ -q --ignore=tests/manual --ignore=tests/integration 2>&1 \| tail -1` | ✅ `1232 passed` throughout all 5 phases. |
| **G5**: behaviour unchanged (same responses, status codes, SSE events) | OpenAPI diff (§2) + route audit (§3) + endpoint smoke tests (§8) | To verify. |

---

## 8. Single failing-test rehearsal (high-confidence sanity check)

Best confidence test that the suite *actually catches* regressions in
the moved code:

```bash
# Pick one moved endpoint. e.g. /api/v1/orchestrations status route.
# In src/api/routes/orchestration.py, temporarily change
#   status_code=status.HTTP_404_NOT_FOUND
# to
#   status_code=status.HTTP_410_GONE
# inside get_orchestration_status.
# Run pytest — at least one test should fail with a clear status-code mismatch.
# Revert.
```

If the deliberate break fails loudly: the suite covers the move.
If it silently passes: the suite isn't testing what you think.

---

## 9. Split the review across people

If two reviewers:

- **Reviewer A**: A.1 + A.2 + A.4. Pure extractions, minimal
  cross-module test impact. Mostly "did the LOC counts match and did
  anything semantic sneak in."
- **Reviewer B**: A.3 + A.5. Lazy-import gymnastics + test-patch
  retargeting — the riskier work. The CO1 + A.5 lessons concentrate
  here.

---

## 10. What's NOT covered by this review

- **Performance**: no benchmark before/after. The moves shouldn't
  change CPU/RAM/latency, but no measurement was taken.
- **Cold-start time**: each new module adds an import. Likely
  negligible but unmeasured.
- **Deployment artifacts**: if anything pickles a class by its
  `__module__` attribute (e.g. session serialisation), that
  serialisation key just changed. None of the executors look pickled,
  but worth a code search if anything ever roundtrips through
  `pickle`/`joblib`.
- **Phase A.6** (`routes/chat.py`, `jobs.py`, `standards.py`,
  `specs.py`): not started. `api/__init__.py` still at 3418 LOC.
- **Phase B** (`stream_message` extract, 773 LOC → ≤150): not started.

---

## TL;DR — what to actually do

1. Run §2 (OpenAPI diff). Should be empty.
2. Run §3 (route audit). Should be empty.
3. Run §5 sanity test. Should be `1232 passed`.
4. Skim §7. Note G1 + G2 still not met (Phase A.6 + Phase B pending).

If all 4 are clean → the work is reviewable as zero-behaviour-change
structural refactoring. Merge confidence high.

If §2 or §3 diffs → something behavioural changed unexpectedly →
investigate that specific endpoint before approving anything.
