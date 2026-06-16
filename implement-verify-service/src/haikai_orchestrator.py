"""
Haikai Orchestrator for automated workflow execution.

This module provides the main orchestration logic for running Haikai workflows
(write-spec, create-tasks, implement-tasks) without user interaction.
"""

import logging
import json
import os
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Callable, Union

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
                if start_from_step > 1:
                    logger.info(f"Spec '{spec_name}' - Resuming from step {start_from_step}, skipping {start_from_step - 1} step(s)")

                non_fatal_steps = {c["step"] for c in self.COMMANDS if c.get("non_fatal")}
                spec_start = len(all_results)  # this spec's results begin here
                for cmd_def in commands_to_run:
                    step = cmd_def["step"]
                    command = cmd_def["command"]
                    description = cmd_def["description"]

                    logger.info(f"Spec '{spec_name}' - Step {step}: {description} - Executing {command}")

                    # Execute command using the shape-spec session
                    step_result = self._execute_step_with_session(
                        chat_executor=chat_executor,
                        step=step,
                        command=command,
                        spec_name=spec_name
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

            return OrchestrationResponse(
                success=success,
                spec_names=spec_names_generated,
                session_ids=session_ids,
                results=all_results,
                total_execution_time_seconds=total_time,
                orchestration_log=orchestration_log
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

    def _execute_step_with_session(
        self,
        chat_executor,  # ClaudeChatExecutor or KiroChatExecutor (CHAT_EXECUTOR-selected)
        step: int,
        command: str,
        spec_name: str
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
                command_name=command_name
            ):
                event_type = event.get("type")
                if event_type == "content":
                    collected_content.append(event.get("delta", ""))
                elif event_type == "error":
                    errors.append(event.get("message", ""))
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
        # Step 3 (implement-tasks) writes verification-report.md only on
        # successful completion, so this catches partial failures there too.
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
            "session_id": chat_executor.session_uuid
        }

        # Create step log file
        log_file = self._create_step_log(step, command, execution_result)

        # Persist session to spec folder after each step
        try:
            chat_executor.persist_session_to_spec(spec_name)
        except Exception as e:
            logger.warning(f"Failed to persist session after step {step}: {e}")

        # Build step result
        return StepResult(
            step=step,
            command=command,
            status="success" if success else "failure",
            output_paths=output_paths,
            execution_time_seconds=execution_time,
            log_file=log_file,
            error_message="\n".join(errors) if errors else None
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
            # implement-tasks writes the verification report at
            # verification/final-verification.md (see the
            # create-verification-report workflow). Previously this asserted
            # verification-report.md at the spec root, which neither the
            # skill nor Claude actually produces — yielding false-positive
            # "step 3 failed" verdicts.
            return [str(spec_dir / "verification" / "final-verification.md").replace("\\", "/")]

        return []

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
                    step_result = self._execute_step_with_session(
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
