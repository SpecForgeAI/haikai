# Specification: Fix Typed Diagram Persistence via API Boundary Key Mapping

## Goal
Ensure typed diagram content (Sequence, UI_SCREEN, etc.) persists end-to-end by adding deterministic snake_case/camelCase mapping at the frontend API boundary: map `typed_content` to `typedContent` on load, and `typedContent` to `typed_content` on save.

## User Stories
- As a user, I want my Sequence diagram participants, messages, and fragments to persist across save/reload so that I do not lose my work.
- As a user, I want my UI_SCREEN typed content (screen_id, components, actions) to persist across refresh so that my screen specifications are not lost.

## Specific Requirements

**Create modelSerialization.ts utility module**
- Create new file at `frontend/src/api/modelSerialization.ts`
- Implement `normalizeModelFromApi(rawModel: any): ArchitectureModel` function
- Implement `prepareModelForApiSave(model: ArchitectureModel): any` function
- Export both functions for use by API layer
- Must be a single source of truth for API boundary key mapping

**normalizeModelFromApi function**
- Accept raw backend JSON response (may include snake_case keys)
- For each diagram in `rawModel.diagrams`: if `diagram.typedContent` is undefined and `diagram.typed_content` is present, copy `typed_content` to `typedContent`
- Delete `diagram.typed_content` after copying to prevent dual sources
- Return properly typed ArchitectureModel object for app use
- Do not mutate the input object

**prepareModelForApiSave function**
- Accept in-memory ArchitectureModel from app state
- Create a deep clone suitable for JSON.stringify (do not mutate app state)
- For each diagram in the cloned payload: if `diagram.typedContent` is present, copy to `diagram.typed_content`
- Delete `diagram.typedContent` from payload to prevent ambiguity
- Return payload object ready for API submission
- Only remap diagram typed content keys; do not change other fields

**Integrate normalization on model load**
- Update `loadModelByFilename` in `frontend/src/api/modelApi.ts`
- After `res.json()`, call `normalizeModelFromApi(raw)` before returning
- Ensures all models loaded from backend have correct camelCase `typedContent`

**Integrate prepare-for-save on model save**
- Update `saveModelByFilename` in `frontend/src/api/modelApi.ts`
- Before `JSON.stringify(model)`, call `prepareModelForApiSave(model)`
- Pass prepared payload to `body: JSON.stringify(payload)`
- Ensures backend receives snake_case `typed_content`

**Add regression tests**
- Create test file at `frontend/src/__tests__/typed-content-serialization.test.ts`
- Test A: `normalizeModelFromApi` maps `typed_content` to `typedContent` and removes snake_case key
- Test B: `prepareModelForApiSave` maps `typedContent` to `typed_content` and removes camelCase key
- Test C: Round-trip sanity (raw -> normalize -> prepareForSave) preserves typed content with correct keys

## Existing Code to Leverage

**frontend/src/api/modelApi.ts**
- Contains `loadModelByFilename` and `saveModelByFilename` functions
- These are the integration points where normalization/preparation must be called
- Currently uses simple `res.json()` for load and `JSON.stringify(model)` for save

**frontend/src/utils/fileOperations.ts parseTypedContent function**
- Lines 114-148 already handle `typed_content` to `typedContent` mapping for file loads
- Use the same mapping logic pattern for API boundary (check both keys, prefer snake_case from backend)
- Demonstrates the dual-key check pattern: `diagram.typed_content ?? diagram.typedContent`

**frontend/src/types/typedContent.ts**
- Defines `TypedContentEnvelope` interface with type, version, content fields
- Defines content types for Sequence, ER, Activity, State, UI_SCREEN
- Use these types for proper typing of normalized typedContent

**frontend/src/types/model.ts Diagram interface**
- Diagram interface has `typedContent?: TypedContentEnvelope` field (line 1680)
- This is the camelCase key the frontend expects
- Backend uses snake_case `typed_content` in JSON responses

**frontend/src/contexts/ArchitectureContext.tsx**
- LOAD_MODEL action (lines 246-319) receives model and processes diagrams
- Model is passed through from loadModelByFilename result
- No changes needed here once API layer normalizes correctly

## Out of Scope
- No backend changes (backend contract remains snake_case `typed_content`)
- No schema changes to TypedContentEnvelope or Diagram interfaces
- No changes to sequence editor logic (continues using `typedContent` as before)
- No changes to file-based load/save in fileOperations.ts (already handles mapping)
- No changes to ArchitectureContext reducer logic
- No changes to validation.ts or prepareModelForSave in validation.ts
- No changes to UI components or rendering logic
- No migration of existing persisted data on backend
- No changes to how typedContent is updated within the app (editors, hooks)
- No changes to createDefaultTypedContent or other typedContent.ts helpers
