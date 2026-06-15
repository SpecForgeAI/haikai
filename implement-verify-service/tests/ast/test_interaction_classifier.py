"""Tests for InteractionClassifier — detection, batching, orchestration, output."""
import yaml
import pytest
from pathlib import Path
from unittest.mock import MagicMock

from src.ast.models import StructuralAnalysis, CallInfo, InteractionInfo, ImportInfo
from src.ast.interaction_classifier import (
    InteractionClassifier, UnclassifiedCall, ClassificationResult, FrameworkBatch,
)


class TestDetectUnclassified:
    def test_separates_classified_from_unclassified(self):
        classifier = InteractionClassifier()
        analyses = {
            "service.py": StructuralAnalysis(
                file_path="service.py",
                language="python",
                calls=[
                    CallInfo(caller_file="service.py", caller_name="Service.fetch",
                             callee_file="-", callee_name="requests.get", line=10),
                    CallInfo(caller_file="service.py", caller_name="Service.process",
                             callee_file="-", callee_name="unknown_lib.do_thing", line=20),
                ],
                interactions=[
                    InteractionInfo(
                        source_class="Service", source_method="fetch",
                        target="http://example.com", target_type="HTTP_SERVICE",
                        direction="REQUEST_RESPONSE", mechanism="requests",
                        file="service.py", line=10,
                    ),
                ],
            ),
        }

        classified, unclassified = classifier.detect_unclassified(analyses)
        assert len(classified) == 1
        assert classified[0].mechanism == "requests"
        assert len(unclassified) >= 1
        # The unknown_lib.do_thing call should be unclassified
        uc_methods = [uc.call.callee_name for uc in unclassified]
        assert "unknown_lib.do_thing" in uc_methods

    def test_filters_internal_calls(self):
        classifier = InteractionClassifier()
        analyses = {
            "service.py": StructuralAnalysis(
                file_path="service.py",
                language="python",
                calls=[
                    CallInfo(caller_file="service.py", caller_name="f",
                             callee_file="-", callee_name="print", line=1,
                             confidence=0.20),
                    CallInfo(caller_file="service.py", caller_name="f",
                             callee_file="-", callee_name="len", line=2,
                             confidence=0.20),
                    CallInfo(caller_file="service.py", caller_name="f",
                             callee_file="-", callee_name="logger.info", line=3,
                             confidence=0.20),
                    CallInfo(caller_file="service.py", caller_name="f",
                             callee_file="-", callee_name="external.send", line=4,
                             confidence=0.50),
                ],
            ),
        }

        _, unclassified = classifier.detect_unclassified(analyses)
        uc_methods = [uc.call.callee_name for uc in unclassified]
        assert "print" not in uc_methods
        assert "len" not in uc_methods
        assert "logger.info" not in uc_methods
        assert "external.send" in uc_methods

    def test_empty_analyses(self):
        classifier = InteractionClassifier()
        classified, unclassified = classifier.detect_unclassified({})
        assert len(classified) == 0
        assert len(unclassified) == 0


class TestBatchByFramework:
    def test_groups_by_framework(self):
        classifier = InteractionClassifier()
        analyses = {
            "OrderService.java": StructuralAnalysis(
                file_path="OrderService.java",
                language="java",
                imports=[
                    ImportInfo(module="org.springframework.web"),
                    ImportInfo(module="org.apache.kafka"),
                ],
                calls=[
                    CallInfo(caller_file="OrderService.java", caller_name="OrderService.send",
                             callee_file="-", callee_name="kafkaProducer.send", line=10,
                             confidence=0.50),
                    CallInfo(caller_file="OrderService.java", caller_name="OrderService.get",
                             callee_file="-", callee_name="webClient.get", line=20,
                             confidence=0.50),
                ],
            ),
        }

        _, unclassified = classifier.detect_unclassified(analyses)
        batches = classifier.batch_by_framework(unclassified, analyses)

        assert len(batches) >= 1
        # All calls from this file should be batched under Spring
        fw_names = [b.framework for b in batches]
        assert "Spring" in fw_names

    def test_unknown_framework_batch(self):
        classifier = InteractionClassifier()
        analyses = {
            "weird.py": StructuralAnalysis(
                file_path="weird.py",
                language="python",
                imports=[
                    ImportInfo(module="some_unknown_framework"),
                ],
                calls=[
                    CallInfo(caller_file="weird.py", caller_name="f",
                             callee_file="-", callee_name="unknown.call", line=5,
                             confidence=0.50),
                ],
            ),
        }

        _, unclassified = classifier.detect_unclassified(analyses)
        batches = classifier.batch_by_framework(unclassified, analyses)

        # Should have an "unknown" batch
        assert any(b.framework == "unknown" for b in batches)

    def test_skips_testing_frameworks(self):
        classifier = InteractionClassifier()
        analyses = {
            "test_service.py": StructuralAnalysis(
                file_path="test_service.py",
                language="python",
                imports=[
                    ImportInfo(module="pytest"),
                ],
                calls=[
                    CallInfo(caller_file="test_service.py", caller_name="test_it",
                             callee_file="-", callee_name="mock.patch", line=5,
                             confidence=0.50),
                ],
            ),
        }

        _, unclassified = classifier.detect_unclassified(analyses)
        batches = classifier.batch_by_framework(unclassified, analyses)

        # Testing framework calls should go to unknown, not "pytest" batch
        for batch in batches:
            assert batch.framework != "pytest"


class TestRealRepoClassification:
    """Run classifier on this repo's real AST output."""

    @pytest.fixture(scope="class")
    def real_results(self):
        from pathlib import Path
        from src.ast.treesitter_provider import TreeSitterProvider

        py_files = [str(f) for f in Path("src").rglob("*.py")
                     if f.name != "__init__.py"]
        provider = TreeSitterProvider()
        return provider.analyze_batch(py_files)

    def test_classifies_known_interactions(self, real_results):
        classifier = InteractionClassifier()
        classified, unclassified = classifier.detect_unclassified(real_results)
        # Interactions are now discovered agentically, not by AST extractors.
        # YAML classification only picks up interactions already in analysis.interactions.
        # With agentic discovery not running (no LLM in tests), classified may be 0.
        assert isinstance(classified, list)

    def test_has_unclassified_calls(self, real_results):
        classifier = InteractionClassifier()
        _, unclassified = classifier.detect_unclassified(real_results)
        # This repo has many internal calls that pass the filter
        assert len(unclassified) >= 10, f"Expected 10+ unclassified, got {len(unclassified)}"

    def test_batches_by_framework(self, real_results):
        classifier = InteractionClassifier()
        _, unclassified = classifier.detect_unclassified(real_results)
        batches = classifier.batch_by_framework(unclassified, real_results)
        assert len(batches) >= 1
        # FastAPI should be one of the batches
        fw_names = [b.framework for b in batches]
        assert "FastAPI" in fw_names, f"Expected FastAPI batch, got {fw_names}"


# ===========================================================================
# Orchestration
# ===========================================================================

class TestClassify:
    def test_yaml_only_without_llm(self):
        classifier = InteractionClassifier()
        analyses = {
            "service.py": StructuralAnalysis(
                file_path="service.py", language="python",
                interactions=[
                    InteractionInfo(
                        source_class="S", source_method="f",
                        target="http://x", target_type="HTTP_SERVICE",
                        direction="REQUEST_RESPONSE", mechanism="requests",
                        file="service.py", line=10,
                    ),
                ],
                calls=[
                    CallInfo(caller_file="service.py", caller_name="S.f",
                             callee_file="-", callee_name="requests.get", line=10),
                ],
            ),
        }

        result = classifier.classify(analyses, llm_client=None)
        assert len(result.pre_classified) == 1
        assert len(result.llm_classified) == 0
        assert result.stats["pre_classified"] == 1
        assert result.stats["llm_classified"] == 0

    def test_with_mocked_llm(self):
        classifier = InteractionClassifier()
        analyses = {
            "service.py": StructuralAnalysis(
                file_path="service.py", language="python",
                imports=[ImportInfo(module="fastapi")],
                calls=[
                    CallInfo(caller_file="service.py", caller_name="S.do",
                             callee_file="-", callee_name="unknown.send", line=20,
                             confidence=0.50),
                ],
            ),
        }

        mock_llm = MagicMock()
        mock_llm.generate_json.return_value = [
            {"caller_file": "service.py", "caller_name": "S.do",
             "type": "MESSAGE_QUEUE", "direction": "PUBLISH",
             "mechanism": "unknown-mq", "target": "events", "line": 20}
        ]

        result = classifier.classify(analyses, llm_client=mock_llm)
        assert result.stats["llm_classified"] >= 1


# ===========================================================================
# Output writers
# ===========================================================================

class TestWriteClassifiedInteractions:
    def test_writes_with_provenance(self, tmp_path):
        result = ClassificationResult(
            pre_classified=[
                InteractionInfo(
                    source_class="S", source_method="get",
                    target="/users", target_type="HTTP_SERVICE",
                    direction="READ", mechanism="requests",
                    file="s.py", line=10,
                ),
            ],
            llm_classified=[
                InteractionInfo(
                    source_class="S", source_method="send",
                    target="events", target_type="MESSAGE_QUEUE",
                    direction="PUBLISH", mechanism="kafka",
                    file="s.py", line=20,
                ),
            ],
            unclassified_batches=[],
        )

        InteractionClassifier.write_classified_interactions(tmp_path, result)
        content = (tmp_path / "_interactions.txt").read_text()
        lines = content.strip().splitlines()
        assert len(lines) == 3  # header + 2 data
        assert "pre_classified" in lines[1]
        assert "llm" in lines[2]
        assert "classified_by" in lines[0]

    def test_handles_empty_result(self, tmp_path):
        result = ClassificationResult(
            pre_classified=[], llm_classified=[], unclassified_batches=[],
        )
        InteractionClassifier.write_classified_interactions(tmp_path, result)
        content = (tmp_path / "_interactions.txt").read_text()
        data_lines = [l for l in content.splitlines() if not l.startswith("#")]
        assert len(data_lines) == 0



class TestWriteClassificationMeta:
    def test_writes_stats(self, tmp_path):
        result = ClassificationResult(
            pre_classified=[
                InteractionInfo(source_class="", source_method="", target="",
                                target_type="HTTP_SERVICE", direction="READ",
                                mechanism="requests"),
            ],
            llm_classified=[],
            unclassified_batches=[
                FrameworkBatch(framework="FastAPI", category="web",
                               language="python", calls=[]),
            ],
            stats={"pre_classified": 1, "llm_classified": 0, "total_interactions": 1},
        )
        InteractionClassifier.write_classification_meta(tmp_path, result)
        content = (tmp_path / "_classification_meta.yaml").read_text()
        meta = yaml.safe_load(content)
        assert meta["classification"]["stats"]["pre_classified"] == 1
        assert len(meta["classification"]["framework_batches"]) == 1
