Title: Align Logical Attribute "Data Type" Enum With OAS (OpenAPI) Primitive Types

Summary:
Logical Attributes currently use data types aligned with SQL database primitive types. Physical Attributes may continue using SQL-style types, but Logical Attributes must instead use OpenAPI (OAS) primitive data types so that logical models align with API schema definitions rather than database schema definitions. This change modifies only the allowed enum values for Logical Attributes' `dataType` field; Physical Attributes' enum values remain unchanged.

--------------------------------------------------------------------
1. Logical Attribute Data Type Enum – NEW OAS-Aligned Values

Update the Logical Attribute entity definition so that the `dataType` field uses the following OAS (OpenAPI) primitive types (and common format extensions):

Required OAS-compatible enum values:

STRING TYPES
- string
- string_uuid
- string_date
- string_date-time
- string_password
- string_byte
- string_binary

NUMBER TYPES
- number
- number_float
- number_double

INTEGER TYPES
- integer
- integer_int32
- integer_int64

BOOLEAN
- boolean

ARRAY & OBJECT
(These represent logical structures; details defined in nested schema if needed.)
- array
- object

NOTES:
1. These values reflect OAS `type` + `format` distinctions.
2. Tools may internally treat `string_uuid` as `{ type: "string", format: "uuid" }` etc., but the enum is stored as above.
3. This replaces all previous SQL-style logical types (e.g., varchar, int, decimal, timestamp, etc.).

--------------------------------------------------------------------
2. Physical Attribute Data Type Enum – UNCHANGED

Physical Attributes' `dataType` enum remains aligned with SQL database primitive types, e.g.:

- varchar
- char
- text
- int
- bigint
- decimal
- numeric
- float
- double
- boolean
- date
- datetime
- timestamp
- binary

(Exact list remains as currently implemented; no change in this spec.)

--------------------------------------------------------------------
3. UI / Meta-Model View Changes

3.1 Logical Attribute table (RHS meta-model)
- The `Data Type` column's dropdown/autocomplete must now show only the new OAS-aligned values defined in Section 1.
- SQL data type values must be removed from the Logical Attribute type selector.

3.2 Physical Attribute table
- No UI changes; SQL types remain.

--------------------------------------------------------------------
4. Diagram Rendering and Advanced Add (No Changes Required)

- ERD-style rendering of Logical Entities continues to show each attribute row.
- Attribute data type text should now reflect the new OAS-style type strings.
- No impact on wrapping, spacing, or layout.

--------------------------------------------------------------------
5. JSON Model Updates

Logical Attribute JSON objects must now store the updated dataType enum values, e.g.:

{
  "id": "la-21",
  "name": "createdDate",
  "dataType": "string_date-time",
  ...
}

Existing diagrams with SQL-style logical types:
- MUST remain loadable.
- On load, any legacy value should be either:
  a) mapped to the closest OAS type (recommended), OR
  b) preserved but marked invalid until user picks a valid OAS value.
Implementation may choose either option, but behaviour must be consistent.

--------------------------------------------------------------------
6. Acceptance Criteria

1. Logical Attribute "Data Type" dropdown contains **only** the OAS-aligned values specified in Section 1.
2. Physical Attribute "Data Type" dropdown remains unchanged and continues using SQL-style types.
3. Saving/loading logical attributes stores the new enum values in JSON.
4. Existing diagrams continue to load without crashes (mapping or validation behaviour implemented).
5. ERD-style entity rendering shows updated logical attribute types correctly.

This completes the specification for updating Logical Attribute data types to OAS-compliant primitives while preserving SQL types for Physical Attributes.
