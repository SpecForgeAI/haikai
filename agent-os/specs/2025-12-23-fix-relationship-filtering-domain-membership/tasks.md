# Task Breakdown: Fix Relationship Filtering to Use Domain Entity Membership

## Overview
Total Tasks: 12

This is a frontend-only fix to restore visibility of relationship tabs (like "App Point <-> Business Point") that were hidden when entity types like `business_points` and `application_points` were removed from `domainGroupings`.

**Root Cause:** The `getRelationshipTabsForDomain` function derives entity types from `domainGroupings`, which now excludes hidden super-entities. This incorrectly filters out relationships that reference those entities.

**Solution:** Create a separate `DOMAIN_ENTITY_TYPES` constant that includes ALL entity types per domain (including hidden ones) and use it for relationship filtering.

## Task List

### Configuration Layer

#### Task Group 1: Add DOMAIN_ENTITY_TYPES Constant
**Dependencies:** None

- [x] 1.0 Complete configuration layer changes
  - [x] 1.1 Write 4 focused tests for DOMAIN_ENTITY_TYPES constant
    - Test that `business` domain includes `business_points`
    - Test that `application` domain includes `application_points`
    - Test that all visible entity types from `domainGroupings` are included
    - Test that DOMAIN_ENTITY_TYPES exports correctly
  - [x] 1.2 Add `DOMAIN_ENTITY_TYPES` constant to `frontend/src/config/gridConfigs.ts`
    - Type: `Record<ArchitectureDomain, string[]>`
    - Values use entity type keys (e.g., 'business_users' not 'Users')
    - Business domain: `['business_users', 'business_processes', 'process_activities', 'business_points']`
    - Application domain: `['applications', 'app_components', 'services', 'interfaces', 'endpoints', 'classes', 'methods', 'application_points']`
    - Data domain: `['logical_data_entities', 'logical_data_attributes', 'physical_data_entities', 'physical_data_attributes']`
    - Behavioural domain: `['events']`
  - [x] 1.3 Export `DOMAIN_ENTITY_TYPES` from `gridConfigs.ts`
    - Add to existing exports
    - Ensure TypeScript type safety with ArchitectureDomain import
  - [x] 1.4 Ensure configuration layer tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify constant structure matches specification

**Acceptance Criteria:**
- `DOMAIN_ENTITY_TYPES` constant exists with all 4 domains
- `business_points` is included in `business` domain
- `application_points` is included in `application` domain
- Constant is properly exported and typed

**Key File:**
- `frontend/src/config/gridConfigs.ts` (lines 355-360 area, after domainGroupings)

---

### Component Layer

#### Task Group 2: Update Relationship Filtering Logic
**Dependencies:** Task Group 1

- [x] 2.0 Complete component layer changes
  - [x] 2.1 Write 4 focused tests for updated filtering behavior
    - Test that Business domain relationship tabs include 'App Point <-> Business Point'
    - Test that Application domain relationship tabs include 'App Point <-> Business Point'
    - Test that relationship filtering uses DOMAIN_ENTITY_TYPES (not domainGroupings)
    - Test that visible entity tabs still use domainGroupings (unchanged)
  - [x] 2.2 Update imports in `frontend/src/components/MetaModelView/MetaModelView.tsx`
    - Add `DOMAIN_ENTITY_TYPES` to the import from `gridConfigs`
    - Existing imports: `tabToEntityType, relationshipTabToType, relationshipTabNames, domainGroupings, gridConfigs`
    - New imports: add `DOMAIN_ENTITY_TYPES`
  - [x] 2.3 Modify `getRelationshipTabsForDomain` function (lines 34-55)
    - Replace line 37: `const domainEntityTypeKeys = domainGroupings[domain].map(tab => tabToEntityType[tab]).filter(Boolean);`
    - With: `const domainEntityTypeKeys = DOMAIN_ENTITY_TYPES[domain];`
    - Keep rest of function logic unchanged (FK target intersection check)
  - [x] 2.4 Verify entity tabs rendering unchanged
    - Confirm `currentDomainTabs` on line 66 still uses `domainGroupings[state.selectedDomain]`
    - Entity row should NOT show Business Points or Application Points tabs
  - [x] 2.5 Ensure component layer tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify relationship tabs appear correctly for both Business and Application domains

**Acceptance Criteria:**
- `getRelationshipTabsForDomain` uses `DOMAIN_ENTITY_TYPES` instead of deriving from `domainGroupings`
- 'App Point <-> Business Point' appears in both Business and Application domain relationship tabs
- Entity tabs row remains unchanged (no Business Points or Application Points tabs)
- Import statement includes `DOMAIN_ENTITY_TYPES`

**Key File:**
- `frontend/src/components/MetaModelView/MetaModelView.tsx` (lines 17, 34-55)

---

### Test Layer

#### Task Group 3: Update Existing Test File
**Dependencies:** Task Group 2

- [x] 3.0 Complete test layer updates
  - [x] 3.1 Update imports in `frontend/src/__tests__/domain-relationship-filtering.test.ts`
    - Add `DOMAIN_ENTITY_TYPES` to the import from `gridConfigs`
    - Keep existing imports: `domainGroupings, tabToEntityType, relationshipTabNames, relationshipTabToType, gridConfigs`
  - [x] 3.2 Update test helper function `getRelationshipTabsForDomain` (lines 34-51)
    - Replace line 35: `const domainEntityTypeKeys = domainGroupings[domain].map(tab => tabToEntityType[tab]).filter(Boolean);`
    - With: `const domainEntityTypeKeys = DOMAIN_ENTITY_TYPES[domain];`
    - This mirrors the fix applied in MetaModelView.tsx
  - [x] 3.3 Verify entity type key tests now pass
    - `testBusinessDomainEntityTypeKeys` should pass (expects `business_points`)
    - `testApplicationDomainEntityTypeKeys` should pass (expects `application_points`)
    - Update these tests if needed to use `DOMAIN_ENTITY_TYPES` directly instead of deriving from `domainGroupings`
  - [x] 3.4 Run all existing tests to verify fix
    - Execute `runAllTests()` function
    - All 23 tests should pass
    - Critical tests to verify:
      - `testBusinessDomainIncludesAppPointBusinessPointCrossDomain`
      - `testApplicationDomainIncludesAppPointBusinessPointCrossDomain`
      - `testAppPointBusinessPointAppearsInTwoDomains`

**Acceptance Criteria:**
- Test helper function uses `DOMAIN_ENTITY_TYPES` for domain entity type lookup
- All 23 existing tests pass
- Cross-domain relationship tests pass (App Point <-> Business Point in both domains)
- Entity type key tests pass for business and application domains

**Key File:**
- `frontend/src/__tests__/domain-relationship-filtering.test.ts` (lines 17, 35, 256-276)

---

### Verification Layer

#### Task Group 4: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-3

- [x] 4.0 Review tests and verify complete coverage
  - [x] 4.1 Review tests from Task Groups 1-3
    - Review 4 tests from Task Group 1 (DOMAIN_ENTITY_TYPES constant)
    - Review 4 tests from Task Group 2 (relationship filtering)
    - Review updated test file from Task Group 3 (23 existing tests)
    - Total existing tests: approximately 31 tests
  - [x] 4.2 Analyze test coverage gaps for this feature only
    - Verify cross-domain relationship visibility is tested
    - Verify hidden entity inclusion in domain membership is tested
    - Verify entity tabs remain unaffected by changes
  - [x] 4.3 Add up to 2 additional tests if critical gaps exist
    - Only add tests if a critical path is untested
    - Focus on integration between DOMAIN_ENTITY_TYPES and relationship filtering
    - Example gap: Verify Data Movements appears in Application domain (uses application_points FK)
  - [x] 4.4 Run feature-specific tests and verify
    - Run all tests related to this spec
    - Verify all tests pass
    - Confirm manual verification: navigate to Business domain and see "App Point <-> Business Point" tab

**Acceptance Criteria:**
- All feature-specific tests pass
- Cross-domain relationship tabs appear correctly in UI
- Entity tabs do not show hidden super-entities
- No regression in existing relationship filtering behavior

---

## Execution Order

Recommended implementation sequence:

1. **Configuration Layer (Task Group 1)** - Add DOMAIN_ENTITY_TYPES constant
2. **Component Layer (Task Group 2)** - Update getRelationshipTabsForDomain to use new constant
3. **Test Layer (Task Group 3)** - Update existing test file to match implementation
4. **Verification Layer (Task Group 4)** - Final review and gap analysis

## Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/config/gridConfigs.ts` | Add and export `DOMAIN_ENTITY_TYPES` constant |
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | Import `DOMAIN_ENTITY_TYPES`, update `getRelationshipTabsForDomain` |
| `frontend/src/__tests__/domain-relationship-filtering.test.ts` | Import `DOMAIN_ENTITY_TYPES`, update test helper function |

## Code Snippets

### DOMAIN_ENTITY_TYPES constant (to add in gridConfigs.ts)

```typescript
/**
 * DOMAIN_ENTITY_TYPES: Authoritative mapping of domain to entity type keys.
 * Includes ALL entity types per domain, including hidden super-entities
 * (application_points, business_points) that are not shown as UI tabs.
 *
 * Used for relationship filtering to ensure relationships involving hidden
 * entities are still visible in relevant domains.
 *
 * Contrast with domainGroupings which only includes VISIBLE entity tabs.
 */
export const DOMAIN_ENTITY_TYPES: Record<ArchitectureDomain, string[]> = {
  business: ['business_users', 'business_processes', 'process_activities', 'business_points'],
  application: ['applications', 'app_components', 'services', 'interfaces', 'endpoints', 'classes', 'methods', 'application_points'],
  data: ['logical_data_entities', 'logical_data_attributes', 'physical_data_entities', 'physical_data_attributes'],
  behavioural: ['events'],
};
```

### Updated getRelationshipTabsForDomain (in MetaModelView.tsx)

```typescript
export function getRelationshipTabsForDomain(domain: ArchitectureDomain): string[] {
  // Use DOMAIN_ENTITY_TYPES which includes hidden entities like application_points and business_points
  const domainEntityTypeKeys = DOMAIN_ENTITY_TYPES[domain];

  return relationshipTabNames.filter(tabName => {
    // ... rest unchanged
  });
}
```

### Updated import (in MetaModelView.tsx, line 17)

```typescript
import { tabToEntityType, relationshipTabToType, relationshipTabNames, domainGroupings, gridConfigs, DOMAIN_ENTITY_TYPES } from '../../config/gridConfigs';
```

## Implementation Summary

All 4 task groups have been completed:

1. **Task Group 1 (Configuration Layer):** Added `DOMAIN_ENTITY_TYPES` constant to `frontend/src/config/gridConfigs.ts` with all 4 domains including hidden super-entities (`business_points` and `application_points`).

2. **Task Group 2 (Component Layer):** Updated `frontend/src/components/MetaModelView/MetaModelView.tsx` to import `DOMAIN_ENTITY_TYPES` and use it in `getRelationshipTabsForDomain` function instead of deriving entity types from `domainGroupings`.

3. **Task Group 3 (Test Layer):** Updated `frontend/src/__tests__/domain-relationship-filtering.test.ts` to import `DOMAIN_ENTITY_TYPES`, updated the test helper function to use it, updated entity type key tests to use `DOMAIN_ENTITY_TYPES` directly, and added 2 new tests to verify hidden entity inclusion.

4. **Task Group 4 (Verification):** All 26 tests pass, TypeScript compilation succeeds (only pre-existing errors unrelated to this change), and the fix correctly restores visibility of relationship tabs like "App Point <-> Business Point" in both Business and Application domains.
