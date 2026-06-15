# Specification: Global Application Point Picker with Derived ApplicationPoints

## Goal
Enable relationship grids to select any Application Domain entity (Service, Class, or Method) wherever an Application Point is referenced, auto-creating derived ApplicationPoints on-demand when a Service/Class/Method is selected.

## User Stories
- As an architect, I want to select a Class or Method when defining a relationship to an Application Point so that I can precisely target business logic at the method-level granularity
- As an architect, I want the system to auto-create derived ApplicationPoints when I select a Service/Class/Method so that existing relationship structures remain intact without manual ApplicationPoint creation

## Specific Requirements

**Requirement 1: ApplicationPointPickerCell Component**
- Create new cell type `application_point_picker` in GridCell.tsx that extends TypeaheadCell pattern
- Display grouped dropdown sections: "Existing Application Points", "Services", "Classes", "Methods"
- Each group header should be non-selectable and visually distinct (bold, gray background)
- Search should filter across all groups simultaneously
- Reuse TypeaheadCell's dropdown positioning logic (above/below based on screen position)
- Support custom displayFormatter for showing entity type context

**Requirement 2: Derived ApplicationPoint Creation Logic**
- Create `applicationPointDerivation.ts` utility module with core functions
- `findDerivedApplicationPoint(targetType, targetRefId, applicationPoints)`: Find existing derived AP by target_type and target_ref_id
- `deriveApplicationIdForClass(classId, metaModel)`: Walk owned_by_ref_kind/owned_by_ref_id chain to find application_id
- `deriveApplicationIdForMethod(methodId, metaModel)`: Get class_id, then call deriveApplicationIdForClass
- `ensureDerivedApplicationPoint(targetType, targetRefId, metaModel)`: Find or create derived AP, returning the AP id

**Requirement 3: ApplicationPoint Kind and Target Type Expansion**
- Expand ApplicationPointKind type in model.ts to include 'CLASS' and 'METHOD' values
- Existing kind values: 'APPLICATION' | 'APP_COMPONENT' | 'SERVICE'
- New kind values: 'CLASS' | 'METHOD'
- APPLICATION_POINT_KIND_LABELS in formatters.ts must be updated with labels for CLASS and METHOD
- formatApplicationPointDisplay must handle derived APs with target_type/target_ref_id

**Requirement 4: Derived ApplicationPoint Naming Convention**
- For SERVICE: Use service.name directly
- For CLASS: Use `${namespace}.${className}` if namespace exists, otherwise just className
- For METHOD: Use `${className}#${methodName}` format
- Name should be derived automatically from target entity, not user-editable

**Requirement 5: Update Relationship Grid Configurations**
- Replace `cellType: 'fk_typeahead'` with `cellType: 'application_point_picker'` for these columns:
  - `application_point_business_points.application_point_id`
  - `application_point_business_logics.application_point_id`
  - `data_movements.source_application_point_id`
  - `data_movements.target_application_point_id`
- Preserve existing displayFormatter (applicationPointDisplayFormatter) on these columns

**Requirement 6: Display Formatting for Derived ApplicationPoints**
- When ApplicationPoint has target_type and target_ref_id set, formatApplicationPointDisplay should show:
  - `"<name> (targets <TargetType>: <ResolvedTargetName>)"`
  - Example: "OrderService#processOrder (targets METHOD: processOrder)"
- When target_type/target_ref_id are not set, continue showing existing format: `"<name> (<kind>)"`
- Resolve target entity name by looking up target_ref_id in the appropriate entity collection

**Requirement 7: Reducer Integration for On-Select Derivation**
- When ApplicationPointPickerCell selects a Service/Class/Method, invoke ensureDerivedApplicationPoint
- If new AP is created, dispatch ADD_ENTITY action for application_points before setting the relationship FK
- Use generated AP id as the relationship FK value
- If existing derived AP found, use its id directly without creating new entity

**Requirement 8: Backend Validation Hardening**
- ModelService.validateApplicationPointTargets already validates target_type/target_ref_id pairwise constraint
- Add validation: application_id is required for all ApplicationPoints (cannot be null/blank)
- Add validation: For derived APs with target_type=CLASS, verify class exists in classes collection
- Add validation: For derived APs with target_type=METHOD, verify method exists in methods collection
- Error message format: `"ApplicationPoint validation failed for id '<id>': <specific error>"`

## Visual Design
No visual mockups provided. The ApplicationPointPickerCell dropdown follows existing TypeaheadCell styling with added section headers.

## Existing Code to Leverage

**TypeaheadCell.tsx (C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/components/Grid/TypeaheadCell.tsx)**
- Provides fk_typeahead cell type pattern with dropdown, search filtering, and positioning
- getTargetEntities function shows how to resolve FK targets dynamically
- displayFormatter integration shows how to customize display text
- Re-use dropdown positioning logic (getDropdownPosition function)

**applicationPointSync.ts (C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/applicationPointSync.ts)**
- generateApplicationPointId pattern: `ap_${sourceEntityId}` - extend for derived APs
- createApplicationPointFromEntity shows ApplicationPoint creation with kind/FK fields
- findApplicationPointForEntity demonstrates lookup by deterministic ID
- Reconciliation pattern can inform derived AP handling on model load

**formatters.ts (C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/utils/formatters.ts)**
- APPLICATION_POINT_KIND_LABELS maps kind values to display labels
- formatApplicationPointDisplay function to extend for target_type display
- applicationPointDisplayFormatter used in gridConfigs for relationship grids

**gridConfigs.ts (C:/Workspaces/SSD/architecture-store-and-diagrams/frontend/src/config/gridConfigs.ts)**
- Relationship grid configurations for application_point_business_points, data_movements, etc.
- dynamicFkTargetField/dynamicFkTargetMap pattern on application_points.target_ref_id column
- displayFormatter: applicationPointDisplayFormatter already applied to AP columns

**ModelService.java (C:/Workspaces/SSD/architecture-store-and-diagrams/architecture-model-service/src/main/java/com/example/architecturemodel/service/ModelService.java)**
- validateApplicationPointTargets method validates target_type/target_ref_id constraints
- Builds Set<String> of valid IDs per target type (services, classes, methods)
- Throws IllegalArgumentException with descriptive error message format

## Out of Scope
- Creating new REST API endpoints - continue using existing /api/model round-trip
- Modifying the application_points entity grid directly - only relationship grids are affected
- Changing how existing non-derived ApplicationPoints are created or managed
- Adding UI for manually editing derived ApplicationPoint names - names are always derived
- Backend database schema changes - ApplicationPoint entity already has target_type/target_ref_id columns
- Modifying the PalettePanel or diagram canvas drag-drop behavior
- Adding new diagram types or diagram rendering changes
- Changing the ApplicationPoint reconciliation logic in applicationPointSync.ts
- Adding delete cascade for derived ApplicationPoints when target entity is deleted
- Supporting Endpoint as a target type (only Service, Class, Method)
