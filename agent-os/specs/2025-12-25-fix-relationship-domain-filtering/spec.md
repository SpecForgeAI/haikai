# Specification: Fix Relationship Filtering to Use Domain Entity Membership

## Goal
Ensure relationship visibility in Meta-Model and Diagram Palette views is determined by a domain's full entity membership (including hidden super-entities like Application Point and Business Point), not by the subset of entities visible in the UI, preventing accidental loss of relationship tabs when entities are hidden from editing.

## User Stories
- As an architect, I want to see relationship tabs involving Application Points in the Application domain even though Application Points are hidden from entity tabs, so that I can manage cross-domain relationships without losing visibility.
- As an architect, I want the Business domain to show "App Point <-> Business Point" relationships even though Business Points are hidden from entity editing, so that I can work with business-application integration relationships.

## Specific Requirements

**Introduce DOMAIN_VISIBLE_ENTITY_TABS configuration**
- Create a new constant `DOMAIN_VISIBLE_ENTITY_TABS` in `frontend/src/config/gridConfigs.ts` alongside existing `DOMAIN_ENTITY_TYPES`
- Map each domain to an array of entity type keys that should appear as visible/editable tabs in the UI
- Business domain: exclude `business_points` from visible tabs
- Application domain: exclude `application_points` from visible tabs
- Data and Behavioural domains: unchanged (no hidden entities)
- This creates explicit separation between authoritative membership and UI visibility

**Update Meta-Model Entity tabs to use visible entity subset**
- Modify `MetaModelView.tsx` to render entity tabs from `DOMAIN_VISIBLE_ENTITY_TABS[selectedDomain]` instead of `domainGroupings`
- Alternatively, leverage existing `domainGroupings` which already excludes Business Points and Application Points
- Ensure entity row tabs only show entities users can directly edit
- No change to underlying entity type mappings or data handling

**Verify relationship filtering uses DOMAIN_ENTITY_TYPES**
- Confirm `getRelationshipTabsForDomain()` in MetaModelView.tsx uses `DOMAIN_ENTITY_TYPES` (authoritative membership)
- DOMAIN_ENTITY_TYPES already includes hidden super-entities (application_points, business_points)
- Relationship tab visibility: include if intersection of FK targets with domain entity type keys is non-empty
- This ensures relationships like "App Point <-> Business Point" appear in both Business and Application domains

**Update Diagram Palette entity sections to exclude hidden entities**
- Modify `domainToPaletteSections` in `frontend/src/utils/paletteData.ts` to exclude `application_points` and `business_points`
- Verify `getPaletteSections()` does not include hidden entity sections for any domain
- Application Points and Business Points should never appear as placeable entity sections in the palette
- Existing code already excludes these sections; confirm no regression

**Ensure Diagram Palette relationship sections use authoritative membership**
- Relationship section filtering in `getPaletteSections()` should mirror Meta-Model relationship filtering logic
- Sections like `application_point_business_points` should appear under both Business and Application domains
- Use FK target intersection with DOMAIN_ENTITY_TYPES to determine visibility
- Cross-domain relationships must be accessible from all relevant domains

**Add regression tests for relationship visibility**
- Extend `frontend/src/__tests__/domain-relationship-filtering.test.ts` with new test cases
- Meta-Model tests: verify entity tabs exclude hidden entities while relationship tabs include them
- Diagram Palette tests: verify entity sections exclude hidden entities while relationship sections include them
- Test that adding/hiding entities does not break relationship visibility

## Existing Code to Leverage

**DOMAIN_ENTITY_TYPES constant (gridConfigs.ts lines 458-463)**
- Already defines authoritative domain membership including hidden super-entities
- Business domain includes `business_points`, Application domain includes `application_points`
- Use this for relationship filtering (already implemented in getRelationshipTabsForDomain)

**domainGroupings constant (gridConfigs.ts lines 441-446)**
- Already excludes Business Points and Application Points from visible entity tabs
- Currently used by MetaModelView for entity tab rendering
- Confirms visible entity subset already exists

**getRelationshipTabsForDomain function (MetaModelView.tsx lines 47-76)**
- Already uses DOMAIN_ENTITY_TYPES for relationship filtering
- Includes null-safety guards and proper FK target intersection logic
- Confirms relationship filtering already uses authoritative membership

**domainToPaletteSections mapping (paletteData.ts lines 33-70)**
- Already excludes application_points and business_points from entity sections
- Relationship sections like `application_point_business_points` correctly included
- Confirms palette entity filtering already works correctly

**Existing test file (domain-relationship-filtering.test.ts)**
- Comprehensive tests for relationship tab filtering algorithm
- Tests verify cross-domain relationships appear in correct domains
- Tests verify DOMAIN_ENTITY_TYPES includes hidden super-entities

## Out of Scope
- Backend schema or API changes
- Changes to entity persistence or data storage
- Making Application Points or Business Points placeable or editable in the UI
- Modifying how super-entities are derived or created
- Changes to entity grid rendering (EntityGrid component)
- RelationshipGrid component modifications
- Changes to the DomainSelector component behavior
- Palette drag-and-drop functionality changes
- Context menu actions for hidden entity types
