# Specification: Data Movement Application Points

## Goal
Update Data Movements to reference Application Points instead of Applications, making them consistent with the App Point abstraction used elsewhere in the system for modeling data flows between any combination of Applications, App Components, and Services.

## User Stories
- As a modeler, I want Data Movements to reference Application Points so that data flows can be defined between any combination of Applications, App Components, and Services.
- As a diagram author, I want Data Movement palette rows to enable when app point endpoints are on the diagram so that I can add edges consistently with other relationships.

## Specific Requirements

**Meta-model Schema Changes**
- Update `DataMovement` interface in `frontend/src/types/model.ts` to replace `source_application_id` and `target_application_id` with `source_application_point_id` and `target_application_point_id`
- Both new fields are required and must reference valid `application_points.id` entries
- Update any type casts in rendering.ts (`getRelationshipEndpointEntities` function) and relationshipUtils.ts (`isDataMovementEnabledWithSets`, `getDataMovementNodes`) to use the new field names
- Remove references to `source_application_id` and `target_application_id` throughout the codebase

**Grid Configuration Updates**
- Update `gridConfigs.ts` data_movements configuration to change column fields from `source_application_id`/`target_application_id` to `source_application_point_id`/`target_application_point_id`
- Update column headers from "Source App" to "Source App Point" and "Target App" to "Target App Point"
- Change `fkTarget` from `'applications'` to `'application_points'` for both columns
- Add `displayFormatter: applicationPointDisplayFormatter` to show format `"<name> (<type>)"` where type is Application/Application Component/Service

**Validation Updates**
- Update validation in `validation.ts` to validate that `source_application_point_id` and `target_application_point_id` reference existing `application_points` entries
- Validation is already handled by the FK typeahead column configuration; ensure fkTarget change propagates correctly
- Remove any remaining validation logic that checked against `applications` for Data Movements

**Palette Enable/Disable Logic**
- Update `isDataMovementEnabledWithSets` in `relationshipUtils.ts` to use `source_application_point_id` and `target_application_point_id` directly
- Remove the intermediate lookup that maps `source_application_id`/`target_application_id` to application_points
- Check `entities.applicationPointsOnDiagram.has(relationship.source_application_point_id)` and `entities.applicationPointsOnDiagram.has(relationship.target_application_point_id)`
- Enabled when both app points are represented on the diagram (via APPLICATION, APP_COMPONENT, SERVICE, or APPLICATION_POINT nodes)

**Edge Creation Updates**
- Update `getDataMovementNodes` in `relationshipUtils.ts` to use `source_application_point_id` and `target_application_point_id`
- Rename internal helper from `findNodeForApplication` to `findNodeForApplicationPoint`
- Update node search priority: APPLICATION -> APP_COMPONENT -> SERVICE -> APPLICATION_POINT
- Lookup via `application_points` to find which entity type the app point represents (via `kind` field)
- Edge properties remain unchanged: `arrow_start=NONE`, `arrow_end=ARROW`, `line_type=SOLID`
- Label defaults to Logical Data Entity name (existing behavior preserved)

**Rendering Utilities Updates**
- Update `getRelationshipEndpointEntities` in `rendering.ts` for the DATA_MOVEMENT case
- Change from looking up `applications` via `source_application_id`/`target_application_id` to looking up `application_points` via `source_application_point_id`/`target_application_point_id`
- Return the application_points as endpoint entities for temporal visibility checking

## Existing Code to Leverage

**getEntitiesOnDiagram in relationshipUtils.ts**
- Already maps APPLICATION, APP_COMPONENT, and SERVICE nodes to their corresponding application_point IDs in the `applicationPointsOnDiagram` Set
- This abstraction enables the palette enable/disable logic to work correctly once Data Movements reference app points directly
- No changes needed to this function

**applicationPointDisplayFormatter in formatters.ts**
- Already implements the display format `"<name> (<type>)"` with type labels: Application, Application Component, Service
- Used by App Point <-> Process relationship grid; reuse directly for Data Movements
- Import and apply to both source and target app point columns in gridConfigs.ts

**App Point <-> Process relationship pattern**
- `application_point_business_processes` grid config shows the pattern for app point FK columns
- Uses `fkTarget: 'application_points'` and `displayFormatter: applicationPointDisplayFormatter`
- Follow identical pattern for Data Movements source/target columns

**findNodeForApplication pattern in getDataMovementNodes**
- Existing helper searches for nodes representing an application via APPLICATION, APP_COMPONENT, SERVICE, or APPLICATION_POINT nodes
- Adapt this pattern to search by application_point_id instead of application_id
- Use app point's `kind` field to determine which entity type to prioritize

## Out of Scope
- Changes to other relationship types (User-Process, App Point-Process, Logical ER, etc.)
- Migration tooling for legacy JSON files with old field names
- New Data Movement features beyond the field migration
- UI changes beyond column headers and autocomplete behavior
- Backend changes (this is frontend-only)
- Backward compatibility shims for old field names
- Changes to the applicationPointsOnDiagram population logic
- Changes to edge styling or rendering behavior
- Adding new validation error messages beyond FK validation
