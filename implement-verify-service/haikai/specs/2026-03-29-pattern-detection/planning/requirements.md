# Requirements: Design Pattern Detection (Enriched)

## Feature Description

Upgrade the pattern detection system from 4 hardcoded name-matching heuristics to a multi-signal, multi-pass detector that uses structural data (symbols, inheritance, imports) and precomputed cross-class indices. Same output format (`_patterns.txt`), richer and more accurate detection with calibrated confidence scores and specific evidence strings.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- Existing `src/ast/store.py` (`_detect_patterns()` method — current implementation)
- Existing index files: `_index.txt`, `_inheritance.txt`, `_imports.txt`
- No external dependencies — pure Python pattern matching on structural data

## Requirements

### Pattern Registry
- Self-contained detector function per pattern
- Adding a new pattern = one function + registry entry (no modification of existing detectors)
- Each detector receives: class symbols, methods, fields, inheritance data, cross-class index
- Each detector returns: list of `(pattern, confidence, symbol, file, evidence)` tuples

### Signal-Based Scoring
- Each pattern defines weighted signals (e.g., name match = 0.3, CRUD methods = 0.2, extends base = 0.2)
- Confidence = sum of matched signal weights, capped at 0.95
- Minimum threshold to emit: 0.4
- No hardcoded confidence values (current: factory is always 0.8 if name matches)

### Multi-Pass Detection
- Pass 1: per-class signals (methods, fields, naming conventions)
- Pass 2: cross-class signals (inheritance relationships, interface implementations)
- Cross-class index precomputed once, shared across all detector functions

### Pattern Catalog (initial)
- **Repository** — CRUD methods (get/find/save/delete/create/update), name contains "repo"/"repository", extends base repository
- **Factory** — create_*/build_*/make_* methods, returns base type subclasses, name contains "factory"
- **Singleton** — _instance field, get_instance/instance method, private constructor
- **Observer** — subscribe/notify/emit/publish/on/off methods, listener list field

### Evidence Strings
- Must be specific, not generic: "create_handler(), create_processor() return BaseHandler subclasses; 3 implementations: AuthHandler, LogHandler, CacheHandler"
- Not: "factory methods found"
- Include actual method names, class names, and counts

### Output Format (unchanged)
- `_patterns.txt` tab-separated: `pattern\tconfidence\tsymbol\tfile\tevidence`
- No schema changes — existing consumers unaffected
- Emit all matches sorted by confidence (no deduplication — if a class matches Factory and Builder, emit both)

## Testing Requirements

- Integration tests on real repo code (per project testing policy)
- Before/after comparison on current repo — verify existing patterns still detected
- Test each pattern with a real fixture or real repo class
- Test cross-class detection (e.g., factory with subclass implementations)
- Test confidence calibration (more signals = higher confidence)
- Every unit test must have a corresponding integration test on real data

## Performance Targets

| Operation | Target |
|-----------|--------|
| Pattern detection (500 classes) | <200ms |
| Cross-class index build | <50ms |
| Single pattern detector function | <10ms per class |

## Constraints

- No ML or LLM — pure structural signal matching
- No language-specific patterns (Python descriptors, Java annotations) — work from canonical SymbolKind/InheritanceInfo
- No anti-pattern detection (god class, spaghetti) — positive patterns only
- No custom user-defined patterns (future consideration)

## Out of Scope

- ML-based pattern detection
- Language-specific patterns
- Anti-pattern detection
- Custom user-defined patterns
- Cross-file data flow analysis
- LLM-assisted confidence scoring (noted as future, needs discussion)
