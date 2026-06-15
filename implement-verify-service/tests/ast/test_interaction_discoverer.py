"""Tests for agentic interaction discoverer — tool-based LLM discovery."""
import pytest
from unittest.mock import MagicMock

from src.ast.models import InteractionInfo
from src.ast.interaction_discoverer import (
    discover_interactions, _parse_interaction_answer, _execute_tool_call, _parse_tool_args,
)


class TestDiscoverInteractions:
    def test_direct_final_answer(self):
        mock_llm = MagicMock()
        mock_llm.generate.return_value = '''FINAL_ANSWER: [
            {"source_class": "OrderService", "source_method": "create",
             "target": "orders", "target_type": "DATABASE", "direction": "WRITE",
             "mechanism": "JPA", "data_hint": "Order",
             "file": "OrderService.java", "line": 42, "confidence": 0.90}
        ]'''
        interactions = discover_interactions(mock_llm, project_root=".", snapshot_path="/tmp/test")
        assert len(interactions) == 1
        assert interactions[0].target == "orders"
        assert interactions[0].target_type == "DATABASE"
        assert interactions[0].data_hint == "Order"

    def test_tool_call_then_answer(self, tmp_path):
        (tmp_path / "_calls.txt").write_text("Service.java\tOrderService.create\trepository.save\t-\t42\t0.9\n")
        (tmp_path / "_imports.txt").write_text("Service.java\torg.springframework.data\tJpaRepository\n")

        mock_llm = MagicMock()
        mock_llm.generate.side_effect = [
            'TOOL_CALL: read_calls(file_pattern="Service")',
            '''FINAL_ANSWER: [
                {"source_class": "OrderService", "source_method": "create",
                 "target": "orders", "target_type": "DATABASE", "direction": "WRITE",
                 "mechanism": "JPA", "data_hint": "Order",
                 "file": "Service.java", "line": 42, "confidence": 0.85}
            ]''',
        ]
        interactions = discover_interactions(mock_llm, project_root=".", snapshot_path=str(tmp_path))
        assert len(interactions) == 1
        assert mock_llm.generate.call_count == 2

    def test_no_llm_returns_empty(self):
        interactions = discover_interactions(llm_client=None, project_root=".", snapshot_path="/tmp")
        assert interactions == []

    def test_no_snapshot_returns_empty(self):
        mock_llm = MagicMock()
        interactions = discover_interactions(mock_llm, project_root=".", snapshot_path=None)
        assert interactions == []
        mock_llm.generate.assert_not_called()

    def test_llm_error_returns_empty(self):
        mock_llm = MagicMock()
        mock_llm.generate.side_effect = Exception("LLM down")
        interactions = discover_interactions(mock_llm, project_root=".", snapshot_path="/tmp/test")
        assert interactions == []

    def test_max_turns_limit(self):
        mock_llm = MagicMock()
        mock_llm.generate.return_value = 'TOOL_CALL: read_calls(file_pattern="test")'
        interactions = discover_interactions(mock_llm, project_root=".", snapshot_path="/tmp/test")
        assert mock_llm.generate.call_count <= 32
        assert interactions == []

    def test_multiple_interactions(self):
        mock_llm = MagicMock()
        mock_llm.generate.return_value = '''FINAL_ANSWER: [
            {"source_class": "OrderService", "source_method": "create",
             "target": "orders", "target_type": "DATABASE", "direction": "WRITE",
             "mechanism": "JPA", "data_hint": "Order", "file": "a.java", "line": 10},
            {"source_class": "OrderService", "source_method": "notify",
             "target": "order.created", "target_type": "MESSAGE_QUEUE", "direction": "PUBLISH",
             "mechanism": "KafkaTemplate", "data_hint": "OrderEvent", "file": "a.java", "line": 30},
            {"source_class": "OrderService", "source_method": "callPayment",
             "target": "payment-service/api/charge", "target_type": "HTTP_SERVICE",
             "direction": "REQUEST_RESPONSE", "mechanism": "RestTemplate",
             "data_hint": "PaymentRequest", "file": "a.java", "line": 50}
        ]'''
        interactions = discover_interactions(mock_llm, project_root=".", snapshot_path="/tmp/test")
        assert len(interactions) == 3
        assert interactions[1].target_type == "MESSAGE_QUEUE"
        assert interactions[2].mechanism == "RestTemplate"


class TestParseInteractionAnswer:
    def test_valid_json(self):
        response = 'FINAL_ANSWER: [{"source_class": "Svc", "source_method": "run", "target": "db", "target_type": "DATABASE"}]'
        interactions = _parse_interaction_answer(response)
        assert len(interactions) == 1
        assert interactions[0].target == "db"

    def test_with_markdown_fences(self):
        response = 'FINAL_ANSWER:\n```json\n[{"source_class": "A", "target": "t", "target_type": "HTTP_SERVICE"}]\n```'
        interactions = _parse_interaction_answer(response)
        assert len(interactions) == 1

    def test_bad_json_returns_empty(self):
        interactions = _parse_interaction_answer("FINAL_ANSWER: not json")
        assert interactions == []

    def test_empty_array(self):
        interactions = _parse_interaction_answer("FINAL_ANSWER: []")
        assert interactions == []

    def test_defaults_for_missing_fields(self):
        interactions = _parse_interaction_answer('FINAL_ANSWER: [{"target_type": "CACHE"}]')
        assert len(interactions) == 1
        assert interactions[0].source_class == ""
        assert interactions[0].target == ""
        assert interactions[0].confidence == 0.75
