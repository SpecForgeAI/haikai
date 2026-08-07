"""Main entry point for Standards Extractor API server."""
import os
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

# Import FastAPI app
from src.api import app

if __name__ == "__main__":
    import uvicorn

    # Load environment variables — RUN path only (2026-08-07): a module-level
    # load_dotenv() poisons any process that merely imports an entrypoint
    # module (guarded by tests/test_anti_pattern_guards.py).
    from dotenv import load_dotenv
    load_dotenv()

    # Configuration
    host = os.getenv("API_HOST", "localhost")
    port = int(os.getenv("API_PORT", "8000"))
    reload = os.getenv("API_RELOAD", "false").lower() == "true"
    
    print(f"Starting Standards Extractor API server on {host}:{port}")
    print(f"API Key configured: {bool(os.getenv('STANDARDS_API_KEY'))}")
    print(f"Workspace directory: {os.getenv('API_WORKSPACE_DIR', '/home/ubuntu/api_workspace')}")
    
    uvicorn.run(
        "src.api:app",
        host=host,
        port=port,
        reload=reload
    )
