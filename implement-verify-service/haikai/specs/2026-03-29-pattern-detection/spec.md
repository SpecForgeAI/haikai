# Specification: Design Pattern Detection (Enriched)

## Summary

Upgrade `_detect_patterns()` from 4 hardcoded name-matching heuristics to a multi-signal pattern detector that uses structural data (symbols, inheritance, imports) and precomputed cross-class indices. Output stays the same format (`_patterns.txt`) — just richer, more accurate, with calibrated confidence and specific evidence strings.

---

## Problem

The current detector is shallow:

1. **4 patterns only** — repository, factory, singleton, observer.
2. **Single-class scope** — each class is evaluated in isolation. No cross-class reasoning.
3. **No inheritance awareness** — doesn't use `_inheritance.txt` data.
4. **Static confidence** — factory is always 0.8 if name matches, 0.6 otherwise. No scoring based on how many signals actually match.

---

## Design Principles

1. **Same output format.** `_patterns.txt` stays tab-separated: `pattern\tconfidence\tsymbol\tfile\tevidence`. No schema changes.
2. **Signal-based scoring.** Each pattern defines weighted signals. Confidence = sum of matched signal weights, capped at 0.95. Minimum threshold to emit: 0.4.
3. **Multi-pass detection.** Pass 1: per-class signals (methods, fields, naming). Pass 2: cross-class signals (inheritance, implementations).
4. **Evidence is specific.** Not "factory methods found" but "create_handler(), create_processor() return BaseHandler subclasses; 3 implementations: AuthHandler, LogHandler, CacheHandler".
5. **Extensible pattern registry.** Each pattern is a self-contained detector function. Adding a new pattern = adding one function + registering it.
6. **Emit all, sort by confidence.** No hardcoded deduplication rules. If a class matches both Factory and Builder, emit both. Consumer filters by confidence or picks the top match.

---

## Pattern Catalog

### Implemented (this spec)

| Pattern | Key Signals | Min Confidence |
|---------|-------------|----------------|
| **Repository** | CRUD method names (get/find/save/delete/create/update), name contains "repo"/"repository", extends base repository | 0.4 |
| **Factory** | create_*/build_*/make_* methods, returns base type subclasses, name contains "factory" | 0.4 |
| **Singleton** | _instance field, get_instance/instance method, private constructor | 0.4 |
| **Observer** | subscribe/notify/emit/publish/on/off methods, listener list field | 0.4 |

### TODO: Structural Patterns (future spec)

These require cross-class reasoning via inheritance index. To be implemented after the 4 core patterns are validated on real codebases.

| Pattern | Key Signals | Notes |
|---------|-------------|-------|
| **Builder** | with_*/set_* chains, build() method, name contains "builder" | Per-class, straightforward |
| **Command** | execute() method, undo(), name contains "command"/"action" | Per-class, straightforward |
| **Value Object** | __eq__, __hash__, frozen dataclass, no setters | Per-class, high false-positive risk |
| **Strategy** | ABC with single method + 2+ implementations | Cross-class, needs inheritance index |
| **Template Method** | ABC with mix of concrete + abstract, subclasses override abstract only | Cross-class |
| **Decorator** | Extends same base, holds reference to base type, delegates then augments | Cross-class + inheritance |
| **Adapter** | Wraps foreign class, implements target interface | Cross-class |
| **Composite** | Collection of same base type, same interface as children | Cross-class |

### TODO: Call-Graph Patterns (future spec)

These require `_calls.txt` data. To be implemented after LSP call graph is validated end-to-end.

| Pattern | Key Signals | Notes |
|---------|-------------|-------|
| **Mediator** | High fan-in from 3+ peers, peers don't call each other | Needs call graph |
| **Chain of Responsibility** | Linear delegation chain, same method signature | Needs call graph |
| **Proxy** | All calls delegate 1:1 to target | Needs call graph |
| **Facade** | Fan-out to 3+ internal classes, low fan-in | Needs call graph |

### TODO: LLM-Assisted Confidence (future — needs discussion)

Instead of a minimum-evidence rule (e.g. "must match 2+ signals"), use an LLM pass to evaluate borderline pattern candidates. When a pattern scores between 0.3–0.5 (below threshold but not zero), the detector could optionally pass the class's `.struct` file + matched signals to an LLM for a yes/no judgment with reasoning. This would catch patterns that don't fit neat heuristic rules while avoiding the false-positive flood of lowering the threshold.

**Open questions:**
- Cost: LLM call per borderline candidate — how many per typical repo?
- Latency: acceptable for batch analysis, not for real-time
- Determinism: same code should produce same patterns — cache LLM decisions per commit?
- Where in the pipeline: post-detection filter, or alternative scoring path?

This is deferred. Record as a future spec once the signal-based detector is validated.

---

## Signal Scoring

Each pattern defines a list of signals with weights:

```python
FACTORY_SIGNALS = [
    Signal("name_contains_factory",     weight=0.35, check=lambda ctx: "factory" in ctx.class_name.lower()),
    Signal("has_create_methods",        weight=0.25, check=lambda ctx: len(ctx.create_methods) >= 1),
    Signal("multiple_create_methods",   weight=0.15, check=lambda ctx: len(ctx.create_methods) >= 2),
    Signal("returns_base_subclasses",   weight=0.20, check=lambda ctx: ctx.has_polymorphic_returns),
    Signal("has_implementations",       weight=0.15, check=lambda ctx: len(ctx.implementations) >= 2),
]
# Max possible: 1.10 → capped at 0.95
# Name alone: 0.35 → below 0.4 threshold, not emitted
# Name + one create method: 0.60 → emitted
```

**Confidence formula:**
```
raw = sum(signal.weight for signal in signals if signal.check(context))
confidence = min(0.95, raw)
emit if confidence >= 0.40
```

**Evidence formula:**
```
evidence = "; ".join(signal.description for signal in matched_signals)
```

This means evidence is always a concatenation of the specific signals that fired — no generic strings.

**No deduplication.** All patterns above threshold are emitted. If a class matches both Factory (0.65) and Builder (0.50), both appear in `_patterns.txt`. Consumers sort by confidence and pick what they need.

---

## Detection Context

Each class gets a `PatternContext` assembled once:

```python
@dataclass
class PatternContext:
    class_name: str
    file_path: str
    methods: list[SymbolInfo]          # methods scoped to this class
    method_names: set[str]
    fields: list[SymbolInfo]           # variables/properties scoped to this class
    field_names: set[str]
    bases: list[str]                   # from InheritanceInfo
    implementors: list[str]            # classes that extend this class (from reverse inheritance index)
    siblings: list[str]               # other classes extending same base (from sibling index)
```

**No `all_analyses` reference.** Cross-class data is precomputed into indices and injected into the context:

```python
@dataclass
class CrossClassIndices:
    reverse_inheritance: dict[str, list[str]]   # parent → [children]
    sibling_map: dict[str, list[str]]           # class → [siblings sharing same base]
    class_methods: dict[str, set[str]]          # class_name → {method_names} (for cross-class method comparison)
```

These indices are built once per snapshot and used to populate each `PatternContext`.

---

## Multi-Pass Architecture

```
Pass 1: Build indices
  - Iterate analyses, build reverse_inheritance and sibling_map
  - Build class_methods index for cross-class comparison

Pass 2: Build PatternContext per class
  - Extract methods/fields/bases from analysis
  - Inject implementors/siblings from indices

Pass 3: Run detectors
  - For each class context, run all registered pattern detectors
  - Collect all results above threshold
  - Sort by confidence descending
```

---

## Changes to Existing Code

### `src/ast/store.py`

- Extract `_detect_patterns()` into new module `src/ast/pattern_detector.py`
- `store.py` calls `detect_patterns(analyses)` instead of `self._detect_patterns(analyses)`
- Output format unchanged — still writes `_patterns.txt` with same schema

### New: `src/ast/pattern_detector.py`

```python
def detect_patterns(
    analyses: dict[str, StructuralAnalysis],
) -> list[dict]:
    """Detect design patterns using multi-signal analysis.

    Returns list of dicts with keys: pattern, confidence, symbol, file, evidence
    Sorted by confidence descending.
    """
```

### Backward Compatibility

- `_patterns.txt` format unchanged
- `_stats.txt` pattern summary section unchanged
- Pattern map diagram reads same format
- Only change: better confidence scores, richer evidence strings

---

## Test Strategy

### Unit Tests: Scoring Framework

```python
class TestSignalScoring:
    def test_single_signal_scores_weight(self): ...
    def test_multiple_signals_sum(self): ...
    def test_capped_at_095(self): ...
    def test_below_threshold_not_emitted(self): ...
    def test_evidence_concatenates_matched(self): ...

class TestPatternContext:
    def test_context_built_from_analysis(self): ...
    def test_reverse_inheritance_index(self): ...
    def test_sibling_index(self): ...
```

### Unit Tests: Individual Detectors

Each of the 4 patterns gets focused tests:

```python
class TestRepositoryDetector:
    def test_detects_by_crud_methods(self): ...
    def test_detects_by_name(self): ...
    def test_confidence_increases_with_signals(self): ...
    def test_evidence_lists_matched_signals(self): ...

class TestFactoryDetector:
    def test_detects_by_name_and_methods(self): ...
    def test_rejects_name_only_no_methods(self): ...
    def test_confidence_increases_with_signals(self): ...

class TestSingletonDetector:
    def test_detects_instance_pattern(self): ...

class TestObserverDetector:
    def test_detects_pubsub_methods(self): ...
```

### Integration Tests

```python
class TestPatternDetectionPipeline:
    def test_snapshot_with_patterns(self): ...          # write snapshot, verify _patterns.txt
    def test_patterns_grepable(self): ...               # grep for specific patterns
    def test_confidence_above_threshold(self): ...      # no junk patterns emitted
    def test_evidence_is_specific(self): ...            # no generic evidence strings
    def test_backward_compatible_format(self): ...      # same tab-separated schema
    def test_sorted_by_confidence(self): ...            # highest confidence first
```

### Regression Tests

- Existing `test_detects_factory_pattern` and `test_detects_observer_pattern` must still pass
- New detector should emit same or higher confidence for existing fixtures

---

## Implementation Plan

### Phase 1: Extract + Scaffold

1. Create `src/ast/pattern_detector.py` with Signal, PatternContext, CrossClassIndices
2. Implement `_build_indices()` and `_build_contexts()`
3. Implement `_score_pattern()` scoring logic
4. Migrate existing 4 patterns (repository, factory, singleton, observer) to signal-based format
5. Update `store.py` to call new module, remove `_detect_patterns`
6. Tests: scoring framework + existing pattern tests still pass

### Phase 2: Validation

7. Run against this repo — verify known patterns detected, no false positives above 0.7
8. Tune signal weights if needed
9. Update PROGRESS.md

---

## Out of Scope

- Additional patterns beyond the 4 (see TODO sections above — future specs)
- Call-graph-aware detection (future spec, after LSP validation)
- LLM-assisted confidence (future spec, needs discussion)
- Anti-pattern detection (god class, spaghetti, etc.)
- Custom user-defined patterns
- Language-specific patterns (Python descriptors, Java annotations)
- Pattern visualization beyond existing pattern map diagram
