"""Framework detection (Phase 5).

Single place that decides which playbooks are eligible to run on a repo.
Returns per-framework rows carrying:
  - name             which playbook
  - confidence       0..1 score based on number + strength of matched signals
  - matched_signals  list of what matched (for audit)

Detection signals (any one is sufficient to match; multiple raise confidence):
  - imports_match       any source file imports one of these substrings
  - files_match         a file matching this glob exists
  - manifest_contains   a manifest file contains a substring

Additional gates:
  - language presence    a playbook with language=java is skipped on a repo with no .java files
  - multi-file threshold imports_match requires >=MIN_IMPORT_FILES unless stronger signal also matched
"""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from src.ast.v2.queries.imports import ImportsQuery


@dataclass
class Detection:
    name: str
    confidence: float
    matched_signals: list[str] = field(default_factory=list)
    source_file_counts: dict[str, int] = field(default_factory=dict)
    role: str = "framework"         # "framework" | "stack" | "fallback"
    scope: str = "repo"             # "repo" | "submodule:<name>" — where the
                                     # framework applies; "repo" means the whole tree


LANG_EXTS = {
    "java": {".java"}, "ruby": {".rb"}, "python": {".py"},
    "php": {".php"}, "go": {".go"},
    "javascript": {".js", ".jsx", ".mjs"},
    "typescript": {".ts", ".tsx"},
    "csharp": {".cs"},
    "cpp": {".cpp", ".hpp", ".cc"},
}

# An imports-only match with a single matching file is too weak — often a tangential
# test/demo file importing something it never actually uses. Require this many files
# unless another signal (files_match, manifest_contains) also matched.
MIN_IMPORT_FILES = 2


def _language_presence(root: Path) -> dict[str, bool]:
    """Which languages have a *meaningful* presence in the repo.

    A language counts as "present" when it meets BOTH of:
      - at least MIN_LANG_FILES source files, AND
      - at least MIN_LANG_PCT% of all source files.

    Without this, a Java repo with 3 stray .js admin-console files would
    light up every TypeScript/Express playbook as a false positive.
    """
    MIN_LANG_FILES = 10
    MIN_LANG_PCT = 0.02  # 2% of source files
    if root is None:
        return {}

    counts: dict[str, int] = {lang: 0 for lang in LANG_EXTS}
    total = 0
    for p in root.rglob("*"):
        if not p.is_file():
            continue
        ext = p.suffix
        for lang, exts in LANG_EXTS.items():
            if ext in exts:
                counts[lang] += 1
                total += 1
                break

    present: dict[str, bool] = {}
    for lang, cnt in counts.items():
        pct = cnt / total if total else 0
        present[lang] = cnt >= MIN_LANG_FILES and pct >= MIN_LANG_PCT
    return present


def detect(
    snapshot_path: str,
    playbooks: dict[str, dict[str, Any]],
    project_root: str = "",
) -> list[Detection]:
    """Return Detection rows for each playbook that matched, ordered by confidence desc."""
    imports_query = ImportsQuery(snapshot_path)
    root = Path(project_root) if project_root else None
    lang_present = _language_presence(root) if root is not None else {}

    detections: list[Detection] = []

    for name, pb in playbooks.items():
        det_cfg = pb.get("detection", {})
        pb_lang = pb.get("language", "")

        # Language gate (absolute)
        if pb_lang and lang_present and not lang_present.get(pb_lang, True):
            continue

        matched_signals: list[str] = []
        source_counts: dict[str, int] = {}
        strong_match = False  # files_match / manifest_contains count as strong

        # Imports signal
        pkgs = det_cfg.get("imports_match", [])
        if pkgs:
            matching_files = imports_query.files_importing(pkgs)
            if matching_files:
                source_counts["imports"] = len(matching_files)
                if len(matching_files) >= MIN_IMPORT_FILES:
                    matched_signals.append(f"imports({len(matching_files)})")
                # else: weak — wait to see if a stronger signal confirms

        # Files signal (strong)
        if root is not None:
            file_match_count = 0
            for glob in det_cfg.get("files_match", []):
                for _ in root.glob(glob):
                    file_match_count += 1
                    break  # any match is enough for this glob
            if file_match_count:
                matched_signals.append(f"files({file_match_count})")
                strong_match = True
                source_counts["files"] = file_match_count

        # Manifest signal (strong)
        if root is not None:
            manifest_hits = 0
            for spec in det_cfg.get("manifest_contains", []):
                fname = spec.get("file", "")
                substr = spec.get("substring", "")
                if not fname or not substr:
                    continue
                p = root / fname
                if not p.exists():
                    continue
                try:
                    if substr in p.read_text(encoding="utf-8", errors="replace"):
                        manifest_hits += 1
                except OSError:
                    continue
            if manifest_hits:
                matched_signals.append(f"manifest({manifest_hits})")
                strong_match = True
                source_counts["manifest"] = manifest_hits

        # Escalate weak imports match if a strong signal also matched
        if strong_match and "imports" in source_counts and not any(
            s.startswith("imports") for s in matched_signals
        ):
            matched_signals.append(f"imports({source_counts['imports']})")

        if not matched_signals:
            continue

        # Confidence: 0.4 per strong signal, 0.3 per imports signal (still
        # requires MIN_IMPORT_FILES to count at all), capped at 1.0.
        conf = 0.0
        for sig in matched_signals:
            if sig.startswith(("files", "manifest")):
                conf += 0.4
            elif sig.startswith("imports"):
                conf += 0.3
        conf = min(conf, 1.0)

        detections.append(Detection(
            name=name,
            confidence=round(conf, 2),
            matched_signals=matched_signals,
            source_file_counts=source_counts,
        ))

    detections.sort(key=lambda d: d.confidence, reverse=True)
    return detections


def detect_framework_names(*args, **kwargs) -> list[str]:
    """Back-compat: return just the list of detected framework names, most confident first."""
    return [d.name for d in detect(*args, **kwargs)]
