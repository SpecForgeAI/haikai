# Haikai Workflow API Design

> **⚠️ Historical Design Document**
> This document was the original API design spec. The actual implemented API differs in several ways:
> - All spec endpoints include `{company}/{project}` in the path (e.g., `/api/v1/specs/{company}/{project}`)
> - Authentication uses `Authorization: Bearer <key>` header (not `X-API-Key`)
> - `POST /specs/write` is now `POST /specs/{company}/{project}/write-spec`
> - `POST /specs/workflow` and `POST /webhooks` were not implemented
> - `GET /specs/{spec_id}/implementation/status` was replaced by orchestration status endpoints
>
> **For the current API reference, see [docs/API.md](API.md).**


This document defines the RESTful API endpoints for programmatic access to Haikai workflows.

## Overview

The API provides CRUD operations for specifications and tasks, plus workflow execution endpoints that invoke Claude CLI commands.

### Base URL
```
http://localhost:8000/api/v1
```

### Authentication
```
Authorization: Bearer <your-api-key>
```

### Directory Structure
All resources are organized under a `company/project` hierarchy:
```
/app/api_workspace/{company}/{project}/
├── metamodel/
├── standards/
└── haikai/
    └── specs/{spec_id}/
```

### Breaking Changes (v1.1)
**Parameter Renames:**
- `global_dir` → `company`
- `project_dir` → `project`
- `spec_name` → `spec_id`

**Endpoint Changes:**
- Metamodel: Now requires `company/project` in path
- Write spec: Renamed from `/write` to `/write-spec`
- Orchestrate: Moved to `/orchestrations` with `spec_ids` array

**Model Update:**
- Default LLM: `claude-haiku-4-5-20251001`

---

## Data Models

### Spec ID Format
A spec ID is the feature name (directory name), e.g., `user-registration`

**File Structure:**
```
haikai/specs/{spec_id}/
├── planning/
│   ├── requirements.md
│   └── visuals/
├── spec.md
├── tasks.md
└── implementation/
```

### Spec Object
```json
{
  "id": "user-registration",
  "title": "User Registration Endpoint",
  "status": "draft|in_progress|completed",
  "created_at": "2025-01-11T10:00:00Z",
  "updated_at": "2025-01-11T15:30:00Z",
  "files": {
    "requirements": "haikai/specs/user-registration/planning/requirements.md",
    "spec": "haikai/specs/user-registration/spec.md",
    "tasks": "haikai/specs/user-registration/tasks.md"
  },
  "metadata": {
    "description": "REST API endpoint for user registration",
    "tags": ["api", "authentication", "backend"]
  }
}
```

### Task Object
```json
{
  "spec_id": "user-registration",
  "task_groups": [
    {
      "id": 1,
      "name": "Project Setup & Dependencies",
      "status": "pending|in_progress|completed",
      "tasks": [
        {
          "id": "1.1",
          "title": "Install Required Dependencies",
          "description": "Add all required Python packages...",
          "status": "pending|in_progress|completed",
          "acceptance_criteria": [
            "Add fastapi>=0.109.0",
            "Add sqlalchemy>=2.0.0"
          ],
          "files_to_modify": ["requirements.txt"]
        }
      ]
    }
  ],
  "created_at": "2025-01-11T10:30:00Z",
  "updated_at": "2025-01-11T15:45:00Z"
}
```

---

## API Endpoints

### 1. Spec Management

#### GET /specs
Get all specifications

**Response:**
```json
{
  "specs": [
    {
      "id": "user-registration",
      "title": "User Registration Endpoint",
      "status": "completed",
      "created_at": "2025-01-11T10:00:00Z",
      "updated_at": "2025-01-11T15:30:00Z"
    },
    {
      "id": "user-login",
      "title": "User Login Endpoint",
      "status": "in_progress",
      "created_at": "2025-01-11T11:00:00Z",
      "updated_at": "2025-01-11T14:00:00Z"
    }
  ],
  "total": 2
}
```

---

#### GET /specs/{spec_id}
Get a specific specification

**Parameters:**
- `spec_id` (path): Feature name, e.g., `user-registration`

**Response:**
```json
{
  "id": "user-registration",
  "title": "User Registration Endpoint",
  "status": "completed",
  "created_at": "2025-01-11T10:00:00Z",
  "updated_at": "2025-01-11T15:30:00Z",
  "files": {
    "requirements": "haikai/specs/user-registration/planning/requirements.md",
    "spec": "haikai/specs/user-registration/spec.md",
    "tasks": "haikai/specs/user-registration/tasks.md"
  },
  "content": {
    "requirements": "# Requirements\n\n## Feature Description...",
    "spec": "# User Registration Endpoint Specification\n\n## Overview...",
    "tasks": "# Tasks Breakdown\n\n## Phase 1..."
  },
  "metadata": {
    "description": "REST API endpoint for user registration",
    "tags": ["api", "authentication", "backend"]
  }
}
```

**Error Responses:**
- `404 Not Found`: Spec does not exist

---

#### POST /specs/write
Create a new specification using `/write-spec` command

**Request Body:**
```json
{
  "spec_id": "user-registration",
  "requirements": "# Requirements\n\n## Feature Description\nCreate a REST API endpoint...",
  "metadata": {
    "description": "REST API endpoint for user registration",
    "tags": ["api", "authentication", "backend"]
  }
}
```

**Process:**
1. Create directory: `haikai/specs/{spec_id}/planning/`
2. Write `requirements.md` file
3. Execute: `claude -p "/write-spec for {spec_id}" --allowedTools "Read,Write,Edit,Bash"`
4. Wait for `spec.md` to be created
5. Return spec object

**Response:**
```json
{
  "id": "user-registration",
  "title": "User Registration Endpoint",
  "status": "draft",
  "created_at": "2025-01-11T16:00:00Z",
  "updated_at": "2025-01-11T16:05:00Z",
  "files": {
    "requirements": "haikai/specs/user-registration/planning/requirements.md",
    "spec": "haikai/specs/user-registration/spec.md"
  },
  "execution": {
    "command": "/write-spec",
    "duration_seconds": 45,
    "status": "success"
  }
}
```

**Error Responses:**
- `400 Bad Request`: Invalid spec_id or requirements
- `409 Conflict`: Spec already exists
- `500 Internal Server Error`: Claude CLI execution failed

---

#### DELETE /specs/{spec_id}
Delete a specification

**Parameters:**
- `spec_id` (path): Feature name

**Response:**
```json
{
  "message": "Spec 'user-registration' deleted successfully",
  "deleted_files": [
    "haikai/specs/user-registration/planning/requirements.md",
    "haikai/specs/user-registration/spec.md",
    "haikai/specs/user-registration/tasks.md"
  ]
}
```

---

### 2. Task Management

#### GET /specs/{spec_id}/tasks
Get tasks for a specification

**Parameters:**
- `spec_id` (path): Feature name

**Response:**
```json
{
  "spec_id": "user-registration",
  "task_groups": [
    {
      "id": 1,
      "name": "Project Setup & Dependencies",
      "status": "completed",
      "tasks": [
        {
          "id": "1.1",
          "title": "Install Required Dependencies",
          "status": "completed"
        }
      ]
    }
  ],
  "total_task_groups": 8,
  "total_tasks": 30,
  "completed_tasks": 0,
  "created_at": "2025-01-11T10:30:00Z",
  "updated_at": "2025-01-11T15:45:00Z"
}
```

**Error Responses:**
- `404 Not Found`: Spec or tasks.md does not exist

---

#### POST /specs/{spec_id}/tasks/generate
Generate tasks using `/create-tasks` command

**Parameters:**
- `spec_id` (path): Feature name

**Process:**
1. Verify `spec.md` exists
2. Execute: `claude -p "/create-tasks for {spec_id}" --allowedTools "Read,Write,Edit,Bash"`
3. Wait for `tasks.md` to be created
4. Parse and return task object

**Response:**
```json
{
  "spec_id": "user-registration",
  "task_groups": [...],
  "total_task_groups": 8,
  "total_tasks": 30,
  "execution": {
    "command": "/create-tasks",
    "duration_seconds": 35,
    "status": "success"
  },
  "created_at": "2025-01-11T16:10:00Z"
}
```

**Error Responses:**
- `404 Not Found`: Spec does not exist
- `409 Conflict`: Tasks already exist
- `500 Internal Server Error`: Claude CLI execution failed

---

### 3. Implementation

#### POST /specs/{spec_id}/implement
Implement all tasks using `/implement-tasks` command

**Parameters:**
- `spec_id` (path): Feature name

**Request Body (Optional):**
```json
{
  "task_groups": [1, 2, 3],  // Optional: specific task groups to implement
  "workspace_dir": "/app/api_workspace"  // Optional: override default workspace
}
```

**Process:**
1. Verify `tasks.md` exists
2. Execute: `claude -p "/implement-tasks for {spec_id}" --allowedTools "Read,Write,Edit,Bash"`
3. Monitor file creation in workspace
4. Return implementation results

**Response:**
```json
{
  "spec_id": "user-registration",
  "status": "completed",
  "execution": {
    "command": "/implement-tasks",
    "duration_seconds": 180,
    "status": "success",
    "start_time": "2025-01-11T16:15:00Z",
    "end_time": "2025-01-11T16:18:00Z"
  },
  "artifacts": {
    "files_created": 39,
    "files_modified": 5,
    "directories_created": 12,
    "files": [
      "/app/api_workspace/app/core/config.py",
      "/app/api_workspace/app/models/user.py",
      "/app/api_workspace/app/routes/auth.py",
      "..."
    ]
  },
  "summary": "Successfully implemented 30 tasks across 8 phases"
}
```

**Error Responses:**
- `404 Not Found`: Spec or tasks do not exist
- `500 Internal Server Error`: Implementation failed

---

#### GET /specs/{spec_id}/implementation/status
Get implementation status

**Response:**
```json
{
  "spec_id": "user-registration",
  "status": "in_progress|completed|failed",
  "progress": {
    "total_tasks": 30,
    "completed_tasks": 15,
    "percentage": 50
  },
  "artifacts": {
    "files_created": 20,
    "files_modified": 3
  },
  "last_updated": "2025-01-11T16:17:00Z"
}
```

---

### 4. Workflow Execution (Combined)

#### POST /specs/workflow
Execute complete workflow: write-spec → create-tasks → implement

**Request Body:**
```json
{
  "spec_id": "user-registration",
  "requirements": "# Requirements\n\n## Feature Description...",
  "metadata": {
    "description": "REST API endpoint for user registration",
    "tags": ["api", "authentication", "backend"]
  },
  "auto_implement": true  // Optional: automatically run implementation after tasks
}
```

**Process:**
1. Execute `/write-spec`
2. Execute `/create-tasks`
3. If `auto_implement=true`, execute `/implement-tasks`
4. Return combined results

**Response:**
```json
{
  "spec_id": "user-registration",
  "status": "completed",
  "steps": [
    {
      "step": "write-spec",
      "status": "success",
      "duration_seconds": 45
    },
    {
      "step": "create-tasks",
      "status": "success",
      "duration_seconds": 35
    },
    {
      "step": "implement-tasks",
      "status": "success",
      "duration_seconds": 180
    }
  ],
  "total_duration_seconds": 260,
  "artifacts": {
    "spec": "haikai/specs/user-registration/spec.md",
    "tasks": "haikai/specs/user-registration/tasks.md",
    "files_created": 39
  }
}
```

---

## Error Handling

### Standard Error Response
```json
{
  "error": {
    "code": "SPEC_NOT_FOUND",
    "message": "Specification 'user-registration' does not exist",
    "details": {
      "spec_id": "user-registration",
      "expected_path": "haikai/specs/user-registration"
    }
  }
}
```

### Error Codes
- `SPEC_NOT_FOUND`: Specification does not exist
- `SPEC_ALREADY_EXISTS`: Specification already exists
- `TASKS_NOT_FOUND`: Tasks file does not exist
- `INVALID_SPEC_ID`: Invalid specification ID format
- `CLAUDE_EXECUTION_FAILED`: Claude CLI command failed
- `INSUFFICIENT_CREDITS`: Anthropic API credits exhausted
- `WORKSPACE_PERMISSION_DENIED`: Cannot write to workspace directory

---

## Rate Limiting

- **Rate Limit**: 10 requests per minute per API key
- **Burst**: 3 requests
- **Headers**:
  - `X-RateLimit-Limit`: 10
  - `X-RateLimit-Remaining`: 7
  - `X-RateLimit-Reset`: 1705000000

---

## Webhooks (Future)

### POST /webhooks
Register webhook for workflow events

**Events:**
- `spec.created`
- `spec.updated`
- `tasks.generated`
- `implementation.started`
- `implementation.completed`
- `implementation.failed`

---

## Implementation Status

✅ **IMPLEMENTED** - All endpoints are now available in `src/api.py`

### New Files Created:
- `src/haikai_crud_models.py` - Pydantic models for CRUD operations
- `src/haikai_service.py` - Service layer for business logic

### Integration:
- Reuses existing `HaikaiOrchestrator` for workflow execution
- Uses existing `ClaudeCLIExecutor` for command execution
- Integrates with existing authentication system (`STANDARDS_API_KEY`)

## Implementation Notes

### File System Structure
```
/app/api_workspace/
└── haikai/
    ├── product/
    │   ├── mission.md
    │   ├── tech-stack.md
    │   └── roadmap.md
    └── specs/
        └── {spec_id}/
            ├── planning/
            │   ├── requirements.md
            │   └── visuals/
            ├── spec.md
            ├── tasks.md
            └── implementation/
                └── (generated code files)
```

### Claude CLI Invocation
```python
import subprocess

def execute_claude_command(command: str, spec_id: str) -> dict:
    cmd = [
        "claude",
        "-p",
        f"{command} for {spec_id}",
        "--allowedTools", "Read,Write,Edit,Bash"
    ]
    
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=300,
        cwd="/app/api_workspace"
    )
    
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "returncode": result.returncode
    }
```

### Status Tracking
- Store execution status in SQLite database
- Track file creation timestamps
- Monitor Claude CLI process

---

## Testing

### Example cURL Commands

**Get all specs:**
```bash
curl -X GET http://localhost:8000/api/v1/specs \
  -H "X-API-Key: your-api-key"
```

**Create spec:**
```bash
curl -X POST http://localhost:8000/api/v1/specs/write \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "spec_id": "user-registration",
    "requirements": "# Requirements\n\n..."
  }'
```

**Generate tasks:**
```bash
curl -X POST http://localhost:8000/api/v1/specs/user-registration/tasks/generate \
  -H "X-API-Key: your-api-key"
```

**Implement:**
```bash
curl -X POST http://localhost:8000/api/v1/specs/user-registration/implement \
  -H "X-API-Key: your-api-key"
```

---

## Next Steps

1. Implement FastAPI routes
2. Add database models for tracking
3. Create service layer for Claude CLI execution
4. Add logging and monitoring
5. Write integration tests
6. Generate OpenAPI documentation
