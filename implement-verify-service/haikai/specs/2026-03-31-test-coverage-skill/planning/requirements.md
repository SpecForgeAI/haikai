# Requirements: Test Coverage Analysis Skill

## Feature Description

An haikai skill that automatically analyzes a Python test suite to map unit tests to integration tests, classify coverage, identify gaps, and generate a structured TEST-COVERAGE.md report. Enforces the project rule: every unit test must have a corresponding integration test on real data.

## Technology Stack

- Python 3.11+
- Python `ast` module (stdlib) for parsing test files
- `pathlib` for file discovery
- No external dependencies beyond stdlib

## Requirements

### Test Discovery
- Discover test files matching `test_*.py` and `*_test.py` patterns
- Support configurable test directories (default: `tests/`)
- Recurse into subdirectories
- Exclude `__pycache__`, `.git`, `node_modules`
- Parse each file with `ast` module to extract:
  - Test class names
  - Test function/method names (starting with `test_`)
  - Import statements (what modules are being tested)
  - Decorator usage (`@pytest.mark.*`, `@unittest.skip`, etc.)

### Test Classification
- **Integration test detection:**
  - File in `integration/` directory or filename contains `integration`
  - Test reads real files (detects `open()`, `Path().read_text()`, fixture paths)
  - Test calls real constructors without mocking
  - Test uses subprocess or HTTP calls to real endpoints
- **Mock detection:**
  - Imports from `unittest.mock` (Mock, MagicMock, patch, PropertyMock)
  - Uses `monkeypatch` (pytest)
  - Uses `@patch` decorator
  - Creates mock objects inline
- **Resilience test detection:**
  - Tests error handling (expects exceptions: `pytest.raises`, `assertRaises`)
  - Test name contains: `error`, `invalid`, `empty`, `none`, `corrupt`, `fail`, `timeout`, `missing`
  - Tests defensive edge cases that can't occur with real data
- **Fixture detection:**
  - References to `tests/fixtures/` or similar fixture directories
  - `conftest.py` fixture definitions
  - `@pytest.fixture` decorated functions

### Coverage Mapping
- For each unit test file, identify the source module it tests (by imports)
- Find integration test files that also test the same source module
- Match at function level where possible (unit test `test_parse_imports` ↔ integration test that exercises `parse_imports`)
- Track coverage as: { unit_test_file → [integration_test_files_that_cover_it] }

### Gap Analysis
- Flag unit tests with no integration counterpart
- Classify gaps:
  - **Edge case** — tests None, empty, encoding errors, timeouts (acceptable gap)
  - **Error handling** — tests exception paths (acceptable if rare)
  - **Genuine gap** — tests normal behavior with no integration test (needs remediation)
- Provide actionable output: "test X in file Y has no integration coverage — suggested: add fixture for Z"

### Report Generation
- Output: Markdown file matching existing TEST-COVERAGE.md format
- Sections:
  1. Header with date, total tests, branch name
  2. Coverage summary table (categories + percentages)
  3. Integration test file inventory (file, count, what real data)
  4. Unit test file breakdown (file, unit count, covered count, gap count)
  5. Uncovered tests with classification and reason
- Include pytest pass count if available (run `pytest --co -q` for collection)
- Idempotent: running twice produces same output

### Skill Definition
- SKILL.md in `src/skills/test_coverage/`
- Trigger phrases: "analyze test coverage", "generate coverage report", "check test gaps"
- Configurable inputs: repo_path, test_dirs, output_path, spec_path

## Testing Requirements

Per project policy: every unit test MUST have a corresponding integration test on real data.

### Integration Tests (on real standards-extractor test suite)
- `test_discovery_real.py` — discover all test files in standards-extractor, verify count matches reality
- `test_classification_real.py` — classify known integration tests (e.g., `test_treesitter_integration.py` must classify as integration)
- `test_coverage_mapping_real.py` — verify unit↔integration mapping for known pairs (e.g., `test_call_graph.py` ↔ `test_treesitter_integration.py`)
- `test_report_generation_real.py` — generate report for standards-extractor, verify format and approximate accuracy vs manual TEST-COVERAGE.md

### Unit Tests (with integration counterparts)
- Test AST parsing on sample test files
- Test mock detection heuristics
- Test fixture detection
- Test gap classification logic
- Test report formatting

### Acceptance Criteria
1. Discovers all test files (±0 vs manual count)
2. Correctly classifies ≥90% of tests (vs manual classification)
3. Coverage mapping accuracy ≥80% (vs manual TEST-COVERAGE.md)
4. Report format matches existing TEST-COVERAGE.md structure
5. Runs in <30s on 500+ test files
6. No false positives in "genuine gap" classification (conservative: prefer "edge case" when unsure)

## Constraints

- Python test files only (no JS/TS/Go test analysis)
- AST-based analysis only (no code execution for classification)
- Does not measure line/branch coverage (that's `coverage.py` territory)
- Classification heuristics may need tuning per project — should be configurable

## Out of Scope

- Line/branch coverage integration (`coverage.py`)
- Multi-language test analysis
- Test quality scoring
- CI/CD hook integration
- IDE plugin
