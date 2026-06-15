# Standards Extractor REST API

Complete REST API reference for the Standards Extractor application.

## Base URL

```
http://localhost:8000
```

## Authentication

All API endpoints (except `/health`) require API key authentication:

```
Authorization: Bearer <STANDARDS_API_KEY>
```

See [AUTHENTICATION.md](AUTHENTICATION.md) for full auth details including OAuth token support for LLM providers.

---

## Endpoints Overview

### Health & Utility
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |

### Standards Generation
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/standards/global/generate` | Generate global baseline standards |
| POST | `/api/v1/standards/product/generate` | Generate product-level standards |
| GET | `/api/v1/metamodels/{company}/{project}/{metamodel_id}` | Retrieve architectural metamodel |

### Haikai CRUD (Specs)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/specs/{company}/{project}` | List all specs |
| GET | `/api/v1/specs/{company}/{project}/{spec_id}` | Get spec detail |
| POST | `/api/v1/specs/{company}/{project}/write-spec` | Write spec from requirements |
| DELETE | `/api/v1/specs/{company}/{project}/{spec_id}` | Delete a spec |
| GET | `/api/v1/specs/{company}/{project}/{spec_id}/tasks` | Get tasks for a spec |
| POST | `/api/v1/specs/{company}/{project}/{spec_id}/tasks/generate` | Generate tasks from spec |
| POST | `/api/v1/specs/{company}/{project}/{spec_id}/implement` | Implement tasks |

### Orchestrations
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/orchestrations` | Run full Haikai workflow |
| GET | `/api/v1/orchestrations/{id}/status` | Check orchestration status |
| GET | `/api/v1/orchestrations/{id}/logs` | View orchestration logs |

### Shape-Spec (Streaming Chat)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/shape-spec/stream` | SSE streaming shape-spec conversation |
| GET | `/api/v1/shape-spec/history` | Get conversation history |
| DELETE | `/api/v1/shape-spec` | Clear conversation |
| POST | `/api/v1/haikai/shape-specs` | Create shape-spec folders |
| GET | `/api/v1/haikai/shape-specs/{company}/{project}` | List shape-specs |

### Plan-Product (Streaming Chat)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/plan-product/stream` | SSE streaming product planning |
| GET | `/api/v1/plan-product/history` | Get conversation history |
| DELETE | `/api/v1/plan-product` | Clear conversation |

### Story-Component-Anchor (Streaming Chat)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/story-component-anchor/stream` | SSE streaming story component anchoring |

### Async Jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/jobs/orchestrations` | Queue async orchestration job |
| GET | `/api/v1/jobs/{job_id}` | Get job status |
| GET | `/api/v1/jobs` | List all jobs |
| DELETE | `/api/v1/jobs/{job_id}` | Cancel a job |

---

## Endpoint Details

### Health Check

**GET** `/health`

```bash
curl http://localhost:8000/health
```

**Response:**
```json
{
  "status": "healthy",
  "service": "standards-extractor"
}
```

---

### Generate Global Standards

**POST** `/api/v1/standards/global/generate`

Generate global baseline standards from source code analysis.

**Request Body:**
```json
{
  "company": "acme",
  "sources": ["./src", "https://github.com/org/repo"],
  "recursive": true,
  "technical_documents": {
    "tech_stack": ["https://github.com/org/repo/blob/main/docs/ARCH.md"],
    "coding_style": [],
    "conventions": [],
    "error_handling": [],
    "validation": []
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| company | string | Yes | Company name |
| sources | string[] | No | Source paths/URLs to analyze |
| recursive | boolean | No (default: true) | Recursively scan directories |
| technical_documents | object | No | Technical documents by category |

**Example:**
```bash
curl -X POST http://localhost:8000/api/v1/standards/global/generate \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "sources": ["./src"]
  }'
```

**Response:**
```json
{
  "success": true,
  "mode": "generate_global_standards",
  "output_dir": "/app/api_workspace/acme",
  "outputs": [
    "/app/api_workspace/acme/haikai/profiles/default/standards/global/tech-stack.md",
    "/app/api_workspace/acme/haikai/profiles/default/standards/global/coding-style.md"
  ],
  "message": "Successfully generated global standards",
  "errors": null
}
```

---

### Generate Product Standards

**POST** `/api/v1/standards/product/generate`

Generate product-level technical standards.

**Request Body:**
```json
{
  "company": "acme",
  "project": "backend",
  "sources": ["./src"],
  "recursive": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| company | string | Yes | Company name |
| project | string | Yes | Project name |
| sources | string[] | No | Source paths/URLs to analyze |
| recursive | boolean | No (default: true) | Recursively scan directories |

**Example:**
```bash
curl -X POST http://localhost:8000/api/v1/standards/product/generate \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{"company": "acme", "project": "backend"}'
```

---

### Get Metamodel

**GET** `/api/v1/metamodels/{company}/{project}/{metamodel_id}`

Retrieve architectural metamodel from external system.

**Path Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| company | string | Company name |
| project | string | Project name |
| metamodel_id | string | External metamodel identifier |

**Example:**
```bash
curl http://localhost:8000/api/v1/metamodels/acme/backend/proj_123 \
  -H "Authorization: Bearer your-api-key"
```

---

### Haikai CRUD Operations

#### List Specs

**GET** `/api/v1/specs/{company}/{project}`

List all specs for a company/project.

```bash
curl http://localhost:8000/api/v1/specs/acme/backend \
  -H "Authorization: Bearer your-api-key"
```

#### Get Spec Detail

**GET** `/api/v1/specs/{company}/{project}/{spec_id}`

Get details for a specific spec including content of spec.md, tasks.md, etc.

#### Write Spec

**POST** `/api/v1/specs/{company}/{project}/write-spec`

Generate spec.md from a requirements document.

**Request Body:**
```json
{
  "spec_intent": "title: User Auth\n\ncontext: ...\n\ngoal: ...\n\nrequirements:\n  - OAuth2"
}
```

#### Generate Tasks

**POST** `/api/v1/specs/{company}/{project}/{spec_id}/tasks/generate`

Generate tasks.md from an existing spec.

#### Implement Tasks

**POST** `/api/v1/specs/{company}/{project}/{spec_id}/implement`

Implement all tasks for a spec.

#### Delete Spec

**DELETE** `/api/v1/specs/{company}/{project}/{spec_id}`

Delete a spec and all its files.

---

### Orchestrations

#### Run Orchestration

**POST** `/api/v1/orchestrations`

Execute a complete Haikai workflow: write-spec → create-tasks → implement-tasks.

**Request Body:**
```json
{
  "company": "acme",
  "project": "backend",
  "spec_intents": [
    "title: User Authentication\n\ncontext: ...\n\ngoal: Implement OAuth2\n\nrequirements:\n  - Google OAuth\n  - JWT tokens"
  ],
  "options": {
    "stop_on_error": true,
    "retry_on_failure": false,
    "max_retries": 1,
    "timeout_seconds": null
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| company | string | Yes | Company name |
| project | string | Yes | Project name |
| spec_intents | string[] | Yes (min 1) | Spec intents with title, context, goal, requirements |
| context_files | string[] | No | Additional context file paths |
| options | object | No | Execution options |

**Response:**
```json
{
  "success": true,
  "spec_names": ["user-authentication"],
  "results": [
    {"step": 1, "command": "/write-spec", "status": "success", "execution_time_seconds": 32.1},
    {"step": 2, "command": "/create-tasks", "status": "success", "execution_time_seconds": 28.5},
    {"step": 3, "command": "/implement-tasks", "status": "success", "execution_time_seconds": 180.5}
  ],
  "total_execution_time_seconds": 286.3
}
```

#### Check Status

**GET** `/api/v1/orchestrations/{orchestration_id}/status`

#### View Logs

**GET** `/api/v1/orchestrations/{orchestration_id}/logs`

---

### Streaming Chat Endpoints

All streaming endpoints use **Server-Sent Events (SSE)** for real-time response delivery.

#### Shape-Spec Stream

**POST** `/api/v1/shape-spec/stream`

Interactive specification refinement conversation with Claude.

**Request Body:**
```json
{
  "company": "acme",
  "project": "backend",
  "message": "I need a user authentication system with OAuth2",
  "session_mode": "new"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| company | string | Yes | Company name |
| project | string | Yes | Project name |
| message | string | Yes | User message |
| session_mode | string | No (default: "resume") | "resume" or "new" |

**SSE Response Events:**
```
data: {"type": "content", "delta": "I'll help you define..."}
data: {"type": "skill_invoked", "skill": "write-spec"}
data: {"type": "file_modified", "path": "haikai/specs/user-auth/spec.md"}
data: {"type": "questions", "questions": [{"id": "q1", "text": "What auth providers?"}]}
data: {"type": "folder", "folder_name": "user-auth"}
data: {"type": "done"}
```

**Session Modes:**
- `resume` (default): Continue existing conversation or start new
- `new`: Clear session and start fresh (auto-prefixes with `/shape-spec`)

#### Plan-Product Stream

**POST** `/api/v1/plan-product/stream`

Product planning conversation. Same request/response format as shape-spec. Auto-prefixes with `/plan-product` for new sessions.

#### Story-Component-Anchor Stream

**POST** `/api/v1/story-component-anchor/stream`

Story component anchoring conversation.

#### Get History

**GET** `/api/v1/shape-spec/history?company=acme&project=backend`
**GET** `/api/v1/plan-product/history?company=acme&project=backend`

#### Clear Session

**DELETE** `/api/v1/shape-spec`
**DELETE** `/api/v1/plan-product`

```json
{"company": "acme", "project": "backend"}
```

---

### Async Job Queue

#### Queue Orchestration Job

**POST** `/api/v1/jobs/orchestrations`

Same body as `POST /api/v1/orchestrations` but runs asynchronously.

**Response:**
```json
{
  "job_id": "abc123",
  "status": "queued",
  "message": "Job queued successfully"
}
```

#### Get Job Status

**GET** `/api/v1/jobs/{job_id}`

#### List Jobs

**GET** `/api/v1/jobs`

**Query Parameters:**
- `company` (optional): Filter by company
- `status` (optional): Filter by status (queued, running, completed, failed, cancelled)

#### Cancel Job

**DELETE** `/api/v1/jobs/{job_id}`

---

## Error Responses

### 401 Unauthorized
```json
{"detail": "Invalid API key"}
```

### 422 Validation Error
```json
{
  "detail": [
    {"loc": ["body", "company"], "msg": "field required", "type": "value_error.missing"}
  ]
}
```

### 500 Internal Server Error
```json
{"detail": "Internal server error message"}
```

---

## CORS

Currently restricted to:
- `http://localhost:5173`
- `http://127.0.0.1:5173`

Update `src/api.py` CORS origins for production deployment.
