# Requirements: Git Integration

## Feature Description

Full version control integration across the entire Haikai/SDD lifecycle. Every artifact-producing
operation — plan-product, product standards, shape-spec, orchestration — commits to git feature branches
with automatic push and PR creation. Supports GitHub and Bitbucket.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- `subprocess` for git CLI operations (git is pre-installed in Docker)
- `httpx` for GitHub/Bitbucket REST API calls (already a dependency)
- Pydantic for request/response models

## Requirements

### Project Initialization
- New `POST /projects/init` endpoint accepting `{company, project, repo_url}`
- Brownfield: clone existing repo into workspace
- Greenfield: detect empty remote, `git init`, scaffold (README.md + haikai/), initial commit, push
- One-off operation — error if already initialized
- Repo URL must exist and be reachable — error if not (no auto-creation in phase 1)
- Store project config at `{project_dir}/.haikai/config.json` (repo_url, provider, default_branch, initialized_at)
- Auth via Docker env vars: `GITHUB_TOKEN` or `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD`

### V1/V2 API Strategy
- All v1 endpoints remain unchanged for backwards compatibility
- Every v1 project-scoped endpoint gets a v2 counterpart
- V2 endpoints require initialized project — hard error (400) if not initialized or git config missing
- No fallbacks, no graceful degradation — hardened expectations

### GitManager Module
- New module at `src/git/git_manager.py`
- Methods: init_project, ensure_initialized, load_config, pull_latest, create_feature_branch,
  commit_all, push_branch, create_pull_request
- Provider-aware: GitHub and Bitbucket support for push auth and PR creation

### Branching Strategy
- Plan-product output → `feature/plan-product-{date}` branch + PR
- Product standards → `feature/product-standards-{date}` branch + PR
- Spec intents → `feature/{spec-name}` branch, created after shape-spec folder event
- Feature branches not pushed until after implement-tasks
- 1 orchestrate request = 1 commit (not per-step)
- Commit prefix: "feature:" not "feat:"
- Pull latest before shape-spec starts

### Push & PR
- Push feature branch after orchestration completes
- Create PR via GitHub REST API (`POST /repos/{owner}/{repo}/pulls`) or
  Bitbucket REST API (`POST /2.0/repositories/{workspace}/{repo}/pullrequests`)
- PR title: `feature: {spec-name}`, body: spec summary + task list
- Controlled by `GIT_AUTO_PUSH` and `GIT_AUTO_PR` env vars

### Error Handling
- Push failure → `FAILURE` SSE client event (orchestration still succeeded, push didn't land)
- PR creation failure → `WARNING` SSE client event (branch pushed, PR failed)
- Init failure → HTTP 400/500 with error details
- Feature branches NOT deleted after PR merge

### Docker Config
- `.env.docker` settings: `GIT_PROVIDER`, `GIT_DEFAULT_BRANCH`, `GIT_AUTO_PUSH`, `GIT_AUTO_PR`
- Git identity: `git config --global user.name "Haikai Bot"` + email in Dockerfile
- Bitbucket env vars: `BITBUCKET_USERNAME`, `BITBUCKET_APP_PASSWORD`

### Response Model Updates
- Add `commit_sha`, `branch`, `pr_url` to OrchestrationResponse

## Constraints
- No monorepo support
- No auto-creation of remote repos (phase 1 — user creates manually)
- Feature branches not deleted after merge
- Package endpoints (`/package`, `/package/json`) kept as a feature alongside git
- Existing v2 brain-only orchestration overwritten with git-integrated full orchestration

## Out of Scope
- GitLab support (GitHub and Bitbucket only)
- Merge conflict resolution
- Branch protection rules
- Webhook listeners for PR events
- Auto-merge after CI passes
- Git LFS support
- Submodule support
