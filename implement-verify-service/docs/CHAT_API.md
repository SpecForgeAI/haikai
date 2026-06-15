# Conversational Chat API Documentation

**Version:** 4.0
**Date:** 2026-03-14

## 1. Overview

The Conversational Chat API provides a streaming interface for interactive conversations with Claude Code, with full access to all Haikai skills. This API enables iterative specification refinement through back-and-forth dialogue, primarily designed for the `/shape-spec` workflow but accessible to all Haikai skills.

The implementation provides real-time token-by-token streaming via Server-Sent Events (SSE), persistent session management with deterministic UUIDs, comprehensive audit logging in JSONL format, and cross-platform support for both Windows and Unix environments.

**V2 endpoints** add mandatory git integration — every artifact-producing operation commits, pushes, and creates a PR automatically. V1 endpoints remain unchanged for backwards compatibility.

### Prerequisites for V2 Endpoints

All V2 endpoints require:

1. **Git configuration** — `GIT_PROVIDER`, `GITHUB_TOKEN` (or Bitbucket creds) set in environment
2. **Project initialized** — `POST /projects/init` must have been called first

Missing either returns HTTP 400.

## 2. Architecture

### 2.1. Key Components

- **`ClaudeChatExecutor`:** Manages Claude CLI subprocess interaction with session persistence and real-time streaming.
- **`AuditLogger`:** Logs all conversational interactions to JSONL format for history and auditing.
- **`Chat Models`:** Pydantic models for request/response validation.
- **`GitManager`:** (V2) Handles git operations — branching, commits, push, PR creation for GitHub and Bitbucket.
- **Haikai Skills:** Includes a new `/ask-questions` skill for explicit question asking.

### 2.2. Session Management

- **Session ID:** Deterministic UUID generated from `{company}_{project}`.
- **Session Modes:** `resume` (default) and `new` (clears session).
- **Workspace:** `api_workspace/{company}/{project}/` with project-scoped settings and commands.

### 2.3. Permission Handling

- Uses `--dangerously-skip-permissions` flag for automated operation, which is safe within the project-scoped workspace.

## 3. Project Initialization (V2 Prerequisite)

### 3.1. POST /projects/init

One-off operation to initialize a project workspace from a git repository. Required before any V2 endpoint can be used.

**Request:**
```json
{
  "company": "acme",
  "project": "backend",
  "repo_url": "https://github.com/acme/backend.git"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Project initialized (brownfield)",
  "project_dir": "/app/api_workspace/acme/backend",
  "mode": "brownfield"
}
```

**Modes:**
- **brownfield** — existing repo with content is cloned into workspace
- **greenfield** — empty repo gets scaffold (README.md + haikai/.gitkeep), initial commit, and push

**Errors:**
- `400` — already initialized, repo unreachable, or git config missing
- `401` — invalid API key

**curl example:**
```bash
curl -X POST http://localhost:8000/projects/init \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "repo_url": "https://github.com/acme/backend.git"
  }'
```

## 4. V1 Endpoints (No Git)

### 4.1. POST /api/v1/shape-spec/stream

Start or continue a conversational shape-spec session with streaming.

**Request:**
```json
{
  "company": "string",
  "project": "string",
  "message": "string",
  "session_mode": "resume"
}
```

**Automatic /shape-spec Prefix:**
When `session_mode: "new"` is used, the message is automatically prefixed with `/shape-spec`.

**Response:** Server-Sent Events (SSE) stream

**Event Types:**
- `content`: Streaming text response from Claude
- `skill_invoked`: Haikai skill was invoked
- `file_modified`: File was created or modified
- `error`: Error occurred during processing
- `done`: Stream complete, connection can be closed
- `questions`: Structured list of questions from Claude
- `folder`: Folder where the specification was created

**Event Formats:**

**`questions`**
```json
{
  "type": "questions",
  "questions": [
    {
      "id": "c3879034-347e-444d-93c2-e1671b885aab",
      "question": "How should created_at/updated_at be managed?"
    }
  ]
}
```

**`folder`**
```json
{
  "type": "folder",
  "folder": "2026-01-28-user-authentication"
}
```

**Event Sequence:**
The `questions` and `folder` events are sent *after* the `done` event.
```
data: {"type": "content", "delta": "I have some questions..."}
data: {"type": "skill_invoked", "skill": "ask-questions"}
data: {"type": "done"}
data: {"type": "questions", "questions": [...]}
data: {"type": "folder", "folder": "..."}
```

### 4.2. GET /api/v1/shape-spec/history

Retrieve the full conversation history for a project.

**Query Parameters:** `company`, `project`

### 4.3. DELETE /api/v1/shape-spec

Clear the conversation history for a project.

### 4.4. POST /api/v1/plan-product/stream

Start or continue a conversational plan-product session with streaming.

**Request:**
```json
{
  "company": "string",
  "project": "string",
  "message": "string",
  "session_mode": "resume"
}
```

Uses the same SSE streaming, event types, and session management as the shape-spec endpoint. The `/plan-product` skill prefix is automatically added for new sessions.

### 4.5. GET /api/v1/plan-product/history

Retrieve the full conversation history for a plan-product session.

**Query Parameters:** `company`, `project`

### 4.6. DELETE /api/v1/plan-product

Clear the conversation history for a plan-product session.

### 4.7. POST /api/v1/story-component-anchor/stream

Stream Storybook stories from a component contract. Always starts a new session.

**Request:**
```json
{
  "company": "string",
  "project": "string",
  "contract": {},
  "session_mode": "new"
}
```

**Response:** SSE stream with the same event types as shape-spec.

## 5. V2 Endpoints (Git-Integrated)

All V2 endpoints enforce git preconditions (initialized project + git config) and return HTTP 400 if not met. V1 endpoints are completely unaffected.

### 5.1. POST /api/v2/shape-spec/stream

Git-integrated shape-spec streaming. Same request/response as V1, with:
- **Before streaming:** pulls latest from default branch
- **On `folder` event:** creates a feature branch `feature/{folder_name}`

**Request:** Same as V1 (`company`, `project`, `message`, `session_mode`)

**curl example:**
```bash
curl -X POST http://localhost:8000/api/v2/shape-spec/stream \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "message": "Build a user authentication system with email/password login, JWT tokens, and password reset flow",
    "session_mode": "new"
  }'
```

**Additional SSE events:**
- `warning`: Git branch creation failed (non-fatal)

### 5.2. POST /api/v2/plan-product/stream

Git-integrated plan-product streaming. Same request/response as V1, with:
- **After completion:** creates feature branch `feature/plan-product-{date}`, commits output, pushes, and creates a PR

**Request:** Same as V1 (`company`, `project`, `message`, `session_mode`)

**curl example:**
```bash
curl -X POST http://localhost:8000/api/v2/plan-product/stream \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "message": "We are building a SaaS platform for project management",
    "session_mode": "new"
  }'
```

### 5.3. POST /api/v2/orchestrations

Git-integrated full orchestration: write-spec → create-tasks → implement-tasks.

After orchestration completes, for each spec: commits all output as a single commit on `feature/{spec_name}`, pushes, and creates a PR.

**Request:**
```json
{
  "company": "acme",
  "project": "backend",
  "spec_intents": [
    {
      "spec_name": "2026-03-14-user-authentication",
      "session_id": "abc12345-session-uuid"
    }
  ]
}
```

**Response:** `OrchestrationResponse` with additional git fields:
```json
{
  "success": true,
  "spec_names": ["2026-03-14-user-authentication"],
  "session_ids": {"2026-03-14-user-authentication": "abc12345-session-uuid"},
  "results": [...],
  "total_execution_time_seconds": 120.5,
  "orchestration_log": "/app/api_workspace/logs/orchestration/...",
  "commit_sha": "deadbeef1234567890",
  "branch": "feature/2026-03-14-user-authentication",
  "pr_url": "https://github.com/acme/backend/pull/42"
}
```

**Note:** `spec_intents` come from a prior shape-spec session. The `spec_name` is the folder name from the `folder` event, and `session_id` is the session UUID.

**curl example:**
```bash
curl -X POST http://localhost:8000/api/v2/orchestrations \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": [
      {
        "spec_name": "2026-03-14-user-authentication",
        "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      }
    ]
  }'
```

### 5.4. POST /api/v2/specs/{company}/{project}/write-spec

Git-integrated write-spec. After writing the spec, commits to the current feature branch.

**Request:**
```json
{
  "spec_id": "2026-03-14-user-authentication"
}
```

**curl example:**
```bash
curl -X POST http://localhost:8000/api/v2/specs/acme/backend/write-spec \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d '{"spec_id": "2026-03-14-user-authentication"}'
```

### 5.5. POST /api/v2/specs/{company}/{project}/{spec_id}/tasks/generate

Git-integrated task generation. After generating tasks, commits to the current feature branch.

**curl example:**
```bash
curl -X POST http://localhost:8000/api/v2/specs/acme/backend/2026-03-14-user-authentication/tasks/generate \
  -H "Authorization: Bearer changeit"
```

### 5.6. POST /api/v2/specs/{company}/{project}/{spec_id}/implement

Git-integrated task implementation. After implementation, commits all output, pushes the feature branch, and creates a PR.

**Request (optional):**
```json
{
  "task_groups": [1, 2]
}
```

**curl example (implement all tasks):**
```bash
curl -X POST http://localhost:8000/api/v2/specs/acme/backend/2026-03-14-user-authentication/implement \
  -H "Authorization: Bearer changeit"
```

### 5.7. POST /api/v2/standards/product/generate

Git-integrated product standards generation. After generation, commits to `feature/product-standards-{date}`, pushes, and creates a PR.

**Request:** Same as V1 `GenerateProductStandardsRequest`.

**curl example:**
```bash
curl -X POST http://localhost:8000/api/v2/standards/product/generate \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend"
  }'
```

### 5.8. POST /api/v2/jobs/orchestrations

Git-integrated async orchestration. Creates a background job. Git operations happen after completion.

**Request:** Same as `POST /api/v2/orchestrations`.

**curl example:**
```bash
curl -X POST http://localhost:8000/api/v2/jobs/orchestrations \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": [
      {
        "spec_name": "2026-03-14-user-authentication",
        "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      }
    ]
  }'
```

### 5.9. POST /api/v2/haikai/shape-specs

Git-integrated batch shape-specs. Creates a feature branch per spec in the batch.

**Request:** Same as V1 `ShapeSpecRequest`.

**curl example:**
```bash
curl -X POST http://localhost:8000/api/v2/haikai/shape-specs \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": [
      "title: User Registration\n\ncontext: We need a user registration flow...\n\ngoal: Allow users to sign up with email and password"
    ]
  }'
```

### 5.10. V2 Read-Only Endpoints

These enforce project initialization but perform no git writes.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v2/specs/{company}/{project}` | List all specifications |
| GET | `/api/v2/specs/{company}/{project}/{spec_id}` | Get specification details |
| GET | `/api/v2/specs/{company}/{project}/{spec_id}/tasks` | Get tasks for a specification |
| GET | `/api/v2/shape-spec/history` | Get shape-spec conversation history |
| GET | `/api/v2/plan-product/history` | Get plan-product conversation history |

**curl example:**
```bash
curl http://localhost:8000/api/v2/specs/acme/backend \
  -H "Authorization: Bearer changeit"
```

## 6. Usage Workflow

### 6.1. V1 Workflow (No Git)

1. **Start Conversation:** Client sends initial request with `session_mode: "new"`.
2. **Claude Asks Questions:** Claude invokes the `/ask-questions` skill. The API sends a `questions` event after the `done` event.
3. **Client Gathers Answers:** Client displays questions to the user and gathers answers.
4. **User Responds:** Client sends user's answers back to the API (without `session_mode`).
5. **Loop or Complete:** The process repeats until Claude has no more questions.
6. **Claude Creates Spec:** Claude invokes the `/write-spec` skill. The API sends a `folder` event with the spec folder name.
7. **Client Triggers Implementation:** Client uses the folder name to call `/api/v1/orchestrations` and start the implementation.

### 6.2. V2 Workflow (Git-Integrated)

1. **Initialize Project:** `POST /projects/init` with repo URL (one-off).
2. **Plan Product:** `POST /api/v2/plan-product/stream` — creates mission.md, roadmap.md, tech-stack.md. Commits to `feature/plan-product-{date}` branch and creates PR.
3. **Shape Spec:** `POST /api/v2/shape-spec/stream` — interactive conversation to shape requirements. Creates `feature/{spec_name}` branch on folder event.
4. **Orchestrate:** `POST /api/v2/orchestrations` — runs write-spec → create-tasks → implement-tasks. Commits, pushes, and creates PR per spec.
5. **Review PR:** Review the auto-created PR on GitHub/Bitbucket.

**Alternatively, run individual steps:**
3a. `POST /api/v2/specs/{company}/{project}/write-spec` — commits to feature branch
3b. `POST /api/v2/specs/{company}/{project}/{spec_id}/tasks/generate` — commits to feature branch
3c. `POST /api/v2/specs/{company}/{project}/{spec_id}/implement` — commits, pushes, creates PR

### 6.3. Git Branching Strategy

| Operation | Branch Name |
|-----------|-------------|
| Plan Product | `feature/plan-product-{date}` |
| Product Standards | `feature/product-standards-{date}` |
| Shape Spec / Orchestration | `feature/{spec_name}` |

- **1 orchestrate request = 1 commit** (not per-step)
- Commit prefix: `feature:` (not `feat:`)
- Feature branches pushed only after implement-tasks
- Branches are never deleted after PR merge

### 6.4. Error Handling (V2)

- **Push failure:** Logged as error, does NOT fail the orchestration — code was still written successfully.
- **PR creation failure:** Logged as error, does NOT fail the orchestration.
- **Missing git config:** Hard 400 error on any V2 endpoint.
- **Project not initialized:** Hard 400 error on any V2 endpoint.

## 7. Version History

- **v4.0 (2026-03-14):** Added V2 git-integrated endpoints, project initialization, branching strategy, and error handling documentation.
- **v3.3 (2026-02-20):** Documented plan-product and story-component-anchor endpoints.
- **v3.2 (2026-01-28):** Added `questions` and `folder` event types and `/ask-questions` skill.
- **v3.1 (2026-01-28):** Added automatic `/shape-spec` prefix for new sessions.
- **v3.0 (2026-01-28):** Initial release of the conversational chat API.
