# Requirements: Sequence Diagram Canvas Rendering v1

## Intent

- Render Sequence diagrams visually on the main diagram canvas, driven entirely by the existing Sequence Editor data:
    - Participants as headers (box or user stickman) + vertical lifelines
    - Message exchanges as horizontal arrows (request solid, response dashed)
    - Fragment frames (Loop/Optional/Alternative) drawn around nested nodes/operands
- Update live: canvas rerenders immediately when participants/messages/fragments change in RHS.
- Add a toolbar control for participant horizontal spacing.

## Scope

### In Scope

- Frontend diagram canvas rendering for `diagram.type == 'Sequence'`
- Frontend toolbar: participant spacing numeric input
- Sequence rendering uses typedContent or current sequence editor state as source of truth

### Out of Scope

- Advanced UML features (activation bars, self-calls, async arrowheads)
- Auto-layout optimization
- Zoom/scroll implementation beyond what already exists

## Acceptance Criteria

- Selecting a diagram of type Sequence renders:
    - All participants in order (left→right)
    - A lifeline for each participant
    - All message arrows in sequence order (top→bottom)
    - Request arrows are solid
    - Response arrows are dashed
    - Labels are centered above arrows
- Participant header:
    - User participants render as the existing stickman style used for users in General diagrams, with name below
    - All other participants render as a fixed width 150px header box with wrapped text
- Lifeline height is computed from rendered content (messages + fragments) and extends beyond the last row.
- Row spacing is fixed at 60px per rendered row.
- Toolbar includes "Participant spacing" numeric input that updates spacing immediately.
- Fragment frames render for Loop/Optional/Alternative with operand guards and correct vertical containment of child nodes.

---

## DATA INPUTS (SOURCE OF TRUTH)

Use the current SequenceDiagram content already in state (same data backing RHS editor):
- `participants[]` with orderIndex
- `messages[]` with exchangeId + exchangeRole + from/to participant ids + (refKind/refId or labelText)
- `fragments[]` with fragmentKind
- `operands[]` with fragmentId + guardExpression + operandIndex
- `sequenceNodes[]` describing nesting + orderIndex + parentNodeId + parentOperandId

### Normalization Rules for Rendering

- Participants sorted by orderIndex ascending
- Top-level sequenceNodes: parentNodeId == null
- Child nodes: grouped by (parentNodeId, parentOperandId), sorted by orderIndex

---

## FRONTEND IMPLEMENTATION

### 1) Add Sequence Render Mode Switch

**File:** Diagram canvas renderer entry point (e.g. DiagramCanvas / DiagramRenderer)

- If `activeDiagram.type !== 'Sequence'`: keep existing rendering path unchanged.
- If `activeDiagram.type === 'Sequence'`: render via new SequenceDiagramRenderer component/module.

### 2) Toolbar: Participant Spacing Control

**File:** Diagram toolbar component

- Add label + numeric input: "Participant spacing"
- Default value: 220 (or current best-fit)
- Min: 120
- Max: 600
- Step: 10
- Store in diagram view state:
    - Preferably within diagram settings for that diagram type (persisted with diagram if you already persist settings)
    - Else local UI state (acceptable v1)
- Any change triggers immediate rerender.

### 3) Layout Model (computed each render)

Create a pure function:
```typescript
computeSequenceLayout(sequenceDiagram, participantSpacing, canvasWidth, margins)
```

**Constants:**
- headerBoxWidth = 150
- headerBoxHeight = 50 (box)
- userHeaderHeight = 70 (stickman + label)
- topMargin = 40
- leftMargin = 60
- rowHeight = 60
- lifelineTopY = topMargin + headerAreaHeight + 10
- messageStartY = lifelineTopY + 30

**Participant X positions:**
- participantX[i] = leftMargin + i * participantSpacing
- lifelineX is centerline of header:
    - for box: x + headerBoxWidth/2
    - for stickman: treat same width as box for alignment; lifelineX = participantX + headerBoxWidth/2

**Content rows:**
- Rendered order is derived from a DFS traversal of sequenceNodes:
    - A node of kind Message consumes 1 row
    - A node of kind Fragment consumes 0 rows itself (frame boundary), but its children consume rows
- While traversing, assign each Message node a y = messageStartY + rowIndex * rowHeight
- Fragment vertical extent:
    - startRow = first row index among descendant Message nodes
    - endRow = last row index among descendant Message nodes
- If fragment has no messages yet:
    - render a minimal frame height of 1 row (rowHeight) as placeholder.

**Lifeline height:**
- lifelineBottomY = messageStartY + max(1, messageRowCount) * rowHeight + 60

### 4) Rendering Primitives

Implement in SequenceDiagramRenderer:

#### 4.1 Participants

For each participant:
- Resolve display name:
    - ref.name from loaded meta-model entity referenced by (refKind, refId)
    - fallback: refId
- If refKind indicates "User" (BusinessUser or User):
    - Render stickman using existing user node drawing style (reuse code)
    - Render name text below
- Else:
    - Render header rectangle: width 150px, height 50px, centered on participantX position
    - Text wrapped inside (simple wrap algorithm; v1 can split by space into 2 lines max)
- Draw lifeline: black vertical line from lifelineTopY to lifelineBottomY at lifelineX

#### 4.2 Messages (request/response)

- Build exchanges grouped by exchangeId: `exchanges[exchangeId] = { request?: msg, response?: msg }`
- Use sequenceNodes order to render messages:
    - For each Message node:
        - Find message by messageId
        - Compute y from layout
        - fromX = lifelineX(fromParticipant)
        - toX = lifelineX(toParticipant)
        - Draw horizontal line with arrowhead pointing to toX
        - If exchangeRole == 'Response': dashed stroke
        - Label text:
            - If msg.refKind/refId set: resolve referenced entity name
            - Else: msg.labelText
        - Render centered at (fromX+toX)/2, y-12, with baseline alignment

#### 4.3 Fragments + Operands

Render fragment frames after computing row extents (so they sit behind messages):

For each Fragment node:
- Determine horizontal span:
    - v1: span from first participant lifelineX - 80 to last lifelineX + 80
- Determine vertical span:
    - topY = yAtRow(startRow) - 30
    - bottomY = yAtRow(endRow) + 30
- Draw rectangle frame (thin black stroke)
- Draw fragment label in top-left inside frame: text = fragmentKind lowercased ("loop", "opt", "alt")
- Operand rendering:
    - Get operands for fragment sorted by operandIndex
    - If fragmentKind != Alternative:
        - Show guard text for operandIndex=0 beneath label: "[guardExpression]"
    - If fragmentKind == Alternative:
        - Split frame vertically into operand regions stacked: regionHeight = (bottomY-topY) / operandCount
        - Draw horizontal separators between regions
        - Render each operand guard at top-left of its region: "[guardExpression]"

Containment mapping:
- sequenceNodes already define membership via parentNodeId + parentOperandId
- For frame row extents: compute using descendant messages from nodes under that fragment node

### 5) Live Update Wiring

- Ensure the SequenceDiagramRenderer is fed from the same reactive state as the RHS editor.
- On any change to: participants, messages, fragments, operands, sequenceNodes, participantSpacing → rerender immediately.
- No manual refresh button.

### 6) Persistence (no new backend changes required)

If you are persisting typedContent already, ensure participantSpacing is persisted:
- Add to diagram settings JSON: `settings.sequence = { participantSpacing: number }`
- OR store under typedContent (top-level): `{ type, version, content, rendering: { participantSpacing } }`
- Choose ONE: Preferred: diagram.settings_json already exists → store there.
- Default spacing if missing = 220.

---

## EDGE CASES / FALLBACKS

- If participants < 1: render empty canvas message "Add participants to begin".
- If a message references missing participantId: skip rendering that message and log to console (do not crash).
- If referenced meta-model name cannot be resolved: label fallback = refId.
- Text wrapping: v1: wrap to max 3 lines, else ellipsis.

---

## MANUAL VERIFICATION

1. Create Sequence diagram
2. Add 4 participants (including a User)
   - Verify header styles and lifelines
3. Add a request+response exchange
   - Verify two arrows, response dashed
   - Verify label centered above each arrow
4. Add a Loop fragment around 2 messages (operand guard shown)
5. Add an Alt fragment with 2 operands (two regions separated, each guard shown)
6. Change participant spacing in toolbar and confirm live layout updates

---

## Deliverables

- Sequence diagram canvas renderer v1 (participants/lifelines/messages/fragments)
- Participant spacing toolbar control with immediate rerender and persistence (settings or typedContent)
