"""File-based persistent store for structural analysis.

Writes analysis results as plain text files in a directory tree
that mirrors the analyzed project. Designed for grep, not SQL.
"""
import logging
import os
import subprocess
import yaml
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from src.ast.models import StructuralAnalysis, SymbolKind, CallInfo, EndpointInfo, InteractionInfo

logger = logging.getLogger(__name__)


def _tsv_safe(v) -> str:
    """Strip tabs/newlines/CRs from a TSV cell value.

    LLM-derived fields (endpoint paths, interaction targets, mechanism
    names, even ctags signatures from weirdly-formatted source) can carry
    literal `\\t` / `\\n` / `\\r`. Embedding them in a TSV row shifts
    columns or splits a row in two — letting attacker-controlled data
    forge a fake row in `_index.txt`, `_endpoints.txt`, etc.

    Mirrors the helper in `interaction_classifier.write_classified_interactions`
    so the on-disk file ends up with consistent escaping regardless of which
    writer ran last (commit `7af0c83` only patched the classifier; this
    file's writers later overwrite that file unescaped — see autoresearch
    260504-0934 finding #1).
    """
    s = "" if v is None else str(v)
    return s.replace("\t", " ").replace("\n", " ").replace("\r", " ")


class FileStore:
    """File-based persistent store for structural analysis.

    Writes analysis results as plain text files in a directory tree
    that mirrors the analyzed project. Designed for grep, not SQL.
    """

    def __init__(self, base_path: str = ".specforge/structural", config: Optional[dict] = None):
        self.base_path = Path(base_path)
        self.config = config or {}
        self.max_snapshots = self.config.get("max_snapshots", 20)
        self.auto_generate_diagrams = self.config.get("diagrams", {}).get("auto_generate", True)

    def write_snapshot(self, repo_name: str, commit_sha: str,
                       branch: str, provider: str,
                       analyses: dict[str, StructuralAnalysis],
                       project_root: str) -> str:
        """Write a full analysis snapshot to disk.

        Creates directory structure, writes all files, updates latest symlink.
        Returns path to snapshot directory.
        """
        self._project_root = str(Path(project_root).resolve()).replace("\\", "/").rstrip("/") + "/"
        short_sha = commit_sha[:7] if commit_sha else f"nocommit-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}"
        snapshot_path = self.base_path / repo_name / short_sha
        snapshot_path.mkdir(parents=True, exist_ok=True)

        analyzed_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

        # Collect language stats
        languages: dict[str, int] = {}
        for analysis in analyses.values():
            lang = analysis.language
            if lang and lang != "unknown":
                languages[lang] = languages.get(lang, 0) + 1

        total_symbols = sum(len(a.symbols) for a in analyses.values())

        meta = {
            "repo": repo_name,
            "commit": commit_sha,
            "branch": branch,
            "analyzed_at": analyzed_at,
            "provider": provider,
            "file_count": len(analyses),
            "symbol_count": total_symbols,
            "languages": languages,
        }

        # Try to get remote URL
        remote = self._get_git_remote(project_root)
        if remote:
            meta["remote"] = remote

        # Write all files
        self.write_meta(snapshot_path, meta)
        self.write_index(snapshot_path, analyses)
        self.write_inheritance(snapshot_path, analyses)
        self.write_imports(snapshot_path, analyses)
        self.write_patterns(snapshot_path, analyses)
        self.write_calls(snapshot_path, analyses)
        self.write_endpoints(snapshot_path, analyses)
        self.write_interactions(snapshot_path, analyses)
        self.write_extraction_meta(snapshot_path, analyses)
        self.write_stats(snapshot_path, analyses, meta)

        # Write per-file .struct files
        for file_path, analysis in analyses.items():
            self.write_file_struct(snapshot_path, file_path, analysis, project_root)

        # Update latest symlink/pointer
        self._update_latest(repo_name, short_sha)

        # Prune old snapshots
        self._prune_snapshots(repo_name)

        # NOTE: Diagrams are now generated at the end of pipeline.py (Step 8)
        # so they can see all enrichment data (endpoints, interactions, etc.)
        # The store no longer triggers diagram generation.

        # Generate diff if previous snapshot exists
        self._generate_diff(repo_name, short_sha)

        logger.info(f"Structural snapshot written: {snapshot_path} ({len(analyses)} files, {total_symbols} symbols)")
        return str(snapshot_path)

    def get_latest_path(self, repo_name: str) -> Optional[str]:
        """Return path to latest snapshot for a repo."""
        latest_file = self.base_path / repo_name / "latest.txt"
        if latest_file.exists():
            target = latest_file.read_text(encoding="utf-8").strip()
            target_path = self.base_path / repo_name / target
            if target_path.exists():
                return str(target_path)
        # Fallback: check for symlink
        latest_link = self.base_path / repo_name / "latest"
        if latest_link.exists():
            return str(latest_link.resolve())
        return None

    def list_snapshots(self, repo_name: str) -> list[dict]:
        """List all snapshots with metadata."""
        repo_path = self.base_path / repo_name
        if not repo_path.exists():
            return []
        snapshots = []
        for entry in sorted(repo_path.iterdir()):
            if entry.is_dir() and entry.name not in ("latest",):
                meta_file = entry / "_meta.yaml"
                if meta_file.exists():
                    with open(meta_file, encoding="utf-8") as f:
                        meta = yaml.safe_load(f) or {}
                    snapshots.append(meta)
        return snapshots

    def write_meta(self, path: Path, meta: dict):
        """Write _meta.yaml - snapshot metadata."""
        # Format languages as list of "Language: count" for YAML readability
        meta_out = dict(meta)
        if "languages" in meta_out and isinstance(meta_out["languages"], dict):
            meta_out["languages"] = [
                f"{lang}: {count}" for lang, count in sorted(meta_out["languages"].items())
            ]
        with open(path / "_meta.yaml", "w", encoding="utf-8") as f:
            yaml.dump(meta_out, f, default_flow_style=False, sort_keys=False,
                      allow_unicode=True)

    def write_index(self, path: Path, analyses: dict[str, StructuralAnalysis]):
        """Write _index.txt - flat symbol index, tab-separated."""
        lines = ["# file\tkind\tname\tscope\tsignature\tline\tflags"]
        for file_path, analysis in sorted(analyses.items()):
            rel_path = self._normalize_path(file_path)
            for sym in analysis.symbols:
                scope = sym.scope or "-"
                sig = sym.signature or "-"
                flags = self._build_flags(sym, analysis)
                lines.append(
                    f"{_tsv_safe(rel_path)}\t{_tsv_safe(sym.kind)}\t"
                    f"{_tsv_safe(sym.name)}\t{_tsv_safe(scope)}\t"
                    f"{_tsv_safe(sig)}\t{sym.line_start}\t{_tsv_safe(flags)}"
                )
        with open(path / "_index.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def write_inheritance(self, path: Path, analyses: dict[str, StructuralAnalysis]):
        """Write _inheritance.txt - all inheritance relationships."""
        lines = ["# child\trel\tparent\tfile"]
        for file_path, analysis in sorted(analyses.items()):
            rel_path = self._normalize_path(file_path)
            for inh in analysis.inheritance:
                for base in inh.bases:
                    lines.append(
                        f"{_tsv_safe(inh.class_name)}\textends\t"
                        f"{_tsv_safe(base)}\t{_tsv_safe(rel_path)}"
                    )
                for iface in inh.interfaces:
                    lines.append(
                        f"{_tsv_safe(inh.class_name)}\timplements\t"
                        f"{_tsv_safe(iface)}\t{_tsv_safe(rel_path)}"
                    )
        with open(path / "_inheritance.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def write_imports(self, path: Path, analyses: dict[str, StructuralAnalysis]):
        """Write _imports.txt - all import relationships."""
        lines = ["# file\timports\tnames"]
        for file_path, analysis in sorted(analyses.items()):
            rel_path = self._normalize_path(file_path)
            for imp in analysis.imports:
                names = ",".join(imp.names) if imp.names else "-"
                lines.append(
                    f"{_tsv_safe(rel_path)}\t{_tsv_safe(imp.module)}\t"
                    f"{_tsv_safe(names)}"
                )
        with open(path / "_imports.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def write_patterns(self, path: Path, analyses: dict[str, StructuralAnalysis]):
        """Write _patterns.txt - detected design patterns."""
        lines = ["# pattern\tconfidence\tsymbol\tfile\tevidence"]
        patterns = self._detect_patterns(analyses)
        for p in patterns:
            lines.append(
                f"{_tsv_safe(p['pattern'])}\t{p['confidence']}\t"
                f"{_tsv_safe(p['symbol'])}\t{_tsv_safe(p['file'])}\t"
                f"{_tsv_safe(p['evidence'])}"
            )
        with open(path / "_patterns.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def write_calls(self, path: Path, analyses: dict[str, StructuralAnalysis]):
        """Write _calls.txt — call graph from LSP data.

        Always written (header-only when no call data) so the file's
        existence is predictable for consumers.
        """
        lines = ["# caller_file\tcaller\tcallee_file\tcallee\tline\tconfidence"]
        for file_path, analysis in sorted(analyses.items()):
            rel_path = self._normalize_path(file_path)
            for call in analysis.calls:
                callee_file = self._normalize_path(call.callee_file) if call.callee_file != "-" else "-"
                confidence = f"{call.confidence:.2f}"
                lines.append(
                    f"{_tsv_safe(rel_path)}\t{_tsv_safe(call.caller_name)}\t"
                    f"{_tsv_safe(callee_file)}\t{_tsv_safe(call.callee_name)}\t"
                    f"{call.line}\t{confidence}"
                )
        with open(path / "_calls.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def write_endpoints(self, path: Path, analyses: dict[str, StructuralAnalysis]):
        """Write _endpoints.txt — detected API endpoints, tab-separated."""
        lines = ["# type\tpath_or_address\toperation\thandler_class\thandler_method\tfile\tline\tdirection\tprotocol\tframework\tconfidence"]
        for file_path, analysis in sorted(analyses.items()):
            rel_path = self._normalize_path(file_path)
            for ep in analysis.endpoints:
                confidence = f"{ep.confidence:.2f}"
                lines.append(
                    f"{_tsv_safe(ep.type)}\t{_tsv_safe(ep.path)}\t"
                    f"{_tsv_safe(ep.operation)}\t{_tsv_safe(ep.handler_class)}\t"
                    f"{_tsv_safe(ep.handler_method)}\t{_tsv_safe(rel_path)}\t"
                    f"{ep.line}\t{_tsv_safe(ep.direction)}\t"
                    f"{_tsv_safe(ep.protocol)}\t{_tsv_safe(ep.framework)}\t{confidence}"
                )
        with open(path / "_endpoints.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def write_interactions(self, path: Path, analyses: dict[str, StructuralAnalysis]):
        """Write _interactions.txt — detected data movements, tab-separated."""
        lines = ["# source_class\tsource_method\ttarget\ttarget_type\tdirection\tmechanism\tdata_hint\tfile\tline\tconfidence"]
        for file_path, analysis in sorted(analyses.items()):
            rel_path = self._normalize_path(file_path)
            for dm in analysis.interactions:
                confidence = f"{dm.confidence:.2f}"
                lines.append(
                    f"{_tsv_safe(dm.source_class)}\t{_tsv_safe(dm.source_method)}\t"
                    f"{_tsv_safe(dm.target)}\t{_tsv_safe(dm.target_type)}\t"
                    f"{_tsv_safe(dm.direction)}\t{_tsv_safe(dm.mechanism)}\t"
                    f"{_tsv_safe(dm.data_hint)}\t{_tsv_safe(rel_path)}\t"
                    f"{dm.line}\t{confidence}"
                )
        with open(path / "_interactions.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def write_extraction_meta(self, path: Path, analyses: dict[str, StructuralAnalysis],
                               discovery_method: str = "ast",
                               classification_stats: dict = None):
        """Write _extraction_meta.yaml — endpoint/data-movement extraction metadata."""
        from datetime import datetime, timezone as tz

        total_endpoints = sum(len(a.endpoints) for a in analyses.values())
        total_interactions = sum(len(a.interactions) for a in analyses.values())
        enriched = sum(1 for a in analyses.values() for i in a.interactions if i.data_hint)

        # Collect framework stats from endpoints
        framework_counts: dict[str, int] = {}
        for analysis in analyses.values():
            for ep in analysis.endpoints:
                if ep.framework:
                    framework_counts[ep.framework] = framework_counts.get(ep.framework, 0) + 1

        # Collect mechanism stats from interactions
        mechanism_counts: dict[str, int] = {}
        for analysis in analyses.values():
            for i in analysis.interactions:
                if i.mechanism:
                    mechanism_counts[i.mechanism] = mechanism_counts.get(i.mechanism, 0) + 1

        meta = {
            "extraction": {
                "timestamp": datetime.now(tz.utc).isoformat(timespec="seconds"),
                "discovery_method": discovery_method,
                "stats": {
                    "endpoints_found": total_endpoints,
                    "interactions_found": total_interactions,
                    "interactions_enriched": enriched,
                },
                "sources": classification_stats or {},
                "frameworks_detected": [
                    {"name": name, "endpoint_count": count}
                    for name, count in sorted(framework_counts.items())
                ],
                "mechanisms_detected": [
                    {"name": name, "count": count}
                    for name, count in sorted(mechanism_counts.items())
                ],
            }
        }

        with open(path / "_extraction_meta.yaml", "w", encoding="utf-8") as f:
            yaml.dump(meta, f, default_flow_style=False, sort_keys=False)

    def write_stats(self, path: Path, analyses: dict[str, StructuralAnalysis], meta: dict):
        """Write _stats.txt - aggregate statistics."""
        # Count by kind
        kind_counts: dict[str, int] = {}
        for analysis in analyses.values():
            for sym in analysis.symbols:
                kind_counts[sym.kind] = kind_counts.get(sym.kind, 0) + 1

        # Count by language
        lang_stats: dict[str, dict] = {}
        for analysis in analyses.values():
            lang = analysis.language if analysis.language != "unknown" else "Unknown"
            if lang not in lang_stats:
                lang_stats[lang] = {"files": 0, "symbols": 0}
            lang_stats[lang]["files"] += 1
            lang_stats[lang]["symbols"] += len(analysis.symbols)

        # Inheritance depth
        max_depth, avg_depth, class_count = self._compute_inheritance_depth(analyses)

        # Async methods count
        async_count = sum(
            1 for a in analyses.values()
            for s in a.symbols
            if s.is_async
        )
        total_methods = kind_counts.get(SymbolKind.METHOD, 0)
        async_pct = (async_count * 100 // total_methods) if total_methods > 0 else 0

        # Classes with methods
        classes_with_methods = self._count_classes_with_methods(analyses)
        abstract_classes = sum(
            1 for a in analyses.values()
            for inh in a.inheritance
            if inh.is_abstract
        )
        total_classes = kind_counts.get(SymbolKind.CLASS, 0)
        avg_methods = (total_methods / total_classes) if total_classes > 0 else 0

        # Pattern count
        patterns = self._detect_patterns(analyses)
        pattern_summary: dict[str, list[float]] = {}
        for p in patterns:
            pattern_summary.setdefault(p["pattern"], []).append(p["confidence"])

        lines = [
            f"Repository: {meta.get('repo', 'unknown')}",
            f"Analyzed: {meta.get('analyzed_at', 'unknown')}",
            f"Provider: {meta.get('provider', 'unknown')}",
            "",
            f"Files: {meta.get('file_count', 0)}",
            f"Symbols: {meta.get('symbol_count', 0)}",
            "",
            "By Kind:",
        ]
        for kind, count in sorted(kind_counts.items(), key=lambda x: -x[1]):
            lines.append(f"  {kind:<14}{count}")

        lines.append("")
        lines.append("By Language:")
        for lang, stats in sorted(lang_stats.items()):
            lines.append(f"  {lang:<14}{stats['files']} files, {stats['symbols']} symbols")

        lines.append("")
        lines.append("Inheritance Depth:")
        lines.append(f"  max         {max_depth}")
        lines.append(f"  avg         {avg_depth:.1f}")

        lines.append("")
        lines.append(f"Top-Level Classes: {total_classes}")
        lines.append(f"  with methods: {classes_with_methods}")
        lines.append(f"  abstract: {abstract_classes}")
        lines.append(f"  avg methods per class: {avg_methods:.1f}")

        lines.append("")
        lines.append(f"Async Methods: {async_count} ({async_pct}% of all methods)")

        lines.append("")
        lines.append(f"Design Patterns: {len(patterns)} detected")
        for pname, confs in sorted(pattern_summary.items()):
            avg_conf = sum(confs) / len(confs)
            lines.append(f"  {pname:<14}{len(confs)} instance{'s' if len(confs) != 1 else ''} (avg confidence {avg_conf:.1f})")

        with open(path / "_stats.txt", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    def write_file_struct(self, snapshot_path: Path, file_path: str,
                          analysis: StructuralAnalysis, project_root: str = ""):
        """Write a single .struct file mirroring the project file."""
        rel_path = self._normalize_path(file_path)
        struct_path = snapshot_path / (rel_path + ".struct")
        struct_path.parent.mkdir(parents=True, exist_ok=True)

        lines = [
            f"File: {rel_path}",
            f"Language: {analysis.language}",
            f"Provider: {analysis.provider_used}",
            f"Symbols: {len(analysis.symbols)}",
        ]

        # Imports section
        if analysis.imports:
            lines.append("")
            lines.append("Imports:")
            for imp in analysis.imports:
                if imp.names:
                    lines.append(f"  {imp.module} ({', '.join(imp.names)})")
                else:
                    lines.append(f"  {imp.module}")

        # Symbols section - grouped by scope
        if analysis.symbols:
            lines.append("")
            lines.append("Symbols:")
            top_level = [s for s in analysis.symbols if s.scope is None]
            by_scope: dict[str, list] = {}
            for s in analysis.symbols:
                if s.scope:
                    by_scope.setdefault(s.scope, []).append(s)

            for sym in sorted(top_level, key=lambda s: s.line_start):
                lines.append(f"  {self._format_symbol_line(sym)}")
                if sym.name in by_scope:
                    for child in sorted(by_scope[sym.name], key=lambda s: s.line_start):
                        lines.append(f"    {self._format_symbol_line(child)}")

        # Inheritance section
        if analysis.inheritance:
            lines.append("")
            lines.append("Inheritance:")
            for inh in analysis.inheritance:
                for base in inh.bases:
                    lines.append(f"  {inh.class_name} \u2192 {base}")
                for iface in inh.interfaces:
                    lines.append(f"  {inh.class_name} implements {iface}")

        with open(struct_path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    # --- Private helpers ---

    def _normalize_path(self, file_path: str) -> str:
        """Normalize file path to relative, forward-slash form.

        Always returns a relative path. If the input is absolute and outside
        the configured project_root, the leading separator is stripped — this
        prevents `snapshot_path / normalized` from escaping the snapshot via
        Path's "absolute right side wins" semantics (e.g. on POSIX, `Path(
        "/snap") / "/etc/passwd"` becomes `/etc/passwd`).
        """
        p = file_path.replace("\\", "/")
        # Strip absolute project root prefix
        if hasattr(self, "_project_root") and self._project_root:
            resolved = str(Path(p).resolve()).replace("\\", "/")
            if resolved.startswith(self._project_root):
                p = resolved[len(self._project_root):]
                return p.lstrip("/")
        # Strip common prefixes
        if p.startswith("./"):
            p = p[2:]
        # Force-relative: drop leading slash and Windows drive letter so a
        # callers using `snapshot_path / normalized` always stay under the
        # snapshot. (Defensive — file_path is normally project-relative.)
        if p.startswith("/"):
            p = p.lstrip("/")
        elif len(p) >= 2 and p[1] == ":":
            # "C:/foo" → "C/foo" (drop colon to keep the path component)
            p = p[0] + p[2:]
        return p

    def _build_flags(self, sym, analysis: StructuralAnalysis) -> str:
        """Build flags string for _index.txt."""
        flags = []
        if sym.is_async:
            flags.append("async")
        if sym.is_abstract:
            flags.append("abstract")
        if sym.decorators:
            # decorated:Name1|Name2 — the names let ast_query filter
            # mechanically on an LLM-supplied pattern (e.g. ".*Mapping")
            # without the AST layer knowing any framework (D1).
            names = "|".join(d.lstrip("@").split("(")[0] for d in sym.decorators if d)
            flags.append(f"decorated:{names}" if names else "decorated")
        if sym.inherits:
            flags.append(f"extends:{sym.inherits}")
        return ",".join(flags) if flags else "-"

    def _format_symbol_line(self, sym) -> str:
        """Format a symbol for .struct file."""
        parts = [f"{sym.kind} {sym.name}"]
        if sym.inherits:
            parts[0] += f" extends {sym.inherits}"
        if sym.signature:
            parts[0] += sym.signature
        line_range = f"[{sym.line_start}-{sym.line_end}]" if sym.line_end else f"[{sym.line_start}]"
        parts[0] += f" {line_range}"
        extras = []
        if sym.is_async:
            extras.append("async")
        if sym.is_abstract:
            extras.append("abstract")
        if extras:
            parts[0] += f" [{', '.join(extras)}]"
        return parts[0]

    def _update_latest(self, repo_name: str, short_sha: str):
        """Update latest pointer. Uses latest.txt for Windows compat, symlink where possible."""
        repo_path = self.base_path / repo_name
        # Always write latest.txt (Windows-safe)
        latest_file = repo_path / "latest.txt"
        latest_file.write_text(short_sha)

        # Try symlink too
        latest_link = repo_path / "latest"
        try:
            if latest_link.exists() or latest_link.is_symlink():
                latest_link.unlink()
            latest_link.symlink_to(f"./{short_sha}", target_is_directory=True)
        except OSError:
            # Symlinks may not work on Windows without elevated privileges
            pass

    def _prune_snapshots(self, repo_name: str):
        """Remove oldest snapshots beyond max_snapshots."""
        repo_path = self.base_path / repo_name
        if not repo_path.exists():
            return
        snapshots = []
        for entry in repo_path.iterdir():
            if entry.is_dir() and entry.name not in ("latest",):
                meta_file = entry / "_meta.yaml"
                if meta_file.exists():
                    snapshots.append(entry)

        if len(snapshots) <= self.max_snapshots:
            return

        # Sort by modification time, remove oldest
        snapshots.sort(key=lambda p: p.stat().st_mtime)
        to_remove = snapshots[:len(snapshots) - self.max_snapshots]
        for snap in to_remove:
            import shutil
            shutil.rmtree(snap, ignore_errors=True)
            logger.info(f"Pruned old snapshot: {snap}")

    def _detect_patterns(self, analyses: dict[str, StructuralAnalysis]) -> list[dict]:
        """Detect common design patterns from structural data."""
        patterns = []
        for file_path, analysis in analyses.items():
            rel_path = self._normalize_path(file_path)
            for sym in analysis.symbols:
                if sym.kind != SymbolKind.CLASS:
                    continue

                # Get methods for this class
                methods = [s for s in analysis.symbols if s.scope == sym.name and s.kind == SymbolKind.METHOD]
                method_names = {m.name for m in methods}

                # Repository pattern
                repo_methods = {"get", "find", "save", "delete", "create", "update", "list"}
                repo_overlap = method_names & repo_methods
                if len(repo_overlap) >= 3 or "repository" in sym.name.lower() or "repo" in sym.name.lower():
                    if len(repo_overlap) >= 2:
                        evidence = f"CRUD methods: {', '.join(sorted(repo_overlap))}"
                        if sym.inherits:
                            evidence += f"; extends {sym.inherits}"
                        patterns.append({
                            "pattern": "repository",
                            "confidence": min(0.9, 0.4 + len(repo_overlap) * 0.15),
                            "symbol": sym.name,
                            "file": rel_path,
                            "evidence": evidence,
                        })

                # Factory pattern
                factory_indicators = {m.name for m in methods if m.name.startswith("create") or m.name.startswith("get_") or m.name.startswith("build")}
                if "factory" in sym.name.lower() or (len(factory_indicators) >= 2):
                    evidence_parts = []
                    if factory_indicators:
                        evidence_parts.append(f"factory methods: {', '.join(sorted(factory_indicators))}")
                    if sym.inherits:
                        evidence_parts.append(f"returns {sym.inherits} subclasses")
                    patterns.append({
                        "pattern": "factory",
                        "confidence": 0.8 if "factory" in sym.name.lower() else 0.6,
                        "symbol": sym.name,
                        "file": rel_path,
                        "evidence": "; ".join(evidence_parts) if evidence_parts else f"class name contains factory pattern",
                    })

                # Singleton pattern
                singleton_indicators = {"_instance", "get_instance", "instance"}
                if method_names & singleton_indicators or any(
                    s.name in ("_instance", "instance") for s in analysis.symbols
                    if s.scope == sym.name and s.kind in (SymbolKind.VARIABLE, SymbolKind.PROPERTY)
                ):
                    patterns.append({
                        "pattern": "singleton",
                        "confidence": 0.5,
                        "symbol": sym.name,
                        "file": rel_path,
                        "evidence": "_instance attribute + get_instance method",
                    })

                # Observer pattern
                observer_methods = {"subscribe", "notify", "on_event", "emit", "publish",
                                    "add_listener", "remove_listener", "on", "off"}
                obs_overlap = method_names & observer_methods
                if len(obs_overlap) >= 2:
                    patterns.append({
                        "pattern": "observer",
                        "confidence": 0.8,
                        "symbol": sym.name,
                        "file": rel_path,
                        "evidence": f"{', '.join(sorted(obs_overlap))} methods",
                    })

        return patterns

    def _compute_inheritance_depth(self, analyses: dict[str, StructuralAnalysis]) -> tuple:
        """Compute max and average inheritance depth."""
        # Build parent map
        parent_map: dict[str, list[str]] = {}
        for analysis in analyses.values():
            for inh in analysis.inheritance:
                parent_map[inh.class_name] = inh.bases

        if not parent_map:
            return 0, 0.0, 0

        def depth(cls, visited=None):
            if visited is None:
                visited = set()
            if cls in visited or cls not in parent_map:
                return 0
            visited.add(cls)
            return 1 + max((depth(p, visited.copy()) for p in parent_map[cls]), default=0)

        depths = [depth(cls) for cls in parent_map]
        max_d = max(depths) if depths else 0
        avg_d = sum(depths) / len(depths) if depths else 0.0
        return max_d, avg_d, len(parent_map)

    def _count_classes_with_methods(self, analyses: dict[str, StructuralAnalysis]) -> int:
        """Count classes that have at least one method."""
        count = 0
        for analysis in analyses.values():
            class_names = {s.name for s in analysis.symbols if s.kind == SymbolKind.CLASS}
            for cn in class_names:
                if any(s.scope == cn and s.kind == SymbolKind.METHOD for s in analysis.symbols):
                    count += 1
        return count

    def _get_git_remote(self, project_root: str) -> Optional[str]:
        """Get git remote URL."""
        try:
            result = subprocess.run(
                ["git", "remote", "get-url", "origin"],
                capture_output=True, text=True,
                encoding="utf-8", errors="replace",
                timeout=5,
                cwd=project_root or "."
            )
            if result.returncode == 0:
                return result.stdout.strip()
        except Exception:
            pass
        return None

    def _generate_diagrams(self, snapshot_path: Path):
        """Generate diagrams from index files."""
        try:
            from src.ast.diagram_generator import DiagramGenerator
            generator = DiagramGenerator()
            generator.generate_all(snapshot_path)
        except Exception as e:
            logger.warning(f"Diagram generation failed: {e}")

    def _generate_diff(self, repo_name: str, current_sha: str):
        """Generate diff against previous snapshot if one exists."""
        try:
            repo_path = self.base_path / repo_name
            snapshots = []
            for entry in repo_path.iterdir():
                if entry.is_dir() and entry.name not in ("latest", current_sha):
                    if (entry / "_meta.yaml").exists():
                        snapshots.append(entry)

            if not snapshots:
                return

            # Find most recent previous snapshot
            snapshots.sort(key=lambda p: p.stat().st_mtime, reverse=True)
            prev_snapshot = snapshots[0]

            from src.ast.structural_diff import StructuralDiff
            differ = StructuralDiff()
            current_path = repo_path / current_sha
            differ.generate_diff(prev_snapshot, current_path)
        except Exception as e:
            logger.warning(f"Diff generation failed: {e}")


def get_git_info(project_root: str) -> dict:
    """Extract git metadata for snapshot creation."""
    info = {
        "repo_name": Path(project_root).name,
        "commit_sha": "",
        "branch": "",
    }
    # encoding="utf-8" + errors="replace" so git output containing non-ASCII
    # (commit messages, branch names in non-Latin scripts) doesn't crash on
    # Windows where text=True defaults to cp1252.
    _COMMON_KW = {
        "capture_output": True, "text": True,
        "encoding": "utf-8", "errors": "replace",
        "timeout": 5, "cwd": project_root,
    }
    try:
        # Get commit SHA
        result = subprocess.run(["git", "rev-parse", "HEAD"], **_COMMON_KW)
        if result.returncode == 0:
            info["commit_sha"] = result.stdout.strip()

        # Get branch name
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], **_COMMON_KW,
        )
        if result.returncode == 0:
            info["branch"] = result.stdout.strip()

        # Get repo name from remote
        result = subprocess.run(
            ["git", "remote", "get-url", "origin"], **_COMMON_KW,
        )
        if result.returncode == 0:
            remote = result.stdout.strip()
            # Extract repo name from URL
            name = remote.rstrip("/").split("/")[-1]
            if name.endswith(".git"):
                name = name[:-4]
            info["repo_name"] = name
    except Exception:
        pass

    return info
