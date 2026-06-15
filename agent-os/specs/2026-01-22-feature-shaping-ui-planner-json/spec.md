# Specification: Feature Shaping UI Consumes Planner JSON

## Overview

**Spec ID:** 2026-01-22-feature-shaping-ui-planner-json
**Status:** Draft
**Module:** Frontend (React/TypeScript)

This specification updates the Implementation Assistant Panel to render a Feature Definition area driven by the Planner's structured JSON output (`PlannerResponse`), presenting a single merged, human-readable feature definition while keeping conversational chat separate.

---

## Background

### Current Implementation

The Implementation Assistant Panel currently:
- Renders all chat messages (user and assistant) in a single chat bubble list
- Displays full assistant response content in bubbles (including structured sections)
- Has a handoff plan panel that appears after the handoff phase
- Extracts "PROPOSED" definition from text using regex patterns

### Problems with Current Approach

1. **No structured feature view** - Feature definition is buried in chat bubbles
2. **Chat is cluttered** - Structured content mixed with conversational messages
3. **Text parsing is fragile** - Regex extraction of "PROPOSED" marker is error-prone
4. **No progressive refinement display** - Can't see feature evolving during shaping

---

## Goals

1. **Structured Feature Display** - Render feature definition from `PlannerResponse` fields
2. **Separated Concerns** - Feature Definition (left) vs Team Chat (right)
3. **Progressive Refinement** - Feature sections update as planner responds
4. **Clean Chat** - Chat bubbles show only conversational `message` text
5. **Resilient Rendering** - Graceful empty states when fields are missing

---

## UI Layout

### Main Layout Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│ Implementation Assistant                                      [X]   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────┐  ┌──────────────────────────────┐ │
│  │                             │  │                              │ │
│  │   FEATURE DEFINITION        │  │   TEAM CHAT                  │ │
│  │   (60% width)               │  │   (40% width)                │ │
│  │                             │  │                              │ │
│  │   ┌───────────────────────┐ │  │   [User bubble]              │ │
│  │   │ Feature: Title        │ │  │   [Assistant bubble]         │ │
│  │   └───────────────────────┘ │  │   [User bubble]              │ │
│  │                             │  │   ...                        │ │
│  │   [Description Card]        │  │                              │ │
│  │   [Understanding Card]      │  │                              │ │
│  │   [Scope Cards]             │  │                              │ │
│  │   [Acceptance Criteria]     │  │                              │ │
│  │   [Assumptions]             │  │                              │ │
│  │                             │  │                              │ │
│  └─────────────────────────────┘  └──────────────────────────────┘ │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│ [Message Input]                              [Send] [Implement]     │
└─────────────────────────────────────────────────────────────────────┘
```

### Responsive Behavior

- **Desktop (>1200px):** Side-by-side panels (60/40 split)
- **Tablet (768-1200px):** Stacked layout (Feature on top, Chat below)
- **Mobile (<768px):** Tabs to switch between Feature and Chat views

---

## Feature Definition Area

### Feature Header

**Position:** Top of Feature Definition panel (dark banner)

```tsx
<div className={styles.featureHeader}>
  <span className={styles.featureLabel}>Feature:</span>
  <span className={styles.featureTitle}>{workItemTitle}</span>
</div>
```

**Styling:**
- Background: Dark gray (#2D2D2D)
- Text: White
- Padding: 12px 16px
- Font: Bold, 16px

---

### Section Cards

Each section is rendered as a card with consistent styling:

```tsx
interface FeatureSectionCardProps {
  title: string;
  children: React.ReactNode;
  isEmpty?: boolean;
  emptyMessage?: string;
}
```

**Card Styling:**
- Background: White
- Border: 1px solid #E0E0E0
- Border-radius: 8px
- Margin-bottom: 16px
- Padding: 16px

**Section Header:**
- Font: Semi-bold, 14px
- Color: #333
- Margin-bottom: 12px
- Border-bottom: 1px solid #F0F0F0

---

### Section: Description (Work Item)

**Source:** `workItemDescription` prop (immutable)

```tsx
<FeatureSectionCard title="Description">
  <p className={styles.description}>{workItemDescription}</p>
</FeatureSectionCard>
```

**Behavior:**
- Always visible
- Read-only (never changes based on planner output)
- Shows original work item description as historical context

---

### Section: Product Owner Understanding

**Source:** `plannerResponse.featureUnderstanding`

```tsx
<FeatureSectionCard
  title="Product Owner Understanding"
  isEmpty={!featureUnderstanding}
  emptyMessage="Waiting for Product Owner understanding..."
>
  <p className={styles.understanding}>{featureUnderstanding}</p>
</FeatureSectionCard>
```

**Behavior:**
- Updates whenever new valid `plannerResponse` is received
- Shows empty state placeholder when not yet populated
- This is the primary evolving definition

---

### Section: Scope

**Source:** `plannerResponse.scope.in[]`

```tsx
{scope.in.length > 0 && (
  <FeatureSectionCard title="Scope">
    <ul className={styles.bulletList}>
      {scope.in.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  </FeatureSectionCard>
)}
```

**Behavior:**
- Hidden if `scope.in` array is empty
- Renders as bullet list

---

### Section: Out of Scope

**Source:** `plannerResponse.scope.out[]`

```tsx
{scope.out.length > 0 && (
  <FeatureSectionCard title="Out of Scope">
    <ul className={styles.bulletList}>
      {scope.out.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  </FeatureSectionCard>
)}
```

**Behavior:**
- Hidden if `scope.out` array is empty
- Renders as bullet list

---

### Section: Acceptance Criteria

**Source:** `plannerResponse.acceptanceCriteria[]`

```tsx
<FeatureSectionCard
  title="Acceptance Criteria"
  isEmpty={acceptanceCriteria.length === 0}
  emptyMessage="No acceptance criteria defined yet."
>
  <ol className={styles.numberedList}>
    {acceptanceCriteria.map((criterion, index) => (
      <li key={index}>{criterion}</li>
    ))}
  </ol>
</FeatureSectionCard>
```

**Behavior:**
- Always visible (shows empty state if no criteria)
- Renders as numbered list
- Read-only at this stage

---

### Section: Assumptions

**Source:** `plannerResponse.assumptions[]`

```tsx
{assumptions.length > 0 && (
  <FeatureSectionCard title="Assumptions">
    <ul className={styles.bulletList}>
      {assumptions.map((assumption, index) => (
        <li key={index}>{assumption}</li>
      ))}
    </ul>
  </FeatureSectionCard>
)}
```

**Behavior:**
- Hidden if `assumptions` array is empty
- Renders as bullet list

---

## Team Chat Area

### Chat Rendering

**Position:** Right panel (40% width)

```tsx
<div className={styles.teamChatPanel}>
  <div className={styles.chatHeader}>
    <h3>Team Chat</h3>
  </div>
  <ChatMessageList messages={chatMessages} />
</div>
```

### Message Content

For planner responses, display ONLY the `message` field:

```tsx
// When processing ChatResponse with plannerResponse:
const chatMessage: ChatMessage = {
  id: generateId(),
  role: 'assistant',
  content: response.plannerResponse?.message ?? response.assistant.message,
  timestamp: new Date(),
};
```

**DO NOT display in chat bubbles:**
- JSON structure
- Scope lists
- Acceptance criteria
- Feature understanding text

### Persona Labels

Chat bubbles should visually distinguish personas:

| Role | Persona Label | Icon/Color |
|------|---------------|------------|
| `user` | "You" | Green accent |
| `assistant` (refine phase) | "Product Owner" | Blue accent |
| `assistant` (future) | "Software Architect" | Purple accent |

---

## State Management

### PlannerResponse State

Add to `ImplementationAssistantPanel` state:

```typescript
const [latestPlannerResponse, setLatestPlannerResponse] =
  useState<PlannerResponse | null>(null);
```

### Update Logic

When receiving a chat response:

```typescript
const handleChatResponse = (response: ChatResponse) => {
  // Add message to chat (using only message field)
  const chatMessage: ChatMessage = {
    id: generateId(),
    role: 'assistant',
    content: response.plannerResponse?.message ?? response.assistant.message,
    timestamp: new Date(),
  };
  setMessages(prev => [...prev, chatMessage]);

  // Update planner response if valid
  if (response.plannerResponse) {
    setLatestPlannerResponse(response.plannerResponse);
  }
  // If invalid, keep previous latestPlannerResponse (fallback)
};
```

### Fallback Behavior

- If current response has invalid/missing `plannerResponse`, keep displaying previous valid one
- Feature Definition area never goes "backward" (doesn't clear on invalid response)
- Each section handles its own empty state independently

---

## Component Structure

### New Components

| Component | File | Purpose |
|-----------|------|---------|
| `FeatureDefinitionPanel` | `FeatureDefinitionPanel.tsx` | Container for all feature sections |
| `FeatureSectionCard` | `FeatureSectionCard.tsx` | Reusable card wrapper for sections |
| `FeatureHeader` | `FeatureHeader.tsx` | Dark banner with feature title |

### Modified Components

| Component | Changes |
|-----------|---------|
| `ImplementationAssistantPanel` | Add split layout, plannerResponse state, new panels |
| `ChatBubble` | Add persona label support |

---

## Type Updates

### Import PlannerResponse

**File:** `frontend/src/api/chatApi.ts`

```typescript
// Add to existing types or import from gateway types
export interface PlannerResponse {
  schemaVersion: "1.1";
  message: string;
  featureUnderstanding: string;
  scope: {
    in: string[];
    out: string[];
  };
  assumptions: string[];
  acceptanceCriteria: string[];
  openQuestions: string[];
  plannerReadyForSpec: boolean;
  implementationPlan: ImplementationPlan | null;
}

export interface ChatResponse {
  sessionId: string;
  assistant: {
    message: string;
    artifacts?: { savedSpec?: unknown };
  };
  plannerResponse?: PlannerResponse;  // Add this field
  specs?: string[];
  handoffPlan?: HandoffPlanResponse;
}
```

---

## Files Summary

### New Files

| File | Purpose |
|------|---------|
| `frontend/src/components/ProductView/FeatureDefinitionPanel.tsx` | Feature definition container |
| `frontend/src/components/ProductView/FeatureSectionCard.tsx` | Reusable section card |
| `frontend/src/components/ProductView/FeatureHeader.tsx` | Feature title banner |
| `frontend/src/components/ProductView/FeatureDefinitionPanel.module.css` | Styles |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/components/ProductView/ImplementationAssistantPanel.tsx` | Split layout, plannerResponse state |
| `frontend/src/components/ProductView/ImplementationAssistantPanel.module.css` | Panel layout styles |
| `frontend/src/components/chat/ChatBubble.tsx` | Add persona label |
| `frontend/src/components/chat/ChatBubble.module.css` | Persona styling |
| `frontend/src/api/chatApi.ts` | Add PlannerResponse type |

---

## Testing Requirements

### Unit Tests

1. **FeatureSectionCard tests**
   - Renders title and children
   - Shows empty state when isEmpty=true
   - Hides when no content provided

2. **FeatureDefinitionPanel tests**
   - Renders all sections from plannerResponse
   - Handles missing/empty fields gracefully
   - Shows work item description regardless of plannerResponse

3. **Chat message extraction tests**
   - Extracts only message field from plannerResponse
   - Falls back to assistant.message when no plannerResponse

### Integration Tests

1. **Layout rendering**
   - Split panel layout renders correctly
   - Responsive behavior works

2. **State updates**
   - plannerResponse state updates on valid response
   - Previous response preserved on invalid response

---

## Acceptance Criteria

1. **Original work item description is always visible and unchanged**
   - Description card shows `workItemDescription` prop
   - Not affected by planner output

2. **Planner JSON `featureUnderstanding` displays as current definition**
   - Product Owner Understanding card updates with each valid response
   - Shows empty state when not yet populated

3. **Scope, Acceptance Criteria, Assumptions render from planner JSON**
   - Each section renders its corresponding array
   - Hidden sections for empty arrays (except Acceptance Criteria which shows empty state)

4. **Chat bubbles show only conversational `message` text**
   - No JSON or structured content in chat
   - Persona labels distinguish roles

5. **Feature Definition reflects latest valid planner payload**
   - State tracks most recent valid `plannerResponse`
   - Fallback to previous on invalid response

---

## Out of Scope

- Questions table and answer workflow (separate spec)
- Implementation planning UI (`implementationPlan` display)
- Software Architect / implementation mode behavior
- Persistence schema changes
- `openQuestions` display
- `plannerReadyForSpec` indicator UI

---

## Dependencies

| Dependency | Status |
|------------|--------|
| PlannerResponse type from gateway | Complete (spec 2026-01-22) |
| Gateway returns plannerResponse in ChatResponse | Complete (spec 2026-01-22) |
| ChatBubble component | Exists, needs modification |
| ImplementationAssistantPanel | Exists, needs restructuring |
