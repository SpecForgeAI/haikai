from src.chunking.ast_chunker import ASTChunker
from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind


class TestNoDroppedContent:
    """The chunker must never drop content between symbols."""

    def test_module_level_code_preserved(self):
        source = '''"""Module docstring."""
import os
from typing import List

CONSTANT = 42
MAX_SIZE = 100

class MyClass:
    def method(self):
        pass

# Between symbols
_cache = {}

def standalone():
    pass
'''
        structural = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="MyClass", kind=SymbolKind.CLASS, line_start=8, line_end=10),
                SymbolInfo(name="method", kind=SymbolKind.METHOD, scope="MyClass", line_start=9, line_end=10),
                SymbolInfo(name="standalone", kind=SymbolKind.FUNCTION, line_start=15, line_end=16),
            ],
        )
        chunker = ASTChunker(structural)
        result = chunker.chunk(source)
        all_output = "\n".join(result.chunks)

        assert '"""Module docstring."""' in all_output
        assert "import os" in all_output
        assert "CONSTANT = 42" in all_output
        assert "MAX_SIZE = 100" in all_output
        assert "_cache = {}" in all_output
        assert "class MyClass:" in all_output
        assert "def standalone():" in all_output

    def test_line_coverage_complete(self):
        source = '''line 1
line 2
line 3
line 4
line 5'''
        structural = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="something", kind=SymbolKind.FUNCTION, line_start=3, line_end=4),
            ],
        )
        chunker = ASTChunker(structural)
        result = chunker.chunk(source)

        source_lines = source.split('\n')
        for line in source_lines:
            if line.strip():
                assert line in '\n'.join(result.chunks), f"Line dropped: '{line}'"

    def test_no_content_when_no_symbols(self):
        source = "# just a comment\nx = 1\n"
        structural = StructuralAnalysis(file_path="test.py", language="python", symbols=[])
        chunker = ASTChunker(structural)
        result = chunker.chunk(source)
        assert len(result.chunks) == 1
        assert result.chunks[0] == source


class TestSymbolBoundaries:
    """Functions and classes must never be split across chunks."""

    def test_no_mid_function_split(self):
        source_lines = ['class BigService:']
        for i in range(20):
            source_lines.append(f'    def method_{i}(self):')
            for j in range(10):
                source_lines.append(f'        line_{j} = {j}')
            source_lines.append(f'        return {i}')
            source_lines.append('')
        source = '\n'.join(source_lines)

        symbols = [SymbolInfo(name="BigService", kind=SymbolKind.CLASS, line_start=1, line_end=len(source_lines))]
        for i in range(20):
            start = 2 + i * 13
            symbols.append(SymbolInfo(
                name=f"method_{i}", kind=SymbolKind.METHOD, scope="BigService",
                line_start=start, line_end=start + 11,
            ))
        structural = StructuralAnalysis(file_path="test.py", language="python", symbols=symbols)
        chunker = ASTChunker(structural, max_chunk_chars=500)
        result = chunker.chunk(source)

        for chunk in result.chunks:
            defs = chunk.count('def method_')
            returns = chunk.count('return')
            assert defs == returns, f"Chunk has {defs} defs but {returns} returns — function split!"

    def test_chunks_at_class_boundaries(self):
        source = '''class First:
    def a(self):
        return 1

class Second:
    def b(self):
        return 2
'''
        structural = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="First", kind=SymbolKind.CLASS, line_start=1, line_end=3),
                SymbolInfo(name="a", kind=SymbolKind.METHOD, scope="First", line_start=2, line_end=3),
                SymbolInfo(name="Second", kind=SymbolKind.CLASS, line_start=5, line_end=7),
                SymbolInfo(name="b", kind=SymbolKind.METHOD, scope="Second", line_start=6, line_end=7),
            ],
        )
        chunker = ASTChunker(structural, max_chunk_chars=100)
        result = chunker.chunk(source)

        for chunk in result.chunks:
            if "class First:" in chunk:
                assert "return 1" in chunk


class TestScopeHandling:

    def test_scoped_methods_not_treated_as_top_level(self):
        source = '''class MyClass:
    def method_a(self):
        return 1
    def method_b(self):
        return 2
'''
        structural = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[
                SymbolInfo(name="MyClass", kind=SymbolKind.CLASS, line_start=1, line_end=5),
                SymbolInfo(name="method_a", kind=SymbolKind.METHOD, scope="MyClass", line_start=2, line_end=3),
                SymbolInfo(name="method_b", kind=SymbolKind.METHOD, scope="MyClass", line_start=4, line_end=5),
            ],
        )
        chunker = ASTChunker(structural)
        result = chunker.chunk(source)

        assert any("class MyClass:" in c and "method_a" in c and "method_b" in c for c in result.chunks)


class TestFactoryIntegration:

    def test_factory_selects_ast_chunker_when_structural(self):
        from src.chunking.chunker_factory import ChunkerFactory
        sa = StructuralAnalysis(
            file_path="test.py", language="python",
            symbols=[SymbolInfo(name="Foo", kind=SymbolKind.CLASS, line_start=1, line_end=10)]
        )
        factory = ChunkerFactory()
        chunker = factory.get_chunker("test.py", "class Foo: pass", structural_analysis=sa)
        assert isinstance(chunker, ASTChunker)

    def test_factory_falls_back_without_structural(self):
        from src.chunking.chunker_factory import ChunkerFactory
        factory = ChunkerFactory()
        chunker = factory.get_chunker("test.py", "class Foo: pass")
        assert not isinstance(chunker, ASTChunker)
