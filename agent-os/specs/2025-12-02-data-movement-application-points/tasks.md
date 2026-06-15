# Task Breakdown: Data Movement Application Points

## Overview
Total Tasks: 7 Task Groups

This specification updates Data Movements to reference Application Points instead of Applications, aligning them with the App Point abstraction used elsewhere in the system. This is a focused refactoring that touches the meta-model interface, grid configuration, validation, palette enable/disable logic, edge creation, and rendering utilities.

## Task List

### Meta-model Layer

#### Task Group 1: Meta-model Schema Layer
**Dependencies:** None

- [x] 1.0 Complete meta-model schema changes
  - [x] 1.1 Write 3-4 focused tests for DataMovement interface changes
    - Test that DataMovement interface has `source_application_point_id` field
    - Test that DataMovement interface has `target_application_point_id` field
    - Test that old field names `source_application_id` / `target_application_id` are not present
    - Test TypeScript compilation succeeds with new field names
  - [x] 1.2 Update DataMovement interface in `frontend/src/types/model.ts`
    - Replace `source_application_id: string` with `source_application_point_id: string`
    - Replace `target_application_id: string` with `target_application_point_id: string`
    - Keep all other fields unchanged (`id`, `data_entity_id`, `movement_type`, `description`, `tags`, `valid_from`, `valid_to`)
  - [x] 1.3 Search codebase for any type casts or references to old field names
    - Search for `source_application_id` in all .ts/.tsx files
    - Search for `target_application_id` in all .ts/.tsx files
    - Update any type casts in rendering.ts and relationshipUtils.ts
  - [x] 1.4 Ensure meta-model schema tests pass
    - Run ONLY the 3-4 tests written in 1.1
    - Verify TypeScript compilation succeeds
    - Do NOT run the entire test suite at this stage

**Files Modified:**
- `frontend/src/types/model.ts` - DataMovement interface (lines 212-227)
- `frontend/src/components/Grid/RelationshipGrid.tsx` - createEmptyRelationship function

**Acceptance Criteria:**
- DataMovement interface uses `source_application_point_id` and `target_application_point_id`
- Old field names are removed from interface
- TypeScript compilation succeeds
- The 3-4 tests written in 1.1 pass

---

### Grid Configuration Layer

#### Task Group 2: Grid Configuration Layer
**Dependencies:** Task Group 1

- [x] 2.0 Complete grid configuration changes
  - [x] 2.1 Write 3-4 focused tests for grid config changes
    - Test that data_movements config has `source_application_point_id` column with fkTarget `'application_points'`
    - Test that data_movements config has `target_application_point_id` column with fkTarget `'application_points'`
    - Test that column displayNames are "Source App Point" and "Target App Point"
    - Test that both columns have `displayFormatter: applicationPointDisplayFormatter`
  - [x] 2.2 Update data_movements grid config in `frontend/src/config/gridConfigs.ts`
    - Change first source column:
      - `field: 'source_application_point_id'` (was `source_application_id`)
      - `displayName: 'Source App Point'` (was `'Source App'`)
      - `fkTarget: 'application_points'` (was `'applications'`)
      - Add `displayFormatter: applicationPointDisplayFormatter`
      - Adjust `width: 180` (wider to accommodate type label)
    - Change second target column:
      - `field: 'target_application_point_id'` (was `target_application_id`)
      - `displayName: 'Target App Point'` (was `'Target App'`)
      - `fkTarget: 'application_points'` (was `'applications'`)
      - Add `displayFormatter: applicationPointDisplayFormatter`
      - Adjust `width: 180` (wider to accommodate type label)
  - [x] 2.3 Verify import of applicationPointDisplayFormatter is present
    - Formatter is already imported in gridConfigs.ts (line 14)
    - No additional import needed
  - [x] 2.4 Ensure grid configuration tests pass
    - Run ONLY the 3-4 tests written in 2.1
    - Verify grid columns render correctly
    - Do NOT run the entire test suite at this stage

**Files Modified:**
- `frontend/src/config/gridConfigs.ts` - data_movements config (lines 183-211)

**Existing Pattern Followed:**
```typescript
// From application_point_business_processes config (lines 138-154)
{
  field: 'application_point_id',
  displayName: 'Application Point',
  cellType: 'fk_typeahead',
  required: true,
  width: 220,
  fkTarget: 'application_points',
  displayFormatter: applicationPointDisplayFormatter,
},
```

**Acceptance Criteria:**
- Column headers show "Source App Point" and "Target App Point"
- FK typeahead searches application_points collection
- Display format shows `"<name> (<type>)"` (e.g., "OMS System (Application)")
- The 3-4 tests written in 2.1 pass

---

### Validation Layer

#### Task Group 3: Validation Layer
**Dependencies:** Task Group 1

- [x] 3.0 Complete validation layer changes
  - [x] 3.1 Write 3-4 focused tests for validation changes
    - Test that FK validation checks `source_application_point_id` against `application_points` collection
    - Test that FK validation checks `target_application_point_id` against `application_points` collection
    - Test that validation error messages say "App Point" not "App"
    - Test that validation passes for valid application_point references
  - [x] 3.2 Review validation in `frontend/src/utils/validation.ts`
    - FK validation is automatically handled via grid config `fkTarget` property
    - The `validateFKReferences` function (lines 210-246) uses `column.fkTarget` to find target array
    - Changing fkTarget in gridConfigs.ts propagates to validation
  - [x] 3.3 Verify no hardcoded application references for Data Movements
    - Search validation.ts for any `source_application_id` / `target_application_id` references
    - Remove or update any found references
  - [x] 3.4 Ensure validation layer tests pass
    - Run ONLY the 3-4 tests written in 3.1
    - Verify FK validation works correctly
    - Do NOT run the entire test suite at this stage

**Files Reviewed:**
- `frontend/src/utils/validation.ts` - FK validation logic (no changes needed - driven by grid config)

**Technical Notes:**
- FK validation in `validateFKReferences` function is generic and uses `column.fkTarget`
- No specific Data Movement validation code exists - it's all driven by grid config
- Changing fkTarget in Task Group 2 automatically updates validation behavior

**Acceptance Criteria:**
- FK validation checks application_points collection (not applications)
- Validation error messages reference "App Point"
- The 3-4 tests written in 3.1 pass

---

### Palette Enable/Disable Layer

#### Task Group 4: Palette Enable/Disable Layer
**Dependencies:** Task Groups 1-2

- [x] 4.0 Complete palette enable/disable logic changes
  - [x] 4.1 Write 4-5 focused tests for enable/disable logic
    - Test Data Movement enabled when both source and target app points are on diagram
    - Test Data Movement disabled when source app point is missing from diagram
    - Test Data Movement disabled when target app point is missing from diagram
    - Test Data Movement enabled when app points represented via APPLICATION nodes
    - Test Data Movement enabled when app points represented via APP_COMPONENT or SERVICE nodes
  - [x] 4.2 Update `isDataMovementEnabledWithSets` in `frontend/src/utils/relationshipUtils.ts`
    - Current implementation (lines 481-511) maps application IDs to app points
    - Simplify to use `source_application_point_id` and `target_application_point_id` directly
    - Remove intermediate lookup that finds app points via application_id
    - Check `entities.applicationPointsOnDiagram.has(relationship.source_application_point_id)`
    - Check `entities.applicationPointsOnDiagram.has(relationship.target_application_point_id)`
  - [x] 4.3 Update type cast for DataMovement relationship
    - Update the type cast on line 356 to use new field names
    - Ensure TypeScript sees `source_application_point_id` and `target_application_point_id`
  - [x] 4.4 Ensure palette enable/disable tests pass
    - Run ONLY the 4-5 tests written in 4.1
    - Verify enable/disable logic works correctly
    - Do NOT run the entire test suite at this stage

**Files Modified:**
- `frontend/src/utils/relationshipUtils.ts` - `isDataMovementEnabledWithSets` function (lines 484-501)

**Implementation (simplified):**
```typescript
function isDataMovementEnabledWithSets(
  relationship: DataMovement,
  entities: EntitiesOnDiagram
): RelationshipEligibility {
  // Direct check against applicationPointsOnDiagram Set
  const sourceOnDiagram = entities.applicationPointsOnDiagram.has(
    relationship.source_application_point_id
  );
  const targetOnDiagram = entities.applicationPointsOnDiagram.has(
    relationship.target_application_point_id
  );

  if (sourceOnDiagram && targetOnDiagram) {
    return { enabled: true, disabledReason: null };
  }

  return { enabled: false, disabledReason: 'endpoints_missing' };
}
```

**Acceptance Criteria:**
- Enable/disable logic uses `source_application_point_id` / `target_application_point_id` directly
- No intermediate app point lookup needed (applicationPointsOnDiagram already has mapped IDs)
- Row enabled when both app points are represented on diagram
- Row disabled with "endpoints_missing" when either app point not on diagram
- The 4-5 tests written in 4.1 pass

---

### Edge Creation Layer

#### Task Group 5: Edge Creation Layer
**Dependencies:** Task Groups 1-4

- [x] 5.0 Complete edge creation logic changes
  - [x] 5.1 Write 4-5 focused tests for edge creation
    - Test edge created between APPLICATION nodes representing source/target app points
    - Test edge created between APP_COMPONENT nodes representing source/target app points
    - Test edge created between SERVICE nodes representing source/target app points
    - Test node priority: APPLICATION preferred over APP_COMPONENT preferred over SERVICE preferred over APPLICATION_POINT
    - Test edge has correct styling: `arrow_start=NONE`, `arrow_end=ARROW`, `line_type=SOLID`
  - [x] 5.2 Update `getDataMovementNodes` in `frontend/src/utils/relationshipUtils.ts`
    - Current implementation (lines 921-980) uses `source_application_id` / `target_application_id`
    - Update to use `source_application_point_id` / `target_application_point_id`
    - Rename internal helper from `findNodeForApplication` to `findNodeForApplicationPoint`
    - Update helper to search by application_point_id instead of application_id
  - [x] 5.3 Update node search logic in helper function
    - First, look up the application_point by ID to get its `kind` field
    - Based on kind, determine which entity type to search for:
      - `APPLICATION` kind: search for APPLICATION node with entity_id matching ap.application_id
      - `APP_COMPONENT` kind: search for APP_COMPONENT node with entity_id matching ap.application_component_id
      - `SERVICE` kind: search for SERVICE node with entity_id matching ap.service_id
    - Maintain node priority order: APPLICATION -> APP_COMPONENT -> SERVICE -> APPLICATION_POINT
  - [x] 5.4 Ensure edge creation tests pass
    - Run ONLY the 4-5 tests written in 5.1
    - Verify edges connect correct nodes
    - Do NOT run the entire test suite at this stage

**Files Modified:**
- `frontend/src/utils/relationshipUtils.ts` - `getDataMovementNodes` function (lines 918-973)

**Implementation:**
```typescript
export function getDataMovementNodes(
  relationship: DataMovement,
  nodes: DiagramNode[],
  metaModel: MetaModel
): { sourceNode: DiagramNode; targetNode: DiagramNode } | null {
  const findNodeForApplicationPoint = (applicationPointId: string): DiagramNode | undefined => {
    // Find the application point to get its kind and entity references
    const ap = metaModel.entities.application_points.find(p => p.id === applicationPointId);
    if (!ap) return undefined;

    // Priority order: APPLICATION -> APP_COMPONENT -> SERVICE -> APPLICATION_POINT
    if (ap.kind === 'APPLICATION' && ap.application_id) {
      const appNode = nodes.find(
        n => n.entity_type === ENTITY_TYPES.APPLICATION && n.entity_id === ap.application_id
      );
      if (appNode) return appNode;
    }

    if (ap.kind === 'APP_COMPONENT' && ap.application_component_id) {
      const compNode = nodes.find(
        n => n.entity_type === ENTITY_TYPES.APP_COMPONENT && n.entity_id === ap.application_component_id
      );
      if (compNode) return compNode;
    }

    if (ap.kind === 'SERVICE' && ap.service_id) {
      const svcNode = nodes.find(
        n => n.entity_type === ENTITY_TYPES.SERVICE && n.entity_id === ap.service_id
      );
      if (svcNode) return svcNode;
    }

    // Fallback: direct APPLICATION_POINT node
    return nodes.find(
      n => n.entity_type === ENTITY_TYPES.APPLICATION_POINT && n.entity_id === applicationPointId
    );
  };

  const sourceNode = findNodeForApplicationPoint(relationship.source_application_point_id);
  const targetNode = findNodeForApplicationPoint(relationship.target_application_point_id);

  if (!sourceNode || !targetNode) {
    return null;
  }

  return { sourceNode, targetNode };
}
```

**Acceptance Criteria:**
- Edge creation uses `source_application_point_id` / `target_application_point_id`
- Node search finds correct nodes based on app point kind
- Priority order maintained: APPLICATION -> APP_COMPONENT -> SERVICE -> APPLICATION_POINT
- Edge styling unchanged: `arrow_start=NONE`, `arrow_end=ARROW`, `line_type=SOLID`
- The 4-5 tests written in 5.1 pass

---

### Rendering Utilities Layer

#### Task Group 6: Rendering Utilities Layer
**Dependencies:** Task Groups 1-5

- [x] 6.0 Complete rendering utilities changes
  - [x] 6.1 Write 3-4 focused tests for rendering utilities
    - Test `getRelationshipEndpointEntities` returns correct application_points for DATA_MOVEMENT
    - Test endpoint lookup uses `source_application_point_id` not `source_application_id`
    - Test endpoint lookup uses `target_application_point_id` not `target_application_id`
    - Test temporal visibility checking works with application_point endpoints
  - [x] 6.2 Update `getRelationshipEndpointEntities` in `frontend/src/utils/rendering.ts`
    - Current implementation (lines 209-219) looks up applications
    - Update DATA_MOVEMENT case to look up application_points instead
    - Change from `source_application_id` / `target_application_id` to `source_application_point_id` / `target_application_point_id`
  - [x] 6.3 Update type cast for DATA_MOVEMENT relationship
    - Change type cast from `{ source_application_id: string; target_application_id: string; data_entity_id: string }`
    - To `{ source_application_point_id: string; target_application_point_id: string; data_entity_id: string }`
  - [x] 6.4 Ensure rendering utilities tests pass
    - Run ONLY the 3-4 tests written in 6.1
    - Verify endpoint entity lookup works correctly
    - Do NOT run the entire test suite at this stage

**Files Modified:**
- `frontend/src/utils/rendering.ts` - `getRelationshipEndpointEntities` function, DATA_MOVEMENT case (lines 209-220)

**Implementation:**
```typescript
case 'DATA_MOVEMENT': {
  const rel = relationship as { source_application_point_id: string; target_application_point_id: string; data_entity_id: string };
  const sourceAppPoint = metaModel.entities.application_points.find(e => e.id === rel.source_application_point_id);
  const targetAppPoint = metaModel.entities.application_points.find(e => e.id === rel.target_application_point_id);
  if (sourceAppPoint) endpoints.push(sourceAppPoint);
  if (targetAppPoint) endpoints.push(targetAppPoint);
  break;
}
```

**Acceptance Criteria:**
- Endpoint lookup uses application_points collection
- Endpoint lookup uses new field names
- Temporal visibility checking works for application_point endpoints
- The 3-4 tests written in 6.1 pass

---

### Integration Testing

#### Task Group 7: Integration Testing
**Dependencies:** Task Groups 1-6

- [x] 7.0 Review existing tests and run integration tests
  - [x] 7.1 Review tests from Task Groups 1-6
    - Review the 3-4 tests written by Task Group 1 (meta-model schema)
    - Review the 3-4 tests written by Task Group 2 (grid config)
    - Review the 3-4 tests written by Task Group 3 (validation)
    - Review the 4-5 tests written by Task Group 4 (palette enable/disable)
    - Review the 4-5 tests written by Task Group 5 (edge creation)
    - Review the 3-4 tests written by Task Group 6 (rendering utilities)
    - Total existing tests: approximately 21-26 tests
  - [x] 7.2 Write up to 10 additional integration tests covering key scenarios
    - Data Movement between two Applications (via their app points on diagram)
    - Data Movement between an Application Component and a Service
    - Diagram where only source endpoint is present (row disabled)
    - Diagram where only target endpoint is present (row disabled)
    - Diagram where both endpoints are present (row enabled, edge added correctly)
    - Edge has arrow pointing to target node
    - Palette behaviour when switching between diagrams
    - Grid autocomplete searches application_points with type label display
    - Temporal filtering works correctly with application_point endpoints
    - Validation rejects invalid application_point references
  - [x] 7.3 Run TypeScript compilation
    - Run `npx tsc --noEmit` in frontend directory
    - Verify no TypeScript errors related to DataMovement interface
    - Verify no TypeScript errors in relationshipUtils.ts
    - Verify no TypeScript errors in rendering.ts
  - [x] 7.4 Run feature-specific tests
    - Run all tests from Task Groups 1-6 plus integration tests from 7.2
    - Expected total: approximately 31-36 tests maximum
    - Verify all critical workflows pass
    - Do NOT run unrelated application tests

**Test File Created:**
- `frontend/src/__tests__/data-movement-application-points.test.ts` - Comprehensive test suite covering all 7 task groups

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 31-36 tests total)
- TypeScript compilation succeeds with no errors
- Integration tests cover all key scenarios from requirements
- No more than 10 additional tests added for integration testing

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Meta-model Schema Layer** - Foundation for all other changes
2. **Task Group 2: Grid Configuration Layer** - Can be done after Task Group 1
3. **Task Group 3: Validation Layer** - Can be done in parallel with Task Group 2 after Task Group 1
4. **Task Group 4: Palette Enable/Disable Layer** - Depends on Task Groups 1-2
5. **Task Group 5: Edge Creation Layer** - Depends on Task Groups 1-4
6. **Task Group 6: Rendering Utilities Layer** - Depends on Task Groups 1-5
7. **Task Group 7: Integration Testing** - Final integration and verification

**Note:** Task Groups 2 and 3 can be executed in parallel after Task Group 1 completes.

---

## Technical Reference

### Key Files

| File | Purpose | Changes |
|------|---------|---------|
| `frontend/src/types/model.ts` | DataMovement interface | Replace field names |
| `frontend/src/config/gridConfigs.ts` | Grid column config | Update data_movements columns |
| `frontend/src/utils/validation.ts` | FK validation | Review only (driven by grid config) |
| `frontend/src/utils/relationshipUtils.ts` | Palette logic & edge creation | Update two functions |
| `frontend/src/utils/rendering.ts` | Temporal endpoint lookup | Update DATA_MOVEMENT case |
| `frontend/src/utils/formatters.ts` | Display formatter | No changes (reuse existing) |
| `frontend/src/components/Grid/RelationshipGrid.tsx` | Empty relationship creation | Update data_movements case |

### Field Name Mapping

| Old Field | New Field |
|-----------|-----------|
| `source_application_id` | `source_application_point_id` |
| `target_application_id` | `target_application_point_id` |

### Display Format

Application Points are displayed as: `"<name> (<type>)"`
- Type labels: "Application", "Application Component", "Service"
- Example: "OMS System (Application)", "Pricing UI (Application Component)"

### Edge Styling

Data Movement edges maintain existing styling:
- `line_type: 'SOLID'`
- `arrow_start: 'NONE'`
- `arrow_end: 'ARROW'` (pointing to target/destination)
- Label defaults to Logical Data Entity name

### applicationPointsOnDiagram Set

The `getEntitiesOnDiagram` function already populates `applicationPointsOnDiagram` with:
- Direct APPLICATION_POINT node entity_ids
- APPLICATION node entity_ids mapped to their corresponding app point IDs
- APP_COMPONENT node entity_ids mapped to their corresponding app point IDs
- SERVICE node entity_ids mapped to their corresponding app point IDs

This abstraction means the enable/disable logic can directly check `applicationPointsOnDiagram.has(relationship.source_application_point_id)` without additional lookups.
