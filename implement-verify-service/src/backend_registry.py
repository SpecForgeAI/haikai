"""Chat / CLI executor registry — single source of truth for backends.

This module owns the `BackendDescriptor` dataclass, the `BACKEND_REGISTRY`
mapping, and the helpers (`_executor_backend`, `_active_backend`,
`_credentials_satisfied`, `_build_cli_executor`) that callers use to
dispatch per-backend behavior.

Lives as a peer of `src.api` so the orchestrator and the job worker can
import the registry directly instead of reaching into `src.api`'s
underscore-private namespace via lazy imports (see CO1 in
`debug/260518-0633-executor-smell-taxonomy/findings.md`).

`_build_claude_chat_executor` stays in `src.api` for now — it has tight
coupling to OAuth detection, OpenAI fallback constants, and Claude-CLI
availability probing that all live in the API module. The registry
references it via a lazy lambda so the forward import works without a
load-time cycle.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from types import MappingProxyType
from typing import Callable, Optional

from fastapi import HTTPException, status

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BackendDescriptor:
    """All per-backend knobs in one place.

    Adding a new backend = adding one entry to `BACKEND_REGISTRY`. Adding
    a new capability (e.g., a different artifact format) = adding one
    field here and populating it for each backend.

    Fields:
        name: matches the `CHAT_EXECUTOR` env value.
        cli_executor_factory: builds a non-interactive CLI executor.
        chat_executor_factory: builds a streaming chat executor.
        brings_own_auth: when True, endpoints skip the
            `ANTHROPIC_API_KEY` gate (this backend authenticates itself).
        skill_dir: relative path inside the project workspace where the
            backend's CLI looks for skill / command definitions
            (e.g., `.claude/commands`, `.kiro/skills`).
        skill_filename: maps a command name to the on-disk filename the
            backend expects under `skill_dir` (e.g., `f"{cmd}.md"` for
            Claude, `f"{cmd}/SKILL.md"` for Kiro).
        cli_invocation_hint: f-string template used in artifact packages
            and docs to tell users how to invoke a command. Placeholders:
            `{command}`, `{spec_name}`.
    """

    name: str
    cli_executor_factory: Callable[[str, str], object]
    chat_executor_factory: Callable[[str, str, object, str], object]
    brings_own_auth: bool
    skill_dir: str
    skill_filename: Callable[[str], str]
    cli_invocation_hint: str

    def skill_relpath(self, command: str) -> str:
        """Backend-relative on-disk path for a command's skill file.

        Example: `claude` → `.claude/commands/implement-tasks.md`
                 `kiro`   → `.kiro/skills/implement-tasks/SKILL.md`
        """
        return f"{self.skill_dir}/{self.skill_filename(command)}"

    def invocation_hint(self, command: str, spec_name: str) -> str:
        """Human-readable shell command to invoke `command` for `spec_name`."""
        return self.cli_invocation_hint.format(command=command, spec_name=spec_name)


def _build_claude_cli_executor(project_dir: str, anthropic_api_key: str):
    from .claude_cli_executor import ClaudeCLIExecutor  # lazy
    return ClaudeCLIExecutor(
        project_dir=project_dir,
        anthropic_api_key=anthropic_api_key,
    )


def _build_kiro_cli_executor(project_dir: str, anthropic_api_key: str):
    from .kiro_cli_executor import KiroCLIExecutor  # lazy
    logger.info("Using KiroCLIExecutor (CHAT_EXECUTOR=kiro)")
    return KiroCLIExecutor(
        project_dir=project_dir,
        anthropic_api_key=anthropic_api_key,
    )


def _build_kiro_chat_executor(company: str, project: str, workspace_dir, anthropic_api_key: str,
                              session_uuid: Optional[str] = None,
                              extra_dirs: Optional[list] = None):
    """Kiro chat executor builder.

    ``extra_dirs`` is accepted for symmetry with the Claude path but
    currently ignored — Kiro doesn't honour ``--add-dir``. The polyrepo
    workspace layout (one product root with N sub-dirs) still gives Kiro
    visibility into all repos via the workspace_dir mount; the extra
    per-folder mounts are a Claude-specific optimisation.
    """
    from .chat.kiro_chat_executor import KiroChatExecutor  # lazy
    if extra_dirs:
        logger.debug(
            "KiroChatExecutor: ignoring extra_dirs (%d entries) — Kiro does "
            "not consume --add-dir.",
            len(extra_dirs),
        )
    logger.info("Using KiroChatExecutor (CHAT_EXECUTOR=kiro)")
    return KiroChatExecutor(
        company=company,
        project=project,
        workspace_dir=workspace_dir,
        anthropic_api_key=anthropic_api_key,
        session_uuid=session_uuid,
    )


def _build_claude_chat_executor_shim(company: str, project: str, workspace_dir, anthropic_api_key: str,
                                     session_uuid: Optional[str] = None,
                                     extra_dirs: Optional[list] = None):
    """Lazy delegate to `api._build_claude_chat_executor`.

    The Claude factory body (OAuth detection, Claude-CLI availability
    probe, OpenAI fallback) lives in `src.api`. The registry can't
    import it at module load without a cycle (api imports the registry
    too), so we resolve lazily on each call.

    `extra_dirs` is the polyrepo per-folder mount list; forwarded
    through to the chosen executor.
    """
    from .api import _build_claude_chat_executor  # lazy: load-cycle break
    return _build_claude_chat_executor(company, project, workspace_dir, anthropic_api_key,
                                       session_uuid=session_uuid,
                                       extra_dirs=extra_dirs)


# The underlying dict is module-private (`_BACKEND_REGISTRY_RAW`); the
# public symbol `BACKEND_REGISTRY` is a read-only MappingProxyType.
# Mutation attempts (`BACKEND_REGISTRY["x"] = ...`) raise TypeError so
# the registry can't be silently extended at import time by an
# accidental side-effect in another module.
_BACKEND_REGISTRY_RAW: "dict[str, BackendDescriptor]" = {
    "claude": BackendDescriptor(
        name="claude",
        cli_executor_factory=_build_claude_cli_executor,
        chat_executor_factory=lambda c, p, w, k, *, session_uuid=None, extra_dirs=None: _build_claude_chat_executor_shim(
            c, p, w, k, session_uuid=session_uuid, extra_dirs=extra_dirs,
        ),
        brings_own_auth=False,
        skill_dir=".claude/commands",
        skill_filename=lambda cmd: f"{cmd}.md",
        cli_invocation_hint="claude /{command} for {spec_name}",
    ),
    "kiro": BackendDescriptor(
        name="kiro",
        cli_executor_factory=_build_kiro_cli_executor,
        chat_executor_factory=_build_kiro_chat_executor,
        brings_own_auth=True,
        skill_dir=".kiro/skills",
        skill_filename=lambda cmd: f"{cmd}/SKILL.md",
        cli_invocation_hint=(
            "kiro-cli chat --no-interactive --trust-all-tools "
            "'Execute the {command} skill for {spec_name}'"
        ),
    ),
}

BACKEND_REGISTRY = MappingProxyType(_BACKEND_REGISTRY_RAW)


def _executor_backend() -> str:
    """Return the active chat-executor backend name.

    Reads `CHAT_EXECUTOR`. The env var is REQUIRED — there is no
    auto-detection or fallback. The returned string is a key of
    `BACKEND_REGISTRY`.

    Raises:
        HTTPException(503): when `CHAT_EXECUTOR` is unset or holds an
            unrecognized value. 503 means "operator action needed"
            (the server hasn't crashed — the deployment is misconfigured)
            and matches the precedent set by the missing-API-key gates
            (`structural_endpoints.py:372`).

    The exception inherits from Exception, so non-API call sites
    (CLI, worker process startup) still see a Python exception with
    the same message — they just won't get the FastAPI handling.

    See `docs/ENABLING_KIRO_CLI.md` for the activation contract.
    """
    value = os.getenv("CHAT_EXECUTOR", "").strip().lower()
    if not value:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "CHAT_EXECUTOR is required. Set it to one of "
                f"{sorted(_BACKEND_REGISTRY_RAW)} "
                "(see docs/ENABLING_KIRO_CLI.md)."
            ),
        )
    if value not in BACKEND_REGISTRY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                f"CHAT_EXECUTOR={value!r} is not recognized. "
                f"Allowed values: {sorted(_BACKEND_REGISTRY_RAW)}."
            ),
        )
    return value


def _active_backend() -> BackendDescriptor:
    """Return the BackendDescriptor for the active backend."""
    return BACKEND_REGISTRY[_executor_backend()]


def _credentials_satisfied(anthropic_api_key: Optional[str]) -> bool:
    """True when the request has enough credentials to proceed.

    Either the active backend supplies its own auth (Kiro SSO; see
    `BackendDescriptor.brings_own_auth`), or an `anthropic_api_key`
    was loaded from the env — covers both regular API keys AND OAuth
    tokens since both ride in the same field today.

    Future refactors that split OAuth into its own env var only need
    to teach this helper, not patch each gate site.
    """
    return _active_backend().brings_own_auth or bool(anthropic_api_key)


def _build_cli_executor(project_dir: str, anthropic_api_key: str):
    """Construct the non-interactive CLI executor for the active backend."""
    return _active_backend().cli_executor_factory(project_dir, anthropic_api_key)
