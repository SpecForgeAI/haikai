"""Load + validate YAML playbooks from playbooks/frameworks/ and playbooks/stacks/."""
import logging
from pathlib import Path
from typing import Any

import yaml

from src.ast.v2.playbook_schema import validate_playbook, validate_stack

logger = logging.getLogger(__name__)


def load_all_playbooks(playbooks_dir: str | Path = "playbooks/frameworks") -> dict[str, dict[str, Any]]:
    """Load every playbook in the directory. Invalid ones are logged and skipped."""
    out: dict[str, dict[str, Any]] = {}
    base = Path(playbooks_dir)
    if not base.exists():
        return out
    for path in base.glob("*.yaml"):
        try:
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            logger.warning(f"Skipping malformed YAML {path}: {e}")
            continue
        if not data or "name" not in data:
            logger.warning(f"Skipping playbook with no `name`: {path}")
            continue
        _, errors = validate_playbook(data)
        if errors:
            logger.warning(f"Invalid playbook {path}: {errors}")
            continue
        out[data["name"]] = data
    return out


def load_all_stacks(stacks_dir: str | Path = "playbooks/stacks") -> dict[str, dict[str, Any]]:
    """Load stack composition playbooks. A stack is a list of framework playbooks
    to include when its detection signal matches (e.g., django+graphql for saleor)."""
    out: dict[str, dict[str, Any]] = {}
    base = Path(stacks_dir)
    if not base.exists():
        return out
    for path in base.glob("*.yaml"):
        try:
            with open(path, encoding="utf-8") as f:
                data = yaml.safe_load(f)
        except yaml.YAMLError as e:
            logger.warning(f"Skipping malformed stack {path}: {e}")
            continue
        if not data or "name" not in data:
            continue
        _, errors = validate_stack(data)
        if errors:
            logger.warning(f"Invalid stack {path}: {errors}")
            continue
        out[data["name"]] = data
    return out
