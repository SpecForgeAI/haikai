# Detailed Data Model Task — End-to-End Fix

## Background

The Architect persona's "Detailed Data Model" task (`architect--detailed-data-model`) currently has a working conversational flow (the LLM asks good questions and refines the data model iteratively), but is broken in several critical ways:

1. **No structured questions**: Unlike other discovery tasks (e.g., `architect--define-architecture`, `product-manager--roadmap`), this task has `responseFormat: null`. The LLM returns free text with questions embedded inline, rather than structured JSON with a `questions` array that the UI renders as a table via `StructuredQuestionsRenderer`.

2. **No structured entity/attribute representation during conversation**: Entities and attributes are described in prose text. They should be expressed as structured JSON so the UI can render them nicely (similar to how the final `ArchitecturePreviewBubble` renders expandable entity sections).

3. **ProjectId not passed to LLM**: The LLM doesn't know the project UUID. It asked the user for it at the end of the conversation because it knew it needed it for the MCP tool call. The projectId should be handled server-side (as it is for all other tasks with save mechanisms) — the LLM should never need to ask for it.

4. **Save mechanism completely missing**: The task has `artifacts: []` (empty) and `mode: "advisory"`. There is no `/generate` branch in chatV2.ts, no artifact definition for the frontend to trigger Confirm & Save, and no tools passed to the LLM. The final LLM response was an empty string because it tried to emit a tool_call but no tools were declared.

5. **Input context too shallow**: `fetchMetaModelSummary(projectId)` returns only `{ id, name, entity_type }` per entity — no attributes, no constraints, no relationships detail. The LLM needs the **full** architecture model so it can reference existing entities, question them ("I see data entities X and Y — are these the concepts for...?"), and build on them.

## Requirements

### FR1: Structured Response Format (Questions)

The task must have a `responseFormat` that includes at minimum:
- `phase` (string enum: "questions" | "ready") — same pattern as `architect--define-architecture`
- `section` (string enum — appropriate sections for data model discovery)
- `questions` (array of strings) — rendered by `StructuredQuestionsRenderer`
- `summary` (string) — conversational context shown above the questions

This enables the UI to render questions in the structured table format used by all other discovery tasks.

### FR2: Structured Entity/Attribute Representation During Conversation

During the conversation (while `phase === "questions"`), the LLM should be able to express entities and attributes as structured JSON within the response format. Key rules:

- **Single representation during conversation**: The LLM must determine early whether the data model is predominantly:
  - **Logical** (API DTOs, non-persisted data exposed externally) → show entities as logical with camelCase names
  - **Physical** (database tables, files) → show entities as physical with snake_case names
  - **Mixed / no majority** → default to physical
- The LLM MUST NOT show both logical and physical entity lists simultaneously during the conversation — this doubles content and reading burden.
- The LLM does NOT have to provide the full entity list every turn. It should only include entities/attributes when it is referring to or discussing them. The response format field for entities should be optional.
- When entities are included, the UI should render them in a clean card/table format (not the full green-box "Confirm" preview — that is reserved for `phase: "ready"` only).

### FR3: Final Confirmation Preview (phase: "ready")

When the conversation reaches `phase: "ready"`, the LLM must produce a complete structured payload showing everything that will be saved:

1. **Logical entities and their attributes** — DTOs exposed externally via APIs (camelCase field names, data types)
2. **Physical entities and their attributes** — database tables, physical files (snake_case column names, SQL types, constraints, indexes)
3. **Mapping summary** — entity-level mappings between physical and logical (e.g., `user_account` ↔ `UserAccount`). NO attribute-level mapping detail — that is too large and verbose.

This renders in a preview bubble (similar to `ArchitecturePreviewBubble`) with expandable sections for logical entities, physical entities, and mapping summary, plus Confirm/Reject buttons.

### FR4: ProjectId Injected Server-Side

The project UUID must be injected into the context server-side (same pattern as other tasks). The LLM must never ask the user for the project UUID. The `/save-artifact` endpoint extracts it from `threadKey.projectId`.

### FR5: Artifact Definition and Save Pipeline

The task definition must have a proper `artifacts` array pointing to the `save_architecture_baseline` tool (which already supports `logicalDataEntities` and `physicalDataEntities` arrays). The full save pipeline must be wired:

1. Task definition gets `artifacts: [{ artifactId: "data-model", tool: "save_architecture_baseline" }]`
2. `mode` changes from `"advisory"` to `"discovery"`
3. A `/generate` branch in chatV2.ts handles data model generation (extracts the conversation transcript, calls LLM with jsonMode to produce the save payload)
4. A `/save-artifact` branch routes to `save_architecture_baseline` MCP tool
5. The frontend triggers the generate → preview → confirm → save flow when `phase === "ready"`

### FR6: Extend `save_architecture_baseline` to Accept Attributes

The existing `save_architecture_baseline` MCP tool must be extended to accept:
- `logicalDataAttributes` array: `[{ name, description?, logicalEntityRef (name-based), dataType?, isPrimaryKey?, isNullable?, tags? }]`
- `physicalDataAttributes` array: `[{ name, description?, physicalEntityRef (name-based), dataType?, isPrimaryKey?, isNullable?, tags? }]`

The merge logic must:
- Resolve `logicalEntityRef` / `physicalEntityRef` to parent entity IDs by name (same pattern as existing `logicalDataEntityRef` on `PhysicalDataEntityInput`)
- Match existing attributes by name + parent entity for upsert
- Auto-create any required polymorphic wrapper entities (`data_entity_points`, `application_points`, `business_points`, etc.) when new entities are created that are referenced in relationships requiring polymorphic indirection. The LLM must NEVER need to create polymorphic wrapper entities — the backend handles this automatically.

### FR7: Full Architecture Context (Reusable Package)

A new **reusable** context assembly package that can be called from multiple LLM task conversations. It consists of two parts:

#### FR7a: Data Fetching — `fetchFullArchitectureContext(projectId)`

A new gateway-side function that calls the existing `GET /api/model?projectId=...` endpoint and returns the full `MetaModelDto` (entities + relationships). This replaces `fetchMetaModelSummary` for tasks that need rich architecture context.

The function should format the model data into a structured text section suitable for LLM consumption (JSON with the data, excluding diagrams).

This function must be reusable — callable from the inline context assembly blocks of any task that needs architecture context (detailed data model, define-architecture, OAS spec, future tasks).

#### FR7b: Architecture Meta-Model Explainer Template

A static markdown file (e.g., `prompts/shared/architecture-context-explainer.md`) that describes what each entity type and relationship means in the Architecture Meta-Model. This is injected alongside the data into the system prompt.

The explainer must cover all entity types and relationships with accurate descriptions. Here is the authoritative definition of each:

**Entities:**
- `applications` — Top-level deployable systems
- `app_components` — Human-defined grouping of service types/tiers/layers within an application on a technical basis (e.g. "Web Tier", "Persistence Tier"), so that certain important things can be stated about this grouping e.g. "our company uses React/TS for all frontends" + if a project has 3 services whose parent app_component is "UI Tier", then those 3 deployed services should be React/TS according to company technical standards.
- `services` — Runtime components within an application
- `interfaces` — API boundaries exposed by services
- `endpoints` — Individual operations on an interface
- `classes` — Code-level entities. E.g. if Java, it's a Java class. Used in UML "Class diagrams".
- `methods` — Code-level methods on classes. Used in "Class diagrams" and referenced in other diagrams e.g. a sequence diagram might show an internal calculation `calcMyNumbers(...)`.
- `application_points` — **Polymorphic wrapper (1:1 with a concrete entity)**. Every application_point row maps to exactly one concrete entity (application, app_component, service, or interface). This mechanism allows relationships like `data_movements` to flexibly reference any level of the application architecture as source/target. E.g. "the time-series entity moved from my service called market-data-svc to an external interface called their-rest-api". The LLM should never create these directly — they are auto-managed by the backend.
- `logical_data_entities` — Conceptual data objects (DTOs), often representing the actual shape of data transferring between applications in APIs.
- `logical_data_attributes` — Fields on logical data entities (name, dataType, isPrimaryKey, isNullable).
- `physical_data_entities` — Persisted storage structures (database tables, collections, physical files).
- `physical_data_attributes` — Columns on physical data entities (name, dataType, isPrimaryKey, isNullable).
- `data_entity_points` — **Polymorphic wrapper (1:1 with a concrete entity)**. Every data_entity_point maps to exactly one logical or physical data entity. Allows relationships to flexibly reference either type. The LLM should never create these directly — they are auto-managed by the backend.
- `business_users` — Actors/roles who use the system.
- `business_processes` — High-level business workflows.
- `process_activities` — Steps within a business process.
- `business_points` — **Polymorphic wrapper (1:1 with a concrete entity)**. Every business_point maps to either a `business_process` or an `activity`. Allows relationships to reference either a very high-level business process or a medium-to-high level business activity. The LLM should never create these directly — they are auto-managed by the backend.
- `app_business_points` — **Super-polymorphic wrapper**. Allows the flexible choice of either an `application_point` or a `business_point` in a relationship. The LLM should never create these directly — they are auto-managed by the backend.
- `interactions` — A flexible definition allowing you to define any kind of interaction that a user may have with `application_points` or `business_points` (hence the use of `app_business_points`). Architecturally loose by design.
- `events` — Events in a state machine model.
- `states` — States in a state machine model.
- `state_transitions` — Transitions between states in a state machine.
- `activities` — Steps in an activity/workflow diagram.
- `activity_flows` — Connections between activities in a workflow.
- `activity_partitions` — Swimlanes/groupings in activity diagrams.
- `ui_screens` — Frontend pages/views.
- `ui_contracts` — **IGNORE/EXCLUDE**. This is a duplicate of `interfaces` pending removal from the database/meta-model.
- `ui_components` — Component/element within a screen (not a UI widget). What would be defined in multiple frontend frameworks in code in `src/components`. Components build on top of each other e.g. basic components are used in the definition of parent, more complex components.
- `ui_actions` — User-triggered or system-triggered actions in UI.
- `ui_characteristics` — Business features / UX characteristics linked to services that are "UI tier" i.e. frontend UIs.
- `business_logics` — Business rules/domain logic owned by a service.
- `package_sets` — A set of "packages" that allows someone to state their full src directory/package structure.
- `packages` — Code packaging (think Java Package, albeit this word is different in other languages e.g. Python Module).
- `package_set_default_rules` — Auto-resolution rules for package set selection.

**Relationships:**
- `business_user_business_points` — Links business users to business points (polymorphic: business processes or activities).
- `application_point_business_points` — Links application points to business points.
- `logical_data_entity_relationships` — Links between logical data entities (e.g. FK-style references, associations).
- `logical_data_entity_physical_data_entities` — Maps logical entities to physical entities (logical↔physical mapping).
- `logical_data_attribute_physical_data_attributes` — Maps logical attributes to physical attributes.
- `data_movements` — Data flowing between application points, optionally referencing a data entity point or interface.
- `interface_logical_entities` — Links interfaces to the logical entities they expose.
- `ui_workflow_transitions` — Navigation/flow between UI screens.
- `application_point_business_logics` — Links application points to business logic rules.

#### FR7c: Reusable Assembly Function

A shared function (e.g., `buildArchitectureContextSection(projectId)`) that:
1. Calls `fetchFullArchitectureContext(projectId)` to get the model data
2. Reads the explainer template from disk
3. Combines them into a single context section string for injection into the system prompt

Any task that needs architecture context calls this one function. Currently this would be used by the detailed data model task, but it should also be available for define-architecture, OAS spec, and future tasks.

### FR8: Task Prompt Updates

The task prompt (`architect.detailed-data-model.task.md`) must be significantly expanded to:
- Instruct the LLM on the response format contract
- Explain the single-representation rule (logical vs physical vs default-to-physical)
- Define when to include entity data in responses vs when to omit
- Define the final confirmation payload structure
- Explain that projectId is available server-side and should never be requested from the user
- Reference the architecture context explainer for understanding existing entities

### FR9: Inline Context Assembly

A new inline context assembly block in chatV2.ts for the detailed data model task that calls the reusable `buildArchitectureContextSection(projectId)` function from FR7c, plus loads MISSION.MD and TECH-STACK.MD (same pattern as other architect tasks).

## Existing File References

### Task Definition
- `gateway/src/config/tasks/architect--detailed-data-model.json` — needs mode, responseFormat, artifacts updates
- `gateway/src/config/tasks/architect--define-architecture.json` — reference for working discovery task

### Task Prompt
- `gateway/src/config/prompts/architect.detailed-data-model.task.md` — needs major expansion
- `gateway/src/config/prompts/architect.define-architecture.task.md` — reference

### Persona
- `gateway/src/config/personas/architect.json` — already lists this task; no changes needed

### Gateway Route
- `gateway/src/routes/chatV2.ts` — needs new `/generate` branch, new `/save-artifact` branch, inline context block

### Gateway Services
- `gateway/src/services/architectureModelClient.ts` — needs new `fetchFullArchitectureContext()` function
- `gateway/src/services/contextResolvers.ts` — may need new resolver or shared assembly function
- `gateway/src/services/promptComposer.ts` — no changes needed (generic)

### Tool Definitions
- `gateway/src/types/tools.ts` — `save_architecture_baseline` tool definition needs description update for new attribute arrays
- `gateway/src/services/toolExecutor.ts` — already handles `save_architecture_baseline`

### MCP Server
- `mcp-server/src/types/saveArchitectureBaseline.ts` — needs `LogicalDataAttributeInput` and `PhysicalDataAttributeInput` types
- `mcp-server/src/services/architectureBaselineService.ts` — needs attribute merge logic + auto-creation of polymorphic wrappers

### Architecture Model Service (Java Backend)
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java` — existing `GET /api/model?projectId=...` endpoint (no changes)
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelEntitiesDto.java` — full entity structure reference
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/MetaModelRelationshipsDto.java` — full relationship structure reference
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/LogicalDataAttributeDto.java` — attribute DTO shape
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/PhysicalDataAttributeDto.java` — attribute DTO shape

### Frontend Components
- `frontend/src/components/UnifiedChat/MessageBubble.tsx` — may need new type guard for data-model preview
- `frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.tsx` — reference for preview pattern; may be reusable or a new `DataModelPreviewBubble` may be needed
- `frontend/src/components/UnifiedChat/StructuredQuestionsRenderer.tsx` — already handles questions arrays
- `frontend/src/hooks/useChatThread.ts` — handles generate/save-artifact flow

## Visual References

- `planning/visuals/chat_arch_define_data_model_no_structure.png` — Shows questions embedded in prose (Issue 1)
- `planning/visuals/chat_arch_define_data_model_final_messages1.png` — Shows ambiguous save proposal and offering to move to other topics
- `planning/visuals/chat_arch_define_data_model_final_messages2.png` — Shows LLM asking for project UUID (Issue 3)
- `planning/visuals/chat_arch_define_data_model_final_messages3.png` — Shows empty string final response after providing UUID (Issue 4)

## Constraints

- Must not break existing `architect--define-architecture` task flow
- Must reuse and extend `save_architecture_baseline` MCP tool (no new MCP tool needed)
- The `ArchitecturePreviewBubble` can potentially be reused for the final confirmation, or a new `DataModelPreviewBubble` can be created — evaluate which is cleaner
- The conversation should feel natural — the LLM shouldn't be forced to emit huge entity lists every turn
- The response format must allow the entity fields to be optional (only required when `phase === "ready"`)
- Polymorphic wrapper entities (`application_points`, `data_entity_points`, `business_points`, `app_business_points`) must NEVER be created by the LLM — the backend auto-manages them when saving entities that need them for relationship references
- `ui_contracts` must be excluded from the architecture context explainer (duplicate pending removal)
- The architecture context package (FR7) must be designed for reuse across multiple tasks and conversations
- For now, the current attribute schema is sufficient (`name`, `description`, `dataType`, `isPrimaryKey`, `isNullable`, `tags`) — richer detail like constraints, indexes, defaults, FK references should be captured in the `description` field
