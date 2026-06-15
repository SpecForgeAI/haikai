"""Project a snapshot's TSV outputs into the SQLite dependency graph.

Pure projection: no LLM, no semantic analysis. Reads the six TSV files written
by the AST + interaction + endpoint pipelines and inserts rows into the 7-table
schema defined in `schema.sql`.

Invariants:
  - Idempotent: same input → same output (after VACUUM).
  - Single transaction per build.
  - File-locked: concurrent rebuilds are safe (last writer wins, but result
    is identical).
"""
from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Iterator

from src.dep.db import DepGraph, GRAPH_FILENAME, META_FILENAME

logger = logging.getLogger(__name__)


def run(snapshot_path: str | Path) -> Path:
    """Build (or rebuild) the dep-graph SQLite for one snapshot.

    Returns the path to the written `_depgraph.sqlite`.
    """
    snap = Path(snapshot_path)
    db_path = snap / GRAPH_FILENAME
    t0 = time.time()

    graph = DepGraph.create_empty(db_path)
    try:
        # Order matters: files first (FK target), then symbols (FK target),
        # then everything that references them.
        file_path_to_id = _load_files(graph, snap)
        qname_to_symbol_id = _load_symbols(graph, snap, file_path_to_id)
        _load_imports(graph, snap, file_path_to_id)
        _load_calls(graph, snap, file_path_to_id, qname_to_symbol_id)
        _load_inheritance(graph, snap, file_path_to_id, qname_to_symbol_id)
        _load_endpoints(graph, snap, file_path_to_id, qname_to_symbol_id)
        _load_interactions(graph, snap, file_path_to_id, qname_to_symbol_id)

        elapsed = time.time() - t0
        graph.set_meta("built_at", str(int(time.time())))
        graph.set_meta("build_seconds", f"{elapsed:.2f}")
        graph.set_meta("snapshot_path", str(snap))
        graph.commit()
    finally:
        graph.close()

    # Companion meta JSON for diffing / debugging
    _write_meta_json(snap, db_path, elapsed)
    logger.info(f"[builder] {snap.name} built in {elapsed:.1f}s → {db_path}")
    return db_path


# ─── loaders (one per TSV) ─────────────────────────────────────────────────

def _load_files(graph: DepGraph, snap: Path) -> dict[str, int]:
    """Walk the snapshot's known file mentions across TSVs to build a `files` table.

    The TSVs all reference file paths but there's no canonical file list in the
    snapshot; we union the sets seen in _index.txt + _calls.txt + _endpoints.txt.
    """
    paths: set[str] = set()
    paths |= _column_values(snap / "_index.txt", col=0)
    paths |= _column_values(snap / "_calls.txt", col=0)
    paths |= _column_values(snap / "_calls.txt", col=2)
    paths |= _column_values(snap / "_imports.txt", col=0)
    paths |= _column_values(snap / "_inheritance.txt", col=3)
    paths |= _column_values(snap / "_endpoints.txt", col=5)
    paths |= _column_values(snap / "_interactions.txt", col=7)
    paths.discard("")
    paths.discard("-")

    rows = []
    for p in sorted(paths):
        rows.append((p, _guess_language(p), 0))
    graph.executemany(
        "INSERT INTO files(path, language, byte_size) VALUES (?, ?, ?)",
        rows,
    )
    # Build path -> id map
    out: dict[str, int] = {}
    for r in graph.query("SELECT id, path FROM files"):
        out[r["path"]] = r["id"]
    return out


def _load_symbols(graph: DepGraph, snap: Path,
                   file_to_id: dict[str, int]) -> dict[str, int]:
    """_index.txt columns: file, kind, name, scope, signature, line, flags"""
    p = snap / "_index.txt"
    if not p.exists():
        return {}
    qname_to_id: dict[str, int] = {}
    rows: list[tuple] = []
    for parts in _iter_tsv(p, expected_min_cols=4):
        file_path, kind, name, scope = parts[0], parts[1], parts[2], parts[3]
        line = _to_int(parts[5] if len(parts) > 5 else "")
        file_id = file_to_id.get(file_path)
        if file_id is None:
            continue
        # Build qualified_name from scope + name when scope is meaningful
        if scope and scope not in ("-", ""):
            qname = f"{scope}.{name}".replace("::", ".")
        else:
            qname = name
        rows.append((name, qname, kind, file_id, line, _guess_language(file_path)))

    graph.executemany(
        """INSERT OR IGNORE INTO symbols
           (name, qualified_name, kind, file_id, line, language)
           VALUES (?, ?, ?, ?, ?, ?)""",
        rows,
    )
    # Build qname -> id map (most recent wins on duplicate qname/file_id pairs)
    for r in graph.query("SELECT id, qualified_name FROM symbols"):
        qname_to_id[r["qualified_name"]] = r["id"]
    # Update files.n_symbols
    graph.execute("""
        UPDATE files SET n_symbols = (
            SELECT COUNT(*) FROM symbols WHERE symbols.file_id = files.id
        )
    """)
    return qname_to_id


def _load_imports(graph: DepGraph, snap: Path,
                   file_to_id: dict[str, int]) -> None:
    """_imports.txt columns: file, imports, names"""
    p = snap / "_imports.txt"
    if not p.exists():
        return
    rows: list[tuple] = []
    for parts in _iter_tsv(p, expected_min_cols=2):
        file_path, package = parts[0], parts[1]
        names = parts[2] if len(parts) > 2 else ""
        file_id = file_to_id.get(file_path)
        if file_id is None:
            continue
        # `names` can be a comma-separated list; explode for queryability
        if names and names != "-":
            for n in names.split(","):
                n = n.strip()
                if n:
                    rows.append((file_id, package, n))
        else:
            rows.append((file_id, package, None))
    graph.executemany(
        "INSERT INTO imports(file_id, package, imported_name) VALUES (?, ?, ?)",
        rows,
    )


def _load_calls(graph: DepGraph, snap: Path,
                 file_to_id: dict[str, int],
                 qname_to_id: dict[str, int]) -> None:
    """_calls.txt columns: caller_file, caller, callee_file, callee, line, confidence"""
    p = snap / "_calls.txt"
    if not p.exists():
        return
    rows: list[tuple] = []
    for parts in _iter_tsv(p, expected_min_cols=4):
        caller_file, caller_qname, callee_file, callee_qname = parts[:4]
        line = _to_int(parts[4]) if len(parts) > 4 else None
        conf = _to_float(parts[5]) if len(parts) > 5 else 1.0
        rows.append((
            qname_to_id.get(caller_qname),
            qname_to_id.get(callee_qname),
            callee_qname,
            conf,
            file_to_id.get(caller_file),
        ))
    graph.executemany(
        """INSERT INTO calls
           (caller_symbol_id, callee_symbol_id, callee_qualified_name,
            confidence, file_id)
           VALUES (?, ?, ?, ?, ?)""",
        rows,
    )


def _load_inheritance(graph: DepGraph, snap: Path,
                       file_to_id: dict[str, int],
                       qname_to_id: dict[str, int]) -> None:
    """_inheritance.txt columns: child, rel, parent, file"""
    p = snap / "_inheritance.txt"
    if not p.exists():
        return
    rows: list[tuple] = []
    for parts in _iter_tsv(p, expected_min_cols=3):
        child, rel, parent = parts[:3]
        file_path = parts[3] if len(parts) > 3 else ""
        # Resolve child by (qname OR bare name within file)
        child_id = qname_to_id.get(child)
        if child_id is None and file_path:
            row = graph.query_one(
                """SELECT s.id FROM symbols s
                   JOIN files f ON s.file_id = f.id
                   WHERE s.name = ? AND f.path = ?""",
                (child, file_path),
            )
            if row:
                child_id = row["id"]
        if child_id is None:
            continue
        parent_id = qname_to_id.get(parent)
        rows.append((child_id, parent_id, parent, rel or "extends"))
    graph.executemany(
        """INSERT INTO inheritance
           (child_symbol_id, parent_symbol_id, parent_qualified_name, kind)
           VALUES (?, ?, ?, ?)""",
        rows,
    )


def _load_endpoints(graph: DepGraph, snap: Path,
                     file_to_id: dict[str, int],
                     qname_to_id: dict[str, int]) -> None:
    """_endpoints.txt columns: type, path_or_address, operation, handler_class,
       handler_method, file, line, direction, protocol, framework, confidence"""
    p = snap / "_endpoints.txt"
    if not p.exists():
        return
    rows: list[tuple] = []
    for parts in _iter_tsv(p, expected_min_cols=7):
        path, operation = parts[1], parts[2]
        handler_cls, handler_method = parts[3], parts[4]
        file_path = parts[5]
        line = _to_int(parts[6])
        framework = parts[9] if len(parts) > 9 else ""
        # Resolve handler symbol: prefer "Class.method", fall back to bare method
        handler_qname = ""
        if handler_cls and handler_method:
            handler_qname = f"{handler_cls}.{handler_method}"
        handler_id = qname_to_id.get(handler_qname)
        if handler_id is None and handler_method:
            handler_id = qname_to_id.get(handler_method)
        rows.append((
            operation, path, framework, handler_id,
            file_to_id.get(file_path), line,
        ))
    graph.executemany(
        """INSERT INTO endpoints
           (operation, path, framework, handler_symbol_id, file_id, line)
           VALUES (?, ?, ?, ?, ?, ?)""",
        rows,
    )


def _load_interactions(graph: DepGraph, snap: Path,
                        file_to_id: dict[str, int],
                        qname_to_id: dict[str, int]) -> None:
    """_interactions.txt columns: type, target, direction, mechanism, data_entity,
       source_class, source_method, file, line, confidence, classified_by"""
    p = snap / "_interactions.txt"
    if not p.exists():
        return
    rows: list[tuple] = []
    for parts in _iter_tsv(p, expected_min_cols=4):
        target, direction, mechanism = parts[1], parts[2], parts[3]
        data_hint = parts[4] if len(parts) > 4 else ""
        source_cls = parts[5] if len(parts) > 5 else ""
        source_method = parts[6] if len(parts) > 6 else ""
        file_path = parts[7] if len(parts) > 7 else ""
        line = _to_int(parts[8]) if len(parts) > 8 else None
        source_qname = (f"{source_cls}.{source_method}"
                         if source_cls and source_method else
                         (source_method or source_cls))
        source_id = qname_to_id.get(source_qname)
        rows.append((
            source_id, target, mechanism, direction or "OUTBOUND",
            data_hint, file_to_id.get(file_path), line,
        ))
    graph.executemany(
        """INSERT INTO interactions
           (source_symbol_id, target, mechanism, direction, data_hint,
            file_id, line)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        rows,
    )


# ─── helpers ───────────────────────────────────────────────────────────────

def _iter_tsv(path: Path, expected_min_cols: int = 1) -> Iterator[list[str]]:
    """Yield rows as lists, skipping comments and short lines."""
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip("\n").rstrip("\r")
            if not line or line.startswith("#"):
                continue
            parts = line.split("\t")
            if len(parts) < expected_min_cols:
                continue
            yield parts


def _column_values(path: Path, col: int) -> set[str]:
    """Return the set of unique values in column `col` of a TSV file."""
    if not path.exists():
        return set()
    out: set[str] = set()
    for parts in _iter_tsv(path, expected_min_cols=col + 1):
        v = parts[col].strip()
        if v:
            out.add(v)
    return out


def _to_int(s: str) -> int | None:
    try:
        return int(s)
    except (ValueError, TypeError):
        return None


def _to_float(s: str) -> float:
    try:
        return float(s)
    except (ValueError, TypeError):
        return 1.0


def _guess_language(path: str) -> str:
    ext = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    return {
        "java": "java", "kt": "kotlin", "py": "python", "rb": "ruby",
        "go": "go", "js": "javascript", "jsx": "javascript",
        "ts": "typescript", "tsx": "typescript", "php": "php",
        "cs": "csharp", "cpp": "cpp", "hpp": "cpp", "h": "cpp",
        "rs": "rust", "swift": "swift",
    }.get(ext, "")


_SHA_RE = __import__("re").compile(r"^[0-9a-fA-F]{40}$")


def _read_upstream_meta(snap: Path) -> tuple[str | None, str | None]:
    """Extract `commit` and `remote` from the upstream `_meta.yaml` if present.

    Line-grep instead of pyyaml to avoid adding a dependency. Returns
    (commit_sha, repo_remote); either may be None.

    See: haikai/specs/2026-04-27-depgraph-commit-sha/spec.md
    """
    import re
    upstream = snap / "_meta.yaml"
    if not upstream.exists():
        return None, None
    try:
        text = upstream.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None, None
    commit, remote = None, None
    for line in text.splitlines():
        if commit is None:
            m = re.match(r"^\s*commit\s*:\s*['\"]?([0-9a-fA-F]{7,40})['\"]?\s*$", line)
            if m:
                v = m.group(1).lower()
                # Only accept full 40-char SHAs in the meta JSON (short-SHAs
                # may collide and aren't useful for staleness comparison).
                if _SHA_RE.match(v):
                    commit = v
        if remote is None:
            m = re.match(r"^\s*remote\s*:\s*(?:'([^']+)'|\"([^\"]+)\"|(\S+))\s*$", line)
            if m:
                remote = m.group(1) or m.group(2) or m.group(3)
    return commit, remote


def _write_meta_json(snap: Path, db_path: Path, build_seconds: float) -> None:
    """Companion JSON file with row counts + commit context for diffing."""
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    try:
        counts = {}
        for tbl in ("files", "symbols", "imports", "calls",
                    "inheritance", "endpoints", "interactions"):
            counts[tbl] = conn.execute(f"SELECT COUNT(*) FROM {tbl}").fetchone()[0]
    finally:
        conn.close()
    commit_sha, repo_remote = _read_upstream_meta(snap)
    meta = {
        "snapshot": str(snap),
        "db": str(db_path),
        "build_seconds": round(build_seconds, 2),
        "row_counts": counts,
        "commit_sha": commit_sha,
        "repo_remote": repo_remote,
    }
    (snap / META_FILENAME).write_text(json.dumps(meta, indent=2), encoding="utf-8")
