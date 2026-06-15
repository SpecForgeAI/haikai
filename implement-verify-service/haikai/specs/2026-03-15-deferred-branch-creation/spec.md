# Deferred Branch Creation: Shape-Spec → Orchestration

## Summary

Move git feature branch creation from the shape-spec phase to the orchestration job completion phase. Branches should only be created when an async orchestration job (`POST /api/v2/jobs/orchestrations`) completes successfully — not when a new shape-spec API request is made.

---

## Current Flow

```
1. POST /api/v2/shape-spec/stream  (session_mode: "new")
   ├─ git pull latest
   ├─ Run /shape-spec via Claude CLI
   ├─ On "folder" SSE event → gm.create_feature_branch("feature/{folder_name}")  ← BRANCH CREATED HERE
   └─ Returns SSE stream with questions/folder events

2. POST /api/v2/jobs/orchestrations
   ├─ Validates git manager exists (_require_git_manager)
   ├─ Enqueues job, returns job_id immediately
   └─ Background task (tasks.py:run_orchestration):
       ├─ Runs orchestrator.run_workflow() (write-spec → create-tasks → implement-tasks)
       ├─ ASSUMES branch "feature/{spec_name}" already exists
       ├─ gm.commit_all() on the current branch
       ├─ gm.push_branch(branch)
       ├─ gm.create_pull_request()
       └─ Switches back to default branch
```

### Current flow issues

- A branch is created during shape-spec with only `requirements.md` and `initialization.md` — no spec, no tasks, no implementation yet.
- If the user never orchestrates, an orphaned feature branch remains.
- If shape-spec fails after branch creation, a dirty/incomplete branch is left behind.

---

## Proposed Flow

```
1. POST /api/v2/shape-spec/stream  (session_mode: "new")
   ├─ git pull latest
   ├─ Run /shape-spec via Claude CLI (stays on default branch)
   ├─ On "folder" SSE event → emit event only, NO branch creation
   └─ Spec folder created on the default branch (uncommitted working tree)

2. POST /api/v2/jobs/orchestrations
   ├─ Validates git manager exists
   ├─ Enqueues job, returns job_id immediately
   └─ Background task (tasks.py:run_orchestration):
       ├─ Runs orchestrator.run_workflow() on default branch (working tree)
       ├─ AFTER workflow completes successfully:
       │   ├─ gm.create_feature_branch("feature/{spec_name}")  ← BRANCH CREATED HERE
       │   ├─ gm.commit_all()
       │   ├─ gm.push_branch()
       │   └─ gm.create_pull_request()
       └─ Switches back to default branch
```

---

## Key Differences

| Aspect | Current | Proposed |
|--------|---------|----------|
| **Branch creation timing** | During shape-spec stream (on "folder" event) | After orchestration job completes successfully |
| **Branch creation location** | `src/api.py` shape_spec_stream_v2 | `src/job_queue/tasks.py` run_orchestration |
| **Work happens on** | Feature branch (shape-spec + orchestration) | Default branch working tree until commit |
| **Failed orchestration** | Leaves orphaned feature branch | No branch created — clean state |
| **Shape-spec without orchestration** | Orphaned branch with only requirements | No branch — just uncommitted files |

---

## Code Changes

### 1. `src/api.py` — `shape_spec_stream_v2` (~line 3013)

Remove `gm.create_feature_branch()` call from the "folder" event handler. Keep the "folder" event emission.

### 2. `src/api.py` — `create_shape_specs_v2` (~line 3549)

Remove `gm.create_feature_branch()` call and the subsequent checkout back to default branch.

### 3. `src/job_queue/tasks.py` — `run_orchestration` (~line 97)

Add `gm.create_feature_branch(branch)` call before `gm.commit_all()`, so the branch is created only after `run_workflow()` succeeds.

---

## Concurrency Concern

In the current flow, each spec gets its own branch immediately during shape-spec, so parallel shape-spec calls don't collide. In the proposed flow, all shape-spec output lands in the working tree on the default branch. If two specs are shaped concurrently, their files could intermingle before being branched.

**Mitigating factors:**
- Spec folders are already namespaced (`haikai/specs/{spec_name}/`), so file-level collisions are unlikely.
- The orchestration job creates the branch and commits atomically per spec.

**Remaining risk:**
- Git operations (checkout, commit) aren't atomic across concurrent jobs. Two concurrent orchestration jobs for the same project could race on branch checkout/commit.
- This is acknowledged but **not addressed** in this change. A future enhancement could add a per-project lock or serialize orchestration jobs for the same project.
