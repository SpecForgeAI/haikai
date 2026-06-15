"""DepGraph — thin wrapper around the per-snapshot SQLite dependency graph."""
from __future__ import annotations

import logging
import sqlite3
import os
from pathlib import Path
from typing import Any, Iterable, Optional

logger = logging.getLogger(__name__)

SCHEMA_PATH = Path(__file__).parent / "schema.sql"
GRAPH_FILENAME = "_depgraph.sqlite"
META_FILENAME = "_depgraph.meta.json"

INPUT_TSV_NAMES = (
    "_index.txt",
    "_imports.txt",
    "_calls.txt",
    "_inheritance.txt",
    "_endpoints.txt",
    "_interactions.txt",
)


class DepGraph:
    """Owns the SQLite connection for one snapshot's dependency graph.

    Lifecycle:
      - open_or_build(snapshot_path) is the only entry point users need
      - opens existing _depgraph.sqlite if present AND newer than every input TSV
      - else builds via builder.run() and reopens
    """

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.conn = sqlite3.connect(str(self.db_path))
        self.conn.row_factory = sqlite3.Row
        # Defer pragmas to schema.sql application

    def __del__(self):
        """Safety-net close for callers that don't use the context manager.

        Without this, `g = DepGraph(p); g.execute(...)` followed by an
        exception in execute() would leak the underlying SQLite handle
        until Python GC runs. Prefer `with DepGraph(p) as g:` instead.
        """
        try:
            if hasattr(self, "conn") and self.conn is not None:
                self.conn.close()
        except Exception:
            pass

    # ─── construction ────────────────────────────────────────────────────

    @classmethod
    def open_or_build(cls, snapshot_path: str | Path,
                      force_rebuild: bool = False) -> "DepGraph":
        """Open the snapshot's _depgraph.sqlite, building it if missing/stale.

        Stale = SQLite mtime older than ANY input TSV mtime.
        force_rebuild=True deletes the existing DB first.
        """
        snap = Path(snapshot_path)
        if not snap.exists():
            raise FileNotFoundError(f"snapshot not found: {snap}")
        db = snap / GRAPH_FILENAME

        if force_rebuild and db.exists():
            db.unlink()

        if db.exists() and not _stale(db, snap):
            logger.debug(f"[DepGraph] reusing fresh DB at {db}")
            return cls(db)

        # Build (lazy import to avoid circular at module load)
        from src.dep.builder import run as build_run
        logger.info(f"[DepGraph] building {db} from {snap}")
        build_run(snap)
        return cls(db)

    @classmethod
    def create_empty(cls, db_path: str | Path) -> "DepGraph":
        """Create a fresh DB with the schema applied. Used by the builder
        before it loads rows."""
        db_path = Path(db_path)
        if db_path.exists():
            db_path.unlink()
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path))
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        conn.commit()
        conn.close()
        return cls(db_path)

    # ─── basic helpers ───────────────────────────────────────────────────

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        return self.conn.execute(sql, tuple(params))

    def executemany(self, sql: str, rows: Iterable[Iterable[Any]]) -> sqlite3.Cursor:
        return self.conn.executemany(sql, rows)

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        return self.execute(sql, params).fetchall()

    def query_one(self, sql: str, params: Iterable[Any] = ()) -> Optional[sqlite3.Row]:
        return self.execute(sql, params).fetchone()

    def commit(self) -> None:
        self.conn.commit()

    def close(self) -> None:
        try:
            self.conn.close()
        except Exception:
            pass

    # ─── meta helpers ────────────────────────────────────────────────────

    def set_meta(self, key: str, value: str) -> None:
        self.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)",
                     (key, value))

    def get_meta(self, key: str, default: Optional[str] = None) -> Optional[str]:
        row = self.query_one("SELECT value FROM meta WHERE key = ?", (key,))
        return row["value"] if row else default

    # ─── lookup helpers used by engines ──────────────────────────────────

    def find_symbol(self, name_or_qname: str) -> list[sqlite3.Row]:
        """Find a symbol by qualified_name (preferred) or by bare name (fallback)."""
        rows = self.query(
            "SELECT * FROM symbols WHERE qualified_name = ?",
            (name_or_qname,),
        )
        if rows:
            return rows
        return self.query(
            "SELECT * FROM symbols WHERE name = ?",
            (name_or_qname,),
        )

    def __enter__(self) -> "DepGraph":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()


def _stale(db_path: Path, snapshot_dir: Path) -> bool:
    """True if any input TSV is newer than the SQLite DB."""
    db_mtime = db_path.stat().st_mtime
    for n in INPUT_TSV_NAMES:
        p = snapshot_dir / n
        if p.exists() and p.stat().st_mtime > db_mtime:
            return True
    return False
