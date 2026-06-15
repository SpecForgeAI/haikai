# Specification: Git Integration

## Goal

Integrate version control across the entire Haikai/SDD lifecycle so every artifact-producing operation commits to
git feature branches with automatic push and PR creation, enabling developer review via GitHub or Bitbucket.

## User Stories

- As a developer, I want implemented code pushed to a feature branch with a PR so that I can review and merge it
- As a project owner, I want to initialize my project from an existing repo so that the system works with my codebase

## Specific Requirements

**Project Init Endpoint**
- New `POST /projects/init` accepting `{company, project, repo_url}`
- Detect brownfield (clone) vs greenfield (empty remote → scaffold + init) automatically
- Store config at `{project_dir}/.haikai/config.json` with repo_url, provider, default_branch, initialized_at
- One-off: error if already initialized
- Error if repo URL unreachable (no auto-creation)
- Auth from Docker env vars (`GITHUB_TOKEN` or `BITBUCKET_USERNAME` + `BITBUCKET_APP_PASSWORD`)

**GitManager Module (`src/git/git_manager.py`)**
- Class with methods: init_project, ensure_initialized, load_config, pull_latest, create_feature_branch,
  commit_all, push_branch, create_pull_request
- Constructor takes project_dir, provider, default_branch, and auth credentials
- Provider-aware: authenticated push URLs and PR creation for both GitHub and Bitbucket REST APIs
- All git operations via `subprocess.run()` calling git CLI (already installed in Docker)

**V2 Endpoint Layer**
- Mirror every v1 project-scoped endpoint to v2 with git integration
- V2 artifact-producing endpoints: commit to feature branch, push, create PR
- V2 read-only endpoints: require initialized project but no git writes
- Missing git config or uninitialized project → hard 400 error, no fallbacks
- V1 endpoints unchanged for backwards compatibility

**Branching Strategy**
- Plan-product → `feature/plan-product-{date}` branch, commit + push + PR
- Product standards → `feature/product-standards-{date}` branch, commit + push + PR
- Spec intents → `feature/{spec-name}` branch, created after shape-spec folder event
- Pull latest from default branch before shape-spec starts
- Feature branch not pushed until orchestration completes
- 1 orchestrate request = 1 commit containing all write-spec + create-tasks + implement-tasks output

**PR Creation**
- GitHub: `POST /repos/{owner}/{repo}/pulls` via httpx
- Bitbucket: `POST /2.0/repositories/{workspace}/{repo}/pullrequests` via httpx
- Title: `feature: {spec-name}`, body: spec summary + task list
- Controlled by `GIT_AUTO_PR` env var

**Error Handling**
- Push failure → emit `FAILURE` SSE event (code written but not pushed)
- PR creation failure → emit `WARNING` SSE event (pushed but PR failed)
- Init failure → HTTP 400/500 response
- Feature branches never deleted after PR merge

**Docker & Config**
- `.env.docker`: `GIT_PROVIDER`, `GIT_DEFAULT_BRANCH`, `GIT_AUTO_PUSH`, `GIT_AUTO_PR`
- Dockerfile: `git config --global user.name "Haikai Bot"` and email
- Add `BITBUCKET_USERNAME`, `BITBUCKET_APP_PASSWORD` env vars

**Response Model Updates**
- Add `commit_sha: Optional[str]`, `branch: Optional[str]`, `pr_url: Optional[str]` to OrchestrationResponse

## Visual Design

No visual assets provided. This is a backend API implementation.

## Existing Code to Leverage

**`src/api.py` — Existing endpoint patterns**
- All v1 endpoints follow consistent FastAPI patterns with tags, summary, response_model, Depends(verify_api_key)
- SSE streaming pattern used by shape-spec and plan-product endpoints (event_queue, background thread)
- V2 endpoints already exist for orchestrations — will be overwritten with git-integrated versions
- `create_chat_executor()` factory pattern for creating executors per project

**`src/haikai_orchestrator.py` — Orchestration loop**
- `run_workflow()` iterates spec_intents and calls `_execute_step_with_session()` for each step
- Step results collected in `results` list with status, timing, and error info
- Natural integration point: after all steps complete, call git_manager.commit_all + push + create_pr
- `OrchestrationResponse` and `StepResult` Pydantic models in `src/haikai_models.py`

**`src/chat/tool_executor.py` — subprocess patterns**
- Uses `subprocess.run()` with `cwd`, `capture_output=True`, `text=True` for shell commands
- Shell detection logic (bash vs cmd vs powershell) — git operations should use bash path
- Error handling: captures stdout+stderr, checks returncode

**`src/chat/session_store.py` — JSON config persistence**
- Pattern for storing JSON config at `{project_dir}/.claude/active_session.json`
- Same pattern applies for `.haikai/config.json` — read/write JSON with Path operations

**Docker config (`docker-compose.yml`, `.env.docker`)**
- `.env.docker` already has `GITHUB_TOKEN`, `ANTHROPIC_API_KEY`, and other env vars
- `docker-compose.yml` passes env vars to container and mounts workspace volumes
- Dockerfile installs git — no additional packages needed

## Out of Scope

- GitLab support (GitHub and Bitbucket only for phase 1)
- Merge conflict resolution (user resolves manually)
- Branch protection rules configuration
- Webhook listeners for PR merge/close events
- Auto-merge after CI passes
- Git LFS or submodule support
- Monorepo support (entire repo = one project)
- Auto-creation of remote repos (user creates manually in phase 1)
