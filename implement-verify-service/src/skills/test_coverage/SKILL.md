# Skill: test-coverage-analysis

## Description

Analyze a Python test suite to map unit tests to integration tests, classify coverage, identify gaps, and generate a structured TEST-COVERAGE.md report.

Enforces the project testing policy: every unit test MUST have a corresponding integration test that proves it works on real data.

## Trigger

- "analyze test coverage"
- "generate coverage report"
- "check test gaps"
- After completing implementation work on a spec

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| repo_path | `.` | Repository root path |
| test_dirs | `tests/` | Directories containing tests |
| output_path | stdout | Where to write TEST-COVERAGE.md |
| project_name | repo directory name | Name for the report header |

## Steps

1. **Discover** all test files (`test_*.py`, `*_test.py`) in test directories
2. **Parse** each file via Python AST — extract classes, methods, imports, decorators
3. **Classify** each test file:
   - Integration (real data, fixtures, no mocks)
   - Unit covered (mock-based but integration exists for same module)
   - Unit synthetic (mock-based, no integration counterpart)
   - Resilience (edge cases, error handling)
4. **Map** unit tests to integration coverage by source module
5. **Identify** gaps — unit tests with no integration backing
6. **Classify** gaps as edge case, error handling, or genuine gap
7. **Generate** TEST-COVERAGE.md report

## Output

Markdown report with:
- Coverage summary table (categories + percentages)
- Integration test file inventory
- Unit test file breakdown with coverage counts
- Uncovered tests grouped by classification

## Usage

```bash
# Full report to stdout
python -m src.skills.test_coverage.cli .

# Write to file
python -m src.skills.test_coverage.cli . -o TEST-COVERAGE.md

# Summary only
python -m src.skills.test_coverage.cli . --summary

# Custom test directories
python -m src.skills.test_coverage.cli . --test-dirs tests/ integration_tests/
```

## Stop Points

None — fully automated, no human input required.
