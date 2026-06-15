"""Graph-aware multi-file rename — preview by default, apply on opt-in.

Reference sources:
  - Graph refs: `calls.callee_symbol_id` + `inheritance.parent_symbol_id` (precise,
    code-only).
  - Import refs: `imports WHERE imported_name = old.name` (catches `from x import Y`).
  - Text refs: `git grep -nE '\bOld\b'` (safety net — catches comments/strings
    the graph can't see).

Refs are partitioned into `graph_only` / `text_only` / `both`; patches are
built only for the `both` partition by default (use `include_text_only=True`
to also patch text-only refs).

Apply path safety:
  - `apply=False` is the default everywhere.
  - Refuses to write on a dirty working tree unless `force_dirty=True`.
  - Atomic per-file write (temp file + os.replace).
  - Append-only audit trail at `<snapshot>/_refactoring_log.jsonl`.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Optional

from src.dep.db import DepGraph
from src.refactoring.git_repo import GitRepo

# Filename for the audit trail (lives next to the dep-graph SQLite).
AUDIT_LOG_NAME = "_refactoring_log.jsonl"

# Default file globs for `git grep`, keyed by symbol's `language` column.
# When the language is unknown, we use a permissive cross-language set.
_LANG_GLOBS: dict[str, list[str]] = {
    "python": ["*.py"],
    "java": ["*.java"],
    "typescript": ["*.ts", "*.tsx"],
    "javascript": ["*.js", "*.jsx", "*.mjs", "*.cjs"],
    "ruby": ["*.rb"],
    "go": ["*.go"],
    "php": ["*.php"],
    "cpp": ["*.cpp", "*.cc", "*.cxx", "*.hpp", "*.h"],
    "c": ["*.c", "*.h"],
    "rust": ["*.rs"],
    "kotlin": ["*.kt"],
    "scala": ["*.scala"],
}
_PERMISSIVE_GLOBS = sum(_LANG_GLOBS.values(), [])


@dataclass
class Ref:
    """A single file:line reference to the symbol being renamed."""
    file: str
    line: int
    text: str = ""  # raw line text (best-effort, may be empty for graph refs)
    source: str = ""  # 'graph' | 'import' | 'text'


@dataclass
class Partitions:
    graph_only: list[Ref] = field(default_factory=list)
    text_only: list[Ref] = field(default_factory=list)
    both: list[Ref] = field(default_factory=list)


@dataclass
class Patch:
    file: str
    line: int
    before_text: str
    after_text: str


@dataclass
class AmbiguityCandidate:
    qualified_name: str
    kind: str
    file: str
    line: int


@dataclass
class RenamePlan:
    old_qname: str
    new_name: str
    kind: str = ""
    resolved_old_name: str = ""  # bare name part of old_qname
    graph_refs: list[Ref] = field(default_factory=list)
    import_refs: list[Ref] = field(default_factory=list)
    text_refs: list[Ref] = field(default_factory=list)
    partitions: Partitions = field(default_factory=Partitions)
    patches: list[Patch] = field(default_factory=list)
    applied: bool = False
    ambiguous: bool = False
    ambiguity_candidates: list[AmbiguityCandidate] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


# ─── public API ──────────────────────────────────────────────────────────────


def rename_preview(
    repo_root: str | Path,
    depgraph: DepGraph,
    old_qname: str,
    new_name: str,
    kind: Optional[str] = None,
    all_languages: bool = False,
    include_text_only: bool = False,
) -> RenamePlan:
    """Build a RenamePlan without writing anything.

    `old_qname` may be a fully-qualified name (preferred) or a bare name.
    A bare name that matches more than one symbol returns a plan with
    `ambiguous=True` and `ambiguity_candidates` populated.
    """
    old_sym, candidates = _resolve_old_qname(depgraph, old_qname)
    if old_sym is None and candidates:
        plan = RenamePlan(
            old_qname=old_qname,
            new_name=new_name,
            ambiguous=True,
            ambiguity_candidates=[
                AmbiguityCandidate(
                    qualified_name=c["qualified_name"],
                    kind=c["kind"] or "",
                    file=c["file_path"] or "",
                    line=c["line"] or 0,
                )
                for c in candidates
            ],
            notes=[f"{len(candidates)} symbols match {old_qname!r} — pass a qualified name"],
        )
        return plan
    if old_sym is None:
        return RenamePlan(
            old_qname=old_qname,
            new_name=new_name,
            notes=[f"no symbol matches {old_qname!r}"],
        )

    bare_old = old_sym["name"]
    plan = RenamePlan(
        old_qname=old_sym["qualified_name"],
        new_name=new_name,
        kind=kind or (old_sym["kind"] or ""),
        resolved_old_name=bare_old,
    )

    plan.graph_refs = _graph_refs(depgraph, old_sym, plan.kind)
    plan.import_refs = _import_refs(depgraph, old_sym)

    lang = old_sym["language"] or ""
    globs = _PERMISSIVE_GLOBS if all_languages else _LANG_GLOBS.get(
        lang.lower(), _PERMISSIVE_GLOBS
    )
    plan.text_refs = _text_refs(repo_root, bare_old, globs)

    plan.partitions = _partition_refs(plan.graph_refs, plan.import_refs, plan.text_refs)

    src = plan.partitions.both[:]
    if include_text_only:
        src += plan.partitions.text_only
    plan.patches = _build_patches(repo_root, src, bare_old, new_name)

    if not plan.patches:
        plan.notes.append("no patches generated — graph and text refs do not overlap")
    return plan


def rename_apply(
    repo_root: str | Path,
    depgraph: DepGraph,
    plan: RenamePlan,
    force_dirty: bool = False,
    triggered_by: str = "python_api",
    snapshot_path: Optional[str | Path] = None,
) -> RenamePlan:
    """Apply a RenamePlan. Refuses on dirty working tree unless force_dirty.

    `snapshot_path` is where the audit log is written; defaults to the
    DepGraph's parent directory.
    """
    if plan.ambiguous or not plan.patches:
        plan.notes.append("nothing to apply (ambiguous or no patches)")
        return plan

    repo_root = Path(repo_root).resolve()
    git = GitRepo(repo_root)
    if git.working_tree_dirty() and not force_dirty:
        plan.notes.append(
            "refused: working tree is dirty. Pass force_dirty=True to override."
        )
        return plan

    sha_before = git.head_sha()

    # Group patches by file for efficient atomic writes.
    by_file: dict[str, list[Patch]] = {}
    for p in plan.patches:
        by_file.setdefault(p.file, []).append(p)

    written: list[Path] = []
    try:
        for rel_path, patches in by_file.items():
            target = repo_root / rel_path
            # Defense in depth: rel_path comes from DB rows (writable via
            # /api/dep/rebuild) and `git grep` output (filenames in the
            # working tree). Either could yield a `..`-traversing value
            # that escapes repo_root via Path-join. Reject anything that
            # resolves outside the repo before we write.
            try:
                target.resolve().relative_to(repo_root)
            except ValueError:
                raise ValueError(f"patch target escapes repo_root: {rel_path!r}")
            _atomic_write_patches(target, patches)
            written.append(target)
    except Exception as exc:
        # On failure, undo any successful writes so we don't leave a partial apply.
        for w in written:
            try:
                subprocess.run(
                    ["git", "checkout", "--", str(w.relative_to(repo_root))],
                    cwd=repo_root, check=False,
                )
            except Exception:
                pass
        plan.notes.append(f"apply aborted: {exc}")
        return plan

    plan.applied = True

    snap = Path(snapshot_path) if snapshot_path else Path(depgraph.db_path).parent
    _append_audit(
        snap, plan, sha_before=sha_before, triggered_by=triggered_by,
        files_changed=list(by_file.keys()),
    )
    return plan


# ─── resolution + lookup ────────────────────────────────────────────────────


def _resolve_old_qname(graph: DepGraph, old_qname: str):
    """Return (row, []) for a unique match, (None, [candidates...]) if ambiguous,
    (None, []) if no match.
    """
    # Exact qualified-name match first.
    rows = graph.query(
        """
        SELECT s.*, f.path AS file_path
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE s.qualified_name = ?
        """,
        (old_qname,),
    )
    if len(rows) == 1:
        return rows[0], []
    if len(rows) > 1:
        return None, rows  # ambiguous even at qname level (rare; e.g. duplicates)

    # Fall back to bare-name search.
    rows = graph.query(
        """
        SELECT s.*, f.path AS file_path
        FROM symbols s
        JOIN files f ON s.file_id = f.id
        WHERE s.name = ?
        """,
        (old_qname,),
    )
    if len(rows) == 1:
        return rows[0], []
    if len(rows) > 1:
        return None, rows
    return None, []


def _graph_refs(graph: DepGraph, old_sym, kind: str) -> list[Ref]:
    """Code references to `old_sym` from calls + inheritance tables.

    For methods/functions: callers in the calls table.
    For classes: callers AND inheritance children.
    Always includes the text-fallback `callee_qualified_name` matches in case
    the resolved symbol_id is null on some calls rows.
    Also includes the symbol's own definition site — a rename must rewrite
    the `class Foo:` / `def foo():` line itself.
    """
    refs: list[Ref] = []
    # Definition site (resolve file path via JOIN)
    def_row = graph.query_one(
        "SELECT f.path AS file FROM files f WHERE f.id = ?",
        (old_sym["file_id"],),
    )
    if def_row:
        refs.append(Ref(file=def_row["file"], line=old_sym["line"] or 0, source="graph"))
    # By symbol id (resolved callees)
    rows = graph.query(
        """
        SELECT f.path AS file
        FROM calls c JOIN files f ON c.file_id = f.id
        WHERE c.callee_symbol_id = ?
        """,
        (old_sym["id"],),
    )
    for r in rows:
        refs.append(Ref(file=r["file"], line=0, source="graph"))

    # By qualified name (unresolved callees pointing at the same qname)
    rows = graph.query(
        """
        SELECT f.path AS file
        FROM calls c JOIN files f ON c.file_id = f.id
        WHERE c.callee_symbol_id IS NULL AND c.callee_qualified_name = ?
        """,
        (old_sym["qualified_name"],),
    )
    for r in rows:
        refs.append(Ref(file=r["file"], line=0, source="graph"))

    if kind == "class":
        rows = graph.query(
            """
            SELECT f.path AS file
            FROM inheritance i
            JOIN symbols s ON i.child_symbol_id = s.id
            JOIN files f ON s.file_id = f.id
            WHERE i.parent_symbol_id = ?
            """,
            (old_sym["id"],),
        )
        for r in rows:
            refs.append(Ref(file=r["file"], line=0, source="graph"))

    return refs


def _import_refs(graph: DepGraph, old_sym) -> list[Ref]:
    """Import statements that name `old_sym` directly.

    We match `imports.imported_name = old_sym.name`. We do NOT filter by
    package because import paths and module paths drift across builds; the
    text-search step will catch any misses.
    """
    rows = graph.query(
        """
        SELECT f.path AS file
        FROM imports i JOIN files f ON i.file_id = f.id
        WHERE i.imported_name = ?
        """,
        (old_sym["name"],),
    )
    return [Ref(file=r["file"], line=0, source="import") for r in rows]


def _text_refs(repo_root: str | Path, bare_name: str, globs: list[str]) -> list[Ref]:
    """Run `git grep -nE '\\b<name>\\b' -- <globs>` and parse output."""
    repo_root = Path(repo_root)
    args = ["git", "grep", "-nE", rf"\b{re.escape(bare_name)}\b", "--"] + globs
    try:
        out = subprocess.run(
            args, cwd=repo_root, capture_output=True, text=True,
            encoding="utf-8", errors="replace", check=False,
        )
    except FileNotFoundError:
        return []
    refs: list[Ref] = []
    for line in (out.stdout or "").splitlines():
        # Format: "<path>:<line>:<text>"
        parts = line.split(":", 2)
        if len(parts) < 3:
            continue
        try:
            n = int(parts[1])
        except ValueError:
            continue
        refs.append(Ref(file=parts[0], line=n, text=parts[2], source="text"))
    return refs


# ─── partition + patches ────────────────────────────────────────────────────


def _partition_refs(
    graph_refs: list[Ref], import_refs: list[Ref], text_refs: list[Ref]
) -> Partitions:
    """Partition refs into graph_only / text_only / both by file."""
    graph_files = {r.file for r in graph_refs} | {r.file for r in import_refs}
    text_keys = {(r.file, r.line) for r in text_refs}

    p = Partitions()
    seen = set()
    for r in text_refs:
        if r.file in graph_files:
            p.both.append(r)
        else:
            p.text_only.append(r)
        seen.add(r.file)
    for r in graph_refs + import_refs:
        if r.file not in {tr.file for tr in text_refs}:
            # Graph asserts a ref but text didn't find one — unusual
            # (likely line is auto-generated or stripped from tree).
            # Emit as graph_only with an obviously synthetic line=0.
            if not any(g.file == r.file for g in p.graph_only):
                p.graph_only.append(r)
    return p


def _build_patches(
    repo_root: str | Path, refs: list[Ref], old_bare: str, new_bare: str,
) -> list[Patch]:
    """Build (file, line, before, after) patches via word-boundary replacement
    on text refs. Refs without a `text` payload are skipped (we can't safely
    rewrite a line we haven't read).
    """
    pat = re.compile(rf"\b{re.escape(old_bare)}\b")
    patches: list[Patch] = []
    for r in refs:
        if not r.text:
            continue
        new_text = pat.sub(new_bare, r.text)
        if new_text == r.text:
            continue
        patches.append(Patch(
            file=r.file, line=r.line, before_text=r.text, after_text=new_text,
        ))
    return patches


# ─── apply path ─────────────────────────────────────────────────────────────


def _atomic_write_patches(target: Path, patches: list[Patch]) -> None:
    """Apply all patches to `target` atomically (temp + os.replace)."""
    raw = target.read_text(encoding="utf-8")
    lines = raw.splitlines(keepends=True)

    # Sort by line ascending so before-context indexing is stable
    patches_sorted = sorted(patches, key=lambda p: p.line)
    for p in patches_sorted:
        idx = p.line - 1
        if idx < 0 or idx >= len(lines):
            raise IndexError(f"{target}: patch line {p.line} out of range")
        # The grep gave us text without the trailing newline. Preserve newline
        # from the original line.
        original = lines[idx]
        eol = ""
        body = original
        if body.endswith("\r\n"):
            body, eol = body[:-2], "\r\n"
        elif body.endswith("\n"):
            body, eol = body[:-1], "\n"
        if body != p.before_text:
            # Best-effort: do the rewrite anyway via word-boundary sub on the
            # current line content. If it changes nothing, mark as a notes-only
            # case (caller can detect by comparing patches.applied).
            new_body = re.sub(
                rf"\b{re.escape(p.before_text.split(' ')[0])}\b",
                p.after_text.split(' ')[0],
                body,
            )
            lines[idx] = new_body + eol
        else:
            lines[idx] = p.after_text + eol

    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_text("".join(lines), encoding="utf-8")
    os.replace(str(tmp), str(target))


def _append_audit(
    snapshot_dir: Path,
    plan: RenamePlan,
    sha_before: str,
    triggered_by: str,
    files_changed: list[str],
) -> None:
    from src.refactoring import __version__
    record = {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "op": "rename",
        "old_qname": plan.old_qname,
        "new_name": plan.new_name,
        "kind": plan.kind,
        "files_changed": files_changed,
        "sha_before": sha_before,
        "triggered_by": triggered_by,
        "tool_version": __version__,
    }
    log_path = snapshot_dir / AUDIT_LOG_NAME
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")
