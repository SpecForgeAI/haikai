"""
Debug script for running the background worker in an IDE with breakpoint support.

This script allows you to:
1. Run the worker process directly in your IDE
2. Set breakpoints in worker code or task execution functions
3. Step through job processing
4. Inspect job state and execution flow

Usage:
    python debug_worker.py

Or in your IDE:
    - Set this file as a separate run configuration
    - Add breakpoints in src/queue/worker.py or src/queue/tasks.py
    - Click "Debug" in your IDE
    - The worker will process jobs from the queue

Note:
    Run this AFTER starting the API server (debug_api.py or uvicorn)
    The worker polls the job queue database for new jobs

Environment Variables:
    Set these in your IDE's run configuration or in a .env file:
    - ANTHROPIC_API_KEY: Required for orchestration UNLESS the active
      CHAT_EXECUTOR backend brings its own auth (kiro does, via kiro-cli SSO)
    - JOBS_DB_PATH: Job queue database path (default: ./api_workspace/jobs.db)
    - WORKER_ID: Worker identifier (default: worker-1)
    - API_WORKSPACE_DIR: Workspace directory (default: ./api_workspace)
"""

import os
import sys
from pathlib import Path

# Add src to Python path
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root / "src"))

def _bootstrap():
    """Env + workspace bootstrap for the debug run.

    Runs ONLY under __main__ (2026-08-07): this used to execute at
    module import, and `.env.local` loading from an importable module
    poisons the importing process's environment — the full test suite
    ran with the developer's real CHAT_EXECUTOR after ANY in-process
    import of an entrypoint module. Importing this module must have
    ZERO environment side effects (guarded by
    tests/test_anti_pattern_guards.py).
    """
    # Load environment variables from .env.local file if it exists
    try:
        from dotenv import load_dotenv
        env_file = project_root / ".env.local"
        if env_file.exists():
            load_dotenv(env_file)
            print(f"✓ Loaded environment variables from {env_file}")
        else:
            print(f"ℹ No .env.local file found at {env_file}")
            print("  You can create one with your API keys and configuration")
    except ImportError:
        print("ℹ python-dotenv not installed, skipping .env.local file loading")

    # Set default environment variables if not already set
    if not os.getenv("API_WORKSPACE_DIR"):
        default_workspace = str(project_root / "api_workspace")
        os.environ["API_WORKSPACE_DIR"] = default_workspace
        print(f"✓ Set API_WORKSPACE_DIR to: {default_workspace}")

    if not os.getenv("JOBS_DB_PATH"):
        default_db = str(project_root / "api_workspace" / "jobs.db")
        os.environ["JOBS_DB_PATH"] = default_db
        print(f"✓ Set JOBS_DB_PATH to: {default_db}")

    if not os.getenv("WORKER_ID"):
        os.environ["WORKER_ID"] = "worker-debug"
        print(f"✓ Set WORKER_ID to: worker-debug")

    if not os.getenv("ORCHESTRATION_LOG_DIR"):
        default_logs = str(project_root / "api_workspace" / "logs" / "orchestration")
        os.environ["ORCHESTRATION_LOG_DIR"] = default_logs
        print(f"✓ Set ORCHESTRATION_LOG_DIR to: {default_logs}")

    # Create workspace and logs directories if they don't exist
    workspace_dir = Path(os.getenv("API_WORKSPACE_DIR"))
    workspace_dir.mkdir(parents=True, exist_ok=True)

    logs_dir = Path(os.getenv("ORCHESTRATION_LOG_DIR"))
    logs_dir.mkdir(parents=True, exist_ok=True)

    print(f"✓ Workspace directory: {workspace_dir}")
    print(f"✓ Logs directory: {logs_dir}")

    # Check for required API keys
    print("\n" + "=" * 60)
    print("Environment Check")
    print("=" * 60)

    # Executor-aware requirement: with CHAT_EXECUTOR=kiro the backend brings its
    # own auth (kiro-cli SSO) and the orchestration gates skip ANTHROPIC_API_KEY,
    # so the startup check must not warn about it. Falls back to "required" when
    # the helper can't be imported (stripped environment) — never crash here.
    try:
        from src.entrypoints.env_check import anthropic_key_requirement
    except ImportError:
        def anthropic_key_requirement():
            return (True, "Required for orchestration jobs")

    anthropic_required, anthropic_note = anthropic_key_requirement()

    required_keys = {}
    if anthropic_required:
        required_keys["ANTHROPIC_API_KEY"] = anthropic_note

    if not anthropic_required:
        print(f"- ANTHROPIC_API_KEY: {anthropic_note}")

    missing_keys = []
    for key, description in required_keys.items():
        if os.getenv(key):
            print(f"✓ {key}: Set")
        else:
            print(f"✗ {key}: NOT SET - {description}")
            missing_keys.append(key)

    if missing_keys:
        print("\n⚠ Warning: Some required environment variables are not set")
        print("  The worker will start but orchestration jobs will fail")
        print("\n  To fix this, either:")
        print("  1. Create a .env.local file in the project root with:")
        for key in missing_keys:
            print(f"     {key}=your-key-here")
        print("  2. Or set them in your IDE's run configuration")
    else:
        print("\n✓ All required environment variables are set")

    # Check if database exists
    db_path = Path(os.getenv("JOBS_DB_PATH"))
    if db_path.exists():
        print(f"\n✓ Job queue database found: {db_path}")
        print(f"  Database size: {db_path.stat().st_size} bytes")
    else:
        print(f"\nℹ Job queue database will be created at: {db_path}")
        print("  The database is created automatically when the first job is added")

    print("=" * 60)

    # Import and run the worker
    print("\nStarting worker in debug mode...")
    print(f"Worker ID: {os.getenv('WORKER_ID')}")
    print(f"Database: {os.getenv('JOBS_DB_PATH')}")
    print("\nSet breakpoints in src/job_queue/worker.py or src/job_queue/tasks.py")
    print("The worker will poll for jobs every 1 second")
    print("\nPress Ctrl+C to stop\n")


if __name__ == "__main__":
    _bootstrap()
    # Import the worker
    from src.job_queue.worker import Worker
    from src.safe_paths import jobs_db_path

    # Create and run worker — resolve via the single source of truth so enqueue
    # and poll never split (JOBS_DB_PATH is already set above).
    db_path = jobs_db_path()
    worker = Worker(db_path)
    
    try:
        worker.run()
    except KeyboardInterrupt:
        print("\n\nWorker stopped by user")
        sys.exit(0)
