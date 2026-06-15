# Specification: Test Coverage Analysis Skill

## Summary

Create an haikai skill that automatically analyzes test coverage after implementation work — mapping unit tests to integration tests, identifying gaps, and producing a structured `TEST-COVERAGE.md` report. The skill enforces the project testing policy: every unit test MUST have a corresponding integration test on real data.

---

## Problem

After implementing a feature, manually auditing test coverage is tedious and error-prone:

1. You have to scan every test file, figure out what each test does
2. Cross-reference unit tests against integration tests to find redundancy
3. Identify which unit tests are purely synthetic vs backed by real data
4. Track coverage percentages and gap analysis
5. Produce a structured report (like `TEST-COVERAGE.md`)

This was done manually for the structural store spec — it took significant effort and the report went stale immediately as new tests were added. An automated skill makes this repeatable and consistent.

---

## What the Skill Does

Given a repository (or directory), the skill:

1. **Discovers test files** — finds all `test_*.py` / `*_test.py` files
2. **Classifies tests** — categorizes each test as:
   - **Integration** — uses real files, fixtures, or endpoint calls
   - **Unit (covered)** — has a corresponding integration test exercising the same code path
   - **Unit (synthetic only)** — uses mocks/stubs with no integration counterpart
   - **Resilience/edge case** — defensive tests for error handling
3. **Maps coverage** — for each unit test file, identifies which integration tests cover it
4. **Identifies gaps** — flags unit tests with no integration backing
5. **Generates report** — produces `TEST-COVERAGE.md` with:
   - Summary table (totals, percentages)
   - Per-file breakdown (unit count, covered count, gap count)
   - List of uncovered tests with classification (edge case vs genuine gap)
   - Fixture/real-data inventory

---

## Skill Architecture

### Input

The skill receives:
- **repo_path** — path to the repository root
- **test_dirs** — directories containing tests (default: `tests/`)
- **output_path** — where to write the report (default: `TEST-COVERAGE.md`)
- **spec_path** — optional path to the spec directory (for context on what was implemented)

### Classification Heuristics

A test is classified as **integration** if it:
- Reads from real files on disk (fixture files, source files)
- Calls actual functions/classes with real data (not mocked)
- Tests end-to-end pipeline behavior
- Lives in a directory named `integration/` or file named `*_integration*.py`

A test is classified as **unit (covered)** if:
- It tests the same function/class as an integration test
- The integration test exercises the same code path with real data
- The unit test uses mocks/stubs for the same behavior

A test is classified as **unit (synthetic only)** if:
- It uses mocks/stubs
- No integration test covers the same code path
- OR it tests edge cases that can't occur with real data (empty input, None values, encoding errors)

### Analysis Pipeline

```
1. Discover test files
   └─ glob test_*.py, *_test.py in test_dirs

2. Parse test functions
   └─ AST parse → extract class names, method names, decorators

3. Extract test metadata
   └─ For each test:
      - What module/class does it import and test?
      - Does it use mocks? (unittest.mock, monkeypatch, MagicMock)
      - Does it read fixture files? (open(), Path(), fixture paths)
      - Does it call real constructors vs mock objects?

4. Build coverage map
   └─ For each unit test file:
      - Which integration test files test the same module?
      - Which specific test methods overlap?

5. Classify gaps
   └─ Uncovered unit tests → is it an edge case or a real gap?
      - Edge case: tests None, empty, error, encoding, timeout
      - Real gap: tests normal behavior with no integration counterpart

6. Generate report
   └─ Markdown table format matching TEST-COVERAGE.md structure
```

### Output Format

The report follows the exact structure of the existing `TEST-COVERAGE.md`:

```markdown
# Test Coverage: <Project Name>

**Date:** YYYY-MM-DD
**Total tests:** N passing
**Branch:** `branch-name`

## Coverage Summary

| Category | Tests | % |
|----------|------:|--:|
| Integration tests (real data) | N | X% |
| Unit tests covered by integration | N | X% |
| Resilience scenarios (functional) | N | X% |
| Unit tests (synthetic only) | N | X% |
| **Total** | **N** | **100%** |

## Integration Test Files

| File | Tests | Real Data |
|------|------:|-----------|
| ... | ... | ... |

## Unit Test Files + Integration Coverage

| File | Unit | Covered by Integration | Gap |
|------|-----:|----------------------:|----:|
| ... | ... | ... | ... |

## Uncovered Tests — Classification

(List each uncovered test with reason: edge case, error handling, etc.)
```

---

## Implementation

### File: `src/skills/test_coverage/SKILL.md`

The skill definition for haikai:

```markdown
# Skill: test-coverage-analysis

## Description
Analyze test suite coverage, mapping unit tests to integration tests,
identifying gaps, and generating a TEST-COVERAGE.md report.

## Trigger
After implementation work, or on demand: "analyze test coverage",
"generate coverage report", "check test gaps"

## Inputs
- repo_path: Repository root path
- test_dirs: Test directories (default: tests/)
- output_path: Report output path (default: TEST-COVERAGE.md in spec dir)

## Steps
1. Discover all test files in test_dirs
2. Parse and classify each test (integration vs unit vs resilience)
3. Map unit tests to integration coverage
4. Identify uncovered gaps
5. Generate TEST-COVERAGE.md report

## Output
- TEST-COVERAGE.md written to output_path
- Summary printed to console
```

### File: `src/skills/test_coverage/analyzer.py`

Core analysis engine:

```python
class TestCoverageAnalyzer:
    """Analyze test coverage: unit ↔ integration mapping."""
    
    def __init__(self, repo_path: str, test_dirs: list[str]):
        ...
    
    def discover_tests(self) -> list[TestFile]:
        """Find all test files and parse test functions."""
        ...
    
    def classify_tests(self, test_files: list[TestFile]) -> ClassifiedTests:
        """Classify each test as integration/unit-covered/unit-synthetic/resilience."""
        ...
    
    def map_coverage(self, classified: ClassifiedTests) -> CoverageMap:
        """Map unit tests to their integration counterparts."""
        ...
    
    def identify_gaps(self, coverage: CoverageMap) -> list[CoverageGap]:
        """Find unit tests with no integration coverage."""
        ...
    
    def generate_report(self, coverage: CoverageMap, gaps: list[CoverageGap]) -> str:
        """Generate TEST-COVERAGE.md content."""
        ...
```

### File: `src/skills/test_coverage/models.py`

```python
@dataclass
class TestFunction:
    name: str
    file_path: str
    class_name: Optional[str]
    imports: list[str]          # modules imported
    uses_mocks: bool            # uses unittest.mock, MagicMock, etc.
    reads_fixtures: bool        # opens real files
    tested_module: Optional[str] # which src module it tests

@dataclass  
class TestFile:
    path: str
    test_functions: list[TestFunction]
    is_integration: bool
    category: str               # integration, unit, resilience, manual

@dataclass
class CoverageGap:
    test_name: str
    file_path: str
    reason: str                 # "edge_case", "error_handling", "genuine_gap"
    description: str            # human-readable explanation
```

---

## Testing Strategy

### The skill tests itself

The test coverage skill should be able to analyze its own test suite — meta but useful.

### Test files

| File | Type | What |
|------|------|------|
| `tests/skills/test_coverage/test_analyzer.py` | Unit + Integration | Test the analyzer on the real standards-extractor test suite |
| `tests/skills/test_coverage/test_classifier.py` | Unit + Integration | Test classification heuristics on known test files |
| `tests/skills/test_coverage/test_report_generator.py` | Unit + Integration | Test report output format |

### Acceptance criteria

1. Run on standards-extractor repo → produces report matching manual TEST-COVERAGE.md within 10% accuracy
2. Correctly classifies all 122 integration tests as integration
3. Correctly identifies mock-using tests as unit tests
4. Correctly maps at least 80% of unit↔integration coverage pairs
5. Report format matches existing TEST-COVERAGE.md structure
6. Runs in <30s on 500+ test files

---

## Out of Scope

- Code coverage (line/branch coverage via `coverage.py`) — this is test-level coverage mapping
- Multi-language test analysis (only Python test files for now)
- IDE integration
- CI/CD integration (future — run as post-merge hook)
- Test quality assessment (only coverage mapping, not test effectiveness)
