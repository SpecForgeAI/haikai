# UI Characteristics (Architecture Domain → UI)

**Feature Name:** UI Characteristics (Architecture Domain → UI)

**Description:**
Add a new UI entity called "UI Characteristics" to the Architecture & Design → UI domain. This entity captures key business features and UI/UX/technical characteristics associated with frontend UIs, linked to an Application Point, and persists as part of the architecture model (DB + file import/export).

## ENTITY NAME
UI Characteristics
(use this exact naming/casing consistently in UI, backend DTOs, JSON payloads, and DB table naming conventions)

## DATA MODEL

Entity: UICharacteristic

Fields:
- id: string (required, primary key)
- uiId: string (required, references ApplicationPoint.id)
- type: string (required)
- key: string (optional, free text)
- name: string (required)
- description: string (optional)
- evidence: string (optional, free text, appendable)

Type enum values:
- business_feature
- ui_capability
- interaction_complexity
- technical_shape

Key behavior rules:
- key is always stored as free text
- for type=business_feature:
  - no autocomplete suggestions are shown
- for type in {ui_capability, interaction_complexity, technical_shape}:
  - autocomplete suggests values from configured lists
  - user may still type and save arbitrary values (no hard validation)

## APPLICATION POINT LINKING

- uiId links to ApplicationPoint.id
- ApplicationPoint includes subtypes:
  - Application
  - Application Component
  - Application Service
- UI control for uiId uses the existing Application Point autocomplete pattern:
  - grouped by subtype with non-selectable section headers
  - live filtering based on typed text
  - selection from any subtype allowed

## BACKEND (architecture-model-service)

1) DTO
Create UICharacteristicDto with fields:
- id
- ui_id
- type
- key
- name
- description
- evidence

2) MetaModel aggregation
Extend MetaModelEntitiesDto to include:
- ui_characteristics: List<UICharacteristicDto>

3) Persistence
- Create UICharacteristicEntity
- Table name: ui_characteristics
- Columns:
  - id (PK)
  - model_file_id (indexed)
  - ui_id (indexed)
  - type
  - key
  - name
  - description
  - evidence

4) Repository
- UICharacteristicRepository extends JpaRepository<UICharacteristicEntity, String>
- Query by model_file_id consistent with other UI entities

5) Mapping
- Add entity ↔ DTO mappings
- Include ui_characteristics in model save/load, import/export, and project snapshot flows

6) Liquibase
- Add changelog to create ui_characteristics table
- Follow existing UI entity table patterns

## CONFIGURATION (Bootstrap/App Config)

Add config properties for key suggestion enums (delimited strings):
- uiCharacteristicsUiCapabilityKeys
- uiCharacteristicsInteractionComplexityKeys
- uiCharacteristicsTechnicalShapeKeys

Delimiter: pipe (|) or comma (,), backend should split defensively.

Expose these fields via /api/bootstrap response.

## FRONTEND (frontend-src)

1) Types
Add UICharacteristic type aligned with DTO fields.

2) Model state
- Add uiCharacteristics array to architecture model state
- Default to empty array if missing (backward compatibility)

3) UI Integration
- Add "UI Characteristics" as the 5th entity tab under Architecture & Design → UI
- Render using the existing grid/table editor pattern

Columns:
- ID* (string)
- UI* (Application Point selector)
- Type* (dropdown)
- Key (autocomplete + free text)
- Name* (string)
- Description (string)
- Evidence (string)

4) Type → Key interaction
- Changing Type updates the autocomplete suggestion list
- business_feature shows no suggestions
- Other types show suggestions from config
- Free text always allowed

5) AppConfigContext
- Parse bootstrap-delivered key lists into arrays
- Provide to UI Characteristics grid for autocomplete suggestions

## ROUND-TRIP REQUIREMENTS

- ui_characteristics included in:
  - DB persistence
  - file export JSON
  - file import / open flows
- Opening older models without ui_characteristics must work (empty list)

## ACCEPTANCE CRITERIA

- UI Characteristics tab is visible under UI entities
- Rows can be added, edited, and deleted
- Type dropdown behaves as specified
- Key autocomplete behaves as specified with override allowed
- Application Point selector behaves consistently with existing grouped autocomplete
- Data round-trips correctly through save/load/export/import

## NON-GOALS / GUARDRAILS

- No hard validation on key values
- No target-state or sizing logic included
- No automatic derivation logic in this feature (pure capture only)
