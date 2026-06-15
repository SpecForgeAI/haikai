"""V2 discovery orchestrator (Option C minimal slice).

Detects framework, loads playbook, executes, verifies. No LLM yet on this path.
"""
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from src.ast.models import EndpointInfo
from src.ast.v2.queries.imports import ImportsQuery
from src.ast.v2.framework_detector import detect as detect_frameworks_with_confidence, Detection
from src.ast.v2.playbook_loader import load_all_playbooks, load_all_stacks
from src.ast.v2.playbook_executor import execute as execute_playbook
from src.ast.v2.multi_framework_merger import merge_endpoints, MergeReport
from src.ast.v2.verifiers import IndependentRegexVerifier, VerifierReport


@dataclass
class DiscoveryResult:
    endpoints: list[EndpointInfo] = field(default_factory=list)
    detected_frameworks: list[str] = field(default_factory=list)
    detections: list[Detection] = field(default_factory=list)
    playbooks_used: list[str] = field(default_factory=list)
    verifier_report: VerifierReport | None = None
    merge_report: MergeReport | None = None
    used_llm_fallback: bool = False
    proposed_playbook_path: str = ""
    # LLM call tracing for Phase 10/11 (populated when llm_client present)
    llm_call_log: list[dict] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


def detect_frameworks(snapshot_path: str, playbooks: dict[str, dict[str, Any]],
                      project_root: str = "") -> list[str]:
    """Back-compat name-only wrapper around framework_detector.detect()."""
    return [d.name for d in detect_frameworks_with_confidence(
        snapshot_path, playbooks, project_root)]


MIN_DETECTION_CONFIDENCE = 0.3  # imports-alone threshold; stronger signals add more


def discover(project_root: str, snapshot_path: str,
             playbooks_dir: str = "playbooks/frameworks",
             stacks_dir: str = "playbooks/stacks",
             llm_client=None,
             allow_llm_fallback: bool = True,
             allow_playbook_proposal: bool = True,
             min_confidence: float = MIN_DETECTION_CONFIDENCE) -> DiscoveryResult:
    """Run the full v2 discovery pipeline.

    Pipeline:
      1. Load playbooks
      2. Detect frameworks
      3. Execute matching playbooks
      4. If 0 endpoints → Phase 10 LLM fallback (if allowed and llm_client given)
      5. Run independent regex verifier
    """
    result = DiscoveryResult()

    playbooks = load_all_playbooks(playbooks_dir)
    if not playbooks:
        result.notes.append(f"No playbooks loaded from {playbooks_dir}")
        return result

    all_detections = detect_frameworks_with_confidence(snapshot_path, playbooks, project_root)
    result.detections = [d for d in all_detections if d.confidence >= min_confidence]
    dropped = [d for d in all_detections if d.confidence < min_confidence]

    # Phase 6: stack composition — if a stack matches, add its compose list.
    stacks = load_all_stacks(stacks_dir)
    if stacks:
        # Re-use the detector against stacks (their detection block uses same shape)
        stack_detections = detect_frameworks_with_confidence(snapshot_path, stacks, project_root)
        for sd in stack_detections:
            if sd.confidence < min_confidence:
                continue
            stack_body = stacks[sd.name]
            composed = [n for n in stack_body.get("compose", []) if n in playbooks]
            result.notes.append(
                f"stack '{sd.name}' matched → compose {composed}"
            )
            for fw in composed:
                # Add to detections if not already present; confidence via stack
                if not any(d.name == fw for d in result.detections):
                    result.detections.append(Detection(
                        name=fw, confidence=sd.confidence,
                        matched_signals=[f"stack:{sd.name}"],
                        role="stack", scope="repo",
                    ))

    result.detected_frameworks = [d.name for d in result.detections]
    det_desc = [f"{d.name}(conf={d.confidence}, {','.join(d.matched_signals)})" for d in result.detections]
    result.notes.append(f"Detected frameworks: {det_desc}")
    if dropped:
        result.notes.append(
            f"Dropped low-confidence: {[f'{d.name}({d.confidence})' for d in dropped]}"
        )

    raw_endpoints: list[EndpointInfo] = []
    detected_playbooks: dict[str, dict] = {}
    for fw_name in result.detected_frameworks:
        pb = playbooks[fw_name]
        detected_playbooks[fw_name] = pb
        exec_result = execute_playbook(pb, snapshot_path, project_root)
        raw_endpoints.extend(exec_result.endpoints)
        result.playbooks_used.append(fw_name)
        result.notes.extend([f"[{fw_name}] {n}" for n in exec_result.notes])

    # Multi-framework merge: dedupe + apply conflict rules
    merged, merge_report = merge_endpoints(raw_endpoints, detected_playbooks)
    result.endpoints = merged
    result.merge_report = merge_report
    result.notes.append(
        f"merger: in={merge_report.total_input} out={merge_report.total_output} "
        f"deduped={merge_report.deduplicated} conflict_dropped={merge_report.conflict_dropped}"
    )

    # Snapshot LLM token state so we can attribute Phase 10/11 cost
    def _llm_snapshot():
        usage = getattr(llm_client, "token_usage", None) if llm_client else None
        return dict(usage) if usage else {}

    import time as _time
    from src.ast.observability import reset_trace, trace_event, trace_llm_call
    reset_trace(f"v2:{Path(project_root).name}")
    trace_event("v2_run_start", project_root=str(project_root),
                detected=result.detected_frameworks)

    # Phase 10: LLM fallback when deterministic path produced nothing
    if allow_llm_fallback and llm_client is not None and len(result.endpoints) == 0:
        _t10 = _time.time(); _u10 = _llm_snapshot()
        # Collect evidence_globs from any detected playbooks (so a playbook that
        # matched but found 0 endpoints can still hint where the LLM should look)
        hint_globs: list[str] = []
        for pb in detected_playbooks.values():
            for g in (pb.get("evidence_globs") or []):
                if g not in hint_globs:
                    hint_globs.append(g)
        result.notes.append(f"Phase 10: invoking LLM fallback (evidence_globs={hint_globs})")
        try:
            from src.ast.v2.llm_fallback import discover_endpoints_via_llm
            llm_endpoints = discover_endpoints_via_llm(project_root, llm_client,
                                                       evidence_globs=hint_globs)
            result.endpoints = llm_endpoints
            result.used_llm_fallback = True
            result.notes.append(f"LLM fallback returned {len(llm_endpoints)} endpoints")
        except Exception as e:
            result.notes.append(f"LLM fallback failed: {type(e).__name__}: {e}")
        _u_after = _llm_snapshot()
        elapsed = _time.time() - _t10
        tokens = _u_after.get("total_tokens", 0) - _u10.get("total_tokens", 0)
        calls  = _u_after.get("calls",        0) - _u10.get("calls",        0)
        result.llm_call_log.append({
            "phase": "10_fallback",
            "elapsed_s": round(elapsed, 2),
            "tokens_added": tokens,
            "calls_added": calls,
        })
        trace_llm_call("v2", "10_fallback", elapsed,
                        tokens_added=tokens, calls_added=calls,
                        endpoints_returned=len(result.endpoints))

    # Phase 11 auto-trigger: when no playbook produced any endpoints AND no
    # framework was even detected, ask the LLM to PROPOSE a playbook so the
    # human can review/promote it. Closes the agentic loop the spec described.
    if (allow_playbook_proposal
            and llm_client is not None
            and len(result.endpoints) == 0
            and not result.detected_frameworks):
        _t11 = _time.time(); _u11 = _llm_snapshot()
        try:
            from src.ast.v2.playbook_writer import propose
            proposal = propose(project_root, llm_client)
            if proposal.proposed_yaml_path:
                result.proposed_playbook_path = proposal.proposed_yaml_path
                result.notes.append(
                    f"Phase 11: proposed playbook → {proposal.proposed_yaml_path}"
                )
            elif proposal.error:
                result.notes.append(f"Phase 11 propose failed: {proposal.error}")
        except Exception as e:
            result.notes.append(f"Phase 11 propose error: {type(e).__name__}: {e}")
        _u_after = _llm_snapshot()
        elapsed = _time.time() - _t11
        tokens = _u_after.get("total_tokens", 0) - _u11.get("total_tokens", 0)
        calls  = _u_after.get("calls",        0) - _u11.get("calls",        0)
        result.llm_call_log.append({
            "phase": "11_propose",
            "elapsed_s": round(elapsed, 2),
            "tokens_added": tokens,
            "calls_added": calls,
        })
        trace_llm_call("v2", "11_propose", elapsed,
                        tokens_added=tokens, calls_added=calls,
                        proposed=bool(result.proposed_playbook_path))

    # Independent verification + per-playbook verification: blocks
    verifier = IndependentRegexVerifier(project_root, snapshot_path=snapshot_path)
    result.verifier_report = verifier.verify(result.endpoints, detected_playbooks)

    return result
