# Requirements: AST Analysis Strategy

## Functional Requirements

### FR-1: Structural Context Building (Pass 1)
- Build `GlobalAnalysisContext` deterministically from ctags + tree-sitter output
- Detect languages from file extensions
- Detect frameworks from import frequency analysis
- Infer baseline practices from structural patterns
- Optional LLM call for semantic interpretation of structural summary

### FR-2: File Triage
- Classify files as SKIP or ANALYZE based on structural complexity
- SKIP: trivial files (≤3 symbols, no inheritance, constants-only, `__init__.py`)
- ANALYZE: complex files (deep inheritance, many calls, design patterns, async patterns)
- Configurable complexity threshold

### FR-3: Structural Prompts (Pass 2)
- LLM receives `format_structural_output()` output, not raw code
- System prompt establishes LLM role as structural interpreter
- LLM reasons over symbols, calls, imports — never parses syntax

### FR-4: Deterministic Sections
- Pure structural analysis sections generated without LLM:
  - Dependency graph summary
  - Symbol distribution
  - Inheritance statistics
  - Call graph hotspots
  - Import clustering
  - Framework detection results

### FR-5: Framework Detection
- Deterministic detection from import patterns
- Configurable signature mapping (import → framework)
- Coverage: Python, JavaScript/TypeScript, Java, C#, Go, Rust

### FR-6: Complexity Scoring
- Per-file complexity score (0.0-1.0) based on structural features
- Factors: symbol count, inheritance depth, call count, async methods, decorators

## Non-Functional Requirements

### NFR-1: Token Reduction
- ≥90% reduction per file vs raw code
- ≥95% reduction across full project (with triage)

### NFR-2: Determinism
- Structural sections produce identical output for identical code
- Framework detection is deterministic
- Only LLM interpretation sections are non-deterministic

### NFR-3: Backward Compatibility
- Existing strategies unchanged
- `AstAnalysisStrategy` is opt-in via config
- Falls back to raw code when no structural data available

### NFR-4: Performance
- Triage decision < 1ms per file
- Framework detection < 100ms for full project
- Complexity scoring < 1ms per file
