# Code Review: Adaptive Agentic Discovery

**Date:** 2026-04-11  
**Reviewer:** ABMBot-Master  
**Branch:** `feature/adaptive-agentic-discovery`  
**Commits Reviewed:** 0c9cb8d, 45c3242

---

## Executive Summary

The adaptive agentic discovery implementation successfully addresses the fundamental design flaw identified in previous testing: the "dump everything to LLM" approach that overwhelmed context and caused timeouts. The new architecture uses paginated queries (50-item limit) and direct code exploration tools to enable discovery on languages where tree-sitter extraction fails (Ruby, PHP, Kotlin).

**Verdict:** Architecturally sound with strong potential, but requires hardening before production deployment.

---

## What Was Changed

### Commit 0c9cb8d: Adaptive Agentic Discovery
- Added `list_files()`, `grep()`, `read_directory()` tools to `enrichment_tools.py`
- Enables code exploration when structural store is empty (tree-sitter unsupported languages)
- Added `_build_data_availability()` to both discoverers to assess available data
- Updated agent prompts with fallback investigation strategy

### Commit 45c3242: Pagination
- All `read_*` tools now paginate (offset/limit, default 50)
- Prevents bulk data dumps that burn context
- Added Discourse (Ruby/Rails) test plan: `scripts/test_discourse_discovery.md`
- Modified `read_source()` to truncate full files at 50 lines (was 200)

### Follow-up Changes (This Review)
- **Constants:** Extracted magic numbers (`DEFAULT_LIMIT = 50`, `MAX_FUNCTION_EXTRACT_LINES = 100`)
- **Documentation:** Fixed outdated `read_source()` docstring (200 → 50 lines)
- **Error Handling:** Enhanced logging with turn context, max-turn warnings, tool failure details

---

## Strengths

### ✅ Addresses Core Design Flaw
The pagination + adaptive tools approach directly solves the identified problem. Agent now makes targeted queries instead of dumping thousands of lines.

### ✅ Language-Agnostic Fallback
New tools (`list_files`, `grep`, `read_directory`) enable discovery when tree-sitter can't parse. Critical for Ruby/PHP/Kotlin support.

### ✅ Clean Tool Design
- `_paginate()` helper is reusable and consistent
- Clear continuation hints: `"... (N more, use offset=X)"`
- Well-structured `TOOLS` registry

### ✅ Data Availability Assessment
`_build_data_availability()` informs the agent what data exists, preventing wasted queries on empty structural stores.

### ✅ Good Agent Prompt Structure
- Clear phase-based strategy (Assess → Detect → Find → Read → Classify)
- Adaptive behavior based on data availability
- Examples for each scenario

---

## Issues Identified

### 🔴 High Priority

#### 1. `grep()` Performance Risk
**Location:** `enrichment_tools.py:233-277`

**Problem:**
- No file size limit — will attempt to read giant files (logs, binaries)
- No timeout — could hang on large codebases
- Binary files processed inefficiently despite `errors="replace"`

**Impact:** Could cause timeouts/hangs on repos with large files.

**Recommendation:**
```python
# Add before reading file:
if f.stat().st_size > 1_000_000:  # 1MB limit
    continue
```

#### 2. `list_files()` Unbounded Collection
**Location:** `enrichment_tools.py:205-230`

**Problem:**
- Collects ALL matching files into memory before pagination
- On massive repos (e.g., accidental node_modules inclusion), could OOM or hang

**Impact:** Medium-high — pagination helps but initial collection unbounded.

**Recommendation:**
```python
# Early exit after collecting enough:
if len(matches) >= offset + limit:
    break
```

---

### 🟡 Medium Priority

#### 3. `read_imports("")` Input Validation
**Location:** `enrichment_tools.py:60-73`

**Problem:** No validation on line format — if `_imports.txt` has malformed lines (missing tabs), could silently skip.

**Impact:** Low — unlikely but fragile.

**Recommendation:** Add line format validation in the parsing loop.

#### 4. Agent Prompt Vagueness
**Location:** `discover-endpoints.md:81-84`

**Issue:** "Do not rely on pattern matching. Comprehend the framework." — What does "comprehend" mean for an LLM? This is vague guidance.

**Recommendation:** Clarify with examples of what constitutes "comprehension" vs pattern matching.

#### 5. Test Plan Incomplete
**Location:** `scripts/test_discourse_discovery.md:110-119`

**Missing:**
- No automated test script (marked TODO)
- No success criteria thresholds (mentions "50+" but not asserted)
- No regression comparison (old vs new approach)

**Recommendation:** Implement automated test before merging to main.

---

### 🟢 Low Priority

#### 6. Max Turns Limit
**Location:** `endpoint_discoverer.py:22`

**Question:** Is `MAX_AGENT_TURNS = 30` sufficient for large repos (3000+ files)? Test plan suggests it won't find all endpoints.

**Recommendation:** Consider resume mechanism or configurable turn limits.

#### 7. Magic Numbers in Prompts
**Location:** `discover-endpoints.md:17`

**Issue:** "Prefer targeted queries over broad dumps" — could be more explicit about *why* (context limits, token costs).

**Recommendation:** Add brief rationale in prompt.

---

## Code Quality Assessment

| Aspect | Rating | Notes |
|--------|--------|-------|
| **Correctness** | 7/10 | Core logic sound, but edge cases (large files, malformed data) not handled |
| **Performance** | 6/10 | `grep` and `list_files` could hang on pathological repos |
| **Readability** | 9/10 | Clean, well-documented, consistent style |
| **Maintainability** | 8/10 | Good structure; magic numbers now extracted to constants ✅ |
| **Production Readiness** | 6/10 | Needs hardening (file size limits, timeouts, automated tests) |

---

## Testing Recommendations

### Before Merge
1. **Run Discourse test** (Ruby/Rails) to validate adaptive discovery works
2. **Token efficiency comparison** — measure before/after pagination token usage
3. **Edge case testing:**
   - Repo with 10MB file (should not hang `grep`)
   - Repo with 100k files (should not OOM `list_files`)
   - Malformed structural store data

### Regression Suite
4. **Add automated test** for `test_discourse_discovery.md` plan
5. **Compare results** against old approach (commit 4640767) to prove improvement
6. **Validate pagination** — assert no tool result exceeds 100 lines

---

## Implementation Roadmap

### ✅ Completed (This Review)
- [x] Extract magic numbers to constants
- [x] Fix `read_source()` docstring
- [x] Enhance error handling with turn context and logging

### 🔴 High Priority (Before Merge)
- [ ] Add file size limit to `grep()` (1MB threshold)
- [ ] Optimize `list_files()` with early-exit after `offset + limit` items
- [ ] Write automated test script for Discourse discovery
- [ ] Run Discourse test and validate results

### 🟡 Medium Priority (Before Production)
- [ ] Add input validation to `read_imports()` parsing
- [ ] Clarify "comprehension" guidance in agent prompts
- [ ] Token efficiency comparison test
- [ ] Edge case testing (large files, many files, malformed data)

### 🟢 Low Priority (Future Enhancements)
- [ ] Configurable turn limits or resume mechanism
- [ ] Enhanced prompt rationale (why targeted queries matter)
- [ ] Performance benchmarking on diverse repo sizes

---

## Final Recommendation

**This is a solid architectural improvement** that addresses the core design flaw. The code is clean and the approach is sound. However:

1. **Fix `grep` and `list_files` performance issues** (file size limit, early exit)
2. **Run Discourse test** to validate before merging
3. **Add automated test** to prevent regression

**Once these are complete, this is merge-ready.**

---

## References

- Memory: `2026-04-09.md` — Fundamental design flaw identified
- Memory: `2026-04-09.md` — Regression root cause (tool limits 50 → 200)
- Discourse test plan: `scripts/test_discourse_discovery.md`
- Agent prompts: `haikai-profiles/default/commands/discover-endpoints/`

---

**Reviewed by:** ABMBot-Master  
**Contact:** #standards-extractor (Slack)
