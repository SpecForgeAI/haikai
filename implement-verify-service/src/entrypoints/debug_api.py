"""
Debug script for running the API server in an IDE with breakpoint support.

This script allows you to:
1. Run the API server directly in your IDE (PyCharm, VS Code, etc.)
2. Set breakpoints in any API endpoint or queue code
3. Step through code execution
4. Inspect variables and state

Usage:
    python debug_api.py

Or in your IDE:
    - Set this file as the run configuration
    - Add breakpoints in src/api.py or src/queue/*.py
    - Click "Debug" in your IDE

Environment Variables:
    Set these in your IDE's run configuration or in a .env file:
    - ANTHROPIC_API_KEY: Required for orchestration
    - STANDARDS_API_KEY: API authentication key
    - API_WORKSPACE_DIR: Workspace directory (default: ./api_workspace)
    - JOBS_DB_PATH: Job queue database path (default: ./api_workspace/jobs.db)
    - LOG_DIR: Log directory (default: ./api_workspace/logs)
"""

import os
import sys
from pathlib import Path

# Add src to Python path
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root / "src"))

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

if not os.getenv("LOG_DIR"):
    default_logs = str(project_root / "api_workspace" / "logs")
    os.environ["LOG_DIR"] = default_logs
    print(f"✓ Set LOG_DIR to: {default_logs}")

# Create workspace directory if it doesn't exist
workspace_dir = Path(os.getenv("API_WORKSPACE_DIR"))
workspace_dir.mkdir(parents=True, exist_ok=True)
print(f"✓ Workspace directory: {workspace_dir}")

# Check for required API keys
print("\n" + "=" * 60)
print("Environment Check")
print("=" * 60)

required_keys = {
    "ANTHROPIC_API_KEY": "Required for orchestration jobs",
    "STANDARDS_API_KEY": "Required for API authentication"
}

missing_keys = []
for key, description in required_keys.items():
    if os.getenv(key):
        print(f"✓ {key}: Set")
    else:
        print(f"✗ {key}: NOT SET - {description}")
        missing_keys.append(key)

if missing_keys:
    print("\n⚠ Warning: Some required environment variables are not set")
    print("  The API will start but some features may not work")
    print("\n  To fix this, either:")
    print("  1. Create a .env.local file in the project root with:")
    for key in missing_keys:
        print(f"     {key}=your-key-here")
    print("  2. Or set them in your IDE's run configuration")
else:
    print("\n✓ All required environment variables are set")

print("=" * 60)

# Import and run the FastAPI app
print("\nStarting API server in debug mode...")
print("Set breakpoints in src/api.py or src/queue/*.py and they will be hit")
print("\nAPI will be available at: http://localhost:8000")
print("API docs will be available at: http://localhost:8000/docs")
print("\nPress Ctrl+C to stop\n")

if __name__ == "__main__":
    import uvicorn
    
    # Import the FastAPI app — must be `src.api` (not bare `api`) so its
    # relative imports (`from ..models import …`) resolve under the src package.
    from src.api import app
    
    # Run with uvicorn
    # reload=False because we're debugging (reload interferes with breakpoints)
    # log_level="debug" for verbose logging
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=False,  # Disable reload for debugging
        log_level="info",
        access_log=True
    )
