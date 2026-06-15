# Testing Shape-Spec with spec_intents

## API Changes Summary

### Before (feature_descriptions)
```json
{
  "company": "haikai-test",
  "project": "test-1",
  "feature_descriptions": [
    "Fighter Registration API"
  ]
}
```

### After (spec_intents)
```json
{
  "company": "haikai-test",
  "project": "test-1",
  "spec_intents": [
    "title: Implement Assistant Stage 7 — Full Conversation and Execution Persistence to Disk\n\ncontext:\n  Implement Assistant conversations are first-class artefacts...\n\ngoal:\n  Persist a complete, deterministic, human-readable record of...\n\nrequirements:\n  gateway:\n    - Maintain an in-memory transcript buffer..."
  ]
}
```

---

## Test Request

```bash
curl -X POST http://localhost:8000/api/v1/haikai/shape-specs \
  -H "Authorization: Bearer changeit" \
  -H "Content-Type: application/json" \
  -d @test_spec_intent.json
```

**test_spec_intent.json:**
```json
{
  "company": "haikai-test",
  "project": "test-1",
  "spec_intents": [
    "title: Implement Assistant Stage 7 — Full Conversation and Execution Persistence to Disk\n\ncontext:\n  Implement Assistant conversations are first-class artefacts in a Specification-Driven\n  Development (SDD) workflow. They must capture not only the interactive planning discussion,\n  but also the final handoff plan and the execution event that follows. With the introduction\n  of staged handoff planning (single vs multiple sub-intents) and execution via an external\n  Orchestration Service, persistence must reflect the full lifecycle from bootstrap through\n  execution.\n\ngoal:\n  Persist a complete, deterministic, human-readable record of:\n    - the full Planner LLM conversation\n    - all system prompts and injected context\n    - the final validated handoff plan (handoff_intents array)\n    - the external orchestration execution request and response\n  into a single on-disk artefact per feature.\n\nscope:\n  - Gateway persistence and filesystem logic only\n  - Applies only to mode=implement_feature conversations\n  - Covers all phases: bootstrap, refine, handoff, execution\n  - File-based persistence only (no database)\n  - No UI changes required\n\npersistence_location:\n  - All artefacts MUST be written under:\n      <project_parent_folder>/conversations/<feature_name_and_id>/\n  - The primary file MUST be:\n      full-conversation.txt\n  - <feature_name_and_id> MUST be deterministic and filesystem-safe.\n\nrequirements:\n  gateway:\n    - Maintain an in-memory transcript buffer for each implement_feature conversation that\n      appends entries for:\n        - system prompt\n        - user message\n        - assistant response\n        - phase\n    - On receipt of a valid phase=handoff Planner response:\n        - Append the validated handoff plan JSON to the transcript buffer as a dedicated entry.\n    - On execution via the external Orchestration Service:\n        - Append an execution record entry to the transcript buffer containing request metadata\n          and response data as defined above.\n    - On completion of orchestration execution (success or failure):\n        - Flush the entire transcript buffer to:\n            <project_parent_folder>/conversations/<feature_name_and_id>/full-conversation.txt\n        - File write MUST be atomic (write temp file, then rename).\n\nacceptance_criteria:\n  - After a complete Implement Assistant flow ending in execution:\n      - A full-conversation.txt file exists at the correct path.\n  - The file contains:\n      - bootstrap system prompt and assistant welcome message\n      - all refine-phase exchanges\n      - the final Planner handoff plan JSON\n      - the orchestration execution request metadata and response\n  - The ordering of entries matches the real execution order.\n  - Execution and UI behavior are unaffected if persistence fails."
  ]
}
```

---

## Expected Response

```json
{
  "success": true,
  "results": [
    {
      "spec_name": "???",  // ← Haikai decides this!
      "spec_intent": "title: Implement Assistant Stage 7 — Full Conversation and Execution Persistence to Disk\n\ncontext:\n  Implement Assistant conversations are first-class artefacts...",
      "status": "success",
      "spec_path": "/app/api_workspace/haikai-test/test-1/haikai/specs/???",
      "requirements_path": "/app/api_workspace/haikai-test/test-1/haikai/specs/???/planning/requirements.md",
      "initialization_path": "/app/api_workspace/haikai-test/test-1/haikai/specs/???/planning/initialization.md",
      "execution_time_seconds": 15.5,
      "error_message": null
    }
  ],
  "total_execution_time_seconds": 15.5,
  "timestamp": "2026-01-15T..."
}
```

---

## What We're Testing

1. **Spec Name Decision**
   - What name does Haikai choose for this spec?
   - Is it descriptive and filesystem-safe?
   - Example possibilities:
     - `conversation-persistence`
     - `implement-assistant-stage-7`
     - `full-conversation-persistence`

2. **Directory Structure**
   ```
   haikai/specs/
   └── {haikai-chosen-name}/
       ├── planning/
       │   ├── initialization.md
       │   └── requirements.md
       └── implementation/
   ```

3. **requirements.md Content**
   - Does it capture all the structured fields from spec_intent?
   - Is it well-formatted and complete?
   - Does it reference the product context files?

4. **Output for write-spec**
   - The `spec_name` from the response becomes the `spec_id` for write-spec
   - write-spec will read from: `haikai/specs/{spec_name}/planning/requirements.md`

---

## Next Steps After Testing

1. **Verify the output**
   - Check what spec_name was chosen
   - Review requirements.md content
   - Confirm directory structure

2. **Update write-spec integration**
   - Modify write-spec to accept `spec_ids` (directory names)
   - Remove dependency on feature_descriptions
   - Read from requirements.md instead

3. **Update orchestration workflow**
   - Step 0: shape-spec → creates spec directories + requirements.md
   - Step 1: write-spec → reads requirements.md, creates spec.md
   - Step 2: create-tasks → reads spec.md, creates tasks.md
   - Step 3: implement-tasks → reads tasks.md, implements

---

## Prerequisites for Testing

1. **Product files must exist:**
   ```
   /app/api_workspace/haikai-test/test-1/haikai/product/
   ├── mission.md
   ├── roadmap.md
   └── tech-stack.md
   ```

2. **API server must be running:**
   ```bash
   cd /path/to/standards-extractor
   uvicorn src.api:app --reload
   ```

3. **Haikai profile must be loaded** (✅ Fixed in previous commit)

---

## Status

- ✅ API updated to accept spec_intents
- ✅ Haikai profile loading fixed
- ✅ Path format fixed (Unix paths)
- ✅ Timestamp removed from spec names
- ⏳ Ready for testing with real spec_intent

**Run the test and report back what spec_name Haikai chooses!**
