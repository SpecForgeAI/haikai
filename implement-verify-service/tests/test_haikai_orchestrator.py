"""
Unit tests for Haikai Orchestrator.

Tests request validation, CLI execution, and workflow management.
"""

import platform
import pytest
import json
import tempfile
import shutil
from pathlib import Path
from unittest.mock import Mock, patch, MagicMock
from datetime import datetime

# Warm platform's process-global uname cache BEFORE any test patches
# subprocess.Popen: on Windows the FIRST platform.system() call shells out
# (subprocess → `with Popen(...)`), so under a Mocked Popen it explodes with
# "'Mock' object does not support the context manager protocol". Full-suite
# runs were green only because an earlier test warmed the cache;
# standalone/subset runs of TestClaudeCLIExecutor failed (order-dependent).
platform.system()


# Stale: written 2026-02-21. The OrchestrationResponse pydantic model and
# the haikai prompt content (`Implement all tasks without prompting`)
# have drifted. Quarantine per fix/260504-1127-full-repo-green; needs
# revision against current OrchestrationResponse schema and prompts.
_DRIFT_REASON = (
    "Stale since 2026-02-21 (OrchestrationResponse schema + prompt drift); "
    "needs revision per fix/260504-1127-full-repo-green"
)

from src.haikai_models import (
    OrchestrationRequest,
    OrchestrationResponse,
    StepResult,
    OrchestrationOptions,
    SpecIntent
)
from src.haikai_orchestrator import HaikaiOrchestrator

try:
    from src.claude_cli_executor import ClaudeCLIExecutor
except (ImportError, ModuleNotFoundError):
    ClaudeCLIExecutor = None


@pytest.fixture
def test_project_dir():
    """Create a temporary test project directory."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def test_workspace_dir():
    """Create a temporary workspace directory."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def test_logs_dir():
    """Create a temporary logs directory."""
    temp_dir = tempfile.mkdtemp()
    yield temp_dir
    shutil.rmtree(temp_dir, ignore_errors=True)


def make_spec_intent(spec_name, session_id="91c30231-cf7a-51e4-ba3f-585e5e1694d7"):
    """Helper to create a SpecIntent for tests."""
    return SpecIntent(spec_name=spec_name, session_id=session_id)


class TestOrchestrationModels:
    """Test Pydantic models for request/response validation."""

    def test_orchestration_request_valid(self):
        """Test valid orchestration request."""
        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("2026-02-20-user-auth")]
        )

        assert request.company == "acme"
        assert request.project == "backend"
        assert request.spec_intents[0].spec_name == "2026-02-20-user-auth"
        assert request.spec_intents[0].session_id == "91c30231-cf7a-51e4-ba3f-585e5e1694d7"
        assert request.context_files is None
        assert request.options.stop_on_error is True

    def test_orchestration_request_with_options(self):
        """Test orchestration request with custom options."""
        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("2026-02-20-dashboard-charts")],
            context_files=["docs/charts.md"],
            options=OrchestrationOptions(
                stop_on_error=False,
                retry_on_failure=True,
                max_retries=3
            )
        )

        assert request.options.stop_on_error is False
        assert request.options.retry_on_failure is True
        assert request.options.max_retries == 3

    def test_orchestration_request_invalid_empty_intents(self):
        """Test that empty spec_intents are rejected."""
        with pytest.raises(ValueError):
            OrchestrationRequest(
                company="acme",
                project="backend",
                spec_intents=[]
            )

    def test_orchestration_request_invalid_short_spec_name(self):
        """Test that spec_intents with short spec_name are rejected."""
        with pytest.raises(ValueError):
            OrchestrationRequest(
                company="acme",
                project="backend",
                spec_intents=[SpecIntent(spec_name="ab", session_id="test-session-uuid")]
            )

    def test_orchestration_request_invalid_short_session_id(self):
        """Test that spec_intents with non-UUID session_id are rejected."""
        with pytest.raises(ValueError):
            OrchestrationRequest(
                company="acme",
                project="backend",
                spec_intents=[SpecIntent(spec_name="valid-spec-name", session_id="ab")]
            )

    def test_step_result_creation(self):
        """Test StepResult model."""
        result = StepResult(
            step=1,
            command="/write-spec",
            status="success",
            output_paths=["/app/workspace/spec.md"],
            execution_time_seconds=45.2,
            log_file="/app/logs/step-1.json"
        )

        assert result.step == 1
        assert result.command == "/write-spec"
        assert result.status == "success"
        assert result.error_message is None


@pytest.mark.skipif(ClaudeCLIExecutor is None, reason="ClaudeCLIExecutor requires Unix (pwd module)")
class TestClaudeCLIExecutor:
    """Test Claude CLI executor functionality."""

    # Parallel-worktrees D13: execution moved from blocking subprocess.run to
    # Popen + communicate so the spawned tree is a tracked, killable handle.
    # The fakes below mirror that contract (pid, communicate, returncode).

    @staticmethod
    def _fake_popen(returncode=0, stdout='{"success": true}', stderr=''):
        proc = Mock()
        proc.pid = 4242
        proc.returncode = returncode
        proc.communicate.return_value = (stdout, stderr)
        return proc

    @patch('subprocess.Popen')
    def test_execute_success(self, mock_popen, test_project_dir):
        """Test successful command execution."""
        mock_popen.return_value = self._fake_popen(0)

        executor = ClaudeCLIExecutor(
            project_dir=test_project_dir,
            anthropic_api_key="test-key"
        )

        result = executor.execute("/write-spec")

        assert result["success"] is True
        assert result["return_code"] == 0
        assert "execution_time" in result
        mock_popen.assert_called_once()

    @patch('subprocess.Popen')
    def test_execute_failure(self, mock_popen, test_project_dir):
        """Test failed command execution."""
        mock_popen.return_value = self._fake_popen(1, stdout='',
                                                   stderr='Command failed')

        executor = ClaudeCLIExecutor(
            project_dir=test_project_dir,
            anthropic_api_key="test-key"
        )

        result = executor.execute("/write-spec")

        assert result["success"] is False
        assert result["return_code"] == 1
        assert "Command failed" in result["stderr"]

    @patch('subprocess.Popen')
    def test_execute_with_system_prompt(self, mock_popen, test_project_dir):
        """Test command execution with system prompt.

        Drift: the prompt is piped via stdin — now `communicate(input=...)`
        under the Popen contract (was subprocess.run's `input` kwarg)."""
        proc = self._fake_popen(0)
        mock_popen.return_value = proc

        executor = ClaudeCLIExecutor(
            project_dir=test_project_dir,
            anthropic_api_key="test-key"
        )

        executor.execute(
            "/implement-tasks",
            system_prompt="Implement all tasks without prompting"
        )

        prompt_via_stdin = proc.communicate.call_args.kwargs["input"]
        assert "Implement all tasks without prompting" in prompt_via_stdin
        assert "/implement-tasks" in prompt_via_stdin

    @patch('subprocess.Popen')
    def test_execute_notifies_on_spawn_with_pid(self, mock_popen, test_project_dir):
        """D13: the tracked-handle callback fires with the spawned pid."""
        mock_popen.return_value = self._fake_popen(0)
        executor = ClaudeCLIExecutor(
            project_dir=test_project_dir,
            anthropic_api_key="test-key"
        )
        seen = []
        executor.on_spawn = seen.append
        executor.execute("/write-spec")
        assert seen == [4242]


class TestHaikaiOrchestrator:
    """Test Haikai orchestrator workflow management."""

    def test_spec_name_from_intent(self, test_workspace_dir, test_logs_dir):
        """Test that spec_name comes directly from SpecIntent."""
        # Create project dir
        project_dir = Path(test_workspace_dir) / "acme" / "backend"
        project_dir.mkdir(parents=True)

        test_uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("2026-02-20-user-auth", test_uuid)]
        )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key="test-key",
            workspace_dir=test_workspace_dir,
            logs_dir=test_logs_dir
        )

        assert orchestrator.request.spec_intents[0].spec_name == "2026-02-20-user-auth"
        assert orchestrator.request.spec_intents[0].session_id == test_uuid

    def test_determine_output_paths(self, test_workspace_dir, test_logs_dir):
        """Test output path determination for each step."""
        project_dir = Path(test_workspace_dir) / "acme" / "backend"
        project_dir.mkdir(parents=True)

        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("add-search-feature")]
        )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key="test-key",
            workspace_dir=test_workspace_dir,
            logs_dir=test_logs_dir
        )

        # Step 1: write-spec
        paths = orchestrator._determine_output_paths(1, "add-search-feature")
        assert any("spec.md" in p for p in paths)

    @patch('src.api.factories.ClaudeChatExecutor')
    @patch.object(HaikaiOrchestrator, '_execute_step_with_session')
    def test_run_workflow_success(self, mock_execute, mock_chat_executor, test_workspace_dir, test_logs_dir):
        """Test successful workflow execution.

        Drift: `OrchestrationResponse.session_ids` is now a strict
        `Dict[str, str]`. The orchestrator falls back to
        `chat_executor.session_uuid` if no `session_id` was passed in,
        so the mocked executor must expose a real string there (a bare
        MagicMock fails Pydantic validation)."""
        # Create spec folder with requirements.md and initialization.md so validation passes
        planning_dir = Path(test_workspace_dir) / "acme" / "backend" / "haikai" / "specs" / "build-user-registration" / "planning"
        planning_dir.mkdir(parents=True)
        (planning_dir / "requirements.md").write_text("# Build User Registration\n\nRequirements.", encoding='utf-8')
        (planning_dir / "initialization.md").write_text("# Build User Registration\n\nOriginal description.", encoding='utf-8')

        mock_chat_executor.return_value.session_uuid = "test-uuid-success-1234"

        mock_execute.return_value = StepResult(
            step=1,
            command="/write-spec",
            status="success",
            output_paths=["/app/workspace/spec.md"],
            execution_time_seconds=30.0,
            log_file="/app/logs/step-1.json"
        )

        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("build-user-registration")]
        )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key="test-key",
            workspace_dir=test_workspace_dir,
            logs_dir=test_logs_dir
        )

        response = orchestrator.run_workflow()

        assert isinstance(response, OrchestrationResponse)

    def test_missing_spec_folder_fails(self, test_workspace_dir, test_logs_dir):
        """Test that orchestrator fails when spec folder doesn't exist (never creates it)."""
        # Create the project dir but NOT the spec folder
        project_dir = Path(test_workspace_dir) / "acme" / "backend"
        project_dir.mkdir(parents=True)

        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("nonexistent-spec")]
        )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key="test-key",
            workspace_dir=test_workspace_dir,
            logs_dir=test_logs_dir
        )

        response = orchestrator.run_workflow()

        assert response.success is False
        assert len(response.results) == 1
        assert response.results[0].step == 0
        assert response.results[0].status == "failure"
        assert "Spec folder not found" in response.results[0].error_message
        assert "/shape-spec first" in response.results[0].error_message

        # Critical: verify no folder was created
        spec_dir = Path(test_workspace_dir) / "acme" / "backend" / "haikai" / "specs" / "nonexistent-spec"
        assert not spec_dir.exists(), "Orchestrator must NOT create spec folders"

    def test_missing_requirements_file_fails(self, test_workspace_dir, test_logs_dir):
        """Test that orchestrator fails when requirements.md is missing."""
        # Create spec folder but NOT requirements.md
        spec_dir = Path(test_workspace_dir) / "acme" / "backend" / "haikai" / "specs" / "my-feature"
        spec_dir.mkdir(parents=True)

        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("my-feature")]
        )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key="test-key",
            workspace_dir=test_workspace_dir,
            logs_dir=test_logs_dir
        )

        response = orchestrator.run_workflow()

        assert response.success is False
        assert len(response.results) == 1
        assert response.results[0].step == 0
        assert response.results[0].status == "failure"
        assert "Requirements not found" in response.results[0].error_message
        assert "/shape-spec first" in response.results[0].error_message

    def test_missing_initialization_file_fails(self, test_workspace_dir, test_logs_dir):
        """Test that orchestrator fails when initialization.md is missing (not from shape-spec)."""
        # Create spec folder with requirements.md but NO initialization.md
        planning_dir = Path(test_workspace_dir) / "acme" / "backend" / "haikai" / "specs" / "manual-spec" / "planning"
        planning_dir.mkdir(parents=True)
        (planning_dir / "requirements.md").write_text("# Manual Spec\n\nSome requirements.", encoding='utf-8')

        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("manual-spec")]
        )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key="test-key",
            workspace_dir=test_workspace_dir,
            logs_dir=test_logs_dir
        )

        response = orchestrator.run_workflow()

        assert response.success is False
        assert len(response.results) == 1
        assert response.results[0].step == 0
        assert response.results[0].command == "pre-check"
        assert response.results[0].status == "failure"
        assert "initialization.md" in response.results[0].error_message
        assert "fully shaped" in response.results[0].error_message

    @patch('src.api.factories.ClaudeChatExecutor')
    @patch.object(HaikaiOrchestrator, '_execute_step_with_session')
    def test_existing_spec_proceeds_to_execute(self, mock_execute, mock_chat_executor, test_workspace_dir, test_logs_dir):
        """Test that orchestrator proceeds when spec folder, requirements.md, and initialization.md exist."""
        # Create spec folder WITH requirements.md AND initialization.md (shape-spec provenance)
        planning_dir = Path(test_workspace_dir) / "acme" / "backend" / "haikai" / "specs" / "real-feature" / "planning"
        planning_dir.mkdir(parents=True)
        (planning_dir / "requirements.md").write_text("# Real Feature\n\nDetailed requirements here.", encoding='utf-8')
        (planning_dir / "initialization.md").write_text("# Real Feature\n\nUser's original description.", encoding='utf-8')

        # Pydantic Dict[str, str] requires a real string for session_uuid.
        mock_chat_executor.return_value.session_uuid = "test-uuid-proceed-5678"

        mock_execute.return_value = StepResult(
            step=1,
            command="/write-spec",
            status="success",
            output_paths=[],
            execution_time_seconds=10.0,
            log_file="/tmp/test-log.json"
        )

        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("real-feature")]
        )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key="test-key",
            workspace_dir=test_workspace_dir,
            logs_dir=test_logs_dir
        )

        response = orchestrator.run_workflow()

        # _execute_step_with_session should have been called (we got past the existence checks)
        assert mock_execute.called
        # No step-0 validation failures
        step0_results = [r for r in response.results if r.step == 0]
        assert len(step0_results) == 0

    def _make_specs(self, ws, *names):
        for n in names:
            pdir = Path(ws) / "acme" / "backend" / "haikai" / "specs" / n / "planning"
            pdir.mkdir(parents=True)
            (pdir / "requirements.md").write_text("# r", encoding="utf-8")
            (pdir / "initialization.md").write_text("# i", encoding="utf-8")

    @staticmethod
    def _step(status, n):
        return StepResult(step=n, command="/x", status=status, output_paths=[],
                          execution_time_seconds=1.0, log_file="x")

    @patch('src.api.factories.ClaudeChatExecutor')
    @patch.object(HaikaiOrchestrator, '_execute_step_with_session')
    def test_on_spec_complete_skipped_for_half_generated_spec(self, mock_execute, mock_chat_executor, test_workspace_dir, test_logs_dir):
        """L5: with stop_on_error=False, a spec whose REQUIRED step failed must NOT
        get on_spec_complete — no branch/PR for a half-generated spec."""
        self._make_specs(test_workspace_dir, "spec-one", "spec-two")
        mock_chat_executor.return_value.session_uuid = "u-1234567890"
        # spec-one: steps 1-4 ok; spec-two: 1,2 ok, 3 (implement, REQUIRED) fails, 4 ok
        mock_execute.side_effect = [
            self._step("success", 1), self._step("success", 2), self._step("success", 3), self._step("success", 4),
            self._step("success", 1), self._step("success", 2), self._step("failure", 3), self._step("success", 4),
        ]
        request = OrchestrationRequest(
            company="acme", project="backend",
            spec_intents=[make_spec_intent("spec-one"), make_spec_intent("spec-two")],
            options=OrchestrationOptions(stop_on_error=False),
        )
        orchestrator = HaikaiOrchestrator(request=request, anthropic_api_key="k",
                                           workspace_dir=test_workspace_dir, logs_dir=test_logs_dir)
        committed = []
        orchestrator.run_workflow(on_spec_complete=lambda name, idx: committed.append(name) or False)
        assert committed == ["spec-one"]  # spec-two failed a required step -> not committed

    @patch('src.api.factories.ClaudeChatExecutor')
    @patch.object(HaikaiOrchestrator, '_execute_step_with_session')
    def test_git_failure_halts_further_generation(self, mock_execute, mock_chat_executor, test_workspace_dir, test_logs_dir):
        """L4: on_spec_complete returning True (git failed) halts generation of later
        specs under stop_on_error — run_workflow otherwise only watches step results."""
        self._make_specs(test_workspace_dir, "spec-one", "spec-two")
        mock_chat_executor.return_value.session_uuid = "u-1234567890"
        mock_execute.side_effect = [self._step("success", n) for n in (1, 2, 3, 4)] * 2
        request = OrchestrationRequest(
            company="acme", project="backend",
            spec_intents=[make_spec_intent("spec-one"), make_spec_intent("spec-two")],
            options=OrchestrationOptions(stop_on_error=True),
        )
        orchestrator = HaikaiOrchestrator(request=request, anthropic_api_key="k",
                                           workspace_dir=test_workspace_dir, logs_dir=test_logs_dir)
        seen = []
        orchestrator.run_workflow(on_spec_complete=lambda name, idx: seen.append(name) or True)
        assert seen == ["spec-one"]            # stopped after spec-one's git failure
        # spec-one runs steps 1-3 (step 4 is final-spec-only, 2026-07-30);
        # spec-two's steps never ran.
        assert mock_execute.call_count == 3

    @patch('src.api.factories.ClaudeChatExecutor')
    @patch.object(HaikaiOrchestrator, '_execute_step_with_session')
    def test_run_workflow_with_failure_stop_on_error(self, mock_execute, mock_chat_executor, test_workspace_dir, test_logs_dir):
        """Test workflow stops on error when stop_on_error is True."""
        # Create spec folder with requirements.md and initialization.md so validation passes
        planning_dir = Path(test_workspace_dir) / "acme" / "backend" / "haikai" / "specs" / "build-feature" / "planning"
        planning_dir.mkdir(parents=True)
        (planning_dir / "requirements.md").write_text("# Build Feature\n\nSome requirements.", encoding='utf-8')
        (planning_dir / "initialization.md").write_text("# Build Feature\n\nOriginal description.", encoding='utf-8')

        mock_chat_executor.return_value.session_uuid = "test-uuid-stop-9012"

        mock_execute.return_value = StepResult(
            step=1,
            command="/write-spec",
            status="failure",
            output_paths=[],
            execution_time_seconds=5.0,
            log_file="/app/logs/step-1.json",
            error_message="Spec generation failed"
        )

        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("build-feature")],
            options=OrchestrationOptions(stop_on_error=True)
        )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key="test-key",
            workspace_dir=test_workspace_dir,
            logs_dir=test_logs_dir
        )

        response = orchestrator.run_workflow()

        assert response.success is False

    # Patch at the call site (`src.api.factories.ClaudeChatExecutor`):
    # the orchestrator's chat factory routes through the registry's
    # shim which lazily calls `_build_claude_chat_executor`, which
    # resolves `ClaudeChatExecutor` via its own module binding in
    # `src.api.factories`. Patching the re-export in `src.api` does
    # NOT reach the factory's binding (CO1 lesson, A.1 lesson).
    @patch('src.api.factories.ClaudeChatExecutor')
    @patch.object(HaikaiOrchestrator, '_execute_step_with_session')
    def test_session_id_passed_to_executor(self, mock_execute, mock_chat_executor_cls, test_workspace_dir, test_logs_dir):
        """Test that the session_id passed to the orchestrator is forwarded to the chat executor.

        Drift: the active session is now an orchestrator-level construct
        (`HaikaiOrchestrator(..., session_id=...)`), not metadata on each
        SpecIntent. The orchestrator forwards `self.session_id` as the
        `session_uuid` ctor kwarg of the chat executor (was a post-
        construction mutation pre-pass-2 O4' fix)."""
        # Create spec folder with full provenance
        planning_dir = Path(test_workspace_dir) / "acme" / "backend" / "haikai" / "specs" / "my-spec" / "planning"
        planning_dir.mkdir(parents=True)
        (planning_dir / "requirements.md").write_text("# My Spec\n\nRequirements.", encoding='utf-8')
        (planning_dir / "initialization.md").write_text("# My Spec\n\nOriginal.", encoding='utf-8')

        mock_executor_instance = MagicMock()
        mock_chat_executor_cls.return_value = mock_executor_instance

        mock_execute.return_value = StepResult(
            step=1,
            command="/write-spec",
            status="success",
            output_paths=[],
            execution_time_seconds=10.0,
            log_file="/tmp/test-log.json"
        )

        session_uuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        request = OrchestrationRequest(
            company="acme",
            project="backend",
            spec_intents=[make_spec_intent("my-spec", session_uuid)]
        )

        orchestrator = HaikaiOrchestrator(
            request=request,
            anthropic_api_key="test-key",
            workspace_dir=test_workspace_dir,
            logs_dir=test_logs_dir,
            session_id=session_uuid,
        )

        orchestrator.run_workflow()

        mock_chat_executor_cls.assert_called_once()
        # Orchestrator must forward session_id as the session_uuid ctor kwarg
        # (NOT mutate it after construction — that was the O4' Temporary Field
        # smell closed by the pass-2 cheap-commit bundle).
        ctor_kwargs = mock_chat_executor_cls.call_args.kwargs
        assert ctor_kwargs.get("session_uuid") == session_uuid
