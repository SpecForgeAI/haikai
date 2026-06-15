# Adaptive Discovery Implementation Recommendations

**Last Updated:** 2026-04-11  
**Status:** 🟡 Medium Priority Items Resolved, High Priority Pending

---

## 🔴 High Priority (Blocking Merge)

### 1. Add File Size Limit to `grep()`
**File:** `src/ast/enrichment_tools.py:233-277`  
**Issue:** No file size limit — will attempt to read giant files (logs, binaries)  
**Fix:**
```python
def grep(project_root: str, pattern: str, file_glob: str = "**/*",
         offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    # ... existing code ...
    for f in root.rglob(file_glob):
        if not f.is_file() or any(part in exclude for part in f.parts):
            continue
        # ADD THIS:
        if f.stat().st_size > 1_000_000:  # Skip files > 1MB
            continue
        try:
            text = f.read_text(encoding="utf-8", errors="replace")
            # ... rest of function
```

---

### 2. Optimize `list_files()` Collection
**File:** `src/ast/enrichment_tools.py:205-230`  
**Issue:** Collects ALL files into memory before pagination  
**Fix:**
```python
def list_files(project_root: str, file_pattern: str,
               offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    # ... existing code ...
    matches = []
    for f in root.rglob(file_pattern if file_pattern else "*"):
        if f.is_file() and not any(part in exclude for part in f.parts):
            matches.append(str(f.relative_to(root)).replace("\\", "/"))
            # ADD THIS:
            if len(matches) >= offset + limit + 100:  # Buffer of 100
                break
    # ... rest of function
```

---

### 3. Implement Automated Test Script
**File:** `scripts/test_discourse_discovery.md:110-119` (currently TODO)  
**Action:** Write `scripts/test_discourse.py` that:
- Clones Discourse (or uses existing)
- Builds structural store snapshot
- Runs endpoint + interaction discovery
- Asserts minimum counts (e.g., ≥50 endpoints, ≥20 interactions)
- Asserts no tool result exceeds 100 lines (pagination working)
- Reports token usage per turn

---

### 4. Run Discourse Test
**Prerequisite:** Complete item #3  
**Action:**
```bash
# Clone Discourse
git clone --depth 1 https://github.com/discourse/discourse.git /tmp/discourse

# Build snapshot
python -m src.ast.snapshot /tmp/discourse --output /tmp/discourse-snapshot

# Run test
python scripts/test_discourse.py
```
**Success Criteria:**
- Finds ≥50 endpoints (Rails controllers)
- Finds ≥20 interactions (DB, Redis, Sidekiq, Email)
- No timeouts or hangs
- Token usage significantly lower than pre-pagination baseline

---

## 🟡 Medium Priority (Resolved ✅)

### ~~1. Make Magic Numbers Constants~~ ✅
**Status:** Resolved 2026-04-11  
**Changes:**
- Added `DEFAULT_LIMIT = 50`, `MAX_FUNCTION_EXTRACT_LINES = 100`
- Updated all function signatures to use constants
- Commit: TBD

---

### ~~2. Update `read_source()` Docstring~~ ✅
**Status:** Resolved 2026-04-11  
**Changes:**
- Fixed "truncated to 200 lines" → "truncated to 50 lines"
- Commit: TBD

---

### ~~3. Add Error Handling Context~~ ✅
**Status:** Resolved 2026-04-11  
**Changes:**
- Turn numbers in LLM failure logs
- Max-turn exhaustion warnings
- Tool execution failure logging
- Commit: TBD

---

## 🟢 Low Priority (Future Enhancements)

### 1. Input Validation for `read_imports()`
**File:** `src/ast/enrichment_tools.py:60-73`  
**Issue:** No validation on line format — silently skips malformed lines  
**Impact:** Low — unlikely but fragile  
**Fix:** Add format validation in parsing loop

---

### 2. Clarify Agent Prompt Guidance
**File:** `haikai-profiles/default/commands/discover-endpoints/single-agent/discover-endpoints.md:81-84`  
**Issue:** "Comprehend the framework" is vague  
**Fix:** Add examples of comprehension vs pattern-matching

---

### 3. Configurable Turn Limits
**File:** `src/ast/endpoint_discoverer.py:22`  
**Issue:** `MAX_AGENT_TURNS = 30` may be insufficient for very large repos  
**Fix:** Make configurable or add resume mechanism

---

### 4. Enhance Prompt Rationale
**File:** `discover-endpoints.md:17`  
**Issue:** "Prefer targeted queries" lacks explanation  
**Fix:** Add brief rationale about context limits and token costs

---

## Token Efficiency Test Plan

### Before Pagination (Baseline)
- Run endpoint discovery on Actix (Rust, 162 files)
- Log total input tokens across all turns
- Expected: 50k-100k tokens (bulk dumps)

### After Pagination
- Re-run same test with paginated tools
- Log total input tokens across all turns
- Expected: 10k-20k tokens (targeted queries)
- **Target:** ≥50% reduction in token usage

---

## Edge Case Testing

### Large File Test
```bash
# Create 10MB test file
dd if=/dev/zero of=/tmp/test-repo/large.log bs=1M count=10

# Run grep — should skip the file
python -c "from src.ast.enrichment_tools import grep; print(grep('/tmp/test-repo', 'test'))"
```
**Expected:** Does not hang, skips large.log

---

### Many Files Test
```bash
# Create repo with 100k files
mkdir -p /tmp/many-files
for i in {1..100000}; do touch /tmp/many-files/file$i.txt; done

# Run list_files — should not OOM
python -c "from src.ast.enrichment_tools import list_files; print(list_files('/tmp/many-files', '*.txt', limit=50))"
```
**Expected:** Returns 50 files, does not collect all 100k into memory

---

### Malformed Data Test
```bash
# Create malformed _imports.txt
echo "no-tabs-here" > /tmp/snapshot/_imports.txt

# Run read_imports — should handle gracefully
python -c "from src.ast.enrichment_tools import read_imports; print(read_imports('/tmp/snapshot', ''))"
```
**Expected:** Returns empty or handles gracefully, no crash

---

## Next Steps

1. **Immediate (Pre-Merge):**
   - [ ] Implement grep file size limit
   - [ ] Implement list_files early-exit optimization
   - [ ] Write automated Discourse test script
   - [ ] Run Discourse test and validate

2. **Before Production:**
   - [ ] Token efficiency comparison test
   - [ ] Edge case testing suite
   - [ ] Add input validation where needed

3. **Future:**
   - [ ] Resume mechanism for large repos
   - [ ] Performance benchmarks across repo sizes
   - [ ] Prompt clarity improvements

---

**Maintained by:** ABMBot-Master  
**Review Document:** `docs/reviews/2026-04-11-adaptive-discovery-review.md`
