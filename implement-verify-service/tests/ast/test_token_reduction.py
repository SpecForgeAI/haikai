import shutil
import os
import pytest

import tiktoken


skip_if_no_ctags = pytest.mark.skipif(
    not shutil.which("ctags"),
    reason="ctags not installed"
)


def _count_tokens(text: str) -> int:
    """Count tokens using tiktoken (cl100k_base, used by GPT-4/Claude)."""
    enc = tiktoken.get_encoding("cl100k_base")
    return len(enc.encode(text))


@skip_if_no_ctags
def test_per_file_token_reduction():
    """Gate 1.3: structural prompt uses >=80% fewer tokens than raw code.

    Measured in actual tokens (via tiktoken), not character count.
    """
    from src.ast.ctags_provider import CtagsProvider
    from src.ast.formatter import format_structural_output

    provider = CtagsProvider()
    test_file = "src/file_analyzer.py"

    with open(test_file) as f:
        raw_content = f.read()

    results = provider.analyze_batch([test_file])
    structural = results.get(test_file)
    assert structural is not None, "ctags should produce results for file_analyzer.py"

    structural_output = format_structural_output(structural)
    assert structural_output, "Formatter should produce non-empty output"

    raw_tokens = _count_tokens(raw_content)
    structural_tokens = _count_tokens(structural_output)
    reduction = 1 - (structural_tokens / raw_tokens) if raw_tokens > 0 else 0

    print(f"\n{'='*50}")
    print(f"Token reduction gate (Gate 1.3)")
    print(f"  Raw code:        {raw_tokens:>6} tokens")
    print(f"  Structural:      {structural_tokens:>6} tokens")
    print(f"  Reduction:       {reduction:>6.0%}")
    print(f"  Threshold:       >=80%")
    print(f"{'='*50}")

    assert reduction >= 0.80, (
        f"Expected >=80% token reduction, got {reduction:.0%}. "
        f"Raw: {raw_tokens} tokens, Structural: {structural_tokens} tokens. "
        f"Structural output may be too verbose."
    )


def test_backward_compatibility_without_ctags():
    """Gate 1.4: with ctags disabled, pipeline is unchanged."""
    os.environ["AST_CTAGS_ENABLED"] = "false"
    try:
        from src.ast.provider import ProviderRegistry
        registry = ProviderRegistry()
        assert registry.is_provider_enabled("ctags") is False
        results = registry.analyze_batch(["src/file_analyzer.py"])
        assert results == {}
    finally:
        os.environ.pop("AST_CTAGS_ENABLED", None)
