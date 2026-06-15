# What's Next v1-B: Modal Launch -- Tasks

> Source: `agent-os/specs/2026-03-04-whats-next-v1b-modal-launch/spec.md`

## Implementation Order & Strategy

This feature touches a narrow vertical slice: gateway types, a new React context, frontend type updates across 3 components, a handler branch in UnifiedChatPanel, and provider wiring in TopBar. Tasks are ordered in strict dependency layers:

1. **Gateway types first** -- the discriminated union must exist before anything consumes it.
2. **Frontend context** -- ModalActionContext must exist before UnifiedChatPanel can call it or TopBar can provide it.
3. **Frontend type updates** -- WhatsNextActionList, MessageBubble, and UnifiedChatPanel types must all accept the new union shape.
4. **Wiring** -- TopBar wraps with ModalActionProvider; UnifiedChatPanel branches on `launch === 'modal'`.
5. **Tests** -- update existing tests and add integration coverage last.

Total Tasks: 18 (across 7 task groups)

---

## Task Groups

### Task Group 1: Gateway Discriminated Union Types

**Goal**: Refactor the `NextAction` type in `whatsNextEvaluator.ts` into a `PanelAction | ModalAction` discriminated union and update the two action constants that become modal actions.

**Dependencies**: None

#### Task 1.1: Refactor NextAction into PanelAction | ModalAction union

- [x] **File**: `gateway/src/services/whatsNextEvaluator.ts`
- **Action**: Modify
- **Details**:
  - Replace the single `NextAction` interface and `NextActionTarget` interface with four types:
    - `PanelActionTarget` -- identical to current `NextActionTarget`: `{ screen: string; tab?: string; personaId: string; taskId?: string }`
    - `ModalActionTarget` -- minimal: `{ personaId: string }` (for display/badge only, no routing fields)
    - `PanelAction` -- shared fields (`id`, `label`, `reason`, `priority`) + `launch: 'panel'` + `target: PanelActionTarget`
    - `ModalAction` -- shared fields (`id`, `label`, `reason`, `priority`) + `launch: 'modal'` + `modalId: string` + `target: ModalActionTarget`
  - Export `NextAction = PanelAction | ModalAction` as the union type.
  - Export both `PanelAction` and `ModalAction` individually (consumed by frontend type guards).
  - `WhatsNextResult` stays unchanged: `{ explanation: string; actions: NextAction[] }`.
  - Keep all JSDoc comments on every field.

#### Task 1.2: Update DEFINE_TECH_STACK_ACTION and REFRESH_TECH_STANDARDS_ACTION to ModalAction

- [x] **File**: `gateway/src/services/whatsNextEvaluator.ts`
- **Action**: Modify
- **Depends on**: Task 1.1
- **Details**:
  - Change `DEFINE_TECH_STACK_ACTION` constant from `PanelAction` to `ModalAction`:
    - `launch: 'modal'`
    - `modalId: 'generate-standards'`
    - `target: { personaId: 'architect' }` (drop `screen`, `tab`, `taskId`)
    - `id`, `label`, `reason`, `priority` remain unchanged (`id: 'define-tech-stack'`, `label: 'Define Tech Stack'`, `priority: 80`)
  - Change `REFRESH_TECH_STANDARDS_ACTION` constant from `PanelAction` to `ModalAction`:
    - Same shape as above: `launch: 'modal'`, `modalId: 'generate-standards'`, `target: { personaId: 'architect' }`
    - `id`, `label`, `reason`, `priority` remain unchanged (`id: 'refresh-tech-standards'`, `label: 'Refresh Tech Standards'`, `priority: 30`)
  - All other 6 action constants remain as `PanelAction` with no changes.
  - Verify the file compiles: `npx tsc --noEmit` from gateway root.

**Acceptance Criteria:**
- `NextAction` is a discriminated union with `launch` as the discriminant.
- `DEFINE_TECH_STACK_ACTION` and `REFRESH_TECH_STANDARDS_ACTION` are `ModalAction` shapes.
- All 6 other action constants remain `PanelAction` shapes unchanged.
- `evaluateNextActions` function requires no logic changes (it still pushes the same constants).
- File compiles with zero type errors.

---

### Task Group 2: ModalActionContext Creation

**Goal**: Create the `ModalActionContext` React context following the exact `ImportActionsContext` pattern. This provides the cross-component channel for UnifiedChatPanel to tell TopBar to open the Generate Standards modal.

**Dependencies**: None (frontend-only; independent of gateway)

#### Task 2.1: Create ModalActionContext with Provider and hook

- [x] **File**: `frontend/src/contexts/ModalActionContext.tsx`
- **Action**: Create
- **Details**:
  - Follow the exact pattern from `frontend/src/contexts/ImportActionsContext.tsx` (lines 17-93).
  - Define `ModalActionsContextType` interface:
    ```typescript
    export interface ModalActionsContextType {
      openGenerateStandardsModal: () => void;
    }
    ```
  - Create context with a **safe no-op default** (not `undefined`) to avoid test wrapper boilerplate:
    ```typescript
    const ModalActionContext = createContext<ModalActionsContextType>({
      openGenerateStandardsModal: () => {},
    });
    ```
  - Create `ModalActionProvider` component:
    - Props: `{ children: ReactNode; openGenerateStandardsModal: () => void }`
    - Provides value: `{ openGenerateStandardsModal }`
    - Matches `ImportActionsProvider` prop-callback pattern (parent owns the handler, provider exposes it).
  - Create `useModalActions()` hook:
    - Returns `useContext(ModalActionContext)` directly (no throw on missing provider because of no-op default).
  - Export: `ModalActionsContextType`, `ModalActionProvider`, `useModalActions`.

**Acceptance Criteria:**
- File compiles and exports are importable.
- `useModalActions()` returns a no-op default when used outside a provider (safe for tests).
- Pattern matches `ImportActionsContext` structurally.

---

### Task Group 3: Frontend Type Updates

**Goal**: Update the `NextAction` type in `WhatsNextActionList.tsx` and the related inline types in `MessageBubble.tsx` to accept the new discriminated union shape (both `PanelAction` and `ModalAction`).

**Dependencies**: Task Group 1 (to know the exact shape)

#### Task 3.1: Update NextAction type in WhatsNextActionList.tsx

- [x] **File**: `frontend/src/components/UnifiedChat/WhatsNextActionList.tsx`
- **Action**: Modify
- **Details**:
  - Replace the single `NextAction` interface with a discriminated union:
    ```typescript
    interface BaseAction {
      id: string;
      label: string;
      reason: string;
      priority: number;
    }

    export interface PanelAction extends BaseAction {
      launch: 'panel';
      target: { screen: string; tab?: string; personaId: string; taskId?: string };
    }

    export interface ModalAction extends BaseAction {
      launch: 'modal';
      modalId: string;
      target: { personaId: string };
    }

    export type NextAction = PanelAction | ModalAction;
    ```
  - The `launch` field narrows from `string` to `'panel' | 'modal'`.
  - No rendering changes needed -- the component only uses `id`, `label`, `reason` for display, all of which exist on both variants.
  - The `WhatsNextActionListProps` interface stays the same (uses `NextAction[]` and `onActionClick: (action: NextAction) => void`).

#### Task 3.2: Update onActionClick prop type and isWhatsNextActions type guard in MessageBubble.tsx

- [x] **File**: `frontend/src/components/UnifiedChat/MessageBubble.tsx`
- **Action**: Modify
- **Depends on**: Task 3.1
- **Details**:
  - The `onActionClick` prop type (line 99) currently uses an inline object type with `target: { screen: string; ... }`. Update it to use the imported `NextAction` type:
    ```typescript
    onActionClick?: (action: NextAction) => void;
    ```
    where `NextAction` is imported from `./WhatsNextActionList`.
  - Update the `isWhatsNextActions` type guard (around line 207-212):
    - The `launch` field type in the guard annotation changes from `launch: string` to `launch: 'panel' | 'modal'`.
    - The `target` field in the guard annotation uses a broader shape: `target: { personaId: string; screen?: string; tab?: string; taskId?: string }` to accept both `PanelAction` and `ModalAction` target shapes.
    - Runtime logic is unchanged: `obj.type === 'whats-next-actions' && Array.isArray(obj.actions)`.
  - The import of `NextAction` from `./WhatsNextActionList` already exists (line 77). No new import needed.

#### Task 3.3: Update onActionClick prop type in ChatThread.tsx

- [x] **File**: `frontend/src/components/UnifiedChat/ChatThread.tsx`
- **Action**: Modify
- **Depends on**: Task 3.1
- **Details**:
  - The `onActionClick` prop in `ChatThreadProps` currently uses the same inline object type. Update it to use the imported `NextAction` type:
    ```typescript
    import { NextAction } from './WhatsNextActionList';
    // ...
    onActionClick?: (action: NextAction) => void;
    ```
  - No other changes needed; the prop is already forwarded to `MessageBubble`.

**Acceptance Criteria:**
- `NextAction` is a union type across all three files.
- `launch` is typed as `'panel' | 'modal'` (not `string`).
- `ModalAction` does NOT carry `screen`, `tab`, or `taskId` fields.
- All three files compile with zero type errors.

---

### Task Group 4: UnifiedChatPanel Handler Branch

**Goal**: Add the `launch === 'modal'` branch to the existing `handleWhatsNextAction` callback in UnifiedChatPanel so that modal actions call `openGenerateStandardsModal()` from context and return early without navigation.

**Dependencies**: Task Group 2 (ModalActionContext), Task Group 3 (updated NextAction type)

#### Task 4.1: Import useModalActions in UnifiedChatPanel

- [x] **File**: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
- **Action**: Modify
- **Details**:
  - Add import at the top of the file:
    ```typescript
    import { useModalActions } from '../../contexts/ModalActionContext';
    ```
  - Inside the component function body (near the other hook calls), add:
    ```typescript
    const { openGenerateStandardsModal } = useModalActions();
    ```

#### Task 4.2: Add modal branch to handleWhatsNextAction

- [x] **File**: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
- **Action**: Modify
- **Depends on**: Task 4.1
- **Details**:
  - Update the `handleWhatsNextAction` callback (currently at line 363-396).
  - Update the action parameter type to use the imported `NextAction` union type:
    ```typescript
    import { NextAction } from './WhatsNextActionList';
    ```
  - Add a branch at the **top** of the callback, before the existing panel logic:
    ```typescript
    const handleWhatsNextAction = useCallback(
      (action: NextAction) => {
        // ---- Modal launch: open modal directly, no navigation ----
        if (action.launch === 'modal') {
          openGenerateStandardsModal();
          return;
        }

        // ---- Panel launch: existing logic unchanged ----
        const target = action.target;
        const currentScreen = threadKey.type === 'hub' ? 'dashboard'
          : (threadKey as { screen: string }).screen;

        if (target.screen === currentScreen || (target.screen === 'dashboard' && threadKey.type === 'hub')) {
          selectPersona(target.personaId);
          if (target.taskId) {
            setTimeout(() => selectTask(target.taskId!), 500);
          }
        } else {
          setPendingAction({
            screen: target.screen,
            tab: target.tab,
            personaId: target.personaId,
            taskId: target.taskId,
          });
          if (target.screen === 'product' && target.tab) {
            architectureDispatch({ type: 'SET_VIEW', payload: 'product' });
            window.history.pushState({}, '', '?tab=' + target.tab);
          } else {
            architectureDispatch({ type: 'SET_VIEW', payload: target.screen as 'product' | 'metamodel' | 'diagrams' | 'dashboard' });
          }
        }
      },
      [threadKey, selectPersona, selectTask, setPendingAction, architectureDispatch, openGenerateStandardsModal]
    );
    ```
  - Key behaviors of the modal branch:
    - Calls `openGenerateStandardsModal()` and returns immediately.
    - No navigation (`architectureDispatch` is NOT called).
    - No persona switch (`selectPersona` is NOT called).
    - No pending action (`setPendingAction` is NOT called).
    - RHS panel state is untouched.
  - Add `openGenerateStandardsModal` to the `useCallback` dependency array.

**Acceptance Criteria:**
- Clicking a `launch: 'modal'` action card calls `openGenerateStandardsModal()` and returns.
- Clicking a `launch: 'panel'` action card follows the existing navigation logic identically.
- No type errors; action parameter uses the `NextAction` discriminated union.

---

### Task Group 5: TopBar Provider Wiring

**Goal**: Wire the `ModalActionProvider` into TopBar so that it wraps children alongside the existing `ImportActionsProvider`, passing `handleGenerateStandards` as the callback.

**Dependencies**: Task Group 2 (ModalActionContext)

#### Task 5.1: Import ModalActionProvider in TopBar

- [x] **File**: `frontend/src/components/TopBar/TopBar.tsx`
- **Action**: Modify
- **Details**:
  - Add import near the existing `ImportActionsProvider` import (line 104):
    ```typescript
    import { ModalActionProvider } from '../../contexts/ModalActionContext';
    ```

#### Task 5.2: Wrap children with ModalActionProvider

- [x] **File**: `frontend/src/components/TopBar/TopBar.tsx`
- **Action**: Modify
- **Depends on**: Task 5.1
- **Details**:
  - In the JSX section where `ImportActionsProvider` wraps `{children}` (lines 1081-1089), nest `ModalActionProvider` inside `ImportActionsProvider`:
    ```tsx
    {children && (
      <ImportActionsProvider
        triggerImportJson={handleImportJsonClick}
        triggerImportXlsx={handleImportXlsxClick}
      >
        <ModalActionProvider
          openGenerateStandardsModal={handleGenerateStandards}
        >
          {children}
        </ModalActionProvider>
      </ImportActionsProvider>
    )}
    ```
  - Nesting order: `ImportActionsProvider` wraps `ModalActionProvider` wraps `{children}`. Order is immaterial since the two contexts are independent, but placing `ModalActionProvider` inside keeps it closer to its consumers.
  - `handleGenerateStandards` already exists (line 476-478) and sets `isGenerateStandardsModalOpen = true`.
  - No changes to `GenerateProjectStandardsModal` rendering (line 1134-1138) -- it is already rendered with `isOpen={isGenerateStandardsModalOpen}`.
  - The `generateStandardsDisabled` guard (line 237) is NOT checked here. The modal action opens the modal and the modal's own UX handles the disabled state. This is acceptable per spec section 4.2.5.

**Acceptance Criteria:**
- `ModalActionProvider` wraps TopBar's children.
- `handleGenerateStandards` is passed as the `openGenerateStandardsModal` prop.
- Existing `ImportActionsProvider` wrapping is undisturbed.
- No changes to App.tsx provider tree (provider lives inside TopBar, same as `ImportActionsProvider`).

---

### Task Group 6: Gateway Test Updates

**Goal**: Update existing gateway evaluator tests to reflect the new `ModalAction` shape for `DEFINE_TECH_STACK_ACTION` and `REFRESH_TECH_STANDARDS_ACTION`.

**Dependencies**: Task Group 1

#### Task 6.1: Update whatsNextEvaluator tests for ModalAction shape

- [x] **File**: `gateway/src/__tests__/whatsNextEvaluator.test.ts`
- **Action**: Modify
- **Details**:
  - **Test 2** ("Mission exists, tech stack missing"): Currently asserts `techStackAction.target` has `screen: 'metamodel'`, `personaId: 'architect'`, `taskId: 'architect--define-tech-stack'`. Update to:
    - Assert `techStackAction.launch === 'modal'`.
    - Assert `techStackAction.modalId === 'generate-standards'`.
    - Assert `techStackAction.target` equals `{ personaId: 'architect' }` (no `screen`, no `taskId`).
  - **Test 7** ("All actions have launch: 'panel'"): Rename to "All actions have correct launch type". Update to:
    - For the "no mission" scenario: `define-mission` still has `launch: 'panel'`.
    - For the "bootstrap missing" scenario: `define-tech-stack` has `launch: 'modal'`; `define-roadmap` has `launch: 'panel'`.
    - For the "optimisation" scenario: `review-roadmap` and `review-architecture` have `launch: 'panel'`; `refresh-tech-standards` has `launch: 'modal'`.
  - **Test 8** ("Action catalog correctness"): Update the `techStack` assertion block:
    - Assert `techStack.launch === 'modal'` and `techStack.modalId === 'generate-standards'`.
    - Assert `techStack.target` equals `{ personaId: 'architect' }`.
  - **New Test 9**: "ModalAction shape has modalId and minimal target":
    - Trigger the optimisation branch (all bootstrap complete).
    - Find `refresh-tech-standards` action.
    - Assert it has `launch: 'modal'`, `modalId: 'generate-standards'`, `target: { personaId: 'architect' }`.
    - Assert it does NOT have `target.screen` or `target.taskId` (use `expect(action.target).not.toHaveProperty('screen')`).

#### Task 6.2: Verify gateway evaluator tests pass

- [x] **File**: `gateway/src/__tests__/whatsNextEvaluator.test.ts`
- **Action**: Run tests
- **Details**:
  - Run ONLY: `npx vitest run gateway/src/__tests__/whatsNextEvaluator.test.ts`
  - All 9 tests (8 updated + 1 new) should pass.
  - Do NOT run the full gateway test suite.

**Acceptance Criteria:**
- All 9 evaluator tests pass.
- Tests verify both `PanelAction` and `ModalAction` shapes.
- The new test explicitly asserts `ModalAction` does not carry `screen` or `taskId`.

---

### Task Group 7: Frontend Test Updates & Integration

**Goal**: Update existing frontend test fixtures to include `ModalAction` variants and add a lightweight integration test verifying the modal dispatch flow.

**Dependencies**: Task Groups 3, 4, 5

#### Task 7.1: Update whatsNextActionList test fixtures to include ModalAction variant

- [x] **File**: `frontend/src/components/UnifiedChat/__tests__/whatsNextActionList.test.tsx`
- **Action**: Modify
- **Details**:
  - Update the `mockActions` array to include at least one `ModalAction` variant alongside the existing `PanelAction` items:
    ```typescript
    {
      id: 'define-tech-stack',
      label: 'Define Tech Stack',
      reason: 'Establishing technology standards early ensures consistent architectural decisions.',
      priority: 80,
      launch: 'modal',
      modalId: 'generate-standards',
      target: { personaId: 'architect' },
    },
    ```
  - Update the type import from `NextAction` to include the new union type.
  - Existing tests (render explanation, render cards, display label/reason, call onActionClick, handle empty array) should all pass without logic changes since the component only uses `id`, `label`, `reason` for display.
  - Add one new test: "calls onActionClick with ModalAction object on modal-type card click":
    - Click the `define-tech-stack` card (now a `ModalAction`).
    - Assert `onActionClick` is called with an object containing `launch: 'modal'` and `modalId: 'generate-standards'`.

#### Task 7.2: Update whatsNextIntegration test fixtures for ModalAction

- [x] **File**: `frontend/src/components/UnifiedChat/__tests__/whatsNextIntegration.test.tsx`
- **Action**: Modify
- **Details**:
  - Update the `whatsNextMessage` test data to include a `ModalAction` variant in the `actions` array:
    - Change the `define-tech-stack` action from `launch: 'panel'` to `launch: 'modal'`, `modalId: 'generate-standards'`, `target: { personaId: 'architect' }`.
  - Update the `whatsNextWithQuestions` test data similarly if it references `define-tech-stack`.
  - Existing tests (MessageBubble renders WhatsNextActionList, excludes questions, PendingActionContext round-trip, ChatThread forwards onActionClick) should all pass with the updated fixtures.

#### Task 7.3: Add modal dispatch integration test

- [x] **File**: `frontend/src/components/UnifiedChat/__tests__/whatsNextIntegration.test.tsx`
- **Action**: Modify
- **Depends on**: Tasks 7.1, 7.2
- **Details**:
  - Add a new test: "clicking a modal-type action card calls openGenerateStandardsModal from context":
    - Render `MessageBubble` wrapped in a `ModalActionProvider` with a mock `openGenerateStandardsModal` callback.
    - Provide a message containing a `ModalAction` variant (e.g., `define-tech-stack` with `launch: 'modal'`).
    - Provide an `onActionClick` handler that checks `action.launch === 'modal'` and calls the mock.
    - Click the action card.
    - Assert the mock `openGenerateStandardsModal` was called.
  - Add a second test: "clicking a panel-type action card does NOT call openGenerateStandardsModal":
    - Same setup but click a `PanelAction` card (e.g., `define-mission`).
    - Assert `openGenerateStandardsModal` was NOT called.

#### Task 7.4: Verify all frontend tests pass

- [x] **File**: All frontend test files for this feature
- **Action**: Run tests
- **Details**:
  - Run:
    ```
    npx vitest run frontend/src/components/UnifiedChat/__tests__/whatsNextActionList.test.tsx frontend/src/components/UnifiedChat/__tests__/whatsNextIntegration.test.tsx
    ```
  - All tests should pass (original + updated + new).
  - Do NOT run the full frontend test suite.

**Acceptance Criteria:**
- All frontend whatsNext tests pass with ModalAction fixtures.
- Integration tests verify the modal dispatch flow end-to-end.
- Panel action behavior is verified as unchanged alongside modal tests.

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1**: Gateway Discriminated Union Types (type foundation)
2. **Task Group 2**: ModalActionContext Creation (context foundation -- can run in parallel with Group 1)
3. **Task Group 3**: Frontend Type Updates (depends on Group 1 for shape knowledge)
4. **Task Group 4**: UnifiedChatPanel Handler Branch (depends on Groups 2 and 3)
5. **Task Group 5**: TopBar Provider Wiring (depends on Group 2; can run in parallel with Group 4)
6. **Task Group 6**: Gateway Test Updates (depends on Group 1)
7. **Task Group 7**: Frontend Test Updates & Integration (depends on Groups 3, 4, 5)

**Notes:**
- Task Groups 1 and 2 are independent and can be developed in parallel.
- Task Groups 4 and 5 are independent of each other (both depend on Group 2) and can be developed in parallel.
- Task Group 6 (gateway tests) can run in parallel with Groups 3-5 since it only depends on Group 1.
- Task Group 7 must be last since it validates the full wiring across all layers.
