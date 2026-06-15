#!/usr/bin/env python3
"""One-shot: re-run V2 discovery on the cached kibana snapshot, dump endpoints to JSON for diff analysis."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.ast.v2.discovery_agent import discover

PROJECT_ROOT = "C:/Users/ozzie/AppData/Local/Temp/kibana"
SNAPSHOT = "C:/Users/ozzie/AppData/Local/Temp/v2_50run_snapshots/kibana/kibana/head"
OUT = Path(__file__).parent.parent / "temp" / "v2_50_results" / "endpoints_kibana.json"

print(f"Discovering on snapshot: {SNAPSHOT}")
result = discover(PROJECT_ROOT, SNAPSHOT, llm_client=None, allow_llm_fallback=False, allow_playbook_proposal=False)
eps = [{"operation": e.operation, "path": e.path, "framework": e.framework, "handler": getattr(e, "handler_method", "") or "", "file": getattr(e, "file", "") or ""} for e in result.endpoints]
OUT.write_text(json.dumps(eps, indent=2), encoding="utf-8")
print(f"Wrote {len(eps)} endpoints to {OUT}")
print(f"Unique (op,path): {len(set((e['operation'], e['path']) for e in eps))}")
