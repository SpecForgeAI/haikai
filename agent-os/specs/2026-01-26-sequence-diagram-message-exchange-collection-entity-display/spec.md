# Specification: Sequence Diagram Message Exchange Collection Entity Display

**Spec Name**: sequence-diagram-message-exchange-collection-entity-display
**Scope**: full-stack
**Type**: message-content-model-extension + ux-rendering-enhancement
**Created**: 2026-01-26

## Overview

This specification enables Sequence Diagram message exchanges to indicate that a referenced data entity payload represents a collection (list/array/set) rather than a single instance. When enabled, the diagram renders the label as `Collection<EntityName>` instead of just `EntityName`.

### Applies To

- Message Exchange **request content** when content mode is "Reference"
- Message Exchange **response content** when content mode is "Reference"
- Reference Type must be one of: `PhysicalEntity`, `LogicalEntity`

### Non-Goals

- Do not support arbitrary generic types beyond "Collection<...>" in this increment
- No changes to participant rules, fragments, ordering, or layout engine beyond label text
- No changes to export/print behavior in this increment

---

## 1. Data Model Changes

### 1.1 Backend: SequenceMessageDto.java

**File**: `architecture-model-service/src/main/java/com/example/architecturemodel/model/dto/entity/SequenceMessageDto.java`

Add a new boolean field `isCollection` to the DTO record.

**Current Structure**:
```java
public record SequenceMessageDto(
    @JsonProperty("id") String id,
    @JsonProperty("exchange_id") String exchangeId,
    @JsonProperty("exchange_role") String exchangeRole,
    @JsonProperty("from_participant_id") String fromParticipantId,
    @JsonProperty("to_participant_id") String toParticipantId,
    @JsonProperty("ref_kind") String refKind,
    @JsonProperty("ref_id") String refId,
    @JsonProperty("label_text") String labelText
) {}
```

**Updated Structure**:
```java
public record SequenceMessageDto(
    @JsonProperty("id") String id,
    @JsonProperty("exchange_id") String exchangeId,
    @JsonProperty("exchange_role") String exchangeRole,
    @JsonProperty("from_participant_id") String fromParticipantId,
    @JsonProperty("to_participant_id") String toParticipantId,
    @JsonProperty("ref_kind") String refKind,
    @JsonProperty("ref_id") String refId,
    @JsonProperty("label_text") String labelText,
    @JsonProperty("is_collection") Boolean isCollection  // NEW: nullable, defaults to false
) {}
```

**Notes**:
- Use `Boolean` (nullable) rather than `boolean` (primitive) to support backward compatibility
- When `null`, treat as `false`
- JSON serialization uses snake_case: `is_collection`

### 1.2 Frontend: typedContent.ts - SequenceMessageRef Interface

**File**: `frontend/src/types/typedContent.ts`

**Current Structure** (lines 109-119):
```typescript
export interface SequenceMessageRef {
  id: string;
  exchange_id: string;
  exchange_role: string;
  from_participant_id: string;
  to_participant_id: string;
  ref_kind?: string;
  ref_id?: string;
  label_text?: string;
}
```

**Updated Structure**:
```typescript
export interface SequenceMessageRef {
  id: string;
  exchange_id: string;
  exchange_role: string;
  from_participant_id: string;
  to_participant_id: string;
  ref_kind?: string;
  ref_id?: string;
  label_text?: string;
  is_collection?: boolean;  // NEW: optional, defaults to false if missing
}
```

### 1.3 Frontend: sequenceDiagram.ts - SequenceMessage Interface

**File**: `frontend/src/types/sequenceDiagram.ts`

**Current Structure** (lines 158-179):
```typescript
export interface SequenceMessage {
  id: string;
  exchange_id: string;
  exchange_role: ExchangeRole;
  from_participant_id: string;
  to_participant_id: string;
  ref_kind?: MessageRefKind;
  ref_id?: string;
  label_text?: string;
}
```

**Updated Structure**:
```typescript
export interface SequenceMessage {
  id: string;
  exchange_id: string;
  exchange_role: ExchangeRole;
  from_participant_id: string;
  to_participant_id: string;
  ref_kind?: MessageRefKind;
  ref_id?: string;
  label_text?: string;
  is_collection?: boolean;  // NEW: optional, defaults to false if missing
}
```

### 1.4 Backward Compatibility

For existing diagrams where messages do not have the `is_collection` field:
- Treat missing field as `false`
- No migration required - field is optional with implicit default
- JSON deserialization handles missing fields gracefully via TypeScript optional property

---

## 2. Frontend: Add Message Exchange Modal UX Changes

### 2.1 Form Data Extension

**File**: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`

Extend the `FormData` interface to track collection state for both request and response.

**Current FormData** (lines 54-66):
```typescript
interface FormData {
  fromParticipantId: string;
  toParticipantId: string;
  requestMode: ContentMode;
  requestRefKind: string;
  requestRefId: string;
  requestLabelText: string;
  includeResponse: boolean;
  responseMode: ContentMode;
  responseRefKind: string;
  responseRefId: string;
  responseLabelText: string;
}
```

**Updated FormData**:
```typescript
interface FormData {
  fromParticipantId: string;
  toParticipantId: string;
  requestMode: ContentMode;
  requestRefKind: string;
  requestRefId: string;
  requestLabelText: string;
  requestIsCollection: boolean;     // NEW
  includeResponse: boolean;
  responseMode: ContentMode;
  responseRefKind: string;
  responseRefId: string;
  responseLabelText: string;
  responseIsCollection: boolean;    // NEW
}
```

**Update INITIAL_FORM_DATA** (lines 68-80):
```typescript
const INITIAL_FORM_DATA: FormData = {
  fromParticipantId: '',
  toParticipantId: '',
  requestMode: 'label',
  requestRefKind: '',
  requestRefId: '',
  requestLabelText: '',
  requestIsCollection: false,       // NEW
  includeResponse: false,
  responseMode: 'label',
  responseRefKind: '',
  responseRefId: '',
  responseLabelText: '',
  responseIsCollection: false,      // NEW
};
```

### 2.2 Helper Constants

Add constant for entity ref kinds that support collection flag:

```typescript
/**
 * MessageRefKind values that support the "Is Collection?" checkbox.
 * Only data entities can be collections.
 */
const ENTITY_REF_KINDS_SUPPORTING_COLLECTION: MessageRefKind[] = [
  'PhysicalEntity',
  'LogicalEntity',
];

/**
 * Checks if a ref_kind supports the collection flag.
 */
function supportsCollectionFlag(refKind: string | undefined): boolean {
  return ENTITY_REF_KINDS_SUPPORTING_COLLECTION.includes(refKind as MessageRefKind);
}
```

### 2.3 Checkbox Visibility Logic

The "Is Collection?" checkbox should only be visible when:
1. Content mode is "Reference" (not "Label")
2. Reference type is `PhysicalEntity` or `LogicalEntity`

```typescript
// Computed visibility for request collection checkbox
const showRequestIsCollectionCheckbox = useMemo(() => {
  return formData.requestMode === 'reference' &&
         supportsCollectionFlag(formData.requestRefKind);
}, [formData.requestMode, formData.requestRefKind]);

// Computed visibility for response collection checkbox
const showResponseIsCollectionCheckbox = useMemo(() => {
  return formData.includeResponse &&
         formData.responseMode === 'reference' &&
         supportsCollectionFlag(formData.responseRefKind);
}, [formData.includeResponse, formData.responseMode, formData.responseRefKind]);
```

### 2.4 Reset Logic on Reference Type Change

When the reference type changes away from `PhysicalEntity`/`LogicalEntity`, reset the corresponding `isCollection` flag to `false`.

Update the `handleFieldChange` callback:

```typescript
const handleFieldChange = useCallback((field: keyof FormData, value: string | boolean) => {
  setFormData(prev => {
    const next = { ...prev, [field]: value };

    // Clear refId when refKind changes
    if (field === 'requestRefKind') {
      next.requestRefId = '';
      // Reset isCollection if new refKind doesn't support it
      if (!supportsCollectionFlag(value as string)) {
        next.requestIsCollection = false;
      }
    }
    if (field === 'responseRefKind') {
      next.responseRefId = '';
      // Reset isCollection if new refKind doesn't support it
      if (!supportsCollectionFlag(value as string)) {
        next.responseIsCollection = false;
      }
    }
    // Reset isCollection when switching to label mode
    if (field === 'requestMode' && value === 'label') {
      next.requestIsCollection = false;
    }
    if (field === 'responseMode' && value === 'label') {
      next.responseIsCollection = false;
    }

    return next;
  });

  setErrors(prev => {
    const newErrors = { ...prev };
    delete newErrors[field];
    return newErrors;
  });
}, []);
```

### 2.5 UI Rendering - Request Content Section

Add checkbox below the Reference selector dropdown in the Request Content section. Insert after the Reference dropdown (around line 551):

```tsx
{/* Request Content Section */}
<div className={styles.conditionalGroup}>
  <div className={styles.conditionalLabel}>Request Content</div>

  {/* Mode Toggle */}
  {/* ... existing mode toggle code ... */}

  {formData.requestMode === 'label' ? (
    /* ... existing label input ... */
  ) : (
    <>
      {/* Reference Type dropdown */}
      <div className={styles.fieldGroup}>
        <label className={styles.label}>Reference Type</label>
        <select
          className={`${styles.select} ${errors.requestRefKind ? styles.inputError : ''}`}
          value={formData.requestRefKind}
          onChange={(e) => handleFieldChange('requestRefKind', e.target.value)}
          data-testid="field-requestRefKind"
        >
          <option value="">-- Select --</option>
          {MESSAGE_REF_KINDS.map(kind => (
            <option key={kind} value={kind}>{kind}</option>
          ))}
        </select>
        {errors.requestRefKind && (
          <span className={styles.errorMessage}>{errors.requestRefKind}</span>
        )}
      </div>

      {/* Reference dropdown (when refKind selected) */}
      {formData.requestRefKind && (
        <div className={styles.fieldGroup}>
          <label className={styles.label}>Reference</label>
          <select
            className={`${styles.select} ${errors.requestRefId ? styles.inputError : ''}`}
            value={formData.requestRefId}
            onChange={(e) => handleFieldChange('requestRefId', e.target.value)}
            data-testid="field-requestRefId"
          >
            <option value="">-- Select --</option>
            {requestRefOptions.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.name}</option>
            ))}
          </select>
          {errors.requestRefId && (
            <span className={styles.errorMessage}>{errors.requestRefId}</span>
          )}
        </div>
      )}

      {/* NEW: Is Collection checkbox - only for PhysicalEntity/LogicalEntity */}
      {showRequestIsCollectionCheckbox && (
        <div className={styles.fieldGroup}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="checkbox"
              checked={formData.requestIsCollection}
              onChange={(e) => handleFieldChange('requestIsCollection', e.target.checked)}
              data-testid="field-requestIsCollection"
            />
            Is Collection?
          </label>
        </div>
      )}
    </>
  )}
</div>
```

### 2.6 UI Rendering - Response Content Section

Add identical checkbox pattern to the Response Content section. Insert after the Response Reference dropdown:

```tsx
{/* Response Content Section (conditional) */}
{formData.includeResponse && (
  <div className={styles.conditionalGroup}>
    <div className={styles.conditionalLabel}>Response Content</div>

    {/* Mode Toggle */}
    {/* ... existing mode toggle code ... */}

    {formData.responseMode === 'label' ? (
      /* ... existing label input ... */
    ) : (
      <>
        {/* Reference Type dropdown */}
        {/* ... existing dropdown ... */}

        {/* Reference dropdown (when refKind selected) */}
        {/* ... existing dropdown ... */}

        {/* NEW: Is Collection checkbox - only for PhysicalEntity/LogicalEntity */}
        {showResponseIsCollectionCheckbox && (
          <div className={styles.fieldGroup}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                checked={formData.responseIsCollection}
                onChange={(e) => handleFieldChange('responseIsCollection', e.target.checked)}
                data-testid="field-responseIsCollection"
              />
              Is Collection?
            </label>
          </div>
        )}
      </>
    )}
  </div>
)}
```

### 2.7 Submit Handler - Include is_collection in Messages

Update the `handleSubmit` function to include `is_collection` in created messages (around lines 297-379):

```typescript
const handleSubmit = useCallback(async () => {
  if (!validateForm()) return;

  setIsSubmitting(true);

  try {
    const exchangeId = generateId('exchange');
    const messages: SequenceMessage[] = [];
    const nodes: SequenceNode[] = [];

    const baseOrderIndex = getNextOrderIndex(existingNodes, targetParentNodeId, targetOperandId);

    // Create request message
    const requestMessageId = generateId('msg');
    const requestMessage: SequenceMessage = {
      id: requestMessageId,
      exchange_id: exchangeId,
      exchange_role: 'Request',
      from_participant_id: formData.fromParticipantId,
      to_participant_id: formData.toParticipantId,
      ...(formData.requestMode === 'reference' ? {
        ref_kind: formData.requestRefKind as MessageRefKind,
        ref_id: formData.requestRefId,
        // NEW: Include is_collection only if true and refKind supports it
        ...(formData.requestIsCollection && supportsCollectionFlag(formData.requestRefKind) ? {
          is_collection: true,
        } : {}),
      } : {
        label_text: formData.requestLabelText,
      }),
    };
    messages.push(requestMessage);

    // Create request node
    const requestNodeId = generateId('node');
    const requestNode: SequenceNode = {
      id: requestNodeId,
      node_kind: 'Message',
      message_id: requestMessageId,
      order_index: baseOrderIndex,
      parent_node_id: targetParentNodeId,
      parent_operand_id: targetOperandId,
    };
    nodes.push(requestNode);

    // Create response if included
    if (formData.includeResponse) {
      const responseMessageId = generateId('msg');
      const responseMessage: SequenceMessage = {
        id: responseMessageId,
        exchange_id: exchangeId,
        exchange_role: 'Response',
        from_participant_id: formData.toParticipantId,
        to_participant_id: formData.fromParticipantId,
        ...(formData.responseMode === 'reference' ? {
          ref_kind: formData.responseRefKind as MessageRefKind,
          ref_id: formData.responseRefId,
          // NEW: Include is_collection only if true and refKind supports it
          ...(formData.responseIsCollection && supportsCollectionFlag(formData.responseRefKind) ? {
            is_collection: true,
          } : {}),
        } : {
          label_text: formData.responseLabelText,
        }),
      };
      messages.push(responseMessage);

      // Create response node
      const responseNodeId = generateId('node');
      const responseNode: SequenceNode = {
        id: responseNodeId,
        node_kind: 'Message',
        message_id: responseMessageId,
        order_index: baseOrderIndex + 1,
        parent_node_id: targetParentNodeId,
        parent_operand_id: targetOperandId,
      };
      nodes.push(responseNode);
    }

    onSubmit(messages, nodes);
  } catch (error) {
    console.error('Failed to create message exchange:', error);
    setErrors(prev => ({
      ...prev,
      _form: error instanceof Error ? error.message : 'Failed to create message exchange',
    }));
  } finally {
    setIsSubmitting(false);
  }
}, [formData, validateForm, existingNodes, targetParentNodeId, targetOperandId, onSubmit]);
```

---

## 3. Frontend: Rendering Changes

### 3.1 Update resolveMessageLabel Function

**File**: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`

The `resolveMessageLabel` function (lines 485-512) resolves the display label for messages. Update it to format collection references.

**Current Implementation**:
```typescript
export function resolveMessageLabel(
  message: SequenceMessage,
  metaModel: MetaModel
): string {
  // If ref_kind and ref_id are set, try to look up the entity name
  if (message.ref_kind && message.ref_id) {
    const collectionKey = MESSAGE_REF_KIND_TO_COLLECTION[message.ref_kind];
    if (collectionKey) {
      const collection = metaModel.entities[collectionKey];
      if (collection && Array.isArray(collection)) {
        const entity = collection.find((e: { id: string; name?: string }) => e.id === message.ref_id);
        if (entity && 'name' in entity && typeof entity.name === 'string') {
          return entity.name;
        }
      }
    }
    // Fallback to ref_id if entity not found
    return message.ref_id;
  }

  // Use label_text if available
  if (message.label_text) {
    return message.label_text;
  }

  // No label information available
  return '';
}
```

**Updated Implementation**:
```typescript
/**
 * MessageRefKind values that support the collection wrapper.
 */
const ENTITY_REF_KINDS_SUPPORTING_COLLECTION: MessageRefKind[] = [
  'PhysicalEntity',
  'LogicalEntity',
];

/**
 * Checks if a ref_kind supports the collection wrapper.
 */
function supportsCollectionWrapper(refKind: MessageRefKind | string | undefined): boolean {
  return ENTITY_REF_KINDS_SUPPORTING_COLLECTION.includes(refKind as MessageRefKind);
}

/**
 * Formats an entity name as a collection if applicable.
 *
 * @param entityName - The resolved entity name
 * @param isCollection - Whether this represents a collection
 * @param refKind - The reference kind (must be PhysicalEntity or LogicalEntity for collection format)
 * @returns Formatted label: "Collection<EntityName>" or "EntityName"
 */
function formatEntityLabel(
  entityName: string,
  isCollection: boolean | undefined,
  refKind: MessageRefKind | string | undefined
): string {
  if (isCollection && supportsCollectionWrapper(refKind)) {
    return `Collection<${entityName}>`;
  }
  return entityName;
}

/**
 * Resolves the label for a message by looking up the entity in the metaModel.
 * Falls back to label_text if ref_kind/ref_id are not set.
 * Falls back to ref_id if entity is not found.
 * Returns empty string if no label information is available.
 *
 * For PhysicalEntity/LogicalEntity references with is_collection=true,
 * wraps the label as "Collection<EntityName>".
 *
 * @param message - The message to resolve label for
 * @param metaModel - The MetaModel containing all entities
 * @returns The resolved label string
 */
export function resolveMessageLabel(
  message: SequenceMessage,
  metaModel: MetaModel
): string {
  // If ref_kind and ref_id are set, try to look up the entity name
  if (message.ref_kind && message.ref_id) {
    const collectionKey = MESSAGE_REF_KIND_TO_COLLECTION[message.ref_kind];
    if (collectionKey) {
      const collection = metaModel.entities[collectionKey];
      if (collection && Array.isArray(collection)) {
        const entity = collection.find((e: { id: string; name?: string }) => e.id === message.ref_id);
        if (entity && 'name' in entity && typeof entity.name === 'string') {
          // Apply collection formatting if applicable
          return formatEntityLabel(entity.name, message.is_collection, message.ref_kind);
        }
      }
    }
    // Fallback to ref_id if entity not found (also apply collection format)
    return formatEntityLabel(message.ref_id, message.is_collection, message.ref_kind);
  }

  // Use label_text if available (no collection formatting for label text mode)
  if (message.label_text) {
    return message.label_text;
  }

  // No label information available
  return '';
}
```

### 3.2 Rendering Behavior Summary

| Content Mode | Reference Type | is_collection | Rendered Label |
|--------------|----------------|---------------|----------------|
| Label | N/A | N/A | `${label_text}` (unchanged) |
| Reference | PhysicalEntity | `false` or missing | `${entityName}` |
| Reference | PhysicalEntity | `true` | `Collection<${entityName}>` |
| Reference | LogicalEntity | `false` or missing | `${entityName}` |
| Reference | LogicalEntity | `true` | `Collection<${entityName}>` |
| Reference | Method | any | `${entityName}` (no collection support) |
| Reference | Event | any | `${entityName}` (no collection support) |
| Reference | Interface | any | `${entityName}` (no collection support) |
| Reference | InterfaceEndpoint | any | `${entityName}` (no collection support) |
| Reference | Class | any | `${entityName}` (no collection support) |

---

## 4. Test Requirements

### 4.1 Unit Tests - AddMessageExchangeDrawer

**File**: `frontend/src/__tests__/AddMessageExchangeDrawer.isCollection.test.tsx` (new file)

```typescript
describe('AddMessageExchangeDrawer - Is Collection Support', () => {
  describe('Checkbox Visibility', () => {
    it('shows request Is Collection checkbox when mode=reference and refKind=PhysicalEntity', () => {});
    it('shows request Is Collection checkbox when mode=reference and refKind=LogicalEntity', () => {});
    it('hides request Is Collection checkbox when mode=label', () => {});
    it('hides request Is Collection checkbox when refKind=Method', () => {});
    it('hides request Is Collection checkbox when refKind=Event', () => {});
    it('hides request Is Collection checkbox when refKind=Interface', () => {});
    it('hides request Is Collection checkbox when refKind=InterfaceEndpoint', () => {});
    it('hides request Is Collection checkbox when refKind=Class', () => {});

    it('shows response Is Collection checkbox when includeResponse=true, mode=reference, refKind=LogicalEntity', () => {});
    it('hides response Is Collection checkbox when includeResponse=false', () => {});
  });

  describe('Reset Behavior', () => {
    it('resets requestIsCollection to false when requestRefKind changes from LogicalEntity to Method', () => {});
    it('resets requestIsCollection to false when requestMode changes from reference to label', () => {});
    it('resets responseIsCollection to false when responseRefKind changes away from entity type', () => {});
  });

  describe('Submit Behavior', () => {
    it('includes is_collection=true on request message when checkbox is checked', () => {});
    it('omits is_collection field when checkbox is unchecked', () => {});
    it('includes is_collection=true on response message when checkbox is checked', () => {});
  });
});
```

### 4.2 Unit Tests - resolveMessageLabel

**File**: `frontend/src/__tests__/SequenceDiagramRenderer.resolveMessageLabel.test.ts` (new or extend existing)

```typescript
describe('resolveMessageLabel - Collection Support', () => {
  describe('PhysicalEntity references', () => {
    it('returns "EntityName" when is_collection is false', () => {});
    it('returns "EntityName" when is_collection is undefined', () => {});
    it('returns "Collection<EntityName>" when is_collection is true', () => {});
  });

  describe('LogicalEntity references', () => {
    it('returns "EntityName" when is_collection is false', () => {});
    it('returns "Collection<EntityName>" when is_collection is true', () => {});
  });

  describe('Non-entity references', () => {
    it('returns "MethodName" for Method ref even when is_collection is true', () => {});
    it('returns "EventName" for Event ref even when is_collection is true', () => {});
  });

  describe('Label text mode', () => {
    it('returns label_text unchanged regardless of is_collection value', () => {});
  });

  describe('Fallback behavior', () => {
    it('returns "Collection<ref_id>" when entity not found but is_collection is true', () => {});
  });
});
```

### 4.3 Integration Tests

**File**: `frontend/src/__tests__/SequenceDiagramCollection.integration.test.tsx` (new file)

```typescript
describe('Sequence Diagram Collection Entity Display - Integration', () => {
  it('renders Collection<Order> label for PhysicalEntity with is_collection=true', () => {});
  it('renders Collection<Customer> label for LogicalEntity with is_collection=true', () => {});
  it('renders Order label for PhysicalEntity with is_collection=false', () => {});
  it('handles mixed messages: one collection, one not', () => {});
  it('backward compatibility: existing messages without is_collection render normally', () => {});
});
```

---

## 5. Implementation Tasks

### Task 1: Backend Model Update
1. Update `SequenceMessageDto.java` to add `is_collection` field
2. Verify JSON serialization/deserialization works correctly
3. Test backward compatibility with existing data

### Task 2: Frontend Type Updates
1. Update `SequenceMessageRef` in `typedContent.ts`
2. Update `SequenceMessage` in `sequenceDiagram.ts`
3. Verify TypeScript compilation succeeds

### Task 3: AddMessageExchangeDrawer Updates
1. Extend `FormData` interface
2. Add helper constants and functions
3. Add checkbox visibility logic
4. Update `handleFieldChange` for reset behavior
5. Add checkbox UI elements
6. Update `handleSubmit` to include `is_collection`

### Task 4: Renderer Updates
1. Add `supportsCollectionWrapper` helper
2. Add `formatEntityLabel` helper
3. Update `resolveMessageLabel` function

### Task 5: Testing
1. Create unit tests for AddMessageExchangeDrawer
2. Create/extend unit tests for resolveMessageLabel
3. Create integration tests
4. Manual testing with various scenarios

---

## 6. Files to Modify

| File | Change Type | Description |
|------|-------------|-------------|
| `architecture-model-service/.../SequenceMessageDto.java` | Modify | Add `is_collection` Boolean field |
| `frontend/src/types/typedContent.ts` | Modify | Add `is_collection` to SequenceMessageRef |
| `frontend/src/types/sequenceDiagram.ts` | Modify | Add `is_collection` to SequenceMessage |
| `frontend/src/components/.../AddMessageExchangeDrawer.tsx` | Modify | Add checkbox UI and submit logic |
| `frontend/src/components/.../SequenceDiagramRenderer.tsx` | Modify | Update label resolution |
| `frontend/src/__tests__/AddMessageExchangeDrawer.isCollection.test.tsx` | Create | New test file |
| `frontend/src/__tests__/SequenceDiagramRenderer.resolveMessageLabel.test.ts` | Modify/Create | Add collection tests |
| `frontend/src/__tests__/SequenceDiagramCollection.integration.test.tsx` | Create | New integration test file |

---

## 7. Acceptance Criteria

1. **Modal UX**: When adding a message exchange with Reference mode and PhysicalEntity/LogicalEntity type, an "Is Collection?" checkbox appears below the reference selector
2. **Default Behavior**: Checkbox defaults to unchecked
3. **Reset Behavior**: Changing reference type away from PhysicalEntity/LogicalEntity resets the checkbox to unchecked
4. **Rendering**: Messages with `is_collection=true` and PhysicalEntity/LogicalEntity reference display as `Collection<EntityName>`
5. **Backward Compatibility**: Existing diagrams without `is_collection` field render normally (treated as false)
6. **Persistence**: The `is_collection` flag persists correctly through save/load cycles
7. **Type Safety**: All TypeScript interfaces updated correctly with optional boolean field
