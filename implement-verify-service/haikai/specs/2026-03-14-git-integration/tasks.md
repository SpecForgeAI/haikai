# Task Breakdown: Git Integration

## Overview
Total Tasks: 36

## Task List

### Core Module

#### Task Group 1: GitManager Module
**Dependencies:** None

- [x] 1.0 Complete GitManager module
  - [x] 1.1 Write 6 focused tests for GitManager
    - Test init_project with brownfield repo (mock subprocess, verify clone command)
    - Test init_project with empty remote (verify git init + scaffold + push sequence)
    - Test init_project errors if already initialized
    - Test ensure_initialized returns True/False based on .git/ existence
    - Test load_config reads and returns .haikai/config.json correctly
    - Test pull_latest calls git pull with correct branch
  - [x] 1.2 Create `src/git/__init__.py` and `src/git/git_manager.py`
    - GitManager class with constructor: project_dir, provider, default_branch, github_token,
      bitbucket_username, bitbucket_app_password
    - Store all params as instance attributes
    - Logger setup
  - [x] 1.3 Implement init_project(repo_url)
    - Check if .git/ already exists → raise error if so
    - Try `git ls-remote {authenticated_url}` to check if repo exists and has content
    - If repo unreachable → raise error with details
    - If repo has content (brownfield) → `git clone {authenticated_url} .` into project_dir
    - If repo empty (greenfield) → `git init`, create README.md + haikai/ dir, `git add .`,
      `git commit -m "Initial scaffold"`, `git remote add origin`, `git push -u origin {default_branch}`
    - Write `.haikai/config.json` with repo_url, provider, default_branch, initialized_at
  - [x] 1.4 Implement ensure_initialized() and load_config()
    - ensure_initialized: check `{project_dir}/.git/` exists, return bool
    - load_config: read and parse `{project_dir}/.haikai/config.json`, return dict
  - [x] 1.5 Implement pull_latest()
    - `git checkout {default_branch}` then `git pull origin {default_branch}`
    - Run in project_dir via subprocess
  - [x] 1.6 Implement create_feature_branch(branch_name)
    - `git checkout {default_branch}` then `git checkout -b {branch_name}`
    - Return branch_name
  - [x] 1.7 Implement commit_all(message)
    - `git add -A` then `git commit -m "{message}"`
    - Parse and return commit SHA from git output
  - [x] 1.8 Implement push_branch(branch)
    - Build authenticated remote URL based on provider (github token or bitbucket user:pass)
    - `git push origin {branch}`
  - [x] 1.9 Implement _build_authenticated_url()
    - GitHub: `https://{token}@github.com/{owner}/{repo}.git`
    - Bitbucket: `https://{username}:{app_password}@bitbucket.org/{workspace}/{repo}.git`
    - Parse owner/repo from stored repo_url
  - [x] 1.10 Ensure GitManager tests pass
    - Run ONLY the 6 tests written in 1.1
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- GitManager initializes brownfield and greenfield projects correctly
- Config persisted to .haikai/config.json and loadable
- Feature branches created, committed to, and pushed
- Authenticated URLs built correctly for both GitHub and Bitbucket

---

### PR Creation

#### Task Group 2: Pull Request Creation
**Dependencies:** Task Group 1

- [x] 2.0 Complete PR creation
  - [x] 2.1 Write 4 focused tests for PR creation
    - Test GitHub PR creation (mock httpx, verify request payload and URL)
    - Test Bitbucket PR creation (mock httpx, verify request payload and URL)
    - Test PR creation returns PR URL on success
    - Test PR creation raises on HTTP error
  - [x] 2.2 Implement create_pull_request(title, branch, body)
    - Route to _create_github_pr or _create_bitbucket_pr based on provider
    - Return PR URL string
  - [x] 2.3 Implement _create_github_pr()
    - Parse owner/repo from repo_url
    - `POST https://api.github.com/repos/{owner}/{repo}/pulls`
    - Headers: Authorization Bearer {github_token}, Accept application/vnd.github+json
    - Body: title, head (branch), base (default_branch), body
    - Return PR html_url from response
  - [x] 2.4 Implement _create_bitbucket_pr()
    - Parse workspace/repo from repo_url
    - `POST https://api.bitbucket.org/2.0/repositories/{workspace}/{repo}/pullrequests`
    - Auth: HTTP Basic with bitbucket_username:bitbucket_app_password
    - Body: title, source.branch.name, destination.branch.name, description
    - Return PR links.html.href from response
  - [x] 2.5 Ensure PR creation tests pass
    - Run ONLY the 4 tests written in 2.1
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- GitHub PRs created with correct payload
- Bitbucket PRs created with correct payload
- PR URL returned to caller
- HTTP errors raised with useful messages

---

### API Layer

#### Task Group 3: Project Init Endpoint
**Dependencies:** Task Group 1

- [x] 3.0 Complete project init endpoint
  - [x] 3.1 Write 5 focused tests for init endpoint
    - Test successful brownfield init (mock GitManager, verify response)
    - Test successful greenfield init (mock GitManager, verify response)
    - Test error when project already initialized
    - Test error when repo URL unreachable
    - Test error when git config missing from env (hard 400)
  - [x] 3.2 Create Pydantic request/response models
    - ProjectInitRequest: company (str), project (str), repo_url (str)
    - ProjectInitResponse: success (bool), message (str), project_dir (str), mode (str: brownfield/greenfield)
  - [x] 3.3 Implement `POST /projects/init` endpoint in api.py
    - Load git config from env vars (GIT_PROVIDER, GITHUB_TOKEN, etc.)
    - Hard error if git config missing
    - Create GitManager instance
    - Call git_manager.init_project(repo_url)
    - Return ProjectInitResponse
  - [x] 3.4 Ensure init endpoint tests pass
    - Run ONLY the 5 tests written in 3.1
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- Init endpoint creates project workspace with git
- Config persisted at .haikai/config.json
- Hard errors for missing config or unreachable repo
- Already-initialized projects return clear error

---

#### Task Group 4: V2 Endpoint Layer
**Dependencies:** Task Groups 1, 2, 3

- [x] 4.0 Complete V2 endpoint layer
  - [x] 4.1 Write 6 focused tests for V2 endpoints
    - Test v2 orchestrations commits + pushes + creates PR after completion
    - Test v2 write-spec commits to feature branch
    - Test v2 tasks/generate commits to feature branch
    - Test v2 implement commits + pushes + creates PR
    - Test v2 endpoint returns 400 when project not initialized
    - Test v2 endpoint returns 400 when git config missing
  - [x] 4.2 Create git precondition dependency for v2 endpoints
    - FastAPI dependency function `_require_git_manager(company, project)` that checks
      git_manager.ensure_initialized() and raises HTTPException(400) if not
    - Load git config from env vars, raise 400 if missing
    - Return GitManager instance for use in endpoint
  - [x] 4.3 Implement v2 shape-spec/stream endpoint
    - Mirror v1 shape-spec/stream with git precondition
    - Before streaming: git_manager.pull_latest()
    - After folder event: git_manager.create_feature_branch(f"feature/{folder_name}")
  - [x] 4.4 Implement v2 plan-product/stream endpoint
    - Mirror v1 plan-product/stream with git precondition
    - After completion: pull_latest, create_feature_branch(f"feature/plan-product-{date}"),
      commit_all("feature: plan-product output"), push_branch, create_pull_request
  - [x] 4.5 Implement v2 orchestrations endpoint
    - Mirror v1 orchestrations with git precondition
    - After all steps complete: commit_all(f"feature: {spec_name}"),
      push_branch(f"feature/{spec_name}"), create_pull_request
    - Add commit_sha, branch, pr_url to response
  - [x] 4.6 Implement v2 standards/product/generate endpoint
    - Mirror v1 with git precondition
    - After generation: pull_latest, create_feature_branch(f"feature/product-standards-{date}"),
      commit_all("feature: product standards"), push_branch, create_pull_request
  - [x] 4.7 Implement remaining v2 read-only endpoints
    - Mirror v1 list specs, get spec, get tasks, get history endpoints
    - Add git precondition (require initialized project) but no git write operations
  - [x] 4.8 Implement v2 write-spec, tasks/generate, implement endpoints
    - Mirror v1 individual spec operation endpoints with git precondition
    - write-spec and tasks/generate: commit to current feature branch
    - implement: commit + push + PR
  - [x] 4.9 Implement v2 jobs/orchestrations (async) endpoint
    - Mirror v1 async orchestration with git precondition
    - Git operations happen in background task after completion
  - [x] 4.10 Implement v2 haikai/shape-specs (batch) endpoint
    - Mirror v1 batch shape-specs with git precondition
    - Create feature branch per spec in batch
  - [x] 4.11 Overwrite existing v2 brain-only orchestration
    - Moved brain-only to `/api/v2/orchestrations/brain-only`
    - New `/api/v2/orchestrations` is git-integrated full orchestration
    - Package endpoints (`/package`, `/package/json`) kept as features
  - [x] 4.12 Ensure V2 endpoint tests pass
    - Run ONLY the 6 tests written in 4.1
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- Every v1 project-scoped endpoint has a v2 counterpart
- V2 artifact-producing endpoints commit, push, and create PRs
- V2 read-only endpoints enforce project initialization
- Hard 400 errors for uninitialized projects or missing git config
- V1 endpoints completely unchanged

---

### Integration & Error Handling

#### Task Group 5: Orchestrator Integration & Error Handling
**Dependencies:** Task Groups 1, 2, 4

- [x] 5.0 Complete orchestrator integration and error handling
  - [x] 5.1 Write 5 focused tests for orchestrator git integration
    - Test orchestrator commits after successful orchestration
    - Test push failure does not fail orchestration
    - Test PR creation failure does not fail orchestration
    - Test orchestrator response includes commit_sha, branch, pr_url
    - Test multi-spec orchestration creates separate branches per spec
  - [x] 5.2 Update OrchestrationResponse model
    - Add commit_sha: Optional[str] = None
    - Add branch: Optional[str] = None
    - Add pr_url: Optional[str] = None
  - [x] 5.3 Integrate GitManager into v2 orchestration endpoint
    - V2 orchestration endpoint calls git operations after workflow completes
    - After all steps succeed for a spec: commit_all, push_branch, create_pull_request
    - Populate commit_sha, branch, pr_url on response
    - Between specs: checkout back to default_branch
  - [x] 5.4 Implement git error handling
    - Wrap push_branch in try/except → log error, do not fail orchestration
    - Wrap create_pull_request in try/except → log error
    - Log full error details for debugging
  - [x] 5.5 Ensure orchestrator integration tests pass
    - Run ONLY the 5 tests written in 5.1
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- Orchestrator commits and pushes after successful orchestration
- Push and PR failures logged but do not fail orchestration
- Response model includes git metadata
- Multi-spec orchestration handles branch switching correctly

---

### Docker & Config

#### Task Group 6: Docker Configuration
**Dependencies:** None (can run in parallel with Task Group 1)

- [x] 6.0 Complete Docker configuration
  - [x] 6.1 Write 2 focused tests for config loading
    - Test git config loaded correctly from env vars
    - Test missing required git config raises appropriate error
  - [x] 6.2 Add git identity to Dockerfile
    - `RUN git config --global user.name "Haikai Bot" && git config --global user.email "bot@haikai.ai"`
  - [x] 6.3 Update `.env.docker` with git env vars
    - Add GIT_PROVIDER, GIT_DEFAULT_BRANCH, GIT_AUTO_PUSH, GIT_AUTO_PR
    - Add BITBUCKET_USERNAME, BITBUCKET_APP_PASSWORD (commented out by default)
  - [x] 6.4 Create config loader utility
    - Function to load and validate git config from env vars
    - Return structured config dict or raise if required vars missing
  - [x] 6.5 Ensure config tests pass
    - Run ONLY the 2 tests written in 6.1
    - Do NOT run the entire test suite

**Acceptance Criteria:**
- Docker image has git identity configured
- Git env vars documented in .env.docker
- Config loader validates required vars and returns structured config

---

### Testing

#### Task Group 7: Test Review & Gap Analysis
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and fill critical gaps
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review 7 GitManager tests (Task 1.1) — 7 tests in TestGitManagerInit
    - Review 4 PR creation tests (Task 2.1) — 4 tests in TestPRCreation
    - Review 5 init endpoint tests (Task 3.1) — 5 tests in TestInitEndpoint
    - Review 6 V2 endpoint tests (Task 4.1) — 6 tests in TestV2Endpoints
    - Review 5 orchestrator integration tests (Task 5.1) — 5 tests in TestOrchestratorGitIntegration
    - Review 4 config tests (Task 6.1) — 4 tests in TestGitConfig
    - Total existing tests: 31
  - [x] 7.2 Analyze test coverage gaps
    - Identified gaps: auth URL building, config persistence round-trip, v1 isolation,
      error recovery (push fails), read-only endpoints don't write git
  - [x] 7.3 Write up to 8 additional strategic tests
    - OrchestrationResponse model has git fields
    - Auth URL building: GitHub URL pattern
    - Auth URL building: Bitbucket URL pattern
    - Owner/repo parsing from various URL formats
    - V2 read-only endpoints don't trigger git writes
    - V1 endpoints unaffected by git config
    - Error recovery: push fails but implement response still returned
    - Config persistence: init writes config, load_config reads it back
  - [x] 7.4 Run feature-specific tests only
    - 39 tests total (31 existing + 8 new)
    - All 39 passing
    - V1 endpoints verified unaffected

**Acceptance Criteria:**
- All 39 feature-specific tests pass
- Critical end-to-end workflows covered
- 8 additional tests added for gap analysis
- V1 endpoints verified unaffected

## Execution Order

Recommended implementation sequence:
1. Task Group 6 (Docker Config) — no dependencies, can start immediately
2. Task Group 1 (GitManager Module) — core module, everything depends on this
3. Task Group 2 (PR Creation) — extends GitManager with HTTP API calls
4. Task Group 3 (Init Endpoint) — first user-facing API
5. Task Group 4 (V2 Endpoint Layer) — largest group, mirrors all v1 endpoints
6. Task Group 5 (Orchestrator Integration) — wires git into the orchestration loop
7. Task Group 7 (Test Review) — final validation across all groups
