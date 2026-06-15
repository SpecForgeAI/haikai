# AST Code Analysis — Verification Gates

## What Are Verification Gates?

A verification gate is a **measurable, binary checkpoint** that must pass before a phase is considered complete. It's the answer to: *"How do we know this actually works and isn't just code that compiles?"*

Each gate has:
- **Claim** — what we're asserting ("ctags integration reduces token usage")
- **Command** — the exact command that proves/disproves the claim
- **Expected output** — what success looks like (specific numbers, not "it should work")
- **Failure action** — what to do if the gate fails

Without these, we're relying on "it should work" — which per sp_verification is never sufficient.

---

## Phase 1 Gates

### Gate 1.1: ctags Produces Valid StructuralAnalysis

**Claim:** CtagsProvider can index a real Python project and return correct symbol data.

**Test fixture:** Use the standards-extractor repo itself as the test subject (~60 Python files).

**Command:**
```bash
pytest tests/ast/test_ctags_provider.py -v -k "test_analyze_real_project"
```

**Expected output:**
```
test_analyze_real_project PASSED
  - Indexed 60+ files in <2 seconds
  - Found ≥200 symbols (classes, functions, methods)
  - Every SymbolInfo has: name, kind, line_range
  - Classes with inheritance have populated InheritanceInfo
  - Zero parse errors
```

**Failure action:** Check ctags installation, verify JSON output format, inspect parser.

---

### Gate 1.2: AST Chunker Splits at Symbol Boundaries

**Claim:** ASTChunker never splits mid-function or mid-class.

**Command:**
```bash
pytest tests/chunking/test_ast_chunker.py -v -k "test_no_mid_function_splits"
```

**Expected output:**
```
test_no_mid_function_splits PASSED
  - Given a 500-line Python file with 12 functions
  - Produced N chunks
  - Every chunk starts at a function/class definition line
  - Every chunk ends at the last line of a function/class body
  - No chunk contains a partial function definition
```

**Failure action:** Inspect symbol line ranges from ctags, verify chunk boundary logic.

---

### Gate 1.3: Token Reduction Is Measurable

**Claim:** When structural data is available, LLM prompts are significantly smaller than raw code prompts.

This is the most important gate. "~99% token reduction" from the spec is the headline promise — we need to prove it.

**How to measure:**

Token count via `tiktoken` (cl100k_base encoding, used by GPT-4/Claude). `tiktoken` is a required dependency — no fallback.

```python
# Token measurement test
def test_token_reduction():
    """Compare token counts: structural vs raw code for same file."""
    import tiktoken
    enc = tiktoken.get_encoding("cl100k_base")

    test_file = "src/file_analyzer.py"  # ~300 lines, known file
    
    raw_content = read_file(test_file)
    raw_tokens = len(enc.encode(raw_content))
    
    structural = ctags_provider.analyze_batch([test_file])[test_file]
    structural_output = format_structural_output(structural)
    structural_tokens = len(enc.encode(structural_output))
    
    reduction = 1 - (structural_tokens / raw_tokens)
    
    assert reduction >= 0.80, f"Expected ≥80% reduction, got {reduction:.0%}"
    print(f"Token reduction: {reduction:.0%} ({raw_tokens} → {structural_tokens})")
```

**Command:**
```bash
pytest tests/ast/test_token_reduction.py -v -s
```

**Expected output:**
```
test_token_reduction PASSED
  Token reduction: 91% (2847 → 256 tokens)
  - Raw code: 2847 tokens (full file content via tiktoken)
  - Structural: 256 tokens (symbols, inheritance, imports)
```

**Why ≥80% not 99%:** The spec claims ~99% for a 500-file project because of triage (skipping files entirely). Per-file reduction will be 80-95%. The 99% number comes from Phase 2's triage (skipping 90% of files from LLM entirely). We measure per-file reduction in Phase 1, project-level reduction in Phase 2.

**Failure action:** If reduction is <80%, structural output formatting is too verbose — trim to essential fields only.

---

### Gate 1.4: Pipeline Backward Compatibility

**Claim:** With ctags disabled, the pipeline behaves identically to before.

**Command:**
```bash
AST_CTAGS_ENABLED=false pytest tests/ -v --tb=short
```

**Expected output:**
```
All existing tests PASS
No regressions
GenericChunker still selected (ASTChunker not invoked)
```

**Failure action:** Provider toggle logic broken — check ProviderRegistry fallback path.

---

### Gate 1.5: Docker Build With ctags

**Claim:** Docker image builds successfully with ctags installed and functional.

**Command:**
```bash
docker build -t standards-extractor:ast-phase1 . && \
docker run --rm standards-extractor:ast-phase1 ctags --version
```

**Expected output:**
```
Universal Ctags X.X.X
  compiled with: ...
```

**Failure action:** Check Dockerfile apt-get line, verify package name for base image.

---

## Phase 2 Gates

### Gate 2.1: Pattern Detection Accuracy

**Claim:** PatternDetector identifies known design patterns in real code with correct confidence scores.

**Test approach:** Create a fixture directory with known patterns:
```
tests/fixtures/patterns/
  factory_pattern.py      # UserFactory with create_user()
  repository_pattern.py   # UserRepository with CRUD methods
  singleton_pattern.py    # DatabasePool with _instance + get_instance()
  false_positive.py       # UserFactory with NO create methods (should not match)
```

**Command:**
```bash
pytest tests/ast/test_pattern_detector.py -v
```

**Expected output:**
```
test_detects_factory_pattern PASSED       → confidence ≥ 0.8
test_detects_repository_pattern PASSED    → confidence ≥ 0.8
test_detects_singleton_pattern PASSED     → confidence ≥ 0.5
test_rejects_false_positive PASSED        → confidence < 0.5 (name match only, no structural evidence)
test_negative_evidence_downgrades PASSED  → UserFactory without create methods → confidence 0.3
```

**Failure action:** Adjust heuristic thresholds, add negative evidence rules.

---

### Gate 2.2: Triage Reduces LLM Calls

**Claim:** Triage logic skips trivial files, reducing total LLM API calls.

**Command:**
```bash
pytest tests/ast/test_triage.py -v -s -k "test_triage_skips_trivial"
```

**Expected output:**
```
test_triage_skips_trivial PASSED
  - 60 files in project
  - Triage classified: 15 complex, 20 moderate, 25 trivial
  - LLM called for: 15 files (complex only)
  - Skipped: 45 files (75% reduction in API calls)
```

**Failure action:** Triage thresholds too aggressive/conservative — adjust complexity scoring.

---

### Gate 2.3: Cache Hit Performance

**Claim:** Second analysis of unchanged files uses cache, completing in <100ms.

**Command:**
```bash
pytest tests/ast/test_caching.py -v -s -k "test_cache_hit_performance"
```

**Expected output:**
```
test_cache_hit_performance PASSED
  - First analysis: 1.2s (ctags runs)
  - Second analysis (same files): 45ms (cache hit)
  - Cache hit rate: 100% for unchanged files
  - Modified file correctly invalidated and re-analyzed
```

**Failure action:** Check SHA-256 hashing, verify cache read/write paths.

---

### Gate 2.4: Project-Level Token Reduction (the 99% claim)

**Claim:** Across a full project, combining per-file structural prompts + triage skipping delivers ≥90% total token reduction.

**Command:**
```bash
pytest tests/ast/test_token_reduction.py -v -s -k "test_project_level_reduction"
```

**Expected output:**
```
test_project_level_reduction PASSED
  - Project: standards-extractor (60 files)
  - Without AST: 60 LLM calls, ~120,000 total tokens
  - With AST (Phase 2): 15 LLM calls, ~3,800 total tokens
  - Project-level reduction: 97%
```

This is where the ~99% claim from the spec gets validated. Phase 1 reduces per-file tokens. Phase 2's triage reduces the *number of files* sent to LLM. Combined effect is multiplicative.

**Failure action:** If <90%, either triage is too conservative (sending too many files to LLM) or structural prompts are too verbose.

---

## Phase 3 Gates

### Gate 3.1: LSP Server Lifecycle

**Claim:** LSP servers start, respond to queries, and shut down cleanly.

**Command:**
```bash
pytest tests/ast/test_lsp_provider.py -v -k "test_server_lifecycle"
```

**Expected output:**
```
test_server_lifecycle PASSED
  - pyright started in <5s
  - documentSymbol returned symbols for test file
  - callHierarchy returned call graph
  - Server shut down cleanly (no orphan processes)
  - No zombie processes after test
```

**Failure action:** Check subprocess management, timeout handling, signal handling.

---

### Gate 3.2: LSP Enriches Pattern Confidence

**Claim:** LSP call graph data upgrades pattern confidence from 0.8 → 1.0.

**Command:**
```bash
pytest tests/ast/test_pattern_detector.py -v -k "test_lsp_confidence_upgrade"
```

**Expected output:**
```
test_lsp_confidence_upgrade PASSED
  - Repository pattern with ctags only: confidence 0.8
  - Same pattern with LSP call graph (save() → db.execute()): confidence 1.0
  - Evidence includes: "save() → Database.execute() (confirmed data access)"
```

---

### Gate 3.3: Graceful LSP Fallback

**Claim:** When LSP server is unavailable, system falls back to ctags without errors.

**Command:**
```bash
AST_LSP_ENABLED=true pytest tests/ast/test_lsp_fallback.py -v
# (with pyright deliberately not installed)
```

**Expected output:**
```
test_lsp_fallback PASSED
  - LSP server not found in PATH
  - Warning logged: "pyright not available, falling back to ctags"
  - Analysis completed using ctags tier
  - No errors, no degradation
  - StructuralAnalysis.provider_used == "ctags"
```

---

## Summary: Phase Completion Criteria

| Phase | Complete When ALL Gates Pass |
|-------|------------------------------|
| **Phase 1** | 1.1 (ctags valid) + 1.2 (chunking boundaries) + 1.3 (≥80% per-file token reduction) + 1.4 (backward compat) + 1.5 (Docker build) |
| **Phase 2** | 2.1 (pattern accuracy) + 2.2 (triage reduces calls) + 2.3 (cache performance) + 2.4 (≥90% project-level token reduction) |
| **Phase 3** | 3.1 (LSP lifecycle) + 3.2 (confidence upgrade) + 3.3 (graceful fallback) |

No phase ships until every gate in that phase passes with evidence (actual command output, not "should work").
