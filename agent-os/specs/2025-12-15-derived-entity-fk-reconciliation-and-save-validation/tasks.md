# Task Breakdown: Derived Entity FK Reconciliation and Save Validation

## Overview
Total Tasks: 18
Estimated Complexity: Medium

## Context

### Current State
- `businessPointSync.ts`: `forceUpdateBusinessPointName()` updates name only
- `applicationPointSync.ts`: `forceUpdateApplicationPointName()` updates name only
- `validation.ts`: `prepareModelForSave()` only reconciles Application Points
- `TopBar.tsx`: `handleSaveToBackend()` sends model directly without validation/sanitization

### What Needs to Change
1. Fix FK reconciliation in Business Points sync
2. Fix FK reconciliation in Application Points sync
3. Expand `prepareModelForSave()` to reconcile all derived entity types
4. Add sanitization step before backend save
5. Add validation gate with warning dialog before backend save

### Key Files
- `frontend/src/utils/businessPointSync.ts` - BP reconciliation
- `frontend/src/utils/applicationPointSync.ts` - AP reconciliation
- `frontend/src/utils/validation.ts` - prepareModelForSave
- `frontend/src/utils/sanitize.ts` - NEW: sanitization utility
- `frontend/src/components/TopBar/TopBar.tsx` - Save handler + warning modal

---

## Task List

### Task Group 1: Fix Business Point FK Reconciliation

#### Task 1.1: Create forceReconcileBusinessPoint helper function
**Dependencies:** None
**File:** `frontend/src/utils/businessPointSync.ts`

Add a new helper function that updates BOTH name AND FK fields:

```typescript
/**
 * Force-reconcile an existing Business Point's name and FK fields from its source entity.
 * Used during reconciliation to ensure existing BPs have correct names AND foreign keys.
 *
 * @param existingBP - The existing Business Point to update
 * @param sourceEntity - The source entity (Business Process or Process Activity)
 * @param kind - The BusinessPointKind
 * @returns Updated BusinessPoint with name and FK fields from source entity
 */
function forceReconcileBusinessPoint(
  existingBP: BusinessPoint,
  sourceEntity: BusinessSourceEntity | MinimalBusinessSourceEntity,
  kind: BusinessPointKind
): BusinessPoint {
  // Start with name update
  let updated = forceUpdateBusinessPointName(existingBP, sourceEntity);

  // Update FK fields based on kind
  if (kind === 'BUSINESS_PROCESS') {
    updated = {
      ...updated,
      business_process_id: sourceEntity.id,
    };
  } else if (kind === 'PROCESS_ACTIVITY') {
    // For PROCESS_ACTIVITY, we need both process_activity_id AND business_process_id
    const activity = sourceEntity as ProcessActivity | MinimalBusinessSourceEntity;
    updated = {
      ...updated,
      process_activity_id: sourceEntity.id,
      business_process_id: activity.business_process_id || '',
    };
  }

  return updated;
}
```

**Acceptance Criteria:**
- [x] Function created with proper JSDoc
- [x] Handles BUSINESS_PROCESS kind correctly
- [x] Handles PROCESS_ACTIVITY kind correctly (sets both FKs)

---

#### Task 1.2: Update reconcileBusinessPoints to use forceReconcileBusinessPoint
**Dependencies:** Task 1.1
**File:** `frontend/src/utils/businessPointSync.ts`

Update the reconciliation logic to call the new FK-aware function:

**Current code in reconcileBusinessPoints (Step 1 - Business Processes loop):**
```typescript
} else {
  // BP exists - FORCE UPDATE name from source entity (source is canonical)
  const updatedBP = forceUpdateBusinessPointName(existingBP, process);
  bpMap.set(expectedId, updatedBP);
}
```

**Change to:**
```typescript
} else {
  // BP exists - FORCE UPDATE name and FK fields from source entity
  const updatedBP = forceReconcileBusinessPoint(existingBP, process, 'BUSINESS_PROCESS');
  bpMap.set(expectedId, updatedBP);
}
```

**Current code in reconcileBusinessPoints (Step 2 - Process Activities loop):**
```typescript
} else {
  // BP exists - FORCE UPDATE name from source entity (source is canonical)
  const updatedBP = forceUpdateBusinessPointName(existingBP, activity);
  bpMap.set(expectedId, updatedBP);
}
```

**Change to:**
```typescript
} else {
  // BP exists - FORCE UPDATE name and FK fields from source entity
  const updatedBP = forceReconcileBusinessPoint(existingBP, activity, 'PROCESS_ACTIVITY');
  bpMap.set(expectedId, updatedBP);
}
```

**Acceptance Criteria:**
- [x] Business Processes loop updated
- [x] Process Activities loop updated
- [x] Existing BPs get FK fields corrected during reconciliation

---

### Task Group 2: Fix Application Point FK Reconciliation

#### Task 2.1: Create forceReconcileApplicationPoint helper function
**Dependencies:** None
**File:** `frontend/src/utils/applicationPointSync.ts`

Add a new helper function that updates BOTH name AND FK fields:

```typescript
/**
 * Force-reconcile an existing Application Point's name and FK fields from its source entity.
 * Used during reconciliation to ensure existing APs have correct names AND foreign keys.
 *
 * @param existingAP - The existing Application Point to update
 * @param sourceEntity - The source entity (Application, App Component, or Service)
 * @param kind - The ApplicationPointKind
 * @returns Updated ApplicationPoint with name and FK fields from source entity
 */
function forceReconcileApplicationPoint(
  existingAP: ApplicationPoint,
  sourceEntity: SourceEntity | MinimalSourceEntity,
  kind: ApplicationPointKind
): ApplicationPoint {
  // Start with name update
  let updated = forceUpdateApplicationPointName(existingAP, sourceEntity);

  // Update FK fields based on kind
  if (kind === 'APPLICATION') {
    updated = {
      ...updated,
      application_id: sourceEntity.id,
    };
  } else if (kind === 'APP_COMPONENT') {
    // For APP_COMPONENT, we need both application_component_id AND application_id
    const component = sourceEntity as ApplicationComponent;
    updated = {
      ...updated,
      application_component_id: sourceEntity.id,
      application_id: component.application_id || '',
    };
  } else if (kind === 'SERVICE') {
    // For SERVICE, we need both service_id AND application_id
    const service = sourceEntity as Service;
    updated = {
      ...updated,
      service_id: sourceEntity.id,
      application_id: service.application_id || '',
    };
  }

  return updated;
}
```

**Note:** Need to import `ApplicationComponent` and `Service` types if not already imported.

**Acceptance Criteria:**
- [x] Function created with proper JSDoc
- [x] Handles APPLICATION kind correctly
- [x] Handles APP_COMPONENT kind correctly (sets both FKs)
- [x] Handles SERVICE kind correctly (sets both FKs)

---

#### Task 2.2: Update reconcileApplicationPoints to use forceReconcileApplicationPoint
**Dependencies:** Task 2.1
**File:** `frontend/src/utils/applicationPointSync.ts`

Update the reconciliation logic to call the new FK-aware function:

**Current code in reconcileApplicationPoints (Step 1 - Applications loop):**
```typescript
} else {
  // AP exists - FORCE UPDATE name from source entity (source is canonical)
  const updatedAP = forceUpdateApplicationPointName(existingAP, app);
  apMap.set(expectedId, updatedAP);
}
```

**Change to:**
```typescript
} else {
  // AP exists - FORCE UPDATE name and FK fields from source entity
  const updatedAP = forceReconcileApplicationPoint(existingAP, app, 'APPLICATION');
  apMap.set(expectedId, updatedAP);
}
```

**Current code (Step 2 - App Components loop):**
```typescript
} else {
  // AP exists - FORCE UPDATE name from source entity (source is canonical)
  const updatedAP = forceUpdateApplicationPointName(existingAP, comp);
  apMap.set(expectedId, updatedAP);
}
```

**Change to:**
```typescript
} else {
  // AP exists - FORCE UPDATE name and FK fields from source entity
  const updatedAP = forceReconcileApplicationPoint(existingAP, comp, 'APP_COMPONENT');
  apMap.set(expectedId, updatedAP);
}
```

**Current code (Step 3 - Services loop):**
```typescript
} else {
  // AP exists - FORCE UPDATE name from source entity (source is canonical)
  const updatedAP = forceUpdateApplicationPointName(existingAP, service);
  apMap.set(expectedId, updatedAP);
}
```

**Change to:**
```typescript
} else {
  // AP exists - FORCE UPDATE name and FK fields from source entity
  const updatedAP = forceReconcileApplicationPoint(existingAP, service, 'SERVICE');
  apMap.set(expectedId, updatedAP);
}
```

**Acceptance Criteria:**
- [x] Applications loop updated
- [x] App Components loop updated
- [x] Services loop updated
- [x] Existing APs get FK fields corrected during reconciliation

---

### Task Group 3: Expand prepareModelForSave

#### Task 3.1: Update prepareModelForSave to reconcile all derived entity types
**Dependencies:** Task Group 1, Task Group 2
**File:** `frontend/src/utils/validation.ts`

**Current implementation:**
```typescript
export function prepareModelForSave(model: ArchitectureModel): ArchitectureModel {
  // Run full reconciliation which handles:
  // - Creating missing APs
  // - Syncing AP names with source entities
  // - Removing orphaned APs
  const reconciledMetaModel = reconcileApplicationPoints(model.metaModel);

  return {
    ...model,
    metaModel: reconciledMetaModel,
  };
}
```

**Updated implementation:**
```typescript
export function prepareModelForSave(model: ArchitectureModel): ArchitectureModel {
  // Run full reconciliation for all derived entity types
  // Order matters: AP/BP must be correct before ABP references are rebuilt

  // 1. Reconcile Application Points (creates missing, fixes FK fields, removes orphans)
  let reconciledMetaModel = reconcileApplicationPoints(model.metaModel);

  // 2. Reconcile Business Points (creates missing, fixes FK fields, removes orphans)
  reconciledMetaModel = reconcileBusinessPoints(reconciledMetaModel);

  // 3. Reconcile App Business Points (ensures ABPs stay consistent)
  reconciledMetaModel = reconcileAppBusinessPoints(reconciledMetaModel);

  return {
    ...model,
    metaModel: reconciledMetaModel,
  };
}
```

**Required imports to add:**
```typescript
import { reconcileBusinessPoints } from './businessPointSync';
import { reconcileAppBusinessPoints } from './appBusinessPointSync';
```

**Acceptance Criteria:**
- [x] Import statements added
- [x] All three reconciliation functions called in correct order
- [x] Returns fully reconciled model

---

### Task Group 4: Create Sanitization Utility

#### Task 4.1: Create sanitize.ts with sanitizeModelForBackendSave function
**Dependencies:** None
**File:** `frontend/src/utils/sanitize.ts` (NEW FILE)

Create new utility module:

```typescript
/**
 * Model Sanitization Utilities
 *
 * Provides utilities for sanitizing the ArchitectureModel before sending to backend.
 * Converts empty-string FK references to undefined to avoid DB constraint violations.
 */

import type { ArchitectureModel, MetaModel, Diagram } from '../types/model';

/**
 * Check if a key represents a foreign key field.
 * FK fields end with '_id' or '_ids'.
 */
function isForeignKeyField(key: string): boolean {
  return key.endsWith('_id') || key.endsWith('_ids');
}

/**
 * Sanitize an object by converting empty-string FK fields to undefined.
 * Creates a shallow copy with sanitized values.
 */
function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj };

  for (const [key, value] of Object.entries(result)) {
    if (isForeignKeyField(key) && value === '') {
      (result as Record<string, unknown>)[key] = undefined;
    }
  }

  return result;
}

/**
 * Sanitize an array of objects by converting empty-string FK fields to undefined.
 */
function sanitizeArray<T extends Record<string, unknown>>(arr: T[]): T[] {
  return arr.map(item => sanitizeObject(item));
}

/**
 * Sanitize the MetaModel by processing all entity and relationship arrays.
 */
function sanitizeMetaModel(metaModel: MetaModel): MetaModel {
  return {
    entities: {
      applications: sanitizeArray(metaModel.entities.applications),
      app_components: sanitizeArray(metaModel.entities.app_components),
      services: sanitizeArray(metaModel.entities.services),
      interfaces: sanitizeArray(metaModel.entities.interfaces),
      endpoints: sanitizeArray(metaModel.entities.endpoints),
      application_points: sanitizeArray(metaModel.entities.application_points),
      business_users: sanitizeArray(metaModel.entities.business_users),
      business_processes: sanitizeArray(metaModel.entities.business_processes),
      business_points: sanitizeArray(metaModel.entities.business_points),
      process_activities: sanitizeArray(metaModel.entities.process_activities),
      logical_data_entities: sanitizeArray(metaModel.entities.logical_data_entities),
      logical_data_attributes: sanitizeArray(metaModel.entities.logical_data_attributes),
      physical_data_entities: sanitizeArray(metaModel.entities.physical_data_entities),
      physical_data_attributes: sanitizeArray(metaModel.entities.physical_data_attributes),
      interactions: sanitizeArray(metaModel.entities.interactions),
      app_business_points: sanitizeArray(metaModel.entities.app_business_points),
    },
    relationships: {
      business_user_business_points: sanitizeArray(metaModel.relationships.business_user_business_points),
      application_point_business_points: sanitizeArray(metaModel.relationships.application_point_business_points),
      logical_data_entity_relationships: sanitizeArray(metaModel.relationships.logical_data_entity_relationships),
      logical_data_entity_physical_data_entities: sanitizeArray(metaModel.relationships.logical_data_entity_physical_data_entities),
      logical_data_attribute_physical_data_attributes: sanitizeArray(metaModel.relationships.logical_data_attribute_physical_data_attributes),
      data_movements: sanitizeArray(metaModel.relationships.data_movements),
      interface_logical_entities: sanitizeArray(metaModel.relationships.interface_logical_entities),
    },
  };
}

/**
 * Sanitize a diagram by processing nodes, edges, interaction_edges, and decorations.
 */
function sanitizeDiagram(diagram: Diagram): Diagram {
  return {
    ...diagram,
    diagram_nodes: sanitizeArray(diagram.diagram_nodes || []),
    diagram_edges: sanitizeArray(diagram.diagram_edges || []),
    interaction_edges: sanitizeArray(diagram.interaction_edges || []),
    decorations: sanitizeArray(diagram.decorations || []),
  };
}

/**
 * Sanitize the entire ArchitectureModel for backend save.
 *
 * Converts empty-string FK references (fields ending with '_id' or '_ids')
 * to undefined throughout the model. This prevents DB FK constraint violations
 * where "" is not a valid foreign key value.
 *
 * @param model - The ArchitectureModel to sanitize
 * @returns A new ArchitectureModel with sanitized FK fields
 */
export function sanitizeModelForBackendSave(model: ArchitectureModel): ArchitectureModel {
  return {
    ...model,
    metaModel: sanitizeMetaModel(model.metaModel),
    diagrams: model.diagrams.map(sanitizeDiagram),
  };
}
```

**Acceptance Criteria:**
- [x] New file created at `frontend/src/utils/sanitize.ts`
- [x] `isForeignKeyField()` helper implemented
- [x] `sanitizeObject()` helper implemented
- [x] `sanitizeArray()` helper implemented
- [x] `sanitizeMetaModel()` processes all entity and relationship arrays
- [x] `sanitizeDiagram()` processes nodes, edges, interaction_edges, decorations
- [x] `sanitizeModelForBackendSave()` exported and combines all sanitization
- [x] Immutable - does not mutate input

---

### Task Group 5: Update TopBar Save Handler with Validation Gate

#### Task 5.1: Add validation warning modal state to TopBar
**Dependencies:** None
**File:** `frontend/src/components/TopBar/TopBar.tsx`

Add state for validation warnings:

```typescript
// Add imports
import { ValidationError } from '../../types/config';
import { validateModel, prepareModelForSave } from '../../utils/validation';
import { sanitizeModelForBackendSave } from '../../utils/sanitize';

// Add state (near other state declarations around line 18-30)
const [validationWarnings, setValidationWarnings] = useState<ValidationError[]>([]);
const [validationWarningModalOpen, setValidationWarningModalOpen] = useState(false);
```

**Acceptance Criteria:**
- [x] Import statements added
- [x] State variables added

---

#### Task 5.2: Update handleSaveToBackend to validate before saving
**Dependencies:** Task 5.1, Task Group 3, Task Group 4
**File:** `frontend/src/components/TopBar/TopBar.tsx`

Update the `handleSaveToBackend` function:

**Current implementation (around line 71-84):**
```typescript
const handleSaveToBackend = async (filename: string) => {
  try {
    await saveModelByFilename(filename, state.model);
    // Update the loaded filename in state
    dispatch({ type: 'LOAD_MODEL', payload: state.model, fileName: filename });
    setSaveAsDialogVisible(false);
    // Show success notification
    setNotification(`Model saved as "${filename}"`);
    setTimeout(() => setNotification(null), 3000);
  } catch (err) {
    setErrorMessages([err instanceof Error ? err.message : 'Failed to save model to server']);
    setErrorModalOpen(true);
  }
};
```

**Updated implementation:**
```typescript
const handleSaveToBackend = async (filename: string) => {
  try {
    // 1. Prepare model (reconcile all derived entities)
    const prepared = prepareModelForSave(state.model);

    // 2. Validate the prepared model
    const errors = validateModel(prepared);

    // 3. If validation fails, show warning dialog and abort save
    if (errors.length > 0) {
      setValidationWarnings(errors);
      setValidationWarningModalOpen(true);
      return;
    }

    // 4. Sanitize the model for backend (convert "" to undefined for FK fields)
    const sanitized = sanitizeModelForBackendSave(prepared);

    // 5. Save to backend
    await saveModelByFilename(filename, sanitized);

    // Update the loaded filename in state (use prepared model to preserve reconciliation)
    dispatch({ type: 'LOAD_MODEL', payload: prepared, fileName: filename });
    setSaveAsDialogVisible(false);

    // Show success notification
    setNotification(`Model saved as "${filename}"`);
    setTimeout(() => setNotification(null), 3000);
  } catch (err) {
    setErrorMessages([err instanceof Error ? err.message : 'Failed to save model to server']);
    setErrorModalOpen(true);
  }
};
```

**Acceptance Criteria:**
- [x] Calls `prepareModelForSave()` first
- [x] Calls `validateModel()` on prepared model
- [x] Shows warning modal if validation fails
- [x] Calls `sanitizeModelForBackendSave()` before PUT
- [x] Only saves if validation passes
- [x] Dispatches with prepared model (not sanitized, to preserve proper state)

---

#### Task 5.3: Add validation warning modal to TopBar render
**Dependencies:** Task 5.1
**File:** `frontend/src/components/TopBar/TopBar.tsx`

Add the warning modal JSX near other modals (around line 260+):

```typescript
{/* Validation Warning Modal */}
{validationWarningModalOpen && (
  <ErrorModal
    isOpen={validationWarningModalOpen}
    onClose={() => {
      setValidationWarningModalOpen(false);
      setValidationWarnings([]);
    }}
    title="Cannot Save"
    errors={[
      'Please fix the following issues before saving:',
      ...validationWarnings.map(err => `• ${err.message}`),
    ]}
  />
)}
```

**Note:** The existing `ErrorModal` component can be reused here since it already accepts a `title` and `errors` array.

**Acceptance Criteria:**
- [x] Modal renders when `validationWarningModalOpen` is true
- [x] Shows "Cannot Save" title
- [x] Lists all validation error messages
- [x] Closes and clears state when dismissed

---

### Task Group 6: Testing and Verification

#### Task 6.1: TypeScript compilation check
**Dependencies:** All previous task groups

Run TypeScript compilation:
```bash
cd frontend && npx tsc --noEmit
```

**Acceptance Criteria:**
- [x] No new TypeScript errors introduced

---

#### Task 6.2: Unit test - Business Point FK reconciliation
**Dependencies:** Task Group 1
**File:** Create test or run existing tests

Verify that Business Points with stale FK fields get corrected:
- Create BP with empty `business_process_id`
- Source activity has `business_process_id` set
- After reconciliation, BP should have correct `business_process_id`

**Acceptance Criteria:**
- [ ] BP FK fields are corrected during reconciliation

---

#### Task 6.3: Unit test - Application Point FK reconciliation
**Dependencies:** Task Group 2

Verify that Application Points with stale FK fields get corrected:
- Create AP with empty `application_id`
- Source component/service has `application_id` set
- After reconciliation, AP should have correct `application_id`

**Acceptance Criteria:**
- [ ] AP FK fields are corrected during reconciliation

---

#### Task 6.4: Unit test - Sanitization
**Dependencies:** Task Group 4

Verify sanitization converts `""` to `undefined`:
- Create model with `service.application_id = ""`
- Call `sanitizeModelForBackendSave()`
- Verify `application_id` is `undefined` in result

**Acceptance Criteria:**
- [ ] Empty-string FK fields become undefined
- [ ] Non-FK empty strings (description, tags) are preserved

---

#### Task 6.5: Manual verification
**Dependencies:** All previous tasks

1. Load model from backend with Save As flow
2. Verify validation errors block save and show dialog
3. Fix validation errors
4. Verify save succeeds
5. Verify saved model has correct FK values

**Acceptance Criteria:**
- [ ] Validation gate blocks saves with errors
- [ ] Warning dialog shows error messages
- [ ] Valid models save successfully
- [ ] Saved models have correct FK values

---

## Execution Order

```
Phase 1 (Parallel):
  - Task Group 1: Fix Business Point FK Reconciliation
  - Task Group 2: Fix Application Point FK Reconciliation
  - Task Group 4: Create Sanitization Utility

Phase 2 (Depends on Groups 1, 2):
  - Task Group 3: Expand prepareModelForSave

Phase 3 (Depends on Groups 3, 4):
  - Task Group 5: Update TopBar Save Handler

Phase 4 (Final):
  - Task Group 6: Testing and Verification
```

---

## File Summary

### Files to Create

| File | Description |
|------|-------------|
| `frontend/src/utils/sanitize.ts` | Model sanitization utility for backend save |

### Files to Modify

| File | Changes |
|------|---------|
| `frontend/src/utils/businessPointSync.ts` | Add `forceReconcileBusinessPoint()`, update reconcile logic |
| `frontend/src/utils/applicationPointSync.ts` | Add `forceReconcileApplicationPoint()`, update reconcile logic |
| `frontend/src/utils/validation.ts` | Add imports, update `prepareModelForSave()` |
| `frontend/src/components/TopBar/TopBar.tsx` | Add imports, state, validation gate, warning modal |

---

## Success Criteria

1. **Derived FK Correctness:** BPs and APs have correct FK fields after reconciliation
2. **Sanitization:** No `""` values for FK fields in backend requests
3. **Validation Gate:** Save blocked when validation fails, warning shown
4. **Regression Safety:** Existing functionality unaffected

---

## Rollback

If issues occur:
1. Revert changes to the 4 modified files
2. Delete `sanitize.ts`
3. Backend save will work as before (may still fail on FK violations)
