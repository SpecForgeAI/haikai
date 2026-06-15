# Specification: Expanded Planner JSON Contract (v1.1)

## Overview

**Spec ID:** 2026-01-22-expanded-planner-json-contract
**Status:** Draft
**Module:** Gateway (Node.js/TypeScript)

This specification expands the Planner (Product Owner) LLM structured JSON response contract to:
1. Always return structured JSON in refine phase (with message field for chat)
2. Include `acceptanceCriteria[]` as first-class output during shaping
3. Add `implementationPlan` object (replaces handoff phase) generated on explicit phase change
4. Add schema versioning for forward compatibility

---

## Background

### Current Implementation

**Phases:**
- `bootstrap` - Conversational greeting with context acknowledgment
- `refine` - **Text-based conversation** (no structured output)
- `handoff` - Structured JSON (`HandoffPlanResponse` with `HandoffIntent[]`)
- `generate_specs` - JSON array of spec commands

**Current Handoff Schema (`HandoffPlanResponse`):**
```typescript
interface HandoffPlanResponse {
  is_split: boolean;
  handoff_plan_summary: string;
  handoff_intents: HandoffIntent[];
}

interface HandoffIntent {
  id: string;
  title: string;
  intent: string;
  in_scope: string[];
  out_of_scope: string[];
  acceptance_criteria: string[];
  dependencies: string[];
}
```

### Problems with Current Approach

1. **Refine phase is unstructured** - Frontend can't reliably extract feature understanding, assumptions, etc.
2. **Acceptance criteria only in handoff** - Not available during shaping phase
3. **No schema versioning** - Hard to evolve contract
4. **Handoff is terminal** - Can't iterate on implementation plan

---

## Goals

1. **Structured Shaping Output** - All refine responses are parseable JSON
2. **Acceptance Criteria During Shaping** - First-class field populated throughout
3. **Unified Implementation Plan** - Replaces handoff, triggered by explicit phase
4. **Schema Versioning** - Enable contract evolution
5. **Safe Fallback** - Never break chat flow due to malformed JSON

---

## Planner Response Contract v1.1

### Schema Definition

```typescript
interface PlannerResponse {
  // Schema version for forward compatibility
  schemaVersion: "1.1";

  // Chat bubble text (conversational summary)
  message: string;

  // Current human-readable definition of the feature
  featureUnderstanding: string;

  // Scope boundaries
  scope: {
    in: string[];   // Items explicitly included
    out: string[];  // Items explicitly excluded
  };

  // Assumptions made by the planner
  assumptions: string[];

  // Testable success conditions (NEW - populated during shaping)
  acceptanceCriteria: string[];

  // Questions needing user clarification
  openQuestions: string[];

  // Explicit planner signal that feature is ready for spec
  plannerReadyForSpec: boolean;

  // Implementation plan (null during shaping, populated on explicit request)
  implementationPlan: ImplementationPlan | null;
}

interface ImplementationPlan {
  // Human-readable label for the plan
  planTitle: string;

  // Implementation increments (length >= 1)
  increments: Increment[];
}

interface Increment {
  // Stable identifier for UI/status tracking (e.g., "INC-1", "INC-2")
  id: string;

  // Short name of the increment
  title: string;

  // Human-readable summary of what this increment achieves
  shortDescription: string;

  // Current status (always "NOT_STARTED" for newly generated plans)
  status: "NOT_STARTED";

  // LLM-friendly specification text for the Software Architect
  proposedFinalSubFeatureDefinition: string;
}
```

### Contract Invariants

1. **All fields required** - Every field must be present, even if arrays are empty
2. **implementationPlan null during shaping** - Only populated when `phase='implementation_planning'`
3. **When implementationPlan is present:**
   - `increments` must be non-empty (length >= 1)
   - Each increment must have all fields populated
   - Each increment `status` must be `"NOT_STARTED"`
4. **schemaVersion must be "1.1"**

---

## Phase Changes

### Updated Phase Enum

```typescript
type ImplementChatPhase =
  | 'bootstrap'              // Conversational greeting
  | 'refine'                 // Structured JSON shaping (UPDATED)
  | 'implementation_planning' // Structured JSON plan generation (NEW - replaces handoff)
  | 'generate_specs';        // JSON spec commands (unchanged)
```

### Phase Behavior

| Phase | Input | Output | implementationPlan |
|-------|-------|--------|-------------------|
| `bootstrap` | Initial context | Conversational text | N/A |
| `refine` | User messages | **PlannerResponse JSON** | `null` |
| `implementation_planning` | Request for plan | **PlannerResponse JSON** | Populated |
| `generate_specs` | Request to generate | JSON spec commands | N/A |

---

## Gateway Changes

### A) Update Type Definitions

**File:** `gateway/src/types/chat.ts`

**Add new types:**
```typescript
// Schema version type
export type PlannerSchemaVersion = "1.1";

// New unified response schema
export interface PlannerResponse {
  schemaVersion: PlannerSchemaVersion;
  message: string;
  featureUnderstanding: string;
  scope: {
    in: string[];
    out: string[];
  };
  assumptions: string[];
  acceptanceCriteria: string[];
  openQuestions: string[];
  plannerReadyForSpec: boolean;
  implementationPlan: ImplementationPlan | null;
}

export interface ImplementationPlan {
  planTitle: string;
  increments: Increment[];
}

export interface Increment {
  id: string;
  title: string;
  shortDescription: string;
  status: "NOT_STARTED";
  proposedFinalSubFeatureDefinition: string;
}

// Validation result type
export interface PlannerValidationResult {
  valid: boolean;
  plannerResponse?: PlannerResponse;
  error?: string;
}
```

**Update phase enum:**
```typescript
export type ImplementChatPhase =
  | 'bootstrap'
  | 'refine'
  | 'implementation_planning'  // NEW - replaces 'handoff'
  | 'generate_specs';
```

**Deprecate old types (keep for backward compatibility):**
```typescript
/** @deprecated Use PlannerResponse and ImplementationPlan instead */
export interface HandoffPlanResponse { ... }

/** @deprecated Use Increment instead */
export interface HandoffIntent { ... }
```

---

### B) Create Planner Response Validator

**File:** `gateway/src/services/plannerResponseValidator.ts` (NEW)

```typescript
import { PlannerResponse, PlannerValidationResult, ImplementationPlan, Increment } from '../types/chat';

/**
 * Validate a PlannerResponse against schema v1.1
 */
export function validatePlannerResponse(
  content: string,
  expectImplementationPlan: boolean = false
): PlannerValidationResult {
  // 1. Extract JSON from content (handle markdown blocks, etc.)
  const jsonStr = extractJson(content);
  if (!jsonStr) {
    return { valid: false, error: 'No JSON found in response' };
  }

  // 2. Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return { valid: false, error: `Invalid JSON: ${e}` };
  }

  // 3. Validate required fields
  const obj = parsed as Record<string, unknown>;

  // Check schemaVersion
  if (obj.schemaVersion !== '1.1') {
    return { valid: false, error: `Invalid schemaVersion: ${obj.schemaVersion}` };
  }

  // Check required string fields
  const requiredStrings = ['message', 'featureUnderstanding'];
  for (const field of requiredStrings) {
    if (typeof obj[field] !== 'string') {
      return { valid: false, error: `Missing or invalid field: ${field}` };
    }
  }

  // Check required array fields
  const requiredArrays = ['assumptions', 'acceptanceCriteria', 'openQuestions'];
  for (const field of requiredArrays) {
    if (!Array.isArray(obj[field])) {
      return { valid: false, error: `Missing or invalid array field: ${field}` };
    }
  }

  // Check scope object
  if (!obj.scope || typeof obj.scope !== 'object') {
    return { valid: false, error: 'Missing or invalid scope object' };
  }
  const scope = obj.scope as Record<string, unknown>;
  if (!Array.isArray(scope.in) || !Array.isArray(scope.out)) {
    return { valid: false, error: 'scope.in and scope.out must be arrays' };
  }

  // Check plannerReadyForSpec
  if (typeof obj.plannerReadyForSpec !== 'boolean') {
    return { valid: false, error: 'plannerReadyForSpec must be boolean' };
  }

  // Check implementationPlan
  if (expectImplementationPlan) {
    const planResult = validateImplementationPlan(obj.implementationPlan);
    if (!planResult.valid) {
      return planResult;
    }
  } else {
    if (obj.implementationPlan !== null) {
      return { valid: false, error: 'implementationPlan must be null during shaping' };
    }
  }

  return {
    valid: true,
    plannerResponse: obj as unknown as PlannerResponse
  };
}

function validateImplementationPlan(plan: unknown): PlannerValidationResult {
  if (plan === null) {
    return { valid: false, error: 'implementationPlan is required in this phase' };
  }

  const p = plan as Record<string, unknown>;

  if (typeof p.planTitle !== 'string' || !p.planTitle) {
    return { valid: false, error: 'implementationPlan.planTitle is required' };
  }

  if (!Array.isArray(p.increments) || p.increments.length === 0) {
    return { valid: false, error: 'implementationPlan.increments must be non-empty array' };
  }

  for (let i = 0; i < p.increments.length; i++) {
    const inc = p.increments[i] as Record<string, unknown>;
    const required = ['id', 'title', 'shortDescription', 'status', 'proposedFinalSubFeatureDefinition'];
    for (const field of required) {
      if (typeof inc[field] !== 'string') {
        return { valid: false, error: `increment[${i}].${field} is required` };
      }
    }
    if (inc.status !== 'NOT_STARTED') {
      return { valid: false, error: `increment[${i}].status must be "NOT_STARTED"` };
    }
  }

  return { valid: true };
}

/**
 * Extract JSON from content (handles markdown code blocks)
 */
function extractJson(content: string): string | null {
  // Try direct parse first
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  // Try markdown code block
  const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find bare JSON object
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  return null;
}

/**
 * Create safe fallback response when validation fails
 */
export function createFallbackPlannerResponse(rawMessage: string): PlannerResponse {
  return {
    schemaVersion: '1.1',
    message: rawMessage,
    featureUnderstanding: '',
    scope: { in: [], out: [] },
    assumptions: [],
    acceptanceCriteria: [],
    openQuestions: [],
    plannerReadyForSpec: false,
    implementationPlan: null
  };
}
```

---

### C) Update Refine Phase System Prompt

**File:** `gateway/src/services/promptBuilder.ts`

**Replace `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` with JSON-enforcing version:**

```typescript
export const IMPLEMENT_PLANNER_PROMPT_TEMPLATE = `
You are a Product Owner helping to shape a feature for implementation.

## CONTEXT
Work Item: {workItemTitle}
Type: {workItemType}
Description: {workItemDescription}

Selected Architecture Context:
- Entity IDs: {entityIds}
- Diagram IDs: {diagramIds}

Resolved Context Details:
{resolvedContext}

## YOUR TASK
Engage in a collaborative shaping conversation with the user. Your goal is to:
1. Understand the feature requirements thoroughly
2. Identify scope boundaries (what's in, what's out)
3. Surface assumptions that need validation
4. Develop testable acceptance criteria
5. Ask clarifying questions to fill gaps

## RESPONSE FORMAT
You MUST respond with VALID JSON ONLY. No markdown, no prose outside the JSON structure.

Every response must follow this exact schema:
\`\`\`json
{
  "schemaVersion": "1.1",
  "message": "Your conversational response to the user (2-4 sentences)",
  "featureUnderstanding": "Current comprehensive definition of the feature",
  "scope": {
    "in": ["Items explicitly included in scope"],
    "out": ["Items explicitly excluded from scope"]
  },
  "assumptions": ["Assumptions you are making"],
  "acceptanceCriteria": ["Testable success conditions for this feature"],
  "openQuestions": ["Questions that still need answers"],
  "plannerReadyForSpec": false,
  "implementationPlan": null
}
\`\`\`

## RULES
1. ALWAYS include ALL fields, even if arrays are empty
2. "message" should be conversational and acknowledge the user's input
3. "featureUnderstanding" should evolve as you learn more
4. "acceptanceCriteria" should be specific and testable (Given/When/Then format preferred)
5. "plannerReadyForSpec" should be true ONLY when:
   - Feature understanding is clear and complete
   - Scope is well-defined
   - All critical questions are answered
   - Acceptance criteria are comprehensive
6. "implementationPlan" must be null (it's only populated in the implementation_planning phase)

## SHAPING PROGRESSION
- Early: Focus on understanding, ask many questions
- Middle: Refine scope, validate assumptions, draft acceptance criteria
- Late: Confirm understanding, finalize acceptance criteria, signal readiness
`;
```

---

### D) Create Implementation Planning Phase Prompt

**File:** `gateway/src/services/implementationPlanningPrompt.ts` (NEW)

```typescript
export const IMPLEMENT_PLANNING_PROMPT_TEMPLATE = `
You are a Product Owner creating an implementation plan for a shaped feature.

## CONTEXT
Work Item: {workItemTitle}
Type: {workItemType}
Description: {workItemDescription}

Selected Architecture Context:
- Entity IDs: {entityIds}
- Diagram IDs: {diagramIds}

Resolved Context Details:
{resolvedContext}

## SHAPED FEATURE (from previous conversation)
Feature Understanding: {featureUnderstanding}
Scope In: {scopeIn}
Scope Out: {scopeOut}
Assumptions: {assumptions}
Acceptance Criteria: {acceptanceCriteria}

## YOUR TASK
Create an implementation plan that breaks down this feature into increments.

Guidelines for increments:
1. Each increment should be independently implementable and testable
2. Increments should be ordered by dependency (earlier ones first)
3. Each increment should have clear boundaries
4. The "proposedFinalSubFeatureDefinition" should be detailed enough for a Software Architect

## RESPONSE FORMAT
You MUST respond with VALID JSON ONLY. No markdown, no prose outside the JSON structure.

\`\`\`json
{
  "schemaVersion": "1.1",
  "message": "Summary of the implementation plan for the user",
  "featureUnderstanding": "The full feature definition",
  "scope": {
    "in": ["Scope items"],
    "out": ["Out of scope items"]
  },
  "assumptions": ["Assumptions"],
  "acceptanceCriteria": ["All acceptance criteria"],
  "openQuestions": [],
  "plannerReadyForSpec": true,
  "implementationPlan": {
    "planTitle": "Implementation Plan for {workItemTitle}",
    "increments": [
      {
        "id": "INC-1",
        "title": "Increment title",
        "shortDescription": "Brief description of what this achieves",
        "status": "NOT_STARTED",
        "proposedFinalSubFeatureDefinition": "Detailed specification for the Software Architect..."
      }
    ]
  }
}
\`\`\`

## RULES
1. Create 1-5 increments depending on feature complexity
2. Simple features may have just 1 increment
3. Each increment's "proposedFinalSubFeatureDefinition" must be comprehensive
4. All increment IDs should be sequential (INC-1, INC-2, etc.)
5. All increment statuses must be "NOT_STARTED"
6. "implementationPlan" must NOT be null in this phase
`;
```

---

### E) Update Chat Route Handler

**File:** `gateway/src/routes/chat.ts`

**Update phase handling:**

```typescript
// Import new validator
import { validatePlannerResponse, createFallbackPlannerResponse } from '../services/plannerResponseValidator';

// In the response handling section:

if (context?.mode === 'implement_feature') {
  const phase = context.phase;

  if (phase === 'refine') {
    // Refine phase: validate structured JSON response
    const validationResult = validatePlannerResponse(response.content, false);

    if (validationResult.valid && validationResult.plannerResponse) {
      return res.json({
        sessionId,
        message: validationResult.plannerResponse.message,
        plannerResponse: validationResult.plannerResponse,
        ...additionalFields
      });
    } else {
      // Fallback: preserve raw message, return safe defaults
      console.warn(`[Planner] Invalid JSON in refine phase: ${validationResult.error}`);
      const fallback = createFallbackPlannerResponse(response.content);
      return res.json({
        sessionId,
        message: response.content,
        plannerResponse: fallback,
        ...additionalFields
      });
    }
  }

  if (phase === 'implementation_planning') {
    // Implementation planning phase: validate with implementationPlan required
    const validationResult = validatePlannerResponse(response.content, true);

    if (validationResult.valid && validationResult.plannerResponse) {
      return res.json({
        sessionId,
        message: validationResult.plannerResponse.message,
        plannerResponse: validationResult.plannerResponse,
        ...additionalFields
      });
    } else {
      // Fallback: return error but don't break
      console.warn(`[Planner] Invalid JSON in implementation_planning phase: ${validationResult.error}`);
      const fallback = createFallbackPlannerResponse(response.content);
      fallback.message = `Failed to generate implementation plan. Please try again. (${validationResult.error})`;
      return res.json({
        sessionId,
        message: fallback.message,
        plannerResponse: fallback,
        error: validationResult.error,
        ...additionalFields
      });
    }
  }

  // bootstrap and generate_specs phases unchanged
}
```

---

### F) Update ChatResponse Type

**File:** `gateway/src/types/chat.ts`

```typescript
export interface ChatResponse {
  sessionId: string;
  message: string;

  // New: unified planner response (replaces handoffPlan)
  plannerResponse?: PlannerResponse;

  // Deprecated: kept for backward compatibility
  /** @deprecated Use plannerResponse.implementationPlan instead */
  handoffPlan?: HandoffPlanResponse;

  // Other existing fields...
  specs?: GeneratedSpec[];
  toolCalls?: ToolCallResult[];
  error?: string;
}
```

---

## Frontend Changes (Reference Only)

The frontend will need corresponding updates (separate spec):

1. **Update `chatApi.ts`** - Add `PlannerResponse` types, update `ChatResponse`
2. **Update `ImplementationAssistantPanel.tsx`** - Handle `plannerResponse` field
3. **Update phase handling** - Support `implementation_planning` phase
4. **Render structured fields** - Display scope, assumptions, acceptanceCriteria in UI

---

## Migration Strategy

### Backward Compatibility

1. **Keep deprecated types** - `HandoffPlanResponse`, `HandoffIntent` remain but deprecated
2. **Dual return** - Gateway can return both `handoffPlan` (old) and `plannerResponse` (new) temporarily
3. **Frontend migration** - Update frontend to use new types, then remove deprecated fields

### Rollout

1. **Phase 1:** Deploy gateway with new validator and types (this spec)
2. **Phase 2:** Update frontend to use new `plannerResponse` (separate spec)
3. **Phase 3:** Remove deprecated `handoffPlan` field after frontend migrated

---

## Files Summary

### Gateway - New Files

| File | Purpose |
|------|---------|
| `gateway/src/services/plannerResponseValidator.ts` | Validate PlannerResponse, create fallback |
| `gateway/src/services/implementationPlanningPrompt.ts` | System prompt for implementation_planning phase |

### Gateway - Modified Files

| File | Changes |
|------|---------|
| `gateway/src/types/chat.ts` | Add PlannerResponse types, update ChatResponse, deprecate old types |
| `gateway/src/services/promptBuilder.ts` | Update IMPLEMENT_PLANNER_PROMPT_TEMPLATE for JSON output |
| `gateway/src/routes/chat.ts` | Add refine/implementation_planning phase handling |

---

## Testing Requirements

### Unit Tests

**File:** `gateway/src/__tests__/plannerResponseValidator.test.ts`

1. `validatePlannerResponse` returns valid for correct schema
2. `validatePlannerResponse` returns invalid for missing fields
3. `validatePlannerResponse` returns invalid for wrong schemaVersion
4. `validatePlannerResponse` validates implementationPlan when expected
5. `validatePlannerResponse` rejects non-null implementationPlan in shaping
6. `extractJson` handles markdown code blocks
7. `extractJson` handles bare JSON
8. `createFallbackPlannerResponse` returns correct structure

### Integration Tests

1. Refine phase request returns structured JSON
2. Implementation planning phase returns plan with increments
3. Invalid JSON falls back gracefully
4. Phase transitions work correctly

---

## Acceptance Criteria

1. **Refine Phase Returns Structured JSON**
   - All refine responses are valid `PlannerResponse` with `implementationPlan=null`
   - `acceptanceCriteria` populated as shaping progresses

2. **Implementation Planning Phase Returns Plan**
   - Phase `implementation_planning` returns `PlannerResponse` with populated `implementationPlan`
   - Each increment has `proposedFinalSubFeatureDefinition` and `status="NOT_STARTED"`

3. **Gateway Parsing Works**
   - Successfully parses valid JSON
   - Extracts JSON from markdown code blocks
   - Falls back safely on malformed JSON

4. **Never Breaks Chat**
   - Invalid JSON returns fallback response
   - HTTP request never errors due to LLM output
   - Single warning logged for diagnostics

---

## Out of Scope

- Frontend layout changes (separate spec)
- Software Architect (Implementation LLM) schema
- Execution pipeline
- Persistence model changes
- Allowed increment statuses beyond "NOT_STARTED"

---

## Dependencies

| Dependency | Status |
|------------|--------|
| Existing handoff phase implementation | Exists, being replaced |
| OpenAI client | Exists |
| Prompt builder infrastructure | Exists |
