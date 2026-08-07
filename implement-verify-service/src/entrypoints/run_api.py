#!/usr/bin/env python
"""
Run the Standards Extractor API server.

This script provides a convenient way to start the API server with various options.
"""
import os
import sys
import argparse
from pathlib import Path

# Add the project root to sys.path so imports resolve as `src.xxx`.
# DO NOT add `src/` itself — doing so puts `src/ast/` on the import path
# directly, which shadows Python's stdlib `ast` module on Linux/WSL and
# crashes any downstream import of `import ast`.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

def _load_env_files():
    """Load .env.local (override) or .env — from the RUN path only.

    2026-08-07: this ran at module import with override=True, so ANY
    in-process import of this module (tests import
    `build_reload_watch_config`) stomped the importing process's environment
    with the developer's real `.env.local` — the full IVS test suite ran
    under CHAT_EXECUTOR=kiro and 70+ unrelated tests failed. Importing an
    entrypoint module must have ZERO env side effects (guarded by
    tests/test_anti_pattern_guards.py); the server run path calls this
    first thing in main().
    """
    from dotenv import load_dotenv

    env_local = Path(__file__).resolve().parents[2] / '.env.local'
    if env_local.exists():
        load_dotenv(env_local, override=True)
    else:
        load_dotenv()  # Load .env as fallback


def build_reload_watch_config(project_root: Path):
    """Watch scope for ``--reload``: ``(reload_dirs, reload_excludes)``.

    reload_dirs: SOURCE ONLY (src/templates/config) — the 2026-08-04 live
    incident: the default watcher covered the whole CWD tree including the
    agent workspaces, so every file kiro-cli/Claude wrote triggered a reload
    that SIGTERM'd the in-flight run (exit 0xC000013A, a kill not a crash).

    reload_excludes (2026-08-05 finding, work-machine session): uvicorn
    treats NON-DIRECTORY entries as globs matched with ``Path.match``, which
    cannot span directory separators — so ``"api_workspace/*"`` never matched
    a deep path and the old exclude list was SILENTLY INERT. Directory
    excludes must be absolute existing-directory paths; the only honest glob
    here is the single-segment ``*.log``. They remain belt-and-braces — the
    reload_dirs scoping is what actually keeps workspace writes unwatched.
    """
    reload_dirs = [
        str(project_root / d)
        for d in ("src", "templates", "config")
        if (project_root / d).is_dir()
    ]
    reload_excludes = [
        str(project_root / d)
        for d in ("api_workspace", "workspace", "sessions", "haikai")
        if (project_root / d).is_dir()
    ]
    reload_excludes.append("*.log")
    return reload_dirs, reload_excludes


def main():
    """Run the API server with command-line options."""
    _load_env_files()
    # Force unbuffered output so print statements appear immediately
    os.environ['PYTHONUNBUFFERED'] = '1'
    
    # Configure logging to both console and file
    import logging
    log_file = Path(__file__).resolve().parents[2] / 'api_server.log'
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(log_file, mode='a')
        ]
    )
    logging.info(f"Logging to: {log_file}")
    
    parser = argparse.ArgumentParser(
        description="Standards Extractor API Server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Start server with default settings
  python run_api.py

  # Start on custom port
  python run_api.py --port 8080

  # Enable auto-reload for development
  python run_api.py --reload

  # Custom host and port
  python run_api.py --host 127.0.0.1 --port 3000

  # Production mode with workers
  python run_api.py --workers 4

Environment Variables:
  API_HOST              Host to bind to (default: 0.0.0.0)
  API_PORT              Port to bind to (default: 8000)
  API_RELOAD            Enable auto-reload (default: false)
  STANDARDS_API_KEY     API key for authentication (required)
  API_WORKSPACE_DIR     Workspace directory for API operations
  OPENAI_API_KEY        OpenAI API key for LLM operations (required)
        """
    )
    
    parser.add_argument(
        "--host",
        type=str,
        default=os.getenv("API_HOST", "0.0.0.0"),
        help="Host to bind to (default: 0.0.0.0)"
    )
    
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.getenv("API_PORT", "8000")),
        help="Port to bind to (default: 8000)"
    )
    
    parser.add_argument(
        "--reload",
        action="store_true",
        default=os.getenv("API_RELOAD", "false").lower() == "true",
        help="Enable auto-reload for development"
    )
    
    parser.add_argument(
        "--workers",
        type=int,
        default=None,
        help="Number of worker processes (production mode)"
    )
    
    parser.add_argument(
        "--log-level",
        type=str,
        default="info",
        choices=["critical", "error", "warning", "info", "debug"],
        help="Log level (default: info)"
    )
    
    parser.add_argument(
        "--check-config",
        action="store_true",
        help="Check configuration and exit"
    )
    
    args = parser.parse_args()
    
    # Check configuration
    api_key = os.getenv("STANDARDS_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    workspace_dir = os.getenv("API_WORKSPACE_DIR", "/home/ubuntu/api_workspace")
    
    print("=" * 60)
    print("Standards Extractor API Server")
    print("=" * 60)
    print(f"Host:              {args.host}")
    print(f"Port:              {args.port}")
    print(f"Reload:            {args.reload}")
    print(f"Workers:           {args.workers or 'auto'}")
    print(f"Log Level:         {args.log_level}")
    print(f"Workspace Dir:     {workspace_dir}")
    print(f"API Key Set:       {'✓' if api_key else '✗ MISSING'}")
    print(f"OpenAI Key Set:    {'✓' if openai_key else '✗ MISSING'}")
    print("=" * 60)
    
    # Check for required configuration
    if not api_key:
        print("\n❌ ERROR: STANDARDS_API_KEY environment variable not set!")
        print("   Set it in .env file or export it:")
        print("   export STANDARDS_API_KEY=your-secret-key-here\n")
        sys.exit(1)
    
    if not openai_key:
        print("\n❌ ERROR: OPENAI_API_KEY environment variable not set!")
        print("   Set it in .env file or export it:")
        print("   export OPENAI_API_KEY=your-openai-key-here\n")
        sys.exit(1)
    
    # Create workspace directory if it doesn't exist
    workspace_path = Path(workspace_dir)
    if not workspace_path.exists():
        print(f"\n📁 Creating workspace directory: {workspace_dir}")
        workspace_path.mkdir(parents=True, exist_ok=True)
    
    if args.check_config:
        print("\n✅ Configuration is valid!")
        sys.exit(0)
    
    # Import uvicorn
    try:
        import uvicorn
    except ImportError:
        print("\n❌ ERROR: uvicorn not installed!")
        print("   Install it with: pip3 install uvicorn[standard]\n")
        sys.exit(1)
    
    # Start server
    # Display localhost instead of 0.0.0.0 for better UX
    display_host = "localhost" if args.host == "0.0.0.0" else args.host
    print(f"\n🚀 Starting server at http://{display_host}:{args.port}")
    print(f"📚 API Documentation: http://{display_host}:{args.port}/docs")
    print(f"📖 Alternative Docs:  http://{display_host}:{args.port}/redoc")
    print("\nPress CTRL+C to stop the server")
    print(f"📝 Logs will be written to: {Path(__file__).resolve().parents[2] / 'api_server.log'}\n")
    
    try:
        if args.workers:
            # Production mode with workers
            uvicorn.run(
                "src.api:app",
                host=args.host,
                port=args.port,
                workers=args.workers,
                log_level=args.log_level
            )
        elif args.reload:
            # Development mode with hot reload — watch scope built by
            # build_reload_watch_config (source-only; see its docstring for
            # the 2026-08-04 incident and the inert-glob 2026-08-05 finding).
            project_root = Path(__file__).resolve().parents[2]
            reload_dirs, reload_excludes = build_reload_watch_config(project_root)
            # Startup banner: make the watch scope VISIBLE, and warn that the
            # scoping only exists via this entrypoint — the recurrence culprit
            # was a bare `uvicorn src.api:app --reload` launch, which never
            # executes this file and watches the whole tree again.
            print("🔁 Reload watch scope (applies via THIS entrypoint only):")
            for d in reload_dirs:
                print(f"   • {d}")
            print(
                "   ⚠  Launching with bare 'uvicorn src.api:app --reload' bypasses this\n"
                "      scoping and WILL kill in-flight agent runs on workspace writes —\n"
                "      always start dev via: python -m src.entrypoints.run_api --reload"
            )
            uvicorn.run(
                "src.api:app",
                host=args.host,
                port=args.port,
                reload=True,
                reload_dirs=reload_dirs,
                reload_excludes=reload_excludes,
                log_level=args.log_level
            )
        else:
            # Single worker, no reload.
            uvicorn.run(
                "src.api:app",
                host=args.host,
                port=args.port,
                log_level=args.log_level
            )
    except KeyboardInterrupt:
        print("\n\n👋 Server stopped by user")
        sys.exit(0)


if __name__ == "__main__":
    main()
