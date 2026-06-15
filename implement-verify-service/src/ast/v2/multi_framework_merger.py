"""Merge endpoints from multiple framework playbooks.

Responsibilities:
- Dedupe by (operation, path, handler_qualified_name)
- Apply per-playbook conflict_rules (e.g. prefer annotation over XML)
- Apply transport_profile filtering (REST/GraphQL/gRPC/WEB/SOAP)
- Track per-framework provenance
"""
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from src.ast.models import EndpointInfo

logger = logging.getLogger(__name__)


@dataclass
class MergeReport:
    total_input: int = 0
    total_output: int = 0
    deduplicated: int = 0
    conflict_dropped: int = 0
    profile_dropped: int = 0
    by_framework_input: dict[str, int] = field(default_factory=dict)
    by_framework_output: dict[str, int] = field(default_factory=dict)


# Default precedence when two playbooks emit the same endpoint.
# Higher number wins. Custom rules can override.
DEFAULT_FRAMEWORK_PRIORITY = {
    "spring-boot": 100,
    "jax-rs":      100,
    "rails":       100,
    "django":      100,
    "express":      90,
    "gin":          90,
    "slim":         90,
    "symfony":      80,
}


def _s(x) -> str:
    """Coerce annotation-arg values (which may be lists) to a stable string."""
    if isinstance(x, list):
        return ",".join(_s(i) for i in x)
    return str(x or "")


def _qualified_handler(e: EndpointInfo) -> str:
    cls = _s(e.handler_class).strip()
    meth = _s(e.handler_method).strip()
    if cls and meth:
        return f"{cls}.{meth}"
    return cls or meth or ""


def _dedup_key(e: EndpointInfo) -> tuple[str, str, str]:
    """Endpoints with the same key are considered the same logical endpoint."""
    return (_s(e.operation).upper(), _s(e.path), _qualified_handler(e))


def merge_endpoints(
    endpoints: list[EndpointInfo],
    playbooks: dict[str, dict[str, Any]],
    transport_profile: str | None = None,
) -> tuple[list[EndpointInfo], MergeReport]:
    """Dedupe + apply conflict rules + filter by transport profile.

    Args:
        endpoints: concatenated endpoints from all detected playbooks
        playbooks: detected playbook dicts, keyed by name
        transport_profile: if set, drop endpoints whose `type` doesn't match.
                            Profile examples: REST, GraphQL, gRPC, WEB, SOAP.

    Returns: (merged_endpoints, report)
    """
    report = MergeReport(total_input=len(endpoints))
    for e in endpoints:
        report.by_framework_input[e.framework] = report.by_framework_input.get(e.framework, 0) + 1

    # Optional transport-profile filter
    filtered = endpoints
    if transport_profile:
        filtered = [e for e in endpoints if e.type.upper() == transport_profile.upper()]
        report.profile_dropped = len(endpoints) - len(filtered)

    # Group by dedup key, then pick the winner per group
    grouped: dict[tuple[str, str, str], list[EndpointInfo]] = defaultdict(list)
    for e in filtered:
        grouped[_dedup_key(e)].append(e)

    winners: list[EndpointInfo] = []
    for key, group in grouped.items():
        if len(group) == 1:
            winners.append(group[0])
            continue
        winner = _pick_winner(group, playbooks)
        winners.append(winner)
        report.deduplicated += len(group) - 1

    # Apply playbook-level conflict_rules (cross-framework) — currently a no-op
    # placeholder; richer rules can be plugged in later.
    winners, dropped_by_rules = _apply_conflict_rules(winners, playbooks)
    report.conflict_dropped = dropped_by_rules

    report.total_output = len(winners)
    for e in winners:
        report.by_framework_output[e.framework] = report.by_framework_output.get(e.framework, 0) + 1
    return winners, report


def _pick_winner(group: list[EndpointInfo], playbooks: dict[str, dict[str, Any]]) -> EndpointInfo:
    """Highest framework priority wins; tie-broken by confidence then first-seen."""
    def score(e: EndpointInfo) -> tuple[int, float]:
        prio = DEFAULT_FRAMEWORK_PRIORITY.get(e.framework, 50)
        # Per-playbook override takes precedence if present
        pb = playbooks.get(e.framework, {})
        prio = pb.get("priority", prio)
        return (prio, e.confidence)

    return max(group, key=score)


def _apply_conflict_rules(
    endpoints: list[EndpointInfo],
    playbooks: dict[str, dict[str, Any]],
) -> tuple[list[EndpointInfo], int]:
    """Apply each playbook's conflict_rules. Returns (kept, dropped_count).

    Supported rule shapes:
      - drop_if_path_matches: <regex>            (drop endpoints whose path matches)
      - drop_if_handler_matches: <regex>         (drop endpoints whose qualified handler matches)
      - drop_my_endpoints_if_framework_present:  drop ALL of THIS playbook's
        emissions when one of the listed frameworks ALSO detected.
        e.g. page-based-php drops itself when laravel/symfony/drupal detected.
    """
    import re
    drop_path_res: list[re.Pattern] = []
    drop_handler_res: list[re.Pattern] = []
    # framework -> set of frameworks that, if also present, cause this one to drop
    drop_when_present: dict[str, set[str]] = {}

    detected_frameworks = {e.framework for e in endpoints if e.framework}

    for pb_name, pb in playbooks.items():
        for rule in pb.get("conflict_rules", []):
            if not isinstance(rule, dict):
                continue
            # Wrap re.compile so a malformed pattern in one playbook doesn't
            # crash the whole merge. Skip the offending rule and keep going.
            if "drop_if_path_matches" in rule:
                try:
                    drop_path_res.append(re.compile(rule["drop_if_path_matches"]))
                except re.error as e:
                    logger.warning(f"[{pb_name}] invalid drop_if_path_matches regex: {e}")
            if "drop_if_handler_matches" in rule:
                try:
                    drop_handler_res.append(re.compile(rule["drop_if_handler_matches"]))
                except re.error as e:
                    logger.warning(f"[{pb_name}] invalid drop_if_handler_matches regex: {e}")
            others = rule.get("drop_my_endpoints_if_framework_present")
            if others:
                drop_when_present.setdefault(pb_name, set()).update(others)

    # Materialise: for which (own framework name) we should drop emissions
    drop_frameworks: set[str] = set()
    for own, conflicts in drop_when_present.items():
        if conflicts & detected_frameworks:
            drop_frameworks.add(own)

    if not drop_path_res and not drop_handler_res and not drop_frameworks:
        return endpoints, 0

    kept: list[EndpointInfo] = []
    dropped = 0
    for e in endpoints:
        if e.framework in drop_frameworks:
            dropped += 1
            continue
        if any(r.search(e.path) for r in drop_path_res):
            dropped += 1
            continue
        h = _qualified_handler(e)
        if any(r.search(h) for r in drop_handler_res):
            dropped += 1
            continue
        kept.append(e)
    return kept, dropped
