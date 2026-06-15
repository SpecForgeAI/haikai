from typing import List, Dict, Any

from src.chunking.base_chunker import BaseChunker, ChunkResult
from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind


class ASTChunker(BaseChunker):
    """Chunks files at symbol boundaries, never splitting mid-function/class.

    Key invariant: ALL lines in the file appear in exactly one chunk.
    Content between symbols (module-level statements, constants, decorators)
    is captured as "gap regions" and prepended to the next symbol's chunk.
    """

    def __init__(self, structural_analysis: StructuralAnalysis, max_chunk_chars: int = 75000):
        super().__init__()
        self.structural = structural_analysis
        self.max_chunk_chars = max_chunk_chars

    def supports(self, file_path: str, content: str) -> bool:
        return bool(self.structural and self.structural.symbols)

    def chunk(self, content: str) -> ChunkResult:
        lines = content.split('\n')
        total_lines = len(lines)

        top_level = self._get_top_level_symbols()

        if not top_level:
            return ChunkResult(
                chunks=[content] if content.strip() else [],
                metadata={"strategy": "ast_no_symbols"},
            )

        regions = self._build_regions_with_gaps(top_level, total_lines)

        chunks = []
        current_lines = []
        current_size = 0

        for region_start, region_end in regions:
            region_lines = lines[region_start - 1:region_end]  # convert to 0-indexed
            region_text = '\n'.join(region_lines)
            region_size = len(region_text)

            if current_size + region_size > self.max_chunk_chars and current_lines:
                chunks.append('\n'.join(current_lines))
                current_lines = []
                current_size = 0

            current_lines.extend(region_lines)
            current_size += region_size

        if current_lines:
            chunks.append('\n'.join(current_lines))

        return ChunkResult(
            chunks=chunks if chunks else [content],
            metadata={"strategy": "ast", "symbol_count": len(top_level), "chunk_count": len(chunks)},
        )

    def merge(self, chunk_analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Merge chunk analyses by combining all fields."""
        if not chunk_analyses:
            return {}
        if len(chunk_analyses) == 1:
            return chunk_analyses[0]

        merged = dict(chunk_analyses[0])
        for analysis in chunk_analyses[1:]:
            for key, value in analysis.items():
                if key in merged and isinstance(merged[key], list) and isinstance(value, list):
                    merged[key].extend(value)
                elif key not in merged:
                    merged[key] = value
        return merged

    def _get_top_level_symbols(self) -> list[SymbolInfo]:
        """Get top-level symbols for chunking boundaries.

        Top-level = symbols that define chunk boundaries:
        - Classes (kind=CLASS) → always top-level
        - Standalone functions (kind=FUNCTION and scope is None)
        Methods inside classes are NOT top-level.
        """
        top_level = []
        for s in self.structural.symbols:
            if s.kind == SymbolKind.CLASS:
                top_level.append(s)
            elif s.kind == SymbolKind.FUNCTION and s.scope is None:
                top_level.append(s)

        return sorted(top_level, key=lambda s: s.line_start)

    def _build_regions_with_gaps(self, top_level: list[SymbolInfo], total_lines: int) -> list[tuple[int, int]]:
        """Build line regions that cover ALL lines in the file.

        For each top-level symbol, the region starts from the end of the
        previous symbol (or line 1 for the first). This captures gap content
        and attaches it to the next symbol's chunk.

        Returns: list of (start_line, end_line) tuples, 1-indexed.
        """
        if not top_level:
            return [(1, total_lines)]

        regions = []
        prev_end = 0

        for symbol in top_level:
            region_start = prev_end + 1
            region_end = max(symbol.line_end, symbol.line_start)
            regions.append((region_start, region_end))
            prev_end = region_end

        # Capture trailing content after last symbol
        if prev_end < total_lines:
            last_start, last_end = regions[-1]
            regions[-1] = (last_start, total_lines)

        return regions
