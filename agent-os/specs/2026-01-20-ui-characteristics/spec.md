# Specification: UI Characteristics

## Goal
Add a new "UI Characteristics" entity to the Architecture & Design UI domain that captures business features and UI/UX/technical characteristics associated with frontend UIs, linked to Application Points, with full persistence through DB and file import/export flows.

## User Stories
- As an architect, I want to capture key business features and technical characteristics of UI elements so that I can document what each UI component does and how it behaves
- As a team lead, I want autocomplete suggestions for characteristic keys so that entries remain consistent across the architecture model

## Specific Requirements

**UICharacteristic Entity Data Model**
- id: string (required, primary key, auto-generated)
- uiId: string (required, FK to ApplicationPoint.id - links to Application, App Component, or Service)
- type: string (required, enum: business_feature, ui_capability, interaction_complexity, technical_shape)
- key: string (optional, free text with type-dependent autocomplete)
- name: string (required)
- description: string (optional)
- evidence: string (optional, simple text field - not appendable)

**Type Dropdown Behavior**
- Type column uses a standard dropdown (no custom values allowed)
- Enum values stored as snake_case in backend/database
- Display values formatted with spaces and Title Case: "Business Feature", "UI Capability", "Interaction Complexity", "Technical Shape"
- When Type is changed, the Key field value is cleared to prevent mismatched suggestions

**Key Field Autocomplete Behavior**
- For type=business_feature: no autocomplete suggestions shown
- For type=ui_capability: suggestions from config property uiCharacteristicsUiCapabilityKeys
- For type=interaction_complexity: suggestions from config property uiCharacteristicsInteractionComplexityKeys
- For type=technical_shape: suggestions from config property uiCharacteristicsTechnicalShapeKeys
- Autocomplete dropdown only appears after user starts typing (not on focus)
- Free text always allowed - no hard validation on key values

**UI Field (Application Point Selector)**
- Uses existing Application Point picker pattern (application_point_picker cellType)
- Grouped dropdown with non-selectable section headers (Application, App Component, Service)
- Live filtering based on typed text
- Selection allowed from any Application Point subtype

**Tab Positioning and Grid UI**
- Add "UI Characteristics" as the 5th tab under UI domain (after "UI Actions")
- Grid-based editor following existing UI entity patterns
- Columns: ID*, UI*, Type*, Key, Name*, Description, Evidence (* = required)
- Add/edit/remove row functionality matching existing UI entity grids
- Same styling as UI Screens, UI Workflow Transitions, UI Components, UI Actions

**Backend DTO (UICharacteristicDto)**
- Create as Java record in model/dto/entity/ package
- Fields with @JsonProperty annotations using snake_case: id, ui_id, type, key, name, description, evidence
- Follow existing UIActionDto pattern

**Backend Entity (UICharacteristicEntity)**
- Create JPA entity in model/entity/ package
- Table name: ui_characteristics
- Columns: id (PK), model_file_id (indexed), ui_id (indexed), type, key, name, description, evidence
- Use Lombok annotations: @Entity, @Table, @Getter, @Setter, @NoArgsConstructor, @AllArgsConstructor, @Builder
- Follow existing UIActionEntity pattern

**Backend Repository (UICharacteristicRepository)**
- Create in repository/entity/ package
- Extends JpaRepository<UICharacteristicEntity, String>
- Methods: findByModelFileId(String), deleteByModelFileId(String), findByUiId(String)
- Follow existing UIActionRepository pattern

**Liquibase Migration**
- Add new changeset 033-ui-characteristics to db.changelog-master.yaml
- Create ui_characteristics table with columns: id (TEXT PK), model_file_id (TEXT NOT NULL FK), ui_id (TEXT NOT NULL), type (TEXT NOT NULL), key (TEXT), name (TEXT NOT NULL), description (TEXT), evidence (TEXT)
- Create indexes: idx_ui_characteristics_model_file, idx_ui_characteristics_ui_id
- Follow existing UI entity table patterns from 010-ui-screens-ui-workflow-transitions.sql and 011-ui-components-actions-contracts.sql

**MetaModelEntitiesDto Extension**
- Add ui_characteristics: List<UICharacteristicDto> field
- Position after ui_actions in the record definition
- Use @JsonProperty("ui_characteristics") annotation

**Bootstrap Configuration Extension**
- Add properties to AppFeaturesProperties class: uiCharacteristicsUiCapabilityKeys, uiCharacteristicsInteractionComplexityKeys, uiCharacteristicsTechnicalShapeKeys
- Properties are pipe-delimited strings (backend splits defensively on | or ,)
- Add corresponding fields to BootstrapResponse record
- Add fields to application.yml with default empty values
- Expose via GET /api/bootstrap endpoint

**Frontend Type Definition (UICharacteristic)**
- Add interface to frontend/src/types/model.ts
- Fields: id, uiId, type, key, name, description, evidence
- Add UICharacteristicType enum: 'business_feature' | 'ui_capability' | 'interaction_complexity' | 'technical_shape'
- Add to MetaModelEntities interface as ui_characteristics: UICharacteristic[]
- Add to EntityType union as 'ui_characteristics'
- Add to AnyEntity union
- Add to ENTITY_TYPES constant

**Frontend Grid Configuration**
- Add ui_characteristics config to gridConfigs object in frontend/src/config/gridConfigs.ts
- Column definitions: id (text, required, autoGenerate), uiId (application_point_picker, required), type (dropdown, required, with formatted options), key (text_with_suggestions, optional), name (text, required), description (text, optional), evidence (text, optional)
- Add "UI Characteristics" to tabToEntityType mapping
- Add "UI Characteristics" to domainGroupings.ui array (5th position, after "UI Actions")
- Add "UI Characteristics" to entityTabNames array
- Add 'ui_characteristics' to DOMAIN_ENTITY_TYPES.ui array

**Frontend AppConfigContext Extension**
- Extend AppConfig interface with: uiCharacteristicsUiCapabilityKeys, uiCharacteristicsInteractionComplexityKeys, uiCharacteristicsTechnicalShapeKeys (as string arrays)
- Parse pipe-delimited strings from bootstrap response into arrays
- Provide to Grid component for key field autocomplete suggestions

**Model Save/Load/Import/Export Integration**
- Extend ModelService.saveModel() to persist ui_characteristics via repository
- Extend ModelService.loadModel() to load ui_characteristics from repository
- Extend ProjectSnapshotService to include ui_characteristics in snapshot export/import
- Extend file export JSON structure to include ui_characteristics array
- Backward compatibility: models without ui_characteristics default to empty array

## Visual Design
No visual mockups provided - implementation follows existing UI entity grid patterns exactly.

## Existing Code to Leverage

**UIActionDto / UIActionEntity / UIActionRepository**
- C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\model\dto\entity\UIActionDto.java
- C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\model\entity\UIActionEntity.java
- C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\repository\entity\UIActionRepository.java
- Patterns for DTO record structure, JPA entity annotations, repository interface methods

**MetaModelEntitiesDto**
- C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\model\dto\MetaModelEntitiesDto.java
- Pattern for adding new entity list with @JsonProperty annotation

**AppFeaturesProperties and BootstrapController**
- C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\config\AppFeaturesProperties.java
- C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\java\com\example\architecturemodel\controller\BootstrapController.java
- Pattern for adding configuration properties and exposing via bootstrap endpoint

**Frontend gridConfigs.ts and model.ts**
- C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\config\gridConfigs.ts
- C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\model.ts
- Patterns for grid column configuration, entity type definitions, domain groupings

**Liquibase migration SQL files**
- C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\resources\db\changelog\sql\011-ui-components-actions-contracts.sql
- Pattern for CREATE TABLE, indexes, and FK constraints

## Out of Scope
- Hard validation that rejects unknown key values (free text always allowed)
- Target-state or sizing logic for UI characteristics
- Automatic derivation logic (this is pure manual capture only)
- Appendable/dated evidence entries (evidence is simple text field)
- Custom type values beyond the fixed enum (business_feature, ui_capability, interaction_complexity, technical_shape)
- UI Characteristics nodes on diagrams (this entity is grid/meta-model only)
- UIContract entity involvement (UICharacteristic links directly to ApplicationPoint, not UIContract)
- Cascade delete from Application Point (orphan characteristics are allowed)
- Excel import/export sheet for UI Characteristics (can be added in future iteration)
