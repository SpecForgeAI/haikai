# Async Job Queue API

This document describes the asynchronous job queue API for handling long-running operations without blocking HTTP connections.

## Overview

The async job queue system allows you to:

- Submit long-running operations (like orchestrations) that return immediately with a job ID
- Poll for job status and progress
- Retrieve results when jobs complete
- Cancel queued or running jobs
- List and filter jobs by status, company, or project

## Architecture

The system consists of:

1. **Job Queue**: SQLite-based storage for job metadata
2. **Background Worker**: Separate process that executes queued jobs
3. **API Endpoints**: RESTful endpoints for job management

## Endpoints

### Create Orchestration Job

**POST** `/api/v1/jobs/orchestrations`

Create an async orchestration job that returns immediately.

**Request Body:**
```json
{
  "company": "acme",
  "project": "backend",
  "spec_intents": [
    "title: User Registration\n\ncontext: Users need accounts...\n\ngoal: Implement secure registration..."
  ],
  "context_files": null,
  "options": {
    "stop_on_error": true,
    "retry_on_failure": false,
    "max_retries": 1,
    "timeout_seconds": null
  }
}
```

**Response:**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "created_at": "2026-01-24T12:00:00"
}
```

### Get Job Status

**GET** `/api/v1/jobs/{job_id}`

Get the current status and result of a job.

**Response (Queued):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "orchestration",
  "status": "queued",
  "company": "acme",
  "project": "backend",
  "created_at": "2026-01-24T12:00:00",
  "started_at": null,
  "completed_at": null,
  "progress": null,
  "result": null,
  "error": null,
  "logs_url": null
}
```

**Response (Running):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "orchestration",
  "status": "running",
  "company": "acme",
  "project": "backend",
  "created_at": "2026-01-24T12:00:00",
  "started_at": "2026-01-24T12:00:05",
  "completed_at": null,
  "progress": {
    "current_step": 2,
    "total_steps": 3,
    "step_description": "Creating tasks",
    "percentage": 66
  },
  "result": null,
  "error": null,
  "logs_url": null
}
```

**Response (Completed):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "orchestration",
  "status": "completed",
  "company": "acme",
  "project": "backend",
  "created_at": "2026-01-24T12:00:00",
  "started_at": "2026-01-24T12:00:05",
  "completed_at": "2026-01-24T12:15:30",
  "progress": null,
  "result": {
    "success": true,
    "spec_names": ["2026-01-24-user-registration"],
    "results": [
      {
        "step": 1,
        "command": "/write-spec",
        "status": "success",
        "output_paths": ["/path/to/spec.md"],
        "execution_time_seconds": 45.2,
        "log_file": "/path/to/log"
      }
    ],
    "total_execution_time_seconds": 925.5,
    "orchestration_log": "/path/to/orchestration.log"
  },
  "error": null,
  "logs_url": "/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000/logs"
}
```

**Response (Failed):**
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "orchestration",
  "status": "failed",
  "company": "acme",
  "project": "backend",
  "created_at": "2026-01-24T12:00:00",
  "started_at": "2026-01-24T12:00:05",
  "completed_at": "2026-01-24T12:05:30",
  "progress": null,
  "result": null,
  "error": "ANTHROPIC_API_KEY not configured",
  "logs_url": null
}
```

### List Jobs

**GET** `/api/v1/jobs`

List jobs with optional filters.

**Query Parameters:**
- `status` (optional): Filter by status (queued, running, completed, failed, cancelled)
- `company` (optional): Filter by company name
- `project` (optional): Filter by project name
- `limit` (optional): Maximum number of jobs to return (default: 100)

**Example:**
```
GET /api/v1/jobs?status=completed&company=acme&limit=10
```

**Response:**
```json
{
  "jobs": [
    {
      "job_id": "550e8400-e29b-41d4-a716-446655440000",
      "type": "orchestration",
      "status": "completed",
      "company": "acme",
      "project": "backend",
      "created_at": "2026-01-24T12:00:00",
      "started_at": "2026-01-24T12:00:05",
      "completed_at": "2026-01-24T12:15:30",
      "progress": null,
      "result": {...},
      "error": null,
      "worker_id": "worker-1",
      "logs_path": null
    }
  ],
  "count": 1
}
```

### Cancel Job

**DELETE** `/api/v1/jobs/{job_id}`

Cancel a queued or running job.

**Response:**
```json
{
  "message": "Job cancelled",
  "job_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

## Job Statuses

- **queued**: Job is waiting to be processed
- **running**: Job is currently being executed by a worker
- **completed**: Job finished successfully
- **failed**: Job encountered an error
- **cancelled**: Job was cancelled by user

## Usage Example

### Python

```python
import requests
import time

API_URL = "http://localhost:8000"
API_KEY = "your-api-key"

headers = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# Create job
response = requests.post(
    f"{API_URL}/api/v1/jobs/orchestrations",
    headers=headers,
    json={
        "company": "acme",
        "project": "backend",
        "spec_intents": ["title: User Registration\n\ncontext: ...\n\ngoal: ..."]
    }
)

job_id = response.json()["job_id"]
print(f"Created job: {job_id}")

# Poll for completion
while True:
    response = requests.get(
        f"{API_URL}/api/v1/jobs/{job_id}",
        headers=headers
    )
    
    job = response.json()
    status = job["status"]
    
    print(f"Job status: {status}")
    
    if status == "completed":
        print("Job completed successfully!")
        print(f"Result: {job['result']}")
        break
    elif status == "failed":
        print(f"Job failed: {job['error']}")
        break
    elif status == "cancelled":
        print("Job was cancelled")
        break
    
    time.sleep(5)  # Poll every 5 seconds
```

### cURL

```bash
# Create job
curl -X POST http://localhost:8000/api/v1/jobs/orchestrations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "acme",
    "project": "backend",
    "spec_intents": ["title: User Registration\n\ncontext: ...\n\ngoal: ..."]
  }'

# Get job status
curl http://localhost:8000/api/v1/jobs/{job_id} \
  -H "Authorization: Bearer YOUR_API_KEY"

# List jobs
curl http://localhost:8000/api/v1/jobs?status=completed \
  -H "Authorization: Bearer YOUR_API_KEY"

# Cancel job
curl -X DELETE http://localhost:8000/api/v1/jobs/{job_id} \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Backward Compatibility

The original synchronous endpoint remains available:

**POST** `/api/v1/orchestrations` - Blocks until completion (5-15 minutes)

Use the new async endpoints for better reliability and user experience.

## Configuration

Environment variables:

- `JOBS_DB_PATH`: Path to SQLite database (default: `{workspace}/jobs.db`)
- `WORKER_ID`: Worker identifier (default: `worker-1`)
- `WORKER_COUNT`: Number of workers (default: `1`)

## Running the System

### Start API Server

```bash
cd standards-extractor
source venv/bin/activate
uvicorn src.api:app --reload
```

### Start Worker (separate terminal)

```bash
cd standards-extractor
source venv/bin/activate
python -m src.queue.worker
```

## Monitoring

- Check job queue database: `sqlite3 {workspace}/jobs.db "SELECT * FROM jobs;"`
- View worker logs: Worker outputs to stdout/stderr
- List all jobs: `GET /api/v1/jobs`

## Future Enhancements (Phase 2+)

Additional job types will be added:

- `write-spec`: Write specification
- `generate-tasks`: Generate task list
- `implement-tasks`: Implement tasks
- `shape-spec`: Shape specification
- `standards-product`: Generate product standards
- `standards-global`: Generate global standards

All will use the same async pattern with dedicated endpoints under `/api/v1/jobs/`.
