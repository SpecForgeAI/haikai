Title: Remove Legacy Migration Logic and Legacy Relationship Sections

Summary:
Backward compatibility with the old "legacy" relationships is no longer required. We want to:

1. Remove all migration scripts / code paths that handle legacy relationship data.
2. Remove the two RHS panel sections: "User <-> Process (Legacy)", "App Point <-> Process (Legacy)"
3. Stop considering these legacy constructs in any future design decisions.

--------------------------------------------------------------------
Background

The codebase contains legacy relationship types that were superseded by the Business Point entity:

- `BusinessUserProcess` - Old direct relationship between Business Users and Business Processes
- `ApplicationPointBusinessProcess` - Old direct relationship between Application Points and Business Processes

These were migrated to use Business Points as intermediaries:
- Business User → Business Point → Business Process
- Application Point → Business Point → Business Process

The migration logic and UI sections for the legacy relationships are no longer needed.

--------------------------------------------------------------------
Files to Clean Up

1. **Model Types** (`frontend/src/types/model.ts`)
   - Remove `BusinessUserProcess` interface (lines ~359-369)
   - Remove `ApplicationPointBusinessProcess` interface (lines ~381-396)
   - Remove arrays from `MetaModelRelationships`: `business_user_processes`, `application_point_business_processes`

2. **Migration Functions** (`frontend/src/utils/fileOperations.ts`)
   - Remove `migrateBusinessUserProcessesToBusinessPoints()` function
   - Remove `migrateApplicationPointBusinessProcessesToBusinessPoints()` function
   - Remove `migrateToBusinessPoints()` function
   - Remove `reconcileBusinessPointsWithDiagram()` function (if legacy-only)
   - Clean up `buildModelFromData()` to remove legacy migration calls

3. **Palette Data** (`frontend/src/utils/paletteData.ts`)
   - Remove "User <-> Process (Legacy)" section (lines ~152-157)
   - Remove "App Point <-> Process (Legacy)" section (lines ~160-167)

4. **Grid Configs** (`frontend/src/config/gridConfigs.ts`)
   - Remove `business_user_processes` grid config
   - Remove `application_point_business_processes` grid config

5. **Defaults** (`frontend/src/config/defaults.ts`)
   - Remove any legacy relationship defaults if present

6. **ID Generator** (`frontend/src/utils/idGenerator.ts`)
   - Remove ID generation for legacy relationship types

7. **Validation** (`frontend/src/utils/validation.ts`)
   - Remove validation for legacy relationship types

8. **Rendering** (`frontend/src/utils/rendering.ts`)
   - Remove any legacy relationship rendering logic

9. **Context** (`frontend/src/contexts/ArchitectureContext.tsx`)
   - Remove cascade delete handling for legacy relationships

--------------------------------------------------------------------
Acceptance Criteria

1. No "User <-> Process (Legacy)" section in RHS palette
2. No "App Point <-> Process (Legacy)" section in RHS palette
3. No migration functions for legacy relationships
4. No legacy relationship interfaces in model.ts
5. Application loads and saves without errors
6. Existing Business Point relationships continue to work
7. No TypeScript compilation errors
8. All existing tests pass (those not related to legacy features)
