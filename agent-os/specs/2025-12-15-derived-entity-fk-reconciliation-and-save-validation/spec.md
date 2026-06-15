# Spec: Derived Entity FK Reconciliation and Save Validation

## Overview

Fix missing/blank foreign keys in derived "superclass" entities (`business_points`, `application_points`) before saving to the backend, sanitize the model payload to eliminate empty-string FK values, and enforce all existing validation rules pass before calling `PUT /api/model`.

## Problem Statement

### Current Behavior
- The exported/saved model can contain derived entities with empty-string FK fields (e.g., `business_points.business_process_id == ""`)
- This causes backend/Postgres FK violations and 500 responses
- Root cause: existing derivation/reconciliation logic only synchronizes NAMES, not FK fields
- Some derived entities were created when their parent FK fields were blank and were never corrected later

### Root Cause Analysis

**Business Points:**
- `forceUpdateBusinessPointName()` only updates `name`, not FK fields
- `reconcileBusinessPoints()` creates/updates BPs but existing BP FK fields are not corrected
- A `PROCESS_ACTIVITY` BP needs both `process_activity_id` AND `business_process_id` from the source activity

**Application Points:**
- `forceUpdateApplicationPointName()` only updates `name`, not FK fields
- `reconcileApplicationPoints()` creates/updates APs but existing AP FK fields are not corrected
- An `APP_COMPONENT` AP needs both `application_component_id` AND `application_id` from the source component
- A `SERVICE` AP needs both `service_id` AND `application_id` from the source service

**Save Flow:**
- `prepareModelForSave()` only reconciles Application Points, not Business Points
- No sanitization step to convert `""` to `null/undefined` before sending to backend
- No validation gate to block saves when validation fails

## Solution

### Part A: Fix FK Reconciliation for Business Points

Update `businessPointSync.ts` to reconcile FK fields, not just names.

**New function: `forceReconcileBusinessPoint()`**

```typescript
function forceReconcileBusinessPoint(
  existingBP: BusinessPoint,
  source: BusinessSourceEntity | MinimalBusinessSourceEntity,
  kind: BusinessPointKind
): BusinessPoint {
  // Update name (existing behavior)
  let updated = forceUpdateBusinessPointName(existingBP, source);

  // Update FK fields based on kind
  if (kind === 'BUSINESS_PROCESS') {
    updated = { ...updated, business_process_id: source.id };
  } else if (kind === 'PROCESS_ACTIVITY') {
    updated = {
      ...updated,
      process_activity_id: source.id,
      business_process_id: (source as ProcessActivity).business_process_id || '',
    };
  }

  return updated;
}
```

**Update `reconcileBusinessPoints()`** to call the new FK-aware reconciliation.

### Part B: Fix FK Reconciliation for Application Points

Update `applicationPointSync.ts` to reconcile FK fields, not just names.

**New function: `forceReconcileApplicationPoint()`**

```typescript
function forceReconcileApplicationPoint(
  existingAP: ApplicationPoint,
  source: SourceEntity | MinimalSourceEntity,
  kind: ApplicationPointKind
): ApplicationPoint {
  // Update name (existing behavior)
  let updated = forceUpdateApplicationPointName(existingAP, source);

  // Update FK fields based on kind
  if (kind === 'APPLICATION') {
    updated = { ...updated, application_id: source.id };
  } else if (kind === 'APP_COMPONENT') {
    updated = {
      ...updated,
      application_component_id: source.id,
      application_id: (source as ApplicationComponent).application_id || '',
    };
  } else if (kind === 'SERVICE') {
    updated = {
      ...updated,
      service_id: source.id,
      application_id: (source as Service).application_id || '',
    };
  }

  return updated;
}
```

**Update `reconcileApplicationPoints()`** to call the new FK-aware reconciliation.

### Part C: Expand `prepareModelForSave()` to Reconcile All Derived Entities

Update `validation.ts` to perform full reconciliation:

```typescript
export function prepareModelForSave(model: ArchitectureModel): ArchitectureModel {
  // Order matters: AP/BP must be correct before ABP references are rebuilt
  let reconciledMetaModel = reconcileApplicationPoints(model.metaModel);
  reconciledMetaModel = reconcileBusinessPoints(reconciledMetaModel);
  reconciledMetaModel = reconcileAppBusinessPoints(reconciledMetaModel);

  return { ...model, metaModel: reconciledMetaModel };
}
```

### Part D: Add Sanitization Step Before Backend Save

Create new utility `sanitize.ts`:

```typescript
export function sanitizeModelForBackendSave(model: ArchitectureModel): ArchitectureModel
```

**Sanitization rules:**
- For any object property where key ends with `_id` or `_ids` and value is `""`, convert to `undefined`
- Apply recursively through `metaModel.entities`, `metaModel.relationships`, `diagrams`, nodes, edges
- Do NOT alter legitimate non-FK empty strings like `description` or `tags`
- Use immutable cloning (do not mutate store state)

### Part E: Enforce Validation Before Backend Save

Update `TopBar.tsx` `handleSaveToBackend()`:

```typescript
const handleSaveToBackend = async (filename: string) => {
  // 1. Prepare model (reconcile all derived entities)
  const prepared = prepareModelForSave(state.model);

  // 2. Validate
  const errors = validateModel(prepared);

  // 3. If errors, show warning dialog and DO NOT save
  if (errors.length > 0) {
    setValidationWarnings(errors);
    setValidationWarningModalOpen(true);
    return;
  }

  // 4. Sanitize and save
  const sanitized = sanitizeModelForBackendSave(prepared);
  await saveModelByFilename(filename, sanitized);
  // ... rest of success handling
};
```

### Part F: Warning Dialog for Validation Failures

Add new modal state and render a warning dialog:
- Title: "Cannot Save"
- Body: "Please fix the following issues before saving:" + scrollable list of error messages
- Buttons: "Close" only (no force save option)

## Technical Design

### Files to Create

| File | Description |
|------|-------------|
| `frontend/src/utils/sanitize.ts` | Model sanitization utility for backend save |

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/businessPointSync.ts` | Add `forceReconcileBusinessPoint()`, update `reconcileBusinessPoints()` |
| `frontend/src/utils/applicationPointSync.ts` | Add `forceReconcileApplicationPoint()`, update `reconcileApplicationPoints()` |
| `frontend/src/utils/validation.ts` | Update `prepareModelForSave()` to reconcile all derived entity types |
| `frontend/src/components/TopBar/TopBar.tsx` | Add validation gate, sanitization, and warning modal |

### Affected Entity Types

| Entity Type | FK Fields to Reconcile |
|-------------|----------------------|
| `business_points` (BUSINESS_PROCESS) | `business_process_id` |
| `business_points` (PROCESS_ACTIVITY) | `process_activity_id`, `business_process_id` |
| `application_points` (APPLICATION) | `application_id` |
| `application_points` (APP_COMPONENT) | `application_component_id`, `application_id` |
| `application_points` (SERVICE) | `service_id`, `application_id` |

## Out of Scope

- Backend controller changes
- Weakening backend FK constraints
- Changes to API request/response payload shapes
- Changes to local JSON/XLSX import/export (these don't go to backend)

## Acceptance Criteria

1. **Derived FK Correctness:**
   - If a Process Activity has `business_process_id` set, then its derived BusinessPoint (kind PROCESS_ACTIVITY) MUST have `business_process_id` set
   - If an App Component/Service has `application_id` set, then its derived ApplicationPoint MUST have `application_id` set

2. **Sanitization:**
   - The payload sent to `PUT /api/model` MUST NOT contain any `""` for `*_id` fields
   - Empty-string IDs are converted to `null/undefined` in the request body

3. **Validation Gate:**
   - If `validateModel()` returns any issues, Save As must show the Warning dialog and MUST NOT perform the PUT request
   - If there are no issues, Save As calls `PUT /api/model` and succeeds

4. **Regression Safety:**
   - Existing JSON/XLSX import/export continue to work
   - Reconciliation changes do not break existing diagram rendering or palette operations

## Verification Steps

### Manual Testing

1. **FK Reconciliation Test:**
   - Load a model with stale Business Points (BP with empty `business_process_id` but source activity has one)
   - Trigger Save As
   - Verify the saved model has correct FK values in derived entities

2. **Sanitization Test:**
   - Create entities with empty FK fields
   - Trigger Save As
   - Inspect network request - verify no `""` values for `*_id` fields

3. **Validation Gate Test:**
   - Create an invalid model (e.g., Interaction with missing `user_id`)
   - Trigger Save As
   - Verify warning dialog appears with error message
   - Verify no network request was made

4. **Regression Test:**
   - Load a valid model from backend
   - Make no changes
   - Save As
   - Verify save succeeds

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Performance impact from deep cloning | Low | Low | Only clone modified paths |
| Validation rules too strict | Medium | Medium | Use existing validation suite unchanged |
| Reconciliation breaks diagram state | Low | High | Reconciliation only touches derived entity collections |
