# Specification: Derived Application Points

## Goal
Transform Application Points from user-managed entities into automatically derived, internal records that maintain a one-to-one relationship with Applications, App Components, and Services, hiding this implementation detail from users while preserving existing diagram and relationship functionality.

## User Stories
- As an architect, I want to add Applications/Components/Services to diagrams without managing separate Application Points so that my workflow is simpler and more intuitive.
- As a user, I want the tool to automatically maintain data consistency when I create or delete Applications, Components, or Services so that I don't have to worry about orphaned records or broken relationships.

## Specific Requirements

**Application Point Synchronization Layer**
- Create a sync service that maintains one-to-one mapping between source entities (Application, App Component, Service) and Application Points
- On source entity creation: automatically create a corresponding Application Point with `kind` field set to "APPLICATION", "APP_COMPONENT", or "SERVICE"
- Generate deterministic Application Point IDs using pattern `ap_{source_entity_id}` for consistency across load/save cycles
- Copy the source entity's `name` field to the Application Point's `name` field at creation time
- Set `application_id` for APPLICATION kind, `application_component_id` for APP_COMPONENT kind, `service_id` for SERVICE kind

**Cascade Deletion Logic**
- When an Application/App Component/Service is deleted, automatically delete its corresponding Application Point
- Remove all `application_point_business_processes` records referencing the deleted Application Point
- Remove all `data_movements` records where `source_application_point_id` or `target_application_point_id` references the deleted Application Point
- Execute deletions within the same reducer action to maintain atomicity

**JSON Load Reconciliation**
- On JSON load, run a synchronization pass after the model is loaded into state
- Create missing Application Points for any Application/App Component/Service that lacks one
- Remove orphaned Application Points that do not map to any existing source entity
- Log warnings for orphaned records that are cleaned up during reconciliation
- Preserve existing Application Point IDs if they follow the deterministic pattern

**Meta-Model View Tab Removal**
- Remove "Application Points" from `entityTabNames` array in `gridConfigs.ts`
- Remove "Application Points" entry from `tabToEntityType` mapping
- Keep `application_points` grid config for internal use (debugging, future admin views)
- Ensure default selected tab does not reference removed tab

**Diagram Palette Section Removal**
- Remove `application_points` section from `getPaletteSections()` in `paletteData.ts`
- Keep the `getEntityTypeConstant` mapping for `application_points` for internal rendering logic
- No changes needed to Applications, App Components, Services sections - they remain visible

**Palette-to-Diagram Node Mapping**
- When user adds an Application from palette: look up corresponding Application Point, create `DiagramNode` with `entity_type=APPLICATION_POINT` and `entity_id=application_point.id`
- Same logic applies for App Components and Services - always create APPLICATION_POINT nodes internally
- Display label derived from source entity name via existing `getEntityLabel()` function
- Modify `handleItemClick` and `handleContextMenuAdd` in `PalettePanel.tsx` to perform Application Point lookup

**ApplicationPoint Interface Enhancement**
- Add `kind` field to `ApplicationPoint` interface: `kind: 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE'`
- Add optional foreign key fields: `application_component_id?: string` and `service_id?: string`
- Existing `application_id` field remains for APPLICATION kind (backward compatibility)
- Update `pointTypeOptions` or remove from UI since point_type becomes derived from kind

**Relationship Grid FK Display**
- Update `application_point_business_processes` grid FK typeahead to display source entity names
- Show format like "OMS System (Application)" or "Payment Module (Component)" in dropdown
- Stored value remains `application_point.id` unchanged
- Implement custom display resolver that looks up Application Point, then resolves to source entity name

## Visual Design
No visual mockups provided. Changes are primarily structural/behavioral with minimal UI impact.

## Existing Code to Leverage

**ArchitectureContext.tsx Reducer Pattern**
- Use existing `ADD_ENTITY` and `DELETE_ENTITY` action patterns as templates for sync operations
- Extend `LOAD_MODEL` case to include reconciliation pass after model is loaded
- Follow established immutable state update patterns with spread operators

**paletteData.ts Entity Section Pattern**
- Remove the `application_points` entry from `entitySections` array at line 75-79
- Keep `getEntityTypeConstant` mapping at line 21 for internal node type resolution

**gridConfigs.ts Tab Configuration**
- Remove "Application Points" from `entityTabNames` array at line 188
- Remove corresponding entry from `tabToEntityType` at line 164

**rendering.ts Entity Label Resolution**
- Extend `getEntityLabel()` to handle APPLICATION_POINT nodes by resolving through to source entity
- Use `entityTypeMap` at line 10-19 for type resolution

**idGenerator.ts ID Generation**
- Use `generatePrefixedId('ap')` pattern for Application Point IDs, or adopt deterministic `ap_{source_id}` pattern

## Out of Scope
- Syncing Application Point name when source entity name is edited (copy-on-create only for v0.x)
- Migration tooling for existing JSON files with manually-created Application Points
- Admin/debug view for inspecting derived Application Points
- Undo/redo support for cascade deletion operations
- Batch synchronization UI feedback or progress indicators
- Validation warnings when source entities exist without Application Points
- Application Point de-duplication if multiple points exist for same source
- Time-based validity inheritance from source entity to Application Point
- Custom styling or iconography to differentiate Application Point nodes by kind
- Multi-select palette operations for bulk Application Point creation
