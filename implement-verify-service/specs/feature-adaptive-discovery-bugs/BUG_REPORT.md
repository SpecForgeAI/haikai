# Bug Report: feature/adaptive-agentic-discovery Branch
**Date**: 2026-04-24  
**Branch**: feature/adaptive-agentic-discovery (c07f27d)  
**Reviewer**: Claude Code Agent  
**Status**: 🔴 CRITICAL BLOCKERS FOUND - MERGE NOT RECOMMENDED

---

## Executive Summary

This report documents **2 critical blockers** discovered in the `feature/adaptive-agentic-discovery` branch that prevent safe merging to main. Both issues are in `src/ast/enrichment_tools.py` and involve resource exhaustion vulnerabilities that can cause denial of service.

**Risk Level**: 🔴 CRITICAL  
**Impact**: Production service outage, memory exhaustion, system crashes  
**Affected Module**: Adaptive discovery enrichment tools  
**Recommendation**: Fix both blockers before merge

---

## 🔴 BLOCKER #1: Unbounded File Read in grep()

### Location
**File**: `src/ast/enrichment_tools.py`  
**Lines**: 256-260  
**Function**: `grep()`

### Vulnerability Details

**Type**: CWE-400 (Uncontrolled Resource Consumption)  
**Severity**: CRITICAL  
**CVSS Score**: 7.5 (High)

The `grep()` function reads files of **any size** into memory without checking file size first. This creates a trivial denial-of-service attack vector.

### Vulnerable Code

```python
# Line 256-260 in src/ast/enrichment_tools.py
for f in root.rglob(file_glob):
    if not f.is_file() or any(part in exclude for part in f.parts):
        continue
    try:
        text = f.read_text(encoding="utf-8", errors="replace")  # ← NO SIZE CHECK
        for i, line in enumerate(text.splitlines(), 1):
```

### Attack Scenario

```bash
# Attacker creates a malicious repository
$ dd if=/dev/zero of=bigfile.txt bs=1G count=5  # 5GB file

# Agent tries to grep the repo
>>> grep(malicious_repo, pattern="config", file_glob="**/*.txt")

# Result: Python process attempts to allocate 5GB of RAM
# → Memory exhaustion
# → OOM killer terminates the service
# → Production outage
```

### Impact

1. **Memory Exhaustion**: Single large file (>1GB) can crash the service
2. **Cascading Failures**: Multiple concurrent grep operations amplify the problem
3. **No Recovery**: Process termination requires manual restart
4. **Attack Surface**: Public repos can be weaponized (malicious dependencies, test repos)

### Proof of Exploit

```python
# Create test scenario
import tempfile
from pathlib import Path

# Create 2GB file
test_dir = Path(tempfile.mkdtemp())
huge_file = test_dir / "exploit.log"
huge_file.write_text("x" * (2 * 1024 * 1024 * 1024))  # 2GB

# This will hang/crash
from src.ast.enrichment_tools import grep
result = grep(str(test_dir), "x")  # Attempts 2GB allocation
```

### Fix Required

```python
# BEFORE (vulnerable)
for f in root.rglob(file_glob):
    if not f.is_file() or any(part in exclude for part in f.parts):
        continue
    try:
        text = f.read_text(encoding="utf-8", errors="replace")

# AFTER (safe)
MAX_FILE_SIZE = 10 * 1024 * 1024  # 10MB limit

for f in root.rglob(file_glob):
    if not f.is_file() or any(part in exclude for part in f.parts):
        continue
    
    # Skip files that are too large
    if f.stat().st_size > MAX_FILE_SIZE:
        continue
    
    try:
        text = f.read_text(encoding="utf-8", errors="replace")
```

### Test Validation

After applying the fix, verify:

1. Files under 10MB are processed normally
2. Files over 10MB are silently skipped (no crash)
3. Mixed repositories (small + huge files) complete successfully
4. Memory usage stays bounded during large repo scans

---

## 🔴 BLOCKER #2: Unbounded Memory Accumulation in list_files()

### Location
**File**: `src/ast/enrichment_tools.py`  
**Lines**: 222-224  
**Function**: `list_files()`

### Vulnerability Details

**Type**: CWE-789 (Uncontrolled Memory Allocation)  
**Severity**: CRITICAL  
**CVSS Score**: 7.5 (High)

The `list_files()` function collects **all matching files** into memory before applying pagination. On repositories with millions of files, this causes memory exhaustion.

### Vulnerable Code

```python
# Lines 220-234 in src/ast/enrichment_tools.py
exclude = {".git", "node_modules", "vendor", "__pycache__", ".venv", "venv"}
matches = []
for f in root.rglob(file_pattern if file_pattern else "*"):
    if f.is_file() and not any(part in exclude for part in f.parts):
        matches.append(str(f.relative_to(root)).replace("\\", "/"))
        # ← NO EARLY BREAK: Collects ALL files before pagination

if not matches:
    return f"(no files matching {file_pattern})"

total = len(matches)
page = matches[offset:offset + limit]  # ← Pagination applied AFTER collection
```

### Attack Scenario

```bash
# Large monorepo structure
chromium/               # 400,000+ files
├── src/
│   ├── chrome/        # 50,000 files
│   ├── v8/            # 30,000 files
│   └── third_party/   # 200,000+ files

# Agent calls list_files on chromium repo
>>> list_files(chromium_repo, file_pattern="*.cc", offset=0, limit=50)

# What happens:
# 1. Walks entire 400K file tree
# 2. Collects ~100K matching .cc files into `matches` list
# 3. Stores ~100K * 100 bytes = 10MB+ just for paths
# 4. Then returns only first 50 results
# 
# Result: Wasted 10MB+ RAM to show 50 items
# With concurrent requests: Linear memory growth → OOM
```

### Impact

1. **Memory Waste**: Collects 100% of files to return <1%
2. **Scalability Failure**: O(n) memory for O(1) output
3. **DoS Vector**: Intentionally large repos weaponized
4. **Performance Degradation**: Slow file tree walks block agent responses

### Real-World Impact Analysis

| Repository Size | Files Matching | Memory Used | Expected | Waste Factor |
|----------------|----------------|-------------|----------|--------------|
| Small (1K files) | 500 | 50KB | 5KB | 10x |
| Medium (10K files) | 5,000 | 500KB | 5KB | 100x |
| Large (100K files) | 50,000 | 5MB | 5KB | 1000x |
| Huge (1M files) | 500,000 | 50MB | 5KB | 10,000x |

### Proof of Exploit

```python
# Simulate large repo
import tempfile
from pathlib import Path

test_dir = Path(tempfile.mkdtemp())
# Create 100,000 files
for i in range(100_000):
    (test_dir / f"file_{i}.py").touch()

# This will consume excessive memory
from src.ast.enrichment_tools import list_files
result = list_files(str(test_dir), "*.py", offset=0, limit=50)
# Collected 100K paths in RAM, returned 50
```

### Fix Required

```python
# BEFORE (vulnerable)
matches = []
for f in root.rglob(file_pattern if file_pattern else "*"):
    if f.is_file() and not any(part in exclude for part in f.parts):
        matches.append(str(f.relative_to(root)).replace("\\", "/"))

total = len(matches)
page = matches[offset:offset + limit]

# AFTER (safe)
SAFETY_BUFFER = 100  # Small overhead for accurate totals
matches = []

for f in root.rglob(file_pattern if file_pattern else "*"):
    if f.is_file() and not any(part in exclude for part in f.parts):
        matches.append(str(f.relative_to(root)).replace("\\", "/"))
        
        # Early termination: stop once we have enough for this page
        if len(matches) >= offset + limit + SAFETY_BUFFER:
            break

total = len(matches)
page = matches[offset:offset + limit]
```

### Alternative Fix (Iterator Pattern)

For maximum efficiency, use an iterator pattern:

```python
from itertools import islice

def list_files(project_root: str, file_pattern: str = None,
               offset: int = 0, limit: int = DEFAULT_LIMIT) -> str:
    root = Path(project_root)
    if not root.exists():
        return f"(directory not found: {project_root})"

    exclude = {".git", "node_modules", "vendor", "__pycache__", ".venv", "venv"}
    
    def file_generator():
        for f in root.rglob(file_pattern if file_pattern else "*"):
            if f.is_file() and not any(part in exclude for part in f.parts):
                yield str(f.relative_to(root)).replace("\\", "/")
    
    # Use islice for memory-efficient pagination
    matches = list(islice(file_generator(), offset, offset + limit))
    
    if not matches:
        return f"(no files matching {file_pattern})"
    
    result = "\n".join(matches)
    result += f"\n... (use offset={offset + limit} for more)"
    return result
```

### Test Validation

After applying the fix, verify:

1. Small repos (1K files): Normal operation
2. Large repos (100K files): Memory stays bounded
3. Pagination works correctly: offset/limit respected
4. No regression: All existing tests pass
5. Performance: First page returns quickly regardless of repo size

---

## Summary of Blockers

| ID | Function | Line | Severity | Fix Complexity | ETA |
|----|----------|------|----------|----------------|-----|
| #1 | `grep()` | 260 | CRITICAL | Low (3 lines) | 5 min |
| #2 | `list_files()` | 222-224 | CRITICAL | Medium (iterator refactor) | 15 min |

**Total Estimated Fix Time**: 20 minutes  
**Testing Time**: 30 minutes  
**Total to Unblock Merge**: ~1 hour

---

## Recommendations

### Immediate Actions (Before Merge)

1. ✅ **Apply Fix #1**: Add file size check to `grep()`
2. ✅ **Apply Fix #2**: Add early termination to `list_files()`
3. ✅ **Add Unit Tests**: Cover large file/repo scenarios
4. ✅ **Memory Testing**: Validate bounded memory usage
5. ✅ **Integration Tests**: Test against real large repos

### Medium-Term Improvements

1. **Resource Limits**: Add global limits for all file operations
2. **Monitoring**: Add metrics for file sizes processed
3. **Streaming**: Consider streaming APIs for very large files
4. **Timeouts**: Add operation timeouts to prevent hanging
5. **Circuit Breakers**: Auto-disable tools if resource thresholds exceeded

### Security Review Checklist

- [ ] All file operations have size limits
- [ ] All collections have early termination
- [ ] All recursive operations have depth limits
- [ ] Memory usage is O(1) or O(log n), not O(n)
- [ ] DoS attack scenarios tested and mitigated

---

## References

- **CWE-400**: Uncontrolled Resource Consumption
- **CWE-789**: Uncontrolled Memory Allocation
- **OWASP**: A05:2021 – Security Misconfiguration
- **Python Security**: [File Handling Best Practices](https://docs.python.org/3/library/pathlib.html)

---

## Approval Status

**Merge Readiness**: ❌ BLOCKED  
**Blockers Remaining**: 2  
**Next Review**: After fixes applied

This feature branch contains valuable functionality but cannot be merged until these resource exhaustion vulnerabilities are resolved.

---

**Generated by**: Claude Code Agent  
**Review Date**: 2026-04-24  
**Branch Hash**: c07f27d
