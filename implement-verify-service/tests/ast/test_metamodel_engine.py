"""Unit tests for MetamodelEngine edge cases NOT covered by integration tests.

Integration coverage (test_diagram_integration.py):
- populate() with real StructuralAnalysis data → produces enriched metamodel
- Direct mappings: class→component, method→operation, inheritance→relationship, import→dependency
- Heuristic mappings: base class detection, abstract method detection, factory pattern detection
"""
import pytest
from src.ast.kind_mapping_loader import VersionNotFoundError
from src.ast.metamodel_engine import MetamodelEngine, _generate_entity_id
from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind


@pytest.fixture
def test_config(tmp_path):
    config_content = """
"1":
  entity_mappings:
    classes:
      source_kind: class
      id_prefix: "class"
    methods:
      source_kind: method
      id_prefix: "method"
      parent_ref: true
    interfaces:
      source_kind: interface
      id_prefix: "iface"
  heuristic_mappings:
    services:
      detect_by:
        - has_dockerfile
        - has_main_entrypoint
      id_prefix: "svc"
    app_components:
      detect_by:
        - top_level_directory_with_sources
      id_prefix: "comp"
  relationship_mappings:
    interactions:
      source_rel: imports
      between: services
      id_prefix: "interaction"
"""
    config_file = tmp_path / "metamodel_mappings.yaml"
    config_file.write_text(config_content, encoding="utf-8")
    return str(config_file)


@pytest.fixture
def sample_analyses():
    return {
        "src/services/user_service.py": StructuralAnalysis(
            file_path="src/services/user_service.py", language="Python",
            symbols=[
                SymbolInfo(name="UserService", kind=SymbolKind.CLASS, line_start=10),
                SymbolInfo(name="get_user", kind=SymbolKind.METHOD, scope="UserService",
                           signature="(self, user_id: int)", line_start=20),
            ],
            provider_used="ctags",
        ),
    }


class TestMetamodelEngineEdgeCases:

    def test_unknown_version_raises(self, test_config, sample_analyses):
        """Version 99 → VersionNotFoundError."""
        engine = MetamodelEngine(config_path=test_config)
        with pytest.raises(VersionNotFoundError):
            engine.populate({"version_id": 99}, sample_analyses)

    def test_defaults_to_version_1(self, test_config, sample_analyses):
        """Missing version_id → defaults to 1."""
        engine = MetamodelEngine(config_path=test_config)
        result = engine.populate({}, sample_analyses)
        assert result["version_id"] == 1

    def test_empty_analyses_unchanged(self, test_config):
        """No analyses → metamodel returned with version_id only."""
        engine = MetamodelEngine(config_path=test_config)
        result = engine.populate({"version_id": 1}, {})
        assert result["version_id"] == 1

    def test_no_duplicate_entities(self, test_config, sample_analyses):
        """Pre-existing entity not duplicated."""
        engine = MetamodelEngine(config_path=test_config)
        metamodel = {"version_id": 1, "classes": [{"name": "UserService", "id": "existing"}]}
        result = engine.populate(metamodel, sample_analyses)
        user_services = [c for c in result["classes"] if c["name"] == "UserService"]
        assert len(user_services) == 1

    def test_entity_id_format(self):
        assert _generate_entity_id("class", "UserService") == "class_userservice"

    def test_entity_id_sanitizes_special_chars(self):
        assert _generate_entity_id("svc", "my-service.v2") == "svc_my_service_v2"

    def test_full_populate_counts(self, test_config, sample_analyses):
        """Verify entity counts from known input."""
        engine = MetamodelEngine(config_path=test_config)
        result = engine.populate({"version_id": 1}, sample_analyses)
        assert len(result.get("classes", [])) == 1
        assert len(result.get("methods", [])) == 1
