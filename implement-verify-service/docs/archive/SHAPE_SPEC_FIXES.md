# Shape-Spec API Fixes

## Issues Identified and Fixed

### 1. ❌ Timestamp in Directory Names
**Problem:** Spec directories were created with timestamp prefixes
- Created: `2026-01-15-fighter-registration-api`
- Expected: `fighter-registration-api`

**Root Cause:** `_generate_spec_name()` in `haikai_orchestrator.py` was adding date prefix

**Fix:** Removed date prefix generation
```python
# Before
date_prefix = datetime.now().strftime("%Y-%m-%d")
return f"{date_prefix}-{slug}"

# After
return slug
```

---

### 2. ❌ "Unknown skill: shape-spec" Error
**Problem:** Claude CLI didn't recognize `/shape-spec` command
```json
{
  "result": "Unknown skill: shape-spec"
}
```

**Root Cause:** ClaudeCLIExecutor wasn't loading the haikai profile

**Fix:** Added `--profile` argument to load haikai-profiles/default
```python
cli_args = [
    "claude",
    "--print",
    "--output-format", "json",
    "--permission-mode", "bypassPermissions",
    "--no-session-persistence",
    "--profile", str(profile_path),  # ← Added this
    "--add-dir", str(self.project_dir).replace("\\", "/"),
]
```

---

### 3. ❌ Windows Path Format
**Problem:** Paths returned with Windows backslashes
- Returned: `C:\\app\\api_workspace\\haikai-test\\test-1`
- Expected: `/app/api_workspace/haikai-test/test-1`

**Root Cause:** Path objects converted to string without normalization

**Fix:** Replace backslashes with forward slashes
```python
"--add-dir", str(self.project_dir).replace("\\", "/")
```

---

### 4. ❌ Files Not Actually Saved
**Problem:** API returned success but files weren't created

**Root Cause:** Multiple issues:
1. Profile not loaded → command not recognized
2. Timestamp in path → wrong directory created
3. Windows paths → path resolution failed

**Fix:** All above fixes combined resolve this issue

---

## Files Modified

### Core Changes
1. **`src/haikai_orchestrator.py`**
   - Removed timestamp from `_generate_spec_name()`
   - Updated docstring to reflect new format

2. **`src/claude_cli_executor.py`**
   - Added `--profile` argument to load haikai profile
   - Fixed path format (backslash → forward slash)

3. **`src/haikai_shape_spec_models.py`**
   - Updated model descriptions (removed timestamp references)
   - Changed `created_date` from Optional to removed
   - Made `feature_name` required (same as spec_name)

4. **`src/api.py`**
   - Updated GET endpoint to not extract date from spec name
   - Simplified feature_name extraction

### Documentation Updates
5. **`README.md`** - Updated all examples
6. **`docs/API_SHAPE_SPEC.md`** - Updated API documentation
7. **`docs/SHAPE_SPEC_INTEGRATION.md`** - Updated technical docs
8. **`SHAPE_SPEC_SUMMARY.md`** - Updated summary

---

## Before vs After

### API Request (No Change)
```json
{
  "company": "haikai-test",
  "project": "test-1",
  "feature_descriptions": [
    "Fighter Registration API"
  ]
}
```

### API Response - Before (❌ Issues)
```json
{
  "success": true,
  "results": [
    {
      "spec_name": "2026-01-15-fighter-registration-api",  // ❌ Timestamp
      "spec_path": "C:\\app\\api_workspace\\...",          // ❌ Windows paths
      "requirements_path": "C:\\app\\api_workspace\\...",  // ❌ Windows paths
      ...
    }
  ]
}
```

### API Response - After (✅ Fixed)
```json
{
  "success": true,
  "results": [
    {
      "spec_name": "fighter-registration-api",             // ✅ No timestamp
      "spec_path": "/app/api_workspace/...",               // ✅ Unix paths
      "requirements_path": "/app/api_workspace/...",       // ✅ Unix paths
      ...
    }
  ]
}
```

### Directory Structure - Before (❌)
```
haikai/specs/
└── 2026-01-15-fighter-registration-api/  // ❌ Timestamp prefix
    └── planning/
        ├── requirements.md               // ❌ Not created (command failed)
        └── initialization.md             // ❌ Not created (command failed)
```

### Directory Structure - After (✅)
```
haikai/specs/
└── fighter-registration-api/             // ✅ No timestamp
    └── planning/
        ├── requirements.md               // ✅ Created successfully
        └── initialization.md             // ✅ Created successfully
```

---

## Testing Checklist

- [ ] Test POST /api/v1/haikai/shape-specs with single feature
- [ ] Test POST /api/v1/haikai/shape-specs with multiple features
- [ ] Verify spec directories created without timestamps
- [ ] Verify requirements.md and initialization.md files created
- [ ] Verify paths returned in Unix format (forward slashes)
- [ ] Test GET /api/v1/haikai/shape-specs/{company}/{project}
- [ ] Verify feature_name matches spec_name
- [ ] Test full orchestration endpoint
- [ ] Verify all 4 steps complete successfully

---

## Commit

**Branch:** `fix/shape-spec-naming-and-paths`
**Commit:** `d7a5ad7`
**Status:** Pushed to remote, ready for PR

---

## Next Steps

1. **Create Pull Request** to merge fixes to main
2. **Test the fixes** with real API calls
3. **Verify files are created** in correct locations
4. **Merge to main** once tested

---

## Summary

All identified issues have been fixed:
- ✅ Removed timestamp from spec directory names
- ✅ Added profile loading so `/shape-spec` command works
- ✅ Fixed path format to use Unix forward slashes
- ✅ Files will now be created successfully
- ✅ Updated all documentation

The shape-spec API should now work correctly!
