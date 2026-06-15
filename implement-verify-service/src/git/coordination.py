"""coordination.yaml read/write helpers.

``coordination.yaml`` lives at the product workspace root and is the
persisted form of the folder → URL map declared at project init. It is the
single source of truth the rest of the pipeline (orchestrator, CRUD
endpoints, implement-tasks fan-out) consults to determine product
topology.

See:
* ``haikai/specs/2026-05-25-polyrepo-analysis/spec.md`` (design)
* ``haikai/specs/2026-05-25-polyrepo-analysis/planning/requirements.md``
  (FR-2 ``coordination.yaml`` at product root, NFR-7 atomic writes)

Format
------
A flat YAML map of ``folder: url`` pairs::

    backend: git@github.com:acme/backend.git
    frontend: git@github.com:acme/frontend.git

No mode flag, no metadata, no per-repo stack annotations — only the
user-declared KV pairs. The system never reads a "mode" key; mono vs
poly is inferred purely from the map's length.

Atomicity
---------
Writes use temp-file + rename so a crash mid-write cannot leave the file
in a torn state. Reads are forgiving about trailing whitespace and the
empty-file case but reject anything that isn't a flat ``str -> str`` map.

Keys are sorted on write so ``coordination.yaml`` is git-diff-stable
across re-saves with the same content.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Dict

import yaml


COORDINATION_FILENAME = "coordination.yaml"


class CoordinationError(Exception):
    """Raised when ``coordination.yaml`` is missing, malformed, or unreadable.

    Surface as ``400`` from API routes — these are user-actionable conditions
    (missing file = project not initialised, malformed file = manual edit
    broke it).
    """


def coordination_path(product_root: Path) -> Path:
    """Return the absolute path to ``coordination.yaml`` for a product root."""
    return Path(product_root) / COORDINATION_FILENAME


def read_coordination(product_root: Path) -> Dict[str, str]:
    """Load the coordination map for a product root.

    Returns a ``Dict[str, str]`` of ``folder → URL``. Raises
    ``CoordinationError`` if the file is missing, unparseable, or has the
    wrong shape (anything other than a flat ``str -> str`` map).

    Empty files are rejected — an empty product has no meaning in this
    system (the last-entry delete rule means there's always ≥1 repo).
    """
    path = coordination_path(product_root)
    if not path.exists():
        raise CoordinationError(
            f"{COORDINATION_FILENAME} not found at {path}. "
            f"Has this project been initialised?"
        )
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = yaml.safe_load(f)
    except yaml.YAMLError as e:
        raise CoordinationError(
            f"Failed to parse {path}: {e}"
        ) from e
    except OSError as e:
        raise CoordinationError(f"Failed to read {path}: {e}") from e

    if raw is None:
        raise CoordinationError(
            f"{path} is empty. A project must declare at least one repo."
        )
    if not isinstance(raw, dict):
        raise CoordinationError(
            f"{path} must be a flat YAML map of 'folder: url' pairs, "
            f"got {type(raw).__name__}."
        )
    out: Dict[str, str] = {}
    for k, v in raw.items():
        if not isinstance(k, str) or not isinstance(v, str):
            raise CoordinationError(
                f"{path} contains a non-string key or value: "
                f"{k!r} → {v!r}. All folder names and URLs must be strings."
            )
        out[k] = v
    if not out:
        raise CoordinationError(
            f"{path} contains no entries. A project must declare at least one repo."
        )
    return out


def write_coordination(product_root: Path, repos: Dict[str, str]) -> Path:
    """Write the coordination map atomically.

    Strategy: serialise to a temp file in the same directory, ``fsync``, then
    ``rename`` over the destination. ``rename`` is atomic on the same
    filesystem on POSIX, so a crash either leaves the old file intact or
    cleanly replaces it.

    Keys are sorted before serialisation for deterministic diffs.

    Returns the path of the written file.

    Raises:
        CoordinationError: if ``repos`` is empty (the spec requires ≥1 repo).
    """
    if not repos:
        raise CoordinationError(
            "Refusing to write an empty coordination.yaml — "
            "a project must declare at least one repo."
        )
    product_root = Path(product_root)
    product_root.mkdir(parents=True, exist_ok=True)
    final_path = coordination_path(product_root)

    # Sort for deterministic on-disk content.
    sorted_repos = {k: repos[k] for k in sorted(repos.keys())}
    payload = yaml.safe_dump(
        sorted_repos,
        default_flow_style=False,
        sort_keys=False,  # already sorted; preserve our order
        allow_unicode=True,
    )

    # Temp file in the same directory so rename is atomic (same fs).
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{COORDINATION_FILENAME}.",
        suffix=".tmp",
        dir=str(product_root),
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(payload)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_name, final_path)  # atomic on POSIX
    except Exception:
        # Best-effort cleanup of the temp file on any failure path.
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return final_path
