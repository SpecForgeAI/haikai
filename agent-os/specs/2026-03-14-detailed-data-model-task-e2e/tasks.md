# Task Breakdown: Detailed Data Model Task -- End-to-End Fix

## Overview
Total Tasks: 46 (across 5 task groups)

This spec fixes the broken `architect--detailed-data-model` task by wiring a complete structured discovery, generation, preview, confirm, and save pipeline. Changes span the MCP server (attribute support), gateway (context builder, task config, prompt, route branches, inline context), and frontend (preview bubble, type guard, hook entry).

## Task List

### MCP Server Layer

#### Task Group 1: Extend `save_architecture_baseline` with Attribute Support
**Dependencies:** None
**Files:** `mcp-server/src/types/saveArchitectureBaseline.ts`, `mcp-server/src/services/architectureBaselineService.ts`

- [x] 1.0 Complete MCP server attribute extension
  - [x] 1.1 Write 6 focused tests for attribute merge logic
    - Test 1: `logicalDataAttributes` array with valid `logicalEntityRef` resolves to correct parent entity ID
    - Test 2: `physicalDataAttributes` array with valid `physicalEntityRef` resolves to correct parent entity ID
    - Test 3: Attribute with unresolved `logicalEntityRef` (entity name not in input or existing model) produces a validation/resolution error
    - Test 4: Attribute upsert: merging attributes where one has the same `name` AND same parent entity ID as an existing attribute overwrites (updates) instead of appending a duplicate
    - Test 5: Attribute arrays included alongside entity arrays: entities are created first, then attributes reference them by name
    - Test 6: `summary` in response includes `logicalDataAttributes` and `physicalDataAttributes` counts
  - [x] 1.2 Add `LogicalDataAttributeInput` and `PhysicalDataAttributeInput` types
    - File: `mcp-server/src/types/saveArchitectureBaseline.ts`
    - `LogicalDataAttributeInput`: `{ name: string, description?: string, logicalEntityRef: string, dataType?: string, isPrimaryKey?: boolean, isNullable?: boolean, tags?: string }`
    - `PhysicalDataAttributeInput`: `{ name: string, description?: string, physicalEntityRef: string, dataType?: string, isPrimaryKey?: boolean, isNullable?: boolean, tags?: string }`
    - Add `logicalDataAttributes?: LogicalDataAttributeInput[]` and `physicalDataAttributes?: PhysicalDataAttributeInput[]` to `ArchitectureBaselineInput`
  - [x] 1.3 Extend `IdMaps` with attribute composite keys
    - File: `mcp-server/src/services/architectureBaselineService.ts`
    - Add `logicalDataAttributes: Record<string, string>` and `physicalDataAttributes: Record<string, string>` to `IdMaps`
    - Keys use composite format `{parentEntityName}::{attributeName}`
    - Add ID generation for attribute arrays in `generateIds` function
  - [x] 1.4 Extend `ResolvedRefs` and `resolveRefs` for attribute parent references
    - File: `mcp-server/src/services/architectureBaselineService.ts`
    - Add `logicalAttributeEntityIds: Record<number, string>` and `physicalAttributeEntityIds: Record<number, string>` to `ResolvedRefs`
    - Resolve `logicalEntityRef` by looking up name in `idMaps.logicalDataEntities` first (new entities), then falling back to existing model entities
    - Resolve `physicalEntityRef` by looking up name in `idMaps.physicalDataEntities` first, then existing model
    - Collect resolution errors for unresolved refs
  - [x] 1.5 Extend `BuiltEntities` and `buildEntities` for attribute DTO arrays
    - File: `mcp-server/src/services/architectureBaselineService.ts`
    - Add `logical_data_attributes` and `physical_data_attributes` arrays to `BuiltEntities`
    - Each attribute DTO shape: `{ id, name, description, logical_entity_id/physical_entity_id, data_type, is_primary_key, is_nullable, tags }`
    - Follow the exact pattern of existing entity building (e.g., `logicalDataEntities` -> `logical_data_entities`)
  - [x] 1.6 Extend `mergeWithExisting` for attribute arrays with upsert deduplication
    - File: `mcp-server/src/services/architectureBaselineService.ts`
    - Append new `logical_data_attributes` and `physical_data_attributes` to existing model arrays
    - Upsert rule: if an attribute with the same `name` AND same parent entity ID already exists, overwrite its fields instead of appending
    - Follow the same append pattern as other entity types for non-duplicate attributes
  - [x] 1.7 Update `SaveArchitectureBaselineResponse.summary` type
    - File: `mcp-server/src/types/saveArchitectureBaseline.ts`
    - Add `logicalDataAttributes: number` and `physicalDataAttributes: number` to `summary`
    - Update summary population in `processArchitectureBaseline` to count attributes
  - [x] 1.8 Ensure MCP server attribute tests pass
    - Run ONLY the 6 tests written in 1.1
    - Verify attribute merge, ref resolution, upsert dedup, and summary counts all work

**Acceptance Criteria:**
- The 6 tests written in 1.1 pass
- `logicalDataAttributes` and `physicalDataAttributes` arrays are accepted in input
- Attribute `logicalEntityRef`/`physicalEntityRef` fields resolve to parent entity IDs
- Upsert deduplication prevents duplicate attributes with same name + parent
- Summary response includes attribute counts
- Existing entity-only payloads continue to work unchanged

---

### Gateway Services Layer

#### Task Group 2: Architecture Context Builder (Reusable Package)
**Dependencies:** None (independent of Task Group 1)
**Files:** `gateway/src/services/architectureContextBuilder.ts`, `gateway/src/config/prompts/shared/architecture-context-explainer.md`

- [x] 2.0 Complete reusable architecture context builder
  - [x] 2.1 Write 4 focused tests for the architecture context builder
    - Test 1: `fetchFullArchitectureContext(projectId)` returns parsed model data with `diagrams` array stripped
    - Test 2: `fetchFullArchitectureContext(projectId)` returns null on HTTP error (graceful degradation)
    - Test 3: `loadArchitectureExplainer()` returns the static markdown content from disk
    - Test 4: `buildArchitectureContextSection(projectId)` combines explainer + JSON-stringified model data into a single string; returns empty string when model fetch returns null
  - [x] 2.2 Create `gateway/src/services/architectureContextBuilder.ts`
    - Export `fetchFullArchitectureContext(projectId: string): Promise<object | null>` -- calls `GET {baseUrl}/api/model?projectId={projectId}`, parses JSON, strips `diagrams` array, returns result or null on error; follow error handling pattern from `fetchMetaModelSummary` (try/catch, logger.warn, return null)
    - Export `loadArchitectureExplainer(): Promise<string>` -- reads `gateway/src/config/prompts/shared/architecture-context-explainer.md` from disk using `fs.readFile`
    - Export `buildArchitectureContextSection(projectId: string): Promise<string>` -- calls both functions above, combines: explainer text + `## Current Architecture Model Data` header + `JSON.stringify(modelData, null, 2)`; returns empty string if model fetch returns null
  - [x] 2.3 Create `gateway/src/config/prompts/shared/architecture-context-explainer.md`
    - Include descriptions for all entity types: applications, app_components, services, interfaces, endpoints, classes, methods, application_points, logical_data_entities, logical_data_attributes, physical_data_entities, physical_data_attributes, data_entity_points, business_users, business_processes, process_activities, business_points, app_business_points, interactions, events, states, state_transitions, activities, activity_flows, activity_partitions, ui_screens, ui_components, ui_actions, ui_characteristics, business_logics, package_sets, packages, package_set_default_rules
    - Include descriptions for all relationship types: business_user_business_points, application_point_business_points, logical_data_entity_relationships, logical_data_entity_physical_data_entities, logical_data_attribute_physical_data_attributes, data_movements, interface_logical_entities, ui_workflow_transitions, application_point_business_logics
    - Explicitly mark polymorphic wrappers (application_points, data_entity_points, business_points, app_business_points) as auto-managed -- state the LLM must never create them
    - Explicitly note `ui_contracts` is excluded (deprecated/duplicate)
    - Use the exact authoritative descriptions from spec requirements FR7b
  - [x] 2.4 Ensure architecture context builder tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify `fetchFullArchitectureContext`, `loadArchitectureExplainer`, and `buildArchitectureContextSection` all work correctly

**Acceptance Criteria:**
- The 4 tests written in 2.1 pass
- `fetchFullArchitectureContext` returns full model data minus diagrams
- `loadArchitectureExplainer` returns the static explainer markdown
- `buildArchitectureContextSection` assembles the combined context string
- Graceful degradation when model service is unreachable
- Explainer covers all entity types and relationships with accurate descriptions

---

### Gateway Configuration & Routes Layer

#### Task Group 3: Task Definition, Prompt, Route Branches, and Inline Context
**Dependencies:** Task Group 2 (uses `buildArchitectureContextSection`)
**Files:** `gateway/src/config/tasks/architect--detailed-data-model.json`, `gateway/src/config/prompts/architect.detailed-data-model.task.md`, `gateway/src/routes/chatV2.ts`, `gateway/src/types/tools.ts`

- [x] 3.0 Complete gateway task configuration and route wiring
  - [x] 3.1 Write 5 focused tests for the data model generate/save pipeline
    - Test 1: `/generate` with `artifactType === 'data-model'` builds conversation transcript, calls LLM with jsonMode, returns `artifactContent` on valid JSON
    - Test 2: `/generate` data-model corrective retry: first LLM response fails validation, second attempt succeeds
    - Test 3: `validateDataModelJsonShape` accepts payload with at least one non-empty entity array where entities have non-empty `name` fields
    - Test 4: `validateDataModelJsonShape` rejects payload with empty entity arrays / missing `name` fields
    - Test 5: `/save-artifact` with `artifactType === 'data-model'` calls `executeToolCall` with `save_architecture_baseline` and correct parameters
  - [x] 3.2 Update task definition `gateway/src/config/tasks/architect--detailed-data-model.json`
    - Change `mode` from `"advisory"` to `"discovery"`
    - Set `responseFormat` to JSON schema with:
      - Required fields: `phase` (enum `"questions"` | `"ready"`), `section` (enum of 6 discovery sections), `questions` (array of strings), `summary` (string)
      - Optional fields: `logicalDataEntities` (array of objects), `physicalDataEntities` (array of objects), `entityMappings` (array of objects)
      - Discovery section enum: `"existing_model_review"`, `"domain_identification"`, `"entity_refinement"`, `"attribute_definition"`, `"relationship_and_mapping"`, `"final_review"`
      - Entity object schema: `{ name: string, description?: string, attributes?: [{ name, dataType?, isPrimaryKey?, isNullable?, description? }] }`
      - Physical entity additionally: `physicalType?: string`, `database?: string`
      - Entity mapping: `{ logicalEntityName: string, physicalEntityName: string }`
    - Set `artifacts` to `[{ "artifactId": "data-model", "tool": "save_architecture_baseline", "description": "Detailed data model with entities and attributes", "filename": "DATA_MODEL" }]`
    - Update `contextNeeds` from `["meta-model-summary", "mission", "tech-stack"]` to `["mission", "tech-stack"]`
  - [x] 3.3 Replace task prompt `gateway/src/config/prompts/architect.detailed-data-model.task.md`
    - Follow pattern of `gateway/src/config/prompts/architect.define-architecture.task.md`
    - Define 6 discovery sections in order: existing_model_review, domain_identification, entity_refinement, attribute_definition, relationship_and_mapping, final_review
    - Include response format contract: respond with ONLY valid JSON, all 4 required fields every turn, entity arrays optional during questions phase
    - Include single-representation rule: determine if logical, physical, or mixed (default physical); show only dominant type during conversation; emit both + mappings when `phase === "ready"`
    - Instruct LLM to reference ARCHITECTURE CONTEXT section for existing entities
    - Instruct LLM to NEVER ask user for project UUID
    - Include readiness gate: at least one entity with at least one attribute, all sections visited or skipped, final_review reached
    - Include forbidden patterns: no both entity lists every turn during questions, no full entity list every turn, no code/diagram generation
  - [x] 3.4 Add `/generate` branch for `data-model` artifact type in `chatV2.ts`
    - Insert after the `architecture-baseline` generate block (around line 1021)
    - Match `artifactType === 'data-model'`
    - Follow exact pattern of architecture-baseline generate block (lines 893-1021): build conversation transcript, load MISSION.MD + TECH-STACK.MD, populate template, call `sendChatRequest` with `jsonMode: true` and `temperature: 0.2`, validate, corrective retry
    - Create `DATA_MODEL_GENERATION_PROMPT_TEMPLATE` constant: instruct LLM to produce JSON with `logicalDataEntities`, `physicalDataEntities`, `logicalDataAttributes`, `physicalDataAttributes`, `logicalPhysicalEntityMappings`
    - Create `DATA_MODEL_JSON_CORRECTIVE_INSTRUCTION` constant for retry
  - [x] 3.5 Add `validateDataModelJsonShape` function in `chatV2.ts`
    - Follow pattern of `validateBaselineJsonShape`
    - Check at least one of `logicalDataEntities` or `physicalDataEntities` is a non-empty array
    - Validate all entities have non-empty `name` fields
    - Validate `logicalDataAttributes` / `physicalDataAttributes` arrays (if present) reference entity names that exist in the entity arrays
    - Return `{ valid: boolean; error?: string }`
  - [x] 3.6 Add `/save-artifact` branch for `data-model` artifact type in `chatV2.ts`
    - Insert after the `architecture-baseline` save block (around line 1613)
    - Match `artifactType === 'data-model'`
    - Parse JSON content, validate shape with `validateDataModelJsonShape`
    - Call `executeToolCall` with `save_architecture_baseline` and `{ projectId, architectureBaselineJson: content }`
    - Set `completionContent = 'Data Model complete.'`, `completionArtifactId = 'data-model'`, `completionArtifactName = 'DATA_MODEL'`
  - [x] 3.7 Add inline context assembly block for `architect--detailed-data-model` in `chatV2.ts`
    - Insert after the `architect--define-architecture` inline context block (around line 2373)
    - Match `task.id === 'architect--detailed-data-model'`
    - Call `buildArchitectureContextSection(tk.projectId)` from `gateway/src/services/architectureContextBuilder.ts`
    - Set `resolvedContext['ARCHITECTURE CONTEXT'] = result` (if non-empty)
    - Load MISSION.MD and TECH-STACK.MD using same two-path fallback pattern as the `architect--define-architecture` block (lines 2337-2373), setting `resolvedContext['MISSION']` and `resolvedContext['TECH STACK']`
  - [x] 3.8 Update `save_architecture_baseline` tool description in `gateway/src/types/tools.ts`
    - Update `architectureBaselineJson` description to mention `logicalDataAttributes` and `physicalDataAttributes` alongside existing entity array names
  - [x] 3.9 Ensure gateway route and config tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify generate, validate, and save-artifact branches work correctly

**Acceptance Criteria:**
- The 5 tests written in 3.1 pass
- Task definition has `mode: "discovery"`, proper `responseFormat`, and `artifacts` array
- Task prompt provides comprehensive discovery instructions with all 6 sections
- `/generate` branch produces valid data model JSON from conversation transcript
- `validateDataModelJsonShape` correctly validates/rejects payloads
- `/save-artifact` branch routes to `save_architecture_baseline` MCP tool
- Inline context block injects full architecture context + MISSION + TECH STACK
- Tool description updated to reflect new attribute arrays

---

### Frontend Layer

#### Task Group 4: Preview Bubble, Type Guard, and Hook Wiring
**Dependencies:** Task Group 3 (generates the `data-model-preview` structuredResponse)
**Files:** `frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.tsx`, `frontend/src/components/UnifiedChat/MessageBubble.tsx`, `frontend/src/hooks/useChatThread.ts`

- [x] 4.0 Complete frontend preview and hook wiring
  - [x] 4.1 Write 4 focused tests for data model preview rendering and routing
    - Test 1: `isDataModelPreview` type guard returns true for `{ type: 'data-model-preview', content: '...' }` and false for other types
    - Test 2: `ArchitecturePreviewBubble` renders `logicalDataAttributes` and `physicalDataAttributes` expandable sections when present in JSON content
    - Test 3: `TASK_ARTIFACT_MAP['architect--detailed-data-model']` entry has correct `artifactId`, `previewType`, `completionMessage` values
    - Test 4: `generateArtifact` creates a `data-model-preview` structuredResponse message when `previewType` is `'data-model-preview'`
  - [x] 4.2 Extend `ArchitecturePreviewBubble` to render attribute sections
    - File: `frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.tsx`
    - Add `{ key: 'logicalDataAttributes', label: 'Logical Data Attributes' }` to `ENTITY_ARRAY_KEYS`
    - Add `{ key: 'physicalDataAttributes', label: 'Physical Data Attributes' }` to `ENTITY_ARRAY_KEYS`
    - Update `ArchitectureBaseline` interface to include `logicalDataAttributes` and `physicalDataAttributes` arrays
  - [x] 4.3 Add `isDataModelPreview` type guard in `MessageBubble.tsx`
    - File: `frontend/src/components/UnifiedChat/MessageBubble.tsx`
    - Follow pattern of `isArchitecturePreview`: check `structuredResponse.type === 'data-model-preview'` and `typeof structuredResponse.content === 'string'`
    - Add `showDataModelPreview` to the component body (same pattern as `showArchitecturePreview`)
    - Route `showDataModelPreview` to `ArchitecturePreviewBubble` with `content`, `onConfirm`, `onReject`, `isConfirming`, `disabled` props (same pattern as architecture-preview rendering branch)
  - [x] 4.4 Update `showQuestions` and `showDiscoveryFinalReview` guards in `MessageBubble.tsx`
    - Add `!showDataModelPreview` to the `showDiscoveryFinalReview` guard chain
    - Add `!showDataModelPreview` to the `showQuestions` guard chain
  - [x] 4.5 Add `architect--detailed-data-model` entry to `TASK_ARTIFACT_MAP` in `useChatThread.ts`
    - File: `frontend/src/hooks/useChatThread.ts`
    - Add entry: `{ artifactId: 'data-model', artifactName: 'DATA_MODEL', artifactKey: 'dataModel', completionMessage: 'Data Model complete.', warningText: 'Data model entities already exist in the architecture. Completing this conversation will add to them.', previewType: 'data-model-preview' }`
  - [x] 4.6 Add `data-model-preview` routing in `generateArtifact` function
    - File: `frontend/src/hooks/useChatThread.ts`
    - Add `else if (previewType === 'data-model-preview')` branch in the `generateArtifact` function
    - Set `structuredResponse = { type: 'data-model-preview', content: artifactContent }`
    - Follow exact pattern of `architecture-preview` branch (lines 390-394)
  - [x] 4.7 Ensure frontend tests pass
    - Run ONLY the 4 tests written in 4.1
    - Verify type guard, preview rendering, hook map entry, and generate routing all work

**Acceptance Criteria:**
- The 4 tests written in 4.1 pass
- `ArchitecturePreviewBubble` renders attribute sections alongside entity sections
- `isDataModelPreview` type guard correctly identifies data-model-preview structuredResponses
- Preview is excluded from `showQuestions` and `showDiscoveryFinalReview` guards
- `TASK_ARTIFACT_MAP` entry enables the generate/confirm/save flow for `architect--detailed-data-model`
- `generateArtifact` creates proper `data-model-preview` message for display

---

### Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 6 tests from Task Group 1 (MCP attribute merge)
    - Review the 5 tests from Task Group 2 (architecture context builder)
    - Review the 5 tests from Task Group 3 (gateway generate/save pipeline)
    - Review the 4 tests from Task Group 4 (frontend preview/hook)
    - Total existing tests: 20 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Focus on end-to-end integration points between layers
    - Identify any critical workflow paths not covered by group-level tests
    - Check: does the inline context block correctly call `buildArchitectureContextSection`?
    - Check: does the full generate -> validate -> preview -> save -> completion flow work?
    - Check: does attribute upsert deduplication interact correctly with the merge-with-existing flow?
  - [x] 5.3 Write up to 8 additional strategic tests to fill gaps
    - Integration test: full `/chat` request with `task.id === 'architect--detailed-data-model'` injects architecture context into `resolvedContext`
    - Integration test: `/generate` -> `/save-artifact` round-trip for data-model artifact type produces correct completion chip metadata
    - Edge case: `validateDataModelJsonShape` handles attribute arrays referencing entity names with special characters
    - Edge case: `mergeWithExisting` with empty existing model (first-time save) appends all entities and attributes correctly
    - Edge case: `buildArchitectureContextSection` with model service returning very large model data still produces valid string
    - Guard chain test: `showDataModelPreview` is true and `showQuestions` is false when structuredResponse type is `data-model-preview` with questions present in the same payload
    - Do NOT exceed 8 additional tests
    - Do NOT write tests for functionality outside this spec (e.g., define-architecture, roadmap, tech-stack)
  - [x] 5.4 Run feature-specific tests only
    - Run ONLY tests from Task Groups 1-4 (20 tests) plus gap-fill tests from 5.3 (up to 8)
    - Expected total: approximately 21-27 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 21-27 tests total)
- Critical end-to-end workflows for this feature are covered
- No more than 8 additional tests added when filling gaps
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1 (MCP Server)  ----\
                                 \
Task Group 2 (Gateway Services) --+--> Task Group 3 (Gateway Routes) --> Task Group 4 (Frontend) --> Task Group 5 (Testing)
```

1. **Task Group 1: MCP Server -- Attribute Support** (can run in parallel with TG2)
   - Foundation: extends the `save_architecture_baseline` tool that the entire pipeline depends on
   - No dependencies on other groups

2. **Task Group 2: Gateway Services -- Architecture Context Builder** (can run in parallel with TG1)
   - Foundation: creates the reusable `buildArchitectureContextSection` function used by TG3
   - No dependencies on other groups

3. **Task Group 3: Gateway Routes -- Task Config, Prompt, Route Branches, Inline Context** (depends on TG2)
   - Core pipeline: task definition, prompt, generate/save branches, inline context injection
   - Depends on TG2 for `buildArchitectureContextSection`
   - Logically depends on TG1 for attribute arrays in the generation template, but can be developed concurrently if attribute array names are known

4. **Task Group 4: Frontend -- Preview Bubble, Type Guard, Hook Wiring** (depends on TG3)
   - Consumer layer: renders previews and triggers generate/confirm/save flows
   - Depends on TG3 producing the `data-model-preview` structuredResponse type

5. **Task Group 5: Test Review and Gap Analysis** (depends on TG1-4)
   - Final validation: reviews all group tests, fills critical gaps, runs full feature test suite

## Visual References

The following screenshots document the broken behaviors this spec fixes:
- `planning/visuals/chat_arch_define_data_model_no_structure.png` -- Questions in prose text (FR1 fix)
- `planning/visuals/chat_arch_define_data_model_final_messages1.png` -- Missing save mechanism (FR5 fix)
- `planning/visuals/chat_arch_define_data_model_final_messages2.png` -- LLM asking for project UUID (FR4 fix)
- `planning/visuals/chat_arch_define_data_model_final_messages3.png` -- Empty response / dead-end (FR5 fix)

## Key File Reference

| Layer | File | Change Type |
|-------|------|-------------|
| MCP Types | `mcp-server/src/types/saveArchitectureBaseline.ts` | Extend |
| MCP Service | `mcp-server/src/services/architectureBaselineService.ts` | Extend |
| Gateway Service | `gateway/src/services/architectureContextBuilder.ts` | **New** |
| Gateway Prompt | `gateway/src/config/prompts/shared/architecture-context-explainer.md` | **New** |
| Gateway Task Config | `gateway/src/config/tasks/architect--detailed-data-model.json` | Modify |
| Gateway Task Prompt | `gateway/src/config/prompts/architect.detailed-data-model.task.md` | Replace |
| Gateway Route | `gateway/src/routes/chatV2.ts` | Extend |
| Gateway Tool Types | `gateway/src/types/tools.ts` | Modify |
| Frontend Preview | `frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.tsx` | Extend |
| Frontend Message | `frontend/src/components/UnifiedChat/MessageBubble.tsx` | Extend |
| Frontend Hook | `frontend/src/hooks/useChatThread.ts` | Extend |
