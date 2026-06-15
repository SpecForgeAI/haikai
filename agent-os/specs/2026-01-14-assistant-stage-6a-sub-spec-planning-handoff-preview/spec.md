# Specification: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview

## Goal
When the user clicks Implement, the Planner LLM produces a structured handoff plan containing one or more sub-feature intents, and the UI displays a view-only preview of that plan before any execution occurs.

## User Stories
- As a developer, I want the Implement Assistant to analyze my feature and split it into manageable sub-specs when needed, so that large features are implemented incrementally and reliably.
- As a developer, I want to see a preview of the handoff plan (number of sub-specs, titles, and summaries) before any implementation begins, so that I can verify the plan before committing.

## Specific Requirements

**New Handoff-Planning Prompt Template**
- Create `IMPLEMENT_HANDOFF_PLANNING_PROMPT_TEMPLATE` in `gateway/src/services/promptBuilder.ts` alongside existing templates
- Template instructs LLM to output ONLY a JSON object (no prose before/after) matching the `HandoffPlanResponse` schema
- Include explicit heuristics for deciding when to split:
  - Multi-service boundary (frontend + gateway + backend) unless trivially small
  - Multiple independent user-visible behaviors
  - Data/schema concerns combined with non-trivial UI/UX
  - Non-trivial prompt/LLM orchestration plus other concerns
- Instruct LLM to keep sub-intents minimal while ensuring each is implementable as a single write-spec-sized unit

**HandoffPlanResponse JSON Schema**
- Define TypeScript interface `HandoffPlanResponse` in `gateway/src/types/chat.ts`:
  ```
  is_split: boolean
  handoff_plan_summary: string
  handoff_intents: HandoffIntent[]
  ```
- Define `HandoffIntent` interface:
  ```
  id: string (e.g., "S1", "S2")
  title: string
  intent: string
  in_scope: string[]
  out_of_scope: string[]
  acceptance_criteria: string[]
  dependencies: string[] (references to other intent IDs)
  ```
- Constraints: `handoff_intents.length >= 1`; if length == 1 then `is_split = false`; if length > 1 then `is_split = true`

**New buildHandoffPlanningPrompt Function**
- Add `buildHandoffPlanningPrompt()` in `gateway/src/services/promptBuilder.ts`
- Mirror signature of `buildGenerateSpecsPrompt()`: accepts `ChatContext` and optional `ResolvedImplementContextDto`
- Inject work item context, entity IDs, diagram IDs, and resolved context into placeholders
- Export from `gateway/src/services/index.ts`

**Gateway Phase Routing Update**
- In `buildSystemPrompt()`, when `phase === 'handoff'`, call `buildHandoffPlanningPrompt()` instead of `buildGenerateSpecsPrompt()`
- This replaces the existing handoff behavior for `mode=implement_feature`

**Gateway Handoff Response Validation**
- Create `validateHandoffPlan()` in new file `gateway/src/services/handoffPlanValidator.ts`
- Validation rules: valid JSON, matches `HandoffPlanResponse` schema, `handoff_intents.length >= 1`, `is_split` consistency
- Return type `HandoffPlanValidationResult`: `{ valid: boolean; plan?: HandoffPlanResponse; error?: string }`
- Export from `gateway/src/services/index.ts`

**Gateway Chat Route Handoff Handling**
- In `gateway/src/routes/chat.ts` POST handler, after LLM response for `phase === 'handoff'`:
  - Call `validateHandoffPlan(response.content)`
  - If valid: return `ChatResponse` with new `handoffPlan` field containing the parsed plan
  - If invalid: log error, build fallback single-intent plan from work item context, return that as `handoffPlan`
- Fallback plan: `is_split: false`, `handoff_plan_summary` derived from work item title, single `handoff_intents` entry using work item data

**ChatResponse Type Extension**
- Add optional `handoffPlan?: HandoffPlanResponse` field to `ChatResponse` interface in `gateway/src/types/chat.ts`
- Add corresponding field to `frontend/src/api/chatApi.ts` `ChatResponse` interface

**Frontend Handoff Plan Preview Panel**
- Add `handoffPlan` state variable to `ImplementationAssistantPanel` (type `HandoffPlanResponse | null`)
- When `handleImplement()` receives response with `handoffPlan`, store it in state
- Render new "Handoff Plan Preview" section when `handoffPlan` is non-null:
  - Display `handoff_plan_summary` text prominently
  - Show list of sub-intents with id + title (e.g., "S1: Add backend endpoint")
  - Style with distinct visual treatment (similar to existing `specsPanel` pattern but different color)
- Panel is view-only; no "Execute" or "Confirm" buttons in this stage

**Frontend CSS Styles for Handoff Preview**
- Add `.handoffPlanPanel`, `.handoffPlanHeader`, `.handoffPlanSummary`, `.handoffIntentList`, `.handoffIntentItem` classes to `ImplementationAssistantPanel.module.css`
- Use a distinct accent color (e.g., purple/indigo) to differentiate from green specs panel

## Visual Design
No mockups provided in `planning/visuals/`.

## Existing Code to Leverage

**`gateway/src/services/promptBuilder.ts`**
- Contains `IMPLEMENT_GENERATE_SPECS_PROMPT_TEMPLATE` as reference for handoff prompt structure
- `buildGenerateSpecsPrompt()` demonstrates parameter injection pattern for work item and architecture context
- `formatResolvedContext()` helper already formats resolved entities/diagrams for prompt injection

**`gateway/src/services/specsValidator.ts`**
- `validateGeneratedSpecs()` provides validation pattern: parse JSON, check structure, return typed result
- `SpecsValidationResult` interface demonstrates validation return type pattern (valid, data, error)

**`gateway/src/types/chat.ts`**
- `ChatPhase` type already includes `'handoff'` value
- `ChatResponse` interface shows how to add optional fields (`specs?: string[]`)
- Existing DTOs (`ResolvedEntitySummary`, `ResolvedDiagramSummary`) demonstrate interface patterns

**`frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`**
- `handleImplement()` shows existing handoff flow with `phase: 'handoff'`
- `generatedSpecs` state and rendering pattern can be replicated for `handoffPlan`
- Existing `specsPanel` section in JSX demonstrates conditional panel rendering

**`frontend/src/components/ProductView/ImplementationAssistantPanel.module.css`**
- `.specsPanel`, `.specsPanelHeader`, `.specsContent` classes provide styling pattern for preview panels
- Color scheme and layout patterns to replicate with different accent color

## Out of Scope
- No execution or handoff to implementing LLM occurs in this stage
- No persistence of handoff plans to database or file system
- No status tracking or work-item creation for sub-specs
- No user confirmation/approval workflow before execution
- No editing or modification of the handoff plan by the user
- No retry or regeneration of handoff plan from UI
- No new conversation phases beyond existing `bootstrap`, `refine`, `handoff`
- No streaming support for handoff planning (uses existing non-streaming POST endpoint)
- No changes to the OAS assistant mode or bootstrap phase behavior
- No backend (architecture-model-service) changes required
