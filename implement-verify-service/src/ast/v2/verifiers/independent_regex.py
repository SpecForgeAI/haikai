"""Independent regex verifier.

Cross-checks the extractor's endpoint list against a SECOND, independent
grep pass. Patterns below are written from scratch (different in shape and
scope from the playbooks) so a bug shared by all playbooks would still be
caught.

Agreement rate = matches / (extractor ∪ verifier) by (file, line) key.
"""
import re
from dataclasses import dataclass, field
from pathlib import Path

from src.ast.models import EndpointInfo


@dataclass
class VerifierReport:
    extractor_count: int
    verifier_count: int
    matches: int
    extractor_only: list[EndpointInfo] = field(default_factory=list)
    verifier_only: list[dict] = field(default_factory=list)
    agreement_rate: float = 0.0
    confidence: float = 0.0
    per_language: dict[str, dict] = field(default_factory=dict)
    per_playbook: dict[str, dict] = field(default_factory=dict)  # playbook-name → {expected, found, within_tolerance}
    handler_check: dict = field(default_factory=dict)            # graph-based handler check (see _verify_handlers_in_graph)
    notes: list[str] = field(default_factory=list)
    flagged_for_human_review: bool = False


# Per-language verifier regexes. Keys are the language (also used as file ext).
# Each list of (pattern, label) — label goes into the report for auditing.
VERIFIER_PATTERNS: dict[str, list[tuple[re.Pattern, str]]] = {
    "java": [
        (re.compile(r'@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping)\b'), "spring-verb"),
        (re.compile(r'@(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*(?:\(|$)'), "jaxrs-verb"),
    ],
    "rb": [
        (re.compile(r'^\s*(get|post|put|delete|patch|match)\s+[\'"][/:]'), "rails-verb"),
        (re.compile(r'^\s*resources?\s+:'), "rails-resources"),
        (re.compile(r'^\s*root\s+[\'"(to:]'), "rails-root"),
    ],
    "py": [
        (re.compile(r'@[\w.]*\.?route\(|@router\.(get|post|put|delete|patch)\('), "py-decorator"),
        (re.compile(r'\bpath\s*\(\s*[r]?[\'"][^\'"]*[\'"]'), "django-path"),
        (re.compile(r'\bre_path\s*\(\s*[r]?[\'"]'), "django-repath"),
    ],
    "php": [
        (re.compile(r'#\[Route\s*\('), "php-attr-route"),
        (re.compile(r'->(get|post|put|delete|patch)\s*\(\s*[\'"][/:]'), "php-router-verb"),
        (re.compile(r'Route\s*::\s*(get|post|put|delete|patch)\s*\('), "laravel-route"),
        (re.compile(r'register_rest_route\s*\('), "wp-rest-route"),
    ],
    "go": [
        (re.compile(r'\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(\s*"'), "go-verb"),
        (re.compile(r'HandleFunc\s*\(\s*"'), "go-handlefunc"),
    ],
    "ts": [
        (re.compile(r'@(Get|Post|Put|Delete|Patch|Head|Options)\s*\('), "ts-decorator"),
        (re.compile(r'\.(get|post|put|delete|patch)\s*\(\s*[\'"`][/:]'), "ts-router-verb"),
    ],
    "tsx": [
        (re.compile(r'@(Get|Post|Put|Delete|Patch|Head|Options)\s*\('), "tsx-decorator"),
    ],
    "js": [
        (re.compile(r'\.(get|post|put|delete|patch)\s*\(\s*[\'"`][/:]'), "js-router-verb"),
    ],
    "cs": [
        (re.compile(r'\[Http(Get|Post|Put|Delete|Patch|Head|Options)\b'), "csharp-http-attr"),
        (re.compile(r'\[Route\s*\('), "csharp-route-attr"),
    ],
}

# Per-language file globs for the walk. Test/vendor paths pruned.
LANG_EXCLUDES = ("/test/", "/tests/", "/target/", "/vendor/", "/node_modules/", "/.git/")


class IndependentRegexVerifier:
    """Verify extracted endpoints by re-grepping source with independent patterns.
    Supports java, ruby, python, php, go, typescript, javascript, csharp.
    """

    def __init__(self, project_root: str | Path,
                  snapshot_path: str | Path | None = None):
        self._root = Path(project_root)
        self._snapshot_path = Path(snapshot_path) if snapshot_path else None

    def verify_playbook_blocks(self, proposed: list[EndpointInfo],
                                playbooks: dict[str, dict]) -> dict[str, dict]:
        """Run each playbook's own `verification:` YAML blocks for real.

        Each verification step describes an INDEPENDENT recount (e.g. "count
        @GetMapping/@PostMapping in routing files") whose result should be
        within `tolerance_pct` of the playbook's own emitted endpoint count.
        Mismatches set within_tolerance=False so the run can be flagged.
        """
        per_pb: dict[str, dict] = {}
        for name, pb in playbooks.items():
            ver_steps = pb.get("verification", []) or []
            if not ver_steps:
                continue
            framework = pb.get("emit", {}).get("framework") or pb.get("name", "")
            own_count = sum(1 for e in proposed if e.framework == framework)

            block_results: list[dict] = []
            worst_within = True
            for step in ver_steps:
                expected_rule = step.get("expected_count", "")
                tol_pct = float(step.get("tolerance_pct", 0) or 0)

                # Run the verification query independently
                vcount = self._run_verification_step(step)

                if expected_rule == "same_as_output_count":
                    if own_count == 0 and vcount == 0:
                        within = True
                    else:
                        denom = max(own_count, vcount, 1)
                        within = abs(own_count - vcount) / denom <= (tol_pct / 100.0)
                else:
                    within = True  # unknown expected_rule → don't flag

                block_results.append({
                    "step": step.get("id", "?"),
                    "expected_rule": expected_rule,
                    "tolerance_pct": tol_pct,
                    "own_count": own_count,
                    "verifier_count": vcount,
                    "within_tolerance": within,
                })
                worst_within = worst_within and within

            per_pb[name] = {
                "own_count": own_count,
                "blocks": block_results,
                "all_within_tolerance": worst_within,
            }
        return per_pb

    def _run_verification_step(self, step: dict) -> int:
        """Run an INDEPENDENT regex pass declared by a playbook's verification block.

        Supports two kinds of step:
          - {query: annotations, annotation_names: [...]}   → grep for those annotations
          - {query: call_args,   callee_pattern: '...'}     → grep for that callee pattern
        Both walk the entire repo (excluding test/vendor/etc) and return a hit count.
        """
        query = step.get("query", "")
        if query == "annotations":
            names = step.get("annotation_names") or []
            if not names:
                return 0
            pat = re.compile(r"@(?:" + "|".join(re.escape(n) for n in names) + r")\b")
            return self._count_pattern_in_repo(pat, exts=("java", "kt", "ts", "py", "cs"))
        if query == "call_args":
            cp = step.get("callee_pattern", "")
            if not cp:
                return 0
            pat = re.compile(cp)
            return self._count_pattern_in_repo(pat,
                exts=("py", "rb", "go", "ts", "tsx", "js", "php"))
        return 0

    def _count_pattern_in_repo(self, pat: re.Pattern, exts: tuple) -> int:
        ext_set = {f".{e}" for e in exts}
        hits = 0
        for path in self._root.rglob("*"):
            if not path.is_file() or path.suffix not in ext_set:
                continue
            try:
                rel = str(path.relative_to(self._root)).replace("\\", "/")
            except ValueError:
                continue
            if any(x in rel for x in LANG_EXCLUDES):
                continue
            try:
                for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                    if pat.search(line):
                        hits += 1
            except OSError:
                continue
        return hits

    def verify(self, proposed: list[EndpointInfo],
               playbooks: dict[str, dict] | None = None) -> VerifierReport:
        report = VerifierReport(extractor_count=len(proposed),
                                 verifier_count=0, matches=0)

        # Determine which languages to scan based on proposed endpoints + controller files
        langs_to_scan: set[str] = set()
        for ep in proposed:
            if ep.file:
                ext = Path(ep.file).suffix.lstrip(".").lower()
                if ext in VERIFIER_PATTERNS:
                    langs_to_scan.add(ext)
        if not langs_to_scan:
            # Pick languages whose source files exist in the repo — verify something
            for ext in VERIFIER_PATTERNS:
                if any(self._root.rglob(f"*.{ext}")):
                    langs_to_scan.add(ext)
                    break  # don't scan everything — just the dominant one

        verifier_hits: list[tuple[str, int, str, str]] = []  # (file, line, label, raw)
        for ext in langs_to_scan:
            patterns = VERIFIER_PATTERNS[ext]
            lang_hits = 0
            for path in self._root.rglob(f"*.{ext}"):
                try:
                    rel = str(path.relative_to(self._root)).replace("\\", "/")
                except ValueError:
                    continue
                if any(x in rel for x in LANG_EXCLUDES):
                    continue
                try:
                    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
                except OSError:
                    continue
                for i, line in enumerate(lines, start=1):
                    for pat, label in patterns:
                        if pat.search(line):
                            verifier_hits.append((rel, i, label, line.strip()))
                            lang_hits += 1
                            break
            report.per_language[ext] = {"hits": lang_hits}

        report.verifier_count = len(verifier_hits)

        # Match by (file, line)
        proposed_by_loc = {(ep.file, ep.line) for ep in proposed}
        verifier_by_loc = {(f, ln) for (f, ln, _, _) in verifier_hits}

        report.matches = len(proposed_by_loc & verifier_by_loc)
        report.extractor_only = [
            ep for ep in proposed if (ep.file, ep.line) not in verifier_by_loc
        ]
        report.verifier_only = [
            {"file": f, "line": ln, "label": lbl, "raw": raw}
            for (f, ln, lbl, raw) in verifier_hits if (f, ln) not in proposed_by_loc
        ]

        union = len(proposed_by_loc | verifier_by_loc)
        report.agreement_rate = report.matches / union if union > 0 else 1.0

        # Confidence: high when counts are close and agreement is high
        if report.extractor_count == 0 and report.verifier_count == 0:
            report.confidence = 0.0
        else:
            size_ratio = min(report.extractor_count, report.verifier_count) / \
                         max(report.extractor_count, report.verifier_count, 1)
            report.confidence = round((report.agreement_rate * 0.6 + size_ratio * 0.4), 2)

        diff_abs = abs(report.extractor_count - report.verifier_count)
        diff_pct = diff_abs / max(report.extractor_count, report.verifier_count, 1)
        if diff_abs > 5 and diff_pct > 0.25:
            report.flagged_for_human_review = True
            report.notes.append(
                f"Disagreement {diff_abs} (~{diff_pct*100:.0f}%) exceeds 25% threshold"
            )

        if playbooks:
            report.per_playbook = self.verify_playbook_blocks(proposed, playbooks)

        # Graph-based handler sanity check (best-effort; no-op if no graph yet)
        report.handler_check = self._verify_handlers_in_graph(proposed)

        return report

    def _verify_handlers_in_graph(self, proposed: list[EndpointInfo]) -> dict:
        """Check that each emitted endpoint's handler symbol exists in the
        dep graph and is reachable / has callers.

        Categories:
          - resolved:        handler symbol found in `symbols` table
          - has_callers:     resolved AND has ≥1 row in `calls`
          - missing_handler: no handler symbol could be resolved (suspect)

        Best-effort: if the dep graph isn't built (no _depgraph.sqlite),
        returns {"available": false}. Doesn't trigger a build of its own —
        relies on the pipeline to have run Step 9.
        """
        # Prefer the snapshot path (where the graph is actually written), fall
        # back to scanning the project root.
        candidates: list[Path] = []
        if self._snapshot_path is not None:
            candidates.append(self._snapshot_path / "_depgraph.sqlite")
        candidates.append(self._root / "_depgraph.sqlite")
        candidates += list(self._root.glob("**/_depgraph.sqlite"))
        db_path = next((c for c in candidates if c.exists()), None)
        if db_path is None:
            return {"available": False, "reason": "no _depgraph.sqlite found"}

        try:
            import sqlite3
            conn = sqlite3.connect(str(db_path))
            conn.row_factory = sqlite3.Row
        except Exception as e:
            return {"available": False, "reason": f"could not open graph: {e}"}

        try:
            resolved = 0
            has_callers = 0
            missing = 0
            samples_missing: list[str] = []
            for ep in proposed:
                cls = (ep.handler_class or "").strip()
                meth = (ep.handler_method or "").strip()
                if not cls and not meth:
                    missing += 1
                    continue
                qname = f"{cls}.{meth}" if (cls and meth) else (meth or cls)
                row = conn.execute(
                    "SELECT id FROM symbols WHERE qualified_name = ? OR name = ? LIMIT 1",
                    (qname, qname),
                ).fetchone()
                if row is None:
                    missing += 1
                    if len(samples_missing) < 5:
                        samples_missing.append(qname)
                    continue
                resolved += 1
                cnt = conn.execute(
                    "SELECT COUNT(*) AS c FROM calls WHERE callee_symbol_id = ? OR callee_qualified_name = ?",
                    (row["id"], qname),
                ).fetchone()["c"]
                if cnt > 0:
                    has_callers += 1

            return {
                "available": True,
                "endpoints_checked": len(proposed),
                "handler_resolved": resolved,
                "handler_has_callers": has_callers,
                "handler_missing": missing,
                "missing_samples": samples_missing,
            }
        finally:
            conn.close()
