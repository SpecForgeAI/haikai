# Strategies

The Strategy-pattern instance that powers per-file analysis in the [[standards-pipeline]]. Lives in `src/strategies/`. 9 strategies + 2 base classes.

## Why a pattern, not branching

`FileAnalyzer` has to ask different questions of different files: a Python source file gets asked about coding style and error handling; a `package.json` gets asked about tech-stack composition; an architecture doc gets asked about technical decisions.

A switch statement (`if file_type == "python": ...`) couples the analyzer to every analysis type. The Strategy pattern decouples them: `FileAnalyzer` holds a list of `AnalysisStrategy` instances, picks the relevant ones per file category, calls `get_prompts(...)` and `get_metadata(...)` on each. Adding a new analysis = new subclass; analyzer code unchanged.

## The contract

`AnalysisStrategy` (`base_strategy.py:26-`):

```python
class AnalysisStrategy:
    def get_prompts(self, file_path, content, context: FileAnalysisContext
                   ) -> Tuple[str, str, int]:
        # returns (system_prompt, user_prompt, max_tokens)
        ...

    def get_metadata(self, file_path, content, context) -> Dict:
        # type-specific fields to attach to the analysis result
        ...
```

`FileAnalysisContext` (a `@dataclass`) carries `path`, `category`, `standard_file` — a parameter object so strategies don't accumulate kwargs as the system grows.

There's also `BaseGlobalStrategy` for cross-file synthesis (versus per-file analysis) — used by global-mode standards generation.

## The 9 strategies

| Strategy | Asks the LLM |
|---|---|
| `coding_style_strategy` | Naming, indentation, line lengths, structural conventions |
| `commenting_strategy` | Docstring/comment style, depth, frequency |
| `conventions_strategy` | Architectural conventions: module organization, naming patterns |
| `error_handling_strategy` | How errors are raised/caught/logged; exception types used |
| `validation_strategy` | Input validation patterns; library choices |
| `ast_analysis_strategy` | Reads from [[structural-store]] instead of raw source — cheaper, more precise |
| `tech_stack_synthesis_strategy` | Library/framework choices; uses Provider pattern (DependencyProvider, MetamodelProvider, GlobalStandardProvider) |
| `technical_doc_strategy` | Analysis of project README, architecture docs, ADRs |
| `metamodel_strategy` | Two-pass extraction of architectural metamodel facts |

Each is a single-purpose class; collectively they constitute the LLM-side question library.

## Provider pattern inside `tech_stack_synthesis_strategy`

The tech-stack strategy uses a sub-pattern: data sources are abstracted behind `Provider` interfaces (`DependencyProvider`, `MetamodelProvider`, `GlobalStandardProvider`) so the strategy doesn't know whether the data came from a `package.json`, a SpecForge metamodel, or a previously-generated global standard. The strategy asks providers for facts; providers decide where to look.

## Each strategy uses [[llm-client]]

Strategies are stateless. They produce prompts; `LLMClient.invoke(...)` does the actual call. **Strategies are not chat sessions** — they don't loop, they don't ask follow-up questions, they get one prompt and return one analysis.

Per [[../decisions/use-claude-proxy]]: strategies inherit the project's no-fallback config rule. Missing `LLM_PROVIDER` or `LLM_MODEL` raises before any strategy runs.

## How they're picked per file

`FileAnalyzer` doesn't run all 9 strategies on every file. The picker uses:

1. **File category** ([[standards-pipeline]] § "File categorization") — backend/frontend/testing/global/dependency.
2. **Standard file** — which standard document this file's findings should feed.
3. **Strategy declarations** — each strategy declares which categories + standard files it applies to.

A `package.json` triggers `tech_stack_synthesis_strategy` and `conventions_strategy` (for naming) but not `error_handling_strategy` (no executable code).

## Cross-references

- [[standards-pipeline]] — the orchestrator that runs strategies
- [[llm-client]] — what strategies call to make their LLM requests
- [[chunking]] — large files pass through chunking before reaching a strategy
- [[../decisions/use-claude-proxy]] — config rule strategies inherit

## Sources

- `src/strategies/base_strategy.py`, `src/strategies/base_global_strategy.py`
- `src/strategies/{coding_style,commenting,conventions,error_handling,validation,ast_analysis,tech_stack_synthesis,technical_doc,metamodel}_strategy.py`
- `docs/ARCHITECTURE.md` § "Strategy Layer"
- [[../../raw/2026-05-04_codebase-walk]]
