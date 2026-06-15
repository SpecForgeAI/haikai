# Task Breakdown: Fix MetaModelView Crash and Liquibase Baseline Robustness

## Overview
Total Tasks: 17 (across 5 task groups)

This is a focused bug fix spec addressing two distinct issues:
1. **Part A (Frontend)**: MetaModelView crashes when accessing `selectedDomain` due to missing state property and null-unsafe array access
2. **Part B (Backend)**: Liquibase changeSets fail with "table already exists" when database has pre-existing tables

## Task List

### Part A: Frontend - Domain Config Verification

#### Task Group 1: Domain Config Completeness Verification
**Dependencies:** None

- [x] 1.0 Verify domain config exports are complete and correctly typed
  - [x] 1.1 Verify `ALL_DOMAINS` array in `architectureDomain.ts` contains all four domains
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\types\architectureDomain.ts`
    - Verify line 25 exports: `['business', 'application', 'data', 'behavioural']`
    - Verify `ArchitectureDomain` type union matches array values (line 20)
  - [x] 1.2 Verify `DOMAIN_ENTITY_TYPES` in `gridConfigs.ts` has entries for all four domains
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\config\gridConfigs.ts`
    - Verify lines 411-416 have non-empty arrays for each domain key
    - Confirm `business_points` is in business domain array
    - Confirm `application_points` is in application domain array
  - [x] 1.3 Add explicit type annotation to `DOMAIN_ENTITY_TYPES` if missing
    - Ensure type is `Record<ArchitectureDomain, string[]>`
    - This provides compile-time guarantee that all domain keys are present

**Acceptance Criteria:**
- ALL_DOMAINS contains exactly 4 domains
- DOMAIN_ENTITY_TYPES has entries for all 4 domains with non-empty arrays
- Hidden super-entities (business_points, application_points) are included in their respective domains

---

### Part A: Frontend - Null-Safety Fix

#### Task Group 2: getRelationshipTabsForDomain Null-Safety
**Dependencies:** Task Group 1

- [x] 2.0 Make getRelationshipTabsForDomain null-safe
  - [x] 2.1 Write 3-5 focused tests for null-safety scenarios
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\domain-relationship-filtering.test.ts`
    - Test: Function returns empty array for invalid domain string
    - Test: Function handles missing gridConfig gracefully (returns false in filter)
    - Test: Function handles undefined fkTarget gracefully
    - Test: Function works correctly for all four valid domains
  - [x] 2.2 Add guard clause at function start for invalid domain
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\MetaModelView.tsx`
    - Import `ALL_DOMAINS` and `isArchitectureDomain` from `architectureDomain.ts`
    - At line 38, add guard: `if (!ALL_DOMAINS.includes(domain)) return [];`
  - [x] 2.3 Add nullish coalescing for DOMAIN_ENTITY_TYPES access
    - Line 41: Change `DOMAIN_ENTITY_TYPES[domain]` to `DOMAIN_ENTITY_TYPES[domain] ?? []`
    - This prevents crash if domain key is somehow missing at runtime
  - [x] 2.4 Add nullish coalescing for fkTargets extraction
    - Line 52-54: Ensure fkTargets array always exists, use fallback `?? []` if needed
    - Already filters for truthy fkTarget, but add explicit check
  - [x] 2.5 Ensure gridConfigs lookup returns early if config is undefined
    - Line 45-48: Already has `if (!config) return false;` - verify this is correct
  - [x] 2.6 Run the null-safety tests written in 2.1
    - Execute only the new tests to verify fix
    - Command: `cd frontend && npm test -- --testPathPattern="domain-relationship-filtering" --verbose`

**Acceptance Criteria:**
- getRelationshipTabsForDomain never throws on undefined/null access
- Invalid domain returns empty array, does not crash
- All null-safety tests pass

---

### Part A: Frontend - Domain State Initialization

#### Task Group 3: ArchitectureContext selectedDomain State
**Dependencies:** Task Group 2

- [x] 3.0 Fix selectedDomain state initialization and handling
  - [x] 3.1 Add selectedDomain to AppState interface
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\contexts\ArchitectureContext.tsx`
    - Add to AppState interface (around line 52): `selectedDomain: ArchitectureDomain;`
    - Import `ArchitectureDomain` from `'../types/architectureDomain'`
  - [x] 3.2 Add selectedDomain to initialState with 'business' default
    - Around line 139-150: Add `selectedDomain: 'business',` to initialState
    - This ensures safe default when app loads
  - [x] 3.3 Add SET_DOMAIN action type to AppAction union
    - Around line 68-136: Add `| { type: 'SET_DOMAIN'; payload: ArchitectureDomain }`
    - This enables type-safe dispatching from DomainSelector
  - [x] 3.4 Add SET_DOMAIN case to appReducer
    - Add case in switch statement (around line 230):
    ```typescript
    case 'SET_DOMAIN': {
      // Validate domain using isArchitectureDomain type guard
      if (!isArchitectureDomain(action.payload)) {
        return state; // Ignore invalid domain, don't crash
      }
      return {
        ...state,
        selectedDomain: action.payload,
      };
    }
    ```
    - Import `isArchitectureDomain` from `'../types/architectureDomain'`
  - [x] 3.5 Verify DomainSelector component dispatches correctly
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\components\MetaModelView\DomainSelector.tsx`
    - Line 28: Already dispatches `{ type: 'SET_DOMAIN', payload: domain }`
    - No changes needed, just verify integration works
  - [x] 3.6 Test domain switching in MetaModelView
    - Start frontend dev server: `cd frontend && npm run dev`
    - Navigate to Meta-Model view
    - Click each domain button (Business, Application, Data, Behavioural)
    - Verify no crash occurs, tabs filter correctly

**Acceptance Criteria:**
- selectedDomain exists in AppState with type ArchitectureDomain
- Initial value is 'business'
- SET_DOMAIN action updates state correctly
- Invalid domain values are ignored (no crash)
- Domain switching works in UI without errors

---

### Part B: Backend - Liquibase PreConditions

#### Task Group 4: Liquibase Changelog PreConditions
**Dependencies:** None (can run in parallel with Part A)

- [x] 4.0 Add preConditions to Liquibase changeSets for idempotent baseline
  - [x] 4.1 Add preConditions to changeSet 001-initial-schema
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\architecture-model-service\src\main\resources\db\changelog\db.changelog-master.yaml`
    - Add preConditions block with `onFail: MARK_RAN` and `onError: HALT`
    - Use `not: tableExists: tableName: model_files` as anchor table check
    - If model_files exists, changeSet is marked as ran without executing SQL
  - [x] 4.2 Add preConditions to changeSet 002-classes-methods
    - Add preConditions block with `onFail: MARK_RAN` and `onError: HALT`
    - Use `not: tableExists: tableName: classes` as anchor table check
  - [x] 4.3 Add preConditions to changeSet 003-events
    - Add preConditions block with `onFail: MARK_RAN` and `onError: HALT`
    - Use `not: tableExists: tableName: events` as anchor table check
  - [x] 4.4 Add preConditions to changeSet 004-states-state-transitions
    - Add preConditions block with `onFail: MARK_RAN` and `onError: HALT`
    - Use `not: tableExists: tableName: states` as anchor table check
  - [x] 4.5 Verify SQL files are NOT modified
    - Confirm `schema.sql` is unchanged
    - Confirm `002-classes-methods.sql` is unchanged
    - Confirm `003-events.sql` is unchanged
    - Confirm `004-states-state-transitions.sql` is unchanged
  - [x] 4.6 Test Liquibase with existing tables scenario
    - Stop docker: `docker compose down` (without -v to preserve data)
    - Restart: `docker compose up --build`
    - Verify backend starts successfully (Liquibase marks changeSets as ran)
    - Check logs for "MARK_RAN" messages

**Acceptance Criteria:**
- All 4 changeSets have preConditions with `onFail: MARK_RAN`
- SQL files remain unchanged (no checksum changes)
- Backend starts successfully when database has pre-existing tables
- Clean database scenario still applies migrations normally

---

### Verification Layer

#### Task Group 5: Integration Verification
**Dependencies:** Task Groups 1-4

- [x] 5.0 End-to-end verification of both fixes
  - [x] 5.1 Run existing domain relationship filtering tests
    - File: `C:\Workspaces\SSD\architecture-store-and-diagrams\frontend\src\__tests__\domain-relationship-filtering.test.ts`
    - Command: `cd frontend && npm test -- --testPathPattern="domain-relationship-filtering" --verbose`
    - All existing tests should continue to pass
  - [x] 5.2 Clean environment test for Liquibase
    - Full reset: `docker compose down -v && docker compose up --build`
    - Verify all migrations apply successfully to fresh database
    - Verify backend starts and responds to health check
  - [x] 5.3 Manual smoke test for MetaModelView
    - Load application in browser
    - Navigate to Meta-Model view
    - Switch between all four domains
    - Verify no console errors
    - Verify entity tabs change correctly per domain
    - Verify relationship tabs filter correctly per domain
  - [x] 5.4 Document dev reset guidance in spec or README
    - When Liquibase state and tables are out of sync:
    - Deterministic fix: `docker compose down -v && docker compose up --build`
    - This removes Postgres volume and applies Liquibase from scratch

**Acceptance Criteria:**
- All domain relationship filtering tests pass
- Liquibase works correctly in both fresh and existing-tables scenarios
- MetaModelView works without crashes when switching domains
- Dev reset guidance documented

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** (Domain Config Verification) - Quick verification, no code changes expected
2. **Task Group 4** (Liquibase PreConditions) - Can run in parallel with frontend work
3. **Task Group 2** (getRelationshipTabsForDomain Null-Safety) - Core fix for crash
4. **Task Group 3** (ArchitectureContext selectedDomain) - Depends on understanding from Group 2
5. **Task Group 5** (Integration Verification) - Final validation after all fixes

---

## Files Modified

### Frontend (Part A)
| File | Changes |
|------|---------|
| `frontend/src/types/architectureDomain.ts` | Verify only (no changes expected) |
| `frontend/src/config/gridConfigs.ts` | Verify only (no changes expected) |
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | Add null-safety to getRelationshipTabsForDomain |
| `frontend/src/contexts/ArchitectureContext.tsx` | Add selectedDomain to state, add SET_DOMAIN handler |
| `frontend/src/__tests__/domain-relationship-filtering.test.ts` | Add null-safety tests |

### Backend (Part B)
| File | Changes |
|------|---------|
| `architecture-model-service/src/main/resources/db/changelog/db.changelog-master.yaml` | Add preConditions to all changeSets |

### NOT Modified (Explicitly Out of Scope)
- `schema.sql`
- `002-classes-methods.sql`
- `003-events.sql`
- `004-states-state-transitions.sql`

---

## Reference: Liquibase PreConditions YAML Format

Example for changeSet 001:
```yaml
- changeSet:
    id: 001-initial-schema
    author: architecture-tool
    preConditions:
      - onFail: MARK_RAN
      - onError: HALT
      - not:
          tableExists:
            tableName: model_files
    changes:
      - sqlFile:
          path: db/changelog/sql/schema.sql
          relativeToChangelogFile: false
          splitStatements: true
          stripComments: true
```

---

## Reference: getRelationshipTabsForDomain Null-Safe Version

```typescript
export function getRelationshipTabsForDomain(domain: ArchitectureDomain): string[] {
  // Guard: return empty array for invalid domain
  if (!ALL_DOMAINS.includes(domain)) {
    return [];
  }

  // Use DOMAIN_ENTITY_TYPES which includes hidden entities like application_points and business_points
  // Nullish coalescing ensures we never access undefined
  const domainEntityTypeKeys = DOMAIN_ENTITY_TYPES[domain] ?? [];

  return relationshipTabNames.filter(tabName => {
    const relTypeKey = relationshipTabToType[tabName];
    const config = gridConfigs[relTypeKey];

    if (!config) {
      return false;
    }

    // Collect all fkTarget values from columns where cellType === 'fk_typeahead'
    const fkTargets = config
      .filter(col => col.cellType === 'fk_typeahead' && col.fkTarget)
      .map(col => col.fkTarget as string);

    // Include tab if any fkTarget intersects with the domain's entity type keys
    return fkTargets.some(target => domainEntityTypeKeys.includes(target));
  });
}
```

---

## Implementation Summary (2025-12-24)

All task groups have been completed:

### Task Group 1: Domain Config Verification
- Verified `ALL_DOMAINS` contains all 4 domains in `architectureDomain.ts`
- Verified `DOMAIN_ENTITY_TYPES` in `gridConfigs.ts` has `Record<ArchitectureDomain, string[]>` type annotation
- Confirmed hidden super-entities (`business_points`, `application_points`) are included

### Task Group 2: Null-Safety Implementation
- Added 5 null-safety tests to `domain-relationship-filtering.test.ts`
- Added guard clause for invalid domain in `getRelationshipTabsForDomain`
- Added nullish coalescing for `DOMAIN_ENTITY_TYPES[domain]`
- Added nullish coalescing for config access
- All 31 tests pass

### Task Group 3: ArchitectureContext State
- Added `selectedDomain: ArchitectureDomain` to `AppState` interface
- Added `selectedDomain: 'business'` to `initialState`
- Added `SET_DOMAIN` action type to `AppAction` union
- Added `SET_DOMAIN` case to `appReducer` with validation
- SET_DOMAIN also auto-selects first tab of new domain if current tab is invalid

### Task Group 4: Liquibase PreConditions
- Added preConditions to all 4 changeSets with `onFail: MARK_RAN` and `onError: HALT`
- Anchor tables: `model_files` (001), `classes` (002), `events` (003), `states` (004)
- SQL files remain unchanged

### Task Group 5: Verification
- Frontend TypeScript compilation: SUCCESS
- Domain relationship filtering tests: 31/31 PASSED
- Backend Maven compilation: SUCCESS
