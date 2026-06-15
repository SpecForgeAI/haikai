# Local Development & Debugging Setup

This guide explains how to run and debug the async job queue system locally in your IDE.

## Quick Answers

### Do I need to install new dependencies?

**No!** The async job queue uses only Python standard library modules (sqlite3, json, datetime, etc.). All existing dependencies in `requirements.txt` are sufficient.

### How is the database deployed?

**Automatically!** The SQLite database is created automatically when:
1. The API server starts (initializes the schema)
2. The first job is created (if not already initialized)

**Location**: `./api_workspace/jobs.db` (by default)

The database is a single file that's created on-demand. No manual setup needed.

### Where does the database live locally?

By default: `./api_workspace/jobs.db` in your project directory.

You can change this with the `JOBS_DB_PATH` environment variable.

## Setup Steps

### 1. Install Dependencies (if not already done)

```bash
# Create virtual environment (if needed)
python -m venv venv

# Activate virtual environment
# On Windows:
.\venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt
```

### 2. Create .env.local File (Recommended)

Create a ``.env.local` file in the project root with your API keys:

```bash
# .env.local file
ANTHROPIC_API_KEY=your-anthropic-api-key-here
STANDARDS_API_KEY=your-api-key-for-authentication

# Optional: Override default paths
API_WORKSPACE_DIR=./api_workspace
JOBS_DB_PATH=./api_workspace/jobs.db
LOG_DIR=./api_workspace/logs
```

**Note**: The ``.env.local` file is loaded automatically by the debug scripts.

### 3. Run in IDE with Debugging

You have two debug scripts:

#### Option A: Debug API Server

**File**: `src/entrypoints/debug_api.py`

**What it does**:
- Starts the FastAPI server
- Loads environment variables from ``.env.local`
- Creates workspace directories automatically
- Initializes the job queue database

**How to use**:

1. **PyCharm**:
   - Right-click `src/entrypoints/debug_api.py` → "Debug 'debug_api'"
   - Or create a run configuration with `src/entrypoints/debug_api.py` as the script

2. **VS Code**:
   - Open `src/entrypoints/debug_api.py`
   - Press F5 or click "Run and Debug"
   - Or add to `.vscode/launch.json`:
     ```json
     {
       "name": "Debug API",
       "type": "python",
       "request": "launch",
       "program": "${workspaceFolder}/src/entrypoints/debug_api.py",
       "console": "integratedTerminal"
     }
     ```

3. **Set breakpoints**:
   - Open `src/api.py` and click in the gutter to add breakpoints
   - Open `src/job_queue/*.py` files and add breakpoints
   - Breakpoints will be hit when API endpoints are called

#### Option B: Debug Worker

**File**: `src/entrypoints/debug_worker.py`

**What it does**:
- Starts the background worker process
- Loads environment variables from ``.env.local`
- Polls the job queue for new jobs
- Processes jobs with full debugging support

**How to use**:

1. **Start the API server first** (using `src/entrypoints/debug_api.py` or `uvicorn`)

2. **PyCharm**:
   - Right-click `src/entrypoints/debug_worker.py` → "Debug 'debug_worker'"
   - Or create a separate run configuration

3. **VS Code**:
   - Open `src/entrypoints/debug_worker.py`
   - Press F5 or add to `.vscode/launch.json`:
     ```json
     {
       "name": "Debug Worker",
       "type": "python",
       "request": "launch",
       "program": "${workspaceFolder}/src/entrypoints/debug_worker.py",
       "console": "integratedTerminal"
     }
     ```

4. **Set breakpoints**:
   - Open `src/job_queue/worker.py` and add breakpoints
   - Open `src/job_queue/tasks.py` and add breakpoints in `run_orchestration()`
   - Breakpoints will be hit when the worker processes jobs

## Database Details

### Automatic Creation

The SQLite database is created automatically with this schema:

```sql
CREATE TABLE jobs (
    job_id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    company TEXT NOT NULL,
    project TEXT NOT NULL,
    request_payload TEXT NOT NULL,  -- JSON
    created_at TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    progress_json TEXT,  -- JSON
    result_json TEXT,    -- JSON
    error TEXT,
    worker_id TEXT,
    logs_path TEXT
);

-- Indexes for efficient querying
CREATE INDEX idx_status ON jobs(status);
CREATE INDEX idx_created_at ON jobs(created_at);
CREATE INDEX idx_company_project ON jobs(company, project);
```

### Database Location

**Default**: `./api_workspace/jobs.db`

**Override**: Set `JOBS_DB_PATH` environment variable

**Structure**:
```
standards-extractor/
├── api_workspace/           # Created automatically
│   ├── jobs.db             # SQLite database (created on first run)
│   └── logs/               # Log files
│       └── orchestration/  # Orchestration logs
└── ...
```

### Inspecting the Database

You can inspect the database directly using SQLite tools:

```bash
# Using sqlite3 command-line tool
sqlite3 api_workspace/jobs.db

# View all jobs
sqlite> SELECT job_id, type, status, company, project, created_at FROM jobs;

# View queued jobs
sqlite> SELECT * FROM jobs WHERE status = 'queued';

# View completed jobs
sqlite> SELECT * FROM jobs WHERE status = 'completed';

# Exit
sqlite> .quit
```

Or use a GUI tool like:
- [DB Browser for SQLite](https://sqlitebrowser.org/)
- [SQLiteStudio](https://sqlitestudio.pl/)
- [DBeaver](https://dbeaver.io/)

### Resetting the Database

To start fresh, simply delete the database file:

```bash
# Delete database
rm api_workspace/jobs.db

# It will be recreated automatically on next run
```

## IDE-Specific Setup

### PyCharm

1. **Create Run Configurations**:
   - Run → Edit Configurations → Add New Configuration → Python
   - **API Server**:
     - Name: "Debug API"
     - Script path: `/path/to/debug_api.py`
     - Working directory: `/path/to/standards-extractor`
   - **Worker**:
     - Name: "Debug Worker"
     - Script path: `/path/to/debug_worker.py`
     - Working directory: `/path/to/standards-extractor`

2. **Set Environment Variables** (optional):
   - In run configuration → Environment variables
   - Add: `ANTHROPIC_API_KEY=your-key`
   - Or use ``.env.local` file (loaded automatically)

3. **Debug**:
   - Set breakpoints by clicking in the gutter
   - Click the bug icon to start debugging
   - Use F8 (step over), F7 (step into), F9 (resume)

### VS Code

1. **Create `.vscode/launch.json`**:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug API",
      "type": "python",
      "request": "launch",
      "program": "${workspaceFolder}/src/entrypoints/debug_api.py",
      "console": "integratedTerminal",
      "envFile": "${workspaceFolder}/.env.local"
    },
    {
      "name": "Debug Worker",
      "type": "python",
      "request": "launch",
      "program": "${workspaceFolder}/src/entrypoints/debug_worker.py",
      "console": "integratedTerminal",
      "envFile": "${workspaceFolder}/.env.local"
    }
  ]
}
```

2. **Debug**:
   - Set breakpoints by clicking in the gutter
   - Press F5 or click "Run and Debug"
   - Select "Debug API" or "Debug Worker"
   - Use F10 (step over), F11 (step into), F5 (continue)

## Testing Workflow

### 1. Start API Server

```bash
# Using debug script
python -m src.entrypoints.debug_api

# Or using uvicorn directly
uvicorn src.api:app --reload
```

API will be available at: http://localhost:8000

### 2. Start Worker (separate terminal/IDE instance)

```bash
# Using debug script
python -m src.entrypoints.debug_worker

# Or using module directly
python -m src.job_queue.worker
```

### 3. Create a Test Job

```bash
curl -X POST http://localhost:8000/api/v1/jobs/orchestrations \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "company": "test-company",
    "project": "test-project",
    "spec_intents": ["title: Test Feature\n\ncontext: Testing\n\ngoal: Verify"]
  }'
```

### 4. Watch Breakpoints Hit

- Set breakpoints in `src/api.py` → `create_orchestration_job()`
- Set breakpoints in `src/job_queue/worker.py` → `run()` method
- Set breakpoints in `src/job_queue/tasks.py` → `run_orchestration()`

The breakpoints will be hit as the job flows through the system.

### 5. Check Job Status

```bash
curl http://localhost:8000/api/v1/jobs/{job_id} \
  -H "Authorization: Bearer YOUR_API_KEY"
```

## Common Debugging Scenarios

### Debug Job Creation

**Breakpoint**: `src/api.py` → `create_orchestration_job()` function

**What to inspect**:
- `request` parameter (OrchestrationRequest)
- `job` object after creation
- `job_id` returned

### Debug Job Execution

**Breakpoint**: `src/job_queue/tasks.py` → `run_orchestration()` function

**What to inspect**:
- `job` object from database
- `request` deserialized from payload
- `orchestrator` instance
- `response` from workflow

### Debug Worker Loop

**Breakpoint**: `src/job_queue/worker.py` → `run()` method inside the while loop

**What to inspect**:
- `job` retrieved from queue
- `job.type` and dispatch logic
- Exception handling

### Debug Database Operations

**Breakpoint**: `src/job_queue/job_storage.py` → `save_job()` or `get_job()`

**What to inspect**:
- SQL queries being executed
- Job serialization/deserialization
- Database connection handling

## Troubleshooting

### Database is locked

**Cause**: Multiple processes accessing SQLite simultaneously

**Solution**:
- Ensure only one worker is running
- Close any SQLite GUI tools
- For high concurrency, consider PostgreSQL (Phase 2+)

### Breakpoints not hitting

**Cause**: Code reload enabled or wrong process

**Solution**:
- Use `src/entrypoints/debug_api.py` (has `reload=False`)
- Don't use `--reload` flag with uvicorn
- Ensure you're debugging the right process (API vs Worker)

### Environment variables not set

**Cause**: ``.env.local` file not loaded or missing

**Solution**:
- Create ``.env.local` file in project root
- Or set variables in IDE run configuration
- Check `python-dotenv` is installed

### Worker not picking up jobs

**Cause**: Database path mismatch

**Solution**:
- Check `JOBS_DB_PATH` is the same for API and Worker
- Default is `./api_workspace/jobs.db`
- Verify with: `echo $JOBS_DB_PATH`

## Production vs Development

### Development (Debug Mode)

- Use `src/entrypoints/debug_api.py` and `src/entrypoints/debug_worker.py`
- Breakpoints enabled
- Verbose logging
- Auto-reload disabled (for debugging)
- Database in local `./api_workspace/`

### Production

- Use `uvicorn src.api:app` and `python -m src.job_queue.worker`
- No breakpoints
- Standard logging
- Process management (systemd, Docker)
- Database in configured location

## Next Steps

1. ✅ Set up ``.env.local` file with API keys
2. ✅ Run `src/entrypoints/debug_api.py` in your IDE
3. ✅ Run `src/entrypoints/debug_worker.py` in separate IDE instance
4. ✅ Create a test job via API
5. ✅ Set breakpoints and step through code
6. ✅ Inspect database with SQLite tools

## Additional Resources

- **API Documentation**: `docs/ASYNC_QUEUE_API.md`
- **Quick Start Guide**: `ASYNC_QUEUE_README.md`
- **Test Suite**: `test_job_queue.py`
- **API Interactive Docs**: http://localhost:8000/docs (when running)

## Support

If you encounter issues:

1. Check environment variables are set correctly
2. Verify database file exists and is not locked
3. Check logs in `./api_workspace/logs/`
4. Inspect database with `sqlite3 api_workspace/jobs.db`
5. Review error messages in IDE console
