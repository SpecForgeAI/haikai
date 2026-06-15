# Specification: Add Service.Core Tech Column and Change Service Type to Free-Text

## Goal
Enhance the Service entity by adding a new "Core Tech" field for documenting languages/tools/frameworks, and change "Service Type" from a fixed dropdown to free-text to allow descriptive functional nature (e.g., "CRUD service over DB X", "ETL pipeline").

## User Stories
- As an architect, I want to record the core technologies (languages, frameworks, tools) used by each service so that I can document the technology stack across my architecture.
- As an architect, I want to describe service types in my own words rather than being limited to REST/SOAP/gRPC/GraphQL/Message so that I can accurately describe the functional nature of each service.

## Specific Requirements

**Backend: Add core_tech column to services table**
- Add Liquibase migration `014-service-core-tech.sql` with ALTER TABLE statement
- Column name: `core_tech`, type: TEXT, nullable: true
- Register the migration in `db.changelog-master.yaml` as changeSet `014-service-core-tech`
- Precondition: column `core_tech` does not exist on `services` table

**Backend: Update ServiceEntity JPA model**
- Add field `private String coreTech;` to `ServiceEntity.java`
- Map with `@Column(name = "core_tech")` annotation
- Confirm existing `serviceType` field remains as String with no enum validation

**Backend: Update ServiceDto record**
- Add `coreTech` field to the `ServiceDto` record in `ServiceDto.java`
- Use `@JsonProperty("core_tech")` for snake_case JSON serialization
- Ensure no enum validation annotations exist on `serviceType` field

**Backend: Update EntityMapper**
- Modify `toDto(ServiceEntity)` method to include `entity.getCoreTech()` in constructor
- Modify `toEntity(ServiceDto, String)` method to include `.coreTech(dto.coreTech())` in builder
- Maintain existing mapping for all other Service fields

**Backend: Remove any Service Type enum validation**
- Ensure no server-side validation restricts `serviceType` to specific values
- Backend must accept any arbitrary string for `serviceType` without constraint errors
- Existing values (REST, SOAP, gRPC, GraphQL, Message) remain unchanged in database

**Frontend: Update Service interface in model.ts**
- Add optional field `core_tech?: string;` to the `Service` interface
- Confirm `service_type: string` remains unchanged (already a string type)

**Frontend: Update gridConfigs services configuration**
- Add new column entry after `service_type` column for "Core Tech"
- Column config: `{ field: 'core_tech', displayName: 'Core Tech', cellType: 'text', required: false, width: 120 }`
- Change `service_type` column from `cellType: 'dropdown'` to `cellType: 'text'`
- Remove `options: serviceTypeOptions` from the `service_type` column config

**Frontend: Remove serviceTypeOptions dropdown usage**
- Remove `serviceTypeOptions` from the import list in `gridConfigs.ts`
- The `serviceTypeOptions` constant in `defaults.ts` can remain for backward compatibility but is no longer used by the grid

## Visual Design
No visual mockups provided. The changes follow existing grid column conventions:
- "Core Tech" column renders as standard editable text input (same as Description column)
- "Service Type" column renders as editable text input (no longer dropdown)
- Column order: ... | App Component | Service Type | Core Tech | Tags | ...

## Existing Code to Leverage

**ServiceEntity.java (JPA Entity)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/ServiceEntity.java`
- Uses Lombok `@Getter`, `@Setter`, `@Builder` annotations
- Add new field following same pattern as existing fields (e.g., `description`, `tags`)

**ServiceDto.java (API DTO)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/ServiceDto.java`
- Java record with `@JsonProperty` annotations for snake_case JSON mapping
- Add new parameter following same pattern as existing fields

**EntityMapper.java (DTO-Entity Mapping)**
- Located at `architecture-model-service/src/main/java/com/example/architecturemodel/mapper/EntityMapper.java`
- Contains `toDto(ServiceEntity)` at line 177 and `toEntity(ServiceDto, String)` at line 191
- Update both methods to include the new `coreTech` field

**gridConfigs.ts (Frontend Grid Configuration)**
- Located at `frontend/src/config/gridConfigs.ts`
- Services config at lines 98-108; uses `cellType: 'dropdown'` for service_type
- Change to `cellType: 'text'` and add new core_tech column after service_type

**defaults.ts (Frontend Options)**
- Located at `frontend/src/config/defaults.ts`
- Contains `serviceTypeOptions` at line 942; this will no longer be used by the grid

## Out of Scope
- Do not create a new Core Tech dropdown/enum - it must be free-text
- Do not rename existing database columns (only add core_tech)
- Do not modify ServiceRepository or ModelService logic beyond DTO/entity changes
- Do not add UI validation or autocomplete for Core Tech or Service Type fields
- Do not create new API endpoints - only extend existing Service CRUD payloads
- Do not redesign the MetaModelView UI layout or Service table styling
- Do not add new entities or relationships to the meta-model
- Do not migrate existing service_type values - they remain as-is and editable
- Do not add tests beyond basic CRUD verification for the new field
- Do not modify frontend type definitions beyond the Service interface
