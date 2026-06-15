# Remove Legacy Migration Logic and Legacy Relationship Sections

## Overview

This specification removes all backward compatibility code for the legacy relationship types `business_user_processes` and `application_point_business_processes`. These relationships were superseded by the Business Point entity and are no longer needed.

---

## Current State Analysis

### Legacy Relationship Types

The codebase contains two legacy relationship types that were replaced by Business Points:

1. **`BusinessUserProcess`** - Direct link from Business User to Business Process
   - Replaced by: `BusinessUserBusinessPoint`
   - Old: `User → Process`
   - New: `User → BusinessPoint (which points to Process or Activity)`

2. **`ApplicationPointBusinessProcess`** - Direct link from Application Point to Business Process
   - Replaced by: `ApplicationPointBusinessPoint`
   - Old: `AppPoint → Process`
   - New: `AppPoint → BusinessPoint (which points to Process or Activity)`

### Files Containing Legacy Code

| File | Legacy References | Lines |
|------|-------------------|-------|
| `frontend/src/types/model.ts` | `BusinessUserProcess`, `ApplicationPointBusinessProcess` interfaces | 359-396 |
| `frontend/src/types/model.ts` | Legacy arrays in `MetaModelRelationships` | 869-871 |
| `frontend/src/utils/fileOperations.ts` | Migration functions and legacy interface definitions | 252-453 |
| `frontend/src/utils/paletteData.ts` | Legacy palette sections | 151-168 |
| `frontend/src/config/gridConfigs.ts` | Legacy grid configurations | TBD |
| `frontend/src/config/defaults.ts` | Legacy defaults | TBD |
| `frontend/src/utils/idGenerator.ts` | Legacy ID generation | TBD |
| `frontend/src/utils/validation.ts` | Legacy validation | TBD |
| `frontend/src/utils/rendering.ts` | Legacy rendering | TBD |
| `frontend/src/contexts/ArchitectureContext.tsx` | Legacy cascade delete handling | TBD |

---

## Specification

### 1. Remove Legacy Interfaces from model.ts

**File to modify:** `frontend/src/types/model.ts`

#### 1.1 Remove BusinessUserProcess Interface (lines 359-370)

**Remove:**
```typescript
// Legacy relationship - kept for backward compatibility and migration
// New code should use BusinessUserBusinessPoint instead
export interface BusinessUserProcess {
  id: string;
  business_user_id: string;
  business_process_id: string;
  description: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
}
```

#### 1.2 Remove ApplicationPointBusinessProcess Interface (lines 385-396)

**Remove:**
```typescript
// Legacy relationship - kept for backward compatibility and migration
// New code should use ApplicationPointBusinessPoint instead
export interface ApplicationPointBusinessProcess {
  id: string;
  application_point_id: string;
  business_process_id: string;
  description: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
}
```

#### 1.3 Remove Legacy Arrays from MetaModelRelationships (lines 869-871)

**Before:**
```typescript
export interface MetaModelRelationships {
  // Legacy relationship arrays (kept for backward compatibility and migration)
  business_user_processes: BusinessUserProcess[];
  application_point_business_processes: ApplicationPointBusinessProcess[];
  // New Business Point relationship arrays
  business_user_business_points: BusinessUserBusinessPoint[];
  ...
}
```

**After:**
```typescript
export interface MetaModelRelationships {
  // Business Point relationship arrays
  business_user_business_points: BusinessUserBusinessPoint[];
  application_point_business_points: ApplicationPointBusinessPoint[];
  // Other relationships
  logical_data_entity_relationships: LogicalDataEntityRelationship[];
  ...
}
```

---

### 2. Remove Migration Functions from fileOperations.ts

**File to modify:** `frontend/src/utils/fileOperations.ts`

#### 2.1 Remove Legacy Interface Definitions (lines 252-270)

**Remove:**
```typescript
interface LegacyBusinessUserProcess {
  id: string;
  business_user_id: string;
  business_process_id: string;
  description: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
}

interface LegacyApplicationPointBusinessProcess {
  id: string;
  application_point_id: string;
  business_process_id: string;
  description: string;
  tags: string;
  valid_from?: string;
  valid_to?: string;
}
```

#### 2.2 Remove Migration Functions (lines 272-393)

**Remove:**
- `migrateBusinessUserProcessesToBusinessPoints()` function
- `migrateApplicationPointBusinessProcessesToBusinessPoints()` function
- `migrateToBusinessPoints()` function

#### 2.3 Update buildModelFromData (lines 396-456)

**Remove from relationships initialization:**
```typescript
business_user_processes: getArrayOrDefault(relationships.business_user_processes) as ...,
application_point_business_processes: getArrayOrDefault(relationships.application_point_business_processes) as ...,
```

**Remove migration call at end:**
```typescript
// Remove this line
const migratedModel = migrateToBusinessPoints(initialModel);
return migratedModel;

// Replace with
return initialModel;
```

---

### 3. Remove Legacy Palette Sections from paletteData.ts

**File to modify:** `frontend/src/utils/paletteData.ts`

#### 3.1 Remove Legacy Palette Sections (lines 149-168)

**Remove:**
```typescript
// Legacy relationship types (deprecated, retained for backward compatibility)
// These will be migrated to the new Business Point types
{
  id: 'business_user_processes',
  label: 'User <-> Process (Legacy)',
  items: (metaModel.relationships.business_user_processes || []).map(r => ({
    id: r.id,
    name: r.id,
  })),
  type: 'relationship' as const,
},
{
  id: 'application_point_business_processes',
  label: 'App Point <-> Process (Legacy)',
  items: (metaModel.relationships.application_point_business_processes || []).map(r => ({
    id: r.id,
    name: r.id,
  })),
  type: 'relationship' as const,
},
```

---

### 4. Remove Legacy Grid Configs from gridConfigs.ts

**File to modify:** `frontend/src/config/gridConfigs.ts`

Remove grid configurations for:
- `business_user_processes`
- `application_point_business_processes`

---

### 5. Remove Legacy Defaults from defaults.ts

**File to modify:** `frontend/src/config/defaults.ts`

Remove any default values for:
- `business_user_processes`
- `application_point_business_processes`

---

### 6. Remove Legacy ID Generation from idGenerator.ts

**File to modify:** `frontend/src/utils/idGenerator.ts`

Remove ID generation logic for:
- `business_user_process`
- `application_point_business_process`

---

### 7. Remove Legacy Validation from validation.ts

**File to modify:** `frontend/src/utils/validation.ts`

Remove validation logic for:
- `business_user_processes` array
- `application_point_business_processes` array

---

### 8. Remove Legacy Rendering from rendering.ts

**File to modify:** `frontend/src/utils/rendering.ts`

Remove any rendering logic for legacy relationship types.

---

### 9. Remove Legacy Cascade Delete from ArchitectureContext.tsx

**File to modify:** `frontend/src/contexts/ArchitectureContext.tsx`

Remove cascade delete handling for:
- `business_user_processes`
- `application_point_business_processes`

---

### 10. Update Test Files

Many test files reference the legacy relationship arrays in their mock data or assertions. These need to be updated to either:
1. Remove the legacy arrays from mock data entirely, or
2. Update mock data to use the new Business Point relationship format

Key test files affected:
- `frontend/src/__tests__/business-point-migration.test.ts` (may be deleted entirely)
- Various integration tests that include mock model data

---

## Files Summary

| File | Action | Details |
|------|--------|---------|
| `frontend/src/types/model.ts` | Remove | Legacy interfaces and MetaModelRelationships arrays |
| `frontend/src/utils/fileOperations.ts` | Remove | Legacy interfaces, migration functions, update buildModelFromData |
| `frontend/src/utils/paletteData.ts` | Remove | Legacy palette sections (lines 149-168) |
| `frontend/src/config/gridConfigs.ts` | Remove | Legacy grid configurations |
| `frontend/src/config/defaults.ts` | Remove | Legacy default values |
| `frontend/src/utils/idGenerator.ts` | Remove | Legacy ID generation |
| `frontend/src/utils/validation.ts` | Remove | Legacy validation logic |
| `frontend/src/utils/rendering.ts` | Remove | Legacy rendering logic |
| `frontend/src/contexts/ArchitectureContext.tsx` | Remove | Legacy cascade delete handling |
| `frontend/src/__tests__/*.test.ts` | Update | Remove legacy arrays from mock data |

---

## Acceptance Criteria

1. **No legacy palette sections**
   - RHS palette does not show "User <-> Process (Legacy)"
   - RHS palette does not show "App Point <-> Process (Legacy)"

2. **No migration code**
   - `migrateToBusinessPoints()` function is removed
   - `migrateBusinessUserProcessesToBusinessPoints()` function is removed
   - `migrateApplicationPointBusinessProcessesToBusinessPoints()` function is removed

3. **No legacy type definitions**
   - `BusinessUserProcess` interface is removed from model.ts
   - `ApplicationPointBusinessProcess` interface is removed from model.ts
   - Legacy arrays are removed from `MetaModelRelationships`

4. **Application functions correctly**
   - Application loads without errors
   - Application saves without errors
   - Business Point relationships continue to work
   - No TypeScript compilation errors

5. **Tests pass**
   - All non-legacy tests pass
   - Legacy-specific test files are updated or removed

---

## Implementation Notes

1. **Order of removal**: Start with model.ts to get TypeScript errors that guide what else needs updating.

2. **Test file updates**: Many test files will need mock data updated. Focus on removing the legacy arrays from mock `MetaModelRelationships` objects.

3. **JSON file compatibility**: Existing JSON files with legacy relationship arrays will simply have those arrays ignored (not migrated). This is acceptable since migration is no longer needed.

4. **Business Point reconciliation**: The `reconcileBusinessPoints()` function should be kept as it ensures Business Points exist for all Processes and Activities. Only the migration of legacy relationships is removed.

---

## Risk Assessment

**Low Risk:**
- Removing unused interfaces and migration functions
- Removing palette sections for legacy relationships
- Removing grid configurations for legacy relationships

**Medium Risk:**
- Updating test files - need to ensure all tests still pass
- Removing validation/rendering logic - need to verify no side effects

**Testing Strategy:**
1. Run TypeScript compilation after each change to catch type errors
2. Run full test suite after all changes
3. Manual testing of load/save functionality
