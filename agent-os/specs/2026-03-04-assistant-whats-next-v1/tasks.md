# Tasks: Assistant "What's Next" v1

> Source: `agent-os/specs/2026-03-04-assistant-whats-next-v1/spec.md`

## Task Groups

Tasks are organized into sequential groups. Each group can be implemented independently
but groups should be completed in order.

Total Tasks: 44 (across 10 task groups)

---

### Task Group 1: Gateway Data Contracts & Types

**Goal**: Define the TypeScript interfaces (`ProjectSignals`, `NextAction`, `NextActionTarget`, `WhatsNextResult`) that will be consumed by both the ProjectSignals service and the WhatsNextEvaluator. Establishing these first ensures all downstream modules have a stable contract.

**Dependencies**: None

#### Task 1.1: Define ProjectSignals interface
- [x] **File(s)**: `gateway/src/services/projectSignals.ts`
- **Action**: Create
- **Details**:
  - Create a new file with only the `ProjectSignals` interface export and the `buildProjectSignals` function stub (returning all-false/zero defaults).
  - Interface fields (spec section 4.1):
    - `missionExists: boolean`
    - `techStandardsExists: boolean`
    - `testStrategyExists: boolean`
    - `roadmapExists: boolean`
    - `architectureBaselineExists: boolean`
    - `epicCount: number`
    - `storyCount: number` (hardcoded 0 v1)
    - `storiesWithAC: number` (hardcoded 0 v1)
    - `storiesInProgress: number` (hardcoded 0 v1)
    - `storiesDone: number` (hardcoded 0 v1)
    - `storiesVerified: number` (hardcoded 0 v1)
  - Include JSDoc comments on every field matching the spec section 4.1 comments.
  - Export the interface as a named export: `export interface ProjectSignals { ... }`.
  - Stub the async function: `export async function buildProjectSignals(projectId: string): Promise<ProjectSignals>` returning all defaults (booleans = false, numbers = 0). Implementation comes in Task Group 2.
- **Acceptance**: File compiles with `npx tsc --noEmit`. Interface is importable from other gateway modules.

#### Task 1.2: Define NextAction, NextActionTarget, and WhatsNextResult interfaces
- [x] **File(s)**: `gateway/src/services/whatsNextEvaluator.ts`
- **Action**: Create
- **Details**:
  - Create a new file with the three interface exports and the evaluator function stub.
  - `NextActionTarget` interface (spec section 4.2):
    - `screen: string` -- target view identifier
    - `tab?: string` -- optional tab within target view
    - `personaId: string` -- persona ID to activate
    - `taskId?: string` -- optional task ID to auto-select
  - `NextAction` interface (spec section 4.2):
    - `id: string`
    - `label: string`
    - `reason: string`
    - `priority: number`
    - `target: NextActionTarget`
    - `launch: 'panel'`
  - `WhatsNextResult` interface (spec section 4.2):
    - `explanation: string`
    - `actions: NextAction[]`
  - Stub the pure function: `export function evaluateNextActions(signals: ProjectSignals): WhatsNextResult` returning `{ explanation: '', actions: [] }`. Implementation comes in Task Group 3.
  - Import `ProjectSignals` from `./projectSignals`.
- **Acceptance**: File compiles. All three interfaces and the function are importable. `evaluateNextActions` accepts a `ProjectSignals` argument.

---

### Task Group 2: Gateway ProjectSignals Service

**Goal**: Implement the `buildProjectSignals` function that computes a real-time project state snapshot by checking filesystem artifacts (MISSION.MD, TECH-STACK.MD, TEST-STRATEGY.MD) via `fs.access` and querying the architecture-model-service (roadmap, meta-model) via existing HTTP client functions.

**Dependencies**: Task Group 1

#### Task 2.1: Write 4-6 focused tests for ProjectSignals
- [x] **File(s)**: `gateway/src/__tests__/projectSignals.test.ts`
- **Action**: Create
- **Details**:
  - Import `buildProjectSignals` from `../services/projectSignals`.
  - Mock `fs.access` from `node:fs/promises` to control file existence.
  - Mock `fetchMetaModelSummary` from `../services/architectureModelClient` and `fetchProductSummary` from the same module.
  - Mock `hasExistingRoadmap` and `countRoadmapItems` from `../services/roadmapSummaryBuilder`.
  - Mock `getConfig` from `../config` to return a fake `conversationPersistBasePath`.
  - Test cases (limit to 4-6):
    1. All files exist + roadmap exists + architecture baseline exists => all booleans true, epicCount from `countRoadmapItems`.
    2. No files exist + no roadmap + no architecture => all booleans false, epicCount 0.
    3. Mission file exists (uppercase path), tech-stack only at lowercase fallback => `missionExists: true`, `techStandardsExists: true`.
    4. `fetchMetaModelSummary` throws => `architectureBaselineExists: false` (graceful degradation).
    5. `fetchProductSummary` throws => `roadmapExists: false`, `epicCount: 0` (graceful degradation).
    6. Story-level signals always 0 regardless of inputs.
- **Acceptance**: Tests define the expected behavior for signal computation and degradation.

#### Task 2.2: Implement fileExists helper
- [x] **File(s)**: `gateway/src/services/projectSignals.ts`
- **Action**: Modify
- **Details**:
  - Add `import fs from 'node:fs/promises';` and `import path from 'node:path';`.
  - Add private helper following spec section 5.1:
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
  - This is a module-private function (not exported).
- **Acceptance**: Helper compiles. Used by `buildProjectSignals` in next task.

#### Task 2.3: Implement buildProjectSignals with parallel signal resolution
- [x] **File(s)**: `gateway/src/services/projectSignals.ts`
- **Action**: Modify
- **Details**:
  - Add imports:
    - `getConfig` from `../config` (for `conversationPersistBasePath`)
    - `fetchMetaModelSummary`, `fetchProductSummary` from `./architectureModelClient`
    - `hasExistingRoadmap`, `countRoadmapItems` from `./roadmapSummaryBuilder`
  - Replace the stub `buildProjectSignals` with the full implementation per spec section 5.1.
  - Compute `basePath` = `getConfig().conversationPersistBasePath`, then `productDir` = `path.join(basePath, 'agent-os', 'product')`.
  - File signals (uppercase-first, lowercase-fallback via `||`):
    - `missionExists`: `fileExists(productDir, 'MISSION.MD') || fileExists(productDir, 'mission.md')`
    - `techStandardsExists`: `fileExists(productDir, 'TECH-STACK.MD') || fileExists(productDir, 'tech-stack.md')`
    - `testStrategyExists`: `fileExists(productDir, 'TEST-STRATEGY.MD') || fileExists(productDir, 'test-strategy.md')`
  - Use `Promise.all` for parallel resolution of file checks + HTTP calls per spec section 5.1:
    ```typescript
    const [missionExists, techStandardsExists, testStrategyExists, metaModelResult, productSummaryResult] = await Promise.all([
      fileExists(productDir, 'MISSION.MD').then(found => found || fileExists(productDir, 'mission.md')),
      fileExists(productDir, 'TECH-STACK.MD').then(found => found || fileExists(productDir, 'tech-stack.md')),
      fileExists(productDir, 'TEST-STRATEGY.MD').then(found => found || fileExists(productDir, 'test-strategy.md')),
      fetchMetaModelSummary(projectId).catch(() => null),
      fetchProductSummary(projectId).catch(() => null),
    ]);
    ```
  - Derive booleans from HTTP results:
    - `architectureBaselineExists`: `metaModelResult != null && ((metaModelResult.services?.length || 0) + (metaModelResult.data_entities?.length || 0) + (metaModelResult.interfaces?.length || 0)) > 0`
    - `roadmapExists`: `productSummaryResult != null && hasExistingRoadmap(productSummaryResult)`
    - `epicCount`: `productSummaryResult != null ? countRoadmapItems(productSummaryResult).epicCount : 0`
  - Hardcode story-level signals: `storyCount: 0, storiesWithAC: 0, storiesInProgress: 0, storiesDone: 0, storiesVerified: 0`.
  - Return the complete `ProjectSignals` object.
- **Acceptance**: Function compiles. Parallel execution verified. Graceful degradation confirmed (try/catch around HTTP calls).

#### Task 2.4: Verify ProjectSignals tests pass
- [x] **File(s)**: `gateway/src/__tests__/projectSignals.test.ts`
- **Action**: Run tests
- **Details**:
  - Run ONLY: `npx vitest run gateway/src/__tests__/projectSignals.test.ts`
  - All 4-6 tests from Task 2.1 should pass.
  - Do NOT run the full test suite.
- **Acceptance**: All ProjectSignals tests pass. No regressions introduced.

---

### Task Group 3: Gateway WhatsNextEvaluator

**Goal**: Implement the pure, synchronous `evaluateNextActions` function that takes a `ProjectSignals` snapshot and returns a deterministic `WhatsNextResult` with up to 5 recommended actions. This module has zero side effects and no I/O.

**Dependencies**: Task Group 1 (interfaces), Task Group 2 (ProjectSignals for type import only)

#### Task 3.1: Write 5-8 focused tests for WhatsNextEvaluator
- [x] **File(s)**: `gateway/src/__tests__/whatsNextEvaluator.test.ts`
- **Action**: Create
- **Details**:
  - Import `evaluateNextActions` from `../services/whatsNextEvaluator` and `ProjectSignals` from `../services/projectSignals`.
  - Create a helper `makeSignals(overrides?: Partial<ProjectSignals>): ProjectSignals` that returns all-true booleans and sensible numbers, with overrides applied.
  - Test cases (limit to 5-8):
    1. **No mission** (`missionExists: false`): Returns exactly 1 action with `id: 'define-mission'`, priority 100, target `{ screen: 'product', tab: 'product', personaId: 'product-manager', taskId: 'product-manager--define-product' }`. Explanation mentions "does not yet have a Product Mission".
    2. **Mission exists, tech stack missing**: Actions include `id: 'define-tech-stack'` with priority 80 and target `{ screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-tech-stack' }`.
    3. **Mission exists, multiple bootstrap items missing** (tech stack, roadmap, architecture, test strategy): Returns 4 actions ordered by priority descending (80, 70, 60, 50). Explanation mentions "missing 4 foundational artifacts".
    4. **All bootstrap complete**: Returns exactly 3 optimisation actions -- `review-roadmap` (priority 40), `review-architecture` (priority 35), `refresh-tech-standards` (priority 30). Explanation mentions "All foundational artifacts are in place".
    5. **Maximum 5 actions rule**: Even with all 5 bootstrap items missing (impossible since mission blocks others, but test the slice logic) -- result.actions.length <= 5.
    6. **No mission blocks other actions**: When `missionExists: false` but other signals are also false, only the define-mission action is returned.
    7. **All actions have launch: 'panel'**: Verify every action in every scenario has `launch: 'panel'`.
    8. **Action catalog correctness**: Verify each bootstrap action's exact `id`, `label`, `target.personaId`, and `target.taskId` fields match the spec section 6 catalog.
- **Acceptance**: Tests define the complete deterministic evaluation logic for all branches.

#### Task 3.2: Implement evaluateNextActions with bootstrap and optimisation logic
- [x] **File(s)**: `gateway/src/services/whatsNextEvaluator.ts`
- **Action**: Modify
- **Details**:
  - Replace the stub function with the full implementation per spec section 5.2.
  - Define the 8 action constants inline or as module-level `const` objects matching the Action Catalog (spec section 6):
    - `DEFINE_MISSION_ACTION`: id `define-mission`, label `Define Product Mission`, priority 100, target `{ screen: 'product', tab: 'product', personaId: 'product-manager', taskId: 'product-manager--define-product' }`, launch `panel`.
    - `DEFINE_TECH_STACK_ACTION`: id `define-tech-stack`, label `Define Tech Stack`, priority 80, target `{ screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-tech-stack' }`.
    - `DEFINE_ROADMAP_ACTION`: id `define-roadmap`, label `Define Product Roadmap`, priority 70, target `{ screen: 'product', tab: 'roadmap', personaId: 'product-manager', taskId: 'product-manager--roadmap' }`.
    - `DEFINE_ARCHITECTURE_ACTION`: id `define-architecture`, label `Define Architecture Baseline`, priority 60, target `{ screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-architecture' }`.
    - `DEFINE_TEST_STRATEGY_ACTION`: id `define-test-strategy`, label `Define Test Strategy`, priority 50, target `{ screen: 'metamodel', personaId: 'test-engineer', taskId: 'test-engineer--test-strategy' }`.
    - `REVIEW_ROADMAP_ACTION`: id `review-roadmap`, priority 40, target `{ screen: 'product', tab: 'roadmap', personaId: 'product-manager', taskId: 'product-manager--roadmap' }`.
    - `REVIEW_ARCHITECTURE_ACTION`: id `review-architecture`, priority 35, target `{ screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-architecture' }`.
    - `REFRESH_TECH_STANDARDS_ACTION`: id `refresh-tech-standards`, priority 30, target `{ screen: 'metamodel', personaId: 'architect', taskId: 'architect--define-tech-stack' }`.
  - Each action constant includes `reason` string from spec section 5.2 and `launch: 'panel' as const`.
  - Implement the three-branch logic:
    1. Hard rule: `!signals.missionExists` => return only DEFINE_MISSION_ACTION.
    2. Bootstrap checks: push missing items in priority order, return if any found (`actions.slice(0, 5)`).
    3. Optimisation: push review-roadmap, review-architecture, refresh-tech-standards, return (`actions.slice(0, 5)`).
  - Explanation strings per spec section 5.2 for each branch.
- **Acceptance**: Function is pure and synchronous. Returns correct actions for all branches.

#### Task 3.3: Verify WhatsNextEvaluator tests pass
- [x] **File(s)**: `gateway/src/__tests__/whatsNextEvaluator.test.ts`
- **Action**: Run tests
- **Details**:
  - Run ONLY: `npx vitest run gateway/src/__tests__/whatsNextEvaluator.test.ts`
  - All 5-8 tests from Task 3.1 should pass.
- **Acceptance**: All evaluator tests pass.

---

### Task Group 4: Gateway ChatV2 Short-Circuit

**Goal**: Wire the ProjectSignals service and WhatsNextEvaluator into the existing `POST /api/chat/v2` endpoint via a task-specific short-circuit that bypasses the LLM entirely for `assistant--whats-next`.

**Dependencies**: Task Group 2 (buildProjectSignals), Task Group 3 (evaluateNextActions)

#### Task 4.1: Write 3-5 focused tests for the chatV2 whats-next short-circuit
- [x] **File(s)**: `gateway/src/__tests__/chatV2-whatsNext.test.ts`
- **Action**: Create
- **Details**:
  - This is an integration-level test for the short-circuit path.
  - Mock `buildProjectSignals` from `../services/projectSignals` to return controlled signals.
  - Mock `evaluateNextActions` from `../services/whatsNextEvaluator` to return controlled results.
  - Mock `appendMessage` from the thread persistence module.
  - Test cases (limit to 3-5):
    1. **Short-circuit triggers**: When `request.taskId === 'assistant--whats-next'`, response includes `structuredResponse.type === 'whats-next-actions'` and `structuredResponse.actions` array.
    2. **Messages persisted**: Both user message (role `user`) and assistant message (role `assistant`) are persisted via `appendMessage` -- verify 2 calls.
    3. **Response shape**: Response has `threadKey`, `personaId`, `taskId`, `assistant.message`, and `structuredResponse` fields matching `ChatV2Response` interface (spec section 4.3).
    4. **No LLM call made**: Verify that no LLM/OpenAI client call is triggered (the mock should not be invoked).
    5. **Non-whats-next tasks are unaffected**: Verify that a different taskId (e.g., `product-manager--define-product`) does NOT trigger the short-circuit.
- **Acceptance**: Tests validate the short-circuit wiring without exercising the full endpoint stack.

#### Task 4.2: Add imports to chatV2.ts
- [x] **File(s)**: `gateway/src/routes/chatV2.ts`
- **Action**: Modify
- **Details**:
  - Add to the import section at the top of the file:
    ```typescript
    import { buildProjectSignals } from '../services/projectSignals';
    import { evaluateNextActions } from '../services/whatsNextEvaluator';
    ```
  - These join the existing imports for `fetchProductSummary`, `hasExistingRoadmap`, `countRoadmapItems`, etc.
- **Acceptance**: File compiles with no import errors.

#### Task 4.3: Insert whats-next short-circuit block after task validation
- [x] **File(s)**: `gateway/src/routes/chatV2.ts`
- **Action**: Modify
- **Details**:
  - **Insertion point**: After the task registry validation block (line 1753-1759, ending with `const task = taskRegistry.get(request.taskId)` success) and before "Step 5: Resolve context" (line 1761).
  - Insert a new block following the exact pattern from the roadmap first-turn short-circuit at lines 1828-1908.
  - Block structure per spec section 5.3:
    ```typescript
    // ---- Step 4b: Deterministic short-circuit for assistant--whats-next ----
    if (task.id === 'assistant--whats-next') {
      const signals = await buildProjectSignals(threadKey.projectId);
      const result = evaluateNextActions(signals);

      const whatsNextResponse = {
        type: 'whats-next-actions' as const,
        explanation: result.explanation,
        actions: result.actions,
      };

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
  - The `return;` at the end skips all subsequent processing (context resolution, LLM call).
  - Uses `uuidv4()` for message IDs (already imported in the file).
  - Uses `appendMessage(threadKey, message)` (already imported in the file).
  - Response follows `ChatV2Response` interface from `gateway/src/types/chatV2.ts` line 288.
- **Acceptance**: When `taskId === 'assistant--whats-next'`, the endpoint returns a deterministic response without invoking the LLM. Other task flows are unaffected.

#### Task 4.4: Verify chatV2 short-circuit tests pass
- [x] **File(s)**: `gateway/src/__tests__/chatV2-whatsNext.test.ts`
- **Action**: Run tests
- **Details**:
  - Run ONLY: `npx vitest run gateway/src/__tests__/chatV2-whatsNext.test.ts`
  - All 3-5 tests from Task 4.1 should pass.
- **Acceptance**: All short-circuit tests pass.

---

### Task Group 5: Frontend Data Types & PendingActionContext

**Goal**: Create the `PendingAction` type and `PendingActionContext` React context that enables cross-screen action handoff, and wire it into the App.tsx provider tree. This provides the shared state mechanism before any UI components consume it.

**Dependencies**: None (frontend-only; gateway work is independent)

#### Task 5.1: Create PendingActionContext with Provider and hook
- [x] **File(s)**: `frontend/src/contexts/PendingActionContext.tsx`
- **Action**: Create
- **Details**:
  - Follow the exact pattern from `frontend/src/contexts/ImportActionsContext.tsx` (lines 17-93).
  - Define `PendingAction` interface (spec section 4.4):
    ```typescript
    export interface PendingAction {
      screen: string;
      tab?: string;
      personaId: string;
      taskId?: string;
    }
    ```
  - Define `PendingActionContextType` interface:
    ```typescript
    interface PendingActionContextType {
      pendingAction: PendingAction | null;
      setPendingAction: (action: PendingAction) => void;
      clearPendingAction: () => void;
    }
    ```
  - Create context: `const PendingActionContext = createContext<PendingActionContextType | undefined>(undefined);`
  - Create `PendingActionProvider` component:
    - Props: `{ children: ReactNode }`
    - State: `const [pendingAction, setPendingActionState] = useState<PendingAction | null>(null);`
    - `setPendingAction`: wraps `setPendingActionState`.
    - `clearPendingAction`: calls `setPendingActionState(null)`.
    - Provides value: `{ pendingAction, setPendingAction, clearPendingAction }`.
  - Create `usePendingAction()` hook:
    - Returns the context value.
    - Throws `Error('usePendingAction must be used within a PendingActionProvider')` if context is undefined.
  - Export: `PendingAction`, `PendingActionProvider`, `usePendingAction`.
- **Acceptance**: File compiles. Provider and hook are importable.

#### Task 5.2: Add PendingActionProvider to App.tsx provider tree
- [x] **File(s)**: `frontend/src/App.tsx`
- **Action**: Modify
- **Details**:
  - Add import: `import { PendingActionProvider } from './contexts/PendingActionContext';`
  - Modify the `App()` component's return (currently at lines 183-195) to wrap `<AppContent />` with `<PendingActionProvider>`:
    ```tsx
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
  - This placement is inside `ArchitectureProvider` so that `PendingActionProvider` and its consumers have access to the architecture dispatch.
- **Acceptance**: App renders without error. Provider is active in the component tree.

---

### Task Group 6: Frontend WhatsNextActionList Renderer Component

**Goal**: Create the `WhatsNextActionList` component and its CSS module that renders the "whats-next-actions" structured response as a vertical list of clickable cards. This component is self-contained and can be developed independently of MessageBubble integration.

**Dependencies**: None (standalone component; integration comes in Task Group 7)

#### Task 6.1: Write 3-5 focused tests for WhatsNextActionList
- [x] **File(s)**: `frontend/src/components/UnifiedChat/__tests__/whatsNextActionList.test.tsx`
- **Action**: Create
- **Details**:
  - Import `WhatsNextActionList` from `../WhatsNextActionList`.
  - Use `@testing-library/react` for rendering and assertions.
  - Test cases (limit to 3-5):
    1. **Renders explanation text**: Given an explanation string, verify it appears in the document.
    2. **Renders correct number of action cards**: Given 3 actions, verify 3 buttons are rendered with `data-testid="whats-next-action-{action.id}"`.
    3. **Displays label and reason**: Verify each card shows `action.label` as primary text and `action.reason` as secondary text.
    4. **Calls onActionClick on card click**: Click a card button and verify `onActionClick` is called with the correct action object.
    5. **Handles empty actions array**: Given an empty actions array, verify explanation is rendered and no cards appear.
- **Acceptance**: Tests define the expected rendering and interaction behavior.

#### Task 6.2: Create WhatsNextActionList.module.css
- [x] **File(s)**: `frontend/src/components/UnifiedChat/WhatsNextActionList.module.css`
- **Action**: Create
- **Details**:
  - Replicate the card styling from `frontend/src/components/UnifiedChat/TaskMenu.module.css` (lines 1-57).
  - Classes to define:
    - `.container`: flex column, gap 8px, margin-top 8px (same as TaskMenu.container lines 12-17).
    - `.actionCard`: flex column, gap 4px, padding 10px 14px, background #ffffff, border 1px solid #e0e0e0, border-radius 6px, cursor pointer, width 100%, transition on background-color and border-color (same as TaskMenu.taskCard lines 20-32).
    - `.actionCard:hover`: background #f5f5f5, border-color #bdbdbd (same as TaskMenu.taskCard:hover lines 34-37).
    - `.actionCard:active`: background #eeeeee (same as TaskMenu.taskCard:active lines 39-41).
    - `.actionLabel`: font-size 14px, font-weight 600, color #333333, line-height 1.4 (same as TaskMenu.menuLabel lines 44-49).
    - `.actionReason`: font-size 12px, font-weight 400, color #666666, line-height 1.4 (same as TaskMenu.description lines 52-57).
    - `.explanation`: margin-bottom 8px (paragraph spacing for the explanation text above cards).
- **Acceptance**: CSS module file exists and is importable from the TSX component.

#### Task 6.3: Create WhatsNextActionList component
- [x] **File(s)**: `frontend/src/components/UnifiedChat/WhatsNextActionList.tsx`
- **Action**: Create
- **Details**:
  - Follow the structure of `frontend/src/components/UnifiedChat/TaskMenu.tsx` (lines 41-58).
  - Import styles from `./WhatsNextActionList.module.css`.
  - Define `NextAction` type inline (or import from a shared types file if one is created):
    ```typescript
    export interface NextAction {
      id: string;
      label: string;
      reason: string;
      priority: number;
      target: { screen: string; tab?: string; personaId: string; taskId?: string };
      launch: string;
    }
    ```
  - Define props interface:
    ```typescript
    interface WhatsNextActionListProps {
      explanation: string;
      actions: NextAction[];
      onActionClick: (action: NextAction) => void;
    }
    ```
  - Component implementation:
    ```tsx
    export function WhatsNextActionList({ explanation, actions, onActionClick }: WhatsNextActionListProps) {
      return (
        <div data-testid="whats-next-action-list">
          <p className={styles.explanation}>{explanation}</p>
          <div className={styles.container}>
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                className={styles.actionCard}
                onClick={() => onActionClick(action)}
                data-testid={`whats-next-action-${action.id}`}
              >
                <span className={styles.actionLabel}>{action.label}</span>
                <span className={styles.actionReason}>{action.reason}</span>
              </button>
            ))}
          </div>
        </div>
      );
    }
    ```
- **Acceptance**: Component renders correctly. Cards are clickable. Follows TaskMenu patterns.

#### Task 6.4: Verify WhatsNextActionList tests pass
- [x] **File(s)**: `frontend/src/components/UnifiedChat/__tests__/whatsNextActionList.test.tsx`
- **Action**: Run tests
- **Details**:
  - Run ONLY: `npx vitest run frontend/src/components/UnifiedChat/__tests__/whatsNextActionList.test.tsx`
  - All 3-5 tests from Task 6.1 should pass.
- **Acceptance**: All component tests pass.

---

### Task Group 7: Frontend MessageBubble Integration

**Goal**: Add the `isWhatsNextActions` type guard and rendering branch into `MessageBubble.tsx` so that when a message contains a `structuredResponse` with `type: 'whats-next-actions'`, it renders using the `WhatsNextActionList` component.

**Dependencies**: Task Group 6 (WhatsNextActionList component)

#### Task 7.1: Add isWhatsNextActions type guard to MessageBubble
- [x] **File(s)**: `frontend/src/components/UnifiedChat/MessageBubble.tsx`
- **Action**: Modify
- **Details**:
  - Add a new type guard function in the "Structured Response Type Guards" section (after line 207, alongside `isCompletionChip`):
    ```typescript
    /**
     * Checks if the structuredResponse is a whats-next-actions type.
     * Spec 2026-03-04: Assistant "What's Next" v1
     */
    function isWhatsNextActions(
      sr: unknown
    ): sr is { type: 'whats-next-actions'; explanation: string; actions: Array<{ id: string; label: string; reason: string; priority: number; target: { screen: string; tab?: string; personaId: string; taskId?: string }; launch: string }> } {
      if (sr == null || typeof sr !== 'object') return false;
      const obj = sr as Record<string, unknown>;
      return obj.type === 'whats-next-actions' && Array.isArray(obj.actions);
    }
    ```
  - Follows the exact pattern of `isTaskMenu` (lines 102-108), `isArtifactPreview` (lines 144-150), etc.
- **Acceptance**: Type guard compiles. Correctly identifies `whats-next-actions` structured responses.

#### Task 7.2: Add onActionClick prop to MessageBubbleProps
- [x] **File(s)**: `frontend/src/components/UnifiedChat/MessageBubble.tsx`
- **Action**: Modify
- **Details**:
  - Add to the `MessageBubbleProps` interface (around line 85-93):
    ```typescript
    /** Callback when a "What's Next" action card is clicked */
    onActionClick?: (action: { id: string; label: string; reason: string; priority: number; target: { screen: string; tab?: string; personaId: string; taskId?: string }; launch: string }) => void;
    ```
  - Destructure `onActionClick` in the component function signature (line 214-222), adding it alongside `onDownloadTranscript`.
  - Import `WhatsNextActionList` and its `NextAction` type: `import { WhatsNextActionList, NextAction } from './WhatsNextActionList';`
- **Acceptance**: Prop is accepted without type errors. Import resolves.

#### Task 7.3: Add whats-next-actions rendering branch to MessageBubble JSX
- [x] **File(s)**: `frontend/src/components/UnifiedChat/MessageBubble.tsx`
- **Action**: Modify
- **Details**:
  - Add check variable alongside existing ones (line 230-237):
    ```typescript
    const showWhatsNextActions = isWhatsNextActions(structuredResponse);
    ```
  - Update the `showQuestions` guard to also exclude `showWhatsNextActions`:
    ```typescript
    const showQuestions = !showTaskMenu && !showArtifactPreview && !showRoadmapPreview && !showArchitecturePreview && !showTechStackPreview && !showTestStrategyPreview && !showCompletionChip && !showWhatsNextActions && hasQuestions(structuredResponse);
    ```
  - Insert new rendering branch in the ternary chain, after the `showCompletionChip` branch (line 372-382) and before the `showQuestions` branch (line 383):
    ```tsx
    ) : showWhatsNextActions && onActionClick ? (
      /* What's Next Actions: render as clickable action cards */
      <div className={styles.structuredResponseArea}>
        {content && (
          <div className={styles.messageContent}>{content}</div>
        )}
        <WhatsNextActionList
          explanation={(structuredResponse as { explanation: string }).explanation}
          actions={(structuredResponse as { actions: NextAction[] }).actions}
          onActionClick={onActionClick}
        />
      </div>
    ```
  - This matches the exact pattern of other structured response branches (e.g., showTestStrategyPreview at lines 357-371).
- **Acceptance**: When a message has `structuredResponse.type === 'whats-next-actions'`, the WhatsNextActionList component renders inside the message bubble.

---

### Task Group 8: Frontend ChatThread Prop Threading

**Goal**: Thread the `onActionClick` callback through `ChatThread` down to each `MessageBubble` instance, following the existing prop-forwarding pattern.

**Dependencies**: Task Group 7 (MessageBubble accepts onActionClick)

#### Task 8.1: Add onActionClick prop to ChatThreadProps
- [x] **File(s)**: `frontend/src/components/UnifiedChat/ChatThread.tsx`
- **Action**: Modify
- **Details**:
  - Add to `ChatThreadProps` interface (lines 34-53):
    ```typescript
    /** Callback when a "What's Next" action card is clicked */
    onActionClick?: (action: { id: string; label: string; reason: string; priority: number; target: { screen: string; tab?: string; personaId: string; taskId?: string }; launch: string }) => void;
    ```
  - Destructure `onActionClick` in the component function signature (line 59-69), adding it alongside `isConfirmingArtifact`.
  - Pass `onActionClick` to each `<MessageBubble>` in the render loop (line 129-139):
    ```tsx
    <MessageBubble
      key={message.id}
      message={message}
      onSelectTask={onSelectTask}
      onSubmitAnswers={onSubmitAnswers}
      onConfirmArtifact={onConfirmArtifact}
      onRejectArtifact={onRejectArtifact}
      onDownloadTranscript={onDownloadTranscript}
      onActionClick={onActionClick}
      disabled={sealedTaskIds?.has(message.taskId || '') || false}
      isConfirmingArtifact={isConfirmingArtifact}
    />
    ```
  - This follows the exact pattern used for `onDownloadTranscript` and other callback props threaded from ChatThread to MessageBubble.
- **Acceptance**: `onActionClick` is passed from ChatThread to every MessageBubble. No type errors.

---

### Task Group 9: Frontend UnifiedChatPanel Integration

**Goal**: Wire the action click handler and pending action consumption into `UnifiedChatPanel.tsx`. This is the central integration point: clicking an action card triggers navigation + persona/task selection, and arriving on a target screen auto-consumes any pending action.

**Dependencies**: Task Group 5 (PendingActionContext), Task Group 8 (ChatThread accepts onActionClick)

#### Task 9.1: Add imports for PendingActionContext and architecture dispatch
- [x] **File(s)**: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
- **Action**: Modify
- **Details**:
  - Add imports at the top of the file:
    ```typescript
    import { usePendingAction } from '../../contexts/PendingActionContext';
    import { useArchitectureDispatch } from '../../contexts/ArchitectureContext';
    ```
  - `useArchitectureDispatch` provides the `dispatch` function for `SET_VIEW` navigation (same pattern used in `DashboardView.tsx` line 52-63).
- **Acceptance**: Imports resolve without errors.

#### Task 9.2: Add usePendingAction and dispatch hooks to component body
- [x] **File(s)**: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
- **Action**: Modify
- **Details**:
  - Inside the `UnifiedChatPanel` component function, after the `useChatThread` destructuring (line 165-178), add:
    ```typescript
    const { pendingAction, setPendingAction, clearPendingAction } = usePendingAction();
    const dispatch = useArchitectureDispatch();
    ```
- **Acceptance**: Hooks are called at the top level of the component.

#### Task 9.3: Implement handleWhatsNextAction callback
- [x] **File(s)**: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
- **Action**: Modify
- **Details**:
  - Add a new `useCallback` handler after the `handleSubmitAnswers` block (around line 289):
    ```typescript
    const handleWhatsNextAction = useCallback(
      (action: { id: string; label: string; reason: string; priority: number; target: { screen: string; tab?: string; personaId: string; taskId?: string }; launch: string }) => {
        const target = action.target;

        // Determine current screen from threadKey
        const currentScreen = threadKey.type === 'hub' ? 'dashboard'
          : (threadKey as { screen: string }).screen;

        if (target.screen === currentScreen || (target.screen === 'dashboard' && threadKey.type === 'hub')) {
          // Same screen: directly switch persona and select task
          selectPersona(target.personaId);
          if (target.taskId) {
            // Brief delay to allow persona switch greeting + task menu to resolve
            setTimeout(() => selectTask(target.taskId!), 500);
          }
        } else {
          // Different screen: set pending action and navigate
          setPendingAction({
            screen: target.screen,
            tab: target.tab,
            personaId: target.personaId,
            taskId: target.taskId,
          });
          // Navigate using the same pattern as DashboardView.navigateTo (lines 52-63)
          if (target.screen === 'product' && target.tab) {
            dispatch({ type: 'SET_VIEW', payload: 'product' });
            window.history.pushState({}, '', '?tab=' + target.tab);
          } else {
            dispatch({ type: 'SET_VIEW', payload: target.screen });
          }
        }
      },
      [threadKey, selectPersona, selectTask, setPendingAction, dispatch]
    );
    ```
  - Navigation logic replicates `DashboardView.navigateTo` (lines 52-63): `dispatch({ type: 'SET_VIEW', payload: view })` + `window.history.pushState` for tab routing.
- **Acceptance**: Clicking an action card targeting the same screen switches persona/task directly. Clicking one targeting a different screen sets pending action and navigates.

#### Task 9.4: Implement pending action consumption useEffect
- [x] **File(s)**: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
- **Action**: Modify
- **Details**:
  - Add a `useEffect` after the existing `useEffect` blocks (after the width persistence effect around line 275):
    ```typescript
    // ---------------------------------------------------------------------------
    // Consume Pending Action on Mount
    // Spec 2026-03-04: Assistant "What's Next" v1
    // When navigating from a "What's Next" action card, the target screen's
    // UnifiedChatPanel auto-expands, switches persona, and selects the task.
    // ---------------------------------------------------------------------------
    useEffect(() => {
      if (pendingAction) {
        // Expand the panel if collapsed
        setIsCollapsed(false);
        // Switch to the target persona
        selectPersona(pendingAction.personaId);
        // Select the task after a brief delay (allows greeting + task menu)
        if (pendingAction.taskId) {
          setTimeout(() => selectTask(pendingAction.taskId!), 500);
        }
        // Clear immediately to prevent re-triggering
        clearPendingAction();
      }
    }, [pendingAction, selectPersona, selectTask, clearPendingAction]);
    ```
  - The `clearPendingAction()` call happens synchronously after reading the pending action, preventing re-triggers on re-renders (spec section 5.5).
  - `setIsCollapsed(false)` ensures the panel opens even if it was collapsed.
- **Acceptance**: When a pending action exists in context, the panel expands, switches persona, and selects the task on mount. Action is cleared immediately.

#### Task 9.5: Pass handleWhatsNextAction through ChatThread
- [x] **File(s)**: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
- **Action**: Modify
- **Details**:
  - In the JSX render section, add `onActionClick` to the `<ChatThread>` props (around line 456-466):
    ```tsx
    <ChatThread
      messages={messages}
      isLoading={isLoading || isGenerating}
      onSelectTask={selectTask}
      onSubmitAnswers={handleSubmitAnswers}
      onConfirmArtifact={confirmArtifact}
      onRejectArtifact={rejectArtifact}
      onDownloadTranscript={handleDownloadTranscript}
      onActionClick={handleWhatsNextAction}
      sealedTaskIds={sealedTaskIds}
      isConfirmingArtifact={isSaving}
    />
    ```
- **Acceptance**: The `onActionClick` prop flows: UnifiedChatPanel -> ChatThread -> MessageBubble -> WhatsNextActionList.

---

### Task Group 10: Test Review & End-to-End Verification

**Goal**: Review all tests written in previous groups, fill any critical gaps, and verify the complete feature works end-to-end. Produce a manual testing checklist for integration verification.

**Dependencies**: Task Groups 1-9

#### Task 10.1: Review existing tests from Task Groups 2, 3, 4, and 6
- [x] **File(s)**: All test files created in previous groups
- **Action**: Review
- **Details**:
  - Review tests from:
    - `gateway/src/__tests__/projectSignals.test.ts` (Task 2.1, 4-6 tests)
    - `gateway/src/__tests__/whatsNextEvaluator.test.ts` (Task 3.1, 5-8 tests)
    - `gateway/src/__tests__/chatV2-whatsNext.test.ts` (Task 4.1, 3-5 tests)
    - `frontend/src/components/UnifiedChat/__tests__/whatsNextActionList.test.tsx` (Task 6.1, 3-5 tests)
  - Total existing tests: approximately 15-24 tests.
  - Identify any critical gaps in coverage.
- **Acceptance**: Review completed, gaps identified.

#### Task 10.2: Write up to 6 additional integration/gap tests if needed
- [x] **File(s)**: `frontend/src/components/UnifiedChat/__tests__/whatsNextIntegration.test.tsx` or relevant test files
- **Action**: Create (if gaps found)
- **Details**:
  - Focus on integration points not covered by unit tests:
    1. **MessageBubble renders WhatsNextActionList**: Given a message with `structuredResponse.type === 'whats-next-actions'`, verify `WhatsNextActionList` component is rendered within the bubble.
    2. **MessageBubble excludes questions when whats-next-actions present**: Verify that `showQuestions` is false when `showWhatsNextActions` is true.
    3. **PendingActionContext round-trip**: `setPendingAction` followed by reading `pendingAction` returns the correct value; `clearPendingAction` resets to null.
    4. **ChatThread forwards onActionClick**: Verify the prop reaches MessageBubble (shallow render check).
  - Maximum 6 additional tests. Skip if existing coverage is sufficient.
- **Acceptance**: Critical integration points between components are covered.

#### Task 10.3: Run all feature-specific tests
- [x] **File(s)**: All test files from this feature
- **Action**: Run tests
- **Details**:
  - Run all feature-related tests together:
    ```
    npx vitest run gateway/src/__tests__/projectSignals.test.ts gateway/src/__tests__/whatsNextEvaluator.test.ts gateway/src/__tests__/chatV2-whatsNext.test.ts frontend/src/components/UnifiedChat/__tests__/whatsNextActionList.test.tsx frontend/src/components/UnifiedChat/__tests__/whatsNextIntegration.test.tsx
    ```
  - Expected total: approximately 21-30 tests.
  - Do NOT run the entire application test suite.
- **Acceptance**: All feature-specific tests pass.

#### Task 10.4: Manual end-to-end verification checklist
- [x] **File(s)**: N/A (manual testing)
- **Action**: Verify
- **Details**:
  - Start both gateway and frontend dev servers.
  - Verify against spec Acceptance Criteria (section 9):
    1. [ ] On Dashboard, select `@assistant` persona, choose "What's Next?" -- response appears within 2 seconds (no LLM latency).
    2. [ ] On a fresh project (no artifacts), response shows exactly 1 action: "Define Product Mission".
    3. [ ] On a project with MISSION.MD but missing TECH-STACK.MD and roadmap, response shows both "Define Tech Stack" and "Define Product Roadmap" in priority order.
    4. [ ] On a fully bootstrapped project, response shows 3 optimisation actions: "Review/Update Roadmap", "Review/Update Architecture Baseline", "Refresh Tech Standards".
    5. [ ] Each action card displays label (bold) and reason (lighter text).
    6. [ ] Click "Define Product Mission" card -- navigates to Product Definition screen, panel opens, switches to product-manager persona, triggers define-product task.
    7. [ ] Click "Define Architecture Baseline" card -- navigates to MetaModel screen, panel opens, switches to architect persona, triggers define-architecture task.
    8. [ ] Click an action targeting the Dashboard while on Dashboard -- no navigation, persona switches directly.
    9. [ ] Refresh the page after "What's Next?" -- messages are visible in thread (persisted via GET /api/chat/v2/thread).
    10. [ ] Verify no LLM API calls appear in gateway logs for `assistant--whats-next`.
    11. [ ] Verify max 5 actions are ever returned.
    12. [ ] If architecture-model-service is stopped, signals degrade gracefully and a valid response is still returned.
- **Acceptance**: All manual verification items confirmed.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1**: Gateway Data Contracts & Types (interfaces only, stubs)
2. **Task Group 2**: Gateway ProjectSignals Service (signal computation)
3. **Task Group 3**: Gateway WhatsNextEvaluator (deterministic logic)
4. **Task Group 4**: Gateway ChatV2 Short-Circuit (endpoint wiring)
5. **Task Group 5**: Frontend Data Types & PendingActionContext (context + App.tsx)
6. **Task Group 6**: Frontend WhatsNextActionList Renderer (component + CSS)
7. **Task Group 7**: Frontend MessageBubble Integration (type guard + rendering)
8. **Task Group 8**: Frontend ChatThread Prop Threading (prop forwarding)
9. **Task Group 9**: Frontend UnifiedChatPanel Integration (action handler + pending action)
10. **Task Group 10**: Test Review & End-to-End Verification

**Notes**:
- Task Groups 1-4 (gateway) and Task Groups 5-6 (frontend) can be developed in parallel by different engineers since they have no cross-dependency until integration.
- Task Group 7 depends on Task Group 6. Task Group 8 depends on Task Group 7. Task Group 9 depends on Task Groups 5 and 8.
- Task Group 10 depends on all previous groups.
