# Spec Requirements: Add "Frequency" Enum Attribute to Process Activities

## Initial Description

Extend the Process Activity meta-model to include a new enum attribute `Frequency`. Update the underlying JSON/data model and all relevant UI so that the Activity table displays this new field as a dedicated column, positioned between the existing columns `Description` and `Sequence Order`.

## Context / Current Behaviour

Process Activities currently have the following attributes:
- `id` - Unique identifier
- `business_process_id` - Parent Business Process reference
- `name` - Activity name
- `description` - Activity description
- `sequence_order` - Order within the parent Business Process
- `actor_hint` - Indicates the type of actor (END_USER, SYSTEM, etc.)
- `user_interaction_level` - Level of user interaction (AUTOMATED, MINIMAL, MODERATE, SIGNIFICANT)
- `tags` - Array of tags
- `valid_from` / `valid_to` - Validity period

There is currently no attribute to capture how frequently a Process Activity is performed.

## Desired Behaviour

### Section 1: Meta-model Changes

**Add new field to ProcessActivity interface:**
- Field name: `frequency`
- Type: Enum (string literal union)
- Allowed values (case-sensitive):
  - `CONTINUOUSLY`
  - `DAILY`
  - `WEEKLY`
  - `MONTHLY`
  - `QUARTERLY`
  - `SEMI-ANNUALLY`
  - `ANNUALLY`
  - `ADHOC`
  - `OTHER`

**File to update:**
- `frontend/src/types/model.ts` - Update `ProcessActivity` interface

**New type definition:**
```typescript
export type ProcessActivityFrequency =
  | 'CONTINUOUSLY'
  | 'DAILY'
  | 'WEEKLY'
  | 'MONTHLY'
  | 'QUARTERLY'
  | 'SEMI-ANNUALLY'
  | 'ANNUALLY'
  | 'ADHOC'
  | 'OTHER';
```

**Updated ProcessActivity interface:**
```typescript
interface ProcessActivity {
  // ... existing fields ...
  frequency?: ProcessActivityFrequency;
}
```

**Rules:**
- `frequency` is optional - may be null/undefined or omitted
- No default value required - if not set, displays as empty in UI

### Section 2: JSON/Data Model Changes

**JSON representation:**
All JSON representations of Process Activities must support the `frequency` field.

Example:
```json
{
  "id": "pa-123",
  "name": "Moderate User Interaction Activity",
  "description": "Handles medium complexity user interactions",
  "frequency": "DAILY",
  "sequence_order": 3,
  "user_interaction_level": "MODERATE"
}
```

**Backward compatibility:**
- Omitting `frequency` MUST NOT cause errors
- Records created before this change must continue to load correctly
- When loading old JSON without `frequency`, the field should be undefined

**Files likely involved:**
- `frontend/src/utils/fileOperations.ts` - File loading/saving utilities
- `frontend/src/utils/validation.ts` - Validation rules

### Section 3: Activity Table UI Changes

**Column placement:**
The Activity table columns must follow this order:
1. (Existing columns before Description – unchanged)
2. `Description`
3. **`Frequency`** (new column)
4. `Sequence Order`
5. (Remaining columns – unchanged)

**Column configuration:**
- Header: "Frequency"
- Control type: Dropdown/select
- Options (display label -> internal value):
  - "Continuously" -> `CONTINUOUSLY`
  - "Daily" -> `DAILY`
  - "Weekly" -> `WEEKLY`
  - "Monthly" -> `MONTHLY`
  - "Quarterly" -> `QUARTERLY`
  - "Semi-Annually" -> `SEMI-ANNUALLY`
  - "Annually" -> `ANNUALLY`
  - "Ad Hoc" -> `ADHOC`
  - "Other" -> `OTHER`
  - (Empty option for null/undefined)

**Display and editing:**
- Each row displays its Process Activity's `frequency` value
- Use a dropdown/select limited to the enum values
- If not set, show empty/placeholder ("–") consistent with existing UI patterns
- Changes are saved via existing UPDATE_ENTITY dispatch mechanism

**Files likely involved:**
- `frontend/src/config/gridConfigs.ts` - Grid column configuration
- Components under `frontend/src/components/metaModel/` - Activity table components

### Section 4: Live Update Behaviour

When user edits `frequency` in the Activity table:
1. Dispatch `UPDATE_ENTITY` action with updated ProcessActivity
2. Context state updates with new `frequency` value
3. Table row reflects the change immediately
4. No page refresh required

### Section 5: Validation

**Validation rules:**
- `frequency` is optional - no required field validation
- If provided, must be one of the defined enum values
- Invalid values should produce validation error

## Acceptance Criteria

### AC1: ProcessActivity Interface Updated
- `ProcessActivity` interface in `frontend/src/types/model.ts` has `frequency?: ProcessActivityFrequency`
- `ProcessActivityFrequency` type defined with all 9 enum values

### AC2: Activity Table Shows Frequency Column
- Activity table displays a "Frequency" column
- Column is positioned between "Description" and "Sequence Order"
- Column shows dropdown with all 9 enum options plus empty option

### AC3: Frequency Editable in Table
- User can select a frequency value from the dropdown
- Selection dispatches UPDATE_ENTITY and updates the Process Activity
- Change persists when JSON is saved
- Change survives page reload

### AC4: Backward Compatibility
- Loading JSON without `frequency` field works correctly
- Existing Process Activities display empty/placeholder for frequency
- No errors when loading old format JSON

### AC5: Saving Includes Frequency
- When JSON is saved, `frequency` is included in Process Activity objects
- Only included when value is set (not null/undefined)

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A - This follows existing Activity table patterns.

## Scope Boundaries

### In Scope:
- Add `frequency` field to ProcessActivity type
- Add `ProcessActivityFrequency` enum type
- Add Frequency column to Activity table
- Column positioning between Description and Sequence Order
- Dropdown editor for frequency values
- Backward compatibility for loading old JSON
- Saving frequency to JSON

### Out of Scope:
- Backend API changes (frontend-only scope for initial implementation)
- Database schema changes
- Diagram rendering changes based on frequency
- Colour coding or visual styling based on frequency
- Default value assignment
- Required field validation

## Requirements Summary

### Functional Requirements
- New `frequency` enum field on ProcessActivity
- 9 allowed values: CONTINUOUSLY, DAILY, WEEKLY, MONTHLY, QUARTERLY, SEMI-ANNUALLY, ANNUALLY, ADHOC, OTHER
- Field is optional (nullable)
- Activity table column with dropdown editor
- Column positioned between Description and Sequence Order
- Backward compatible JSON loading

### Reusability Opportunities
- `ProcessActivityFrequency` type can be reused for filtering/reporting
- Column configuration pattern follows existing table setup

### Technical Considerations
- TypeScript interface changes in `frontend/src/types/model.ts`
- Grid configuration in `frontend/src/config/gridConfigs.ts`
- File operations may need minor updates for new field
- Validation rules if strict enum checking is needed
