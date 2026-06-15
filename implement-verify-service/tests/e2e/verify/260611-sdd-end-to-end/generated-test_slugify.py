"""Tests for slugify utility function."""

import pytest
from src.textkit.slugify import slugify


def test_basic_ascii_words():
    """Test basic ASCII words remain unchanged except for lowercase."""
    assert slugify("hello") == "hello"
    assert slugify("HELLO") == "hello"
    assert slugify("Hello") == "hello"


def test_accented_characters():
    """Test accented characters are converted to ASCII equivalents."""
    assert slugify("Café") == "cafe"
    assert slugify("naïve") == "naive"
    assert slugify("résumé") == "resume"


def test_symbol_space_collapsing():
    """Test that runs of symbols and spaces collapse to single hyphen."""
    assert slugify("foo  bar") == "foo-bar"
    assert slugify("a___b") == "a-b"
    assert slugify("test!!!") == "test"
    assert slugify("hello   world") == "hello-world"


def test_underscore_handling():
    """Test underscores are treated like spaces/symbols."""
    assert slugify("hello_world") == "hello-world"
    assert slugify("foo__bar") == "foo-bar"


def test_leading_trailing_hyphen_trim():
    """Test leading and trailing hyphens are trimmed."""
    assert slugify("-hello-") == "hello"
    assert slugify("---test---") == "test"
    assert slugify("-foo-bar-") == "foo-bar"


def test_empty_string():
    """Test empty string returns empty string."""
    assert slugify("") == ""


def test_whitespace_only():
    """Test whitespace-only input returns empty string."""
    assert slugify("   ") == ""
    assert slugify("\t\n") == ""


def test_all_symbols():
    """Test all-symbol input returns empty string."""
    assert slugify("!!!") == ""
    assert slugify("@#$%") == ""
    assert slugify("---") == ""


def test_none_input_raises_type_error():
    """Test None input raises TypeError with specific message."""
    with pytest.raises(TypeError, match="text must be str"):
        slugify(None)


def test_max_length_truncation():
    """Test max_length truncation works correctly."""
    assert slugify("hello-world-test", max_length=11) == "hello-world"
    assert slugify("hello", max_length=10) == "hello"
    assert slugify("hello", max_length=3) == "hel"


def test_truncation_no_trailing_hyphen():
    """Test truncation doesn't leave trailing hyphen."""
    assert slugify("test-foo-bar", max_length=9) == "test-foo"
    assert slugify("test-foo-bar", max_length=8) == "test-foo"
    assert slugify("test-foo-bar", max_length=5) == "test"
    # Edge case: truncate exactly at hyphen
    assert slugify("hello-world", max_length=6) == "hello"
