# Specification: Persist Implement Context per Work Item in Backend

## Goal
Make the Implement context (architecture entities and diagrams linked to a work item) durable in the architecture-model-service database, replacing localStorage as the primary storage, so selections persist across browser sessions and devices.

## User Stories
- As a user on the Implement screen, I want my selected architecture entities and diagrams to persist in the backend so that my context selections are available after page reload or from another browser.
- As a user, I want to update my context selection and have it saved automatically to the backend so I do not lose my implementation context.

## Specific Requirements

**Backend Data Model - Work Item Implement Context Table**
- Create a new database table `work_item_implement_context` with columns: id (UUID primary key), project_id (TEXT), work_item_id (UUID), selected_entity_ids (JSONB array of strings), selected_diagram_ids (JSONB array of strings), created_at, updated_at
- Enforce unique constraint on (project_id, work_item_id) so only one context record exists per work item
- Use JSONB arrays for entity IDs and diagram IDs to store variable-length lists of string IDs
- Follow the migration pattern in `db.changelog-master.yaml` using a new SQL file (e.g., `026-work-item-implement-context.sql`)
- Include appropriate indexes on project_id and work_item_id for query performance

**Backend JPA Entity - WorkItemImplementContextEntity**
- Create entity class in `model/entity/` following patterns from `WorkItemEntity.java`
- Use Lombok annotations (@Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder)
- Map JSONB arrays using `@Type(JsonType.class)` for the entity ID and diagram ID list columns
- Include @PrePersist and @PreUpdate hooks for timestamp management

**Backend Repository - WorkItemImplementContextRepository**
- Create repository interface in `repository/entity/` extending JpaRepository
- Add finder method `findByProjectIdAndWorkItemId(String projectId, UUID workItemId)` returning Optional
- Add delete method `deleteByProjectIdAndWorkItemId(String projectId, UUID workItemId)` for cleanup scenarios

**Backend DTO - ImplementContextDto**
- Create record DTO in `model/dto/` following patterns from `WorkItemDto.java`
- Include fields: projectId, workItemId, selectedEntityIds (List of String), selectedDiagramIds (List of String)
- Use @JsonProperty annotations with snake_case for API serialization consistency

**Backend Service - WorkItemImplementContextService**
- Create service class in `service/` following patterns from `WorkItemService.java`
- Implement `getContext(String projectId, UUID workItemId)` - returns existing context or empty default
- Implement `saveContext(String projectId, UUID workItemId, List<String> entityIds, List<String> diagramIds)` - upserts context
- Return empty lists (not null) when no context exists to simplify frontend handling
- Log operations using @Slf4j for debugging and audit trail

**Backend Controller - WorkItemImplementContextController**
- Create REST controller scoped under `/api/projects/{projectId}/work-items/{workItemId}/implement-context`
- GET endpoint returns ImplementContextDto with current or empty context
- PUT endpoint accepts body with selectedEntityIds and selectedDiagramIds arrays, replaces stored selection
- Follow error handling patterns from WorkItemController (IllegalArgumentException, ResourceNotFoundException)
- Use @RequiredArgsConstructor for dependency injection

**Frontend API Client - implementContextApi.ts**
- Create new API client module in `frontend/src/api/` following patterns from `workItemsApi.ts`
- Implement `fetchImplementContext(projectId: string, workItemId: string)` returning Promise of ContextState
- Implement `saveImplementContext(projectId: string, workItemId: string, state: ContextState)` returning Promise
- Map snake_case API response to camelCase frontend types (selectedEntityIds, selectedDiagramIds)
- Use same API_BASE pattern and error handling as other API clients

**Frontend ProductImplementPage Integration**
- Modify `loadContext` useEffect to call backend API instead of localStorage via new `fetchImplementContext`
- Modify `handleContextApply` and chip removal handlers to call `saveImplementContext` API after state update
- Keep localStorage save as optional secondary cache but treat API as authoritative source
- Show loading state while fetching context from backend on work item selection

**Frontend ContextPickerModal Integration**
- No changes to modal internal logic required - it already receives initialSelected and calls onApply
- The parent ProductImplementPage handles API calls, modal remains a pure UI component
- Ensure Apply button triggers the backend save through the existing onApply callback chain

## Existing Code to Leverage

**WorkItemController.java and WorkItemService.java**
- Follow the same REST endpoint structure with @RestController, @RequestMapping, @PathVariable patterns
- Reuse validation approach (null checks, project ID validation)
- Follow the same service layer pattern with @Service, @Transactional, @RequiredArgsConstructor

**WorkItemEntity.java and WorkItemRepository.java**
- Use same JPA entity patterns with Lombok, @Entity, @Table, @Column annotations
- Follow the JSONB column handling pattern using @Type(JsonType.class) from hypersistence-utils
- Repository extends JpaRepository with custom finder methods

**workItemsApi.ts**
- Follow the same API client structure with API_BASE, fetch calls, and error handling
- Use the same snake_case to camelCase mapping pattern for DTOs
- Reuse the encodeURIComponent pattern for path parameters

**contextStorage.ts**
- Reuse the ContextState, EntityRef, and DiagramRef type definitions
- The createEmptyContextState() function provides the default empty state pattern
- Keep loadContext/saveContext functions but treat them as cache layer beneath API

**ProductImplementPage.tsx and ContextPickerModal.tsx**
- The existing useEffect for loading context provides the integration point for API call
- The handleContextApply callback chain is the integration point for save operations
- Preserve the existing UX flow - only change the data persistence layer

## Out of Scope
- LLM integration, Planner logic, or any AI-assisted features
- Changes to MCP tools or Gateway /api/chat endpoints
- Spec generation or execution workflows
- Foreign key constraints to entity or diagram tables (IDs stored as strings, not enforced at DB level)
- Delete cascade behavior when work items are deleted (context cleanup not required this iteration)
- Batch operations for context (single work item context operations only)
- Versioning or history of context changes (simple overwrite semantics)
- Validation that entity IDs or diagram IDs actually exist in the model
- Migration of existing localStorage data to backend (fresh start)
- Changes to the ContextPickerModal UI design or selection behavior
