# Chunking

Splits files that are too large for a single LLM context into manageable pieces. Lives in `src/chunking/`. Used by [[standards-pipeline]] strategies before they call [[llm-client]].

## Why a layer for this

Naïve splitting ("every N tokens") destroys the structure inside files: a Python class gets cut mid-method, a `package.json` loses its surrounding context, a Markdown section gets split across its heading. Each chunk goes to the LLM independently — if the chunk lacks structure, the LLM produces worse output.

The chunking layer encodes per-format knowledge: split a `package.json` by top-level key, a `requirements.txt` by package, a Markdown file by heading, Python by symbol. Each chunk is self-contained enough for the LLM to reason about.

## Pattern

Chain-of-Responsibility (`ChunkerFactory.get_chunker` walks a list, returns the first chunker that says "I can handle this") + AST-aware override.

```
┌─────────────────────────────────────────────┐
│ ChunkerFactory.get_chunker(file, content,   │
│                             structural?)     │
└─────────────────┬───────────────────────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
  structural data?       no structural data
       │                     │
       ▼                     ▼
  ASTChunker          Try in order:
  (priority)            1. PackageJsonChunker
                        2. RequirementsChunker
                        3. MarkdownChunker
                        4. GenericChunker (always wins as fallback)
```

Source: `chunker_factory.py:41-`. AST-aware chunking takes priority when [[structural-store]] data is available — it knows about symbol boundaries, so it can split at function/class boundaries rather than line counts.

## The chunkers

| Chunker | Handles | Strategy |
|---|---|---|
| `ASTChunker` | any file with structural data | Split at symbol boundaries (functions, classes) |
| `PackageJsonChunker` | `package.json` | Split by top-level key (deps, devDeps, scripts) preserving JSON validity |
| `RequirementsChunker` | `requirements*.txt`, `Pipfile` | Split by package, group by category |
| `MarkdownChunker` | `.md`, `.mdx` | Split at headings, preserve heading hierarchy in chunk metadata |
| `GenericChunker` | anything else | Fallback: token-budget-respecting line-based split |

Always-last `GenericChunker` guarantees the factory always returns *something* — no file is unchunkable.

## Base contract

`BaseChunker` (`base_chunker.py`):

```python
class BaseChunker(ABC):
    def __init__(self, chunk_threshold_tokens: int = 3000):
        self.chunk_threshold_tokens = chunk_threshold_tokens

    @abstractmethod
    def chunk(self, file_path: str, content: str) -> ChunkResult:
        ...
```

Returns `ChunkResult(chunks: list[str], metadata: dict)`. The `metadata` carries chunk-level info downstream (heading paths for Markdown, package names for requirements.txt, symbol names for AST).

## Threshold

Default `chunk_threshold_tokens=3000`. Files smaller than this skip chunking entirely — they fit in one LLM call. Above the threshold, the chunker activates.

## Where it's called from

- `src/file_analyzer.py` — per-file analysis dispatches files through `ChunkerFactory.get_chunker(...)` before passing to a strategy.
- `src/strategies/*` — some strategies call the factory directly when they need different chunking than the analyzer's default.
- `src/content_extractor.py` — uses the factory for chunking-aware content extraction.

## What it's *not*

- **Not a tokenizer.** The threshold uses a rough token estimate; precise tokenization happens inside [[llm-client]] (LangChain's tokenizer for the active model).
- **Not for diff/patch chunking.** Pure read-side chunking only. The refactoring engines have their own chunking model.
- **Not used by the chat layer.** [[chat-executors]] don't pre-chunk — Claude / OpenAI handle large inputs themselves, and chat is interactive (user can split manually).

## Cross-references

- [[standards-pipeline]] — the consumer
- [[llm-client]] — the next stage after chunking
- [[structural-store]] — provides the symbol data that `ASTChunker` uses

## Sources

- `src/chunking/{base_chunker,chunker_factory,ast_chunker,package_json_chunker,requirements_chunker,markdown_chunker,generic_chunker}.py`
- `docs/ARCHITECTURE.md` § "Chunking Layer"
- [[../../raw/2026-05-04_codebase-walk]]
