"""Unit tests for ClaudeChatExecutor stream_message helpers.

Per haikai/specs/2026-05-18-api-and-stream-modularize/spec.md (Phase B.1):
the three pre-spawn helpers — `_build_streaming_prompt`,
`_build_cli_command`, `_build_env_vars` — are pure (or near-pure)
functions that should be independently testable so the larger
`stream_message` body shrinks without losing coverage.

Required by spec R4: "Add tests BEFORE extracting; assert each helper's
contract independently."
"""
from __future__ import annotations

import os
import platform
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Force test env BEFORE importing the executor (matches other test files)
os.environ.setdefault("STANDARDS_API_KEY", "test-key")
os.environ.setdefault("ANTHROPIC_API_KEY", "sk-ant-test")

from src.chat.claude_chat_executor import (
    ClaudeChatExecutor,
    _StreamLoopState,
)


@pytest.fixture
def executor(tmp_path: Path) -> ClaudeChatExecutor:
    """A minimally-initialized ClaudeChatExecutor with a tmp project_dir."""
    project_dir = tmp_path / "acme" / "backend"
    project_dir.mkdir(parents=True, exist_ok=True)
    # __init__ does session_uuid setup + permissions/commands wiring; we patch
    # those side effects so the constructor doesn't touch the real filesystem
    # beyond `project_dir` itself.
    with patch.object(ClaudeChatExecutor, "_setup_claude_commands"):
        with patch.object(ClaudeChatExecutor, "_create_permissions_settings"):
            ex = ClaudeChatExecutor(
                company="acme",
                project="backend",
                workspace_dir=tmp_path,
                anthropic_api_key="sk-ant-test-key",
            )
    return ex


# ─── _build_streaming_prompt ─────────────────────────────────────────────


class TestBuildStreamingPrompt:
    """Behaviour contract:
    - Resume session, small message: returns message verbatim, no tempfile.
    - New session, small message: prefixes /{command_name}, appends reinforcement.
    - Any session, large message (> MAX_CLI_ARG_LENGTH): writes tempfile,
      replaces prompt with "Read the file ...".
    - New Windows session: appends Windows OS context before /{command_name}.
    """

    def test_resume_small_message_returns_verbatim(self, executor):
        prompt, mf = executor._build_streaming_prompt(
            "Hello", is_new_session=False, command_name="shape-spec"
        )
        assert prompt == "Hello"
        assert mf is None

    def test_new_session_small_message_gets_command_prefix(self, executor):
        prompt, mf = executor._build_streaming_prompt(
            "Build me a thing", is_new_session=True, command_name="shape-spec"
        )
        assert prompt.startswith("/shape-spec Build me a thing")
        assert "MUST ask clarifying questions" in prompt
        assert "/ask-questions" in prompt
        # No tempfile for small message
        assert mf is None

    def test_new_session_respects_command_name_parameter(self, executor):
        prompt, _ = executor._build_streaming_prompt(
            "x", is_new_session=True, command_name="plan-product"
        )
        assert prompt.startswith("/plan-product x")

    @patch("src.chat.claude_chat_executor.platform.system", return_value="Windows")
    def test_new_windows_session_appends_os_context(self, _platform, executor):
        prompt, _ = executor._build_streaming_prompt(
            "x", is_new_session=True, command_name="shape-spec"
        )
        # OS context lands inside the prompt body (between command prefix and reinforcement)
        assert "Running on Windows" in prompt
        assert "powershell" in prompt.lower()

    @patch("src.chat.claude_chat_executor.platform.system", return_value="Linux")
    def test_new_linux_session_skips_os_context(self, _platform, executor):
        prompt, _ = executor._build_streaming_prompt(
            "x", is_new_session=True, command_name="shape-spec"
        )
        assert "Running on Windows" not in prompt

    def test_resume_session_skips_os_context_even_on_windows(self, executor):
        # OS context is new-session-only — even on Windows, a resume must
        # not get the context (would re-inject every turn).
        with patch("src.chat.claude_chat_executor.platform.system", return_value="Windows"):
            prompt, _ = executor._build_streaming_prompt(
                "x", is_new_session=False, command_name="shape-spec"
            )
        assert "Running on Windows" not in prompt

    def test_large_message_writes_tempfile_and_substitutes(self, executor):
        # MAX_CLI_ARG_LENGTH=1000; pick something well above.
        big = "x" * 2000
        prompt, mf = executor._build_streaming_prompt(
            big, is_new_session=False, command_name="shape-spec"
        )
        assert mf is not None and mf.exists()
        assert prompt.startswith("Read the file")
        assert str(mf) in prompt
        # Tempfile is inside project_dir (not /tmp) — security + cleanup invariant
        assert str(mf).startswith(str(executor.project_dir))
        # Original message preserved in tempfile
        assert mf.read_text(encoding="utf-8") == big
        mf.unlink()

    def test_large_message_new_session_prefixes_after_substitution(self, executor):
        big = "x" * 2000
        prompt, mf = executor._build_streaming_prompt(
            big, is_new_session=True, command_name="shape-spec"
        )
        # /command prefix wraps the "Read the file..." substitution
        assert prompt.startswith("/shape-spec Read the file")
        assert "MUST ask clarifying questions" in prompt
        mf.unlink()

    def test_threshold_uses_raw_message_length(self, executor):
        # Exactly at MAX_CLI_ARG_LENGTH boundary (1000): no tempfile.
        at_limit = "x" * executor.MAX_CLI_ARG_LENGTH
        _, mf = executor._build_streaming_prompt(
            at_limit, is_new_session=False, command_name="shape-spec"
        )
        assert mf is None
        # One byte over: tempfile.
        over = "x" * (executor.MAX_CLI_ARG_LENGTH + 1)
        _, mf2 = executor._build_streaming_prompt(
            over, is_new_session=False, command_name="shape-spec"
        )
        assert mf2 is not None
        mf2.unlink()


# ─── _build_cli_command ──────────────────────────────────────────────────


class TestBuildCliCommand:
    """Behaviour contract:
    - First arg is claude_cli_path.
    - Last arg is the prompt verbatim.
    - --session-id used for new sessions, --resume for continuing.
    - Both project_dir and haikai-profiles mounted as --add-dir entries.
    - Required output flags present: --print, --output-format stream-json,
      --include-partial-messages, --verbose.
    """

    def test_first_arg_is_cli_path(self, executor):
        args = executor._build_cli_command("hi", is_new_session=False)
        assert args[0] == str(executor.claude_cli_path)

    def test_last_arg_is_prompt_verbatim(self, executor):
        args = executor._build_cli_command("hi/there", is_new_session=False)
        assert args[-1] == "hi/there"

    def test_new_session_uses_session_id_flag(self, executor):
        args = executor._build_cli_command("x", is_new_session=True)
        assert "--session-id" in args
        # Session UUID immediately follows the flag
        assert args[args.index("--session-id") + 1] == executor.session_uuid
        assert "--resume" not in args

    def test_resume_session_uses_resume_flag(self, executor):
        args = executor._build_cli_command("x", is_new_session=False)
        assert "--resume" in args
        assert args[args.index("--resume") + 1] == executor.session_uuid
        assert "--session-id" not in args

    def test_required_output_flags_present(self, executor):
        args = executor._build_cli_command("x", is_new_session=False)
        # --verbose is required when --print is combined with stream-json
        for flag in ("--print", "--output-format", "stream-json",
                     "--include-partial-messages", "--verbose",
                     "--dangerously-skip-permissions",
                     "--setting-sources", "project"):
            assert flag in args, f"Missing required flag: {flag}"

    def test_add_dir_mounts_project_and_profiles(self, executor):
        args = executor._build_cli_command("x", is_new_session=False)
        add_dir_values = [args[i + 1] for i, a in enumerate(args) if a == "--add-dir"]
        # project_dir is mounted
        assert any(str(executor.project_dir).replace("\\", "/") == v for v in add_dir_values)
        # haikai-profiles is mounted
        assert any("haikai-profiles" in v for v in add_dir_values)


# ─── _build_env_vars ─────────────────────────────────────────────────────


class TestBuildEnvVars:
    """Behaviour contract:
    - Regular API key (sk-ant-...): sets ANTHROPIC_API_KEY only.
    - OAuth token (sk-ant-oat...): sets CLAUDE_CODE_OAUTH_TOKEN, empties
      ANTHROPIC_API_KEY (to avoid Bearer + x-api-key header collision).
    - HAIKAI_PROFILES_PATH defaults to haikai-profiles/ unless the
      caller has already set it in their environment.
    """

    def test_regular_api_key_uses_anthropic_api_key(self, executor):
        executor.anthropic_api_key = "sk-ant-api03-real-key"
        env = executor._build_env_vars()
        assert env["ANTHROPIC_API_KEY"] == "sk-ant-api03-real-key"
        assert "CLAUDE_CODE_OAUTH_TOKEN" not in env

    def test_oauth_token_uses_oauth_env_and_clears_api_key(self, executor):
        executor.anthropic_api_key = "sk-ant-oat01-real-oauth-token"
        env = executor._build_env_vars()
        assert env["CLAUDE_CODE_OAUTH_TOKEN"] == "sk-ant-oat01-real-oauth-token"
        # Critical: must be empty (not absent) — defends against the
        # CLAUDE CLI seeing both Bearer + x-api-key headers.
        assert env["ANTHROPIC_API_KEY"] == ""

    def test_claude_profiles_path_set_when_unset(self, executor):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("HAIKAI_PROFILES_PATH", None)
            env = executor._build_env_vars()
        assert "HAIKAI_PROFILES_PATH" in env
        assert "haikai-profiles" in env["HAIKAI_PROFILES_PATH"]

    def test_claude_profiles_path_preserved_when_caller_sets_it(self, executor):
        with patch.dict(os.environ, {"HAIKAI_PROFILES_PATH": "/custom/profiles"}):
            env = executor._build_env_vars()
        assert env["HAIKAI_PROFILES_PATH"] == "/custom/profiles"


# ─── _spawn_subprocess ───────────────────────────────────────────────────


class TestSpawnSubprocess:
    """Behaviour contract:
    - Centralizes Popen kwargs (cwd, env, stdout=PIPE, stderr=PIPE,
      text=True, bufsize=1, encoding='utf-8', errors='replace').
    - cwd = str(project_dir).
    - env is built fresh from _build_env_vars() on every call.
    """

    def test_spawn_passes_standard_kwargs(self, executor):
        with patch("src.chat.claude_chat_executor.subprocess.Popen") as mock_popen:
            executor._spawn_subprocess(["/usr/bin/claude", "--print", "hi"])

        mock_popen.assert_called_once()
        args, kwargs = mock_popen.call_args
        # Positional cli_args
        assert args[0] == ["/usr/bin/claude", "--print", "hi"]
        # All standard kwargs present
        assert kwargs["cwd"] == str(executor.project_dir)
        assert kwargs["stdout"].__class__ is type(__import__("subprocess").PIPE)  # PIPE constant
        assert kwargs["stderr"].__class__ is type(__import__("subprocess").PIPE)
        assert kwargs["text"] is True
        assert kwargs["bufsize"] == 1
        assert kwargs["encoding"] == "utf-8"
        assert kwargs["errors"] == "replace"
        # env carries ANTHROPIC_API_KEY (built fresh from _build_env_vars)
        assert "ANTHROPIC_API_KEY" in kwargs["env"]

    def test_spawn_builds_env_per_call(self, executor):
        # Mutating the api key between calls should be reflected — proves
        # env is built fresh each invocation, not cached at __init__.
        with patch("src.chat.claude_chat_executor.subprocess.Popen") as mock_popen:
            executor.anthropic_api_key = "sk-ant-key-A"
            executor._spawn_subprocess(["a"])
            executor.anthropic_api_key = "sk-ant-key-B"
            executor._spawn_subprocess(["b"])

        assert mock_popen.call_count == 2
        env_call1 = mock_popen.call_args_list[0].kwargs["env"]
        env_call2 = mock_popen.call_args_list[1].kwargs["env"]
        assert env_call1["ANTHROPIC_API_KEY"] == "sk-ant-key-A"
        assert env_call2["ANTHROPIC_API_KEY"] == "sk-ant-key-B"


# ─── _iter_stream_events ─────────────────────────────────────────────────


class TestIterStreamEvents:
    """Behaviour contract:
    - Strips and skips empty lines.
    - JSON-parses each non-empty line; skips non-dict payloads.
    - Logs + yields error event on JSONDecodeError (instead of raising).
    - Treats None stdout as empty (no iteration).
    """

    def test_strips_and_skips_blank_lines(self):
        stdout = iter(['', '   ', '{"type": "x"}\n', '\n'])
        events = list(ClaudeChatExecutor._iter_stream_events(stdout))
        assert events == [{"type": "x"}]

    def test_skips_non_dict_payloads(self):
        # Valid JSON but not an object → skipped, no yield.
        stdout = iter(['[1,2,3]', '"a-string"', 'null', '42', '{"type": "ok"}'])
        events = list(ClaudeChatExecutor._iter_stream_events(stdout))
        assert events == [{"type": "ok"}]

    def test_invalid_json_yields_error_event(self):
        stdout = iter(['not-json-at-all', '{"type": "ok"}'])
        events = list(ClaudeChatExecutor._iter_stream_events(stdout))
        assert len(events) == 2
        assert events[0]["type"] == "error"
        assert "Invalid JSON" in events[0]["message"]
        assert events[1] == {"type": "ok"}

    def test_none_stdout_is_empty(self):
        events = list(ClaudeChatExecutor._iter_stream_events(None))
        assert events == []


# ─── _detect_folder_in_text ──────────────────────────────────────────────


class TestDetectFolderInText:
    """Behaviour contract:
    - Sets state.folder_buffer from `haikai/specs/<slug>` references (Unix slashes).
    - Sets state.folder_buffer from `haikai\\specs\\<slug>` references (Windows backslashes).
    - Does NOT overwrite an existing folder_buffer.
    - Slug stops at whitespace, slash, or backtick.
    """

    def test_unix_path_detected(self):
        state = _StreamLoopState()
        ClaudeChatExecutor._detect_folder_in_text(
            "I'll create haikai/specs/2026-05-20-foo/spec.md",
            state,
        )
        assert state.folder_buffer == "2026-05-20-foo"

    def test_windows_path_detected(self):
        state = _StreamLoopState()
        ClaudeChatExecutor._detect_folder_in_text(
            "Writing to haikai\\specs\\2026-05-20-bar\\spec.md",
            state,
        )
        assert state.folder_buffer == "2026-05-20-bar"

    def test_existing_folder_not_overwritten(self):
        state = _StreamLoopState(folder_buffer="2026-05-20-original")
        ClaudeChatExecutor._detect_folder_in_text(
            "haikai/specs/2026-05-20-new/spec.md",
            state,
        )
        assert state.folder_buffer == "2026-05-20-original"

    def test_no_match_leaves_state_alone(self):
        state = _StreamLoopState()
        ClaudeChatExecutor._detect_folder_in_text("just regular text", state)
        assert state.folder_buffer is None


# ─── _check_text_for_cli_errors ──────────────────────────────────────────


class TestCheckTextForCliErrors:
    """Behaviour contract:
    - Matches CLI-error patterns (authentication/API/permission/rate-limit/overloaded).
    - Appends matched text to state.cli_errors.
    - Yields one error event per match.
    - Sets state.is_fatal_error for auth-class errors only.
    - Returns empty generator for non-error text (caller's `yield from` is no-op).
    """

    def test_clean_text_yields_nothing(self):
        state = _StreamLoopState()
        events = list(ClaudeChatExecutor._check_text_for_cli_errors("Hello world", state))
        assert events == []
        assert state.cli_errors == []
        assert state.is_fatal_error is False

    def test_auth_error_yields_error_and_sets_fatal(self):
        state = _StreamLoopState()
        text = "Failed to authenticate. API Error: 401 Unauthorized"
        events = list(ClaudeChatExecutor._check_text_for_cli_errors(text, state))
        assert len(events) == 1
        assert events[0]["type"] == "error"
        assert events[0]["message"] == text
        assert state.cli_errors == [text]
        assert state.is_fatal_error is True

    def test_rate_limit_yields_error_but_not_fatal(self):
        # Rate-limit is a transient error pattern — fatal only when
        # text matches one of the _FATAL_ERROR_HINTS (authenticate / invalid /
        # authentication_error). "rate_limit_error" alone is transient.
        state = _StreamLoopState()
        events = list(
            ClaudeChatExecutor._check_text_for_cli_errors("rate_limit_error happened", state)
        )
        assert len(events) == 1
        assert state.is_fatal_error is False

    def test_invalid_api_key_is_fatal(self):
        state = _StreamLoopState()
        text = "invalid_api_key: check your config"
        events = list(ClaudeChatExecutor._check_text_for_cli_errors(text, state))
        assert len(events) == 1
        assert state.is_fatal_error is True


# ─── _handle_main_assistant_block ────────────────────────────────────────


class TestHandleMainAssistantBlock:
    """Behaviour contract for the per-block dispatcher in the main stream loop.
    Tests cover the most important branches; the full matrix is exercised
    end-to-end by the existing integration tests.
    """

    def test_text_block_yields_content_and_detects_folder(self, executor):
        state = _StreamLoopState()
        block = {"type": "text", "text": "Working on haikai/specs/2026-05-20-x/spec.md"}
        events = list(executor._handle_main_assistant_block(block, state))
        assert events == [{"type": "content", "delta": block["text"]}]
        assert state.folder_buffer == "2026-05-20-x"

    def test_text_block_with_cli_error_yields_error_not_content(self, executor):
        state = _StreamLoopState()
        block = {"type": "text", "text": "Failed to authenticate. API Error: 401"}
        events = list(executor._handle_main_assistant_block(block, state))
        # Error event takes precedence over content yield.
        assert len(events) == 1
        assert events[0]["type"] == "error"
        assert state.is_fatal_error is True

    def test_text_block_buffers_when_collecting_questions(self, executor):
        state = _StreamLoopState(is_collecting_questions=True)
        block = {"type": "text", "text": "- q1: do you want X?"}
        events = list(executor._handle_main_assistant_block(block, state))
        assert events == [{"type": "content", "delta": block["text"]}]
        assert state.ask_questions_content == ["- q1: do you want X?"]

    def test_ask_questions_tool_use_enables_collection(self, executor):
        state = _StreamLoopState()
        block = {
            "type": "tool_use",
            "name": "ask-questions",
            "input": {"args": "- q1: do X?\n- q2: do Y?"},
        }
        events = list(executor._handle_main_assistant_block(block, state))
        assert state.is_collecting_questions is True
        assert state.ask_questions_content == ["- q1: do X?\n- q2: do Y?"]
        # Always yields skill_invoked for tool_use blocks
        assert {"type": "skill_invoked", "skill": "ask-questions"} in events

    def test_skill_tool_use_routes_to_ask_questions_when_skill_field_matches(self, executor):
        state = _StreamLoopState()
        block = {
            "type": "tool_use",
            "name": "Skill",
            "input": {"skill": "ask-questions", "args": "args body"},
        }
        events = list(executor._handle_main_assistant_block(block, state))
        assert state.is_collecting_questions is True
        assert state.ask_questions_content == ["args body"]
        # Skill→ask-questions invocation is reported as "ask-questions"
        skill_events = [e for e in events if e["type"] == "skill_invoked"]
        assert skill_events == [{"type": "skill_invoked", "skill": "ask-questions"}]

    def test_write_tool_use_yields_file_modified_and_detects_folder(self, executor):
        state = _StreamLoopState()
        block = {
            "type": "tool_use",
            "name": "Write",
            "input": {
                "path": "haikai/specs/2026-05-20-foo/spec.md",
                "content": "# Spec body",
            },
        }
        # Mock the tool_executor to avoid actually writing to disk
        executor.tool_executor.execute_tool = MagicMock(return_value={"ok": True})
        events = list(executor._handle_main_assistant_block(block, state))
        assert state.folder_buffer == "2026-05-20-foo"
        file_mod_events = [e for e in events if e["type"] == "file_modified"]
        assert file_mod_events == [{"type": "file_modified", "path": "haikai/specs/2026-05-20-foo/spec.md"}]
        # And the underlying ToolExecutor was invoked
        executor.tool_executor.execute_tool.assert_called_once()


# ─── _try_collect_ask_questions ───────────────────────────────────────


class TestTryCollectAskQuestions:
    """Behaviour contract:
    - tool_name="ask-questions" → True, sets is_collecting_questions, buffers args.
    - tool_name="Skill" with skill="ask-questions" → True, same effect.
    - tool_name="Skill" with skill="ask-questions" substring in input → True.
    - tool_name="Skill" with other skill → False, no state change.
    - tool_name="Write" / anything else → False, no state change.
    """

    def test_explicit_ask_questions_matches(self):
        state = _StreamLoopState()
        result = ClaudeChatExecutor._try_collect_ask_questions(
            "ask-questions", {"args": "- q1: ?"}, state
        )
        assert result is True
        assert state.is_collecting_questions is True
        assert state.ask_questions_content == ["- q1: ?"]

    def test_skill_with_matching_skill_field_matches(self):
        state = _StreamLoopState()
        result = ClaudeChatExecutor._try_collect_ask_questions(
            "Skill", {"skill": "ask-questions", "args": "body"}, state
        )
        assert result is True
        assert state.is_collecting_questions is True
        assert state.ask_questions_content == ["body"]

    def test_skill_with_other_skill_returns_false(self):
        state = _StreamLoopState()
        result = ClaudeChatExecutor._try_collect_ask_questions(
            "Skill", {"skill": "other-skill", "args": "x"}, state
        )
        assert result is False
        assert state.is_collecting_questions is False
        assert state.ask_questions_content == []

    def test_write_tool_not_matched(self):
        state = _StreamLoopState()
        result = ClaudeChatExecutor._try_collect_ask_questions(
            "Write", {"path": "a", "content": "b"}, state
        )
        assert result is False
        assert state.is_collecting_questions is False


# ─── _execute_write_tool ─────────────────────────────────────────────────


class TestExecuteWriteTool:
    """Behaviour contract:
    - Extracts spec folder from haikai/specs/<slug> path (does not overwrite).
    - Calls tool_executor.execute_tool("write_to_file", ...) on success.
    - Yields file_modified event on success.
    - Yields error event on tool execution failure.
    - Skips execution + yield if path or content is empty.
    """

    def test_successful_write_yields_file_modified(self, executor):
        executor.tool_executor.execute_tool = MagicMock(return_value={"ok": True})
        state = _StreamLoopState()
        events = list(executor._execute_write_tool(
            {"path": "haikai/specs/2026-05-20-x/spec.md", "content": "# spec"},
            state,
        ))
        assert events == [{"type": "file_modified", "path": "haikai/specs/2026-05-20-x/spec.md"}]
        assert state.folder_buffer == "2026-05-20-x"
        executor.tool_executor.execute_tool.assert_called_once_with(
            "write_to_file",
            {"path": "haikai/specs/2026-05-20-x/spec.md", "content": "# spec"},
        )

    def test_failed_write_yields_error(self, executor):
        executor.tool_executor.execute_tool = MagicMock(side_effect=RuntimeError("disk full"))
        state = _StreamLoopState()
        events = list(executor._execute_write_tool(
            {"path": "haikai/specs/2026-05-20-y/spec.md", "content": "# spec"},
            state,
        ))
        assert len(events) == 1
        assert events[0]["type"] == "error"
        assert "disk full" in events[0]["message"]

    def test_empty_path_skips_execution(self, executor):
        executor.tool_executor.execute_tool = MagicMock()
        state = _StreamLoopState()
        events = list(executor._execute_write_tool(
            {"path": "", "content": "body"}, state,
        ))
        assert events == []
        executor.tool_executor.execute_tool.assert_not_called()

    def test_existing_folder_not_overwritten(self, executor):
        executor.tool_executor.execute_tool = MagicMock(return_value={"ok": True})
        state = _StreamLoopState(folder_buffer="2026-05-20-original")
        list(executor._execute_write_tool(
            {"path": "haikai/specs/2026-05-20-new/spec.md", "content": "# spec"},
            state,
        ))
        assert state.folder_buffer == "2026-05-20-original"


# ─── _handle_question_retry_event / _block ───────────────────────────────


class TestHandleQuestionRetryEvent:
    """Behaviour contract: lean dispatch — no folder detect, no error detect,
    no Write/Edit/Bash. Yields content, skill_invoked, error only.
    """

    def test_text_yields_content(self, executor):
        state = _StreamLoopState()
        event = {"type": "assistant", "message": {"content": [{"type": "text", "text": "hi"}]}}
        events = list(executor._handle_question_retry_event(event, state))
        assert events == [{"type": "content", "delta": "hi"}]

    def test_text_does_not_detect_folder(self, executor):
        state = _StreamLoopState()
        event = {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "see haikai/specs/2026-05-20-x/spec.md"}
        ]}}
        list(executor._handle_question_retry_event(event, state))
        # Lean dispatch: folder_buffer must NOT be set from text alone.
        assert state.folder_buffer is None

    def test_text_does_not_detect_cli_errors(self, executor):
        state = _StreamLoopState()
        event = {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "Failed to authenticate. API Error: 401"}
        ]}}
        events = list(executor._handle_question_retry_event(event, state))
        # Lean dispatch: text yielded as content, no error event.
        assert events == [{"type": "content", "delta": "Failed to authenticate. API Error: 401"}]
        assert state.cli_errors == []
        assert state.is_fatal_error is False

    def test_ask_questions_tool_use_enables_collection(self, executor):
        state = _StreamLoopState()
        event = {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "ask-questions", "input": {"args": "- q?"}},
        ]}}
        events = list(executor._handle_question_retry_event(event, state))
        assert state.is_collecting_questions is True
        assert state.ask_questions_content == ["- q?"]
        assert {"type": "skill_invoked", "skill": "ask-questions"} in events

    def test_error_event_yielded(self, executor):
        state = _StreamLoopState()
        events = list(executor._handle_question_retry_event(
            {"type": "error", "message": "stream broken"}, state,
        ))
        assert events == [{"type": "error", "message": "stream broken"}]


# ─── _handle_resume_retry_event ──────────────────────────────────────────


class TestHandleResumeRetryEvent:
    """Behaviour contract: side-effect-only — yields only file_modified (or
    error from failed Writes). NO content, NO skill_invoked. DOES detect
    folder from text AND from Write paths.
    """

    def test_text_detects_folder_no_yield(self, executor):
        state = _StreamLoopState()
        event = {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "see haikai/specs/2026-05-20-z/spec.md"}
        ]}}
        events = list(executor._handle_resume_retry_event(event, state))
        assert events == []
        assert state.folder_buffer == "2026-05-20-z"

    def test_text_does_not_yield_content(self, executor):
        state = _StreamLoopState()
        event = {"type": "assistant", "message": {"content": [
            {"type": "text", "text": "Some prose response"}
        ]}}
        events = list(executor._handle_resume_retry_event(event, state))
        assert events == []

    def test_ask_questions_tool_use_buffers_silently(self, executor):
        state = _StreamLoopState()
        event = {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "ask-questions", "input": {"args": "- q?"}},
        ]}}
        events = list(executor._handle_resume_retry_event(event, state))
        # No skill_invoked yield on resume retry
        assert events == []
        assert state.is_collecting_questions is True
        assert state.ask_questions_content == ["- q?"]

    def test_write_tool_executes_and_yields_file_modified(self, executor):
        executor.tool_executor.execute_tool = MagicMock(return_value={"ok": True})
        state = _StreamLoopState()
        event = {"type": "assistant", "message": {"content": [
            {"type": "tool_use", "name": "Write",
             "input": {"path": "haikai/specs/2026-05-20-w/spec.md", "content": "# spec"}},
        ]}}
        events = list(executor._handle_resume_retry_event(event, state))
        assert len(events) == 1
        assert events[0]["type"] == "file_modified"
        assert state.folder_buffer == "2026-05-20-w"

    def test_non_assistant_events_ignored(self, executor):
        state = _StreamLoopState()
        events = list(executor._handle_resume_retry_event(
            {"type": "error", "message": "x"}, state,
        ))
        # Resume retry is side-effect-only; doesn't relay errors.
        assert events == []


# ─── _check_main_returncode ──────────────────────────────────────────────


class TestCheckMainReturncode:
    """Behaviour contract:
    - returncode != 0: sets is_fatal_error, appends a code-first message
      ("Claude CLI exited with code N[: stderr]") to cli_errors, yields
      one error event.
    - returncode == 0: drains stderr to logger.warning, yields nothing,
      does NOT touch state.is_fatal_error.
    """

    def _make_proc(self, returncode: int, stderr_text: str = ""):
        proc = MagicMock()
        proc.returncode = returncode
        proc.stderr = MagicMock()
        proc.stderr.read.return_value = stderr_text
        return proc

    def test_nonzero_with_stderr_yields_error_event(self, executor):
        state = _StreamLoopState()
        proc = self._make_proc(returncode=1, stderr_text="boom\n")
        events = list(executor._check_main_returncode(proc, state))
        # 2026-08-04: the message ALWAYS leads with the exit code — stderr is
        # appended context, never the whole story (a reloader SIGTERM with
        # noisy stderr must still read as an exit, not a tool problem).
        assert events == [
            {"type": "error", "message": "Claude CLI exited with code 1: boom"}
        ]
        assert state.is_fatal_error is True
        assert state.cli_errors == ["Claude CLI exited with code 1: boom"]

    def test_nonzero_with_empty_stderr_yields_synthetic_error(self, executor):
        state = _StreamLoopState()
        proc = self._make_proc(returncode=2, stderr_text="")
        events = list(executor._check_main_returncode(proc, state))
        assert len(events) == 1
        assert "exited with code 2" in events[0]["message"]
        assert state.cli_errors == [events[0]["message"]]
        assert state.is_fatal_error is True

    def test_zero_returncode_yields_nothing(self, executor):
        state = _StreamLoopState()
        proc = self._make_proc(returncode=0, stderr_text="just a warning")
        events = list(executor._check_main_returncode(proc, state))
        assert events == []
        # Does NOT touch is_fatal_error on success
        assert state.is_fatal_error is False
        assert state.cli_errors == []


# ─── _emit_questions_failed ──────────────────────────────────────────────


class TestEmitQuestionsFailed:
    """Behaviour contract:
    - On fatal error: reason = cli_errors[:3], skip the probe (LLM unreachable).
    - Otherwise: call _probe_failure_reason, fall back to "" on exception.
    - Always yields exactly one questions_failed event.
    """

    def test_fatal_skips_probe_uses_cli_errors(self, executor):
        state = _StreamLoopState(
            is_fatal_error=True,
            cli_errors=["err1", "err2", "err3", "err4"],
        )
        executor._probe_failure_reason = MagicMock()
        events = list(executor._emit_questions_failed(state, "shape-spec"))
        assert len(events) == 1
        assert events[0]["type"] == "questions_failed"
        assert "err1; err2; err3" in events[0]["message"]
        # err4 must not appear (capped at first 3)
        assert "err4" not in events[0]["message"]
        executor._probe_failure_reason.assert_not_called()

    def test_non_fatal_calls_probe(self, executor):
        state = _StreamLoopState(is_fatal_error=False)
        executor._probe_failure_reason = MagicMock(return_value="LLM said why")
        events = list(executor._emit_questions_failed(state, "shape-spec"))
        assert "LLM said why" in events[0]["message"]
        executor._probe_failure_reason.assert_called_once()

    def test_probe_exception_falls_back_to_empty(self, executor):
        state = _StreamLoopState(is_fatal_error=False)
        executor._probe_failure_reason = MagicMock(side_effect=RuntimeError("network down"))
        events = list(executor._emit_questions_failed(state, "shape-spec"))
        assert len(events) == 1
        # Falls back to the generic message, no LLM reason appended
        assert events[0]["message"] == "Unable to generate questions based on your spec."


# ─── _run_question_retry_loop (smoke) ────────────────────────────────────


class TestRunQuestionRetryLoop:
    """Smoke tests for the retry orchestration. The per-attempt parsing
    is already covered by TestHandleQuestionRetryEvent; here we verify
    that the loop respects max_retries and early-breaks on success.
    """

    def _make_proc(self, returncode: int = 0, stderr: str = ""):
        proc = MagicMock()
        proc.stdout = iter([])  # empty stream
        proc.returncode = returncode
        proc.stderr = MagicMock()
        proc.stderr.read.return_value = stderr
        proc.wait = MagicMock()
        return proc

    def test_exits_early_when_questions_collected(self, executor):
        # Simulate a retry that flips is_collecting_questions on its
        # first stream event.
        proc = self._make_proc(returncode=0)
        executor._spawn_subprocess = MagicMock(return_value=proc)

        def _fake_handler(event, state):
            state.is_collecting_questions = True
            return iter([])

        executor._handle_question_retry_event = MagicMock(side_effect=_fake_handler)
        # The retry loop iterates events from proc.stdout; with empty iter
        # the for-loop body never runs, so we force flip the state right
        # before by patching _iter_stream_events to yield one fake event.
        executor._iter_stream_events = MagicMock(return_value=iter([{"type": "assistant"}]))

        state = _StreamLoopState()
        events = list(executor._run_question_retry_loop(
            state, "original prompt", "shape-spec", max_retries=3,
        ))

        # Only one spawn (early break after attempt 1)
        assert executor._spawn_subprocess.call_count == 1
        # Yielded the 4 retry/retry_progress events for that attempt
        assert any(e.get("type") == "retry" for e in events)
        assert any(
            e.get("type") == "retry_progress" and e.get("step") == "success"
            for e in events
        )

    def test_exhausts_max_retries_when_no_questions(self, executor):
        # All 3 attempts succeed (returncode=0) but never flip collecting_q.
        proc = self._make_proc(returncode=0)
        executor._spawn_subprocess = MagicMock(return_value=proc)
        executor._iter_stream_events = MagicMock(return_value=iter([]))

        state = _StreamLoopState()
        list(executor._run_question_retry_loop(
            state, "original prompt", "shape-spec", max_retries=3,
        ))
        # Loop ran the full 3 attempts
        assert executor._spawn_subprocess.call_count == 3
        assert state.is_collecting_questions is False

    def test_fatal_branch_uses_original_prompt(self, executor):
        # When state.is_fatal_error is set, retry_prompt should be
        # the ORIGINAL cli prompt (not the nudge text).
        proc = self._make_proc(returncode=0)
        executor._spawn_subprocess = MagicMock(return_value=proc)
        executor._iter_stream_events = MagicMock(return_value=iter([]))
        # Record what _build_cli_command receives
        observed_prompts = []
        original_build = executor._build_cli_command
        def _spy(prompt, is_new_session):
            observed_prompts.append(prompt)
            return original_build(prompt, is_new_session)
        executor._build_cli_command = _spy

        state = _StreamLoopState(is_fatal_error=True)
        list(executor._run_question_retry_loop(
            state, "ORIGINAL PROMPT", "shape-spec", max_retries=1,
        ))
        assert observed_prompts == ["ORIGINAL PROMPT"]


# ─── _run_resume_retry_loop (smoke) ──────────────────────────────────────


class TestRunResumeRetryLoop:
    """Smoke tests for the resume retry orchestration."""

    def _make_proc(self):
        proc = MagicMock()
        proc.stdout = iter([])
        proc.wait = MagicMock()
        return proc

    def test_breaks_early_on_folder_detection(self, executor):
        proc = self._make_proc()
        executor._spawn_subprocess = MagicMock(return_value=proc)
        # Simulate the dispatcher flipping folder_buffer mid-stream
        def _fake_handler(event, state):
            state.folder_buffer = "2026-05-20-x"
            return iter([])
        executor._handle_resume_retry_event = MagicMock(side_effect=_fake_handler)
        executor._iter_stream_events = MagicMock(return_value=iter([{"type": "x"}]))

        state = _StreamLoopState()
        list(executor._run_resume_retry_loop(state, "shape-spec", max_retries=3))
        # Only one attempt — broke early on folder detection
        assert executor._spawn_subprocess.call_count == 1

    def test_exhausts_all_attempts_when_nothing_detected(self, executor):
        proc = self._make_proc()
        executor._spawn_subprocess = MagicMock(return_value=proc)
        executor._iter_stream_events = MagicMock(return_value=iter([]))

        state = _StreamLoopState()
        list(executor._run_resume_retry_loop(state, "shape-spec", max_retries=3))
        assert executor._spawn_subprocess.call_count == 3


# ─── Helper-exists-sibling-missed guard ──────────────────────────────────


class TestHelperSiblingsRouteThroughHelper:
    """Guard against the CLAUDE.md "helper-exists-sibling-missed" pattern.

    When B.1 extracted `_build_cli_command`, two retry sites inside
    `stream_message` continued to construct their own inline cli_args
    list (with a stale `haikai_profiles` local reference, causing a
    NameError at runtime — caught only by live testing). The fix routes
    them through `_build_cli_command(prompt, is_new_session=False)`.

    This guard asserts that the only inline `str(self.claude_cli_path)`
    list-construction left in the file is inside `_build_cli_command`
    itself and the deliberately-divergent reason-probe site (which
    omits `--include-partial-messages` on purpose). Any future contributor
    adding a fourth retry-style spawn will trip this test, forcing them
    to either use the helper or document a justified divergence.
    """

    def test_no_unwarranted_inline_cli_arg_lists(self):
        from pathlib import Path as _Path
        import re as _re

        source = _Path("src/chat/claude_chat_executor.py").read_text(encoding="utf-8")
        # Match every "str(self.claude_cli_path)" — the cheap fingerprint
        # of an inline cli_args list construction.
        matches = list(_re.finditer(r"str\(self\.claude_cli_path\)", source))
        # Expected: 2 occurrences total.
        #  - 1 inside `_build_cli_command` (the helper itself)
        #  - 1 inside the reason-probe spawn (deliberately omits
        #    --include-partial-messages — see comment at that site)
        # Any extra hit means a retry/probe site duplicated the helper.
        assert len(matches) == 2, (
            f"Expected exactly 2 inline `str(self.claude_cli_path)` sites "
            f"(helper + reason-probe). Found {len(matches)}. New sites should "
            f"call `self._build_cli_command(prompt, is_new_session=...)` "
            f"unless they need a divergent flag set — in which case extend "
            f"the helper or document the divergence at the inline site."
        )
