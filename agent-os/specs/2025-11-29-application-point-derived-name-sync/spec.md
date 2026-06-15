# Specification: Application Point Derived Name Synchronisation

## Goal
Treat `application_point.name` as a fully derived field that is always kept in sync with the underlying source entity (Application, App Component, or Service). This eliminates validation errors like `APPLICATION_POINT ['unnamed row'] requires a value in field 'name'` when the source entities have valid names.

## User Stories
- As an architect, I want Application Point names to automatically stay in sync with their source entities so that I never see validation errors about missing Application Point names.
- As a user, when I rename an Application, I want its corresponding Application Point to update immediately without any manual intervention.

## Design Principle

**`application_point.name` is a derived field, not user-authored.**

- The name is always derived from the underlying:
  - `Application.name`, or
  - `AppComponent.name`, or
  - `Service.name`
- Whenever there is a conflict between the Application Point name and the source entity name, the **source entity name wins**
- Users never edit Application Point names directly; any legacy values are overwritten by sync logic

## Specific Requirements

### 1. Synchronisation on JSON Load

When a model JSON file is loaded:

**1.1 For every Application, App Component, and Service:**
- Ensure there is exactly one corresponding Application Point
- Force the following values:

  For Application:
  ```
  application_point.kind = "APPLICATION"
  application_point.application_id = application.id
  application_point.name = application.name
  ```

  For App Component:
  ```
  application_point.kind = "APP_COMPONENT"
  application_point.application_component_id = app_component.id
  application_point.name = app_component.name
  ```

  For Service:
  ```
  application_point.kind = "SERVICE"
  application_point.service_id = service.id
  application_point.name = service.name
  ```

- If an Application Point already exists but has a different or empty name, **overwrite it** with the entity's current name

**1.2 Orphan Handling:**
- For any Application Point that does NOT have a corresponding underlying entity:
  - Delete the orphaned Application Point on load
- This ensures clean state after load

**1.3 Post-Load Guarantee:**
- After load, there are no Application Points with null/empty names unless the underlying entity itself has a null/empty name

### 2. Synchronisation on Entity Edit (Name Changes)

In the Meta-model grids for Applications, Application Components, and Services:

**2.1 Trigger:**
- Whenever a row is edited and its `name` field changes (including from empty to non-empty or vice versa)

**2.2 Action:**
- Immediately update the corresponding Application Point's name

**2.3 Implementation Detail:**
- Hook into the row/field update handler (likely in the reducer or a dedicated sync function)
- When `name` changes for an Application row with id = A:
  - Find its Application Point (kind="APPLICATION", application_id=A)
  - If not found, create it (per existing rules)
  - Set `application_point.name = application.name` (new value)
- Apply the same logic for:
  - App Components (kind="APP_COMPONENT", application_component_id)
  - Services (kind="SERVICE", service_id)

**2.4 Coverage:**
- This must happen on **every name change**, not just on initial row creation
- If the user initially creates a blank row, then later fills in the name, the Application Point's name updates at that moment
- Renaming an Application automatically renames its Application Point

### 3. Final Sync Before Validation and Save

Before running validation and before serializing the JSON on Save:

**3.1 Run a final global sync pass:**
- For each Application / App Component / Service in the meta-model:
  - Ensure its Application Point exists (creating it if needed)
  - Force: `application_point.name = entity.name`

**3.2 Validation runs after sync:**
- Only then run validation on Applications, App Components, Services, Application Points, and relationships

**3.3 Result:**
- Any missing `name` problems will be surfaced against the **source entity** (not just the Application Point)
- Application Points will never produce an `'unnamed row'` error if the underlying entity has a name

### 4. Validation Expectations

After implementing this sync:

**4.1 When source entities have valid names:**
- There should be **no** validation errors complaining about Application Point `name` being missing
- Application Points will always inherit a valid `name`

**4.2 When a source entity is missing a name:**
- Validation errors may mention:
  - `APPLICATION ['unnamed row'] requires a value in field 'name'`
  - And possibly: `APPLICATION_POINT ['unnamed row'] requires a value in field 'name'`
- But in typical usage, the user will fix the entity name, and subsequent sync will fix the Application Point name

### 5. UI Considerations

- Application Point names are never edited directly in the UI (Application Points tab is already removed)
- Any place that shows an Application Point name (e.g., "App Point <-> Process" dropdown) relies on the synced `application_point.name` which is kept up-to-date by these rules

## Existing Code to Leverage

**applicationPointSync.ts - Current Sync Functions**
- `syncApplicationPointNames()` - already exists, needs to be called at additional trigger points
- `reconcileApplicationPoints()` - runs on load, already handles creation and orphan removal
- `createApplicationPointFromEntity()` - creates AP with name from source entity
- `findSourceEntityForApplicationPoint()` - looks up the underlying entity

**ArchitectureContext.tsx - Reducer and State**
- `UPDATE_ENTITY` case - needs to trigger name sync when source entity name changes
- `LOAD_MODEL` case - already calls reconcileApplicationPoints
- Consider adding a `SYNC_APPLICATION_POINT_NAMES` action or integrating into existing flow

**validation.ts - Pre-validation Sync**
- `validateModel()` - should call sync before running validations
- Or create a `prepareModelForValidation()` function that syncs then validates

## Implementation Approach

### Phase 1: Strengthen Load-Time Sync
- Verify `reconcileApplicationPoints()` already forces name sync
- Ensure orphan cleanup is working
- Add explicit name overwrite even when AP exists with different name

### Phase 2: Add Edit-Time Sync
- In the reducer's `UPDATE_ENTITY` case for applications/app_components/services:
  - Detect when `name` field has changed
  - Find and update the corresponding Application Point's name
- Alternative: Create a hook or subscription that watches for name changes

### Phase 3: Add Pre-Save/Pre-Validation Sync
- Before `validateModel()` runs, call `syncApplicationPointNames()`
- Before JSON serialization on save, ensure sync has run

### Phase 4: Verify No Orphan AP Validation Errors
- Test that after sync, no `APPLICATION_POINT ['unnamed row']` errors appear when source entities have names

## Acceptance Criteria

- [ ] After load, there are no Application Points with null/empty names if their underlying entity has a non-empty `name`
- [ ] When the user renames an Application, the corresponding Application Point name updates instantly
- [ ] When the user renames an App Component, the corresponding Application Point name updates instantly
- [ ] When the user renames a Service, the corresponding Application Point name updates instantly
- [ ] Before Save, a sync pass ensures all Application Point names are aligned with their source entity names
- [ ] Before Validation, a sync pass ensures all Application Point names are aligned
- [ ] Orphaned Application Points (no corresponding entity) are removed on load
- [ ] The "Validation Errors" dialog no longer shows `APPLICATION_POINT ['unnamed row'] requires a value in field 'name'` when Applications/App Components/Services have valid names
- [ ] The "App Point <-> Process" dropdown always shows meaningful names (no blank entries due to missing AP names)

## Out of Scope

- Bidirectional name sync (Application Point name changes updating the source entity) - AP names are derived only
- User ability to override or customize Application Point names
- Persisting sync preferences
- Internationalization of sync-related messages
- Application Point name uniqueness validation (names are derived, so uniqueness depends on source entity names)
