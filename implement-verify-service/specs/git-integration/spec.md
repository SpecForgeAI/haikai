# Git Integration Spec

## Problem

The entire SDD (Specification-Driven Development) process — from plan-product through shape-spec, write-spec,
create-tasks, and implement-tasks — produces artifacts (standards, specs, task breakdowns, code) inside a Docker
workspace with no version control. There is no way for developers to review, approve, track, or collaborate on any
output the system generates.

## Goal

Full version control integration across the entire Haikai/SDD lifecycle. Every meaningful output — product standards,
specs, task definitions, implemented code — is tracked in git, organized into appropriate branches, and surfaced to
developers via PRs for review.

Specifically:
- Project initialization clones or creates a repo
- Plan-product output gets a feature branch + PR (mission.md, roadmap.md, tech-stack.md)
- Product standards generation gets a feature branch + PR (technical standards from source analysis)
- Each spec intent gets a feature branch with a single commit per orchestration request
- Implemented code is pushed and a PR is created for developer review
- Supports GitHub and Bitbucket

## Design

### 1. Project Initialization

Project initialization is a **prerequisite** that must happen before any project-scoped API calls.

**Endpoints that require an initialized project:**

| Endpoint                                          | Why                    |
|---------------------------------------------------|------------------------|
| `POST /api/v1/shape-spec/stream`                  | Creates specs          |
| `POST /api/v1/plan-product/stream`                | Plans standards        |
| `POST /api/v1/orchestrations`                      | Full orchestration     |
| `POST /api/v2/orchestrations`                      | Full orchestration (v2, git-integrated) |
| `POST /api/v1/jobs/orchestrations`                | Async orchestration    |
| `POST /api/v1/haikai/shape-specs`              | Batch shape-specs      |
| `POST /api/v1/standards/product/generate`          | Product standards      |
| `GET /api/v1/metamodels/.../{id}`                  | Reads metamodel        |
| `POST .../write-spec`                              | Creates spec           |
| `POST .../tasks/generate`                          | Generates tasks        |
| `POST .../implement`                               | Implements tasks       |

**Endpoints that do NOT require init:**
- `GET /health`
- `POST /api/v1/standards/global/generate`
- `GET /api/v1/jobs/{job_id}`
- `GET /api/v1/jobs`
- `POST /projects/init` (the init itself)

There are two scenarios:

#### 1a. Brownfield (existing project)

An existing codebase hosted on GitHub or Bitbucket. The user provides the repo URL.

**Flow:**
1. User calls `POST /projects/init` with repo URL
2. System clones the repo into the workspace: `git clone {repo_url} {project_dir}`
3. Stay on the default branch (main)
4. Project is ready for all project-scoped endpoints

#### 1b. Greenfield (new project)

A brand new project with no existing repo.

**Flow:**
1. User creates an empty repo on GitHub/Bitbucket first (phase 1 — system does not create repos)
2. User calls `POST /projects/init` with the (empty) repo URL
3. System creates the project directory, runs `git init`, adds remote
4. Initial commit with README/scaffold (see Section 13)
5. Push to remote
6. Project is ready for all project-scoped endpoints (typically plan-product first, then shape-spec)

#### Init API Endpoint

`POST /projects/init`

```json
{
  "company": "acme",
  "project": "backend",
  "repo_url": "https://github.com/acme/backend.git"
}
```

**Behavior:**
- Repo URL does not exist or is unreachable → return error (do not create repos in phase 1)
- Remote repo is empty (no commits) → greenfield: `git init`, create scaffold, initial commit, push
- Remote repo has content → brownfield: clone and checkout default branch
- Auth credentials come from Docker env vars (see Section 2)
- Stores project config at `{project_dir}/.haikai/config.json` (see Section 3)
- **One-off operation** — if the project is already initialized, return error "Project already initialized"

No monorepo support — the entire repo is the project.

### 2. Config

**`.env.docker`:**
```
# Git Integration
GIT_PROVIDER=github            # "github" or "bitbucket"
GIT_DEFAULT_BRANCH=main
GIT_AUTO_PUSH=true             # Push after implement-tasks
GIT_AUTO_PR=true               # Create PR/MR after push
```

**Auth tokens** (in `.env.docker`):
- GitHub: `GITHUB_TOKEN` — used for `https://{token}@github.com/...` push and REST API PRs
- Bitbucket: `BITBUCKET_APP_PASSWORD` + `BITBUCKET_USERNAME` — used for
  `https://{user}:{password}@bitbucket.org/...` push and REST API PRs

### 3. Project Config Persistence

After `POST /projects/init`, store project-level config at:

```
{project_dir}/.haikai/config.json
```

```json
{
  "repo_url": "https://github.com/acme/backend.git",
  "provider": "github",
  "default_branch": "main",
  "initialized_at": "2026-03-14T10:00:00Z"
}
```

The orchestrator reads this at runtime for push/PR operations instead of requiring the repo URL to be passed again.

### 4. Workspace Git Lifecycle

```
~/.haikai/api_workspace/{company}/{project}/
  .git/
  .haikai/config.json
  haikai/specs/{spec-name}/
  src/
  ...
```

**Precondition:** Before any project-scoped endpoint runs, `{project_dir}/.git/` must exist. If it doesn't, the
system returns an error telling the user to call `POST /projects/init` first.

### 5. Branching Strategy

All artifact-producing operations use feature branches. Nothing commits directly to main except the greenfield
scaffold (Section 13). The default branch is always the merge target.

#### 5a. Plan-Product Branch

When `POST /api/v1/plan-product/stream` completes:

1. Pull latest from default branch
2. Create branch: `feature/plan-product-{date}` (e.g. `feature/plan-product-2026-03-14`)
3. Commit all plan-product output (mission.md, roadmap.md, tech-stack.md)
4. Push branch + create PR: `"docs: plan-product for {project}"`

#### 5b. Product Standards Branch

When `POST /api/v1/standards/product/generate` completes:

1. Pull latest from default branch
2. Create branch: `feature/product-standards-{date}` (e.g. `feature/product-standards-2026-03-14`)
3. Commit all generated standards files
4. Push branch + create PR: `"docs: product standards for {project}"`

#### 5c. Spec Intent Branch

**Before shape-spec starts**, pull latest from remote to ensure the workspace is up to date:
```python
git_manager.pull_latest()  # git pull origin {default_branch}
```

**After shape-spec completes** (folder event detected), create a feature branch from the default branch:
```
branch name: feature/{spec-name}
e.g.: feature/2026-03-14-user-authentication
```

The feature branch is **not pushed** at this point — it is only pushed after implement-tasks (see Section 6).

**After orchestration completes**, a single commit for the entire orchestration request: [user comment: should be called 'feature' not 'feat']
```
"feature: {spec-name} (write-spec + create-tasks + implement-tasks)"
```

One orchestrate request = one commit. The commit contains all output from write-spec, create-tasks, and
implement-tasks combined.

### 6. Push & PR After Implement-Tasks

After orchestration completes successfully:

1. `git push origin feature/{spec-name}`
2. If `GIT_AUTO_PR=true`, create PR via provider API:

**GitHub** (REST API):
- `POST /repos/{owner}/{repo}/pulls`
- Title: `feat: {spec-name}`
- Body: spec summary + task list
- Base: `{default_branch}`, Head: `feature/{spec-name}`

**Bitbucket** (REST API):
- `POST /2.0/repositories/{workspace}/{repo}/pullrequests`
- Title: `feat: {spec-name}`
- Source: `feature/{spec-name}`, Destination: `{default_branch}`

### 7. New Module: `src/git/git_manager.py`

```python
class GitManager:
    def __init__(self, project_dir: Path, provider: str = "github", default_branch: str = "main",
                 github_token: str = None, bitbucket_username: str = None,
                 bitbucket_app_password: str = None):
        ...

    def init_project(self, repo_url: str):
        """Clone repo. If empty remote, git init + scaffold + push.
        Stores config to .haikai/config.json. One-off — errors if already initialized."""

    def ensure_initialized(self) -> bool:
        """Check .git/ exists. Returns False if project needs init."""

    def load_config(self) -> dict:
        """Load .haikai/config.json for repo_url, provider, etc."""

    def pull_latest(self):
        """git pull origin {default_branch}. Called before operations to sync workspace."""

    def create_feature_branch(self, branch_name: str) -> str:
        """Checkout new branch from default_branch."""

    def commit_all(self, message: str) -> str:
        """Stage all changes and commit. Returns commit SHA."""

    def push_branch(self, branch: str):
        """git push origin {branch}."""

    def create_pull_request(self, title: str, branch: str, body: str) -> str:
        """Create PR via GitHub/Bitbucket API, return PR URL."""
```

### 8. Integration Points

**`api.py` — new init endpoint:**
```python
@app.post("/projects/init")
async def init_project(request: ProjectInitRequest):
    git_manager = GitManager(project_dir, ...)
    git_manager.init_project(request.repo_url)
```

**`api.py` — plan-product endpoint:**
```python
# After plan-product completes:
if git_enabled:
    git_manager.pull_latest()
    branch = git_manager.create_feature_branch(f"feature/plan-product-{date}")
    git_manager.commit_all("docs: plan-product output")
    git_manager.push_branch(branch)
    git_manager.create_pull_request(f"docs: plan-product for {project}", branch, body)
```

**`api.py` — product standards endpoint:**
```python
# After standards generation completes:
if git_enabled:
    git_manager.pull_latest()
    branch = git_manager.create_feature_branch(f"feature/product-standards-{date}")
    git_manager.commit_all("docs: product standards")
    git_manager.push_branch(branch)
    git_manager.create_pull_request(f"docs: product standards for {project}", branch, body)
```

**`api.py` — shape-spec endpoint:**
```python
# Before shape-spec starts:
if git_enabled:
    git_manager.pull_latest()

# After folder event detected in SSE stream:
if git_enabled:
    git_manager.create_feature_branch(f"feature/{folder_name}")
```

**`haikai_orchestrator.py` — after orchestration completes:**
```python
# After all steps complete successfully (single commit for entire orchestration):
if self.git_manager:
    self.git_manager.commit_all(f"feature: {spec_name} (write-spec + create-tasks + implement-tasks)")
    self.git_manager.push_branch(f"feature/{spec_name}")
    if self.auto_pr:
        pr_url = self.git_manager.create_pull_request(f"feature: {spec_name}", branch, body)
```

**Precondition check** (before any v2 endpoint):
```python
# All v2 endpoints require git to be enabled and project initialized
if not git_manager.ensure_initialized():
    raise HTTPException(400, "Project not initialized. Call POST /projects/init first.")
```

### 9. Error Handling

Git errors are surfaced to the client via SSE events:

- **Push failure** (auth expired, network, conflicts): emit as a `FAILURE` client event. The orchestration step
  itself still succeeded — the code was written — but the push did not land.
- **PR creation failure**: emit as a `WARNING` client event. The branch was pushed but the PR could not be created.
- **Init failure** (repo unreachable, auth): return HTTP 400/500 with error details from the `POST /projects/init`
  response.

Feature branches are **not** deleted after PR merge. They remain on the remote for traceability.

### 10. Multi-Spec Orchestration

When orchestrating multiple specs, each gets its own branch:
```
main
 |-- feature/plan-product-2026-03-14
 |-- feature/product-standards-2026-03-14
 |-- feature/2026-03-14-user-authentication
 |-- feature/2026-03-14-payment-gateway
 |-- feature/2026-03-14-notification-service
```

Between specs, checkout back to `default_branch` before creating the next feature branch.

### 11. Docker Requirements

Already met:
- `git` is installed in Dockerfile
- `GITHUB_TOKEN` exists in `.env.docker`

Need to add:
- Git config for commit identity:
  ```dockerfile
  RUN git config --global user.name "Haikai Bot" && \
      git config --global user.email "bot@haikai.ai"
  ```
- PR creation via GitHub/Bitbucket REST API using `httpx` (already a dependency)
- `BITBUCKET_USERNAME` and `BITBUCKET_APP_PASSWORD` env vars (if Bitbucket support needed)

### 12. Response Model Updates

Add to `OrchestrationResponse`:
```python
commit_sha: Optional[str] = None
branch: Optional[str] = None
pr_url: Optional[str] = None
```

### 13. Greenfield Scaffold

When initializing an empty repo, the initial commit includes:

```
README.md          <- Project name, basic description
haikai/          <- Directory for haikai specs (empty)
```

The scaffold is intentionally minimal — plan-product and shape-spec will populate the real structure.
This is the only commit that goes directly to the default branch.

### 14. V1 / V2 API Strategy

Git integration is **mandatory** for v2 endpoints. No fallbacks, no graceful degradation — hardened expectations.

**V1 (unchanged):** No git operations. Existing behavior preserved exactly as-is for backwards compatibility.

**V2 (git-integrated, strict):**
- All v2 endpoints require an initialized project (`POST /projects/init` must have been called)
- Git config (`GIT_PROVIDER`, auth tokens) must be set in `.env.docker` — missing config = hard error (400)
- Every v2 endpoint that produces artifacts commits to a feature branch, pushes, and creates a PR
- Read-only v2 endpoints require project initialization but don't perform git operations

**Every v1 project-scoped endpoint gets a v2 counterpart.** V2 consumers never need to touch v1.

**V2 Endpoint Map:**

| V2 Endpoint                                                  | V1 Equivalent                                | Git Behavior                       |
|--------------------------------------------------------------|----------------------------------------------|------------------------------------|
| `POST /projects/init`                                        | _(new, no v1)_                               | Clones/inits repo                  |
| `POST /api/v2/shape-spec/stream`                             | `POST /api/v1/shape-spec/stream`             | Pull latest, create feature branch |
| `GET /api/v2/shape-spec/history`                             | `GET /api/v1/shape-spec/history`             | Read-only (init required)          |
| `POST /api/v2/plan-product/stream`                           | `POST /api/v1/plan-product/stream`           | Commit to feature branch + PR      |
| `GET /api/v2/plan-product/history`                           | `GET /api/v1/plan-product/history`           | Read-only (init required)          |
| `POST /api/v2/orchestrations`                                | `POST /api/v1/orchestrations`                | Commit + push + PR                 |
| `POST /api/v2/jobs/orchestrations`                           | `POST /api/v1/jobs/orchestrations`           | Commit + push + PR (async)         |
| `GET /api/v2/orchestrations/{id}/status`                     | `GET /api/v1/orchestrations/{id}/status`     | Read-only (init required)          |
| `GET /api/v2/orchestrations/{id}/logs`                       | `GET /api/v1/orchestrations/{id}/logs`       | Read-only (init required)          |
| `GET /api/v2/orchestrations/.../package`                     | _(existing v2)_                              | Keep as feature (ZIP download)     |
| `GET /api/v2/orchestrations/.../package/json`                | _(existing v2)_                              | Keep as feature (JSON package)     |
| `POST /api/v2/standards/product/generate`                    | `POST /api/v1/standards/product/generate`    | Commit to feature branch + PR      |
| `POST /api/v2/haikai/shape-specs`                         | `POST /api/v1/haikai/shape-specs`          | Commit to feature branch + PR      |
| `GET /api/v2/specs/{company}/{project}`                      | `GET /api/v1/specs/{company}/{project}`      | Read-only (init required)          |
| `GET /api/v2/specs/{company}/{project}/{spec_id}`            | `GET /api/v1/specs/.../{spec_id}`            | Read-only (init required)          |
| `GET /api/v2/specs/{company}/{project}/{spec_id}/tasks`      | `GET /api/v1/specs/.../{spec_id}/tasks`      | Read-only (init required)          |
| `POST /api/v2/specs/{company}/{project}/write-spec`          | `POST /api/v1/specs/.../write-spec`          | Commit to feature branch           |
| `POST /api/v2/specs/{company}/{project}/{id}/tasks/generate` | `POST /api/v1/specs/.../tasks/generate`      | Commit to feature branch           |
| `POST /api/v2/specs/{company}/{project}/{id}/implement`      | `POST /api/v1/specs/.../implement`           | Commit + push + PR                 |
| `GET /api/v2/metamodels/{company}/{project}/{id}`            | `GET /api/v1/metamodels/.../{id}`            | Read-only (init required)          |

**Existing v2 brain-only orchestration** (`POST /api/v2/orchestrations` — write-spec + create-tasks only):
Overwritten with the new git-integrated full orchestration. Brain-only is disabled for now (useful for future).

### 15. Resolved Decisions

- **`POST /projects/init` is a one-off** — calling it again on an initialized project returns an error.
  Shape-spec always pulls latest before branching.
- **No project delete endpoint** — projects are not torn down via API.
- **All artifact-producing operations use feature branches** — plan-product, product standards, and spec intents
  each get their own feature branch + PR. Nothing commits directly to main.
- **1 orchestrate request = 1 commit** — write-spec, create-tasks, and implement-tasks output is committed as a
  single commit, not per-step.
- **Feature branches are only pushed after implement-tasks** — not when shape-spec creates the branch.
- **Feature branches are not deleted** after PR merge — they remain for traceability.
- **Commit messages use "feature:" prefix** not "feat:".
- **No fallbacks** — v2 endpoints fail hard if git config is missing or project is not initialized.
- **Package endpoints stay** — they are a feature, not a fallback. Available on v2 alongside git integration.
- **Everything bumped to v2** — every v1 project-scoped endpoint has a v2 counterpart.

### 16. Open Items

_(None at this time — all questions resolved.)_