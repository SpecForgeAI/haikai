"""Tests for versioned serialiser config loader."""
import pytest
from pathlib import Path

from src.ast.kind_mapping_loader import VersionNotFoundError
from src.ast.serialiser_loader import (
    load_serialiser_config,
    get_available_formats,
    get_available_versions,
)


@pytest.fixture
def test_config(tmp_path):
    """Create a test YAML config file."""
    config_content = """
mermaid:
  "1":
    extension: ".mmd"
    class_header: "classDiagram"

plantuml:
  "1":
    extension: ".puml"
    wrapper_start: "@startuml"

graphviz:
  "1":
    extension: ".dot"
    directed_keyword: "digraph"

metamodel:
  "1":
    extension: ".json"
    default_width: 200
"""
    config_file = tmp_path / "diagram_serialisers.yaml"
    config_file.write_text(config_content, encoding="utf-8")
    return str(config_file)


class TestLoadSerialiserConfig:
    def test_loads_mermaid_config(self, test_config):
        config = load_serialiser_config("mermaid", "1", config_path=test_config)
        assert config["extension"] == ".mmd"
        assert config["class_header"] == "classDiagram"

    def test_loads_plantuml_config(self, test_config):
        config = load_serialiser_config("plantuml", "1", config_path=test_config)
        assert config["extension"] == ".puml"

    def test_loads_graphviz_config(self, test_config):
        config = load_serialiser_config("graphviz", "1", config_path=test_config)
        assert config["extension"] == ".dot"

    def test_loads_metamodel_config(self, test_config):
        config = load_serialiser_config("metamodel", "1", config_path=test_config)
        assert config["extension"] == ".json"

    def test_raises_version_not_found_for_unknown_format(self, test_config):
        with pytest.raises(VersionNotFoundError) as exc_info:
            load_serialiser_config("xml", "1", config_path=test_config)
        assert "xml" in str(exc_info.value)

    def test_raises_version_not_found_for_unknown_version(self, test_config):
        with pytest.raises(VersionNotFoundError) as exc_info:
            load_serialiser_config("mermaid", "99", config_path=test_config)
        assert "99" in str(exc_info.value)

    def test_raises_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            load_serialiser_config("mermaid", "1", config_path="/nonexistent/config.yaml")


class TestGetAvailableFormats:
    def test_returns_all_formats(self, test_config):
        formats = get_available_formats(config_path=test_config)
        assert set(formats) == {"mermaid", "plantuml", "graphviz", "metamodel"}

    def test_returns_empty_for_missing_file(self):
        formats = get_available_formats(config_path="/nonexistent/config.yaml")
        assert formats == []


class TestGetAvailableVersions:
    def test_returns_versions_for_format(self, test_config):
        versions = get_available_versions("mermaid", config_path=test_config)
        assert "1" in versions

    def test_returns_empty_for_unknown_format(self, test_config):
        versions = get_available_versions("xml", config_path=test_config)
        assert versions == []
