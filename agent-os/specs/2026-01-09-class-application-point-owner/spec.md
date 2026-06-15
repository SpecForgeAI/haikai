# Specification: Class entity single Application Point owner picker

## Goal
Replace the Class entity's two-column ownership model (`owned_by_ref_kind` + `owned_by_ref_id`) with a single `application_point_id` foreign key, using the same searchable Application Point picker UI as other relationship grids.

## User Stories
- As a user, I want to assign a Class to an Application Point via a single dropdown so that I have a consistent editing experience across the application.
- As a user, I want the Classes grid to show which Application Point owns each Class so that I can understand the ownership hierarchy at a glance.

## Specific Requirements

**1) Update ClassEntity.java**
- Remove `ownedByRefKind` and `ownedByRefId` fields with their `@Column` annotations
- Add `applicationPointId` field with `@Column(name = "application_point_id")`
- Keep existing Lombok annotations (`@Builder`, `@Getter`, `@Setter`, etc.)
- Field order: id, modelFileId, name, description, namespace, applicationPointId

**2) Update ClassDto.java**
- Remove `ownedByRefKind` and `ownedByRefId` record parameters with `@JsonProperty("owned_by_ref_kind")` and `@JsonProperty("owned_by_ref_id")`
- Add `@JsonProperty("application_point_id") String applicationPointId` parameter
- Record parameter order: id, name, description, namespace, applicationPointId

**3) Update EntityMapper.java toDto(ClassEntity) and toEntity(ClassDto)**
- In `toDto(ClassEntity)`: replace `entity.getOwnedByRefKind()`, `entity.getOwnedByRefId()` with `entity.getApplicationPointId()`
- In `toEntity(ClassDto, String)`: replace `.ownedByRefKind(dto.ownedByRefKind())`, `.ownedByRefId(dto.ownedByRefId())` with `.applicationPointId(dto.applicationPointId())`

**4) Database Migration (025-class-application-point-id.sql)**
- Add new column: `ALTER TABLE classes ADD COLUMN application_point_id TEXT REFERENCES application_points(id);`
- Keep column nullable initially to avoid breaking existing data
- Drop legacy columns: `ALTER TABLE classes DROP COLUMN owned_by_ref_kind;` and `ALTER TABLE classes DROP COLUMN owned_by_ref_id;`
- Register migration in db.changelog-master.yaml after 024b

**5) Update Frontend types/model.ts Class interface**
- Remove `owned_by_ref_kind?: OwnedByRefKind` and `owned_by_ref_id?: string` properties
- Add `application_point_id?: string` property
- Remove `OwnedByRefKind` type export entirely (no longer needed)

**6) Update Frontend config/defaults.ts**
- Remove `ownedByRefKindOptions` array constant
- Remove import of `OwnedByRefKind` from types/model
- Clean up any other references to the removed type

**7) Update Frontend config/gridConfigs.ts classes configuration**
- Remove two columns: `owned_by_ref_kind` (dropdown) and `owned_by_ref_id` (text)
- Add single column: `{ field: 'application_point_id', displayName: 'Application Point', cellType: 'application_point_picker', required: false, width: 260 }`
- Remove `ownedByRefKindOptions` from imports

**8) Update applicationPointDerivation.ts deriveApplicationIdForClass function**
- Remove switch statement on `classEntity.owned_by_ref_kind`
- Look up Application Point by `classEntity.application_point_id` from `entities.application_points`
- Return `applicationPoint?.application_id || ''`
- Keep function signature and return type unchanged for API compatibility

**9) Update Backend Tests**
- ModelControllerTest.java: update Class JSON fixtures to use `application_point_id` instead of `owned_by_ref_kind`/`owned_by_ref_id`
- ModelServiceSaveTest.java: update Class entity creation to use `applicationPointId`
- TypedContentCreateSaveFlowTest.java: update any Class-related test data

**10) Update Frontend Tests**
- application-point-picker.test.ts: ensure Class entities use `application_point_id`
- Any tests referencing `owned_by_ref_kind` or `owned_by_ref_id` on Class entities must be updated

## Existing Code to Leverage

**ApplicationPointPickerCell.tsx**
- Complete searchable dropdown component for selecting Application Points
- Groups options by type: Application Points, Services, Classes, Methods
- Handles derived Application Point creation via `ensureDerivedApplicationPoint`
- Already used in relationship grids (application_point_business_points, data_movements, etc.)

**gridConfigs.ts application_point_picker cell type pattern**
- Example from `application_point_business_points`: `{ field: 'application_point_id', displayName: 'Application Point', cellType: 'application_point_picker', required: true, width: 220, fkTarget: 'application_points', displayFormatter: applicationPointDisplayFormatter }`
- Use same pattern but with `required: false` for Class ownership

**EntityMapper.java toDto/toEntity pattern**
- Follow existing single-field FK patterns from ServiceEntity (`applicationId`, `packageSetId`)
- Existing mapper methods demonstrate correct field order and builder patterns

**Database migration pattern (017-package-sets.sql through 024b)**
- Recent migrations show FK column addition with REFERENCES clause
- Include column drop statements in same migration when removing old columns

**applicationPointDerivation.ts**
- Contains `deriveApplicationIdForClass` function that must be updated
- Shows how to traverse from Class to Application via ownership chain
- New implementation will be simpler: direct FK lookup

## Out of Scope
- Changes to other entity types (Service, Method, Interface, etc.)
- Changes to relationship grids or their configurations
- Backend validation enforcement (NOT NULL constraint on application_point_id)
- Data migration of existing `owned_by_ref_kind`/`owned_by_ref_id` values to `application_point_id`
- Auto-creation of Application Points for existing Class data
- Changes to ApplicationPointPickerCell component itself
- Changes to the diagram rendering for Class nodes
- Changes to the Application Point entity or its derivation logic beyond deriveApplicationIdForClass
- Rollback migration script
