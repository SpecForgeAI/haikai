# Specification: Implement Assistant Stage 4 - Feature-Specific Context Highlighting

## Goal
Enable the Implement Assistant to receive and display highlighted architecture entities and diagrams as feature-specific context during refine-phase conversations, ensuring the Planner LLM has resolved, human-readable summaries of user-selected items to prioritize in its reasoning.

## User Stories
- As a developer using the Implement Assistant, I want my highlighted entity and diagram selections to be passed to the LLM so that it can focus its clarifying questions on the architecture elements most relevant to my feature.
- As a developer, I want the assistant to reference my highlighted items by their human-readable names (not raw IDs) so that the conversation is grounded in concrete architecture context.

## Specific Requirements

**Frontend: Deterministic Highlighted Selection Passing**
- Ensure `buildContext()` in `ImplementationAssistantPanel.tsx` always includes highlighted entity and diagram IDs from `contextState` on every refine-phase request
- The `architectureContext.entityIds` and `architectureContext.diagramIds` arrays already carry selections; these serve as "highlighted" IDs for this feature
- No new UI fields needed; the existing `contextState.entity_refs` and `contextState.diagram_refs` represent the user's highlighted selections
- Verify that cleared selections result in empty arrays being sent (not undefined)

**Frontend: Type Alignment with Gateway**
- Confirm `ArchitectureContextPayload` in `frontend/src/api/chatApi.ts` has `entityIds: string[]` and `diagramIds: string[]` matching the Gateway's `ArchitectureContext` interface
- No new fields required; existing fields semantically represent "highlighted" selections

**Gateway: Conditional Resolution for Refine Phase**
- Update `tryResolveImplementContext()` in `gateway/src/routes/chat.ts` to resolve context when `phase === 'refine'` AND `highlightedEntityIds` or `highlightedDiagramIds` are non-empty
- Currently this logic already exists but treats entityIds/diagramIds generically; rename conceptually to "highlighted" in logs and comments for clarity
- Call `resolveImplementContext()` from `architectureModelClient.ts` with the highlighted IDs
- Resolution should only fire when at least one ID list is non-empty to avoid unnecessary backend calls

**Gateway: Inject "HIGHLIGHTED FEATURE CONTEXT" Section**
- Add a new section in `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` titled "HIGHLIGHTED FEATURE CONTEXT:" positioned after "RESOLVED ARCHITECTURE CONTEXT:"
- The highlighted section includes resolved entities (name, type, category, relevant_fields) and diagrams (name, diagram_type, referenced entities)
- Format highlighted context using the existing `formatResolvedContext()` helper or a new dedicated formatter
- When no highlighted items exist, inject "No items highlighted by user."

**Gateway: Update Prompt Template with Assistant Guidance**
- Add instructions in `IMPLEMENT_PLANNER_PROMPT_TEMPLATE` telling the assistant that highlighted items represent user-emphasized relevance
- Instruct the assistant to prioritize questions and reasoning around highlighted entities/diagrams
- Reinforce rule: do not invent architecture that is not present in background + highlighted context

**Gateway: Graceful Resolution Failure Handling**
- If `resolveImplementContext()` returns null or throws, log a warning with requestId and proceed without highlighted context
- Do not fail the request; inject "Resolution failed - proceeding without highlighted context" or similar fallback text
- Existing try/catch in `tryResolveImplementContext()` handles this; ensure logging includes "highlighted" terminology

**Backend: Enhanced Diagram Resolution with Entity Names**
- Update `resolveDiagram()` in `ImplementContextResolutionService.java` to resolve `referenced_entity_ids` into human-readable entity names where feasible
- Add a new field `referenced_entity_names: string[]` to `ResolvedDiagramSummary` DTO containing resolved names
- If name resolution fails for some IDs, include only successfully resolved names (partial resolution is acceptable)

**Backend: DTO Updates for Referenced Entity Names**
- Add `referencedEntityNames` field to `ResolvedDiagramSummary.java` record with `@JsonProperty("referenced_entity_names")`
- Update Gateway type `ResolvedDiagramSummary` in `gateway/src/types/chat.ts` to include optional `referenced_entity_names?: string[]`

## Visual Design
No visual mockups provided. This feature involves backend/Gateway changes with no UI modifications.

## Existing Code to Leverage

**`frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` - `buildContext()`**
- Already extracts `entityIds` and `diagramIds` from `contextState.entity_refs` and `contextState.diagram_refs`
- Already includes `phase` parameter ('bootstrap', 'refine', 'handoff')
- Reuse as-is; no structural changes needed, only semantic interpretation as "highlighted" context

**`gateway/src/routes/chat.ts` - `tryResolveImplementContext()`**
- Existing function handles resolution for implement_feature mode
- Already skips bootstrap phase and checks for non-empty arrays
- Extend logging to use "highlighted" terminology; logic flow is correct

**`gateway/src/services/architectureModelClient.ts` - `resolveImplementContext()`**
- Client function calls backend `/api/projects/{projectId}/implement-context/resolve`
- Returns `ResolvedImplementContextDto` or null on failure
- Reuse without modification

**`gateway/src/services/promptBuilder.ts` - `formatResolvedContext()`**
- Formats resolved entities and diagrams into compact JSON for prompt injection
- Can be reused for highlighted context formatting or adapted with additional section header

**`architecture-model-service/.../service/ImplementContextResolutionService.java`**
- Existing service resolves entity and diagram IDs to summaries
- `resolveDiagram()` already collects `referencedEntityIds` from diagram nodes
- Extend to also resolve those IDs to entity names using existing entity resolution methods

## Out of Scope
- Changes to bootstrap phase content or behavior (Stage 3 is complete)
- New conversation phases beyond 'bootstrap', 'refine', 'handoff'
- Automatic synchronization of UI selection state with assistant messages
- Transcript persistence to disk
- Changes to the Implement button or spec generation behavior (handoff phase)
- New UI for selecting/highlighting entities or diagrams (existing selection UX is sufficient)
- Streaming endpoint support for implement_feature mode
- Caching of resolved context across requests
- Validation that highlighted IDs exist before resolution (backend handles missing IDs gracefully)
- Changes to the product summary or meta-model summary endpoints
