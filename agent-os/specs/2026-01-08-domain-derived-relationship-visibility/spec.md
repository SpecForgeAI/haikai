# Specification: Domain-Derived Relationship Visibility

## Goal
Fix incorrect and missing relationship tabs in both Meta-Model Relationships row and Diagrams RHS palette by deriving relationship visibility from explicit endpoint entity metadata rather than fragile column/picker inference.

## User Stories
- As an architect, I want to see all relevant relationships when viewing the Application domain so that I can model cross-domain interactions without switching contexts.
- As a data modeler, I want Data Movements and Interface-Logical Entity relationships visible in the Data domain so that I can trace data flows from a single view.

## Specific Requirements

**1. Central Relationship Definition Object**
- Create `frontend/src/config/relationshipDefinitions.ts` as single source of truth
- Each relationship declares: relationshipKey, displayName, endpointEntityTypes[]
- endpointEntityTypes uses canonical entity type keys (e.g., business_users, application_points, interfaces, data_entity_points, business_logics)
- Remove display name "Logical ER" and replace with "Logical / Physical ER"

**2. Central Entity-Type to Domain Mapping**
- Create a single authoritative mapping: entityTypeKey -> ArchitectureDomain
- Key mappings that MUST be correct: interfaces -> APPLICATION, data_entity_points -> DATA, business_logics -> BEHAVIOURAL
- Replace scattered DOMAIN_ENTITY_TYPES inference with this canonical mapping
- Include app_business_points (virtual entity appearing in interactions) mapped to BUSINESS

**3. Relationship Derivation Logic**
- A relationship MUST appear in domain D if ANY endpointEntityType of that relationship maps to domain D
- Create a function: getRelationshipsForDomain(domain: ArchitectureDomain) -> relationshipKey[]
- Derivation MUST NOT inspect grid column configurations or cellType values
- Derivation MUST NOT rely on fkTarget presence or picker type (application_point_picker, data_entity_point_picker)

**4. Required Relationship Visibility per Domain (LOCKED)**
- BUSINESS: User-BusinessPoint, AppPoint-BusinessPoint, Interactions
- APPLICATION: AppPoint-BusinessPoint, Interactions, Interface-LogicalEntity, DataMovements, AppPoint-BusinessLogic
- DATA: Logical/Physical ER, Logical-Physical Entities, Logical-Physical Attributes, Interface-LogicalEntity, DataMovements
- BEHAVIOURAL: Interactions, AppPoint-BusinessLogic
- UI: (no relationships from this canonical set)

**5. Update MetaModelView Relationship Tab Derivation**
- Remove current getRelationshipTabsForDomain() logic that inspects gridConfigs columns
- Replace with call to new centralized derivation function using relationshipDefinitions
- Maintain existing separator rendering between tabs

**6. Update Diagrams Palette Relationship Derivation**
- Remove static domainToPaletteSections mapping in paletteData.ts for relationship sections
- Replace with dynamic derivation using same relationshipDefinitions and derivation logic
- Ensure both MetaModelView and PalettePanel use identical derivation

**7. Data Entity Point Support**
- data_entity_points entity type MUST be mapped to DATA domain
- Logical/Physical ER relationship includes data_entity_points in endpointEntityTypes
- Data Movements includes data_entity_points in endpointEntityTypes

**8. Interactions Relationship Endpoints**
- Interactions connects: business_users (BUSINESS), app_business_points (BUSINESS), application_points (APPLICATION)
- Must appear in BUSINESS (via business_users, app_business_points) and BEHAVIOURAL (cross-domain)
- Must also appear in APPLICATION (via application_points through app_business_points)

## Visual Design
(No visual mockups provided)

## Existing Code to Leverage

**frontend/src/config/gridConfigs.ts - DOMAIN_ENTITY_TYPES**
- Contains current domain-to-entity-types mapping at line 592-598
- Should be refactored into new centralized mapping
- relationshipTabToType (lines 522-532) provides canonical relationship keys
- relationshipTabNames (lines 602-612) provides tab display order

**frontend/src/components/MetaModelView/MetaModelView.tsx - getRelationshipTabsForDomain**
- Current implementation at lines 55-84 uses fkTarget column inspection
- This logic must be replaced with new derivation approach
- Maintain the filtered tab rendering pattern at lines 161-168

**frontend/src/utils/paletteData.ts - domainToPaletteSections**
- Static mapping at lines 38-84 must be replaced for relationship sections
- getPaletteSections function (lines 242-552) applies domain filtering
- Keep entity section logic; replace relationship section domain filtering

**frontend/src/types/architectureDomain.ts**
- Defines ArchitectureDomain type and ALL_DOMAINS array
- Import and use this type in new relationship definitions

**frontend/src/types/model.ts - ENTITY_TYPES**
- Canonical entity type constants at lines 1181-1213
- Use these constants for type safety in new mappings

## Out of Scope
- Backend API changes or new endpoints
- Database schema modifications
- Business domain relationship visibility changes (already correct)
- UI domain relationship visibility changes (already correct)
- Adding new relationship types beyond the 9 canonical relationships
- Modifying relationship entity structures or persistence layer
- Changes to how relationships are rendered in grids or diagrams
- Changes to picker components (application_point_picker, data_entity_point_picker)
- Changes to grid column configurations beyond removing reliance on them for derivation
