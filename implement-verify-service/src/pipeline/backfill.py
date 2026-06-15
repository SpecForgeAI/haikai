"""backfill — write a shipped catalog back into the structural store (D8).

The pipeline supersedes the discoverers only if its output lands where
downstream consumers already read: `_endpoints.txt` / `_interactions.txt`
in the snapshot (pipeline.py steps 4/5, diagrams, standards synthesis all
read the store, not catalog.json). This module converts catalog records to
`EndpointInfo` / `InteractionInfo` and rewrites the two store files via the
same `FileStore` writers the discoverers use. The catalog is the authority
for its snapshot — the files are REPLACED, not merged.

`queries` records have no store file yet; they remain catalog-only (noted
in the result).

Usage:
    python -m src.pipeline.backfill --out-dir <pipeline_out> --snapshot <snapshot_dir>

Exit 0 = backfilled; 1 = refused (no shipped catalog / gate not passed);
2 = config error.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from src.ast.models import EndpointInfo, InteractionInfo, StructuralAnalysis
from src.ast.store import FileStore


def _endpoint(record: dict) -> EndpointInfo:
    return EndpointInfo(
        type=record.get("type", "REST"),
        path=record.get("path", ""),
        operation=record.get("operation", ""),
        handler_class=record.get("handler_class", ""),
        handler_method=record.get("handler_method", ""),
        file=record.get("file", ""),
        line=record.get("line", 0),
        direction=record.get("direction", "INBOUND"),
        protocol=record.get("protocol", "HTTP"),
        framework=record.get("framework", ""),
        confidence=record.get("confidence", 0.8),
    )


def _interaction(record: dict) -> InteractionInfo:
    return InteractionInfo(
        source_class=record.get("source_class", ""),
        source_method=record.get("source_method", ""),
        target=record.get("target", ""),
        target_type=record.get("target_type", ""),
        direction=record.get("direction", ""),
        mechanism=record.get("mechanism", ""),
        data_hint=record.get("data_hint", ""),
        file=record.get("file", ""),
        line=record.get("line", 0),
        confidence=record.get("confidence", 0.75),
    )


def backfill(out_dir: str | Path, snapshot_path: str | Path) -> tuple[int, dict]:
    out_dir = Path(out_dir)
    snapshot = Path(snapshot_path)

    catalog_path = out_dir / "catalog.json"
    if not catalog_path.exists():
        return 1, {"verdict": "refused", "reason": f"no catalog at {catalog_path}"}
    if not (snapshot / "_index.txt").exists():
        return 1, {"verdict": "refused", "reason": f"not a snapshot: {snapshot}"}

    # Only a SHIPPED catalog backfills — final_gate's verdict is the contract
    # (D6). A blockers file with rows means the run was blocked.
    blockers_path = out_dir / "blockers.jsonl"
    if blockers_path.exists() and blockers_path.read_text(encoding="utf-8").strip():
        return 1, {"verdict": "refused", "reason": "final_gate blocked this run — fix blockers first"}

    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    records = catalog.get("records", {})

    analyses_ep: dict[str, StructuralAnalysis] = {}
    for record in records.get("endpoints", []):
        analysis = analyses_ep.setdefault(
            record["file"], StructuralAnalysis(file_path=record["file"], language="")
        )
        analysis.endpoints.append(_endpoint(record))

    analyses_dm: dict[str, StructuralAnalysis] = {}
    for record in records.get("data_movements", []):
        analysis = analyses_dm.setdefault(
            record["file"], StructuralAnalysis(file_path=record["file"], language="")
        )
        analysis.interactions.append(_interaction(record))

    store = FileStore(base_path=str(snapshot.parent.parent))
    store.write_endpoints(snapshot, analyses_ep)
    store.write_interactions(snapshot, analyses_dm)

    result = {
        "verdict": "backfilled",
        "endpoints": sum(len(a.endpoints) for a in analyses_ep.values()),
        "interactions": sum(len(a.interactions) for a in analyses_dm.values()),
        "queries_catalog_only": len(records.get("queries", [])),
        "wrote": [str(snapshot / "_endpoints.txt"), str(snapshot / "_interactions.txt")],
    }
    return 0, result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill a shipped catalog into the structural store")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--snapshot", required=True)
    args = parser.parse_args(argv)
    code, result = backfill(args.out_dir, args.snapshot)
    json.dump(result, sys.stdout)
    return code


if __name__ == "__main__":
    sys.exit(main())
