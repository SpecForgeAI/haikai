# Tasks: Test Coverage Analysis Skill

## Phase 1 — Core Analysis Engine

- [x] Create `src/skills/test_coverage/` directory structure
- [x] Create `src/skills/test_coverage/models.py` — TestFunction, TestFile, CoverageGap dataclasses
- [x] Create `src/skills/test_coverage/discovery.py` — test file discovery (glob + ast parsing)
  - [x] Find test files matching `test_*.py` / `*_test.py`
  - [x] Parse each file: extract classes, test methods, imports, decorators
  - [x] Handle parse errors gracefully (skip unparseable files with warning)
- [x] Create `src/skills/test_coverage/classifier.py` — test classification
  - [x] Integration detection (directory name, fixture reads, real constructors)
  - [x] Mock detection (unittest.mock imports, @patch, monkeypatch, MagicMock)
  - [x] Resilience detection (error/invalid/empty in name, pytest.raises)
  - [x] Fixture detection (tests/fixtures/ references, @pytest.fixture)
- [x] Integration test: run discovery + classification on real standards-extractor tests
- [x] Verify classification matches manual TEST-COVERAGE.md within 90%

## Phase 2 — Coverage Mapping

- [x] Create `src/skills/test_coverage/mapper.py` — unit↔integration mapping
  - [x] Extract tested module from each test file (by imports from `src/`)
  - [x] Group tests by source module
  - [x] Match unit test files to integration test files covering same module
  - [x] Function-level matching where import targets align
- [x] Create `src/skills/test_coverage/gap_analyzer.py` — gap identification
  - [x] Find unit tests with no integration counterpart
  - [x] Classify as edge_case / error_handling / genuine_gap
  - [x] Generate remediation suggestions
- [x] Integration test: run mapper on real test suite, verify known coverage pairs

## Phase 3 — Report Generation

- [x] Create `src/skills/test_coverage/report.py` — markdown report generator
  - [x] Coverage summary table
  - [x] Integration test file inventory
  - [x] Unit test file breakdown with coverage counts
  - [x] Uncovered tests with classification
  - [x] Branch name and test count from git/pytest
- [x] Create `src/skills/test_coverage/SKILL.md` — haikai skill definition
- [x] Integration test: generate report for standards-extractor, diff against manual version
- [x] Verify report format is valid markdown

## Phase 4 — CLI Entry Point + Polish

- [x] Create `src/skills/test_coverage/cli.py` — command-line interface
  - [x] Accept repo_path, test_dirs, output_path, spec_path arguments
  - [x] Print summary to stdout
  - [x] Write full report to output_path
- [x] Create `src/skills/test_coverage/__init__.py` — package exports
- [x] End-to-end test: run CLI on standards-extractor, verify output
- [x] Run full test suite — verify no regression (34 tests passing)
- [x] Update PROGRESS.md with test coverage skill completion

## Carry-Forward Todo (moved to other specs)

- [x] ~~Snapshot pruning integration test~~ → tracked in structural-store spec
- [x] ~~Update docs~~ → completed in `5f94ea0` (CHANGELOG, ARCHITECTURE, README)
- [x] ~~Pattern detection refactor~~ → tracked in `2026-03-29-pattern-detection/`
- [x] ~~Tree-sitter language expansion~~ → completed and merged to main

## Open Issues

- [ ] Fix PytestCollectionWarning on `TestDiscovery` and `TestCategory` classes (cosmetic — `__init__` constructors trigger pytest collection attempt)
- [ ] Add module-level `FIXTURE = Path(...)` detection improvement to classifier (partially done)
