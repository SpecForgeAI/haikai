# Specification: Method Parameters/Returns/Throws Type-Oriented Input

## Goal
Replace the current JSON-based method fields (Parameters, Returns, Throws) with type-oriented inputs that reflect real method signatures, using free-text for parameters and single-token typeahead for returns/throws with optional meta-model suggestions.

## User Stories
- As an architect, I want to enter method parameters as natural signature strings (e.g., "String name, MyObject obj") so that the input mirrors actual code conventions.
- As an architect, I want to select return and exception types from suggestions derived from my meta-model entities while still being able to enter arbitrary types not yet modeled.

## Specific Requirements

**1) Rename Methods grid column headers (Frontend)**
- Update `frontend/src/config/gridConfigs.ts` methods config to change displayName values:
  - "Parameters (JSON)" becomes "Parameters"
  - "Returns (JSON)" becomes "Returns"
  - "Throws (JSON)" becomes "Throws"
- Keep field names (`parameters_json`, `returns_json`, `throws_json`) unchanged for backward compatibility

**2) Parameters: Free-text editor (Frontend)**
- Change cellType for `parameters_json` from 'text' to 'text' (remains unchanged, but remove any JSON validation that may exist elsewhere)
- Accept any string input including commas, spaces, and type annotations
- Example valid inputs: "String name", "String name, MyObject obj, int count"
- No parsing or validation of the input structure

**3) Create FreeTextTypeaheadSingleToken editor component (Frontend)**
- Create new component at `frontend/src/components/Grid/FreeTextTypeaheadSingleToken.tsx`
- Component shows dropdown suggestions while typing (typeahead behavior)
- Allows free typing and committing values not in suggestions
- On blur/commit, enforces single-token constraint:
  - Trim whitespace
  - Reject empty strings with inline error
  - Reject values containing whitespace characters with inline error
  - Reject values containing commas with inline error
- Follow existing patterns from `TypeaheadCell.tsx` and `TextWithSuggestionsCell` in `GridCell.tsx`

**4) Returns/Throws: Use new typeahead single-token editor (Frontend)**
- Update `frontend/src/config/gridConfigs.ts` methods config:
  - Change cellType for `returns_json` to 'free_text_typeahead_single_token'
  - Change cellType for `throws_json` to 'free_text_typeahead_single_token'
- Add suggestion source configuration to column config specifying entity types to derive suggestions from

**5) Suggestion sources for Returns/Throws (Frontend)**
- Returns suggestions:
  - Derive from `model.metaModel.entities.logical_data_entities` (name field)
  - Derive from `model.metaModel.entities.physical_data_entities` (name field)
- Throws suggestions:
  - Same sources as Returns plus optional hardcoded common exceptions
  - Hardcoded list: ["RuntimeException", "IllegalArgumentException", "IllegalStateException", "NullPointerException", "Exception"]
- Suggestions are non-binding; user can commit any valid single-token value

**6) Add FreeTextTypeaheadSingleToken to GridCell switch (Frontend)**
- Update `frontend/src/components/Grid/GridCell.tsx` to handle new cellType 'free_text_typeahead_single_token'
- Pass column config including suggestion sources to the new component
- Follow existing patterns for error handling and value propagation

**7) Legacy JSON value compatibility (Frontend)**
- In display rendering, detect if stored value starts with "{" or "["
- If JSON-like, display the raw string without crashing
- Best-effort auto-convert on edit:
  - Parameters: If JSON array, extract and join as "Type name, Type2 name2"
  - Returns/Throws: If JSON object with "type" or "name" field, extract that value
- Never block rendering due to parse errors

**8) Backend DTO/Entity already uses String types (Backend)**
- Verify `MethodDto` at `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/MethodDto.java` uses String types (already confirmed: parametersJson, returnsJson, throwsJson are String)
- Verify `MethodEntity` at `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/MethodEntity.java` uses String types with @Type(JsonType.class) annotation
- No changes needed if already String; the JsonType annotation handles JSONB column mapping

**9) Database schema check (Backend)**
- Current schema in `002-classes-methods.sql` defines columns as JSONB
- Evaluate if JSONB can accept plain strings (it can - JSON string is valid JSONB)
- If plain string values cause issues, create migration `025-method-params-to-text.sql`:
  - Add new TEXT columns
  - Copy values (cast JSONB to TEXT)
  - Drop old columns
  - Rename new columns
- Likely no migration needed since JSONB accepts quoted strings

**10) Backend backward compatibility for legacy JSON payloads (Backend)**
- In `EntityMapper.toEntity()` for Method, if legacy clients send JSON object/array:
  - Jackson will serialize to string representation
  - No special handling needed if DTO field is String
- If strict type checking occurs, add @JsonDeserialize annotation to accept any JSON value and stringify it

**11) Frontend tests (Frontend)**
- Add test file `frontend/src/__tests__/method-params-type-oriented.test.ts`
- Test cases:
  - Parameters field accepts arbitrary free text with commas and spaces
  - Returns/Throws accept single token and reject multi-token values
  - Returns/Throws show typeahead suggestions from logical/physical entities
  - Returns/Throws allow committing values not in suggestions
  - Legacy JSON strings render without errors
  - Best-effort conversion extracts type from legacy JSON

**12) Backend tests (Backend)**
- Add/extend tests in `architecture-model-service/src/test/java/com/example/architecturemodel/`
- Test cases:
  - saveModel persists plain string values for parameters/returns/throws
  - Snapshot export includes string values correctly
  - Snapshot import accepts string values
  - Legacy JSON object/array payloads are handled gracefully

## Visual Design
No visual mockups provided. The UI changes are:
- Column headers in Methods grid show simpler names without "(JSON)" suffix
- Parameters column uses standard text input
- Returns/Throws columns use typeahead dropdown with free-text fallback
- Inline error styling for invalid single-token values (red border, error message tooltip)

## Existing Code to Leverage

**TextWithSuggestionsCell in GridCell.tsx**
- Located at `frontend/src/components/Grid/GridCell.tsx` lines 327-429
- Provides pattern for text input with suggestion chips that appear in edit mode
- Demonstrates blur handling, suggestion click handling, and inline error display
- Reuse the suggestion display pattern but modify for dropdown instead of chips

**TypeaheadCell component**
- Located at `frontend/src/components/Grid/TypeaheadCell.tsx`
- Provides dropdown typeahead pattern with search filtering
- Demonstrates dropdown positioning (above/below based on cell position)
- Reuse the dropdown mechanics and styling patterns

**gridConfigs.ts methods configuration**
- Located at `frontend/src/config/gridConfigs.ts` lines 154-162
- Current method grid column definitions to be updated
- Shows cellType and displayName patterns used throughout

**MethodDto and MethodEntity**
- `MethodDto` at `architecture-model-service/.../dto/entity/MethodDto.java` uses String record fields
- `MethodEntity` at `architecture-model-service/.../entity/MethodEntity.java` uses @Type(JsonType.class) for JSONB mapping
- No DTO changes needed; entity annotations handle JSONB column binding

**BUSINESS_LOGIC_TYPE_SUGGESTIONS pattern**
- Located at `frontend/src/config/businessLogicTypeSuggestions.ts`
- Pattern for defining static suggestion lists in separate config files
- Can create similar file for common exception types

## Out of Scope
- Changes to other entity types beyond Methods
- Adding new entity types or relationships
- Changes to the meta-model structure
- Backend validation of parameter/return/throws semantics
- Type checking or code generation from these fields
- Changes to how Methods are created or deleted
- Changes to diagram rendering of Methods
- Renaming database columns or field names (keep *_json suffix for compatibility)
- Complex JSON-to-string migration for existing data (best-effort frontend conversion only)
- Validation that return/throws types exist in the meta-model
