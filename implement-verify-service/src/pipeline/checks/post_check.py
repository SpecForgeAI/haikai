"""post_check — SELF-VERIFY (orchestrator Step 5.5). The only authority on
whether records pass; the extracting agent never marks its own work done.

stdin: {"batch": {"id", "kind", ...}, "records": [...], "snapshot_path": "..."}
exit 0 = pass  (stdout: {"verdict": "pass", "valid_records": [...]})
exit 1 = retry (stderr: JSON lines, each {"record": i, "reason": "..."})

Checks, in order:
  1. schema_validate per schemas/<kind>.json (D10)
  2. ast_index.has(file, line) ground-truth round-trip (D9) — a record
     whose location is not in the index is a hallucination ("loc_not_in_index")
  2b. RECORD-level grounding for endpoints (C1): the symbol at the anchor
      must be the claimed handler (name == handler_method, or
      handler_class ∈ {name, scope}) — location-only checking let fabricated
      semantics ride on any real anchor. data_movements/queries anchor at
      call sites or symbols; their semantic fields are the LLM's judgement
      layer and have no mechanical ground truth (documented limitation).
  3. unresolved ambiguity — ambiguous:true must not survive 5.4b
  4. dedupe + normalise (forward slashes, default confidence)
"""

from __future__ import annotations

import sys

from src.pipeline.checks._io import emit, emit_err, load_schema, read_stdin_json, validate_record
from src.pipeline.index import AstIndex, _norm

DEDUPE_KEYS = {
    "endpoints": ("operation", "path", "file", "line"),
    # P1b: include direction + file + line — a READ and a WRITE of the same
    # target, or the same movement at two call sites, are distinct records.
    # (The legacy discovery _item_key omitted them; catalog content then
    # depended on batch boundaries.)
    "data_movements": ("source_class", "source_method", "target", "target_type", "direction", "file", "line"),
    "queries": ("target", "file", "line"),
}


def _normalise(record: dict, schema: dict) -> dict:
    out = dict(record)
    if "file" in out and isinstance(out["file"], str):
        out["file"] = _norm(out["file"])  # prefix-strip, not lstrip charset (P1a)
    for field, spec in schema.get("fields", {}).items():
        if field not in out and "default" in spec:
            out[field] = spec["default"]
    return out


def run(payload: dict) -> tuple[int, dict, list[dict]]:
    batch = payload.get("batch") or {}
    kind = batch.get("kind", "")
    records = payload.get("records")
    snapshot_path = payload.get("snapshot_path", "")

    if not isinstance(records, list):
        return 1, {"verdict": "retry"}, [{"record": -1, "reason": "schema: records must be a JSON array"}]

    try:
        schema = load_schema(kind)
    except FileNotFoundError as exc:
        return 1, {"verdict": "retry"}, [{"record": -1, "reason": f"schema: {exc}"}]

    index = AstIndex(snapshot_path)
    failures: list[dict] = []
    valid: list[dict] = []
    seen: set[tuple] = set()
    key_fields = DEDUPE_KEYS.get(kind, ("file", "line"))

    for i, record in enumerate(records):
        if not isinstance(record, dict):
            failures.append({"record": i, "reason": "schema: record must be an object"})
            continue
        reasons = validate_record(record, schema)
        if record.get("ambiguous"):
            reasons.append("ambiguous: unresolved — orchestrator must run predict() at 5.4b before post_check")
        if not reasons:
            normalised = _normalise(record, schema)
            if not index.has(normalised["file"], normalised["line"]):
                reasons.append("loc_not_in_index")
            elif kind == "endpoints":
                sym = index.symbol_at(normalised["file"], normalised["line"])
                if sym is None:
                    reasons.append(
                        "endpoint_anchor_not_a_symbol: endpoints anchor at their "
                        "handler's definition line, not a call site"
                    )
                elif normalised.get("handler_method") != sym.name and normalised.get(
                    "handler_class"
                ) not in (sym.name, sym.scope):
                    reasons.append(
                        f"handler_not_at_anchor: symbol at anchor is "
                        f"{sym.scope}.{sym.name}, record claims "
                        f"{normalised.get('handler_class')}.{normalised.get('handler_method')}"
                    )
            if not reasons:
                key = tuple(normalised.get(k) for k in key_fields)
                if key in seen:
                    continue  # silent dedupe — duplicates are not failures
                seen.add(key)
                valid.append(normalised)
                continue
        for reason in reasons:
            failures.append({"record": i, "reason": reason})

    if failures:
        return 1, {"verdict": "retry", "valid_count": len(valid), "failure_count": len(failures)}, failures
    return 0, {"verdict": "pass", "valid_records": valid}, []


def main() -> int:
    code, payload, failures = run(read_stdin_json())
    for failure in failures:
        emit_err(failure)
    emit(payload)
    return code


if __name__ == "__main__":
    sys.exit(main())
