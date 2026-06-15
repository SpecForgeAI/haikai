# Specification: Assistant "What's Next" v1

## 1. Overview

Enable the `@assistant` persona's "What's Next?" task (`assistant--whats-next`) to produce a fully deterministic, LLM-free set of up to 5 recommended next actions based on current project signals. Actions render as clickable cards in the chat panel. Clicking a card navigates the user to the correct screen/tab, opens the RHS chat panel, switches persona, and auto-sends the task label to begin the workflow. This is advisory only (Level 1): nothing executes without user interaction.

## 2. Key Decisions

1. **ProjectSignals calls real data sources directly** (filesystem via `fs.access` + architecture-model-service HTTP calls), not the mock dashboard summary service. Low-level helpers may be shared if convenient.
2. **Filesystem signals use lightweight existence checks** (`fs.access`/`fs.stat`), not full file reads. File paths follow the existing uppercase-first, lowercase-fallback pattern from `contextResolvers.ts`.
3. **`architectureBaselineExists`** is true when `fetchMetaModelSummary` returns non-zero meaningful counts: `(services.length + data_entities.length + interfaces.length) > 0`.
4. **Story-level signals default to 0** in v1 -- no story fetching is added.
5. **"What's Next" is scope-independent** for v1. Dashboard scope may be forwarded informally but does not gate evaluator logic.
6. **Action contract shape**: `{ id, label, reason, priority, target: { screen, tab?, personaId, taskId? }, launch: "panel" }`.
7. **Show all missing bootstrap items** up to 5, ordered by priority. Mission alone if missing; otherwise include remaining bootstrap artifacts in order.
8. **Optimisation actions** for a fully bootstrapped project: "Refine Backlog", "Review/Update Roadmap", "Review/Update Architecture Baseline", "Refresh Tech Standards", "Review Delivery Status" (last omitted if delivery signals unavailable).
9. **Fully deterministic** -- short-circuit the LLM entirely for `assistant--whats-next`.
10. **Implemented as task-specific short-circuit** within the existing `POST /api/chat/v2` flow (no new endpoint).
11. **New structuredResponse discriminator**: `type: "whats-next-actions"` with a dedicated renderer component.
12. **Render as TaskMenu-like clickable cards** with label + 1-2 line reason beneath. No priority badge UI; ordering alone communicates priority.
13. **Cross-navigation handoff uses React context** (`PendingActionContext`) -- not URL params or localStorage.
14. **Actions only target screens that already have UnifiedChatPanel** (Dashboard, Product Definition, Roadmap, MetaModel). Screens without panels (Backlog, Implement, Diagrams) are omitted entirely.
15. **Scope is NOT added to ChatV2Request** for v1.
16. **Implement-picker and generate-standards-modal actions** are omitted entirely in v1 (no disabled items shown).
17. **Explicitly excluded**: caching, action history/dismissal, analytics, proactive suggestions on load, and any changes to the task registry beyond whats-next wiring.

## 3. Architecture & Design

### 3.1 Gateway Changes

#### 3.1.1 New Module: `gateway/src/services/projectSignals.ts`

A new service module that computes a `ProjectSignals` snapshot on-demand given a `projectId`.

**Data sources and computation logic:**

- **`missionExists`**: `fs.access` on `{basePath}/agent-os/product/MISSION.MD`, fallback `mission.md`. Returns `boolean`. Same base path as `MissionContextResolver` in `gateway/src/services/contextResolvers.ts` (line 88): `getConfig().conversationPersistBasePath`.
- **`techStandardsExists`**: `fs.access` on `{basePath}/agent-os/product/TECH-STACK.MD`, fallback `tech-stack.md`. Returns `boolean`. Same path pattern as `TechStackContextResolver` (line 119).
- **`testStrategyExists`**: `fs.access` on `{basePath}/agent-os/product/TEST-STRATEGY.MD`, fallback `test-strategy.md`. Returns `boolean`. Same path pattern as `TestStrategyContextResolver` (line 150).
- **`roadmapExists`**: Call `fetchProductSummary(projectId)` from `gateway/src/services/architectureModelClient.ts` (line 314), then call `hasExistingRoadmap(result)` from `gateway/src/services/roadmapSummaryBuilder.ts` (line 92). Returns `boolean`.
- **`architectureBaselineExists`**: Call `fetchMetaModelSummary(projectId)` from `gateway/src/services/architectureModelClient.ts` (line 507), check `(services.length + data_entities.length + interfaces.length) > 0`. Returns `boolean`.
- **`epicCount`**: Derived from `fetchProductSummary` result using `countRoadmapItems(result).epicCount` from `roadmapSummaryBuilder.ts` (line 134). Returns `number`.
- **Story-level signals** (`storyCount`, `storiesWithAC`, `storiesInProgress`, `storiesDone`, `storiesVerified`): All hardcoded to `0` for v1.

**Graceful degradation**: Every signal computation is wrapped in try/catch. On error, booleans default to `false`, numbers default to `0`. The snapshot never throws.

**Single function export**: `async function buildProjectSignals(projectId: string): Promise<ProjectSignals>`

#### 3.1.2 New Module: `gateway/src/services/whatsNextEvaluator.ts`

A pure, synchronous evaluator function that takes a `ProjectSignals` object and returns a `WhatsNextResult` containing an explanation string and an array of `NextAction` objects (max 5), sorted by priority descending.

**Evaluation pseudocode:**

```
function evaluateNextActions(signals: ProjectSignals): WhatsNextResult

  actions = []

  // HARD RULE: No mission => only one action
  if (!signals.missionExists)
    actions.push(DEFINE_MISSION_ACTION)
    return { explanation: "Your project needs a mission...", actions }

  // BOOTSTRAP CHECKS (in priority order)
  if (!signals.techStandardsExists)
    actions.push(DEFINE_TECH_STACK_ACTION)

  if (!signals.roadmapExists)
    actions.push(DEFINE_ROADMAP_ACTION)

  if (!signals.architectureBaselineExists)
    actions.push(DEFINE_ARCHITECTURE_ACTION)

  if (!signals.testStrategyExists)
    actions.push(DEFINE_TEST_STRATEGY_ACTION)

  // If any bootstrap items missing, return those (up to 5)
  if (actions.length > 0)
    return {
      explanation: "Some foundational artifacts are missing...",
      actions: actions.slice(0, 5)
    }

  // ALL BOOTSTRAP COMPLETE => OPTIMISATION ACTIONS
  actions.push(REVIEW_ROADMAP_ACTION)
  actions.push(REVIEW_ARCHITECTURE_ACTION)
  actions.push(REFRESH_TECH_STANDARDS_ACTION)

  // "Review Delivery Status" is omitted in v1 (delivery signals unavailable)
  // "Refine Backlog" is omitted in v1 (Backlog screen has no UnifiedChatPanel)

  return {
    explanation: "All foundational artifacts are in place...",
    actions: actions.slice(0, 5)
  }
```

**Single function export**: `function evaluateNextActions(signals: ProjectSignals): WhatsNextResult`

#### 3.1.3 Modify: `gateway/src/routes/chatV2.ts`

**Insert a new short-circuit block** in the POST `/api/chat/v2` handler, after task validation (after line 1759 where `task` is confirmed to exist in the registry) and before the context resolution step (line 1761). This mirrors the roadmap first-turn short-circuit at lines 1828-1908.

**Short-circuit condition**: `task.id === 'assistant--whats-next'`

**Short-circuit logic:**

1. Call `buildProjectSignals(threadKey.projectId)` to compute the signals snapshot.
2. Call `evaluateNextActions(signals)` to get the deterministic actions.
3. Build the `WhatsNextResponse` structured response object.
4. Create and persist a user `ThreadMessage` via `appendMessage(threadKey, userMessage)`.
5. Create and persist an assistant `ThreadMessage` with the structured response via `appendMessage(threadKey, assistantMessage)`.
6. Return the `ChatV2Response` with `structuredResponse` set to the whats-next-actions object.
7. `return` to skip all subsequent processing (context resolution, LLM call, etc.).

**Imports to add**: `buildProjectSignals` from `../services/projectSignals`, `evaluateNextActions` from `../services/whatsNextEvaluator`.

#### 3.1.4 No Changes to Task Definition

The existing `gateway/src/config/tasks/assistant--whats-next.json` already has the correct configuration:
```json
{
  "id": "assistant--whats-next",
  "personaId": "assistant",
  "menuLabel": "What's Next?",
  "mode": "advisory",
  "contextNeeds": [],
  "persistence": "hub",
  "availableFrom": ["hub"]
}
```
No modifications needed.

### 3.2 Frontend Changes

#### 3.2.1 New Component: `frontend/src/components/UnifiedChat/WhatsNextActionList.tsx`

A new component that renders the "whats-next-actions" structured response as a vertical list of clickable cards. Follows the exact structure and styling patterns of `TaskMenu.tsx` (line 41-58).

**Props:**
- `actions`: Array of action objects (from the structured response)
- `explanation`: The explanation text to display above actions
- `onActionClick`: Callback `(action: NextAction) => void`

**Rendering:**
- Display the `explanation` text as a paragraph above the cards
- Render each action as a `<button>` card (like `TaskMenu.taskCard`) with:
  - Primary text: `action.label` (styled like `TaskMenu.menuLabel`)
  - Secondary text: `action.reason` (styled like `TaskMenu.description`)
- Cards are vertically stacked with 8px gap

#### 3.2.2 New CSS Module: `frontend/src/components/UnifiedChat/WhatsNextActionList.module.css`

Reuse the same card styling from `TaskMenu.module.css`. May import/extend or duplicate the styles for `container`, `taskCard`, `menuLabel`, `description` classes.

#### 3.2.3 New Context: `frontend/src/contexts/PendingActionContext.tsx`

A new React context following the pattern of `ImportActionsContext.tsx` (lines 17-93). Holds a single `PendingAction | null` state and provides `setPendingAction` and `clearPendingAction` functions.

**Context value shape:**
```typescript
interface PendingActionContextType {
  pendingAction: PendingAction | null;
  setPendingAction: (action: PendingAction) => void;
  clearPendingAction: () => void;
}
```

**Provider**: `PendingActionProvider` component wrapping `children`, using `useState<PendingAction | null>(null)`.

**Hook**: `usePendingAction()` returns the context value. Throws if used outside provider.

#### 3.2.4 Modify: `frontend/src/App.tsx`

**Add PendingActionProvider** to the provider tree. Insert it inside `ArchitectureProvider` and wrapping `AppContent`, at line 189:

Current (line 183-195):
```
<AppConfigProvider>
  <ProjectProvider>
    <ArchitectureProvider>
      <AppContent />
    </ArchitectureProvider>
  </ProjectProvider>
</AppConfigProvider>
```

New:
```
<AppConfigProvider>
  <ProjectProvider>
    <ArchitectureProvider>
      <PendingActionProvider>
        <AppContent />
      </PendingActionProvider>
    </ArchitectureProvider>
  </ProjectProvider>
</AppConfigProvider>
```

**Import**: Add `import { PendingActionProvider } from './contexts/PendingActionContext';`

#### 3.2.5 Modify: `frontend/src/components/UnifiedChat/MessageBubble.tsx`

**Add a new type guard** `isWhatsNextActions` following the existing pattern (lines 99-208):

```typescript
function isWhatsNextActions(
  sr: unknown
): sr is { type: 'whats-next-actions'; explanation: string; actions: Array<{ id: string; label: string; reason: string; priority: number; target: { screen: string; tab?: string; personaId: string; taskId?: string }; launch: string }> } {
  if (sr == null || typeof sr !== 'object') return false;
  const obj = sr as Record<string, unknown>;
  return obj.type === 'whats-next-actions' && Array.isArray(obj.actions);
}
```

**Add to the rendering chain**: Insert a new branch in the ternary chain (after the `showCompletionChip` branch around line 372, before the `showQuestions` branch at line 383):

```
) : showWhatsNextActions ? (
  <div className={styles.structuredResponseArea}>
    {content && (
      <div className={styles.messageContent}>{content}</div>
    )}
    <WhatsNextActionList
      explanation={...}
      actions={...}
      onActionClick={onActionClick}
    />
  </div>
```

**New prop**: Add `onActionClick?: (action: NextAction) => void` to `MessageBubbleProps`.

**Imports**: Add `WhatsNextActionList` and the `NextAction` type.

#### 3.2.6 Modify: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`

**Wire action click handler**: Create a `handleWhatsNextAction` callback that:

1. Calls `setPendingAction(action.target)` from `usePendingAction()` context.
2. Calls `navigateTo(dispatch, action.target.screen, action.target.tab)` using the existing `navigateTo` function imported from DashboardView (or replicated locally).
3. If the action targets the current screen (dashboard), consume it directly: call `selectPersona(action.target.personaId)` and then `selectTask(action.target.taskId)` without navigating.

**Pass down**: Thread `handleWhatsNextAction` through to `ChatThread` and then to `MessageBubble` as `onActionClick`.

**Consume pending action on mount**: Add a `useEffect` that checks `pendingAction` from `usePendingAction()`. When non-null:
1. If the panel is collapsed, expand it (set `isCollapsed` to `false`).
2. Call `selectPersona(pendingAction.personaId)`.
3. If `pendingAction.taskId` is provided, after a brief delay (to allow the persona switch greeting + task menu to resolve), call `selectTask(pendingAction.taskId)`.
4. Call `clearPendingAction()`.

**New imports**: `usePendingAction` from `../../contexts/PendingActionContext`, `useArchitectureDispatch` from `../../contexts/ArchitectureContext`.

#### 3.2.7 Modify: `frontend/src/components/UnifiedChat/ChatThread.tsx`

**Thread the new prop**: Accept `onActionClick` and pass it through to each `MessageBubble` instance. This is the same pattern already used for `onSelectTask`, `onSubmitAnswers`, `onConfirmArtifact`, `onRejectArtifact`, `onDownloadTranscript`.

#### 3.2.8 Modify: `frontend/src/components/DashboardView/DashboardView.tsx`

**Import PendingAction consumer**: The DashboardView's `UnifiedChatPanel` already receives all necessary props. The panel itself handles pending action consumption. No additional changes needed beyond what `UnifiedChatPanel` does internally.

However, the `navigateTo` function (line 52-63) must be accessible to `UnifiedChatPanel`. Two options:
- **Option A (preferred)**: Extract `navigateTo` into a shared utility or let `UnifiedChatPanel` import `useArchitectureDispatch` and call `dispatch({ type: 'SET_VIEW' })` directly.
- **Option B**: Pass `dispatch` to `UnifiedChatPanel` as a prop.

Use **Option A**: `UnifiedChatPanel` imports `useArchitectureDispatch` and calls `dispatch({ type: 'SET_VIEW', payload: action.target.screen })` + `window.history.pushState({}, '', '?tab=' + action.target.tab)` when `action.target.tab` is present. This replicates the `navigateTo` logic from DashboardView (lines 52-63).

#### 3.2.9 Modify: Target View Components (ProductPage, ProductRoadmapPage, MetaModelView)

Each of these views renders a `UnifiedChatPanel` that will now auto-detect and consume pending actions through the `usePendingAction` hook wired inside `UnifiedChatPanel.tsx`. No direct modifications are needed to these view components -- the pending action logic lives entirely within `UnifiedChatPanel`.

## 4. Data Contracts

### 4.1 ProjectSignals Interface

Defined in `gateway/src/services/projectSignals.ts`:

```typescript
export interface ProjectSignals {
  /** Whether MISSION.MD exists on the filesystem */
  missionExists: boolean;
  /** Whether TECH-STACK.MD exists on the filesystem */
  techStandardsExists: boolean;
  /** Whether TEST-STRATEGY.MD exists on the filesystem */
  testStrategyExists: boolean;
  /** Whether any initiatives/epics exist in the product roadmap (DB) */
  roadmapExists: boolean;
  /** Whether the architecture meta-model has meaningful entities (DB) */
  architectureBaselineExists: boolean;
  /** Number of epics in the roadmap */
  epicCount: number;
  /** Number of stories (hardcoded 0 in v1) */
  storyCount: number;
  /** Number of stories with acceptance criteria (hardcoded 0 in v1) */
  storiesWithAC: number;
  /** Number of stories in progress (hardcoded 0 in v1) */
  storiesInProgress: number;
  /** Number of stories done (hardcoded 0 in v1) */
  storiesDone: number;
  /** Number of stories verified (hardcoded 0 in v1) */
  storiesVerified: number;
}
```

### 4.2 NextAction Interface

Defined in `gateway/src/services/whatsNextEvaluator.ts`:

```typescript
export interface NextActionTarget {
  /** Target view identifier: 'dashboard' | 'product' | 'metamodel' */
  screen: string;
  /** Optional tab within the target view (e.g., 'product', 'roadmap') */
  tab?: string;
  /** Persona ID to activate on the target screen */
  personaId: string;
  /** Task ID to auto-select after persona switch (optional) */
  taskId?: string;
}

export interface NextAction {
  /** Unique action identifier (e.g., 'define-mission') */
  id: string;
  /** Human-readable action label */
  label: string;
  /** 1-2 sentence reason why this action is recommended */
  reason: string;
  /** Numeric priority (higher = more important, used for ordering) */
  priority: number;
  /** Routing target for the action */
  target: NextActionTarget;
  /** Launch mode (always 'panel' in v1) */
  launch: 'panel';
}

export interface WhatsNextResult {
  /** Human-readable explanation of the current project state */
  explanation: string;
  /** Ordered array of recommended actions (max 5, sorted by priority descending) */
  actions: NextAction[];
}
```

### 4.3 WhatsNextResponse Interface (structuredResponse shape)

The `structuredResponse` field on the `ChatV2Response` (and the persisted assistant `ThreadMessage`) will have this shape:

```typescript
interface WhatsNextStructuredResponse {
  /** Discriminator for frontend rendering */
  type: 'whats-next-actions';
  /** Human-readable explanation of the project state */
  explanation: string;
  /** Ordered array of recommended actions */
  actions: NextAction[];
}
```

This is the value stored in `ChatV2Response.structuredResponse` and `ThreadMessage.structuredResponse`.

### 4.4 PendingAction Interface

Defined in `frontend/src/contexts/PendingActionContext.tsx`:

```typescript
export interface PendingAction {
  /** Target view: 'dashboard' | 'product' | 'metamodel' */
  screen: string;
  /** Optional tab within the view (e.g., 'product', 'roadmap') */
  tab?: string;
  /** Persona ID to switch to */
  personaId: string;
  /** Task ID to select (optional -- if omitted, persona switch triggers greeting + task menu) */
  taskId?: string;
}
```

## 5. Implementation Details

### 5.1 ProjectSignals Snapshot Builder

**File**: `gateway/src/services/projectSignals.ts`

**File existence check pattern** (for `missionExists`, `techStandardsExists`, `testStrategyExists`):

```typescript
async function fileExists(basePath: string, ...segments: string[]): Promise<boolean> {
  try {
    await fs.access(path.join(basePath, ...segments));
    return true;
  } catch {
    return false;
  }
}
```

For each signal, try uppercase first, then lowercase fallback:
```typescript
const basePath = getConfig().conversationPersistBasePath;
const productDir = path.join(basePath, 'agent-os', 'product');

missionExists = await fileExists(productDir, 'MISSION.MD')
  || await fileExists(productDir, 'mission.md');
```

**Architecture baseline check**:
```typescript
try {
  const summary = await fetchMetaModelSummary(projectId);
  architectureBaselineExists = summary != null
    && ((summary.services?.length || 0) + (summary.data_entities?.length || 0) + (summary.interfaces?.length || 0)) > 0;
} catch {
  architectureBaselineExists = false;
}
```

**Roadmap existence check**:
```typescript
try {
  const productSummary = await fetchProductSummary(projectId);
  roadmapExists = productSummary != null && hasExistingRoadmap(productSummary);
  epicCount = productSummary != null ? countRoadmapItems(productSummary).epicCount : 0;
} catch {
  roadmapExists = false;
  epicCount = 0;
}
```

**Parallelism**: The three filesystem checks can run in parallel via `Promise.all`. The two HTTP calls (`fetchMetaModelSummary` and `fetchProductSummary`) can also run in parallel. All five signal sources can be dispatched concurrently:

```typescript
const [fileSignals, metaModelResult, productSummaryResult] = await Promise.all([
  resolveFileSignals(basePath),
  fetchMetaModelSummary(projectId).catch(() => null),
  fetchProductSummary(projectId).catch(() => null),
]);
```

### 5.2 DeterministicNextActionsEvaluator

**File**: `gateway/src/services/whatsNextEvaluator.ts`

**Complete evaluation pseudocode:**

```
function evaluateNextActions(signals: ProjectSignals): WhatsNextResult {
  const actions: NextAction[] = [];

  // ===== HARD RULE: No mission =====
  if (!signals.missionExists) {
    actions.push({
      id: 'define-mission',
      label: 'Define Product Mission',
      reason: 'A product mission is the foundation for all other activities. Define it first to guide roadmap, architecture, and standards decisions.',
      priority: 100,
      target: { screen: 'product', tab: 'product', personaId: 'product-manager', taskId: 'product-manager--define-product' },
      launch: 'panel'
    });

    return {
      explanation: 'Your project does not yet have a Product Mission defined. This is the essential first step before any other work can begin.',
      actions
    };
  }

  // ===== BOOTSTRAP CHECKS (in priority order) =====

  if (!signals.techStandardsExists) {
    actions.push({
      id: 'define-tech-stack',
      label: 'Define Tech Stack',
      reason: 'Establishing technology standards early ensures consistent architectural decisions across the project.',
      priority: 80,
      target: { screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-tech-stack' },
      launch: 'panel'
    });
  }

  if (!signals.roadmapExists) {
    actions.push({
      id: 'define-roadmap',
      label: 'Define Product Roadmap',
      reason: 'A roadmap of initiatives and epics gives the team a clear direction and helps prioritize upcoming work.',
      priority: 70,
      target: { screen: 'product', tab: 'roadmap', personaId: 'product-manager', taskId: 'product-manager--roadmap' },
      launch: 'panel'
    });
  }

  if (!signals.architectureBaselineExists) {
    actions.push({
      id: 'define-architecture',
      label: 'Define Architecture Baseline',
      reason: 'An architecture baseline captures the key services, interfaces, and data entities that form the structural foundation of your system.',
      priority: 60,
      target: { screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-architecture' },
      launch: 'panel'
    });
  }

  if (!signals.testStrategyExists) {
    actions.push({
      id: 'define-test-strategy',
      label: 'Define Test Strategy',
      reason: 'A test strategy ensures quality is built in from the start, covering functional, integration, and end-to-end testing approaches.',
      priority: 50,
      target: { screen: 'metamodel', personaId: 'test-engineer', taskId: 'test-engineer--test-strategy' },
      launch: 'panel'
    });
  }

  // If any bootstrap items are missing, return those
  if (actions.length > 0) {
    const missingCount = actions.length;
    return {
      explanation: `Your project has a mission defined but is missing ${missingCount} foundational artifact${missingCount > 1 ? 's' : ''}. Complete these to establish a solid project foundation.`,
      actions: actions.slice(0, 5)
    };
  }

  // ===== ALL BOOTSTRAP COMPLETE: OPTIMISATION ACTIONS =====

  actions.push({
    id: 'review-roadmap',
    label: 'Review/Update Roadmap',
    reason: 'Periodically reviewing the roadmap ensures initiatives and epics stay aligned with evolving business priorities.',
    priority: 40,
    target: { screen: 'product', tab: 'roadmap', personaId: 'product-manager', taskId: 'product-manager--roadmap' },
    launch: 'panel'
  });

  actions.push({
    id: 'review-architecture',
    label: 'Review/Update Architecture Baseline',
    reason: 'As the project evolves, the architecture model may need updates to reflect new services, interfaces, or data entities.',
    priority: 35,
    target: { screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-architecture' },
    launch: 'panel'
  });

  actions.push({
    id: 'refresh-tech-standards',
    label: 'Refresh Tech Standards',
    reason: 'Technology standards should be reviewed periodically to incorporate new tools, frameworks, or best practices.',
    priority: 30,
    target: { screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-tech-stack' },
    launch: 'panel'
  });

  // NOTE: "Refine Backlog" omitted -- Backlog screen has no UnifiedChatPanel in v1
  // NOTE: "Review Delivery Status" omitted -- delivery signals unavailable in v1

  return {
    explanation: 'All foundational artifacts are in place. Here are some actions to keep your project healthy and up to date.',
    actions: actions.slice(0, 5)
  };
}
```

**Priority ordering**: Actions are added in descending priority order within each category (bootstrap or optimisation). The `priority` field is included in the data contract for potential future sorting but the array is already pre-sorted.

### 5.3 ChatV2 Short-Circuit

**File**: `gateway/src/routes/chatV2.ts`

**Insertion point**: After task validation at line 1759 (after `const task = taskRegistry.get(request.taskId)` succeeds) and before the context resolution step at line 1761. A new block is inserted:

```typescript
// ---- Step 4b: Deterministic short-circuit for assistant--whats-next ----
if (task.id === 'assistant--whats-next') {
  // 1. Build project signals
  const signals = await buildProjectSignals(threadKey.projectId);

  // 2. Evaluate deterministic next actions
  const result = evaluateNextActions(signals);

  // 3. Build structured response
  const whatsNextResponse = {
    type: 'whats-next-actions' as const,
    explanation: result.explanation,
    actions: result.actions,
  };

  // 4. Persist user message
  const userMessage: ThreadMessage = {
    id: uuidv4(),
    role: 'user',
    personaId: null,
    taskId: request.taskId,
    content: request.message,
    structuredResponse: null,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(threadKey, userMessage);

  // 5. Persist assistant message
  const assistantContent = result.explanation;
  const assistantMessage: ThreadMessage = {
    id: uuidv4(),
    role: 'assistant',
    personaId: request.personaId,
    taskId: request.taskId,
    content: assistantContent,
    structuredResponse: whatsNextResponse,
    timestamp: new Date().toISOString(),
  };
  await appendMessage(threadKey, assistantMessage);

  // 6. Return response, skip LLM
  res.json({
    threadKey: threadKeyStr,
    personaId: request.personaId,
    taskId: request.taskId,
    assistant: { message: assistantContent },
    structuredResponse: whatsNextResponse,
  });
  return;
}
```

**Message persistence**: Follows the exact pattern from the roadmap first-turn short-circuit (lines 1876-1896) -- both user and assistant `ThreadMessage` objects are created with `uuidv4()` IDs and persisted via `appendMessage(threadKey, message)`.

**Response shape**: Follows the existing `ChatV2Response` interface from `gateway/src/types/chatV2.ts` (line 288). The `structuredResponse` field carries the `WhatsNextStructuredResponse` object.

### 5.4 WhatsNextActionList Component

**File**: `frontend/src/components/UnifiedChat/WhatsNextActionList.tsx`

**Props interface:**
```typescript
interface WhatsNextActionListProps {
  explanation: string;
  actions: Array<{
    id: string;
    label: string;
    reason: string;
    priority: number;
    target: { screen: string; tab?: string; personaId: string; taskId?: string };
    launch: string;
  }>;
  onActionClick: (action: NextAction) => void;
}
```

**Rendering logic:**
1. Render `explanation` as a paragraph of text (same `messageContent` class).
2. Render a vertical stack of `<button>` cards (same markup as `TaskMenu.tsx` lines 43-57):
   - Each card has `data-testid={`whats-next-action-${action.id}`}`
   - Primary text: `action.label` (bold, 14px)
   - Secondary text: `action.reason` (lighter, 12px)
   - `onClick`: calls `onActionClick(action)`

**Click handler behavior** (in UnifiedChatPanel, not in this component):
1. If `action.target.screen` matches the current screen (panel is already on the correct view): directly call `selectPersona(action.target.personaId)` then `selectTask(action.target.taskId)`.
2. Otherwise: call `setPendingAction(action.target)` then navigate via `dispatch({ type: 'SET_VIEW', payload: action.target.screen })` + `window.history.pushState` for tab routing.

### 5.5 PendingActionContext

**File**: `frontend/src/contexts/PendingActionContext.tsx`

**Provider placement**: In `App.tsx`, inside `ArchitectureProvider`, wrapping `AppContent`:
```
<ArchitectureProvider>
  <PendingActionProvider>
    <AppContent />
  </PendingActionProvider>
</ArchitectureProvider>
```

This placement ensures `PendingActionProvider` has access to the Architecture context (via hooks) and all view components can consume the pending action.

**Consumer pattern**: Components call `const { pendingAction, setPendingAction, clearPendingAction } = usePendingAction()`.

**Auto-clear semantics**: The consumer (`UnifiedChatPanel`) calls `clearPendingAction()` immediately after reading and acting on the pending action. This prevents re-triggering on subsequent re-renders. The clear happens synchronously within the same `useEffect` that consumes the action.

**State management**: Simple `useState<PendingAction | null>(null)`. The `setPendingAction` function sets it, `clearPendingAction` sets it to `null`.

### 5.6 Panel Auto-Launch on Navigation

**Sequence for cross-screen navigation:**

1. User clicks an action card in WhatsNextActionList on the Dashboard.
2. `handleWhatsNextAction` in `UnifiedChatPanel` is called.
3. Handler calls `setPendingAction({ screen, tab, personaId, taskId })`.
4. Handler calls `dispatch({ type: 'SET_VIEW', payload: action.target.screen })` and `window.history.pushState({}, '', '?tab=' + action.target.tab)` if tab is present.
5. React re-renders: `AppContent` unmounts the old view and mounts the target view.
6. The target view's `UnifiedChatPanel` mounts and runs its `useEffect`.
7. The `useEffect` reads `pendingAction` from context. Since it is non-null:
   a. Sets `isCollapsed` to `false` (expand panel).
   b. Calls `selectPersona(pendingAction.personaId)`.
   c. `selectPersona` internally resets `activeTaskId` to `'unknown'` and sends an empty message to trigger the greeting + task menu.
   d. If `pendingAction.taskId` is present, use a short timeout or callback to call `selectTask(pendingAction.taskId)` after the task menu response arrives. The implementation can use the existing `pendingMessageRef` mechanism in `useChatThread` -- once the task menu is returned and the user "selects" a task, `selectTask` sends the task label to start the workflow.
   e. Calls `clearPendingAction()`.

**For same-screen actions** (action targets Dashboard while already on Dashboard):
1. Handler detects the target screen matches the current screen.
2. Calls `selectPersona(action.target.personaId)` directly.
3. After persona switch + task menu loads, calls `selectTask(action.target.taskId)`.
4. No navigation occurs; no pending action is set.

**How each target view consumes:**

| View | UnifiedChatPanel threadKey | Pending Action Consumption |
|------|---------------------------|---------------------------|
| Dashboard | `{ type: 'hub', projectId }` | Panel expands, selectPersona, selectTask |
| Product Definition | `{ type: 'panel', projectId, screen: 'product' }` | Panel expands, selectPersona, selectTask |
| Roadmap | `{ type: 'panel', projectId, screen: 'roadmap' }` | Panel expands, selectPersona, selectTask |
| MetaModel | `{ type: 'panel', projectId, screen: 'metamodel' }` | Panel expands, selectPersona, selectTask |

## 6. Action Catalog

| ID | Label | Reason Template | Priority | Target Screen | Target Tab | Target PersonaId | Target TaskId | Condition |
|----|-------|-----------------|----------|---------------|------------|------------------|---------------|-----------|
| `define-mission` | Define Product Mission | A product mission is the foundation for all other activities. Define it first to guide roadmap, architecture, and standards decisions. | 100 | `product` | `product` | `product-manager` | `product-manager--define-product` | `!missionExists` |
| `define-tech-stack` | Define Tech Stack | Establishing technology standards early ensures consistent architectural decisions across the project. | 80 | `metamodel` | - | `architect` | `architect--define-tech-stack` | `missionExists && !techStandardsExists` |
| `define-roadmap` | Define Product Roadmap | A roadmap of initiatives and epics gives the team a clear direction and helps prioritize upcoming work. | 70 | `product` | `roadmap` | `product-manager` | `product-manager--roadmap` | `missionExists && !roadmapExists` |
| `define-architecture` | Define Architecture Baseline | An architecture baseline captures the key services, interfaces, and data entities that form the structural foundation of your system. | 60 | `metamodel` | - | `architect` | `architect--define-architecture` | `missionExists && !architectureBaselineExists` |
| `define-test-strategy` | Define Test Strategy | A test strategy ensures quality is built in from the start, covering functional, integration, and end-to-end testing approaches. | 50 | `metamodel` | - | `test-engineer` | `test-engineer--test-strategy` | `missionExists && !testStrategyExists` |
| `review-roadmap` | Review/Update Roadmap | Periodically reviewing the roadmap ensures initiatives and epics stay aligned with evolving business priorities. | 40 | `product` | `roadmap` | `product-manager` | `product-manager--roadmap` | All bootstrap complete |
| `review-architecture` | Review/Update Architecture Baseline | As the project evolves, the architecture model may need updates to reflect new services, interfaces, or data entities. | 35 | `metamodel` | - | `architect` | `architect--define-architecture` | All bootstrap complete |
| `refresh-tech-standards` | Refresh Tech Standards | Technology standards should be reviewed periodically to incorporate new tools, frameworks, or best practices. | 30 | `metamodel` | - | `architect` | `architect--define-tech-stack` | All bootstrap complete |

**Omitted in v1:**

| ID | Label | Reason Omitted |
|----|-------|----------------|
| `refine-backlog` | Refine Backlog | Backlog screen (ProductBacklogPage) has no UnifiedChatPanel |
| `review-delivery` | Review Delivery Status | Delivery signals unavailable in v1 (story-level signals hardcoded to 0) |
| `generate-standards` | Generate Standards | Generate-standards-modal flow not implemented |
| `implement-picker` | Start Implementation | Implement-picker flow not implemented |

## 7. Screen-to-Panel Mapping

| Screen | View Value | Tab | ThreadKey Shape | Allowed PersonaIds | Has Panel |
|--------|-----------|-----|-----------------|-------------------|-----------|
| Dashboard | `dashboard` | n/a | `{ type: 'hub', projectId }` | All (no restriction) | Yes |
| Product Definition | `product` | `product` | `{ type: 'panel', projectId, screen: 'product' }` | `['product-manager']` | Yes |
| Roadmap | `product` | `roadmap` | `{ type: 'panel', projectId, screen: 'roadmap' }` | `['product-manager']` | Yes |
| MetaModel | `metamodel` | n/a | `{ type: 'panel', projectId, screen: 'metamodel' }` | `['architect', 'ux-designer', 'test-engineer']` | Yes |
| Backlog | `product` | `backlog` | n/a | n/a | No |
| Implement | `product` | `implement` | n/a | n/a | No |
| Diagrams | `diagrams` | n/a | n/a | n/a | No |

**Important constraint**: The `allowedPersonaIds` on target screens restrict which personas can be used. When an action targets MetaModel with `personaId: 'architect'`, this is valid because `'architect'` is in the MetaModel panel's allowed list. When an action targets Product/Roadmap with `personaId: 'product-manager'`, this is valid because `'product-manager'` is in those panels' allowed lists. All actions in the catalog have been verified against the allowed persona lists.

## 8. Constraints & Exclusions

1. **No caching** of project signals or evaluated actions.
2. **No action history** or dismissal tracking.
3. **No analytics** or telemetry for action clicks.
4. **No proactive suggestions on page load** -- user must explicitly trigger "What's Next?" via the task menu.
5. **No changes to the task registry** beyond the existing `assistant--whats-next.json` (which already has correct settings).
6. **No implement-picker flow** actions.
7. **No generate-standards-modal** actions.
8. **No disabled action items** -- actions targeting unavailable screens are omitted entirely.
9. **No adding UnifiedChatPanel** to screens that lack it (Backlog, Implement, Diagrams).
10. **No story-level signal fetching** -- all story signals are hardcoded to 0.
11. **No scope-gated evaluator logic** -- scope may be forwarded informally but does not affect action selection.
12. **No new API endpoints** -- everything uses the existing `POST /api/chat/v2`.
13. **No LLM involvement** -- the short-circuit is fully deterministic.
14. **No streaming**, summarisation, completion chips, or diff/merge related to this feature.
15. **No changes to the ChatV2Request type** -- scope is not added.

## 9. Acceptance Criteria

1. When the user selects the `assistant` persona and chooses "What's Next?" on the Dashboard, the panel renders a deterministic response with clickable action cards within 2 seconds (no LLM latency).
2. On a fresh project (no artifacts), the response shows exactly one action: "Define Product Mission".
3. On a project with MISSION.MD but missing TECH-STACK.MD and roadmap, the response shows both "Define Tech Stack" and "Define Product Roadmap" (and any other missing bootstrap items), ordered by priority.
4. On a fully bootstrapped project (all 5 artifacts exist), the response shows optimisation actions: "Review/Update Roadmap", "Review/Update Architecture Baseline", "Refresh Tech Standards".
5. The maximum number of actions returned is 5.
6. Each action card displays a label (bold) and reason (lighter text).
7. Clicking an action card that targets a different screen navigates the user to that screen.
8. After navigation, the target screen's chat panel auto-expands, switches to the correct persona, and triggers the task menu for the correct task.
9. Clicking an action card that targets the current screen does not navigate; instead it directly switches persona and selects the task.
10. The user and assistant messages are persisted to the thread (visible on page refresh via GET /api/chat/v2/thread).
11. The structured response has `type: 'whats-next-actions'` and is rendered by the dedicated `WhatsNextActionList` component (not plain text).
12. If a filesystem check fails (e.g., disk error), that signal defaults to `false`/`0` and the endpoint still returns a valid response.
13. If an HTTP call to architecture-model-service fails (e.g., service down), the affected signal defaults to `false`/`0` and the endpoint still returns a valid response.
14. The "What's Next?" task remains available only from the hub entry point (Dashboard) as configured in `availableFrom: ["hub"]`.
15. No LLM API call is made when `taskId === 'assistant--whats-next'`.
16. The `PendingActionContext` clears the pending action after consumption, preventing repeated auto-triggers on re-renders.
17. Actions do not target screens without UnifiedChatPanel (Backlog, Implement, Diagrams).

## 10. Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `gateway/src/services/projectSignals.ts` | Create | ProjectSignals snapshot builder -- computes file existence and DB state signals |
| `gateway/src/services/whatsNextEvaluator.ts` | Create | Deterministic evaluator -- takes ProjectSignals, returns explanation + actions array |
| `gateway/src/routes/chatV2.ts` | Modify | Add short-circuit block after task validation (after line 1759) for `assistant--whats-next` |
| `frontend/src/contexts/PendingActionContext.tsx` | Create | React context for pending action handoff across navigation |
| `frontend/src/components/UnifiedChat/WhatsNextActionList.tsx` | Create | Renderer component for whats-next-actions structured response |
| `frontend/src/components/UnifiedChat/WhatsNextActionList.module.css` | Create | CSS module for WhatsNextActionList (replicates TaskMenu card styling) |
| `frontend/src/App.tsx` | Modify | Wrap AppContent with PendingActionProvider (inside ArchitectureProvider) |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | Modify | Add `isWhatsNextActions` type guard + rendering branch + `onActionClick` prop |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | Modify | Add action click handler, pending action consumption useEffect, dispatch import |
| `frontend/src/components/UnifiedChat/ChatThread.tsx` | Modify | Thread `onActionClick` prop through to MessageBubble instances |
