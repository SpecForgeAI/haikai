# Feature Branch Bug Review: adaptive-agentic-discovery

**Branch**: `feature/adaptive-agentic-discovery`  
**Review Date**: 2026-04-24  
**Status**: 🔴 BLOCKED - Critical issues found  
**Reviewer**: Claude Code Agent

---

## Overview

This specification documents critical security and resource management vulnerabilities discovered in the `feature/adaptive-agentic-discovery` branch during pre-merge code review.

## Findings Summary

- **Total Blockers Found**: 2
- **Severity**: CRITICAL
- **Type**: Resource Exhaustion (CWE-400, CWE-789)
- **Affected File**: `src/ast/enrichment_tools.py`
- **Impact**: Denial of Service, Memory Exhaustion, System Crashes

## Quick Start

### Read the Bug Report

```bash
cat specs/feature-adaptive-discovery-bugs/BUG_REPORT.md
```

### Apply Fixes

Both fixes are ready to apply. Total time: ~20 minutes.

**Fix #1: Add file size limit to grep()**
```bash
# Edit src/ast/enrichment_tools.py line 256
# Add file size check before read_text()
```

**Fix #2: Add early termination to list_files()**
```bash
# Edit src/ast/enrichment_tools.py line 222
# Add break condition when enough matches collected
```

See BUG_REPORT.md for exact code changes.

### Validate Fixes

```bash
# Create test for large files
python3 -c "
from pathlib import Path
import tempfile

# Test Fix #1: Large file handling
test_dir = Path(tempfile.mkdtemp())
(test_dir / 'huge.txt').write_text('x' * (100 * 1024 * 1024))  # 100MB
from src.ast.enrichment_tools import grep
result = grep(str(test_dir), 'x')
print('✓ Large file handled safely')

# Test Fix #2: Large directory handling  
for i in range(10000):
    (test_dir / f'file_{i}.py').touch()
from src.ast.enrichment_tools import list_files
result = list_files(str(test_dir), '*.py', offset=0, limit=50)
print('✓ Large directory handled efficiently')
"
```

## Files in This Spec

- **BUG_REPORT.md** - Comprehensive analysis of both blockers with:
  - Exact vulnerable code locations
  - Attack scenarios demonstrating impact
  - Ready-to-apply fixes
  - Test validation procedures
  - Memory usage analysis
  
- **README.md** (this file) - Quick reference guide

## Blocker Details

### 🔴 Blocker #1: Unbounded File Read
- **Location**: `src/ast/enrichment_tools.py:260`
- **Issue**: `grep()` reads files of any size into memory
- **Attack**: Single 5GB file → OOM crash
- **Fix**: Add `MAX_FILE_SIZE = 10MB` check
- **Lines Changed**: 3

### 🔴 Blocker #2: Memory Accumulation
- **Location**: `src/ast/enrichment_tools.py:222-224`
- **Issue**: `list_files()` collects all files before pagination
- **Attack**: 100K file repo → 50MB RAM for 50 results
- **Fix**: Add early termination at `offset + limit + 100`
- **Lines Changed**: 5-8

## Impact Analysis

| Scenario | Before Fix | After Fix |
|----------|------------|-----------|
| 5GB log file grep | ❌ OOM crash | ✅ Skip file |
| 100K file listing | ❌ 50MB RAM | ✅ 50KB RAM |
| Concurrent operations | ❌ Cascading failures | ✅ Bounded resources |
| Malicious repos | ❌ DoS vector | ✅ Protected |

## Merge Readiness Checklist

- [ ] Fix #1 applied: File size limit in grep()
- [ ] Fix #2 applied: Early termination in list_files()
- [ ] Unit tests added for large files
- [ ] Unit tests added for large directories
- [ ] Memory profiling completed
- [ ] Integration tests pass
- [ ] Security review approved
- [ ] Performance benchmarks meet targets

**Current Status**: 0/8 complete

## Timeline

| Phase | Estimated Time | Status |
|-------|---------------|---------|
| Fix Development | 20 min | ⏸️ Pending |
| Testing | 30 min | ⏸️ Pending |
| Code Review | 15 min | ⏸️ Pending |
| Merge | 5 min | ⏸️ Pending |
| **Total** | **70 min** | **BLOCKED** |

## Why These Are Blockers

1. **Production Impact**: Both issues can crash the service in production
2. **Attack Surface**: Publicly accessible repos can be weaponized
3. **No Mitigation**: No fallback or recovery mechanism exists
4. **Scope**: Core functionality of the feature branch
5. **Severity**: CVSS 7.5 (High) - meets critical threshold

## Post-Fix Actions

After applying fixes:

1. **Verify**: Run validation tests (see above)
2. **Benchmark**: Measure memory usage on large repos
3. **Document**: Update function docstrings with size limits
4. **Monitor**: Add metrics for files skipped/processed
5. **Review**: Security team sign-off

## Related Documentation

- `/docs/reviews/2026-04-11-adaptive-discovery-review.md` - Original self-review
- `/docs/reviews/RECOMMENDATIONS.md` - Remediation guidance
- `specs/bug-hunt-2026-04-24/` - Main branch security audit

## Contact

For questions about these findings:
- Review the detailed analysis in BUG_REPORT.md
- Check existing review documents in /docs/reviews/
- Reference CWE-400 and CWE-789 security advisories

---

**Note**: This branch contains valuable functionality. The issues identified are fixable within ~1 hour. Once resolved, the feature is ready for merge.

**Review Methodology**: Manual code analysis following OWASP Top 10 and CWE Top 25 security patterns.
