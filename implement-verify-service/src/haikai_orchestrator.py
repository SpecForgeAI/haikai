"""
Haikai Orchestrator for automated workflow execution.

This module provides the main orchestration logic for running Haikai workflows
(write-spec, create-tasks, implement-tasks) without user interaction.
"""

import logging
import json
import os
import re
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Callable, Union, Tuple

from .haikai_models import (
    OrchestrationRequest,
    OrchestrationResponse,
    OrchestrationV2Response,
    StepResult,
    ImplementationPackage,
    ImplementationPackageFile,
)
from .path_safety import safe_segment
from .trace import tracer

logger = logging.getLogger(__name__)
_trace = tracer("impl-verify")


def _polyrepo_extra_dirs(
    workspace_dir,
    company: str,
    project: str,
) -> List[Path]:
    """Compute per-folder ``--add-dir`` mounts from ``coordination.yaml``.

    Snapshot-at-build semantics (FR-10): we read the map once when the
    executor is built. Mid-run mutations to ``coordination.yaml`` from the
    CRUD endpoints apply to the *next* run, not this one.

    Returns:
        A list of absolute paths, one per folder in the coordination map.
        For a one-entry product the returned list contains the single
        folder path; the existing `--add-dir <project_dir>` flag in the
        chat executor still covers it, so the extra mount is redundant
        but harmless. Empty list if the project hasn't been initialised
        (legacy single-repo projects with no coordination.yaml yet) — in
        that case downstream falls back to the project_dir mount alone.
    """
    from .git.coordination import CoordinationError, read_coordination
    product_root = Path(workspace_dir) / company / project
    try:
        repos = read_coordination(product_root)
    except CoordinationError:
        # Legacy single-repo project or uninitialised — no extra mounts.
        return []
    return [product_root / folder for folder in sorted(repos.keys())]


def _build_chat_executor(
    company: str,
    project: str,
    workspace_dir,
    anthropic_api_key: str,
    session_uuid: Optional[str] = None,
):
    """Construct the chat executor for the active backend.

    Routes through the registry's per-backend `chat_executor_factory`
    so adding a third backend doesn't require editing this function.
    See `docs/ENABLING_KIRO_CLI.md` for the activation contract.

    `session_uuid` is forwarded as a ctor kwarg so callers don't have
    to mutate `executor.session_uuid` post-construction. Closes the
    Temporary Field regression flagged in
    `debug/260520-1700-executor-smell-taxonomy-pass2/findings.md` O4'.

    Polyrepo (Phase 4 of polyrepo spec): if ``coordination.yaml`` exists
    at the product root we compute one ``--add-dir`` mount per folder and
    forward them as ``extra_dirs``. Backends that don't honour
    ``--add-dir`` (Kiro today) ignore it. The snapshot is taken here so
    in-flight runs are insulated from CRUD mutations.
    """
    from .backend_registry import _active_backend
    extra_dirs = _polyrepo_extra_dirs(workspace_dir, company, project)
    return _active_backend().chat_executor_factory(
        company, project, workspace_dir, anthropic_api_key,
        session_uuid=session_uuid,
        extra_dirs=extra_dirs,
    )


class HaikaiOrchestrator:
    """
    Orchestrates the execution of Haikai workflows.

    This class manages the end-to-end workflow of:
    0. Validating that spec folder and requirements.md exist (fails if missing)
    1. Running /write-spec to create spec.md
    2. Running /create-tasks to create tasks.md
    3. Running /implement-tasks to implement all tasks

    Spec folders and requirements.md MUST be created by /shape-spec before orchestration.
    The orchestrator never creates folders or stub files — it only processes pre-shaped specs.
    """

    # Command definitions
    COMMANDS = [
        {"step": 1, "command": "/write-spec", "description": "Write specification"},
        {"step": 2, "command": "/create-tasks", "description": "Create task list"},
        {"step": 3, "command": "/implement-tasks", "description": "Implement all tasks"},
        {"step": 4, "command": "/git-commit-preparation", "description": "Prepare workspace for git commit", "non_fatal": True},
    ]

    def __init__(
        self,
        request: OrchestrationRequest,
        anthropic_api_key: str,
        workspace_dir: str,
        logs_dir: str,
        session_id: str = None,
    ):
        """
        Initialize the orchestrator.

        Args:
            request: The orchestration request containing spec intents and options
            anthropic_api_key: Anthropic API key for Claude CLI
            workspace_dir: Base workspace directory path
            logs_dir: Directory for storing orchestration logs
            session_id: Active session UUID (from session_store)
        """
        self.request = request
        self.anthropic_api_key = anthropic_api_key
        self.session_id = session_id
        self.workspace_dir = Path(workspace_dir)
        self.logs_dir = Path(logs_dir)
        self.logs_dir.mkdir(parents=True, exist_ok=True)

        # Validate company/project segments BEFORE joining — `..` would
        # otherwise let `workspace_dir/<company>/<project>` escape via Path's
        # parent-traversal semantics. The pre-existence checks below are not
        # security checks; for `company=".."`, the resolved `workspace_dir/..`
        # typically exists (parent of workspace) so they'd pass too.
        company = safe_segment(request.company, "company")
        project = safe_segment(request.project, "project")
        self.project_dir = self.workspace_dir / company / project

        if not self.workspace_dir.exists():
            raise ValueError(
                f"Workspace directory does not exist: {self.workspace_dir}"
            )

        company_dir = self.workspace_dir / company
        if not company_dir.exists():
            raise ValueError(
                f"Company '{company}' not found in workspace. "
                f"Directory does not exist: {company_dir}"
            )

        if not self.project_dir.exists():
            raise ValueError(
                f"Project '{project}' not found under company '{company}'. "
                f"Directory does not exist: {self.project_dir}"
            )

        # Generate unique orchestration ID
        self.orchestration_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.orchestration_log_dir = self.logs_dir / self.orchestration_id
        self.orchestration_log_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Initialized HaikaiOrchestrator with ID: {self.orchestration_id}")

    def run_workflow(
        self,
        start_from_step: int = 1,
        on_step_complete: Optional[Callable[[int, str], None]] = None,
        on_spec_complete: Optional[Callable[[str, int], bool]] = None,
        fresh_session_start: bool = False,
    ) -> OrchestrationResponse:
        """
        Execute the complete Haikai workflow for all spec intents.

        Args:
            start_from_step: Step number to start from (1=write-spec,
                2=create-tasks, 3=implement-tasks). Steps before this
                are skipped. Used for resuming after interruption.
            on_step_complete: Callback invoked after each successful step
                with (step_number, step_description). Used by the job
                queue to checkpoint progress to jobs.db.
            on_spec_complete: Callback invoked with (spec_name, spec_idx)
                after a spec's steps finish WITHOUT a fatal failure, and
                BEFORE the next spec is generated. The job runner uses this
                to commit each spec to its own branch while only that spec's
                files exist in the tree — `git add -A` would otherwise sweep
                later specs' files into the first spec's commit (B2). Each
                spec thus gets an independent feature branch off default.

        Returns:
            OrchestrationResponse containing results of all steps
        """
        start_time = datetime.now()
        all_results: List[StepResult] = []
        spec_names_generated: List[str] = []
        session_ids: Dict[str, str] = {}

        # Trace correlation: the orchestrator knows the project (the
        # workflow-spanning grouping key). The job id lives in the job runner
        # (tasks.py), which owns the started/deploy/callback SUMMARY lines.
        corr = {"project": self.request.project}

        try:
            logger.info(f"Starting orchestration for {len(self.request.spec_intents)} spec(s)")

            # Single shared executor using the active session.
            # Backend selected via CHAT_EXECUTOR env var (default: claude).
            # session_uuid forwarded as ctor arg — no post-construction
            # mutation (was O4' regression; see pass-2 findings).
            chat_executor = _build_chat_executor(
                company=self.request.company,
                project=self.request.project,
                workspace_dir=self.workspace_dir,
                anthropic_api_key=self.anthropic_api_key,
                session_uuid=self.session_id,
            )
            # Parallel-worktrees D13: forward the job runner's pid-tracking
            # callback so the CLI subprocess tree is a killable, job-owned
            # handle (cancel watchdog). Optional attribute — absent outside
            # the job queue.
            if getattr(self, "on_spawn", None):
                chat_executor.on_spawn = self.on_spawn

            # Process each spec intent
            for spec_idx, spec_intent in enumerate(self.request.spec_intents):
                # Validate spec_name before joining — same threat model as
                # company/project: it's user-supplied via the API request.
                spec_name = safe_segment(spec_intent.spec_name, "spec_name")
                logger.info(f"Processing spec {spec_idx + 1}/{len(self.request.spec_intents)}: {spec_name} (session: {self.session_id})")

                spec_names_generated.append(spec_name)
                session_ids[spec_name] = self.session_id or chat_executor.session_uuid

                # REQUIRE existing spec with requirements.md — never create from scratch
                spec_dir = self.project_dir / "haikai" / "specs" / spec_name
                requirements_file = spec_dir / "planning" / "requirements.md"

                if not spec_dir.exists():
                    error_msg = (
                        f"Spec folder not found: haikai/specs/{spec_name}. "
                        f"Run /shape-spec first to create and shape this spec before orchestrating."
                    )
                    logger.error(error_msg)
                    all_results.append(StepResult(
                        step=0, command="pre-check",
                        status="failure", output_paths=[],
                        execution_time_seconds=0,
                        log_file=self._create_step_log(0, "pre-check", {
                            "success": False, "stdout": "", "stderr": error_msg,
                            "execution_time": 0, "timestamp": datetime.now().isoformat()
                        }),
                        error_message=error_msg
                    ))
                    if self.request.options.stop_on_error:
                        break
                    continue

                if not requirements_file.exists():
                    error_msg = (
                        f"Requirements not found: haikai/specs/{spec_name}/planning/requirements.md. "
                        f"Run /shape-spec first to gather requirements before orchestrating."
                    )
                    logger.error(error_msg)
                    all_results.append(StepResult(
                        step=0, command="pre-check",
                        status="failure", output_paths=[],
                        execution_time_seconds=0,
                        log_file=self._create_step_log(0, "pre-check", {
                            "success": False, "stdout": "", "stderr": error_msg,
                            "execution_time": 0, "timestamp": datetime.now().isoformat()
                        }),
                        error_message=error_msg
                    ))
                    if self.request.options.stop_on_error:
                        break
                    continue

                initialization_file = spec_dir / "planning" / "initialization.md"
                if not initialization_file.exists():
                    error_msg = (
                        f"Spec '{spec_name}' is missing planning/initialization.md. "
                        f"This file is created during /shape-spec and is required before orchestration. "
                        f"Ensure the spec has been fully shaped before orchestrating."
                    )
                    logger.error(error_msg)
                    all_results.append(StepResult(
                        step=0, command="pre-check",
                        status="failure", output_paths=[],
                        execution_time_seconds=0,
                        log_file=self._create_step_log(0, "pre-check", {
                            "success": False, "stdout": "", "stderr": error_msg,
                            "execution_time": 0, "timestamp": datetime.now().isoformat()
                        }),
                        error_message=error_msg
                    ))
                    if self.request.options.stop_on_error:
                        break
                    continue

                # Execute each command in sequence for this spec
                commands_to_run = [
                    c for c in self.COMMANDS if c["step"] >= start_from_step
                ]
                # Step 4 (/git-commit-preparation) runs ONCE per request, on
                # the FINAL spec only — its gitignore/secrets value is
                # per-repo, not per-spec, and the skill is a ~10-minute LLM
                # turn (2026-07-30 live: 13m37s dominating each spec). A
                # sequential driver (one spec per request) sets
                # commit_preparation=False on every non-final request.
                is_final_intent = spec_idx == len(self.request.spec_intents) - 1
                run_commit_prep = (
                    getattr(self.request, "commit_preparation", None) is not False
                    and is_final_intent
                )
                if not run_commit_prep:
                    commands_to_run = [c for c in commands_to_run if c["step"] != 4]
                if start_from_step > 1:
                    logger.info(f"Spec '{spec_name}' - Resuming from step {start_from_step}, skipping {start_from_step - 1} step(s)")

                non_fatal_steps = {c["step"] for c in self.COMMANDS if c.get("non_fatal")}
                spec_start = len(all_results)  # this spec's results begin here
                for cmd_def in commands_to_run:
                    step = cmd_def["step"]
                    command = cmd_def["command"]
                    description = cmd_def["description"]

                    logger.info(f"Spec '{spec_name}' - Step {step}: {description} - Executing {command}")

                    # Worktree runs start step 1 FRESH (a new session in the
                    # worktree) rather than resuming the shape-spec session:
                    # a resumed session's conversation context is anchored to
                    # the live-tree cwd, so /write-spec writes spec.md outside
                    # the worktree. requirements.md is already seeded into the
                    # worktree — all write-spec needs. Steps 2-3 resume this
                    # fresh session (created in-worktree by step 1).
                    is_new_session = fresh_session_start and step == start_from_step

                    step_result = self._execute_step_with_retry(
                        chat_executor=chat_executor,
                        step=step,
                        command=command,
                        spec_name=spec_name,
                        is_new_session=is_new_session,
                    )

                    all_results.append(step_result)

                    # Notify caller to checkpoint progress
                    if on_step_complete and step_result.status == "success":
                        on_step_complete(step, description)

                    # Handle errors based on options
                    is_non_fatal = cmd_def.get("non_fatal", False)
                    if step_result.status == "failure":
                        if is_non_fatal:
                            logger.warning(f"Spec '{spec_name}' - Step {step} ({command}) failed but is non-fatal. Continuing.")
                        elif self.request.options.stop_on_error:
                            logger.error(f"Spec '{spec_name}' - Step {step} failed and stop_on_error is True. Stopping workflow.")
                            break
                        else:
                            logger.warning(f"Spec '{spec_name}' - Step {step} failed but continuing due to stop_on_error=False")

                # L5: commit THIS spec to its own branch only if its REQUIRED steps
                # all succeeded — don't publish a branch/PR for a half-generated spec
                # (the old `not spec_had_fatal` gate let a non-fatally-failed spec
                # through when stop_on_error=False). Interleaved (before the next
                # spec) so `git add -A` stages only this spec's files (B2).
                spec_steps = all_results[spec_start:]
                spec_ok = all(r.status == "success" or r.step in non_fatal_steps for r in spec_steps)
                # SUMMARY: each spec implemented (its required steps converged or not).
                if spec_ok:
                    _trace.ok(f"spec implemented — {spec_name}", corr)
                else:
                    _trace.fail(f"spec failed — {spec_name}", corr)
                if on_spec_complete and spec_ok:
                    git_failed = on_spec_complete(spec_name, spec_idx)
                    # L4: a per-spec git failure halts further generation under
                    # stop_on_error (run_workflow otherwise only watches step results).
                    if git_failed and self.request.options.stop_on_error:
                        logger.error(f"Stopping orchestration: git failed for spec '{spec_name}'")
                        break

                # If stop_on_error is True and we had a fatal failure, stop processing more specs
                has_fatal_failure = any(
                    r.status == "failure" and r.step not in non_fatal_steps
                    for r in all_results
                )
                if self.request.options.stop_on_error and has_fatal_failure:
                    logger.error(f"Stopping orchestration due to failure in spec '{spec_name}'")
                    break

            # Calculate total execution time
            end_time = datetime.now()
            total_time = (end_time - start_time).total_seconds()

            # Determine overall success (non-fatal step failures don't count)
            non_fatal_steps = {c["step"] for c in self.COMMANDS if c.get("non_fatal")}
            success = all(
                r.status == "success" or r.step in non_fatal_steps
                for r in all_results
            )

            # Create main orchestration log
            orchestration_log = self._create_orchestration_log(
                spec_names=spec_names_generated,
                results=all_results,
                total_time=total_time,
                success=success
            )

            # Robustness R1: surface the FIRST fatal failure's classification
            # + step so the gateway's retry policy (and resume-at-step) is
            # informed via the build-results callback.
            first_fatal = next(
                (r for r in all_results
                 if r.status == "failure" and r.step not in non_fatal_steps),
                None,
            )
            return OrchestrationResponse(
                success=success,
                spec_names=spec_names_generated,
                session_ids=session_ids,
                results=all_results,
                total_execution_time_seconds=total_time,
                orchestration_log=orchestration_log,
                failure_class=first_fatal.failure_class if first_fatal else None,
                failed_step=first_fatal.step if first_fatal else None,
            )

        except Exception as e:
            logger.error(f"Orchestration failed with exception: {str(e)}", exc_info=True)

            # Create error response
            end_time = datetime.now()
            total_time = (end_time - start_time).total_seconds()

            error_log = self._create_error_log(str(e), total_time)

            return OrchestrationResponse(
                success=False,
                spec_names=spec_names_generated,
                session_ids=session_ids,
                results=all_results,
                total_execution_time_seconds=total_time,
                orchestration_log=error_log
            )

    def _model_fallback_tracker(self):
        """Lazy per-run ModelFallbackTracker (Robustness R1).

        Created once per orchestrator instance (= one run): after
        KIRO_MODEL_FALLBACK_THRESHOLD (default 3) transient failures on the
        primary model, subsequent kiro spawns pin
        KIRO_CHAT_MODEL_ALTERNATIVE instead. Kiro-only — the Claude executor
        has no alternative-model contract.
        """
        if getattr(self, "_fallback_tracker", None) is None:
            from .chat.model_pinning import kiro_alternative_model, kiro_pinned_model
            from .chat.transient_failure import ModelFallbackTracker
            self._fallback_tracker = ModelFallbackTracker(
                primary=kiro_pinned_model(),
                alternative=kiro_alternative_model(),
            )
        return self._fallback_tracker

    def _apply_model_fallback(self, chat_executor) -> None:
        """Swap the executor onto the alternative model once fallback is active.

        The ONE sanctioned post-construction mutation of ``executor.model``
        (documented exception to the O4' no-mutation rule): model choice is
        inherently run-dynamic once upstream availability enters the picture.
        Kiro executors only.
        """
        tracker = self._model_fallback_tracker()
        if not tracker.fallback_active:
            return
        if not type(chat_executor).__name__.startswith("Kiro"):
            return
        if getattr(chat_executor, "model", None) != tracker.alternative:
            logger.warning(
                "Swapping executor model to the fallback %r (was %r) after "
                "%d transient failure(s).",
                tracker.alternative,
                getattr(chat_executor, "model", None),
                tracker.transient_failures,
            )
            chat_executor.model = tracker.alternative

    def _execute_step_with_retry(
        self,
        chat_executor,
        step: int,
        command: str,
        spec_name: str,
        is_new_session: bool = False,
    ) -> StepResult:
        """Execute a step with bounded transient-failure retries (R1).

        Policy: only failures classified ``transient_upstream`` (backend
        5xx / throttling / timeout signatures — see
        src/chat/transient_failure.py) are retried, after a cool-off
        (STEP_RETRY_BACKOFF_SECONDS, default 30s then 120s), up to
        STEP_RETRY_MAX_RETRIES extra tries (default 2 ⇒ 3 tries). REAL
        failures (questions in a non-interactive run, unticked tasks,
        incoherent output) return immediately — retrying would mask them.
        Each transient failure feeds the model-fallback tracker; retries
        resume the SAME session (never a fresh one), so partial step work
        is context the next try builds on.
        """
        import time as _time

        from .chat.transient_failure import (
            FAILURE_CLASS_TRANSIENT,
            step_retry_backoff_seconds,
            step_retry_max_retries,
        )

        max_tries = 1 + step_retry_max_retries()
        backoff = step_retry_backoff_seconds()
        result: StepResult = None  # type: ignore[assignment]
        for attempt in range(1, max_tries + 1):
            self._apply_model_fallback(chat_executor)
            result = self._execute_step_with_session(
                chat_executor=chat_executor,
                step=step,
                command=command,
                spec_name=spec_name,
                # A retry continues the session the first try created.
                is_new_session=is_new_session and attempt == 1,
            )
            result.attempts = attempt
            if result.status == "success":
                return result
            if result.failure_class == FAILURE_CLASS_TRANSIENT:
                self._model_fallback_tracker().record_transient_failure()
            if result.failure_class != FAILURE_CLASS_TRANSIENT or attempt == max_tries:
                return result
            delay = backoff[min(attempt - 1, len(backoff) - 1)]
            logger.warning(
                "Spec '%s' - Step %d (%s) failed TRANSIENTLY (attempt %d/%d): "
                "cooling off %.0fs then retrying.",
                spec_name, step, command, attempt, max_tries, delay,
            )
            _trace.warn(
                f"step {step} transient failure — retrying in {delay:.0f}s "
                f"(attempt {attempt}/{max_tries})",
                {"project": self.request.project},
            )
            _time.sleep(delay)
        return result

    def _execute_step_with_session(
        self,
        chat_executor,  # ClaudeChatExecutor or KiroChatExecutor (CHAT_EXECUTOR-selected)
        step: int,
        command: str,
        spec_name: str,
        is_new_session: bool = False,
    ) -> StepResult:
        """
        Execute a single workflow step by resuming the shape-spec Claude CLI session.

        Args:
            chat_executor: ClaudeChatExecutor configured with the spec's session_uuid
            step: Step number (1-3)
            command: The Haikai command to execute (e.g. "/write-spec")
            spec_name: The spec directory name

        Returns:
            StepResult containing execution details
        """
        start_time = datetime.now()

        # Build the prompt
        prompt = f"{command} for {spec_name}"
        if step == 3:
            prompt += " — Implement ALL task groups without asking for confirmation."

        # Stream the command via the shape-spec session (--resume)
        command_name = command.lstrip("/")
        collected_content = []
        errors = []
        success = True

        try:
            for event in chat_executor.stream_message(
                prompt,
                is_new_session=is_new_session,
                command_name=command_name
            ):
                event_type = event.get("type")
                if event_type == "content":
                    collected_content.append(event.get("delta", ""))
                elif event_type == "error":
                    errors.append(event.get("message", ""))
                elif event_type == "questions":
                    # Non-interactive run: nobody can answer (2026-07-28 live:
                    # a skill-less step improvised /ask-questions and stalled
                    # a headless job ~7 minutes). A questions batch in an
                    # orchestration step is an immediate, named failure.
                    errors.append(
                        f"Step {step} ({command}) asked clarifying questions in a "
                        "non-interactive orchestration run — orchestration steps "
                        "must proceed without questions."
                    )
                elif event_type == "file_modified":
                    logger.info(f"File modified: {event.get('path', '')}")

            # Check for errors
            if errors:
                success = False
        except Exception as e:
            logger.error(f"Step {step} ({command}) failed: {e}", exc_info=True)
            success = False
            errors.append(str(e))

        end_time = datetime.now()
        execution_time = (end_time - start_time).total_seconds()

        # Determine output paths based on step
        output_paths = self._determine_output_paths(step, spec_name)

        # Verify the step actually produced its expected output files.
        # Without this guard, an LLM that silently gave up (no error event,
        # no exception, but also no spec.md written) produced a "success"
        # response — surfaced as the silent-lie pattern in E2E test #1.
        if success:
            missing = [p for p in output_paths if not Path(p).exists()]
            if missing:
                success = False
                msg = (
                    f"Step {step} ({command}) completed without errors but "
                    f"expected output files are missing: {missing}. "
                    "Likely a silent LLM failure (no error event emitted)."
                )
                logger.error(msg)
                errors.append(msg)

        # Step 3 (implement-tasks): success is keyed on ACTUAL task
        # completion — the tasks.md checkboxes are the ground truth. The
        # verification report is advisory only (see _determine_output_paths):
        # failing the step over a missing report conflates "didn't write a
        # report" with "didn't implement".
        blocked_notes: List[str] = []
        if success and step == 3:
            spec_dir = self.project_dir / "haikai" / "specs" / spec_name
            tasks_md = spec_dir / "tasks.md"
            unchecked = self._count_unchecked_tasks(tasks_md)
            blocked_ok, blocked_malformed, blocked_notes = self._count_blocked_tasks(tasks_md)
            if blocked_malformed > 0:
                # A bare ``[~]`` with no reason is a dodge, not a block.
                success = False
                msg = (
                    f"Step {step} ({command}) finished but tasks.md has "
                    f"{blocked_malformed} blocked task checkbox(es) `[~]` with no "
                    "`BLOCKED: <reason>` — a block must say what could not be "
                    "evidenced and why (environment-impossible items only)."
                )
                logger.error(msg)
                errors.append(msg)
            elif unchecked is not None and unchecked > 0:
                success = False
                msg = (
                    f"Step {step} ({command}) finished but tasks.md still has "
                    f"{unchecked} unticked task checkbox(es) — the "
                    "implementation is incomplete."
                )
                logger.error(msg)
                errors.append(msg)
            elif unchecked is None:
                # Gold standard (2026-08-07): unjudgeable = FAILED, never a
                # warning. A tasks.md with no checkboxes (or unreadable) means
                # completion CANNOT be verified — treating it as success was
                # the silent-lie pattern with extra steps: an LLM that wrote
                # prose instead of a checklist sailed through the gate.
                success = False
                msg = (
                    f"Step {step} ({command}) finished but completion cannot "
                    "be judged: tasks.md is unreadable or contains no task "
                    "checkboxes. An unjudgeable implementation is a FAILED "
                    "implementation — the step must produce a checkable "
                    "tasks.md."
                )
                logger.error(msg)
                errors.append(msg)
            if success and blocked_ok > 0:
                # Reasoned blocks PASS — loudly. They name what this environment
                # could not evidence and who owns it (deploy-time runners, a
                # closure story); they are persisted on the step log below.
                logger.warning(
                    "Step 3 (%s): %d task(s) recorded as BLOCKED with a reason "
                    "(environment-impossible here; verify at their real "
                    "owner):\n  %s",
                    command,
                    blocked_ok,
                    "\n  ".join(blocked_notes),
                )
            if not (spec_dir / "verification" / "final-verification.md").exists():
                logger.warning(
                    "Step 3 (%s): verification/final-verification.md was not "
                    "written — advisory only; the step is judged on tasks.md "
                    "completion.",
                    command,
                )

        # DETAIL: per-spec workflow step outcome — concentrated where failures
        # hide. The git/deploy detail lives in the job runner (tasks.py); this is
        # the LLM command step (write-spec/create-tasks/implement-tasks).
        _trace.detail(
            "orchestration.step",
            {
                "spec": spec_name,
                "step": step,
                "command": command,
                "success": success,
                "duration_s": round(execution_time, 3),
                "errors": errors[:3] if errors else [],
            },
            {"project": self.request.project},
        )

        # Create execution result dict for logging
        execution_result = {
            "success": success,
            "stdout": "".join(collected_content),
            "stderr": "\n".join(errors) if errors else "",
            "execution_time": execution_time,
            "timestamp": datetime.now().isoformat(),
            "session_id": chat_executor.session_uuid,
            # Blocked-with-reason tasks (2026-09-04): persisted on the step log
            # so an environment-impossible criterion is auditable after the
            # worktree is cleaned up, instead of living only in a WARNING line.
            "blocked_tasks": blocked_notes,
        }

        # Create step log file
        log_file = self._create_step_log(step, command, execution_result)

        # Persist session to spec folder after each step
        try:
            chat_executor.persist_session_to_spec(spec_name)
        except Exception as e:
            logger.warning(f"Failed to persist session after step {step}: {e}")

        # Classify the failure (Robustness R1): transient upstream signatures
        # may live in the ERROR events (exit-code-first messages) OR in the
        # trailing CONTENT (kiro-cli prints its trouble banner to stdout and
        # exits 0 — the silent-lie shape). The classification drives the
        # step-retry policy and rides the build-results callback.
        failure_class = None
        if not success:
            from .chat.transient_failure import classify_step_failure
            failure_class = classify_step_failure(
                errors, "".join(collected_content)
            )

        # Build step result
        return StepResult(
            step=step,
            command=command,
            status="success" if success else "failure",
            output_paths=output_paths,
            execution_time_seconds=execution_time,
            log_file=log_file,
            error_message="\n".join(errors) if errors else None,
            failure_class=failure_class,
        )

    def _determine_output_paths(self, step: int, spec_name: str) -> List[str]:
        """
        Determine the expected output file paths for a step.

        Args:
            step: Step number (1-3)
            spec_name: The spec directory name

        Returns:
            List of expected output file paths
        """
        spec_dir = self.project_dir / "haikai" / "specs" / spec_name

        if step == 1:
            # write-spec creates spec.md
            return [str(spec_dir / "spec.md").replace("\\", "/")]
        elif step == 2:
            # create-tasks creates tasks.md
            return [str(spec_dir / "tasks.md").replace("\\", "/")]
        elif step == 3:
            # implement-tasks success is keyed on ACTUAL task completion:
            # tasks.md (which always exists after create-tasks) plus the
            # unchecked-checkbox judgement in _execute_step_with_session.
            # The verification report (verification/final-verification.md)
            # is advisory — a big spec can run out of its LLM turn right
            # before writing the report despite having implemented and
            # ticked every task (live 2026-07-30: 18k-char spec failed the
            # run on exactly that), so its absence must not gate the step.
            return [str(spec_dir / "tasks.md").replace("\\", "/")]

        return []

    @staticmethod
    def _count_unchecked_tasks(tasks_md: Path) -> Optional[int]:
        """Count unticked ``- [ ]`` checkboxes in a tasks.md.

        Returns ``None`` when the file is unreadable or contains no
        checkboxes at all — the caller FAILS the step (unjudgeable), so a
        tasks.md consisting only of reasoned ``[~]`` blocks must still count
        as judgeable: ``[~]`` is a checkbox state for this test.
        """
        try:
            text = tasks_md.read_text(encoding="utf-8")
        except OSError:
            return None
        unchecked = len(re.findall(r"^\s*[-*]\s*\[ \]", text, flags=re.MULTILINE))
        checked = len(re.findall(r"^\s*[-*]\s*\[[xX]\]", text, flags=re.MULTILINE))
        blocked = len(re.findall(r"^\s*[-*]\s*\[~\]", text, flags=re.MULTILINE))
        if unchecked == 0 and checked == 0 and blocked == 0:
            return None
        return unchecked

    _BLOCKED_LINE_RE = re.compile(r"^(?P<indent>\s*)[-*]\s*\[~\]\s*(?P<body>.*)$")
    _BLOCKED_REASON_RE = re.compile(r"\bBLOCKED\s*[:\-\u2013\u2014]\s*(?P<reason>\S.*)$", flags=re.IGNORECASE)
    @staticmethod
    def _width(indent: str) -> int:
        """Indent width with tabs normalised to 4 so mixed whitespace compares."""
        return len(indent.replace("\t", "    "))

    @classmethod
    def _count_blocked_tasks(cls, tasks_md: Path) -> Tuple[int, int, List[str]]:
        """Count ``- [~]`` (blocked-with-reason) checkboxes in a tasks.md.

        Third checkbox state (2026-09-04). Incident: two implement runs of
        DB-pack cluster specs did the same real work (all changesets written
        byte-for-byte, statically validated) and hit the same wall — the
        spec's acceptance included a live Liquibase apply and an
        expected-schema diff, which are DEPLOY-time checks this worktree has
        no JVM, Liquibase or database to run. One agent recorded the gap in
        prose and ticked the boxes (passed); the other recorded it as
        checkbox state (halted the run). Same actual state, opposite
        outcomes, decided only by bookkeeping — and the halt landed on the
        honest agent. The spec carriage now keeps deploy-time checks out of
        acceptance; this state is defence in depth so "cannot be evidenced
        here" is distinguishable from "not done" when it happens anyway.

        A block MUST carry ``BLOCKED: <reason>`` (``:``, ``-``, en/em dash;
        case-insensitive) — a bare ``[~]`` is a dodge, not a block, and the
        caller fails the step on it.

        Returns ``(with_reason, without_reason, reasons)`` where ``reasons``
        are the task texts with their reasons, for the step log.
        """
        try:
            text = tasks_md.read_text(encoding="utf-8")
        except OSError:
            return (0, 0, [])
        with_reason = 0
        without_reason = 0
        notes: List[str] = []
        lines = text.splitlines()
        for i, line in enumerate(lines):
            m = cls._BLOCKED_LINE_RE.match(line)
            if not m:
                continue
            body = m.group("body").strip()
            r = cls._BLOCKED_REASON_RE.search(body)
            if r and r.group("reason").strip():
                with_reason += 1
                notes.append(body)
                continue
            # No reason on this line: look for one in the subtree beneath it
            # (2026-09-04 correction: agents record the reason as an indented
            # sub-bullet under the box, the natural tasks.md shape). The
            # subtree ends at the first non-blank line indented no deeper than
            # the box itself, so a same-indent sibling's reason never leaks
            # onto an unreasoned box. A child that is itself a bare ``[~]``
            # carries no reason and does not rescue its parent.
            my_indent = cls._width(m.group("indent"))
            child_reason = None
            for nxt in lines[i + 1:]:
                if not nxt.strip():
                    continue
                nxt_indent = cls._width(nxt[: len(nxt) - len(nxt.lstrip())])
                if nxt_indent <= my_indent:
                    break  # left this box's subtree
                rr = cls._BLOCKED_REASON_RE.search(nxt)
                if rr and rr.group("reason").strip():
                    child_reason = nxt.strip()
                    break
            if child_reason is not None:
                with_reason += 1
                notes.append(f"{body} \u2014 {child_reason}")
            else:
                without_reason += 1
        return (with_reason, without_reason, notes)

    def _create_step_log(self, step: int, command: str, execution_result: Dict[str, Any]) -> str:
        """
        Create a detailed log file for a step.

        Args:
            step: Step number
            command: The command that was executed
            execution_result: Result from CLI executor

        Returns:
            Path to the created log file
        """
        log_file = self.orchestration_log_dir / f"step-{step}-{command.replace('/', '')}.json"

        log_data = {
            "orchestration_id": self.orchestration_id,
            "step": step,
            "command": command,
            **execution_result
        }

        with open(log_file, 'w') as f:
            json.dump(log_data, f, indent=2)

        logger.info(f"Created step log: {log_file}")
        return str(log_file).replace("\\", "/")

    def _create_orchestration_log(
        self,
        spec_names: List[str],
        results: List[StepResult],
        total_time: float,
        success: bool
    ) -> str:
        """
        Create the main orchestration log file.

        Args:
            spec_names: List of generated spec directory names
            results: List of step results
            total_time: Total execution time
            success: Overall success status

        Returns:
            Path to the orchestration log file
        """
        log_file = self.orchestration_log_dir / "orchestration.json"

        log_data = {
            "orchestration_id": self.orchestration_id,
            "success": success,
            "spec_names": spec_names,
            "spec_intents": [intent.model_dump() for intent in self.request.spec_intents],
            "project_dir": str(self.project_dir).replace("\\", "/"),
            "total_execution_time_seconds": total_time,
            "timestamp": datetime.now().isoformat(),
            "steps": [r.model_dump() for r in results]
        }

        with open(log_file, 'w') as f:
            json.dump(log_data, f, indent=2)

        logger.info(f"Created orchestration log: {log_file}")
        return str(log_file).replace("\\", "/")

    def _create_error_log(self, error_message: str, total_time: float) -> str:
        """
        Create an error log file.

        Args:
            error_message: The error message
            total_time: Total execution time before error

        Returns:
            Path to the error log file
        """
        log_file = self.orchestration_log_dir / "error.json"

        log_data = {
            "orchestration_id": self.orchestration_id,
            "success": False,
            "error": error_message,
            "total_execution_time_seconds": total_time,
            "timestamp": datetime.now().isoformat()
        }

        with open(log_file, 'w') as f:
            json.dump(log_data, f, indent=2)

        logger.error(f"Created error log: {log_file}")
        return str(log_file).replace("\\", "/")

    # ------------------------------------------------------------------
    # V2 brain-only workflow (write-spec + create-tasks, no implement)
    # ------------------------------------------------------------------

    BRAIN_COMMANDS = [
        {"step": 1, "command": "/write-spec", "description": "Write specification"},
        {"step": 2, "command": "/create-tasks", "description": "Create task list"},
    ]

    def run_brain_workflow(self) -> OrchestrationV2Response:
        """Execute write-spec + create-tasks only, then return implementation packages."""
        start_time = datetime.now()
        all_results: List[StepResult] = []
        spec_names_generated: List[str] = []
        session_ids: Dict[str, str] = {}
        packages: list[ImplementationPackage] = []

        try:
            # Single shared executor using the active session.
            # Backend selected via CHAT_EXECUTOR env var (default: claude).
            # session_uuid forwarded as ctor arg — no post-construction
            # mutation (was O4' regression; see pass-2 findings).
            chat_executor = _build_chat_executor(
                company=self.request.company,
                project=self.request.project,
                workspace_dir=self.workspace_dir,
                anthropic_api_key=self.anthropic_api_key,
                session_uuid=self.session_id,
            )
            # Parallel-worktrees D13: forward the job runner's pid-tracking
            # callback so the CLI subprocess tree is a killable, job-owned
            # handle (cancel watchdog). Optional attribute — absent outside
            # the job queue.
            if getattr(self, "on_spawn", None):
                chat_executor.on_spawn = self.on_spawn

            for spec_idx, spec_intent in enumerate(self.request.spec_intents):
                spec_name = spec_intent.spec_name
                logger.info(f"[v2] Processing spec {spec_idx + 1}/{len(self.request.spec_intents)}: {spec_name}")

                spec_names_generated.append(spec_name)
                session_ids[spec_name] = self.session_id or chat_executor.session_uuid

                # Pre-check
                spec_dir = self.project_dir / "haikai" / "specs" / spec_name
                requirements_file = spec_dir / "planning" / "requirements.md"
                initialization_file = spec_dir / "planning" / "initialization.md"

                pre_check_error = None
                if not spec_dir.exists():
                    pre_check_error = f"Spec folder not found: haikai/specs/{spec_name}. Run /shape-spec first."
                elif not requirements_file.exists():
                    pre_check_error = f"Requirements not found for {spec_name}. Run /shape-spec first."
                elif not initialization_file.exists():
                    pre_check_error = f"initialization.md missing for {spec_name}. Run /shape-spec first."

                if pre_check_error:
                    logger.error(pre_check_error)
                    all_results.append(StepResult(
                        step=0, command="pre-check", status="failure", output_paths=[],
                        execution_time_seconds=0,
                        log_file=self._create_step_log(0, "pre-check", {
                            "success": False, "stdout": "", "stderr": pre_check_error,
                            "execution_time": 0, "timestamp": datetime.now().isoformat()
                        }),
                        error_message=pre_check_error,
                    ))
                    if self.request.options.stop_on_error:
                        break
                    continue

                # Execute write-spec and create-tasks only
                spec_failed = False
                for cmd_def in self.BRAIN_COMMANDS:
                    step_result = self._execute_step_with_retry(
                        chat_executor=chat_executor,
                        step=cmd_def["step"],
                        command=cmd_def["command"],
                        spec_name=spec_name,
                    )
                    all_results.append(step_result)
                    if step_result.status == "failure":
                        spec_failed = True
                        if self.request.options.stop_on_error:
                            break

                # Build implementation package for this spec (even partial)
                if not spec_failed:
                    pkg = self._build_implementation_package(spec_name)
                    if pkg:
                        packages.append(pkg)

                if self.request.options.stop_on_error and spec_failed:
                    break

            end_time = datetime.now()
            total_time = (end_time - start_time).total_seconds()
            success = all(r.status == "success" for r in all_results)
            orchestration_log = self._create_orchestration_log(
                spec_names=spec_names_generated, results=all_results,
                total_time=total_time, success=success,
            )

            return OrchestrationV2Response(
                success=success,
                spec_names=spec_names_generated,
                session_ids=session_ids,
                results=all_results,
                total_execution_time_seconds=total_time,
                orchestration_log=orchestration_log,
                implementation_packages=packages,
            )

        except Exception as e:
            logger.error(f"[v2] Orchestration failed: {e}", exc_info=True)
            end_time = datetime.now()
            total_time = (end_time - start_time).total_seconds()
            error_log = self._create_error_log(str(e), total_time)
            return OrchestrationV2Response(
                success=False, spec_names=spec_names_generated,
                session_ids=session_ids, results=all_results,
                total_execution_time_seconds=total_time,
                orchestration_log=error_log,
                implementation_packages=packages,
            )

    def _build_implementation_package(self, spec_name: str) -> ImplementationPackage | None:
        """Build a portable implementation package for a single spec.

        Skill artifact paths and the invocation hint are rendered per
        the active backend (see `api.BACKEND_REGISTRY`). A user with
        `CHAT_EXECUTOR=kiro` receives `.kiro/skills/...` and a
        kiro-cli invocation, not the Claude-flavored defaults.
        """
        from .backend_registry import _active_backend
        backend = _active_backend()
        skill_rel = backend.skill_relpath("implement-tasks")

        spec_dir = self.project_dir / "haikai" / "specs" / spec_name
        files: list[ImplementationPackageFile] = []

        # Spec artifacts
        artifact_paths = [
            ("planning/requirements.md", spec_dir / "planning" / "requirements.md"),
            ("planning/initialization.md", spec_dir / "planning" / "initialization.md"),
            ("spec.md", spec_dir / "spec.md"),
            ("tasks.md", spec_dir / "tasks.md"),
        ]

        for rel, abs_path in artifact_paths:
            if abs_path.exists():
                try:
                    content = abs_path.read_text(encoding="utf-8")
                    files.append(ImplementationPackageFile(
                        path=f"haikai/specs/{spec_name}/{rel}",
                        content=content,
                    ))
                except Exception as exc:
                    logger.warning(f"Could not read {abs_path}: {exc}")

        # implement-tasks skill template (per-backend filename)
        skill_path = self.project_dir / skill_rel
        if skill_path.exists():
            try:
                content = skill_path.read_text(encoding="utf-8")
                files.append(ImplementationPackageFile(
                    path=skill_rel,
                    content=content,
                ))
            except Exception as exc:
                logger.warning(f"Could not read {skill_rel}: {exc}")

        if not files:
            return None

        return ImplementationPackage(
            spec_name=spec_name,
            company=self.request.company,
            project=self.request.project,
            files=files,
            instructions=(
                f"Extract into your project root and run: "
                f"{backend.invocation_hint('implement-tasks', spec_name)}"
            ),
        )
