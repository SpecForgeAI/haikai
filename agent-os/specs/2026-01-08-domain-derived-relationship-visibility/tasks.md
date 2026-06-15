# Task Breakdown: Domain-Derived Relationship Visibility

## Overview
Total Tasks: 21

This specification fixes incorrect and missing relationship tabs in both the Meta-Model Relationships row and Diagrams RHS palette by deriving relationship visibility from explicit endpoint entity metadata rather than fragile column/picker inference.

## Task List

### Configuration Layer

#### Task Group 1: Central Relationship Definitions and Entity-Domain Mapping
**Dependencies:** None

- [x] 1.0 Complete central relationship and domain configuration
  - [x] 1.1 Write 4-6 focused tests for relationship definitions and derivation logic
    - Test that each relationship has correct relationshipKey, displayName, and endpointEntityTypes
    - Test that getRelationshipsForDomain returns correct relationships for APPLICATION domain (must include Interface-LogicalEntity, DataMovements, AppPoint-BusinessLogic)
    - Test that getRelationshipsForDomain returns correct relationships for DATA domain (must include Logical/Physical ER, Interface-LogicalEntity, DataMovements)
    - Test that getRelationshipsForDomain returns correct relationships for BEHAVIOURAL domain (must include Interactions, AppPoint-BusinessLogic)
    - Test that entityTypeToDomain mapping is correct for key entity types (interfaces -> APPLICATION, data_entity_points -> DATA, business_logics -> BEHAVIOURAL)
    - Test that app_business_points maps to BUSINESS domain
  - [x] 1.2 Create `frontend/src/config/relationshipDefinitions.ts` as single source of truth
    - Define RelationshipDefinition interface with: relationshipKey, displayName, endpointEntityTypes[]
    - Create RELATIONSHIP_DEFINITIONS array containing all 9 canonical relationships:
      - User-BusinessPoint: endpointEntityTypes = ['business_users', 'business_points']
      - AppPoint-BusinessPoint: endpointEntityTypes = ['application_points', 'business_points']
      - Interactions: endpointEntityTypes = ['business_users', 'app_business_points', 'application_points']
      - Logical/Physical ER: endpointEntityTypes = ['logical_data_entities', 'physical_data_entities', 'data_entity_points'] (rename from "Logical ER")
      - Logical-Physical Entities: endpointEntityTypes = ['logical_data_entities', 'physical_data_entities']
      - Logical-Physical Attributes: endpointEntityTypes = ['logical_data_attributes', 'physical_data_attributes']
      - Interface-LogicalEntity: endpointEntityTypes = ['interfaces', 'logical_data_entities']
      - DataMovements: endpointEntityTypes = ['application_points', 'data_entity_points']
      - AppPoint-BusinessLogic: endpointEntityTypes = ['application_points', 'business_logics']
    - Export relationshipKeyToDisplayName map for UI display
  - [x] 1.3 Create ENTITY_TYPE_TO_DOMAIN authoritative mapping in relationshipDefinitions.ts
    - Map all entity types to their canonical domains
    - Key mappings that MUST be correct:
      - business_users -> BUSINESS
      - business_points -> BUSINESS
      - app_business_points -> BUSINESS
      - application_points -> APPLICATION
      - interfaces -> APPLICATION
      - logical_data_entities -> DATA
      - physical_data_entities -> DATA
      - data_entity_points -> DATA
      - business_logics -> BEHAVIOURAL
    - Import ArchitectureDomain type from '../types/architectureDomain'
    - Import ENTITY_TYPES constants from '../types/model' for type safety
  - [x] 1.4 Implement getRelationshipsForDomain derivation function
    - Function signature: getRelationshipsForDomain(domain: ArchitectureDomain): string[]
    - Returns array of relationshipKeys where ANY endpointEntityType maps to the given domain
    - MUST NOT inspect grid column configurations
    - MUST NOT rely on fkTarget presence or cellType values
    - Use ENTITY_TYPE_TO_DOMAIN for lookups
  - [x] 1.5 Ensure configuration layer tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify all relationship definitions are correct
    - Verify domain derivation produces LOCKED visibility requirements

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- relationshipDefinitions.ts exports RELATIONSHIP_DEFINITIONS array
- ENTITY_TYPE_TO_DOMAIN mapping covers all relevant entity types
- getRelationshipsForDomain function correctly derives visibility per spec requirements
- Display name "Logical ER" replaced with "Logical / Physical ER"

### MetaModelView Integration

#### Task Group 2: Update MetaModelView Relationship Tab Derivation
**Dependencies:** Task Group 1

- [x] 2.0 Complete MetaModelView relationship tab updates
  - [x] 2.1 Write 3-4 focused tests for MetaModelView relationship tab filtering
    - Test that APPLICATION domain shows: AppPoint-BusinessPoint, Interactions, Interface-LogicalEntity, DataMovements, AppPoint-BusinessLogic
    - Test that DATA domain shows: Logical/Physical ER, Logical-Physical Entities, Logical-Physical Attributes, Interface-LogicalEntity, DataMovements
    - Test that BEHAVIOURAL domain shows: Interactions, AppPoint-BusinessLogic
    - Test that UI domain shows no relationship tabs (empty array)
  - [x] 2.2 Remove current getRelationshipTabsForDomain implementation from MetaModelView.tsx
    - Remove fkTarget column inspection logic at lines 55-84
    - Remove dependency on gridConfigs for relationship derivation
  - [x] 2.3 Import and integrate new centralized derivation function
    - Import getRelationshipsForDomain from '../config/relationshipDefinitions'
    - Replace getRelationshipTabsForDomain call with new centralized function
    - Map relationship keys to display names using relationshipKeyToDisplayName
  - [x] 2.4 Maintain existing separator rendering between tabs
    - Keep renderTabsWithSeparators function intact
    - Ensure filtered tabs are passed to renderTabsWithSeparators
  - [x] 2.5 Ensure MetaModelView tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify relationship tabs appear correctly for each domain
    - Verify separator rendering is preserved

**Acceptance Criteria:**
- The 3-4 tests written in 2.1 pass
- MetaModelView no longer uses column/fkTarget inspection for relationship derivation
- Relationship tabs correctly filtered per domain using new centralized logic
- BUSINESS domain shows: User-BusinessPoint, AppPoint-BusinessPoint, Interactions
- APPLICATION domain shows: AppPoint-BusinessPoint, Interactions, Interface-LogicalEntity, DataMovements, AppPoint-BusinessLogic
- DATA domain shows: Logical/Physical ER, Logical-Physical Entities, Logical-Physical Attributes, Interface-LogicalEntity, DataMovements
- BEHAVIOURAL domain shows: Interactions, AppPoint-BusinessLogic
- UI domain shows no relationship tabs

### Diagrams Palette Integration

#### Task Group 3: Update Diagrams Palette Relationship Derivation
**Dependencies:** Task Group 1

- [x] 3.0 Complete Diagrams palette relationship section updates
  - [x] 3.1 Write 3-4 focused tests for palette relationship section filtering
    - Test that APPLICATION domain palette includes Interface-LogicalEntity and DataMovements relationship sections
    - Test that DATA domain palette includes Interface-LogicalEntity and DataMovements relationship sections
    - Test that BEHAVIOURAL domain palette includes Interactions and AppPoint-BusinessLogic relationship sections
    - Test that palette filtering uses identical logic to MetaModelView (same getRelationshipsForDomain function)
  - [x] 3.2 Remove static domainToPaletteSections mapping for relationship sections in paletteData.ts
    - Identify and remove hardcoded relationship section mappings at lines 38-84
    - Keep entity section logic intact (do not modify entity filtering)
  - [x] 3.3 Import and integrate centralized derivation for relationship sections
    - Import getRelationshipsForDomain from '../config/relationshipDefinitions'
    - Create helper function to filter relationship sections by domain using getRelationshipsForDomain
    - Apply dynamic filtering in getPaletteSections for relationship sections only
  - [x] 3.4 Ensure entity section domain filtering remains unchanged
    - Entity sections should continue using domainToPaletteSections for entity filtering
    - Only relationship sections should use new centralized derivation
  - [x] 3.5 Ensure Diagrams palette tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify relationship sections appear correctly per domain
    - Verify entity sections remain unchanged

**Acceptance Criteria:**
- The 3-4 tests written in 3.1 pass
- Diagrams palette relationship sections derived using same centralized function as MetaModelView
- Entity section filtering remains unchanged
- Both MetaModelView and PalettePanel use identical relationship derivation logic
- DATA domain palette shows Interface-LogicalEntity and DataMovements sections
- APPLICATION domain palette shows Interface-LogicalEntity, DataMovements, AppPoint-BusinessLogic sections

### Testing

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review existing tests and fill critical gaps only
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review the 4-6 tests written by Task Group 1 (relationship definitions and derivation)
    - Review the 3-4 tests written by Task Group 2 (MetaModelView tabs)
    - Review the 3-4 tests written by Task Group 3 (palette sections)
    - Total existing tests: approximately 10-14 tests
  - [x] 4.2 Analyze test coverage gaps for THIS feature only
    - Identify if locked visibility requirements are fully tested for all domains
    - Check if edge cases are covered (e.g., relationships with mixed domain endpoints)
    - Focus ONLY on gaps related to this spec's feature requirements
    - Do NOT assess entire application test coverage
  - [x] 4.3 Write up to 6 additional strategic tests maximum
    - Add integration test verifying MetaModelView and Palette use same derivation result
    - Add test for Interactions appearing in both BUSINESS and BEHAVIOURAL domains
    - Add test for Interface-LogicalEntity appearing in both APPLICATION and DATA domains
    - Add test for DataMovements appearing in both APPLICATION and DATA domains
    - Add test that derivation does NOT inspect cellType or fkTarget values
    - Skip edge cases, performance tests, and accessibility tests unless business-critical
  - [x] 4.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature
    - Expected total: approximately 16-20 tests maximum
    - Do NOT run the entire application test suite
    - Verify all locked visibility requirements pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 16-20 tests total)
- Critical relationship visibility requirements for all 5 domains are covered
- No more than 6 additional tests added when filling in testing gaps
- Testing focused exclusively on this spec's feature requirements
- Both MetaModelView and Diagrams palette verified to show identical relationship tabs/sections per domain

## Implementation Summary

### Files Created
- `frontend/src/config/relationshipDefinitions.ts` - Central relationship definitions and derivation logic (239 lines)
- `frontend/src/__tests__/relationshipDefinitions.test.ts` - 29 tests for relationship definitions and derivation
- `frontend/src/__tests__/metaModelViewRelationshipTabs.test.ts` - 11 tests for MetaModelView relationship tabs
- `frontend/src/__tests__/paletteRelationshipSections.test.ts` - 18 tests for palette relationship sections

### Files Modified
- `frontend/src/components/MetaModelView/MetaModelView.tsx` - Now uses centralized getOrderedRelationshipDisplayNamesForDomain
- `frontend/src/utils/paletteData.ts` - Relationship sections now derived using centralized function
- `frontend/src/config/gridConfigs.ts` - Updated "Logical ER" to "Logical / Physical ER" in relationshipTabToType and relationshipTabNames

### Test Results
- Total tests: 58 tests
- All tests passing

## Execution Order

Recommended implementation sequence:
1. Configuration Layer (Task Group 1) - Create central relationship definitions and derivation logic
2. MetaModelView Integration (Task Group 2) - Update MetaModelView to use new derivation
3. Diagrams Palette Integration (Task Group 3) - Update palette to use same derivation
4. Test Review and Gap Analysis (Task Group 4) - Verify all requirements met

## Required Relationship Visibility per Domain (LOCKED)

For reference, these are the LOCKED visibility requirements from the spec:

| Domain | Required Relationships |
|--------|----------------------|
| BUSINESS | User-BusinessPoint, AppPoint-BusinessPoint, Interactions |
| APPLICATION | AppPoint-BusinessPoint, Interactions, Interface-LogicalEntity, DataMovements, AppPoint-BusinessLogic |
| DATA | Logical/Physical ER, Logical-Physical Entities, Logical-Physical Attributes, Interface-LogicalEntity, DataMovements |
| BEHAVIOURAL | Interactions, AppPoint-BusinessLogic |
| UI | (no relationships from canonical set) |

## Files to Create/Modify

### New Files
- `frontend/src/config/relationshipDefinitions.ts` - Central relationship definitions and derivation logic

### Files to Modify
- `frontend/src/components/MetaModelView/MetaModelView.tsx` - Remove column inspection, use new derivation
- `frontend/src/utils/paletteData.ts` - Replace static relationship mapping with dynamic derivation
- `frontend/src/config/gridConfigs.ts` - Update relationshipTabToType display name "Logical ER" to "Logical / Physical ER"

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
