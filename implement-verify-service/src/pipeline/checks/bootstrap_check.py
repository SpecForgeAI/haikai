"""bootstrap_check — run preconditions (architecture.md Step 2).

stdin: {"snapshot_path": ..., "out_dir": ..., "kinds": [...], "max_attempts": N, "parallelism": N}
exit 0 = proceed, exit 1 = abort (reasons on stdout).
"""

from __future__ import annotations

import sys
from pathlib import Path

from src.pipeline.checks._io import SCHEMAS_DIR, OutDirError, emit, read_stdin_json, safe_out_dir
from src.pipeline.index import AstIndex
from src.pipeline.tools.plan_batches import VALID_KINDS


def run(ctx: dict) -> tuple[int, dict]:
    problems: list[str] = []

    snapshot_path = ctx.get("snapshot_path", "")
    if not snapshot_path:
        problems.append("snapshot_path missing")
    elif not AstIndex(snapshot_path).exists():
        problems.append(f"no structural snapshot at {snapshot_path} (run the structural pipeline first — D9)")

    out_dir = ctx.get("out_dir", "")
    try:
        out_path = safe_out_dir(out_dir)
        out_path.mkdir(parents=True, exist_ok=True)
        probe = out_path / ".write_probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
    except OutDirError as exc:
        problems.append(f"out_dir refused (P3a): {exc}")
    except OSError as exc:
        problems.append(f"out_dir not writable: {exc}")

    kinds = ctx.get("kinds", [])
    if not kinds:
        problems.append("kinds missing")
    for kind in kinds:
        if kind not in VALID_KINDS:
            problems.append(f"unknown kind '{kind}'")
        elif not (SCHEMAS_DIR / f"{kind}.json").exists():
            problems.append(f"schema missing for kind '{kind}'")

    for key in ("max_attempts", "parallelism"):
        value = ctx.get(key)
        if not isinstance(value, int) or value < 1:
            problems.append(f"{key} must be a positive integer")

    if problems:
        return 1, {"verdict": "abort", "problems": problems}
    return 0, {"verdict": "proceed"}


def main() -> int:
    code, payload = run(read_stdin_json())
    emit(payload)
    return code


if __name__ == "__main__":
    sys.exit(main())
