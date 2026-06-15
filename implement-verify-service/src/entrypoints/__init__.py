"""Application entrypoints (CLI launchers, debug helpers, mock server).

Run them as modules: ``python -m src.entrypoints.<name>`` (run_api, main,
run, run_simple, mock_server, debug_api, debug_worker).

Windows-first: force UTF-8 on stdout/stderr for the whole package. Several
launchers print status glyphs (checkmarks, etc.) at module load and in their
banners; on a default Windows console (cp1252) those raise UnicodeEncodeError
and crash the launcher *before the server starts*. Reconfiguring here runs
before any submodule (the parent package imports first under ``-m`` and on
import), so every entrypoint is cp1252-safe without per-site PYTHONUTF8.
"""
import sys as _sys

for _stream in (_sys.stdout, _sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        # stdout/stderr replaced by a non-reconfigurable object — best effort.
        pass
