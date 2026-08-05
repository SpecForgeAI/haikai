# Async Job Queue System - MVP

This document provides a quick start guide for the async job queue system.

## What's New

The async job queue system allows long-running API operations to execute in the background without blocking HTTP connections. This solves timeout issues and provides better user experience.

### Key Features

- ✅ **Non-blocking**: API returns immediately with a job ID
- ✅ **Progress tracking**: Poll for status and progress updates
- ✅ **Reliable**: Jobs survive connection drops
- ✅ **Backward compatible**: Original sync endpoints still work
- ✅ **Simple**: SQLite-based, no external dependencies
- ✅ **Scalable**: Configurable worker count

## Quick Start

### 1. Start the API Server

```bash
cd standards-extractor
source venv/bin/activate
# NOTE: always use the entrypoint (never bare uvicorn) - it scopes the reload
# watcher to source dirs so agent workspace writes can't kill in-flight runs.
python -m src.entrypoints.run_api --reload --host 0.0.0.0 --port 8000
```

### 2. Start the Worker (separate terminal)

```bash
cd standards-extractor
source venv/bin/activate
python -m src.queue.worker
```

You should see:
```
Worker worker-1: Started
```

### 3. Test the System

Create a test job:

```bash
curl -X POST http://localhost:8000/api/v1/jobs/orchestrations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "test-company",
    "project": "test-project",
    "spec_intents": ["title: Test Feature\n\ncontext: Testing async queue\n\ngoal: Verify system works"]
  }'
```

Response:
```json
{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "created_at": "2026-01-24T12:00:00"
}
```

Check job status:

```bash
curl http://localhost:8000/api/v1/jobs/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │
       │ POST /api/v1/jobs/orchestrations
       │ (returns immediately with job_id)
       ▼
┌─────────────────┐
│   API Server    │
│  (FastAPI)      │
└────────┬────────┘
         │
         │ Writes to
         ▼
┌─────────────────┐
│  SQLite DB      │
│  (jobs.db)      │
└────────┬────────┘
         │
         │ Polls for jobs
         ▼
┌─────────────────┐
│ Background      │
│ Worker Process  │
└─────────────────┘
```

## File Structure

```
src/job_queue/
├── __init__.py          # Package initialization
├── job_models.py        # Pydantic models for jobs
├── job_storage.py       # SQLite storage layer
├── job_queue.py         # Queue interface
├── worker.py            # Background worker process
└── tasks.py             # Task execution functions

src/api.py               # API endpoints (includes new async endpoints)
docs/ASYNC_QUEUE_API.md  # Detailed API documentation
```

## Environment Variables

Optional configuration:

```bash
# Job queue database path
export JOBS_DB_PATH=/path/to/jobs.db

# Worker identifier
export WORKER_ID=worker-1

# Number of workers (default: 1)
export WORKER_COUNT=1

# API workspace directory
export API_WORKSPACE_DIR=/home/ubuntu/api_workspace

# Anthropic API key (required for orchestration)
export ANTHROPIC_API_KEY=your-key-here

# API key for authentication
export STANDARDS_API_KEY=your-api-key
```

## API Endpoints

### Async Endpoints (New)

- `POST /api/v1/jobs/orchestrations` - Create async orchestration job
- `GET /api/v1/jobs/{job_id}` - Get job status and result
- `GET /api/v1/jobs` - List jobs with filters
- `DELETE /api/v1/jobs/{job_id}` - Cancel job

### Sync Endpoints (Existing, Unchanged)

- `POST /api/v1/orchestrations` - Synchronous orchestration (blocks)

See [ASYNC_QUEUE_API.md](docs/ASYNC_QUEUE_API.md) for detailed API documentation.

## Job Lifecycle

```
QUEUED → RUNNING → COMPLETED
                 ↘ FAILED
                 ↘ CANCELLED
```

1. **QUEUED**: Job created, waiting for worker
2. **RUNNING**: Worker is executing the job
3. **COMPLETED**: Job finished successfully
4. **FAILED**: Job encountered an error
5. **CANCELLED**: Job was cancelled by user

## Monitoring

### Check Job Queue

```bash
sqlite3 /path/to/jobs.db "SELECT job_id, type, status, company, project, created_at FROM jobs ORDER BY created_at DESC LIMIT 10;"
```

### View Worker Logs

Worker outputs to stdout/stderr. Redirect to file if needed:

```bash
python -m src.queue.worker > worker.log 2>&1
```

### List All Jobs via API

```bash
curl http://localhost:8000/api/v1/jobs \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Troubleshooting

### Worker not picking up jobs

1. Check worker is running: `ps aux | grep worker`
2. Check database path matches: `echo $JOBS_DB_PATH`
3. Check job status: `sqlite3 jobs.db "SELECT * FROM jobs;"`

### Jobs stuck in RUNNING

1. Check worker logs for errors
2. Restart worker process
3. Jobs will remain in RUNNING state (no automatic recovery yet)

### Database locked errors

- SQLite has limited concurrency
- For high load, consider upgrading to PostgreSQL (Phase 2+)

## Testing

Run the test suite:

```bash
python test_job_queue.py
```

Expected output:
```
Testing Job Queue System
==================================================
✓ Initialized job queue with database: /tmp/test_jobs.db
✓ Created job with ID: ...
✓ Retrieved job ...
✓ Found 1 job(s) for company 'test-company'
✓ Cancelled job ...
✓ No queued jobs found (expected)
==================================================
All tests passed! ✓
```

## Production Deployment

### Using systemd (Linux)

Create `/etc/systemd/system/standards-worker.service`:

```ini
[Unit]
Description=Standards Extractor Worker
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/standards-extractor
Environment="ANTHROPIC_API_KEY=your-key"
Environment="JOBS_DB_PATH=/home/ubuntu/api_workspace/jobs.db"
ExecStart=/home/ubuntu/standards-extractor/venv/bin/python -m src.queue.worker
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable standards-worker
sudo systemctl start standards-worker
sudo systemctl status standards-worker
```

### Using Docker

Add to `docker-compose.yml`:

```yaml
worker:
  build: .
  command: python -m src.queue.worker
  environment:
    - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
    - JOBS_DB_PATH=/workspace/jobs.db
  volumes:
    - ./api_workspace:/workspace
  restart: always
```

## Phase 2+ Roadmap

Future enhancements:

- [ ] Add progress callbacks for real-time updates
- [ ] Implement retry logic with exponential backoff
- [ ] Add job priority and scheduling
- [ ] Support for remaining 6 endpoints
- [ ] WebSocket support for real-time notifications
- [ ] Job result caching and cleanup
- [ ] Multi-worker coordination
- [ ] PostgreSQL support for higher concurrency

## Support

For issues or questions:

1. Check logs: API logs and worker logs
2. Check database: `sqlite3 jobs.db`
3. Review documentation: [ASYNC_QUEUE_API.md](docs/ASYNC_QUEUE_API.md)
4. Check GitHub issues

## MVP Scope

This is the **MVP (Minimum Viable Product)** release focusing on:

- ✅ Orchestration endpoint only
- ✅ SQLite storage
- ✅ Single worker
- ✅ Basic job management
- ✅ Backward compatibility

Additional endpoints will be added in Phase 2+.
