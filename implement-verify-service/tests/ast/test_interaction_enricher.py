"""Tests for agentic interaction enricher — tool-based LLM enrichment."""
import pytest
from unittest.mock import MagicMock

from src.ast.models import InteractionInfo
from src.ast.interaction_enricher import (
    enrich_interactions, _needs_enrichment, _parse_tool_args,
    _execute_tool_call, _apply_final_answer,
)
from src.ast.enrichment_tools import read_calls, read_index, read_source


def _make_interaction(**kwargs):
    defaults = {
        "source_class": "OrderService",
        "source_method": "create",
        "target": "repository.save",
        "target_type": "DATABASE",
        "direction": "WRITE",
        "mechanism": "JPA",
        "data_hint": "",
        "file": "OrderService.java",
        "line": 42,
    }
    defaults.update(kwargs)
    return InteractionInfo(**defaults)


class TestNeedsEnrichment:
    def test_empty_data_hint(self):
        assert _needs_enrichment(_make_interaction(data_hint=""))

    def test_has_data_hint_and_resolved_target(self):
        assert not _needs_enrichment(_make_interaction(data_hint="Order", target="orders"))

    def test_method_like_target(self):
        assert _needs_enrichment(_make_interaction(target="repository.saveAll", data_hint="Order"))


class TestParseToolArgs:
    def test_quoted_args(self):
        result = _parse_tool_args('file_pattern="OrderService.java"')
        assert result == {"file_pattern": "OrderService.java"}

    def test_numeric_args(self):
        result = _parse_tool_args('file_path="api.py", start_line=10, end_line=20')
        assert result["file_path"] == "api.py"
        assert result["start_line"] == 10
        assert result["end_line"] == 20

    def test_single_string(self):
        result = _parse_tool_args('"OrderService.java"')
        assert result["file_pattern"] == "OrderService.java"


class TestTools:
    def test_read_source_function(self, tmp_path):
        (tmp_path / "test.py").write_text("def hello():\n    return 42\n\ndef bye():\n    pass\n")
        result = read_source(str(tmp_path), "test.py", function_name="hello")
        assert "return 42" in result

    def test_read_source_line_range(self, tmp_path):
        (tmp_path / "test.py").write_text("line1\nline2\nline3\nline4\nline5\n")
        result = read_source(str(tmp_path), "test.py", start_line=2, end_line=4)
        assert "line2" in result
        assert "line4" in result
        assert "line1" not in result

    def test_read_calls(self, tmp_path):
        (tmp_path / "_calls.txt").write_text(
            "# header\napi.py\tget_user\tdb.py\tUserRepo.find\t10\t0.9\n"
        )
        result = read_calls(str(tmp_path), "api.py")
        assert "get_user" in result

    def test_read_index(self, tmp_path):
        (tmp_path / "_index.txt").write_text(
            "# header\napi.py\tclass\tUserService\t-\t-\t10\t-\n"
        )
        result = read_index(str(tmp_path), "api.py")
        assert "UserService" in result

    def test_missing_file(self, tmp_path):
        result = read_calls(str(tmp_path), "nonexistent")
        assert "no call graph" in result


class TestAgentLoop:
    def test_direct_final_answer(self):
        interactions = [_make_interaction()]
        mock_llm = MagicMock()
        mock_llm.generate.return_value = 'FINAL_ANSWER: [{"index": 0, "target": "orders", "data_entity": "Order"}]'
        enrich_interactions(interactions, mock_llm, project_root=".")
        assert interactions[0].target == "orders"
        assert interactions[0].data_hint == "Order"

    def test_tool_call_then_answer(self):
        interactions = [_make_interaction(file="src/api.py")]
        mock_llm = MagicMock()
        mock_llm.generate.side_effect = [
            'TOOL_CALL: read_calls(file_pattern="api.py")',
            'FINAL_ANSWER: [{"index": 0, "target": "users", "data_entity": "User"}]',
        ]
        enrich_interactions(interactions, mock_llm, project_root=".")
        assert interactions[0].data_hint == "User"

    def test_no_llm_returns_unchanged(self):
        interactions = [_make_interaction()]
        enrich_interactions(interactions, llm_client=None, project_root=".")
        assert interactions[0].data_hint == ""

    def test_skips_already_enriched(self):
        interactions = [_make_interaction(data_hint="Order", target="orders")]
        mock_llm = MagicMock()
        enrich_interactions(interactions, mock_llm, project_root=".")
        mock_llm.generate.assert_not_called()

    def test_handles_llm_error(self):
        interactions = [_make_interaction()]
        mock_llm = MagicMock()
        mock_llm.generate.side_effect = Exception("LLM down")
        enrich_interactions(interactions, mock_llm, project_root=".")
        assert interactions[0].data_hint == ""

    def test_max_turns(self):
        interactions = [_make_interaction()]
        mock_llm = MagicMock()
        # Never gives final answer, keeps calling tools
        mock_llm.generate.return_value = 'TOOL_CALL: read_calls(file_pattern="test")'
        enrich_interactions(interactions, mock_llm, project_root=".")
        assert mock_llm.generate.call_count <= 12  # MAX_AGENT_TURNS + 1


class TestApplyFinalAnswer:
    def test_applies_results(self):
        interactions = [_make_interaction(), _make_interaction(source_method="delete")]
        response = 'FINAL_ANSWER: [{"index": 0, "target": "orders", "data_entity": "Order"}, {"index": 1, "target": "orders", "data_entity": "Order"}]'
        _apply_final_answer(response, interactions)
        assert interactions[0].target == "orders"
        assert interactions[1].data_hint == "Order"

    def test_handles_bad_json(self):
        interactions = [_make_interaction()]
        _apply_final_answer("FINAL_ANSWER: not json", interactions)
        assert interactions[0].data_hint == ""  # unchanged

    def test_handles_missing_index(self):
        interactions = [_make_interaction()]
        _apply_final_answer('FINAL_ANSWER: [{"target": "orders"}]', interactions)
        # No index → no update
        assert interactions[0].target == "repository.save"
