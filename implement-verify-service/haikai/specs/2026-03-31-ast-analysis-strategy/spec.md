# Specification: AST Analysis Strategy

## Summary

Replace the LLM-as-code-parser pattern with LLM-as-structural-interpreter. A new `AstAnalysisStrategy` extends `BaseGlobalStandardStrategy` but fundamentally changes what the LLM receives: instead of raw source code (thousands of tokens), it gets compact structural output from ctags + tree-sitter (~200 tokens per file). The LLM shifts from "parse this code and find patterns" to "interpret these symbols, call graphs, and relationships — what conventions and standards does this reveal?"

---

## Current Flow (LLM-only)

```
Pass 1 (build_context_from_samples):
  → Sample 15 random code files
  → Send raw code + docs to LLM (2000 chars/file × 15 = ~30K chars)
  → LLM responds with: tech_stack, languages, frameworks, baseline_practices
  → Non-deterministic: different samples → different results

Pass 2 (get_extraction_prompts):
  → For EACH file: send raw source code to LLM
  → LLM parses syntax, identifies patterns, extracts conventions
  → ~2000+ tokens per file × 500 files = ~1M tokens
  → Non-deterministic: LLM may miss patterns on repeated runs

Pass 3 (synthesize):
  → Combine all per-file LLM analyses into standards document
```

### Problems

1. **Token waste** — LLM receives raw code when structural data already exists
2. **Non-deterministic** — different runs produce different results
3. **Redundant parsing** — LLM re-parses syntax that ctags/tree-sitter already extracted
4. **No triage** — every file goes to LLM, including trivial data classes and boilerplate
5. **No structural context** — LLM can't see cross-file relationships (call graphs, import chains)

---

## Proposed Flow (Structural + LLM)

```
Pass 1 (build_context_from_structural):
  → Run ctags + tree-sitter on ALL files (~1 second)
  → Deterministic results: exact symbol counts, inheritance trees, import graphs
  → Build GlobalAnalysisContext from structural data (zero LLM cost):
    - tech_stack: inferred from imports (fastapi→Python backend, React→frontend)
    - languages: from file extensions
    - frameworks: from import frequency analysis
    - baseline_practices: from structural patterns (e.g., "all classes use inheritance")
  → Optionally send structural summary to LLM for semantic interpretation

Pass 2 (get_extraction_prompts):
  → Triage: classify files by structural complexity
    - SKIP (no LLM): trivial files, data classes, generated code, boilerplate
    - ANALYZE (send to LLM): complex classes, unusual patterns, cross-cutting concerns
  → For analyzed files: send structural output (~200 tokens), NOT raw code
  → LLM interprets: "this inheritance pattern suggests clean architecture"
  → ~200 tokens/file × 45 complex files = ~9K tokens (vs 1M)

Pass 3 (synthesize):
  → Combine deterministic structural analysis + LLM interpretations
  → Structural sections are deterministic (always same result for same code)
  → LLM sections add semantic reasoning (conventions, quality assessment)
```

---

## What the LLM Receives

### Before (raw code — current strategies):

```
=== src/services/user_service.py ===
import logging
from typing import Optional
from sqlalchemy.orm import Session
from ..models.user import User
from ..repositories.user_repository import UserRepository

logger = logging.getLogger(__name__)

class UserService:
    def __init__(self, db: Session):
        self.db = db
        self.repo = UserRepository(db)
    
    async def get_user(self, user_id: int) -> Optional[User]:
        """Get a user by ID."""
        user = await self.repo.find_by_id(user_id)
        if not user:
            logger.warning(f"User {user_id} not found")
        return user
    
    async def create_user(self, name: str, email: str) -> User:
        ...
```

~500 tokens. LLM must parse Python syntax to find patterns.

### After (structural output — AST strategy):

```
Imports:
  logging
  sqlalchemy.orm (Session)
  models.user (User)
  repositories.user_repository (UserRepository)

Symbols:
  class UserService
    method __init__(self, db: Session)
    method get_user(self, user_id: int) -> Optional[User] [async]
    method create_user(self, name: str, email: str) -> User [async]

Calls:
  UserService.__init__:
    -> UserRepository (line 13)
  UserService.get_user:
    -> UserRepository.find_by_id (line 17, confidence 0.95)
    -> Logger.warning (line 19, external)
```

~120 tokens. LLM reasons over pre-parsed structure.

---

## Code Changes

### 1. New: `src/strategies/ast_analysis_strategy.py`

```python
class AstAnalysisStrategy(BaseGlobalStandardStrategy):
    """
    Strategy that uses structural analysis instead of raw code.
    
    Pass 1: Build context from ctags + tree-sitter (deterministic)
    Pass 2: Send structural output to LLM for interpretation (targeted)
    """
```

**Key methods:**

- `get_standard_name()` → `"structural_analysis"`

- `build_context_from_structural(file_paths, structural_results)`:
  - Receives pre-computed `dict[str, StructuralAnalysis]` from `ProviderRegistry`
  - Builds `GlobalAnalysisContext` deterministically:
    - `languages`: from file extensions in structural results
    - `tech_stack`: inferred from import frequency (top imports → framework detection)
    - `frameworks`: import pattern matching (`fastapi` → FastAPI, `django` → Django, etc.)
    - `baseline_practices`: from structural patterns (inheritance depth, method counts, async usage)
  - Optionally calls LLM with structural summary for semantic interpretation
  - Returns `GlobalAnalysisContext`

- `triage(structural_results) -> (skip_files, analyze_files)`:
  - `SKIP`: files with ≤3 symbols, no inheritance, no calls (data classes, configs, __init__.py)
  - `ANALYZE`: files with deep inheritance (>2 levels), many calls (>10), complex patterns
  - Returns two lists

- `get_extraction_prompts(file_path, content, is_documentation)`:
  - `content` is already structural output (from `format_structural_output()`)
  - System prompt tells LLM: "You are interpreting pre-parsed structural data, not raw code"
  - User prompt: structural output + question ("What conventions and standards does this structure reveal?")

- `build_deterministic_sections(structural_results) -> dict`:
  - Pure structural analysis sections (no LLM):
    - Dependency graph summary (most imported modules, circular deps)
    - Decorator/annotation usage frequency
    - Symbol distribution (classes vs functions vs methods)
    - Inheritance depth statistics
    - Call graph hotspots (most-called functions)
    - Import clustering (which modules import which)
  - These sections are always the same for the same code

### 2. New: `src/ast/framework_detector.py`

Deterministic framework detection from import patterns.

```python
FRAMEWORK_SIGNATURES = {
    "fastapi": {"fastapi", "starlette"},
    "django": {"django"},
    "flask": {"flask"},
    "react": {"react", "react-dom"},
    "express": {"express"},
    "spring": {"org.springframework"},
    "sqlalchemy": {"sqlalchemy"},
    "pydantic": {"pydantic"},
    "pytest": {"pytest"},
    ...
}

def detect_frameworks(structural_results: dict) -> list[dict]:
    """Detect frameworks from import frequency across all files."""
```

### 3. New: `src/ast/complexity_scorer.py`

Scores file complexity for triage decisions.

```python
def score_complexity(analysis: StructuralAnalysis) -> float:
    """Score 0.0-1.0 based on structural complexity."""
    # Factors: symbol count, inheritance depth, call count,
    # async methods, decorator count, import count
```

### 4. Modified: `src/file_analyzer.py`

When `AstAnalysisStrategy` is the active strategy:
- Pass structural output to `get_prompts()` instead of raw code
- Use triage to skip trivial files
- Add deterministic sections to final output

### 5. Modified: `src/standards_orchestrator.py`

- Register `AstAnalysisStrategy` alongside existing strategies
- When structural providers enabled, use `AstAnalysisStrategy` instead of individual strategies
- Deterministic sections merged into final standards doc

---

## Framework Detection Rules

| Import Pattern | Detected Framework | Category |
|---------------|-------------------|----------|
| `fastapi` | FastAPI | Web framework |
| `django` | Django | Web framework |
| `flask` | Flask | Web framework |
| `express` | Express.js | Web framework |
| `react` | React | Frontend |
| `vue` | Vue.js | Frontend |
| `angular` | Angular | Frontend |
| `sqlalchemy` | SQLAlchemy | ORM |
| `prisma` | Prisma | ORM |
| `pydantic` | Pydantic | Validation |
| `pytest` | pytest | Testing |
| `junit` | JUnit | Testing |
| `org.springframework` | Spring | Java framework |
| `Microsoft.EntityFrameworkCore` | EF Core | ORM |
| `Microsoft.AspNetCore` | ASP.NET Core | Web framework |

---

## Triage Rules

| Condition | Decision | Rationale |
|-----------|----------|-----------|
| ≤3 symbols, no inheritance | SKIP | Data class, config, or init file |
| All symbols are VARIABLE/CONSTANT | SKIP | Constants file |
| File is `__init__.py` with only imports | SKIP | Package init |
| >10 calls + inheritance | ANALYZE | Complex class worth interpreting |
| ≥3 design patterns detected | ANALYZE | Architectural significance |
| Unusual import pattern (many cross-module) | ANALYZE | Cross-cutting concern |
| File has ≥5 async methods | ANALYZE | Concurrency pattern |

---

## Token Reduction Analysis

| Scenario | Current (raw code) | Proposed (structural) | Reduction |
|----------|-------------------|----------------------|-----------|
| 500-file Python project | ~1M tokens | ~9K tokens | 99% |
| 100-file TypeScript project | ~200K tokens | ~4K tokens | 98% |
| 50-file Java project | ~100K tokens | ~2K tokens | 98% |
| Single complex file | ~2000 tokens | ~200 tokens | 90% |
| Single trivial file | ~500 tokens | 0 (skipped) | 100% |

---

## Configuration

```yaml
# config/analysis_providers.yaml (additions)
strategies:
  ast_analysis:
    enabled: true                    # AST_ANALYSIS_ENABLED=true
    triage_complexity_threshold: 0.3 # Files below this score are skipped
    llm_interpretation: true         # Send structural data to LLM for semantic analysis
    deterministic_only: false        # Set true to skip LLM entirely (pure structural)
```

---

## Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| **AST Code Analysis** | Provides ctags + tree-sitter data this strategy consumes |
| **Pattern Detection** | Structural patterns feed into triage + deterministic sections |
| **Diagram Metamodel** | Diagrams can be auto-generated from structural analysis |
| **Chat Session Memory** | Structural context persisted across chat sessions |
