"""Tests for interaction_agent — LLM classification with mocked LLM client."""
import pytest
from unittest.mock import MagicMock

from src.ast.models import CallInfo
from src.ast.interaction_classifier import FrameworkBatch, UnclassifiedCall
from src.ast.interaction_agent import (
    classify_batch, build_user_prompt, build_enrichment_prompt,
    _parse_llm_interaction, _read_source_snippet,
)


def _make_batch(framework="Spring", category="web", language="java", calls=None):
    batch = FrameworkBatch(
        framework=framework, category=category, language=language,
        imports=["org.springframework.web"],
    )
    batch.calls = calls or []
    return batch


def _make_uc(caller="Service.send", callee="kafkaTemplate.send", file="Service.java", line=42):
    return UnclassifiedCall(
        call=CallInfo(
            caller_file=file, caller_name=caller,
            callee_file="-", callee_name=callee, line=line,
        ),
        file_path=file,
    )


class TestBuildPrompt:
    def test_contains_framework_info(self):
        batch = _make_batch(calls=[_make_uc()])
        prompt = build_user_prompt(batch)
        assert "Spring" in prompt
        assert "java" in prompt
        assert "org.springframework.web" in prompt

    def test_contains_call_sites(self):
        batch = _make_batch(calls=[
            _make_uc(caller="A.send", callee="kafka.send", line=10),
            _make_uc(caller="B.get", callee="rest.get", line=20),
        ])
        prompt = build_user_prompt(batch)
        assert "kafka.send" in prompt
        assert "rest.get" in prompt

    def test_limits_calls(self):
        calls = [_make_uc(callee=f"call_{i}", line=i) for i in range(200)]
        batch = _make_batch(calls=calls)
        prompt = build_user_prompt(batch)
        # Should cap at MAX_CALLS_PER_BATCH (100)
        assert "call_99" in prompt
        assert "call_100" not in prompt


class TestClassifyBatch:
    def test_classifies_external_calls(self):
        batch = _make_batch(calls=[_make_uc()])
        mock_llm = MagicMock()
        mock_llm.generate_json.return_value = [
            {
                "caller_file": "Service.java",
                "caller_name": "Service.send",
                "callee_name": "kafkaTemplate.send",
                "line": 42,
                "type": "MESSAGE_QUEUE",
                "direction": "PUBLISH",
                "mechanism": "KafkaTemplate",
                "target": "order-events",
                "data_entity": "OrderEvent",
            }
        ]

        results = classify_batch(batch, mock_llm)
        assert len(results) == 1
        assert results[0].target_type == "MESSAGE_QUEUE"
        assert results[0].direction == "PUBLISH"
        assert results[0].mechanism == "KafkaTemplate"
        assert results[0].target == "order-events"
        assert results[0].data_hint == "OrderEvent"

    def test_filters_internal_calls(self):
        batch = _make_batch(calls=[_make_uc()])
        mock_llm = MagicMock()
        # LLM returns empty list (all internal)
        mock_llm.generate_json.return_value = []

        results = classify_batch(batch, mock_llm)
        assert len(results) == 0

    def test_handles_llm_error(self):
        batch = _make_batch(calls=[_make_uc()])
        mock_llm = MagicMock()
        mock_llm.generate_json.side_effect = Exception("API error")

        results = classify_batch(batch, mock_llm)
        assert len(results) == 0

    def test_handles_ambiguous_with_enrichment(self):
        # Use a real file so source enrichment can read it
        batch = _make_batch(
            framework="FastAPI", language="python",
            calls=[_make_uc(
                caller="api.health_check", callee="session.execute",
                file="src/ast/models.py", line=1,
            )]
        )
        mock_llm = MagicMock()

        # Pass 1: LLM says ambiguous
        # Pass 2: LLM classifies after seeing source
        mock_llm.generate_json.side_effect = [
            [{"caller_file": "src/ast/models.py", "caller_name": "api.health_check",
              "callee_name": "session.execute", "line": 1,
              "ambiguous": True}],
            [{"caller_file": "src/ast/models.py", "caller_name": "api.health_check",
              "callee_name": "session.execute", "line": 1,
              "type": "DATABASE", "direction": "WRITE",
              "mechanism": "SQLAlchemy", "target": "orders", "data_entity": "Order"}],
        ]

        results = classify_batch(batch, mock_llm, project_root=".")
        assert len(results) == 1
        assert results[0].target_type == "DATABASE"
        assert mock_llm.generate_json.call_count == 2

    def test_max_passes_limit(self):
        batch = _make_batch(calls=[_make_uc()])
        mock_llm = MagicMock()

        # LLM keeps saying ambiguous
        mock_llm.generate_json.return_value = [
            {"caller_file": "Service.java", "line": 42, "ambiguous": True}
        ]

        results = classify_batch(batch, mock_llm, project_root=".")
        # Should stop after MAX_PASSES (3)
        assert mock_llm.generate_json.call_count <= 3

    def test_empty_batch(self):
        batch = _make_batch(calls=[])
        mock_llm = MagicMock()

        results = classify_batch(batch, mock_llm)
        assert len(results) == 0
        mock_llm.generate_json.assert_not_called()

    def test_handles_dict_response_with_interactions_key(self):
        batch = _make_batch(calls=[_make_uc()])
        mock_llm = MagicMock()
        mock_llm.generate_json.return_value = {
            "interactions": [
                {"caller_file": "S.java", "caller_name": "S.get",
                 "type": "HTTP_SERVICE", "direction": "READ",
                 "mechanism": "RestTemplate", "target": "/users", "line": 10}
            ]
        }

        results = classify_batch(batch, mock_llm)
        assert len(results) == 1
        assert results[0].target_type == "HTTP_SERVICE"


class TestParseInteraction:
    def test_parses_valid_item(self):
        batch = _make_batch()
        item = {
            "type": "DATABASE",
            "direction": "READ",
            "mechanism": "JPA",
            "target": "users",
            "data_entity": "User",
            "caller_name": "UserService.findAll",
            "caller_file": "UserService.java",
            "line": 25,
        }
        result = _parse_llm_interaction(item, batch)
        assert result is not None
        assert result.target_type == "DATABASE"
        assert result.source_class == "UserService"
        assert result.source_method == "findAll"

    def test_returns_none_for_missing_type(self):
        batch = _make_batch()
        result = _parse_llm_interaction({"direction": "READ"}, batch)
        assert result is None


class TestReadSourceSnippet:
    def test_reads_existing_file(self):
        # Read this test file itself
        snippet = _read_source_snippet(
            "tests/ast/test_interaction_agent.py", 1, "."
        )
        assert "Tests for interaction_agent" in snippet

    def test_returns_empty_for_missing_file(self):
        snippet = _read_source_snippet("nonexistent.py", 1, ".")
        assert snippet == ""

    def test_marks_target_line(self):
        snippet = _read_source_snippet(
            "tests/ast/test_interaction_agent.py", 3, "."
        )
        assert ">>>" in snippet
