# Haikai CRUD API

RESTful API endpoints for managing Haikai specifications and tasks with programmatic workflow execution.

## Overview

The Haikai CRUD API provides:
- **Spec Management**: Create, read, list, and delete specifications
- **Task Management**: Generate and retrieve tasks
- **Implementation**: Execute task implementation via Claude CLI
- **Company/Project Structure**: Organize specs by company and project

## Base URL

```
http://localhost:8000/api/v1
```

## Authentication

All endpoints require API key authentication via Bearer token:

```bash
Authorization: Bearer <your-api-key>
```

Set `STANDARDS_API_KEY` in your `.env` file.

## Directory Structure

```
/app/api_workspace/
└── {company}/
    └── {project}/
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
```

## Quick Start

### 1. Create a Specification

```bash
curl -X POST http://localhost:8000/api/v1/specs/acme/backend/write-spec \
  -H "Authorization: Bearer your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "spec_id": "user-registration",
    "requirements": "# Requirements\n\n## Feature Description\nCreate a REST API endpoint for user registration...",
    "metadata": {
      "description": "User registration endpoint",
      "tags": ["api", "authentication"]
    }
  }'
```

**Response:**
```json
{
  "id": "user-registration",
  "company": "acme",
  "project": "backend",
  "title": "User Registration Endpoint",
  "status": "draft",
  "created_at": "2025-01-11T16:00:00Z",
  "updated_at": "2025-01-11T16:00:45Z",
  "files": {
    "requirements": "/app/api_workspace/acme/backend/haikai/specs/user-registration/planning/requirements.md",
    "spec": "/app/api_workspace/acme/backend/haikai/specs/user-registration/spec.md"
  },
  "execution": {
    "command": "/write-spec",
    "duration_seconds": 45,
    "status": "success"
  }
}
```

### 2. Generate Tasks

```bash
curl -X POST http://localhost:8000/api/v1/specs/acme/backend/user-registration/tasks/generate \
  -H "Authorization: Bearer your-api-key"
```

**Response:**
```json
{
  "spec_id": "user-registration",
  "company": "acme",
  "project": "backend",
  "task_groups": [
    {
      "id": 1,
      "name": "Project Setup & Dependencies",
      "status": "pending",
      "tasks": [...]
    }
  ],
  "total_task_groups": 8,
  "total_tasks": 30,
  "created_at": "2025-01-11T16:01:00Z",
  "execution": {
    "command": "/create-tasks",
    "duration_seconds": 35,
    "status": "success"
  }
}
```

### 3. Implement Tasks

```bash
curl -X POST http://localhost:8000/api/v1/specs/acme/backend/user-registration/implement \
  -H "Authorization: Bearer your-api-key"
```

**Response:**
```json
{
  "spec_id": "user-registration",
  "company": "acme",
  "project": "backend",
  "status": "completed",
  "execution": {
    "command": "/implement-tasks",
    "duration_seconds": 180,
    "status": "success",
    "start_time": "2025-01-11T16:02:00Z",
    "end_time": "2025-01-11T16:05:00Z"
  },
  "artifacts": {
    "files_created": 39,
    "files": [
      "/app/api_workspace/acme/backend/app/models/user.py",
      "/app/api_workspace/acme/backend/app/routes/auth.py",
      "..."
    ]
  },
  "summary": "Successfully implemented tasks for user-registration"
}
```

### 4. List All Specs

```bash
curl -X GET http://localhost:8000/api/v1/specs/acme/backend \
  -H "Authorization: Bearer your-api-key"
```

**Response:**
```json
{
  "specs": [
    {
      "id": "user-registration",
      "company": "acme",
      "project": "backend",
      "title": "User Registration Endpoint",
      "status": "completed",
      "created_at": "2025-01-11T16:00:00Z",
      "updated_at": "2025-01-11T16:05:00Z",
      "has_spec": true,
      "has_tasks": true,
      "has_implementation": true
    }
  ],
  "total": 1
}
```

### 5. Get Spec Details

```bash
curl -X GET http://localhost:8000/api/v1/specs/acme/backend/user-registration \
  -H "Authorization: Bearer your-api-key"
```

**Response:**
```json
{
  "id": "user-registration",
  "company": "acme",
  "project": "backend",
  "title": "User Registration Endpoint",
  "status": "completed",
  "created_at": "2025-01-11T16:00:00Z",
  "updated_at": "2025-01-11T16:05:00Z",
  "has_spec": true,
  "has_tasks": true,
  "has_implementation": true,
  "files": {
    "requirements": "/app/api_workspace/acme/backend/haikai/specs/user-registration/planning/requirements.md",
    "spec": "/app/api_workspace/acme/backend/haikai/specs/user-registration/spec.md",
    "tasks": "/app/api_workspace/acme/backend/haikai/specs/user-registration/tasks.md"
  },
  "content": {
    "requirements": "# Requirements\n\n...",
    "spec": "# User Registration Endpoint\n\n...",
    "tasks": "# Tasks Breakdown\n\n..."
  }
}
```

## API Endpoints

### Spec Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/specs/{company}/{project}` | List all specs |
| GET | `/api/v1/specs/{company}/{project}/{spec_id}` | Get spec details |
| POST | `/api/v1/specs/{company}/{project}/write-spec` | Create new spec |
| DELETE | `/api/v1/specs/{company}/{project}/{spec_id}` | Delete spec |

### Task Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/specs/{company}/{project}/{spec_id}/tasks` | Get tasks |
| POST | `/api/v1/specs/{company}/{project}/{spec_id}/tasks/generate` | Generate tasks |

### Implementation

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/specs/{company}/{project}/{spec_id}/implement` | Implement tasks |

### Legacy Endpoint

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/haikai/orchestrate` | Full workflow (existing) |

## Error Handling

### Standard Error Response

```json
{
  "error": {
    "code": "SPEC_NOT_FOUND",
    "message": "Specification 'user-registration' not found",
    "details": {
      "spec_id": "user-registration",
      "expected_path": "/app/api_workspace/acme/backend/haikai/specs/user-registration"
    }
  }
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Created |
| 400 | Bad Request (invalid input) |
| 401 | Unauthorized (invalid API key) |
| 404 | Not Found (spec/tasks don't exist) |
| 409 | Conflict (spec/tasks already exist) |
| 500 | Internal Server Error (Claude CLI failed) |

### Common Error Codes

| Code | Description |
|------|-------------|
| `SPEC_NOT_FOUND` | Specification does not exist |
| `SPEC_ALREADY_EXISTS` | Specification already exists |
| `TASKS_NOT_FOUND` | Tasks file does not exist |
| `INVALID_SPEC_ID` | Invalid specification ID format |
| `CLAUDE_EXECUTION_FAILED` | Claude CLI command failed |
| `INSUFFICIENT_CREDITS` | Anthropic API credits exhausted |

## Spec ID Format

Spec IDs must:
- Use only lowercase letters, numbers, hyphens, and underscores
- Be between 1-100 characters
- Be unique within a company/project

**Valid Examples:**
- `user-registration`
- `payment-gateway`
- `email-notifications`
- `user_profile_v2`

**Invalid Examples:**
- `User-Registration` (uppercase not allowed)
- `user registration` (spaces not allowed)
- `user@registration` (special characters not allowed)

## Configuration

### Environment Variables

```bash
# Required
STANDARDS_API_KEY=your-api-key-here
ANTHROPIC_API_KEY=your-anthropic-key-here

# Optional
API_WORKSPACE_DIR=/app/api_workspace
use_claude_code_subagents=false
standards_as_claude_code_skills=false
```

### Docker Setup

The API runs in a Docker container with:
- Claude CLI pre-installed
- Haikai profiles loaded
- Permissions configured for `/app/api_workspace/`

## Testing

### Health Check

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

### OpenAPI Documentation

Visit `http://localhost:8000/docs` for interactive API documentation (Swagger UI).

## Architecture

### Components

1. **API Layer** (`src/api.py`)
   - FastAPI endpoints
   - Authentication and validation
   - Error handling

2. **Service Layer** (`src/haikai_service.py`)
   - Business logic
   - File system operations
   - Claude CLI integration

3. **Models** (`src/haikai_crud_models.py`)
   - Request/response schemas
   - Data validation

4. **Orchestrator** (`src/haikai_orchestrator.py`)
   - Workflow execution
   - Command sequencing

5. **CLI Executor** (`src/claude_cli_executor.py`)
   - Claude CLI invocation
   - Output capture

### Execution Flow

```
API Request
    ↓
Authentication
    ↓
Service Layer
    ↓
Claude CLI Executor
    ↓
Haikai Commands (/write-spec, /create-tasks, /implement-tasks)
    ↓
File System
    ↓
Response
```

## Best Practices

### 1. Spec ID Naming

Use descriptive, kebab-case names:
```
✅ user-registration
✅ payment-processing
✅ email-notifications
❌ spec1
❌ UserRegistration
❌ user_reg
```

### 2. Requirements Content

Provide clear, detailed requirements:
```markdown
# Requirements

## Feature Description
[Clear description of what to build]

## User Goals
- [User story 1]
- [User story 2]

## Functional Requirements
- [Requirement 1]
- [Requirement 2]

## Non-Functional Requirements
- [Performance, security, etc.]

## Out of Scope
- [What's NOT included]
```

### 3. Error Handling

Always check response status:
```python
response = requests.post(url, headers=headers, json=data)

if response.status_code == 200:
    result = response.json()
    print(f"Success: {result['id']}")
elif response.status_code == 409:
    print("Spec already exists")
elif response.status_code == 500:
    error = response.json()
    print(f"Error: {error['error']['message']}")
```

### 4. Long-Running Operations

Implementation can take several minutes:
```python
import time

# Start implementation
response = requests.post(implement_url, headers=headers)

if response.status_code == 200:
    print("Implementation started...")
    # Wait for completion (synchronous)
    result = response.json()
    print(f"Completed in {result['execution']['duration_seconds']}s")
```

## Troubleshooting

### Issue: "ANTHROPIC_API_KEY not configured"

**Solution**: Set the environment variable in `.env`:
```bash
ANTHROPIC_API_KEY=sk-ant-...
```

### Issue: "Specification already exists"

**Solution**: Either:
1. Delete the existing spec first
2. Use a different spec_id
3. Get the existing spec instead

### Issue: "Claude CLI execution failed"

**Possible causes:**
1. Insufficient API credits
2. Invalid requirements format
3. File system permissions

**Solution**: Check logs in `/app/logs/orchestration/`

### Issue: "tasks.md not found"

**Solution**: Generate tasks first:
```bash
curl -X POST .../tasks/generate
```

## Changelog

See `docs/HAIKAI_CHANGELOG.md` for detailed change history.

## Related Documentation

- [API Design](./API_DESIGN.md) - Detailed API specification
- [Haikai Configuration](./HAIKAI_CONFIGURATION.md) - Configuration reference
- [TODO Features](./TODO_HAIKAI_FEATURES.md) - Planned enhancements
- [Permissions](../config/claude/PERMISSIONS.md) - Security configuration

## Support

For issues or questions:
1. Check the [troubleshooting section](#troubleshooting)
2. Review logs in `/app/logs/orchestration/`
3. Consult the [API Design document](./API_DESIGN.md)
