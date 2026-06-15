"""Connector definition loader — the YAML is the single source of truth.

`haikai-profiles/default/connectors/<name>.yml` declares each connector's
status_map (spec verdict → provider statuses) and fold precedence; the
connector modules OBEY it instead of hardcoding the same tables (which
drifted once already — predict INT-6). Loaded once per process.

Composite GitHub keys use "status+conclusion" (e.g. "completed+success");
plain keys match the provider status alone.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from src.chat.profiles_path import HAIKAI_PROFILES_ROOT

CONNECTORS_DIR = HAIKAI_PROFILES_ROOT / "default" / "connectors"
VALID_VERDICTS = ("pass", "fail", "pending", "skipped")


class ConnectorDefError(Exception):
    pass


class ConnectorDef:
    def __init__(self, name: str, raw: dict) -> None:
        self.name = name
        self.raw = raw
        status_map = raw.get("status_map") or {}
        self.verdict_by_status: dict[str, str] = {}
        for verdict, statuses in status_map.items():
            if verdict not in VALID_VERDICTS:
                raise ConnectorDefError(f"{name}: unknown verdict '{verdict}' in status_map")
            for status in statuses or []:
                self.verdict_by_status[str(status)] = verdict
        fold = raw.get("fold", "fail > pending > pass > skipped")
        # "fail > pending > pass > skipped" (comments after the value are
        # stripped by YAML already; tolerate stray whitespace)
        self.fold_order = [part.strip() for part in str(fold).split(">") if part.strip()]
        if not self.fold_order or set(self.fold_order) - set(VALID_VERDICTS):
            raise ConnectorDefError(f"{name}: bad fold order '{fold}'")

    def map_status(self, status: str, conclusion: str | None = None) -> str:
        """Composite 'status+conclusion' first, then plain status; default pending."""
        if conclusion is not None:
            composite = f"{status}+{conclusion}"
            if composite in self.verdict_by_status:
                return self.verdict_by_status[composite]
        return self.verdict_by_status.get(status, "pending")

    def fold(self, verdicts: set[str]) -> str:
        for verdict in self.fold_order:
            if verdict in verdicts:
                return verdict
        return self.fold_order[-1]


@lru_cache(maxsize=None)
def load_connector(name: str, connectors_dir: Path | None = None) -> ConnectorDef:
    path = (connectors_dir or CONNECTORS_DIR) / f"{name}.yml"
    if not path.exists():
        raise ConnectorDefError(f"no connector definition at {path}")
    raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ConnectorDefError(f"{path} is not a mapping")
    return ConnectorDef(name, raw)
