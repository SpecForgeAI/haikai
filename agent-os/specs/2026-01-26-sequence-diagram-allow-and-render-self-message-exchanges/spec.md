# Spec: Sequence Diagram Self-Message Exchanges

**Spec Name**: sequence-diagram-allow-and-render-self-message-exchanges
**Scope**: frontend
**Type**: ux-validation-change + visual-rendering-enhancement
**Created**: 2026-01-26

## Overview

Allow Sequence Diagram message exchanges where the source and target participants are the same (self-messages), and render them as UML-style loopback arrows to represent internal processing. When a self-message is selected in the Add Message Exchange modal, disable response-message configuration and display a warning.

## Problem Statement

Currently, the Add Message Exchange drawer enforces that `fromParticipantId !== toParticipantId`, preventing users from modeling self-calls or internal processing within a single participant. This is a legitimate UML sequence diagram construct that architects need to represent recursive calls, internal state changes, or self-invocations.

## Goals

1. Allow users to create message exchanges where the source and target participant are the same
2. Render self-messages as UML-standard loopback arrows (out-down-back pattern)
3. Prevent response messages for self-calls (they don't make sense conceptually)
4. Maintain backward compatibility with existing diagrams

## Non-Goals

- Do not introduce configurable styling for self-messages
- Do not add support for self-message responses (response remains disabled when source==target)
- Do not alter message ordering or sequencing logic
- Do not change the sequence diagram data model
- Do not change non-self message exchange rendering
- Do not change fragments, participants, lifelines, or layout spacing beyond the self-loop shape
- Do not change export/print behavior in this increment

## Technical Context

### Relevant Files

| File | Purpose |
|------|---------|
| `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx` | Modal for creating message exchanges - validation logic |
| `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx` | Renders sequence diagram elements including message arrows |
| `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.module.css` | CSS styles used by AddMessageExchangeDrawer |
| `frontend/src/utils/sequenceLayout.ts` | Layout computation for sequence diagram elements |
| `frontend/src/types/sequenceDiagram.ts` | TypeScript types for sequence diagram data model |

### Current Behavior

**AddMessageExchangeDrawer.tsx** (lines 240-242):
```typescript
if (formData.fromParticipantId === formData.toParticipantId && formData.fromParticipantId) {
  newErrors.toParticipantId = 'To participant must be different from From';
}
```

**SequenceDiagramRenderer.tsx** - The `MessageArrow` component (lines 906-951) renders a horizontal line from `fromX` to `toX` with an arrowhead. It assumes `fromX !== toX` (distinct participants).

### Data Model (No Changes Required)

The `SequenceMessage` interface already supports `from_participant_id === to_participant_id`:
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

## Implementation Plan

### Task Group 1: Modal Validation and UX Changes

**File**: `frontend/src/components/DiagramsView/SequenceEditor/AddMessageExchangeDrawer.tsx`

#### 1.1 Remove Same-Participant Validation

**Location**: `validateForm` function (around line 230)

Remove the validation check that prevents same-participant selection:

```typescript
// REMOVE THIS BLOCK:
if (formData.fromParticipantId === formData.toParticipantId && formData.fromParticipantId) {
  newErrors.toParticipantId = 'To participant must be different from From';
}
```

#### 1.2 Compute isSelfMessage Flag

Add a computed value to detect self-message state. This should be a `useMemo` or derived value:

**Location**: After form state declarations (around line 188)

```typescript
// Detect if this is a self-message (from === to)
const isSelfMessage = useMemo(() => {
  return (
    formData.fromParticipantId !== '' &&
    formData.toParticipantId !== '' &&
    formData.fromParticipantId === formData.toParticipantId
  );
}, [formData.fromParticipantId, formData.toParticipantId]);
```

#### 1.3 Auto-Disable Response When Self-Message

When `isSelfMessage` becomes true, automatically disable and uncheck the "Include Response Message" checkbox.

**Location**: Add a `useEffect` after the `isSelfMessage` computation:

```typescript
// When self-message is detected, disable response
useEffect(() => {
  if (isSelfMessage && formData.includeResponse) {
    setFormData(prev => ({ ...prev, includeResponse: false }));
  }
}, [isSelfMessage]);
```

#### 1.4 Add Self-Message Warning Text

**Location**: Directly above the "Include Response Message" checkbox (around line 538)

Add conditional warning text when `isSelfMessage` is true:

```tsx
{/* Self-message warning */}
{isSelfMessage && (
  <span
    className={styles.selfMessageWarning}
    data-testid="self-message-warning"
  >
    Source Participant and To Participant are the same
  </span>
)}

{/* Include Response Checkbox */}
<div className={styles.fieldGroup}>
  <label style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
    <input
      type="checkbox"
      checked={formData.includeResponse}
      onChange={(e) => handleFieldChange('includeResponse', e.target.checked)}
      disabled={isSelfMessage}
      data-testid="field-includeResponse"
    />
    Include Response Message
  </label>
</div>
```

#### 1.5 Add CSS for Self-Message Warning

**File**: `frontend/src/components/DiagramsView/CreateAndPlaceDrawer.module.css`

Add a new style class for the self-message warning:

```css
/* Self-message warning text */
.selfMessageWarning {
  font-size: 12px;
  color: #d32f2f;
  display: block;
  margin-bottom: 4px;
}
```

### Task Group 2: Self-Message Rendering (Loopback Arrow)

**File**: `frontend/src/components/DiagramsView/SequenceDiagramRenderer.tsx`

#### 2.1 Add Self-Message Layout Constants

**Location**: After existing message arrow constants (around line 316)

```typescript
// ============================================================================
// Self-Message (Loopback Arrow) Constants
// ============================================================================

/** Horizontal extent of the loopback arrow from lifeline */
const SELF_MESSAGE_LOOP_WIDTH = 40;

/** Vertical height of the loopback arrow */
const SELF_MESSAGE_LOOP_HEIGHT = 30;
```

#### 2.2 Create SelfMessageArrow Component

**Location**: After the `MessageArrow` component (around line 951)

Create a new component for rendering self-message loopback arrows:

```tsx
// ============================================================================
// Self-Message Loopback Arrow Component
// ============================================================================

interface SelfMessageArrowProps {
  layout: MessageLayout;
  label: string;
}

/**
 * Renders a self-message as a loopback arrow.
 * The loopback consists of:
 * - Horizontal segment leaving the lifeline to the right
 * - Vertical segment going downward
 * - Horizontal segment returning back to the lifeline
 * - Arrowhead pointing back to the lifeline
 *
 * Label is positioned above the initial (top) horizontal segment.
 */
const SelfMessageArrow: React.FC<SelfMessageArrowProps> = ({ layout, label }) => {
  const { strokeWidth, strokeDasharray } = getMessageStrokeStyle(layout.exchangeRole);

  // The lifeline X position (fromX and toX are the same for self-messages)
  const lifelineX = layout.fromX;
  const baseY = layout.y;

  // Calculate loopback path points
  const rightX = lifelineX + SELF_MESSAGE_LOOP_WIDTH;
  const bottomY = baseY + SELF_MESSAGE_LOOP_HEIGHT;

  // Path: start at lifeline, go right, go down, return left to lifeline
  // M = move to start
  // L = line to point
  const pathD = `
    M ${lifelineX} ${baseY}
    L ${rightX} ${baseY}
    L ${rightX} ${bottomY}
    L ${lifelineX} ${bottomY}
  `;

  // Arrowhead pointing left (back to lifeline) on the bottom segment
  const arrowheadPath = calculateArrowhead(
    rightX,
    bottomY,
    lifelineX,
    bottomY,
    ARROWHEAD_SIZE
  );

  // Label positioned above the top horizontal segment
  const labelX = lifelineX + SELF_MESSAGE_LOOP_WIDTH / 2;
  const labelY = baseY - MESSAGE_LABEL_OFFSET_Y;

  return (
    <g className="sequence-message sequence-self-message" data-message-id={layout.messageId}>
      {/* Loopback path (without fill, stroke only) */}
      <path
        d={pathD}
        fill="none"
        stroke={MESSAGE_STROKE_COLOR}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray || undefined}
      />
      {/* Arrowhead on the returning segment */}
      <path
        d={arrowheadPath}
        fill={MESSAGE_STROKE_COLOR}
        stroke={MESSAGE_STROKE_COLOR}
        strokeWidth={1}
      />
      {/* Label above the initial outgoing segment */}
      {label && (
        <text
          x={labelX}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="auto"
          fontSize={MESSAGE_LABEL_FONT_SIZE}
          fill="#333"
        >
          {label}
        </text>
      )}
    </g>
  );
};
```

#### 2.3 Add Self-Message Detection Helper

**Location**: After the `shouldRenderMessage` function (around line 452)

```typescript
/**
 * Checks if a message is a self-message (same source and target participant).
 *
 * @param message - The message to check
 * @returns true if from_participant_id === to_participant_id
 */
export function isSelfMessage(message: SequenceMessage): boolean {
  return message.from_participant_id === message.to_participant_id;
}
```

#### 2.4 Update Message Rendering Logic

**Location**: In the main component's message rendering section (around line 1141)

Update the message rendering logic to choose between regular and self-message rendering:

```tsx
{/* Task Group 3: Render message arrows */}
{layout.messageLayouts.map((messageLayout) => {
  const message = messageMap.get(messageLayout.messageId);
  if (!message) {
    return null;
  }

  // Check if message should be rendered (participants exist)
  const renderCheck = shouldRenderMessage(message, participantIdSet);
  if (!renderCheck.shouldRender) {
    // Log warning and skip rendering
    console.warn(
      `[SequenceDiagramRenderer] Skipping message '${message.id}': ${renderCheck.reason}`
    );
    return null;
  }

  const label = messageLabels.get(messageLayout.messageId) || '';

  // Check if this is a self-message
  if (isSelfMessage(message)) {
    return (
      <SelfMessageArrow
        key={messageLayout.messageId}
        layout={messageLayout}
        label={label}
      />
    );
  }

  return (
    <MessageArrow
      key={messageLayout.messageId}
      layout={messageLayout}
      label={label}
    />
  );
})}
```

### Task Group 3: Layout Adjustments for Self-Messages

**File**: `frontend/src/utils/sequenceLayout.ts`

The existing layout code sets `fromX` and `toX` to the same value when `from_participant_id === to_participant_id`. This is correct behavior - the renderer will use this single X value as the lifeline position for the loopback arrow.

**No changes required to sequenceLayout.ts** - the existing implementation already handles this case correctly by setting both `fromX` and `toX` to the same lifeline position.

## Testing Requirements

### Unit Tests

#### AddMessageExchangeDrawer Tests

**File**: `frontend/src/__tests__/AddMessageExchangeDrawer.selfMessage.test.tsx` (new file)

```typescript
describe('AddMessageExchangeDrawer - Self-Message Support', () => {
  describe('validation', () => {
    it('allows selecting the same participant for From and To', async () => {
      // Select same participant for both dropdowns
      // Verify no validation error appears
      // Verify save button is enabled
    });

    it('clears previous validation errors when changing to self-message', async () => {
      // Previously had different participants
      // Change To to match From
      // Verify no error on toParticipantId
    });
  });

  describe('response message handling', () => {
    it('disables Include Response checkbox when From === To', async () => {
      // Select same participant
      // Verify checkbox is disabled
    });

    it('unchecks Include Response when changing to self-message', async () => {
      // Start with response enabled and different participants
      // Change To to match From
      // Verify checkbox is unchecked and disabled
    });

    it('re-enables Include Response when changing back to different participants', async () => {
      // Start with self-message
      // Change To to different participant
      // Verify checkbox is enabled
    });
  });

  describe('warning text', () => {
    it('shows warning text when From === To', async () => {
      // Select same participant
      // Verify warning text is displayed
      // Verify exact text: "Source Participant and To Participant are the same"
    });

    it('hides warning text when From !== To', async () => {
      // Select different participants
      // Verify warning text is not displayed
    });

    it('displays warning text above the Include Response checkbox', async () => {
      // Verify DOM order: warning appears before checkbox
    });
  });

  describe('form submission', () => {
    it('creates message with same from/to participant IDs', async () => {
      // Select same participant
      // Enter label text
      // Submit
      // Verify onSubmit called with message where from_participant_id === to_participant_id
    });

    it('does not create response message for self-message', async () => {
      // Select same participant
      // Submit
      // Verify only one message created (no response)
    });
  });
});
```

#### SequenceDiagramRenderer Tests

**File**: `frontend/src/__tests__/SequenceDiagramRenderer.selfMessage.test.tsx` (new file)

```typescript
describe('SequenceDiagramRenderer - Self-Message Rendering', () => {
  describe('isSelfMessage helper', () => {
    it('returns true when from_participant_id === to_participant_id', () => {
      const message = { from_participant_id: 'p1', to_participant_id: 'p1' };
      expect(isSelfMessage(message)).toBe(true);
    });

    it('returns false when from_participant_id !== to_participant_id', () => {
      const message = { from_participant_id: 'p1', to_participant_id: 'p2' };
      expect(isSelfMessage(message)).toBe(false);
    });
  });

  describe('loopback arrow rendering', () => {
    it('renders self-message as SelfMessageArrow component', () => {
      // Create diagram with self-message
      // Render
      // Verify SelfMessageArrow is rendered (check for .sequence-self-message class)
    });

    it('renders regular message as MessageArrow component', () => {
      // Create diagram with regular message
      // Render
      // Verify MessageArrow is rendered (no .sequence-self-message class)
    });

    it('renders loopback path with correct shape', () => {
      // Render self-message
      // Verify path element exists
      // Verify path goes: right, down, left (loopback pattern)
    });

    it('positions arrowhead on the returning segment pointing to lifeline', () => {
      // Render self-message
      // Verify arrowhead path exists
      // Verify arrowhead points leftward
    });

    it('positions label above the initial horizontal segment', () => {
      // Render self-message with label
      // Verify text element exists
      // Verify text y position is above the message y
    });
  });

  describe('stroke styling', () => {
    it('uses solid stroke for Request self-message', () => {
      // Render Request self-message
      // Verify no strokeDasharray
    });

    it('uses dashed stroke for Response self-message', () => {
      // This shouldn't happen per UX rules, but test the styling anyway
      // Render Response self-message
      // Verify strokeDasharray is set
    });
  });

  describe('backward compatibility', () => {
    it('renders existing diagrams without self-messages unchanged', () => {
      // Load existing diagram
      // Render
      // Verify all messages render as MessageArrow
    });
  });
});
```

### Integration Tests

**File**: `frontend/src/__tests__/SequenceDiagramSelfMessage.integration.test.tsx` (new file)

```typescript
describe('Self-Message Integration', () => {
  it('end-to-end: create self-message via drawer and render in diagram', async () => {
    // 1. Open AddMessageExchangeDrawer
    // 2. Select participant A for both From and To
    // 3. Enter label "processInternal()"
    // 4. Verify warning shown, response disabled
    // 5. Submit
    // 6. Verify message added to diagram state
    // 7. Verify diagram renders loopback arrow
    // 8. Verify label "processInternal()" appears above arrow
  });

  it('mixed diagram with regular and self-messages renders correctly', async () => {
    // Create diagram with:
    // - Regular message A -> B
    // - Self-message B -> B
    // - Regular message B -> A
    // Verify all three render correctly with appropriate arrow styles
  });
});
```

## Visual Reference

### Self-Message Loopback Arrow

```
    Participant A
         |
         |--- label text
         |=====>|
         |      |
         |      v
         |<======
         |
         |
```

The loopback arrow:
1. Starts at the lifeline at the message's Y position
2. Goes horizontally to the right (40px)
3. Goes vertically downward (30px)
4. Returns horizontally to the lifeline
5. Arrowhead points back at the lifeline on the returning segment
6. Label text is positioned above the initial outgoing horizontal segment

### Add Message Exchange Drawer - Self-Message State

```
+-------------------------------------------+
| Add Message Exchange                    X |
+-------------------------------------------+
|                                           |
| From Participant *                        |
| [Service A                           v]   |
|                                           |
| To Participant *                          |
| [Service A                           v]   |
|                                           |
| Request Content                           |
| ...                                       |
|                                           |
| Source Participant and To Participant     |
| are the same                              |  <-- Red warning text
| [ ] Include Response Message              |  <-- Disabled checkbox
|                                           |
+-------------------------------------------+
|                     [Cancel] [Add Message]|
+-------------------------------------------+
```

## Acceptance Criteria

- [ ] Users can save a message exchange where From == To without validation errors
- [ ] When From == To in the modal:
  - [ ] "Include Response Message" checkbox is disabled
  - [ ] "Include Response Message" checkbox is unchecked automatically
  - [ ] Red helper text "Source Participant and To Participant are the same" is displayed above the checkbox
- [ ] In the diagram, self-messages render as a loopback arrow:
  - [ ] Horizontal segment leaves the lifeline to the right
  - [ ] Vertical segment goes downward
  - [ ] Horizontal segment returns back to the lifeline
  - [ ] Arrowhead points back at the lifeline on the returning segment
- [ ] The message label appears above the initial outgoing horizontal segment
- [ ] Existing diagrams continue to render without regression
- [ ] Regular (non-self) messages continue to render as horizontal arrows unchanged

## Dependencies

None - this is a self-contained frontend enhancement.

## Migration Notes

No migration required. Existing diagrams with only regular messages will render exactly as before. The data model already supports self-messages; only the validation and rendering were preventing their use.
