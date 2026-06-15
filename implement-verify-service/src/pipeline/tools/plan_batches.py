"""plan_batches — mechanical partition of a snapshot into batches (D13).

Usage:
    python -m src.pipeline.tools.plan_batches --index <snapshot_dir> \
        --kinds endpoints,data_movements,queries --out <batches.json>

A batch is a budget boundary, not a framework claim (D1/D3):
  - candidate count per file = symbols + calls rows
  - group files by top-level package directory
  - split groups > MAX_CANDIDATES by sub-directory, then by file
  - merge sibling groups < MIN_CANDIDATES
  - batch_id = "{kind}-{sha1(kind + ':' + sorted files)[:10]}" — stable per snapshot
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from collections import defaultdict
from pathlib import Path

from src.pipeline.index import AstIndex

MIN_CANDIDATES = 50
MAX_CANDIDATES = 200
VALID_KINDS = ("endpoints", "data_movements", "queries")


def _batch_id(kind: str, files: list[str]) -> str:
    digest = hashlib.sha1((kind + ":" + ",".join(sorted(files))).encode()).hexdigest()
    return f"{kind}-{digest[:10]}"


def _top_package(file: str) -> str:
    parts = file.split("/")
    return parts[0] if len(parts) > 1 else "."


def _subdir(file: str, depth: int) -> str:
    parts = file.split("/")
    return "/".join(parts[: depth + 1]) if len(parts) > depth + 1 else file


def _split_group(files: list[str], counts: dict[str, int], depth: int = 1) -> list[list[str]]:
    """Recursively split an oversized file group by directory depth."""
    total = sum(counts[f] for f in files)
    if total <= MAX_CANDIDATES or len(files) == 1:
        return [files]
    buckets: dict[str, list[str]] = defaultdict(list)
    for f in files:
        buckets[_subdir(f, depth)].append(f)
    if len(buckets) == 1:
        # No further directory structure — split file-by-file greedily.
        out: list[list[str]] = []
        cur: list[str] = []
        cur_total = 0
        for f in sorted(files):
            if cur and cur_total + counts[f] > MAX_CANDIDATES:
                out.append(cur)
                cur, cur_total = [], 0
            cur.append(f)
            cur_total += counts[f]
        if cur:
            out.append(cur)
        return out
    out = []
    for sub_files in buckets.values():
        out.extend(_split_group(sub_files, counts, depth + 1))
    return out


def plan(snapshot_path: str, kinds: list[str]) -> list[dict]:
    index = AstIndex(snapshot_path)
    files = sorted(index.files())
    counts = {f: index.candidate_count(f) for f in files}

    # 1. group by top-level package
    groups: dict[str, list[str]] = defaultdict(list)
    for f in files:
        groups[_top_package(f)].append(f)

    # 2. split oversized groups
    sized: list[list[str]] = []
    for grp in groups.values():
        sized.extend(_split_group(grp, counts))

    # 3. merge undersized sibling groups (same top-level package)
    merged: list[list[str]] = []
    pending: dict[str, list[str]] = {}
    for grp in sorted(sized, key=lambda g: g[0]):
        total = sum(counts[f] for f in grp)
        pkg = _top_package(grp[0])
        if total >= MIN_CANDIDATES:
            merged.append(grp)
            continue
        bucket = pending.setdefault(pkg, [])
        bucket.extend(grp)
        if sum(counts[f] for f in bucket) >= MIN_CANDIDATES:
            merged.append(sorted(bucket))
            pending[pkg] = []
    merged.extend(sorted(b) for b in pending.values() if b)

    # 4. one batch per (kind, group). A single unsplittable file over the cap
    #    is planned as an EXPLICIT oversize batch (C5) — refusing it forever
    #    was a deterministic dead-end (re-running the plan reproduces it).
    batches = []
    for kind in kinds:
        for grp in merged:
            count = sum(counts[f] for f in grp)
            batch = {
                "id": _batch_id(kind, grp),
                "kind": kind,
                "scope": {"files": sorted(grp)},
                "candidate_count": count,
            }
            if count > MAX_CANDIDATES and len(grp) == 1:
                batch["oversize"] = True
            batches.append(batch)
    return batches


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Plan extraction batches")
    parser.add_argument("--index", required=True)
    parser.add_argument("--kinds", required=True, help="comma-separated kinds")
    parser.add_argument("--out", required=True)
    args = parser.parse_args(argv)

    kinds = [k.strip() for k in args.kinds.split(",") if k.strip()]
    bad = [k for k in kinds if k not in VALID_KINDS]
    if bad:
        print(json.dumps({"error": f"unknown kinds: {bad}"}), file=sys.stderr)
        return 2

    index = AstIndex(args.index)
    if not index.exists():
        print(json.dumps({"error": f"no snapshot at {args.index}"}), file=sys.stderr)
        return 2

    batches = plan(args.index, kinds)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(batches, indent=2), encoding="utf-8")
    json.dump({"batches": len(batches)}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
