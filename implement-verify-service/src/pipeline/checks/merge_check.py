"""merge_check — cross-batch dedupe + conflict detection (orchestrator Step 6).

Deterministic (steps 1, 2, 3, 4 of the check spec). Adjudication (3.5) is
orchestrator-run — this script cannot dispatch agents.

stdin: {"out_dir": "..."}  (reads batch_ledger.jsonl, writes catalog.json + conflicts.jsonl)
exit 0 always — final_gate decides whether the run ships.

No silent drops: gave_up / refused / no_candidates batches are reported in
catalog meta, and conflict rows keep BOTH sides.
"""

from __future__ import annotations

import json
import sys
from collections import defaultdict
from pathlib import Path

from src.pipeline.checks._io import OutDirError, emit, read_stdin_json, safe_out_dir

DEDUPE_KEY = ("kind", "file", "line")


def _logical_id(kind: str, record: dict) -> tuple | None:
    """Same logical thing claimed twice with different substance = conflict."""
    if kind == "endpoints":
        return ("endpoints", record.get("operation"), record.get("path"))
    if kind == "data_movements":
        return (
            "data_movements",
            record.get("source_class"),
            record.get("source_method"),
            record.get("target"),
        )
    return None  # queries: location-keyed only, no cross-batch identity


def _substance(kind: str, record: dict) -> tuple:
    if kind == "endpoints":
        return (record.get("handler_class"), record.get("handler_method"), record.get("file"))
    return (record.get("target_type"), record.get("direction"), record.get("file"))


def run(payload: dict) -> tuple[int, dict]:
    try:
        out_dir = safe_out_dir(payload.get("out_dir", ""))
    except OutDirError as exc:
        return 0, {"verdict": "refused", "reason": f"out_dir refused (P3a): {exc}"}
    ledger_path = out_dir / "batch_ledger.jsonl"
    if not ledger_path.exists():
        emit_payload = {"verdict": "error", "reason": f"no ledger at {ledger_path}"}
        return 0, emit_payload

    rows = []
    for line in ledger_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    # 1. collect (kind, record) from done batches; track non-done for the meta report
    KNOWN_KINDS = ("endpoints", "data_movements", "queries")
    records: list[tuple[str, dict]] = []
    skipped = defaultdict(list)
    for row in rows:
        if row.get("status") == "done":
            batch_id = row.get("batch_id", "")
            kind = batch_id.rsplit("-", 1)[0] if "-" in batch_id else ""
            if kind not in KNOWN_KINDS:
                # P1f: no KeyError, no silent bogus-kind bucketing — report it.
                skipped["malformed"].append(batch_id or "<missing batch_id>")
                continue
            for record in row.get("records", []):
                records.append((kind, record))
        else:
            skipped[row.get("status", "unknown")].append(row.get("batch_id"))

    # 2. dedupe by (kind, file, line) keeping highest confidence
    best: dict[tuple, dict] = {}
    for kind, record in records:
        key = (kind, record.get("file"), record.get("line"))
        cur = best.get(key)
        if cur is None or record.get("confidence", 0) > cur["record"].get("confidence", 0):
            best[key] = {"kind": kind, "record": record}

    # 3. conflicts: same logical id, different substance — keep both sides
    by_logical: dict[tuple, list[dict]] = defaultdict(list)
    for entry in best.values():
        lid = _logical_id(entry["kind"], entry["record"])
        if lid is not None:
            by_logical[lid].append(entry)

    conflicts: list[dict] = []
    conflicted_keys: set[tuple] = set()
    for lid, entries in by_logical.items():
        substances = {_substance(e["kind"], e["record"]) for e in entries}
        if len(substances) > 1:
            conflicts.append(
                {"logical_id": list(lid), "sides": [e["record"] for e in entries]}
            )
            for e in entries:
                conflicted_keys.add((e["kind"], e["record"].get("file"), e["record"].get("line")))

    # 4. emit — unresolved conflicts stay OUT of the catalog; final_gate blocks on them
    catalog_records = defaultdict(list)
    for key, entry in best.items():
        if key not in conflicted_keys:
            catalog_records[entry["kind"]].append(entry["record"])

    catalog = {
        "records": dict(catalog_records),
        "meta": {
            "batches_total": len(rows),
            "batches_done": sum(1 for r in rows if r.get("status") == "done"),
            "batches_skipped": dict(skipped),
            "conflicts": len(conflicts),
        },
    }
    (out_dir / "catalog.json").write_text(json.dumps(catalog, indent=2), encoding="utf-8")
    with (out_dir / "conflicts.jsonl").open("w", encoding="utf-8") as handle:
        for conflict in conflicts:
            handle.write(json.dumps(conflict) + "\n")

    return 0, {
        "verdict": "merged",
        "catalog_records": sum(len(v) for v in catalog_records.values()),
        "conflicts": len(conflicts),
        "batches_skipped": dict(skipped),
    }


def main() -> int:
    code, payload = run(read_stdin_json())
    emit(payload)
    return code


if __name__ == "__main__":
    sys.exit(main())
