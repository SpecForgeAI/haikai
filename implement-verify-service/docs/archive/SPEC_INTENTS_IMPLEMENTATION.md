# spec_intents Implementation Summary

## What Changed

### API Input: `feature_descriptions` → `spec_intents`

**Before:**
```json
{
  "feature_descriptions": [
    "Fighter Registration API"
  ]
}
```

**After:**
```json
{
  "spec_intents": [
    "title: Feature Name\n\ncontext: ...\n\ngoal: ...\n\nrequirements: ..."
  ]
}
```

---

## Key Differences

### 1. Input Format

**feature_descriptions:**
- Short text (10+ chars)
- Simple description
- Example: "Add user registration"

**spec_intents:**
- Detailed text blocks (50+ chars)
- Structured format with sections
- Example: Full spec with title, context, goal, scope, requirements, etc.

### 2. Spec Naming

**Before:** API generated spec name from feature description
```python
spec_name = slugify(feature_description)
# "Fighter Registration API" → "fighter-registration-api"
```

**After:** Haikai decides spec name based on intent analysis
```python
# Haikai analyzes the full spec_intent and chooses appropriate name
# Could be: "conversation-persistence", "implement-assistant-stage-7", etc.
```

### 3. Workflow

**Before:**
1. API receives feature_description
2. API generates spec_name
3. API passes both to shape-spec
4. Shape-spec creates directory with that name

**After:**
1. API receives spec_intent (detailed text)
2. API passes spec_intent to Haikai
3. Haikai analyzes intent and decides spec_name
4. Shape-spec creates directory with Haikai chosen name
5. API detects created directory to get spec_name

---

## Implementation Details

### Models Updated

**`ShapeSpecRequest`:**
```python
class ShapeSpecRequest(BaseModel):
    company: str
    project: str
    spec_intents: List[str]  # ← Changed from feature_descriptions
    context_files: Optional[List[str]] = None
```

**`ShapeSpecResult`:**
```python
class ShapeSpecResult(BaseModel):
    spec_name: str  # ← Determined by Haikai
    spec_intent: str  # ← Changed from feature_description
    status: str
    spec_path: str
    requirements_path: Optional[str]
    initialization_path: Optional[str]
    execution_time_seconds: float
    error_message: Optional[str]
```

### API Endpoint Logic

```python
# For each spec_intent:
for spec_intent in request.spec_intents:
    # 1. Pass full spec_intent to Haikai
    system_prompt = f"""You are shaping a specification from this spec intent:

{spec_intent}

Follow the /shape-spec workflow to:
1. Analyze the intent and decide an appropriate spec name
2. Initialize the spec folder structure
3. Research requirements by reviewing the product context files
4. Save complete requirements to planning/requirements.md

Do not ask the user questions - make reasonable assumptions based on best practices 
and the product context files (mission.md, roadmap.md, tech-stack.md).
"""
    
    # 2. Execute shape-spec
    exec_result = cli_executor.execute("/shape-spec", system_prompt)
    
    # 3. Detect created spec directory
    specs_dir = project_dir / "haikai" / "specs"
    spec_dirs = sorted(specs_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
    spec_name = spec_dirs[0].name  # Most recently created
```

---

## Testing Status

### ✅ Completed
- [x] API accepts spec_intents array
- [x] Validation requires 50+ chars per intent
- [x] System prompt passes full intent to Haikai
- [x] API detects created spec directory
- [x] Response includes spec_name chosen by Haikai
- [x] Response truncates spec_intent to 200 chars for readability

### ⏳ Pending Testing
- [ ] Run with real spec_intent example
- [ ] Verify Haikai chooses appropriate spec_name
- [ ] Check requirements.md content
- [ ] Confirm directory structure
- [ ] Test with multiple spec_intents

---

## Next Steps

### 1. Test the Implementation

Run the test request:
```bash
curl -X POST http://localhost:8000/api/v1/haikai/shape-specs \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d @test_spec_intent.json
```

### 2. Analyze Results

Check:
- What spec_name did Haikai choose?
- Is requirements.md well-formatted?
- Does it capture all spec_intent sections?

### 3. Update write-spec Integration

**Current write-spec expects:**
- `spec_id` (directory name)
- Reads from: `haikai/specs/{spec_id}/planning/requirements.md`

**No changes needed if:**
- Shape-spec creates the directory
- requirements.md exists
- spec_name from shape-spec response = spec_id for write-spec

**Possible changes:**
- Update orchestration to pass `spec_names` from shape-spec to write-spec
- Ensure write-spec reads requirements.md correctly

### 4. Update Orchestration Workflow

**Current (from PR #32):**
```python
feature_descriptions → shape-spec → write-spec → create-tasks → implement-tasks
```

**New:**
```python
spec_intents → shape-spec → [spec_names] → write-spec → create-tasks → implement-tasks
```

**Changes needed:**
- OrchestrationRequest: `spec_intents` instead of `feature_descriptions`
- Pass `spec_names` from shape-spec output to subsequent steps
- Update orchestrator to handle Haikai chosen names

---

## Migration Guide

### For API Users

**Before:**
```json
POST /api/v1/haikai/shape-specs
{
  "company": "acme",
  "project": "backend",
  "feature_descriptions": [
    "Add user registration",
    "Implement payment gateway"
  ]
}
```

**After:**
```json
POST /api/v1/haikai/shape-specs
{
  "company": "acme",
  "project": "backend",
  "spec_intents": [
    "title: User Registration System\n\ncontext:\n  Users need to create accounts...\n\ngoal:\n  Implement secure user registration...\n\nrequirements:\n  - Email validation\n  - Password hashing\n  - Email verification",
    "title: Payment Gateway Integration\n\ncontext:\n  Enable payments via Stripe...\n\ngoal:\n  Integrate Stripe payment processing...\n\nrequirements:\n  - Stripe SDK integration\n  - Webhook handling\n  - Payment confirmation"
  ]
}
```

### Response Changes

**spec_name:**
- Before: Generated from feature_description (predictable)
- After: Chosen by Haikai (unpredictable, but more appropriate)

**Use the returned spec_name** for subsequent operations (write-spec, create-tasks, etc.)

---

## Files Modified

### Code
1. `src/haikai_shape_spec_models.py`
   - Changed `feature_descriptions` → `spec_intents`
   - Changed `feature_description` → `spec_intent`
   - Updated validation (50+ chars)

2. `src/api.py`
   - Updated endpoint to use spec_intents
   - Removed spec name generation
   - Added spec directory detection logic
   - Updated system prompt to pass full intent

### Documentation
3. `TEST_SPEC_INTENTS.md` - Testing guide
4. `SPEC_INTENTS_IMPLEMENTATION.md` - This file

---

## Git Status

**Branch:** `fix/shape-spec-naming-and-paths`

**Commits:**
1. `d7a5ad7` - Fix timestamp, profile loading, path format
2. `5fe9f81` - Update API to accept spec_intents
3. `743f0d8` - Add testing documentation

**Status:** Ready for testing and PR

---

## Summary

✅ **API now accepts detailed spec_intents instead of simple feature_descriptions**
✅ **Haikai decides spec names based on intent analysis**
✅ **API detects created directories automatically**
⏳ **Ready for testing to verify Haikai behavior**
⏳ **write-spec integration pending test results**

**Next:** Run test with example spec_intent and report findings!
