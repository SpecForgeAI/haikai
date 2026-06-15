# Spec: Implement Context Include Relationships and Propagate to Planner Payload

**Created:** 2026-01-26
**Status:** Ready for Implementation
**Services:** frontend, architecture-model-service, gateway (verify pass-through)
**Product Area:** Product & Delivery
**Screen:** Implement Feature

## Overview

Relationships selected in the Context Picker must be persisted alongside entities and diagrams in the implement-context API and propagated to the planner LLM via the chat payload. Currently, the `ContextPickerModal` supports relationship selection and stores `relationship_refs` in the frontend `ContextState`, but these are not persisted to the backend or included in chat requests.

This spec adds relationship persistence and payload propagation end-to-end while maintaining backward compatibility.

## Goals

1. Persist selected relationships in `ImplementContextDto` with same lifecycle as entities/diagrams
2. Return relationship selections from the implement-context GET endpoint
3. Include relationships in the `/api/chat` request's `architectureContext` for planner enrichment
4. Display relationship count chip alongside entities/diagrams in the UI
5. Maintain separation between user-selected relationships and auto-discovered `resolved_relationships[]`

## Non-Goals

- No UI redesign beyond persistence/rehydration and chip display
- No label rendering changes
- No planner prompt changes (planner just receives richer context)
- No bundle_type or depth for relationships (simple references only)

## Technical Design

### 1. Architecture Model Service Changes

#### 1.1 New DTO: RelationshipSelection

Create a new record for relationship selections mirroring the existing `EntitySelection` and `DiagramSelection` patterns.

**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/RelationshipSelection.java`

```java
package com.example.architecturemodel.model.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Data Transfer Object for structured relationship selection in implement context.
 *
 * Represents a single relationship selection with its type and label.
 * Simpler than EntitySelection - no bundle_type or depth needed.
 *
 * Uses @JsonProperty annotations with snake_case for API serialization consistency.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
public record RelationshipSelection(
    @JsonProperty("relationship_type")
    String relationshipType,

    @JsonProperty("relationship_id")
    String relationshipId,

    @JsonProperty("label")
    String label
) {}
```

#### 1.2 Extend ImplementContextDto

Add relationship fields to the existing DTO.

**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/ImplementContextDto.java`

**Changes:**
- Add `selected_relationship_ids: List<String>` (legacy ID field for consistency)
- Add `selected_relationship_selections: List<RelationshipSelection>` (structured selections)

```java
public record ImplementContextDto(
    @JsonProperty("project_id")
    String projectId,

    @JsonProperty("work_item_id")
    UUID workItemId,

    @JsonProperty("selected_entity_ids")
    List<String> selectedEntityIds,

    @JsonProperty("selected_diagram_ids")
    List<String> selectedDiagramIds,

    @JsonProperty("selected_entity_selections")
    List<EntitySelection> selectedEntitySelections,

    @JsonProperty("selected_diagram_selections")
    List<DiagramSelection> selectedDiagramSelections,

    /**
     * Legacy field: List of selected relationship IDs.
     * Format: "relationshipType::relationshipId"
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     */
    @JsonProperty("selected_relationship_ids")
    List<String> selectedRelationshipIds,

    /**
     * Structured relationship selections with relationship_type, relationship_id, and label.
     *
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     */
    @JsonProperty("selected_relationship_selections")
    List<RelationshipSelection> selectedRelationshipSelections
) {
    /**
     * Backward-compatible constructor that defaults new fields to empty lists.
     */
    public ImplementContextDto(
            String projectId,
            UUID workItemId,
            List<String> selectedEntityIds,
            List<String> selectedDiagramIds,
            List<EntitySelection> selectedEntitySelections,
            List<DiagramSelection> selectedDiagramSelections) {
        this(projectId, workItemId, selectedEntityIds, selectedDiagramIds,
             selectedEntitySelections, selectedDiagramSelections,
             new ArrayList<>(), new ArrayList<>());
    }
}
```

#### 1.3 Extend WorkItemImplementContextEntity

Add JSONB columns for relationship persistence.

**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementContextEntity.java`

**Changes:**
- Add `selectedRelationshipIds: List<String>` (JSONB column)
- Add `selectedRelationshipSelections: List<RelationshipSelection>` (JSONB column)

```java
/**
 * List of selected relationship IDs stored as JSONB array.
 * Format: "relationshipType::relationshipId"
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
@Type(JsonType.class)
@Column(name = "selected_relationship_ids", columnDefinition = "jsonb")
@Builder.Default
private List<String> selectedRelationshipIds = new ArrayList<>();

/**
 * List of structured relationship selections.
 * Stored as JSONB array of RelationshipSelection objects.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
@Type(JsonType.class)
@Column(name = "selected_relationship_selections", columnDefinition = "jsonb")
@Builder.Default
private List<RelationshipSelection> selectedRelationshipSelections = new ArrayList<>();
```

#### 1.4 Database Migration

Add migration for new JSONB columns.

**File:** `architecture-model-service/src/main/resources/db/changelog/sql/035-work-item-implement-context-relationships.sql`

```sql
-- Spec: Implement Context Include Relationships and Propagate to Planner Payload
-- Add relationship selection columns to work_item_implement_context table

ALTER TABLE work_item_implement_context
    ADD COLUMN IF NOT EXISTS selected_relationship_ids JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS selected_relationship_selections JSONB DEFAULT '[]'::jsonb;

-- Add comment for documentation
COMMENT ON COLUMN work_item_implement_context.selected_relationship_ids IS 'Array of selected relationship IDs in format relationshipType::relationshipId';
COMMENT ON COLUMN work_item_implement_context.selected_relationship_selections IS 'Array of RelationshipSelection objects with relationship_type, relationship_id, label';
```

**File:** `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml`

Add the new changeset:

```yaml
- include:
    file: db/changelog/sql/035-work-item-implement-context-relationships.sql
```

#### 1.5 Update WorkItemImplementContextService

Extend service to handle relationship selections.

**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/service/WorkItemImplementContextService.java`

**Changes to `getContext()`:**
- Return relationship fields (default to empty lists if null)

**Changes to `saveContext()`:**
- Accept relationship parameters
- Persist to entity

**Changes to `toDto()`:**
- Map relationship fields from entity to DTO
- Always return empty lists (never null) for backward compatibility

```java
/**
 * Extended save method with relationship support.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
@Transactional
public ImplementContextDto saveContext(String projectId, UUID workItemId,
                                       List<String> entityIds, List<String> diagramIds,
                                       List<EntitySelection> entitySelections,
                                       List<DiagramSelection> diagramSelections,
                                       List<String> relationshipIds,
                                       List<RelationshipSelection> relationshipSelections) {
    // ... existing entity lookup/creation logic ...

    entity.setSelectedRelationshipIds(relationshipIds != null ? new ArrayList<>(relationshipIds) : new ArrayList<>());
    entity.setSelectedRelationshipSelections(relationshipSelections != null ? new ArrayList<>(relationshipSelections) : new ArrayList<>());

    // ... save and return ...
}
```

#### 1.6 Update WorkItemImplementContextController

Extend controller to accept relationship fields in request body.

**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/WorkItemImplementContextController.java`

**Changes to `SaveContextRequest`:**
- Add `selected_relationship_ids: List<String>`
- Add `selected_relationship_selections: List<RelationshipSelection>`

```java
public record SaveContextRequest(
    @JsonProperty("selected_entity_ids")
    List<String> selectedEntityIds,

    @JsonProperty("selected_diagram_ids")
    List<String> selectedDiagramIds,

    @JsonProperty("selected_entity_selections")
    List<EntitySelection> selectedEntitySelections,

    @JsonProperty("selected_diagram_selections")
    List<DiagramSelection> selectedDiagramSelections,

    /**
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     */
    @JsonProperty("selected_relationship_ids")
    List<String> selectedRelationshipIds,

    /**
     * Spec: Implement Context Include Relationships and Propagate to Planner Payload
     */
    @JsonProperty("selected_relationship_selections")
    List<RelationshipSelection> selectedRelationshipSelections
) {}
```

### 2. Frontend Changes

#### 2.1 Update implementContextApi.ts

Extend API client to handle relationship fields.

**File:** `frontend/src/api/implementContextApi.ts`

**Changes:**

1. Add `RelationshipSelectionDto` interface:
```typescript
/**
 * Structured relationship selection DTO (matches backend RelationshipSelection)
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
interface RelationshipSelectionDto {
  relationship_type: string;
  relationship_id: string;
  label: string;
}
```

2. Extend `ImplementContextDto` interface:
```typescript
interface ImplementContextDto {
  // ... existing fields ...
  selected_relationship_ids?: string[];
  selected_relationship_selections?: RelationshipSelectionDto[] | null;
}
```

3. Add `parseRelationshipRef()` function:
```typescript
/**
 * Parses relationship ID string into RelationshipRef.
 * Format: "relationshipType::relationshipId"
 */
function parseRelationshipRef(
  relationshipIdStr: string,
  relationshipSelections?: RelationshipSelectionDto[] | null
): RelationshipRef {
  const parts = relationshipIdStr.split('::');
  if (parts.length >= 2) {
    const relationshipType = parts[0];
    const relationshipId = parts[1];

    // Look up label from structured selections
    let label = relationshipId; // Default to ID
    if (relationshipSelections && relationshipSelections.length > 0) {
      const selection = relationshipSelections.find(
        (s) => s.relationship_type === relationshipType && s.relationship_id === relationshipId
      );
      if (selection) {
        label = selection.label;
      }
    }

    return {
      kind: 'RELATIONSHIP',
      relationship_type: relationshipType,
      relationship_id: relationshipId,
      label,
    };
  }
  // Fallback for simple ID format
  return {
    kind: 'RELATIONSHIP',
    relationship_type: 'unknown',
    relationship_id: relationshipIdStr,
    label: relationshipIdStr,
  };
}
```

4. Add `relationshipRefToString()` function:
```typescript
/**
 * Converts RelationshipRef to storage string format.
 * Format: "relationshipType::relationshipId"
 */
function relationshipRefToString(ref: RelationshipRef): string {
  return `${ref.relationship_type}::${ref.relationship_id}`;
}
```

5. Add `relationshipRefToSelection()` function:
```typescript
/**
 * Converts RelationshipRef to RelationshipSelectionDto.
 */
function relationshipRefToSelection(ref: RelationshipRef): RelationshipSelectionDto {
  return {
    relationship_type: ref.relationship_type,
    relationship_id: ref.relationship_id,
    label: ref.label,
  };
}
```

6. Update `mapDtoToContextState()`:
```typescript
function mapDtoToContextState(dto: ImplementContextDto): ContextState {
  return {
    version: 1,
    entity_refs: (dto.selected_entity_ids || []).map((id) =>
      parseEntityRef(id, dto.selected_entity_selections)
    ),
    diagram_refs: (dto.selected_diagram_ids || []).map((id) =>
      parseDiagramRef(id, dto.selected_diagram_selections)
    ),
    relationship_refs: (dto.selected_relationship_ids || []).map((id) =>
      parseRelationshipRef(id, dto.selected_relationship_selections)
    ),
  };
}
```

7. Update `saveImplementContext()` request body:
```typescript
const requestBody = {
  selected_entity_ids: state.entity_refs.map(entityRefToString),
  selected_diagram_ids: state.diagram_refs.map((ref) => ref.diagram_id),
  selected_entity_selections: state.entity_refs.map(entityRefToSelection),
  selected_diagram_selections: state.diagram_refs.map(diagramRefToSelection),
  // Spec: Implement Context Include Relationships and Propagate to Planner Payload
  selected_relationship_ids: (state.relationship_refs || []).map(relationshipRefToString),
  selected_relationship_selections: (state.relationship_refs || []).map(relationshipRefToSelection),
};
```

#### 2.2 Update chatApi.ts Types

Extend `ArchitectureContextPayload` to include relationship fields.

**File:** `frontend/src/api/chatApi.ts`

**Changes:**

1. Add `RelationshipContextPayload` interface:
```typescript
/**
 * Relationship context payload for planner.
 * Contains resolved relationship details for LLM consumption.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
export interface RelationshipContextPayload {
  /** Relationship unique identifier */
  id: string;
  /** Relationship type (e.g., "data_movements", "logical_data_entity_relationships") */
  type: string;
  /** Human-readable label or summary */
  label: string;
  /** Source entity reference (entity_type::entity_id) */
  from_entity?: string;
  /** Target entity reference (entity_type::entity_id) */
  to_entity?: string;
}
```

2. Extend `ArchitectureContextPayload`:
```typescript
export interface ArchitectureContextPayload {
  /** Array of linked entity IDs (legacy format for backward compatibility) */
  entityIds: string[];
  /** Array of linked diagram IDs (legacy format for backward compatibility) */
  diagramIds: string[];
  entities?: EntityBundleSelection[];
  diagrams?: DiagramBundleSelection[];
  /**
   * Array of user-selected relationship IDs.
   * Format: "relationshipType::relationshipId"
   *
   * Spec: Implement Context Include Relationships and Propagate to Planner Payload
   */
  relationshipIds?: string[];
  /**
   * Array of resolved relationship objects for planner.
   * Contains id, type, label, and participant references.
   *
   * Spec: Implement Context Include Relationships and Propagate to Planner Payload
   */
  relationships?: RelationshipContextPayload[];
}
```

#### 2.3 Update ImplementationAssistantPanel buildContext()

Include relationships in the chat context.

**File:** `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx`

**Changes to `buildContext()`:**

```typescript
const buildContext = useCallback(
  (intent: ImplementChatIntent, phase: ImplementChatPhase): ImplementChatContext => {
    // ... existing entityIds, diagramIds, entities, diagrams construction ...

    // Spec: Implement Context Include Relationships and Propagate to Planner Payload
    // Construct relationshipIds in format "relationshipType::relationshipId"
    const relationshipIds = (contextState.relationship_refs || []).map(
      (ref) => `${ref.relationship_type}::${ref.relationship_id}`
    );

    // Construct relationships[] array with resolved details for planner
    // Frontend passes resolved objects so gateway doesn't need to re-resolve
    const relationships: RelationshipContextPayload[] = (contextState.relationship_refs || []).map((ref) => ({
      id: ref.relationship_id,
      type: ref.relationship_type,
      label: ref.label,
      // from_entity and to_entity are not available in RelationshipRef
      // If needed, they would come from relationshipOptions in ContextPickerModal
    }));

    return {
      mode: 'implement_feature',
      intent,
      phase,
      filename: projectId,
      projectParentFolder: activeProject?.projectParentFolder,
      featureId: workItemId,
      featureTitle: workItemTitle,
      workItem: {
        id: workItemId,
        title: workItemTitle,
        type: workItemType,
        description: workItemDescription,
      },
      architectureContext: {
        entityIds,
        diagramIds,
        entities,
        diagrams,
        // Spec: Implement Context Include Relationships and Propagate to Planner Payload
        relationshipIds,
        relationships,
      },
    };
  },
  [workItemId, workItemTitle, workItemType, workItemDescription, contextState, projectId, activeProject?.projectParentFolder]
);
```

#### 2.4 Add Relationship Chip/Count Display

Display relationship count alongside entities/diagrams in the UI.

**Location:** The chip display is in `FeatureHeader.tsx` or a similar header component that shows context counts.

**Pattern:** Follow the existing pattern for entity and diagram chips:

```typescript
// Example: Add relationship chip if count > 0
const relationshipCount = contextState.relationship_refs?.length || 0;

// In JSX:
{relationshipCount > 0 && (
  <span className={styles.contextChip} data-testid="relationship-count-chip">
    {relationshipCount} Relationship{relationshipCount !== 1 ? 's' : ''}
  </span>
)}
```

### 3. Gateway Changes

#### 3.1 Update Type Definitions

Extend `ArchitectureContext` interface to accept relationship fields.

**File:** `gateway/src/types/chat.ts`

**Changes:**

1. Add `RelationshipContextPayload` interface:
```typescript
/**
 * Relationship context payload for planner consumption.
 * Contains resolved relationship details passed from frontend.
 *
 * Spec: Implement Context Include Relationships and Propagate to Planner Payload
 */
export interface RelationshipContextPayload {
  /** Relationship unique identifier */
  id: string;
  /** Relationship type */
  type: string;
  /** Human-readable label */
  label: string;
  /** Source entity reference (optional) */
  from_entity?: string;
  /** Target entity reference (optional) */
  to_entity?: string;
}
```

2. Extend `ArchitectureContext`:
```typescript
export interface ArchitectureContext {
  entityIds: string[];
  diagramIds: string[];
  entities?: EntityBundleSelection[];
  diagrams?: DiagramBundleSelection[];
  /**
   * User-selected relationship IDs.
   * Separate from auto-discovered resolved_relationships.
   *
   * Spec: Implement Context Include Relationships and Propagate to Planner Payload
   */
  relationshipIds?: string[];
  /**
   * User-selected relationships with resolved details.
   * Frontend passes resolved objects; gateway passes through to planner.
   *
   * Spec: Implement Context Include Relationships and Propagate to Planner Payload
   */
  relationships?: RelationshipContextPayload[];
}
```

#### 3.2 Verify Gateway Pass-Through

The gateway should pass `architectureContext` through to the prompt builder without modification. Verify that:

1. `chat.ts` route handler includes the full `architectureContext` in the context passed to `buildSystemPrompt()`
2. `promptBuilder.ts` includes relationships in the context section of the system prompt

**File:** `gateway/src/services/promptBuilder.ts`

If the prompt builder formats architecture context for the LLM, add relationship formatting:

```typescript
// In buildImplementFeatureContextSection() or similar:

// User-selected relationships (separate from auto-discovered)
if (context.architectureContext?.relationships?.length) {
  contextLines.push('\n## User-Selected Relationships');
  for (const rel of context.architectureContext.relationships) {
    contextLines.push(`- ${rel.label} (${rel.type})`);
  }
}
```

**Ordering:** User-selected relationships should come before auto-discovered `resolved_relationships[]` in the prompt to preserve provenance.

### 4. Data Flow Summary

```
ContextPickerModal (user selects relationships)
    |
    v
ContextState.relationship_refs (frontend state)
    |
    v
saveImplementContext() --> PUT /api/.../implement-context
    |                        (includes relationship_ids and relationship_selections)
    v
WorkItemImplementContextEntity (persisted to PostgreSQL)
    |
    v
GET /api/.../implement-context --> ImplementContextDto
    |                               (returns relationship fields)
    v
mapDtoToContextState() --> ContextState.relationship_refs (rehydrated)
    |
    v
buildContext() --> ImplementChatContext.architectureContext
    |               (includes relationshipIds and relationships)
    v
POST /api/chat --> Gateway --> Planner LLM
                   (relationships in system prompt context)
```

### 5. Backward Compatibility

1. **Service:** Default to empty arrays (not null) when relationship fields are missing in database or API responses
2. **Frontend:** Handle undefined/null `relationship_refs` gracefully with `|| []` patterns
3. **Gateway:** Treat missing `relationshipIds`/`relationships` as empty arrays
4. **Migration:** New columns default to empty JSONB arrays; existing rows are unaffected

### 6. Test Plan

#### 6.1 Backend Unit Tests

**File:** `architecture-model-service/src/test/java/com/example/architecturemodel/service/WorkItemImplementContextServiceTest.java`

- Test saving context with relationship selections
- Test retrieving context returns relationship selections
- Test empty relationships default to empty arrays (not null)
- Test backward compatibility with existing contexts (no relationships)

**File:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/WorkItemImplementContextControllerTest.java`

- Test PUT with relationship fields
- Test GET returns relationship fields
- Test backward compatible request (no relationship fields)

#### 6.2 Frontend Unit Tests

**File:** `frontend/src/__tests__/implementContextApi.relationships.test.ts`

- Test `parseRelationshipRef()` parses "type::id" format
- Test `relationshipRefToString()` serializes correctly
- Test `mapDtoToContextState()` populates `relationship_refs`
- Test `saveImplementContext()` includes relationships in request body
- Test empty/null relationship handling

**File:** `frontend/src/__tests__/ImplementationAssistantPanel.relationships.test.tsx`

- Test `buildContext()` includes relationshipIds and relationships
- Test relationship count chip displays correctly
- Test chip hidden when count is 0

#### 6.3 Integration Tests

**File:** `frontend/src/__tests__/implement-context-relationships.integration.test.ts`

- Test full save/load roundtrip with relationships
- Test relationships appear in chat payload
- Test rehydration populates relationship state

### 7. Task Groups

#### Task Group 1: Backend DTO and Entity Changes (architecture-model-service)
**Estimated effort:** S (2-3 days)

1.1. Create `RelationshipSelection.java` DTO record
1.2. Extend `ImplementContextDto.java` with relationship fields
1.3. Extend `WorkItemImplementContextEntity.java` with JSONB columns
1.4. Create database migration `035-work-item-implement-context-relationships.sql`
1.5. Update `db.changelog-master.yaml` to include migration

#### Task Group 2: Backend Service and Controller Changes (architecture-model-service)
**Estimated effort:** S (2-3 days)

2.1. Update `WorkItemImplementContextService.saveContext()` to accept relationship params
2.2. Update `WorkItemImplementContextService.toDto()` to map relationship fields
2.3. Update `WorkItemImplementContextService.getContext()` to return empty arrays for null
2.4. Update `SaveContextRequest` record with relationship fields
2.5. Update controller to pass relationship fields to service

#### Task Group 3: Backend Unit Tests (architecture-model-service)
**Estimated effort:** S (2-3 days)

3.1. Add service tests for relationship save/retrieve
3.2. Add controller tests for relationship endpoints
3.3. Add backward compatibility tests

#### Task Group 4: Frontend API Client Changes
**Estimated effort:** S (2-3 days)

4.1. Add `RelationshipSelectionDto` interface to `implementContextApi.ts`
4.2. Add `parseRelationshipRef()` function
4.3. Add `relationshipRefToString()` and `relationshipRefToSelection()` functions
4.4. Update `mapDtoToContextState()` to populate `relationship_refs`
4.5. Update `saveImplementContext()` request body with relationship fields

#### Task Group 5: Frontend Chat Payload Changes
**Estimated effort:** S (2-3 days)

5.1. Add `RelationshipContextPayload` interface to `chatApi.ts`
5.2. Extend `ArchitectureContextPayload` with relationship fields
5.3. Update `buildContext()` in `ImplementationAssistantPanel.tsx`

#### Task Group 6: Frontend UI Changes (Relationship Chip)
**Estimated effort:** XS (1 day)

6.1. Add relationship count chip to context summary display
6.2. Follow existing pattern from entity/diagram chips

#### Task Group 7: Gateway Type Updates
**Estimated effort:** XS (1 day)

7.1. Add `RelationshipContextPayload` interface to `gateway/src/types/chat.ts`
7.2. Extend `ArchitectureContext` interface with relationship fields
7.3. Verify pass-through in chat route (no code changes expected)

#### Task Group 8: Frontend Unit Tests
**Estimated effort:** S (2-3 days)

8.1. Add tests for `implementContextApi.ts` relationship functions
8.2. Add tests for `buildContext()` relationship handling
8.3. Add tests for relationship chip display

#### Task Group 9: Integration Tests
**Estimated effort:** S (2-3 days)

9.1. Add save/load roundtrip test with relationships
9.2. Add chat payload verification test
9.3. Add rehydration test

## Files to Modify

### architecture-model-service
- `src/main/java/com/example/architecturemodel/model/dto/RelationshipSelection.java` (NEW)
- `src/main/java/com/example/architecturemodel/model/dto/ImplementContextDto.java`
- `src/main/java/com/example/architecturemodel/model/entity/WorkItemImplementContextEntity.java`
- `src/main/java/com/example/architecturemodel/service/WorkItemImplementContextService.java`
- `src/main/java/com/example/architecturemodel/controller/WorkItemImplementContextController.java`
- `src/main/resources/db/changelog/sql/035-work-item-implement-context-relationships.sql` (NEW)
- `src/main/resources/db/changelog/db.changelog-master.yaml`
- `src/test/java/com/example/architecturemodel/service/WorkItemImplementContextServiceTest.java`
- `src/test/java/com/example/architecturemodel/controller/WorkItemImplementContextControllerTest.java`

### frontend
- `src/api/implementContextApi.ts`
- `src/api/chatApi.ts`
- `src/components/ProductView/ImplementationAssistantPanel.tsx`
- `src/components/ProductView/FeatureHeader.tsx` (or similar for chip display)
- `src/__tests__/implementContextApi.relationships.test.ts` (NEW)
- `src/__tests__/ImplementationAssistantPanel.relationships.test.tsx` (NEW)
- `src/__tests__/implement-context-relationships.integration.test.ts` (NEW)

### gateway
- `src/types/chat.ts`
- `src/services/promptBuilder.ts` (if relationship formatting needed)

## References

- Existing patterns: `EntitySelection.java`, `DiagramSelection.java`
- Context storage types: `frontend/src/utils/contextStorage.ts`
- Context picker: `frontend/src/components/ProductView/ContextPickerModal.tsx`
- Implement context API: `frontend/src/api/implementContextApi.ts`
- Chat API types: `frontend/src/api/chatApi.ts`, `gateway/src/types/chat.ts`
- Service implementation: `WorkItemImplementContextService.java`
- Controller: `WorkItemImplementContextController.java`
