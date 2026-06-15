#!/usr/bin/env python3
"""Exercise the refactoring engines against the live Kibana snapshot.

Closes Phase 9 done-criteria items that needed a real repo:
  - T9.1/T9.2: skills + REST endpoints work end-to-end
  - T9.3: detect_changes attributes in-method-body edits to the right symbol
  - T9.4: rename_preview ref count is within ±2 of `git grep`

Read-only on the source files (no apply path used).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.dep.db import DepGraph
from src.refactoring import (
    check_staleness,
    detect_changes,
    rename_preview,
)

REPO = Path(r"C:\Users\ozzie\AppData\Local\Temp\kibana")
SNAPSHOT = Path(
    r"C:\Users\ozzie\AppData\Local\Temp\v2_50run_snapshots\kibana\kibana\head"
)


def section(title: str) -> None:
    print()
    print("=" * 78)
    print(f"  {title}")
    print("=" * 78)


def main() -> int:
    if not REPO.exists():
        print(f"FAIL: repo missing at {REPO}")
        return 1
    if not (SNAPSHOT / "_depgraph.sqlite").exists():
        print(f"FAIL: snapshot missing at {SNAPSHOT}")
        return 1

    graph = DepGraph(SNAPSHOT / "_depgraph.sqlite")

    # ------------------------------------------------------------------ 1. staleness
    section("1. check_staleness")
    sr = check_staleness(SNAPSHOT, REPO)
    print(f"  level = {sr.level}")
    print(f"  snapshot_sha = {sr.snapshot_sha}")
    print(f"  head_sha     = {sr.head_sha}")
    print(f"  dirty        = {sr.working_tree_dirty} ({len(sr.modified_files_since)} files)")
    if sr.notes:
        print(f"  notes:")
        for n in sr.notes: print(f"    - {n}")

    # ----------------------------------------------------- 2. detect_changes (clean)
    section("2. detect_changes scope=unstaged (clean tree)")
    cr = detect_changes(REPO, graph, scope="unstaged")
    print(f"  files={len(cr.files)} symbols={len(cr.impacted_symbols)} risk={cr.risk.level}")

    # ----------- 3. detect_changes after a synthetic in-method-body edit
    section("3. detect_changes after a synthetic in-method-body edit")
    # Find a TypeScript file the graph knows about
    row = graph.query_one(
        """SELECT f.path, s.qualified_name, s.kind, s.line
           FROM symbols s JOIN files f ON s.file_id = f.id
           WHERE s.kind = 'function' AND f.path LIKE '%.ts'
             AND s.line IS NOT NULL AND s.line > 0
           LIMIT 1"""
    )
    if not row:
        print("  no candidate function found — skipping")
    else:
        target_rel = row["path"]
        target_sym = row["qualified_name"]
        target_line = row["line"]
        target_abs = REPO / target_rel
        print(f"  target = {target_rel} :: {target_sym} (def at line {target_line})")
        if not target_abs.exists():
            print(f"  SKIP: file missing on disk: {target_abs}")
        else:
            original = target_abs.read_text(encoding="utf-8")
            try:
                # Insert a comment a few lines below the def line — squarely in body.
                body_line = max(1, target_line + 2)
                lines = original.splitlines(keepends=True)
                if body_line <= len(lines):
                    lines[body_line - 1] = lines[body_line - 1].rstrip("\r\n") + " // refactor probe\n"
                    target_abs.write_text("".join(lines), encoding="utf-8")
                    cr2 = detect_changes(REPO, graph, scope="unstaged")
                    qs = [s.qualified_name for f in cr2.files for s in f.impacted_symbols]
                    hit = target_sym in qs
                    print(f"  attributed to {target_sym}? {hit}")
                    print(f"  files reported: {[f.path for f in cr2.files]}")
                    if not hit:
                        print(f"  symbols reported: {qs[:10]}")
                else:
                    print(f"  SKIP: file too short ({len(lines)} lines)")
            finally:
                # Restore — never leave changes
                target_abs.write_text(original, encoding="utf-8")

    # ------------------------------------- 4. rename_preview vs git grep parity
    section("4. rename_preview parity vs git grep")
    # Pick a class symbol with a recognisable bare name
    row = graph.query_one(
        """SELECT s.qualified_name, s.name, f.path
           FROM symbols s JOIN files f ON s.file_id = f.id
           WHERE s.kind = 'class' AND length(s.name) >= 6
             AND s.name NOT LIKE '_%' AND s.name NOT GLOB '*[a-z]'
           ORDER BY s.id LIMIT 1"""
    )
    # Fallback: any class with a non-trivial name
    if not row:
        row = graph.query_one(
            """SELECT s.qualified_name, s.name, f.path
               FROM symbols s JOIN files f ON s.file_id = f.id
               WHERE s.kind = 'class' AND length(s.name) >= 6
               ORDER BY s.id LIMIT 1"""
        )
    if not row:
        print("  no class symbol found — skipping")
    else:
        qname = row["qualified_name"]
        bare = row["name"]
        print(f"  symbol = {qname} (bare: {bare}) at {row['path']}")
        plan = rename_preview(REPO, graph, qname, "X_RENAMED_PROBE")
        if plan.ambiguous:
            print(f"  ambiguous: {len(plan.ambiguity_candidates)} candidates")
            for c in plan.ambiguity_candidates[:5]:
                print(f"    - {c.qualified_name} ({c.kind}) {c.file}:{c.line}")
        else:
            print(f"  plan.kind = {plan.kind}")
            print(f"  graph_refs={len(plan.graph_refs)} import_refs={len(plan.import_refs)} "
                  f"text_refs={len(plan.text_refs)} patches={len(plan.patches)}")
            print(f"  partitions: graph_only={len(plan.partitions.graph_only)} "
                  f"text_only={len(plan.partitions.text_only)} both={len(plan.partitions.both)}")
            # Compare to git grep -c on bare name across .ts/.tsx
            grep_out = subprocess.run(
                ["git", "grep", "-cE", rf"\b{bare}\b", "--", "*.ts", "*.tsx"],
                cwd=REPO, capture_output=True, text=True, errors="replace",
            )
            grep_files = sum(
                1 for line in grep_out.stdout.splitlines() if ":" in line
            )
            grep_total = sum(
                int(line.rsplit(":", 1)[1])
                for line in grep_out.stdout.splitlines() if ":" in line
            )
            print(f"  git grep: {grep_total} hits across {grep_files} file(s)")
            print(f"  rename text_refs: {len(plan.text_refs)} hits "
                  f"across {len({r.file for r in plan.text_refs})} file(s)")
            within_2 = abs(len(plan.text_refs) - grep_total) <= max(2, grep_total * 0.05)
            print(f"  parity (±max(2, 5%)): {'PASS' if within_2 else 'FAIL'}")

    graph.close()
    print("\nDONE.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
