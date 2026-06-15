# Specification: Detailed Data Model Task -- End-to-End Fix

## Goal
Fix the broken `architect--detailed-data-model` task so it uses structured discovery (questions + entity preview), injects full architecture context server-side, and wires a complete generate/preview/confirm/save pipeline via the existing `save_architecture_baseline` MCP tool extended to support attribute arrays.

## User Stories
- As an architect user, I want to iteratively refine a detailed data model through structured questions and entity previews so that I can review and save logical/physical entities with their attributes into the architecture model.
- As an architect user, I want the system to already know my project context and existing architecture so that the LLM can reference existing entities and I am never asked for a project UUID.

## Specific Requirements

**FR1-FR3: Response Format with Structured Questions and Entities**
- Update the task definition `responseFormat` to a JSON schema with required fields: `phase` (enum `"questions"` | `"ready"`), `section` (enum of data-model discovery sections), `questions` (array of strings), `summary` (string)
- Add optional fields to the schema: `logicalDataEntities` (array of objects), `physicalDataEntities` (array of objects), `entityMappings` (array of objects) -- all three are only required when `phase === "ready"` but may be included during `phase === "questions"` at the LLM's discretion
- Discovery section enum values: `"existing_model_review"`, `"domain_identification"`, `"entity_refinement"`, `"attribute_definition"`, `"relationship_and_mapping"`, `"final_review"`
- Each entity object in the response format has shape: `{ name: string, description?: string, attributes?: [{ name, dataType?, isPrimaryKey?, isNullable?, description? }] }`
- Physical entities additionally have `physicalType?: string`, `database?: string`; each physical entity attribute additionally has no special extra fields
- Entity mapping objects have shape: `{ logicalEntityName: string, physicalEntityName: string }`
- The single-representation rule: during `phase === "questions"`, the LLM shows entities as EITHER logical OR physical (not both) based on the dominant data nature; when `phase === "ready"`, both arrays plus mappings are required for the final confirmation payload
- The `questions` array is rendered by the existing `StructuredQuestionsRenderer`; when entity arrays are present during questions phase, they render as lightweight inline cards (not the full green-box confirmation preview)

**FR4: Task Definition Update**
- Change `mode` from `"advisory"` to `"discovery"` in `gateway/src/config/tasks/architect--detailed-data-model.json`
- Set `responseFormat` to the JSON schema defined in FR1-FR3
- Set `artifacts` to `[{ "artifactId": "data-model", "tool": "save_architecture_baseline", "description": "Detailed data model with entities and attributes", "filename": "DATA_MODEL" }]`
- Update `contextNeeds` from `["meta-model-summary", "mission", "tech-stack"]` to `["mission", "tech-stack"]` (the full architecture context is injected inline via FR9 instead of the shallow meta-model-summary resolver)

**FR5: Generate and Save Pipeline in chatV2.ts**
- Add a new `/generate` branch in chatV2.ts (after the `architecture-baseline` block, around line 1021) that matches `artifactType === 'data-model'`
- This branch follows the exact same pattern as the `architecture-baseline` generate block (lines 893-1021): build conversation transcript, load MISSION.MD + TECH-STACK.MD, populate a generation prompt template, call `sendChatRequest` with `jsonMode: true` and `temperature: 0.2`, validate JSON shape, corrective retry on failure
- The generation prompt template (`DATA_MODEL_GENERATION_PROMPT_TEMPLATE`) instructs the LLM to produce a JSON object with arrays: `logicalDataEntities`, `physicalDataEntities`, `logicalDataAttributes`, `physicalDataAttributes`, plus `logicalPhysicalEntityMappings` for the entity-level mapping
- Add a new `/save-artifact` branch (after the `architecture-baseline` save block, around line 1613) that matches `artifactType === 'data-model'`; it calls `executeToolCall` with `save_architecture_baseline` and `{ projectId, architectureBaselineJson: content }`, sets `completionContent = 'Data Model complete.'`, `completionArtifactId = 'data-model'`, `completionArtifactName = 'DATA_MODEL'`
- Add a `validateDataModelJsonShape(parsed)` function following the pattern of `validateBaselineJsonShape`: checks that at least one of `logicalDataEntities` or `physicalDataEntities` is a non-empty array, validates all entities have non-empty `name` fields, validates attribute arrays reference known entity names

**FR6: Extend save_architecture_baseline to Accept Attributes**
- Add `LogicalDataAttributeInput` type to `mcp-server/src/types/saveArchitectureBaseline.ts`: `{ name: string, description?: string, logicalEntityRef: string, dataType?: string, isPrimaryKey?: boolean, isNullable?: boolean, tags?: string }`
- Add `PhysicalDataAttributeInput` type: `{ name: string, description?: string, physicalEntityRef: string, dataType?: string, isPrimaryKey?: boolean, isNullable?: boolean, tags?: string }`
- Add `logicalDataAttributes?: LogicalDataAttributeInput[]` and `physicalDataAttributes?: PhysicalDataAttributeInput[]` to `ArchitectureBaselineInput`
- In `architectureBaselineService.ts`, extend `IdMaps` with `logicalDataAttributes: Record<string, string>` and `physicalDataAttributes: Record<string, string>` keyed by `{parentEntityName}::{attributeName}` composite key
- In `resolveRefs`, add resolution of `logicalEntityRef` to parent entity ID (lookup in `idMaps.logicalDataEntities`) and `physicalEntityRef` to parent entity ID (lookup in `idMaps.physicalDataEntities`); collect resolution errors for unresolved refs
- In `buildEntities`, add `logical_data_attributes` and `physical_data_attributes` arrays to `BuiltEntities`; each attribute DTO matches the `LogicalDataAttributeDto` / `PhysicalDataAttributeDto` shape: `{ id, name, description, logical_entity_id/physical_entity_id, data_type, is_primary_key, is_nullable, tags }`
- In `mergeWithExisting`, append new `logical_data_attributes` and `physical_data_attributes` to the existing model arrays (same append pattern as other entities)
- Attribute upsert: when merging, if an attribute with the same `name` AND same parent entity ID already exists in the model, update (overwrite) its fields instead of appending a duplicate
- Update `SaveArchitectureBaselineResponse.summary` to include `logicalDataAttributes: number` and `physicalDataAttributes: number` counts
- Auto-creation of `data_entity_points` for new entities already works in the existing `buildEntities` function; no additional polymorphic wrapper logic is needed for attributes specifically, but ensure that if new logical/physical entities are in the attribute arrays but NOT in the entity arrays, they are still resolved against existing model entities by name

**FR7: Full Architecture Context -- Reusable Package**
- Create `gateway/src/services/architectureContextBuilder.ts` with three exports
- `fetchFullArchitectureContext(projectId: string): Promise<object | null>` -- calls `GET {baseUrl}/api/model?projectId={projectId}` (same endpoint the frontend uses to load the full model), returns the parsed JSON response or null on error; strips `diagrams` array from the response to reduce token count; follows the same error handling pattern as `fetchMetaModelSummary` (try/catch, logger.warn, return null)
- `loadArchitectureExplainer(): Promise<string>` -- reads the static markdown file at `gateway/src/config/prompts/shared/architecture-context-explainer.md` from disk; this file contains the entity type and relationship descriptions from the requirements document (all entities and relationships listed in FR7b of requirements.md), excluding `ui_contracts`
- `buildArchitectureContextSection(projectId: string): Promise<string>` -- calls `fetchFullArchitectureContext(projectId)` and `loadArchitectureExplainer()`, combines them into a single string: the explainer text followed by a `## Current Architecture Model Data` header and then `JSON.stringify(modelData, null, 2)`; returns empty string if the model fetch returns null (graceful degradation)
- Create the static file `gateway/src/config/prompts/shared/architecture-context-explainer.md` with authoritative descriptions for all entity types (applications, app_components, services, interfaces, endpoints, classes, methods, application_points, logical_data_entities, logical_data_attributes, physical_data_entities, physical_data_attributes, data_entity_points, business_users, business_processes, process_activities, business_points, app_business_points, interactions, events, states, state_transitions, activities, activity_flows, activity_partitions, ui_screens, ui_components, ui_actions, ui_characteristics, business_logics, package_sets, packages, package_set_default_rules) and all relationship types (business_user_business_points, application_point_business_points, logical_data_entity_relationships, logical_data_entity_physical_data_entities, logical_data_attribute_physical_data_attributes, data_movements, interface_logical_entities, ui_workflow_transitions, application_point_business_logics) -- using the exact descriptions from requirements.md FR7b; explicitly note that `ui_contracts` is excluded (deprecated)
- The explainer must clearly mark polymorphic wrappers (application_points, data_entity_points, business_points, app_business_points) as auto-managed by the backend and state the LLM must never create them

**FR8: Task Prompt Expansion**
- Replace the 2-line content of `gateway/src/config/prompts/architect.detailed-data-model.task.md` with a comprehensive discovery prompt following the pattern of `architect.define-architecture.task.md`
- The prompt must define the 6 discovery sections in order: existing_model_review (review injected architecture context, identify what already exists), domain_identification (identify core domain entities), entity_refinement (refine entity names, descriptions, decide logical vs physical emphasis), attribute_definition (define attributes with types, keys, nullability), relationship_and_mapping (define entity relationships and logical-physical mappings), final_review (consolidated recap before save)
- Include the response format contract instructions: respond with ONLY valid JSON, all 4+ fields required every turn, phase/section/questions/summary always present, entity arrays optional during questions phase
- Include the single-representation rule: determine early whether data model is predominantly logical, physical, or mixed (default to physical); show entities as only the dominant type during conversation; when `phase === "ready"`, emit both logical and physical arrays plus entityMappings
- Instruct the LLM to reference the ARCHITECTURE CONTEXT section to see existing entities and build on them rather than starting from scratch
- Instruct the LLM to NEVER ask the user for a project UUID -- projectId is handled server-side
- Include the readiness gate: at least one logical or physical entity defined with at least one attribute, all sections visited or skipped, final_review section reached
- Include forbidden patterns: do not emit both entity lists every turn during questions phase, do not produce the full entity+attribute list every turn (only include entities being discussed), do not generate code or diagrams

**FR9: Inline Context Assembly Block**
- Add a new block in chatV2.ts at the Step 5d inline context assembly area (after the `architect--define-architecture` block, around line 2373) matching `task.id === 'architect--detailed-data-model'`
- This block calls `buildArchitectureContextSection(tk.projectId)` from FR7 and sets `resolvedContext['ARCHITECTURE CONTEXT'] = result` (if non-empty)
- Also loads MISSION.MD and TECH-STACK.MD using the same two-path fallback pattern as the `architect--define-architecture` block (lines 2337-2373), setting `resolvedContext['MISSION']` and `resolvedContext['TECH STACK']`
- The existing `contextNeeds` resolver for `meta-model-summary` is removed from this task's contextNeeds (done in FR4), so the shallow summary is no longer injected; the full model data from `buildArchitectureContextSection` replaces it

**FR-Frontend: Preview Bubble and Hook Wiring**
- Reuse `ArchitecturePreviewBubble` for the data-model confirmation preview rather than creating a new component; the existing component already renders expandable sections for `logicalDataEntities`, `physicalDataEntities`, and other arrays; extend it to also render `logicalDataAttributes` and `physicalDataAttributes` sections (add these to the `ENTITY_ARRAY_KEYS` constant)
- Add a new type guard `isDataModelPreview` in `MessageBubble.tsx` that checks `structuredResponse.type === 'data-model-preview'` and `typeof structuredResponse.content === 'string'`; route this to `ArchitecturePreviewBubble` with the same props pattern as `isArchitecturePreview`
- Update `showQuestions` and `showDiscoveryFinalReview` guards to exclude `showDataModelPreview`
- Add `architect--detailed-data-model` entry to `TASK_ARTIFACT_MAP` in `useChatThread.ts`: `{ artifactId: 'data-model', artifactName: 'DATA_MODEL', artifactKey: 'dataModel', completionMessage: 'Data Model complete.', warningText: 'Data model entities already exist in the architecture. Completing this conversation will add to them.', previewType: 'data-model-preview' }`
- Update the `generateArtifact` function in `useChatThread.ts` to handle `data-model-preview` routing (same pattern as `architecture-preview`)
- Update `gateway/src/types/tools.ts` `save_architecture_baseline` tool description to mention `logicalDataAttributes` and `physicalDataAttributes` in the `architectureBaselineJson` description field

## Visual Design

**`planning/visuals/chat_arch_define_data_model_no_structure.png`**
- Shows questions embedded in unstructured prose text ("Open questions to refine: 1) Org membership... 2) Approvals... 3) Brand Vault scoping... 4) Brief structure...")
- Questions are numbered inline rather than rendered in the structured table format used by other discovery tasks
- No entity/attribute preview cards are visible
- The "next steps" are listed as free-text bullet points rather than structured phase transitions

**`planning/visuals/chat_arch_define_data_model_final_messages1.png`**
- Shows the LLM proposing to persist the baseline but presenting it as a conversational choice ("Next step options") rather than triggering the generate/preview/confirm flow
- Entity names are listed as comma-separated prose text rather than structured expandable sections
- No Confirm/Reject buttons are visible -- the save mechanism is entirely missing

**`planning/visuals/chat_arch_define_data_model_final_messages2.png`**
- Shows the LLM explicitly asking "Please provide the Project UUID (v4)" -- this should never happen because projectId is injected server-side
- The LLM lists entities and mappings as free text rather than structured JSON
- The user has to manually paste a UUID into the chat input

**`planning/visuals/chat_arch_define_data_model_final_messages3.png`**
- Shows the LLM's empty response (blank bubble after "Architect" label) after the user provides the UUID -- this is because the LLM tried to emit a `tool_call` for `save_architecture_baseline` but no tools were declared in the task (artifacts: [])
- The conversation is dead-ended with no way to save the work

## Existing Code to Leverage

**`gateway/src/config/tasks/architect--define-architecture.json` -- Working discovery task definition**
- Provides the exact pattern for `mode: "discovery"`, `responseFormat` JSON schema with `phase`/`section`/`questions`/`summary`, and `artifacts` array pointing to `save_architecture_baseline`
- The detailed-data-model task definition should follow this structure precisely, with different section enum values and additional optional entity array fields in the schema

**`gateway/src/routes/chatV2.ts` lines 893-1021 and 1577-1613 -- Architecture baseline generate and save pipeline**
- The `/generate` branch (lines 893-1021) provides the exact pattern: build conversation transcript, load MISSION.MD + TECH-STACK.MD, populate a template, call LLM with jsonMode, validate, corrective retry, return `artifactContent`
- The `/save-artifact` branch (lines 1577-1613) provides the exact pattern: parse JSON, validate shape, call `executeToolCall` with `save_architecture_baseline`, set completion metadata
- The data-model generate and save branches replicate these patterns with a different validation function and generation prompt template

**`mcp-server/src/services/architectureBaselineService.ts` -- Merge logic with ID generation and ref resolution**
- `generateIds` assigns UUIDs to each entity keyed by name; extend with `logicalDataAttributes` and `physicalDataAttributes` using composite keys
- `resolveRefs` resolves name-based references to generated IDs; extend with `logicalEntityRef` and `physicalEntityRef` resolution for attributes
- `buildEntities` constructs DTO arrays matching the model-service shape; extend with `logical_data_attributes` and `physical_data_attributes` arrays
- `mergeWithExisting` appends new entity arrays to existing model; extend to append attribute arrays with name+parent upsert deduplication

**`frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.tsx` -- Expandable preview component**
- Already renders expandable/collapsible sections for 7 entity arrays including `logicalDataEntities` and `physicalDataEntities`
- Has Confirm/Reject buttons, "Show JSON" toggle, and entity count summary in header
- Can be reused directly for data-model preview by extending `ENTITY_ARRAY_KEYS` to include `logicalDataAttributes` and `physicalDataAttributes`

**`frontend/src/hooks/useChatThread.ts` lines 87-143 -- TASK_ARTIFACT_MAP and generate/save flow**
- `TASK_ARTIFACT_MAP` maps each task ID to its artifact metadata (`artifactId`, `previewType`, etc.); adding the data-model entry follows the existing pattern exactly
- The `generateArtifact` and `confirmArtifact` functions use this map to route generation and save calls; no changes to these functions are needed beyond adding the map entry

## Out of Scope
- Attribute-level mappings between logical and physical attributes (only entity-level mappings are included in FR3; attribute-level mapping is too verbose)
- Constraints, indexes, defaults, or FK references as first-class attribute fields (these should be captured in the attribute `description` field for now)
- Changes to the `architect--define-architecture` task or its prompt (this spec only fixes the detailed-data-model task)
- Creating a new MCP tool (the existing `save_architecture_baseline` tool is extended, not replaced)
- Changes to the Java Architecture Model Service backend (the existing `GET /api/model` and `PUT /api/model` endpoints are used as-is; attribute arrays are already supported in the DTO layer)
- Auto-generating logical entities from physical entities or vice versa (the LLM is responsible for producing both arrays explicitly when `phase === "ready"`)
- Migrating the `architect--define-architecture` task to use the new `buildArchitectureContextSection` reusable function (this is a future follow-up; it currently uses the shallow `meta-model-summary` resolver and that remains unchanged)
- Inline entity cards during questions phase -- the first implementation renders entity arrays only in the final `phase === "ready"` preview bubble; lightweight inline cards during conversation are a future UX enhancement
- Changes to `StructuredQuestionsRenderer` (it already handles arrays of strings correctly)
- Polymorphic wrapper creation logic changes in the backend -- `data_entity_points` are already auto-created by `buildEntities` for new logical/physical entities; no new polymorphic wrapper types are needed for attributes
