# Task Breakdown: Enriched Pattern Detection

## Overview
Total Tasks: 2 phases, 12 sub-tasks

**Goal:** Extract `_detect_patterns()` into a signal-based framework, migrate the existing 4 patterns (repository, factory, singleton, observer) to use weighted signals with calibrated confidence and specific evidence strings. No new patterns — just better infrastructure and accuracy for the existing 4.

**Key Design Principles:**
1. **Signal-based scoring.** Confidence = sum of weighted signal matches, capped at 0.95, threshold 0.40.
2. **Evidence = concatenation of matched signals.** No generic strings.
3. **Emit all, sort by confidence.** No hardcoded deduplication rules.
4. **No `all_analyses` on context.** Cross-class data via precomputed indices only.
5. **Same output format.** `_patterns.txt` schema unchanged — backward compatible.

**Reference Documents:**
- Spec: `spec.md`
- Existing implementation: `src/ast/store.py:_detect_patterns()` (lines 420-492)

## Task List

### Phase 1: Extract + Scaffold

#### Task Group 1: Signal Framework + Migration
**Dependencies:** None

- [ ] 1.0 Extract and scaffold pattern detection module
  - [ ] 1.1 Create `src/ast/pattern_detector.py`
    - `Signal` dataclass: name, weight, check (callable), description
    - `PatternContext` dataclass: class_name, file_path, methods, method_names, fields, field_names, bases, implementors, siblings
    - `CrossClassIndices` dataclass: reverse_inheritance, sibling_map, class_methods
    - `detect_patterns(analyses) -> list[dict]` — public API
    - `_build_indices(analyses) -> CrossClassIndices`
    - `_build_contexts(analyses, indices) -> list[PatternContext]`
    - `_score_pattern(signals, context) -> tuple[float, str]` — returns (confidence, evidence)
  - [ ] 1.2 Migrate repository detector to signal-based
    - Signals: name contains "repo"/"repository" (0.30), CRUD overlap >=2 (0.25), CRUD overlap >=3 (0.20), extends base repository (0.15)
    - Evidence: specific CRUD methods found, base class if any
  - [ ] 1.3 Migrate factory detector to signal-based
    - Signals: name contains "factory" (0.35), has create_*/build_*/make_* >=1 (0.25), multiple create methods (0.15), returns subclasses (0.20), has implementations (0.15)
    - Evidence: specific factory methods found, implementations if any
  - [ ] 1.4 Migrate singleton detector to signal-based
    - Signals: has _instance field (0.30), has get_instance method (0.30), has private constructor (0.20), name suggests singleton (0.15)
    - Evidence: specific fields/methods found
  - [ ] 1.5 Migrate observer detector to signal-based
    - Signals: subscribe/notify overlap >=2 (0.35), overlap >=3 (0.20), has listener field (0.20), name suggests observer/eventbus (0.20)
    - Evidence: specific pub/sub methods found
  - [ ] 1.6 Update `store.py` to call `detect_patterns()` from new module
    - Replace `self._detect_patterns(analyses)` with `detect_patterns(analyses)`
    - Remove `_detect_patterns` method from FileStore
  - [ ] 1.7 Write tests: `tests/ast/test_pattern_detector.py`
    - **Scoring framework:**
      - Test single signal scores its weight
      - Test multiple signals sum correctly
      - Test cap at 0.95
      - Test below 0.40 threshold not emitted
      - Test evidence concatenates matched signal descriptions only
    - **PatternContext:**
      - Test context built from StructuralAnalysis
      - Test reverse inheritance index (parent → children)
      - Test sibling index (class → siblings sharing same base)
    - **Repository detector:**
      - Test detects by CRUD methods (get, find, save, delete)
      - Test detects by name ("UserRepository")
      - Test confidence increases with more signals
      - Test evidence is specific ("CRUD methods: get, save, delete")
    - **Factory detector:**
      - Test detects by name + create methods
      - Test name alone below threshold (0.35 < 0.40)
      - Test confidence increases with signals
    - **Singleton detector:**
      - Test detects _instance + get_instance combo
    - **Observer detector:**
      - Test detects subscribe + notify methods
      - Test confidence increases with more event methods
  - [ ] 1.8 Verify regression: existing `test_store.py` pattern tests still pass
    - `test_detects_factory_pattern` — same or better confidence
    - `test_detects_observer_pattern` — same or better confidence

**Acceptance Criteria:**
- `_detect_patterns` removed from store.py, replaced by import from pattern_detector
- All 4 patterns produce same or better results via signal scoring
- Evidence strings are specific (no "found" or "detected" generics)
- Results sorted by confidence descending
- All 276+ existing tests pass unchanged
- New test file covers scoring framework + all 4 detectors

---

### Phase 2: Validation

#### Task Group 2: Real-World Validation + Polish
**Dependencies:** Task Group 1

- [ ] 2.0 Validate against real codebase
  - [ ] 2.1 Run pattern detection on standards-extractor
    - Verify ProviderRegistry, FileStore, or similar classes detected appropriately
    - Verify no false positives above 0.7 confidence
    - Document any weight adjustments needed
  - [ ] 2.2 Tune signal weights if needed
    - Adjust based on validation results
    - Re-run tests after any weight changes
  - [ ] 2.3 Update PROGRESS.md
  - [ ] 2.4 Commit and push

**Acceptance Criteria:**
- Pattern detection validated against real codebase
- No false positives above 0.7 confidence
- All tests pass
- PROGRESS.md updated

---

## Execution Order

1. **Phase 1: Extract + Scaffold** — new module, signal framework, migrate 4 patterns, tests
2. **Phase 2: Validation** — run against real code, tune, ship

## Completion Criteria

Feature is complete when ALL of the following are true:
- `pattern_detector.py` extracts cleanly from store.py
- Signal + PatternContext + CrossClassIndices framework in place
- 4 existing patterns migrated to signal-based scoring
- Confidence scores calibrated (weighted signals, 0.40 threshold, 0.95 cap)
- Evidence strings are specific concatenations of matched signals
- No deduplication rules — emit all, sorted by confidence
- `_patterns.txt` format unchanged — backward compatible
- All existing tests pass + new test coverage
- Validated against this repo

## Future Work (TODO — separate specs)

- [ ] 8 additional structural patterns: builder, command, value object, strategy, template method, decorator, adapter, composite
- [ ] 4 call-graph patterns: mediator, chain of responsibility, proxy, facade
- [ ] LLM-assisted confidence for borderline candidates (0.3–0.5 range) — needs discussion on cost, latency, determinism, caching
