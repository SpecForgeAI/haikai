# Align Logical Attribute Data Type Enum With OAS (OpenAPI) Primitive Types

## Overview

This specification updates the Logical Attribute `data_type` field to use OpenAPI (OAS) primitive types instead of SQL-style types. This aligns logical data models with API schema definitions, making them more suitable for API-first design and code generation.

**Key changes:**
1. Define new `OAS_DATA_TYPE_OPTIONS` array for Logical Attributes
2. Keep existing `SQL_DATA_TYPE_OPTIONS` for Physical Attributes
3. Update grid configuration to use appropriate options per entity type
4. Handle backward compatibility for existing diagrams

---

## Current State Analysis

### Existing Implementation

1. **Data Type Options** (`config/defaults.ts:516`):
   ```typescript
   export const dataTypeOptions = [
     'VARCHAR', 'INTEGER', 'DECIMAL', 'BOOLEAN',
     'TIMESTAMP', 'DATE', 'BLOB', 'JSON'
   ];
   ```
   - Single array used for **both** Logical and Physical Attributes
   - SQL-style naming conventions

2. **Grid Configuration** (`config/gridConfigs.ts:119-128`):
   ```typescript
   logical_data_attributes: [
     // ...
     { field: 'data_type', displayName: 'Data Type', cellType: 'dropdown',
       required: false, width: 100, options: dataTypeOptions },
   ],
   physical_data_attributes: [
     // ...
     { field: 'data_type', displayName: 'Data Type', cellType: 'dropdown',
       required: false, width: 100, options: dataTypeOptions },
   ],
   ```
   - Both use the same `dataTypeOptions` array

3. **Type Definition** (`types/model.ts`):
   ```typescript
   export interface LogicalDataAttribute {
     // ...
     data_type: string;  // No enum constraint
   }
   ```
   - Field is a plain string, no TypeScript enum

4. **ERD Rendering** (`utils/erdUtils.ts`):
   ```typescript
   export function formatAttribute(attr: { name: string; data_type?: string }): string {
     if (attr.data_type && attr.data_type.trim() !== '') {
       return `${attr.name} : ${attr.data_type}`;
     }
     return attr.name;
   }
   ```
   - Displays as "name : type" format

### Current Gaps

1. No distinction between Logical and Physical Attribute data types
2. SQL-style types not suitable for API schema definitions
3. No TypeScript type safety for data_type values
4. No migration path for existing data

---

## Specification

### 1. Define OAS Data Type Options

**Location**: `frontend/src/config/defaults.ts`

Add new array for OAS-aligned types:

```typescript
/**
 * OAS (OpenAPI) primitive types for Logical Attributes.
 * Format: type or type_format (e.g., string_uuid = { type: "string", format: "uuid" })
 */
export const OAS_DATA_TYPE_OPTIONS = [
  // String types
  'string',
  'string_uuid',
  'string_date',
  'string_date-time',
  'string_password',
  'string_byte',
  'string_binary',
  // Number types
  'number',
  'number_float',
  'number_double',
  // Integer types
  'integer',
  'integer_int32',
  'integer_int64',
  // Boolean
  'boolean',
  // Complex types
  'array',
  'object',
] as const;

/**
 * SQL primitive types for Physical Attributes.
 * Retained for database schema alignment.
 */
export const SQL_DATA_TYPE_OPTIONS = [
  'VARCHAR',
  'CHAR',
  'TEXT',
  'INTEGER',
  'BIGINT',
  'DECIMAL',
  'NUMERIC',
  'FLOAT',
  'DOUBLE',
  'BOOLEAN',
  'DATE',
  'DATETIME',
  'TIMESTAMP',
  'BINARY',
  'BLOB',
  'JSON',
] as const;

// Deprecate old name, keep for compatibility
/** @deprecated Use OAS_DATA_TYPE_OPTIONS or SQL_DATA_TYPE_OPTIONS */
export const dataTypeOptions = SQL_DATA_TYPE_OPTIONS;
```

---

### 2. Add TypeScript Types for Data Types

**Location**: `frontend/src/types/model.ts`

Add type definitions:

```typescript
/** OAS-aligned data types for Logical Attributes */
export type OASDataType =
  | 'string' | 'string_uuid' | 'string_date' | 'string_date-time'
  | 'string_password' | 'string_byte' | 'string_binary'
  | 'number' | 'number_float' | 'number_double'
  | 'integer' | 'integer_int32' | 'integer_int64'
  | 'boolean' | 'array' | 'object';

/** SQL-aligned data types for Physical Attributes */
export type SQLDataType =
  | 'VARCHAR' | 'CHAR' | 'TEXT'
  | 'INTEGER' | 'BIGINT' | 'DECIMAL' | 'NUMERIC' | 'FLOAT' | 'DOUBLE'
  | 'BOOLEAN' | 'DATE' | 'DATETIME' | 'TIMESTAMP'
  | 'BINARY' | 'BLOB' | 'JSON';
```

Note: The interface fields remain `data_type: string` for backward compatibility, but these types can be used for validation.

---

### 3. Update Grid Configuration

**Location**: `frontend/src/config/gridConfigs.ts`

Import and use separate options:

```typescript
import { OAS_DATA_TYPE_OPTIONS, SQL_DATA_TYPE_OPTIONS } from './defaults';

// In gridConfigs object:
logical_data_attributes: [
  { field: 'id', ... },
  { field: 'name', ... },
  { field: 'description', ... },
  { field: 'logical_entity_id', ... },
  { field: 'data_type', displayName: 'Data Type', cellType: 'dropdown',
    required: false, width: 120, options: [...OAS_DATA_TYPE_OPTIONS] },  // CHANGED
  { field: 'is_primary_key', ... },
  { field: 'is_nullable', ... },
  { field: 'tags', ... },
],

physical_data_attributes: [
  { field: 'id', ... },
  { field: 'name', ... },
  { field: 'description', ... },
  { field: 'physical_entity_id', ... },
  { field: 'data_type', displayName: 'Data Type', cellType: 'dropdown',
    required: false, width: 100, options: [...SQL_DATA_TYPE_OPTIONS] },  // EXPLICIT
  { field: 'is_primary_key', ... },
  { field: 'is_nullable', ... },
  { field: 'tags', ... },
],
```

Increase width for logical attributes to accommodate longer OAS type names.

---

### 4. Legacy Data Type Mapping

**Location**: `frontend/src/utils/dataTypeMigration.ts` (new file)

Create migration utility for backward compatibility:

```typescript
/**
 * Maps legacy SQL-style data types to OAS equivalents.
 * Used when loading existing diagrams with old type values.
 */
export const SQL_TO_OAS_MAPPING: Record<string, string> = {
  'VARCHAR': 'string',
  'CHAR': 'string',
  'TEXT': 'string',
  'INTEGER': 'integer',
  'INT': 'integer',
  'BIGINT': 'integer_int64',
  'DECIMAL': 'number',
  'NUMERIC': 'number',
  'FLOAT': 'number_float',
  'DOUBLE': 'number_double',
  'BOOLEAN': 'boolean',
  'DATE': 'string_date',
  'DATETIME': 'string_date-time',
  'TIMESTAMP': 'string_date-time',
  'BINARY': 'string_binary',
  'BLOB': 'string_binary',
  'JSON': 'object',
};

/**
 * Migrates a legacy data type to OAS format.
 * Returns the original value if no mapping exists (may be already OAS format).
 */
export function migrateDataType(legacyType: string | undefined): string | undefined {
  if (!legacyType) return legacyType;

  const normalized = legacyType.toUpperCase();
  return SQL_TO_OAS_MAPPING[normalized] ?? legacyType;
}

/**
 * Checks if a data type is a valid OAS type.
 */
export function isValidOASDataType(type: string): boolean {
  return OAS_DATA_TYPE_OPTIONS.includes(type as any);
}
```

---

### 5. Apply Migration on Load

**Location**: `frontend/src/contexts/ArchitectureContext.tsx`

Apply migration when loading meta model:

```typescript
import { migrateDataType } from '../utils/dataTypeMigration';

// In loadFromJSON or similar load function:
const migratedLogicalAttributes = data.logical_data_attributes?.map(attr => ({
  ...attr,
  data_type: migrateDataType(attr.data_type) ?? '',
})) ?? [];
```

This ensures existing diagrams with SQL-style types are automatically converted to OAS types on load.

---

### 6. Update ERD Display Width

**Location**: `frontend/src/utils/erdUtils.ts`

The `formatAttribute` function needs no changes - it already handles any string value. However, `calculateERDNodeSize` may need adjustment for longer type names:

```typescript
// OAS types like "string_date-time" are longer than "VARCHAR"
// Ensure minimum width accommodates these
const ERD_MIN_WIDTH = 180;  // Increase from 150 if needed
```

---

### 7. Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/config/defaults.ts` | Add `OAS_DATA_TYPE_OPTIONS`, `SQL_DATA_TYPE_OPTIONS`, deprecate `dataTypeOptions` |
| `frontend/src/types/model.ts` | Add `OASDataType` and `SQLDataType` type definitions |
| `frontend/src/config/gridConfigs.ts` | Update imports, use separate options for logical vs physical |
| `frontend/src/utils/dataTypeMigration.ts` | New file: migration mapping and utilities |
| `frontend/src/contexts/ArchitectureContext.tsx` | Apply migration on load |
| `frontend/src/utils/erdUtils.ts` | Optional: adjust minimum width for ERD nodes |

---

### 8. OAS Type Reference

The new data types follow OpenAPI 3.0 specification:

| Enum Value | OAS type | OAS format | Description |
|------------|----------|------------|-------------|
| `string` | string | - | Generic string |
| `string_uuid` | string | uuid | UUID/GUID |
| `string_date` | string | date | ISO 8601 date (YYYY-MM-DD) |
| `string_date-time` | string | date-time | ISO 8601 datetime |
| `string_password` | string | password | Sensitive string (masked in UI) |
| `string_byte` | string | byte | Base64-encoded binary |
| `string_binary` | string | binary | Raw binary data |
| `number` | number | - | Generic number |
| `number_float` | number | float | 32-bit float |
| `number_double` | number | double | 64-bit double |
| `integer` | integer | - | Generic integer |
| `integer_int32` | integer | int32 | 32-bit signed integer |
| `integer_int64` | integer | int64 | 64-bit signed integer |
| `boolean` | boolean | - | True/false |
| `array` | array | - | Ordered list (items defined elsewhere) |
| `object` | object | - | Key-value structure (properties defined elsewhere) |

---

### 9. Acceptance Criteria

1. **Logical Attribute dropdown shows OAS types only**
   - Open meta-model view
   - Edit a Logical Data Attribute
   - "Data Type" dropdown shows: string, string_uuid, string_date, etc.
   - No SQL-style types (VARCHAR, INTEGER, etc.)

2. **Physical Attribute dropdown shows SQL types**
   - Edit a Physical Data Attribute
   - "Data Type" dropdown shows: VARCHAR, INTEGER, DECIMAL, etc.
   - No OAS-style types

3. **Backward compatibility**
   - Load existing diagram with Logical Attribute having `data_type: "VARCHAR"`
   - Attribute loads successfully with `data_type: "string"` (migrated)
   - No errors or crashes

4. **ERD rendering shows new types**
   - Add Logical Entity with attributes using ERD style
   - Attribute rows display: `createdAt : string_date-time`

5. **Save/Load preserves OAS types**
   - Create Logical Attribute with `data_type: "string_uuid"`
   - Save diagram
   - Reload diagram
   - Attribute shows `string_uuid` in dropdown and ERD rendering

6. **Type safety (optional)**
   - TypeScript compilation succeeds
   - `OASDataType` and `SQLDataType` types available for validation

---

### 10. Visual Reference

#### Logical Attribute Grid (Before)
| Name | Data Type |
|------|-----------|
| id | VARCHAR |
| created_at | TIMESTAMP |

#### Logical Attribute Grid (After)
| Name | Data Type |
|------|-----------|
| id | string_uuid |
| created_at | string_date-time |

#### Physical Attribute Grid (Unchanged)
| Name | Data Type |
|------|-----------|
| id | VARCHAR(36) |
| created_at | TIMESTAMP |

---

### 11. Implementation Notes

1. **Migration is one-way**: SQL types are mapped to OAS types on load, but there's no reverse mapping needed since Physical Attributes remain unchanged.

2. **Unknown types preserved**: If a data_type value doesn't match any known SQL type, it's preserved as-is. This handles cases where OAS types are already in use.

3. **Case sensitivity**: Migration normalizes to uppercase for matching but returns lowercase OAS values.

4. **Empty values**: Empty or null data_type values remain empty - no default is applied.

5. **Grid width**: Logical attribute grid column may need width increase to display longer type names like `string_date-time`.

---

### 12. Summary

This specification:

1. **Defines OAS-aligned data types** for Logical Attributes (16 types)
2. **Preserves SQL-style types** for Physical Attributes
3. **Updates grid configuration** to use appropriate options per entity type
4. **Provides backward compatibility** via automatic migration on load
5. **Adds TypeScript types** for validation

The change aligns Logical Data Models with API-first design principles while maintaining database alignment for Physical Data Models.
