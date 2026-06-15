# Raw Idea: Expanded Planner JSON Contract

## Goal
Expand the Planner (Product Owner) LLM structured JSON response contract to:
1. Always return structured JSON in refine phase (not just handoff)
2. Include acceptanceCriteria[] as first-class output during shaping
3. Add implementationPlan (replaces handoff_intents) generated on explicit phase change
4. Add schema versioning

## User Decisions
1. **Schema Migration:** Refactor existing handoff schema into new implementationPlan structure
2. **Response Format:** Always JSON in refine phase with message field for chat
3. **Plan Trigger:** Explicit phase='implementation_planning' (new phase)

## Key Changes

### New Unified Schema (v1.1)
- schemaVersion: "1.1"
- message: string (chat bubble text)
- featureUnderstanding: string
- scope: { in: string[], out: string[] }
- assumptions: string[]
- acceptanceCriteria: string[] (NEW - during shaping)
- openQuestions: string[]
- plannerReadyForSpec: boolean
- implementationPlan: object | null (replaces handoff phase)

### Implementation Plan Structure
- planTitle: string
- increments: array (replaces handoff_intents)
  - id, title, shortDescription, status, proposedFinalSubFeatureDefinition

### Phase Changes
- bootstrap: unchanged (conversational greeting)
- refine: NOW returns structured JSON (not just text)
- implementation_planning: NEW phase (replaces handoff)
- generate_specs: unchanged

### Gateway Changes
- Update system prompts for JSON-only output in refine phase
- Update parsing/validation for new schema
- Safe fallback on malformed JSON
