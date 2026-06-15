"""Tests for versioned kind mapping loader."""
import pytest
from pathlib import Path

from src.ast.models import SymbolKind
from src.ast.kind_mapping_loader import (
    load_kind_mappings,
    detect_ctags_version,
    VersionNotFoundError,
)


@pytest.fixture
def test_config(tmp_path):
    """Create a test YAML config file."""
    config_content = """
ctags:
  "6.1":
    class: class
    function: function
    member: method
    method: method
    property: property
    constant: constant
    generator: function
    interface: interface
    field: variable
    enum: class
    struct: class
    variable: variable
    local: variable
    module: module
    namespace: module
    package: module
    decorator: decorator

  "5.9":
    class: class
    function: function
    member: method

lsp:
  pyright:
    "1.1.380":
      Class: class
      Method: method
      Function: function
"""
    config_file = tmp_path / "symbol_kind_mappings.yaml"
    config_file.write_text(config_content, encoding="utf-8")
    return str(config_file)


class TestLoadKindMappings:
    def test_loads_known_version(self, test_config):
        mappings = load_kind_mappings("ctags", "6.1", config_path=test_config)
        assert mappings["class"] == SymbolKind.CLASS
        assert mappings["function"] == SymbolKind.FUNCTION
        assert mappings["member"] == SymbolKind.METHOD

    def test_member_maps_to_method(self, test_config):
        mappings = load_kind_mappings("ctags", "6.1", config_path=test_config)
        assert mappings["member"] == SymbolKind.METHOD

    def test_field_maps_to_variable(self, test_config):
        mappings = load_kind_mappings("ctags", "6.1", config_path=test_config)
        assert mappings["field"] == SymbolKind.VARIABLE

    def test_enum_maps_to_class(self, test_config):
        mappings = load_kind_mappings("ctags", "6.1", config_path=test_config)
        assert mappings["enum"] == SymbolKind.CLASS

    def test_loads_different_version(self, test_config):
        mappings = load_kind_mappings("ctags", "5.9", config_path=test_config)
        assert mappings["class"] == SymbolKind.CLASS
        assert len(mappings) == 3  # only 3 entries in 5.9

    def test_raises_version_not_found(self, test_config):
        with pytest.raises(VersionNotFoundError) as exc_info:
            load_kind_mappings("ctags", "99.0", config_path=test_config)
        assert "99.0" in str(exc_info.value)
        assert "not found" in str(exc_info.value)

    def test_raises_provider_not_found(self, test_config):
        with pytest.raises(VersionNotFoundError) as exc_info:
            load_kind_mappings("tree_sitter", "1.0", config_path=test_config)
        assert "tree_sitter" in str(exc_info.value)

    def test_raises_file_not_found(self):
        with pytest.raises(FileNotFoundError):
            load_kind_mappings("ctags", "6.1", config_path="/nonexistent/path.yaml")

    def test_major_minor_matching(self, test_config):
        """Version '6.1.0' should match config entry '6.1'."""
        mappings = load_kind_mappings("ctags", "6.1.0", config_path=test_config)
        assert mappings["class"] == SymbolKind.CLASS

    def test_returns_correct_count(self, test_config):
        mappings = load_kind_mappings("ctags", "6.1", config_path=test_config)
        assert len(mappings) == 17  # all entries in the 6.1 section


class TestDetectCtagsVersion:
    def test_returns_string_or_none(self):
        """detect_ctags_version returns a string or None — never crashes."""
        result = detect_ctags_version()
        assert result is None or isinstance(result, str)
