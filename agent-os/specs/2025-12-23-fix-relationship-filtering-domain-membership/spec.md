# Specification: Fix Relationship Filtering to Use Domain Entity Membership

## Goal
Restore visibility of relationship tabs involving hidden super-entities (Application Point, Business Point) by creating a separate `DOMAIN_ENTITY_TYPES` mapping that includes all entity types for relationship filtering, while `domainGroupings` continues to control visible entity tabs only.

## User Stories
- As a user viewing the Business domain in Meta-Model View, I want to see relationship tabs like "App Point <-> Business Point" even though Business Points are hidden from entity tabs, so that I can still manage cross-domain relationships.
- As a user viewing the Application domain in Meta-Model View, I want to see relationship tabs referencing Application Points so that I can link application entities to business points.

## Specific Requirements

**Create DOMAIN_ENTITY_TYPES constant**
- Add new constant `DOMAIN_ENTITY_TYPES` in `frontend/src/config/gridConfigs.ts`
- Structure: `Record<ArchitectureDomain, string[]>` mapping domains to entity type keys (not display tab names)
- Include `business_points` in the `business` domain array
- Include `application_points` in the `application` domain array
- Include all other existing entity types from current `domainGroupings` (converted to type keys)
- Export this constant for use in relationship filtering logic

**Update getRelationshipTabsForDomain function**
- Modify `getRelationshipTabsForDomain` in `frontend/src/components/MetaModelView/MetaModelView.tsx`
- Import `DOMAIN_ENTITY_TYPES` from `gridConfigs.ts`
- Replace current logic that uses `domainGroupings[domain].map(tab => tabToEntityType[tab])` with direct usage of `DOMAIN_ENTITY_TYPES[domain]`
- This decouples relationship visibility from visible entity tabs

**Preserve domainGroupings for entity tabs**
- Keep `domainGroupings` unchanged (without Business Points, Application Points)
- `domainGroupings` continues to control which entity tabs appear in the UI
- Entity tabs row in MetaModelView continues using `domainGroupings[state.selectedDomain]`

**Update existing tests**
- Modify `frontend/src/__tests__/domain-relationship-filtering.test.ts`
- Import `DOMAIN_ENTITY_TYPES` instead of using `domainGroupings` for the test assertions
- Update test helper function to use `DOMAIN_ENTITY_TYPES[domain]` directly
- Tests for `testBusinessDomainEntityTypeKeys` and `testApplicationDomainEntityTypeKeys` should now pass

**Update palette relationship filtering**
- Review `frontend/src/utils/paletteData.ts` to ensure `domainToPaletteSections` includes relationship sections that reference hidden entities
- Current `domainToPaletteSections` already includes `application_point_business_points` in both business and application domains - verify this remains correct

**DOMAIN_ENTITY_TYPES values**
- business: `['business_users', 'business_processes', 'process_activities', 'business_points']`
- application: `['applications', 'app_components', 'services', 'interfaces', 'endpoints', 'classes', 'methods', 'application_points']`
- data: `['logical_data_entities', 'logical_data_attributes', 'physical_data_entities', 'physical_data_attributes']`
- behavioural: `['events']`

## Existing Code to Leverage

**domainGroupings in gridConfigs.ts**
- Current structure maps `ArchitectureDomain` to visible tab names (strings like 'Users', 'Processes')
- Use as reference for visible entity tabs but do not modify
- New `DOMAIN_ENTITY_TYPES` will use type keys instead (e.g., 'business_users' instead of 'Users')

**tabToEntityType mapping in gridConfigs.ts**
- Maps tab display names to entity type keys
- Already includes mappings for 'Application Points' and 'Business Points' (preserved for internal API wiring)
- Use this mapping to derive the entity type keys for `DOMAIN_ENTITY_TYPES`

**getRelationshipTabsForDomain in MetaModelView.tsx**
- Current implementation at lines 34-55 uses `domainGroupings[domain].map(tab => tabToEntityType[tab])`
- Replace this single line with `DOMAIN_ENTITY_TYPES[domain]` after importing the new constant
- Rest of the function logic (FK target intersection check) remains unchanged

**domainToPaletteSections in paletteData.ts**
- Already correctly includes relationship sections like `application_point_business_points` in both business and application domains
- No changes needed for palette - it uses its own hardcoded mapping separate from `domainGroupings`

**domain-relationship-filtering.test.ts**
- Contains comprehensive test cases that currently fail because they expect `business_points` and `application_points` in domain entity type keys
- Update the test helper function to use `DOMAIN_ENTITY_TYPES` instead of deriving from `domainGroupings`

## Out of Scope
- Making Application Points or Business Points visible/editable as entity tabs
- Changes to backend schema or APIs
- Changes to entity persistence or data model
- Modifying how entities are stored or retrieved
- Adding new entity types or relationships
- Changes to the palette entity sections (already working correctly)
- Changes to how the grid renders entities or relationships
- Modifying the DomainSelector component
- Changes to diagram view rendering logic
- Adding Application Points or Business Points to the diagram RHS palette entity sections
