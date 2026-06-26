"""Tool registry — plain specs wrapping connector functions.

Importing this never requires the `mcp` SDK; the runtime server
(`gitlab_server.py`) consumes `TOOLS` and registers each spec. Keeping the
registry SDK-free means tool names, grouping, and the `destructive` flag are
unit-testable before the SDK is even installed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from src.connectors.gitlab import runners


@dataclass(frozen=True)
class ToolSpec:
    name: str
    fn: Callable
    description: str
    destructive: bool = False


TOOLS: list[ToolSpec] = [
    # --- Runners -----------------------------------------------------------
    ToolSpec(
        "gitlab_list_runners",
        runners.list_runners,
        "List CI runners, optionally filtered by status and tags.",
    ),
    ToolSpec(
        "gitlab_get_runner",
        runners.get_runner,
        "Get a single runner by id.",
    ),
    ToolSpec(
        "gitlab_pause_runner",
        runners.pause_runner,
        "Pause a runner so it stops taking new jobs.",
        destructive=True,
    ),
    ToolSpec(
        "gitlab_resume_runner",
        runners.resume_runner,
        "Resume a paused runner.",
    ),
    ToolSpec(
        "gitlab_delete_runner",
        runners.delete_runner,
        "Delete a runner (irreversible).",
        destructive=True,
    ),
]


def tool_names() -> list[str]:
    return [t.name for t in TOOLS]
