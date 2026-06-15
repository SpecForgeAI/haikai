"""Shared check I/O — the stdin=json / stdout=json / exit-code=verdict contract.

Every check is deterministic. No check calls an LLM.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

SCHEMAS_DIR = Path(__file__).resolve().parent.parent / "schemas"


class OutDirError(ValueError):
    """Raised when a stdin-supplied out_dir fails containment (P3a)."""


def safe_out_dir(raw: str) -> Path:
    """Validate a stdin-supplied out_dir before any write (P3a).

    Refuses: empty values, any '..' segment (traversal), and — when
    SX_PIPELINE_ROOT is set — any path resolving outside that root. The
    checks open files under out_dir with truncating writes; a typo'd or
    agent-mangled path must refuse, not overwrite.
    """
    if not raw or not str(raw).strip():
        raise OutDirError("out_dir missing")
    candidate = Path(raw)
    if ".." in candidate.parts:
        raise OutDirError(f"out_dir contains a '..' segment: {raw}")
    resolved = candidate.resolve()
    root = os.environ.get("SX_PIPELINE_ROOT")
    if root:
        root_resolved = Path(root).resolve()
        if not resolved.is_relative_to(root_resolved):
            raise OutDirError(f"out_dir {resolved} is outside SX_PIPELINE_ROOT {root_resolved}")
    return resolved


def read_stdin_json() -> dict:
    raw = sys.stdin.read()
    try:
        return json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError as exc:
        emit({"error": f"bad input json: {exc}"})
        sys.exit(2)


def emit(payload: dict) -> None:
    json.dump(payload, sys.stdout)
    sys.stdout.write("\n")


def emit_err(payload: dict) -> None:
    json.dump(payload, sys.stderr)
    sys.stderr.write("\n")


def load_schema(kind: str) -> dict:
    path = SCHEMAS_DIR / f"{kind}.json"
    if not path.exists():
        raise FileNotFoundError(f"no schema for kind '{kind}' at {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def validate_record(record: dict, schema: dict) -> list[str]:
    """stdlib validation per D10: required / enum / type / range / forbid.

    Returns a list of "schema: ..." reasons (empty = valid).
    """
    reasons: list[str] = []
    for field in schema.get("required", []):
        if field not in record or record[field] in (None, ""):
            reasons.append(f"schema: missing required field '{field}'")
    for field in schema.get("forbid", []):
        if field in record:
            reasons.append(f"schema: field '{field}' not allowed for this kind")
    type_map = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "array": list}
    for field, spec in schema.get("fields", {}).items():
        if field not in record:
            continue
        value = record[field]
        expected = type_map.get(spec.get("type", ""))
        if expected and not isinstance(value, expected):
            reasons.append(f"schema: field '{field}' expected {spec['type']}, got {type(value).__name__}")
            continue
        if isinstance(value, bool) and spec.get("type") in ("integer", "number"):
            reasons.append(f"schema: field '{field}' expected {spec['type']}, got bool")
            continue
        if "enum" in spec and value not in spec["enum"]:
            reasons.append(f"schema: field '{field}' value '{value}' not in {spec['enum']}")
        if "minimum" in spec and isinstance(value, (int, float)) and value < spec["minimum"]:
            reasons.append(f"schema: field '{field}' below minimum {spec['minimum']}")
        if "maximum" in spec and isinstance(value, (int, float)) and value > spec["maximum"]:
            reasons.append(f"schema: field '{field}' above maximum {spec['maximum']}")
    return reasons
