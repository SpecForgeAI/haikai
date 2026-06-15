# Specification: Fix Interactions Relationship Configuration

## Goal
Fix the RelationshipGrid crash when clicking the "Interactions" tab by routing Interactions through EntityGrid (since data is stored in `entities.interactions`) and adding defensive error handling to RelationshipGrid.

## User Stories
- As a user, I want to click the Interactions tab without the app crashing so that I can view and edit interaction data
- As a user, I want to see a meaningful error message if a relationship configuration is missing instead of a white screen

## Root Cause Analysis

**The Problem:**
- The crash occurs at RelationshipGrid.tsx line 78 because `relationships.map()` is called on undefined
- `relationshipTabToType` maps "Interactions" to "interactions" but this key does not exist in `metaModel.relationships`
- Interactions are stored in `metaModel.entities.interactions`, NOT in `metaModel.relationships`
- The `gridConfigs["interactions"]` exists but RelationshipGrid tries to access `relationships["interactions"]` which is undefined

**The Mismatch:**
- Tab configuration: "Interactions" was in `relationshipTabNames` → routes to RelationshipGrid
- Data storage: Interactions data lives in `metaModel.entities.interactions`
- RelationshipGrid only supports `metaModel.relationships[type]` access pattern

## Implemented Solution: Route Interactions Through EntityGrid

**Option A was chosen** because it's the simplest solution that leverages existing infrastructure.

### Configuration Changes in `gridConfigs.ts`

1. **Remove "Interactions" from `relationshipTabNames`**
   - Prevents routing through RelationshipGrid
   - Array now contains only true relationship types

2. **Remove "Interactions" from `relationshipTabToType`**
   - No mapping needed since Interactions doesn't use RelationshipGrid

3. **Add "Interactions" to `entityTabNames`**
   - Position: After "Activities", before "Applications"
   - Routes through EntityGrid which uses `entities[type]` access

4. **Add "Interactions" to `domainGroupings.business`**
   - Position: After "Activities"
   - Result: `['Users', 'Processes', 'Activities', 'Interactions']`

5. **Retain `tabToEntityType["Interactions"]` mapping**
   - Already maps "Interactions" → "interactions"
   - Required for EntityGrid data access

### Defensive Handling in `RelationshipGrid.tsx`

Added null checks to prevent crashes from future misconfigurations:

```typescript
// Check columns configuration
if (!columns) {
  return (
    <div className={styles.gridWrapper}>
      <div style={{ padding: '20px', color: '#dc3545', textAlign: 'center' }}>
        No configuration found for relationship type: {relationshipType}
      </div>
    </div>
  );
}

// Check relationships data
if (!relationships) {
  return (
    <div className={styles.gridWrapper}>
      <div style={{ padding: '20px', color: '#dc3545', textAlign: 'center' }}>
        No data found for relationship type: {relationshipType}
      </div>
    </div>
  );
}
```

## Final Configuration State

### `gridConfigs.ts` Key Arrays

```typescript
// entityTabNames - includes Interactions (uses EntityGrid)
export const entityTabNames = [
  'Users',
  'Processes',
  'Activities',
  'Interactions',  // Routes to EntityGrid (data in entities.interactions)
  'Applications',
  'App Components',
  'Services',
  'Interfaces',
  'Endpoints',
  'Logical Entities',
  'Logical Attributes',
  'Physical Entities',
  'Physical Attributes',
];

// domainGroupings - Interactions in business domain
export const domainGroupings = {
  business: ['Users', 'Processes', 'Activities', 'Interactions'],
  application: ['Applications', 'App Components', 'Services', 'Interfaces', 'Endpoints'],
  data: ['Logical Entities', 'Logical Attributes', 'Physical Entities', 'Physical Attributes'],
};

// relationshipTabNames - does NOT include Interactions
export const relationshipTabNames = [
  'User <-> Business Point',
  'App Point <-> Business Point',
  'Logical ER',
  'Logical <-> Physical Entities',
  'Logical <-> Physical Attributes',
  'Interface <-> Logical Entity',
  'Data Movements',
];

// relationshipTabToType - does NOT include Interactions
export const relationshipTabToType: Record<string, string> = {
  'User <-> Business Point': 'business_user_business_points',
  'App Point <-> Business Point': 'application_point_business_points',
  'Logical ER': 'logical_data_entity_relationships',
  // ... other mappings
  // NO 'Interactions' mapping here
};

// tabToEntityType - includes Interactions mapping
export const tabToEntityType: Record<string, string> = {
  // ...
  'Interactions': 'interactions',  // Required for EntityGrid data access
  // ...
};
```

## Acceptance Criteria

- [x] AC1: No crash when clicking Interactions tab
- [x] AC2: Interactions tab displays in Entities row (Business domain)
- [x] AC3: Interactions grid shows correctly with all columns via EntityGrid
- [x] AC4: RelationshipGrid shows friendly error instead of crashing for invalid configs
- [x] AC5: Other relationship tabs continue to work correctly
- [x] AC6: CRUD operations work for Interactions via EntityGrid

## Files Modified

| File | Changes |
|------|---------|
| `frontend/src/config/gridConfigs.ts` | Updated tab arrays and mappings |
| `frontend/src/components/Grid/RelationshipGrid.tsx` | Added defensive null checks |

## Tests

| Test File | Tests | Purpose |
|-----------|-------|---------|
| `interactions-tab-routing.test.ts` | 8 | Verify tab configuration |
| `relationship-grid-defensive.test.ts` | 6 | Verify defensive handling |
| `interactions-fix-integration.test.ts` | 8 | End-to-end verification |

**Total: 22 tests, all passing**

## Out of Scope
- Modifying the Interaction interface or adding new fields
- Changing how Interactions are stored in the meta-model (entities vs relationships)
- Adding new visual representation for Interactions on the diagram canvas
- Modifying the interaction edge rendering logic
- Adding validation rules specific to Interactions
- Changing the display formatters for app_business_points typeahead
- Modifying other relationship grid configurations
- Changing the MetaModelView layout or styling
- Adding undo/redo support for Interactions changes
