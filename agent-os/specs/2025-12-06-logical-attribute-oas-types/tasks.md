# Task Breakdown: Align Logical Attribute Data Type Enum With OAS (OpenAPI) Primitive Types

## Overview
Total Tasks: 18 sub-tasks across 4 task groups

This feature updates Logical Attribute `data_type` to use OpenAPI (OAS) primitive types while keeping Physical Attribute data types aligned with SQL database types.

## Task List

### Type and Configuration Layer

#### Task Group 1: Define OAS and SQL Data Type Options
**Dependencies:** None

- [x] 1.0 Complete data type option definitions
  - [x] 1.1 Write 5-6 focused tests for data type options
    - Test OAS_DATA_TYPE_OPTIONS contains all 16 OAS types
    - Test SQL_DATA_TYPE_OPTIONS contains all SQL types
    - Test OAS options include string, number, integer, boolean categories
    - Test SQL options include VARCHAR, INTEGER, DECIMAL, TIMESTAMP
    - Test OASDataType type accepts valid OAS values
    - Test SQLDataType type accepts valid SQL values
    - **Test file:** `frontend/src/__tests__/data-type-options.test.ts`
  - [x] 1.2 Add OAS_DATA_TYPE_OPTIONS array to defaults.ts
    - Location: `frontend/src/config/defaults.ts`
    - Add array with 16 OAS types as const
    - Add JSDoc comment explaining OAS format convention
  - [x] 1.3 Add SQL_DATA_TYPE_OPTIONS array to defaults.ts
    - Rename/extend existing dataTypeOptions
    - Add additional SQL types (CHAR, TEXT, BIGINT, etc.)
    - Deprecate old `dataTypeOptions` name
  - [x] 1.4 Add OASDataType and SQLDataType to model.ts
    - Location: `frontend/src/types/model.ts`
    - Define union types for type safety
  - [x] 1.5 Ensure Task Group 1 tests pass
    - Run: `cd frontend && npm test -- data-type-options.test.ts`

**Acceptance Criteria:**
- OAS_DATA_TYPE_OPTIONS array exists with 16 values
- SQL_DATA_TYPE_OPTIONS array exists with SQL types
- TypeScript types defined for validation

**Files to modify:**
- `frontend/src/config/defaults.ts`
- `frontend/src/types/model.ts`
- `frontend/src/__tests__/data-type-options.test.ts` (new)

---

### Grid Configuration Layer

#### Task Group 2: Update Grid Configuration for Separate Type Options
**Dependencies:** Task Group 1

- [x] 2.0 Complete grid configuration updates
  - [x] 2.1 Write 4-5 focused tests for grid configuration
    - Test logical_data_attributes config uses OAS_DATA_TYPE_OPTIONS
    - Test physical_data_attributes config uses SQL_DATA_TYPE_OPTIONS
    - Test logical data_type column has correct options
    - Test physical data_type column has correct options
    - Test column width is appropriate for longer OAS type names
    - **Test file:** `frontend/src/__tests__/data-type-grid-config.test.ts`
  - [x] 2.2 Update gridConfigs.ts imports
    - Import OAS_DATA_TYPE_OPTIONS and SQL_DATA_TYPE_OPTIONS from defaults.ts
    - Remove import of deprecated dataTypeOptions
  - [x] 2.3 Update logical_data_attributes grid config
    - Change options to use OAS_DATA_TYPE_OPTIONS
    - Increase width from 100 to 120 for longer type names
  - [x] 2.4 Update physical_data_attributes grid config
    - Change options to use SQL_DATA_TYPE_OPTIONS explicitly
    - Keep width at 100 (SQL types are shorter)
  - [x] 2.5 Ensure Task Group 2 tests pass
    - Run: `cd frontend && npm test -- data-type-grid-config.test.ts`

**Acceptance Criteria:**
- Logical Attribute dropdown shows OAS types
- Physical Attribute dropdown shows SQL types
- Grid displays correctly with new options

**Files to modify:**
- `frontend/src/config/gridConfigs.ts`
- `frontend/src/__tests__/data-type-grid-config.test.ts` (new)

---

### Migration Layer

#### Task Group 3: Implement Legacy Data Type Migration
**Dependencies:** Task Groups 1-2

- [x] 3.0 Complete migration utility implementation
  - [x] 3.1 Write 6-7 focused tests for migration
    - Test VARCHAR maps to string
    - Test INTEGER maps to integer
    - Test TIMESTAMP maps to string_date-time
    - Test DECIMAL maps to number
    - Test already-valid OAS type is preserved
    - Test unknown type is preserved as-is
    - Test empty/null values remain unchanged
    - **Test file:** `frontend/src/__tests__/data-type-migration.test.ts`
  - [x] 3.2 Create dataTypeMigration.ts utility file
    - Location: `frontend/src/utils/dataTypeMigration.ts`
    - Export SQL_TO_OAS_MAPPING constant
  - [x] 3.3 Implement migrateDataType function
    - Accept string or undefined
    - Normalize to uppercase for matching
    - Return mapped value or original if no match
  - [x] 3.4 Implement isValidOASDataType function
    - Accept string
    - Return true if value is in OAS_DATA_TYPE_OPTIONS
  - [x] 3.5 Apply migration in ArchitectureContext.tsx
    - Location: `frontend/src/contexts/ArchitectureContext.tsx`
    - Import migrateDataType function
    - Apply to logical_data_attributes on load
    - Do NOT apply to physical_data_attributes
  - [x] 3.6 Ensure Task Group 3 tests pass
    - Run: `cd frontend && npm test -- data-type-migration.test.ts`

**Acceptance Criteria:**
- Legacy SQL types are converted to OAS on load
- Physical Attributes remain unchanged
- Unknown types are preserved

**Files to modify:**
- `frontend/src/utils/dataTypeMigration.ts` (new)
- `frontend/src/contexts/ArchitectureContext.tsx`
- `frontend/src/__tests__/data-type-migration.test.ts` (new)

---

### Integration and Verification Layer

#### Task Group 4: Integration Testing and ERD Rendering
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete integration verification
  - [x] 4.1 Write 5-6 focused integration tests
    - Test creating Logical Attribute with OAS type
    - Test creating Physical Attribute with SQL type
    - Test save/load cycle preserves OAS types
    - Test ERD rendering displays OAS type correctly
    - Test dropdown shows correct options per entity type
    - Test migration on load of legacy diagram
    - **Test file:** `frontend/src/__tests__/data-type-integration.test.ts`
  - [x] 4.2 Verify ERD rendering with OAS types
    - Ensure formatAttribute displays OAS types correctly
    - Test with various type lengths (e.g., string_date-time)
  - [x] 4.3 Verify ERD node sizing
    - Check if calculateERDNodeSize handles longer type names
    - Adjust ERD_MIN_WIDTH if needed (150 → 180)
  - [x] 4.4 Verify dropdown UI functionality
    - Test dropdown renders all OAS options for Logical Attributes
    - Test dropdown renders all SQL options for Physical Attributes
    - Test selecting option updates data_type field
  - [x] 4.5 Ensure Task Group 4 tests pass
    - Run: `cd frontend && npm test -- data-type-integration.test.ts`

**Acceptance Criteria:**
- Full create → save → load cycle works with OAS types
- ERD rendering displays types correctly
- Dropdowns show correct options per entity type

**Files to modify:**
- `frontend/src/utils/erdUtils.ts` (optional width adjustment)
- `frontend/src/__tests__/data-type-integration.test.ts` (new)

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1: Type Options** - Define OAS and SQL data type arrays
2. **Task Group 2: Grid Config** - Update grid to use separate options
3. **Task Group 3: Migration** - Add backward compatibility for legacy data
4. **Task Group 4: Integration** - Verify end-to-end functionality

## Files Summary

| File | Changes |
|------|---------|
| `frontend/src/config/defaults.ts` | Add OAS_DATA_TYPE_OPTIONS, SQL_DATA_TYPE_OPTIONS |
| `frontend/src/types/model.ts` | Add OASDataType, SQLDataType types |
| `frontend/src/config/gridConfigs.ts` | Update options per entity type |
| `frontend/src/utils/dataTypeMigration.ts` | New file: migration utilities |
| `frontend/src/contexts/ArchitectureContext.tsx` | Apply migration on load |
| `frontend/src/utils/erdUtils.ts` | Optional: adjust min width |

**New Test Files:**
| File | Purpose |
|------|---------|
| `frontend/src/__tests__/data-type-options.test.ts` | Type option array tests |
| `frontend/src/__tests__/data-type-grid-config.test.ts` | Grid configuration tests |
| `frontend/src/__tests__/data-type-migration.test.ts` | Migration function tests |
| `frontend/src/__tests__/data-type-integration.test.ts` | End-to-end integration tests |

## Key Implementation Notes

1. **OAS Type Format**: Types use underscore to combine base type and format (e.g., `string_uuid` = `{ type: "string", format: "uuid" }`).

2. **Migration Mapping**:
   ```
   VARCHAR/CHAR/TEXT → string
   INTEGER/INT → integer
   BIGINT → integer_int64
   DECIMAL/NUMERIC → number
   FLOAT → number_float
   DOUBLE → number_double
   DATE → string_date
   TIMESTAMP/DATETIME → string_date-time
   BINARY/BLOB → string_binary
   JSON → object
   BOOLEAN → boolean
   ```

3. **Case Handling**: Migration normalizes input to uppercase for matching, returns lowercase OAS values.

4. **Physical Attributes Unchanged**: Migration only applies to logical_data_attributes, not physical_data_attributes.

5. **Column Width**: Logical data_type column increased to 120px to accommodate longer OAS type names.

## Test Count Summary

| Task Group | Test Count | Focus Area |
|------------|------------|------------|
| TG1: Type Options | 18 tests | Array definitions, TypeScript types |
| TG2: Grid Config | 15 tests | Column options, width |
| TG3: Migration | 31 tests | SQL→OAS mapping, edge cases |
| TG4: Integration | 15 tests | End-to-end, ERD, dropdowns |
| **Total** | **79 tests** | Full feature coverage |

## Implementation Status

All 4 task groups have been successfully implemented:

- **Task Group 1**: Added OAS_DATA_TYPE_OPTIONS (16 types) and SQL_DATA_TYPE_OPTIONS (16 types) to defaults.ts. Added OASDataType and SQLDataType type definitions to model.ts.
- **Task Group 2**: Updated gridConfigs.ts to use OAS_DATA_TYPE_OPTIONS for logical_data_attributes and SQL_DATA_TYPE_OPTIONS for physical_data_attributes. Increased logical attribute column width to 130px.
- **Task Group 3**: Created dataTypeMigration.ts with SQL_TO_OAS_MAPPING, migrateDataType(), isValidOASDataType(), and migrateLogicalAttributes(). Applied migration on LOAD_MODEL in ArchitectureContext.tsx.
- **Task Group 4**: All integration tests pass, verifying the complete feature functionality including ERD rendering and backward compatibility.

All 79 tests pass.

## OAS Data Type Reference

| Enum Value | OAS type | OAS format | Example Use Case |
|------------|----------|------------|------------------|
| `string` | string | - | Generic text |
| `string_uuid` | string | uuid | Primary keys, IDs |
| `string_date` | string | date | Birth date, due date |
| `string_date-time` | string | date-time | Created/updated timestamps |
| `string_password` | string | password | Passwords (masked) |
| `string_byte` | string | byte | Base64 encoded data |
| `string_binary` | string | binary | File uploads |
| `number` | number | - | Generic decimal |
| `number_float` | number | float | 32-bit precision |
| `number_double` | number | double | 64-bit precision |
| `integer` | integer | - | Generic integer |
| `integer_int32` | integer | int32 | 32-bit integer |
| `integer_int64` | integer | int64 | Large IDs, counts |
| `boolean` | boolean | - | True/false flags |
| `array` | array | - | Lists, collections |
| `object` | object | - | Nested structures |
