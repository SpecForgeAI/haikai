# Specification: Expand Application Points to Reference Service/Class/Method and Add UI to Attach/Detach Business Logic

## Goal
Enable Business Logic entities to be formally linked to Application Points by extending Application Points to target Service, Class, or Method entities, and providing UI workflows to attach/detach Business Logic to/from Application Points via relationship grids and quick-attach modals.

## User Stories
- As an architect, I want to specify which Service, Class, or Method an Application Point targets so that I can precisely define where business logic is implemented
- As an architect, I want to attach Business Logic to Application Points via a relationship table so that I can trace which business rules are implemented at each technical integration point

## Specific Requirements

**Extend ApplicationPoint with target_type and target_ref_id fields**
- Add `target_type` field: enumeration of "SERVICE" | "CLASS" | "METHOD" (required)
- Add `target_ref_id` field: UUID referencing the selected entity (required)
- Backend entity `ApplicationPointEntity` adds two columns: `target_type VARCHAR(16)` and `target_ref_id VARCHAR(255)`
- Backend DTO `ApplicationPointDto` adds corresponding fields with JSON property names `target_type` and `target_ref_id`
- Frontend type `ApplicationPoint` in `model.ts` adds `target_type` and `target_ref_id` optional fields
- EntityMapper extends mapping logic to include these new fields in both directions

**Liquibase migration for existing data**
- Create migration `016-application-point-targeting.sql` to add `target_type` and `target_ref_id` columns to `application_points` table
- Set existing rows to `target_type = 'SERVICE'` and copy `service_id` value to `target_ref_id` for backward compatibility
- Add index on `target_ref_id` for query performance
- Add check constraint ensuring `target_type` is one of 'SERVICE', 'CLASS', 'METHOD'

**Backend validation on save**
- ModelService validates that `target_ref_id` references an existing entity of the correct type within the same model
- For target_type='SERVICE': validate against services table
- For target_type='CLASS': validate against classes table
- For target_type='METHOD': validate against methods table
- Return HTTP 400 with descriptive error message if validation fails

**Update Application Point grid configuration**
- Add "Target Type" dropdown column using existing dropdown cellType pattern with options ["SERVICE", "CLASS", "METHOD"]
- Add "Target Reference" fk_typeahead column that dynamically filters based on selected target_type
- Use conditional fkTarget based on target_type value: services, classes, or methods
- Position new columns after existing service_id column in grid

**Relationship table "App Point <-> Business Logic" already exists**
- Grid configuration `application_point_business_logics` already defined in `gridConfigs.ts` at line 438
- Relationship tab "App Point <-> Business Logic" already in `relationshipTabNames` at line 577
- The `application_point_business_logics` join table with unique constraint already exists per 015-business-logic.sql

**Prevent duplicate links in relationship table**
- Unique composite index on `(application_point_id, business_logic_id)` already defined in 015-business-logic.sql
- Frontend validates before creating to show user-friendly error if duplicate attempted
- Backend returns 409 Conflict if unique constraint violated on save

**Quick attach modal from Application Point view**
- Add "Attach Business Logic" button to Application Point inspector panel or context menu
- Modal displays list of available Business Logic entities with search/filter
- Already-attached Business Logic items are marked and cannot be re-selected
- On selection, creates new ApplicationPointBusinessLogic join record
- Modal styled using existing LogicalErCreateModal CSS module pattern

**Quick attach modal from Business Logic view**
- Add "Attach to Application Point" button to Business Logic inspector panel or context menu
- Modal displays list of available Application Points with search/filter, formatted using applicationPointDisplayFormatter
- Already-attached Application Points are marked and cannot be re-selected
- On selection, creates new ApplicationPointBusinessLogic join record

**Detach action in relationship grid and modals**
- Relationship grid "App Point <-> Business Logic" supports row deletion via existing grid delete functionality
- Quick attach modals show attached items with detach/remove button
- Detach removes the join table row, does not delete either entity

## Visual Design
No visual mockups provided for this specification.

## Existing Code to Leverage

**ApplicationPointEntity and ApplicationPointDto**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationPointEntity.java`
- Already has `kind`, `applicationId`, `applicationComponentId`, `serviceId`, `interfaceId` fields
- Add `targetType` and `targetRefId` following same pattern as existing fields

**ApplicationPointBusinessLogicEntity and join table**
- Join table entity at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ApplicationPointBusinessLogicEntity.java`
- DTO at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/relationship/ApplicationPointBusinessLogicDto.java`
- Repository and ModelService integration already implemented for save/load

**Grid configuration patterns in gridConfigs.ts**
- `application_points` grid config at line 157 shows existing column definitions
- `fk_typeahead` cellType pattern used for foreign key lookups (e.g., `fkTarget: 'services'`)
- `displayFormatter` pattern used for showing formatted names (see `applicationPointDisplayFormatter`)
- `application_point_business_logics` grid already defined at line 438

**LogicalErCreateModal for modal pattern**
- Located at `frontend/src/components/DiagramsView/ER/LogicalErCreateModal.tsx`
- Demonstrates form-based modal with dropdowns, entity selection, validation, and submission
- CSS module at `LogicalErCreateModal.module.css` provides consistent styling
- Pattern can be replicated for AttachBusinessLogicModal

**Liquibase migration structure**
- `db.changelog-master.yaml` shows pattern for adding new changesets
- Existing migrations like `009-logical-er-polymorphic-endpoints.sql` demonstrate adding columns
- `015-business-logic.sql` shows join table with unique constraint pattern

## Out of Scope
- Templates or type suggestions for Business Logic content
- DSL or rule editors for Business Logic definition
- Auto-creating Application Points from Services/Classes/Methods
- Drag-and-drop linking from diagram canvas
- Bulk attach/detach operations
- Import/export of Application Point to Business Logic mappings
- Versioning or history of attach/detach actions
- Notifications or approval workflows for linking changes
- Cross-model or cross-file linking of Business Logic
- Validation rules beyond existence checking (e.g., lifecycle status checks)
