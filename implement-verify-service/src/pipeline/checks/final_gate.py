"""final_gate — whole-run invariants; decides whether the catalog ships.

stdin: {"out_dir": "...", "snapshot_path": "..."}
exit 0 = ship; exit 1 = blocked (rows in out_dir/blockers.jsonl).

Invariants (check spec):
  - every record's (file, line) resolves in the AST index
  - every endpoint has handler_class + handler_method
  - every data_movement has target AND target_type
  - every query has a target
  - conflicts.jsonl is empty OR every conflict has a resolution annotation

This is also the verification seam (D6): the exit code is the cell verdict
for the (task_group, repo, inline) slot, and blockers.jsonl is the
repair-engine failure_log.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from src.pipeline.checks._io import OutDirError, emit, read_stdin_json, safe_out_dir
from src.pipeline.index import AstIndex


def run(payload: dict) -> tuple[int, dict]:
    try:
        out_dir = safe_out_dir(payload.get("out_dir", ""))
    except OutDirError as exc:
        return 1, {"verdict": "refused", "reason": f"out_dir refused (P3a): {exc}"}
    catalog_path = out_dir / "catalog.json"
    blockers: list[dict] = []

    if not catalog_path.exists():
        blockers.append({"invariant": "catalog_exists", "reason": f"no catalog at {catalog_path}"})
        catalog = {"records": {}}
    else:
        try:
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            # P1f: a corrupt catalog is a blocked verdict, never a traceback.
            blockers.append({"invariant": "catalog_unreadable", "reason": str(exc)})
            catalog = {"records": {}}

    index = AstIndex(payload.get("snapshot_path", ""))

    for kind, records in catalog.get("records", {}).items():
        for record in records:
            rid = f"{kind}:{record.get('file')}:{record.get('line')}"
            if not index.has(record.get("file", ""), record.get("line", -1)):
                blockers.append(
                    {"invariant": "loc_resolves", "record_id": rid, "reason": "location not in AST index"}
                )
            if kind == "endpoints":
                if not (record.get("handler_class") and record.get("handler_method")):
                    blockers.append(
                        {"invariant": "endpoint_handler_resolves", "record_id": rid, "reason": "handler missing"}
                    )
                else:
                    # C1: the handler must resolve AT the anchor, not merely be non-empty.
                    sym = index.symbol_at(record.get("file", ""), record.get("line", -1))
                    if sym is None or (
                        record.get("handler_method") != sym.name
                        and record.get("handler_class") not in (sym.name, sym.scope)
                    ):
                        blockers.append(
                            {
                                "invariant": "endpoint_handler_resolves",
                                "record_id": rid,
                                "reason": "handler does not match the symbol at the anchor",
                            }
                        )
            if kind == "data_movements" and not (record.get("target") and record.get("target_type")):
                blockers.append(
                    {"invariant": "movement_target_resolves", "record_id": rid, "reason": "target missing"}
                )
            if kind == "queries" and not record.get("target"):
                blockers.append(
                    {"invariant": "query_target_resolves", "record_id": rid, "reason": "target missing"}
                )

    conflicts_path = out_dir / "conflicts.jsonl"
    if conflicts_path.exists():
        for line in conflicts_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                conflict = json.loads(line)
            except json.JSONDecodeError as exc:
                blockers.append({"invariant": "conflict_unreadable", "reason": str(exc)})
                continue
            if not conflict.get("resolution"):
                blockers.append(
                    {
                        "invariant": "conflicts_resolved",
                        "record_id": str(conflict.get("logical_id")),
                        "reason": "unresolved conflict",
                    }
                )

    blockers_path = out_dir / "blockers.jsonl"
    with blockers_path.open("w", encoding="utf-8") as handle:
        for blocker in blockers:
            handle.write(json.dumps(blocker) + "\n")

    if blockers:
        return 1, {"verdict": "blocked", "blockers": len(blockers), "blockers_file": str(blockers_path)}
    return 0, {"verdict": "ship"}


def main() -> int:
    code, payload = run(read_stdin_json())
    emit(payload)
    return code


if __name__ == "__main__":
    sys.exit(main())
