# What's Next v1-B: Modal Launch Actions

## 1. Overview

Extend the "What's Next" action system to support modal launch types alongside the existing panel launches. Two actions -- "Define Tech Standards" and "Refresh Tech Standards" -- change from opening a RHS panel workflow to opening the existing Generate Standards modal directly. This is achieved through a discriminated union type (`PanelAction | ModalAction`), a new `ModalActionContext` for cross-component communication, and a branch in the existing `handleWhatsNextAction` handler. No new endpoints, no new modals, and no changes to existing panel actions.

## 2. Background & Context

### What Exists Today (v1)

The "What's Next" v1 system (spec `2026-03-04-assistant-whats-next-v1`) is fully implemented:

- **Gateway**: `whatsNextEvaluator.ts` defines a single `NextAction` interface with `launch: 'panel'` on every action. Eight action constants exist: five bootstrap actions (define-mission, define-tech-stack, define-roadmap, define-architecture, define-test-strategy) and three optimisation actions (review-roadmap, review-architecture, refresh-tech-standards).
- **Frontend**: `WhatsNextActionList.tsx` renders clickable action cards. `MessageBubble.tsx` detects `type: 'whats-next-actions'` structured responses and delegates rendering. `UnifiedChatPanel.tsx` has a `handleWhatsNextAction` callback that either switches persona/task on the current screen or sets a `PendingAction` in context and navigates to the target screen.
- **All actions currently launch the RHS panel** with a persona switch and task auto-selection. There is no mechanism to launch a modal.

### The Gap

"Define Tech Standards" and "Refresh Tech Standards" should open the Generate Standards modal (the same modal triggered via the Product menu's "Generate Standards" item), not start a panel conversation. The existing `NextAction` type does not support this -- it always requires `target.screen`, `target.taskId`, and `launch: 'panel'`. Additionally, there is no cross-component channel for UnifiedChatPanel to tell TopBar to open a modal.

### What Already Works

- `GenerateProjectStandardsModal` is already rendered in `TopBar.tsx` (line 1134-1138) with `isOpen={isGenerateStandardsModalOpen}`, controlled by `setGenerateStandardsModalOpen` state (line 187).
- `handleGenerateStandards` (line 476-478) simply sets that state to `true`.
- The `generateStandardsDisabled` guard (line 237) requires `state.loadedFileName && activeProject && activeProject.organisationId`.
- `ImportActionsContext` provides the exact architectural pattern for the new `ModalActionContext`.

## 3. Goals & Non-Goals

### Goals

1. Introduce a type-safe discriminated union (`PanelAction | ModalAction`) for `NextAction` on both gateway and frontend so future non-panel actions can be added without optional-field sprawl.
2. Change `DEFINE_TECH_STACK_ACTION` and `REFRESH_TECH_STANDARDS_ACTION` to `ModalAction` variants that open the Generate Standards modal.
3. Create a `ModalActionContext` (separate from `ImportActionsContext`) so that `UnifiedChatPanel` can trigger modal opens that `TopBar` controls.
4. Keep all six remaining panel actions working identically to v1 with zero behavioral changes.

### Non-Goals

- Implement work-item picker actions or implement-screen navigation.
- Change how standards are generated or saved (modal internals are untouched).
- Add new API endpoints -- this is a frontend routing and gateway type change only.
- Auto-refresh "What's Next" results after the modal completes.
- Build a separate `ActionRouter` abstraction (deferred to a future increment).
- Extract the modal handler from `UnifiedChatPanel` into a utility (deferred).
- Extend the existing `ImportActionsContext` with modal triggers (explicitly decided against to maintain single-responsibility).
- Add streaming, summarisation, completion chips, or artifact preview/save changes.

## 4. Detailed Design

### 4.1 Backend Changes

#### 4.1.1 Type Updates (`gateway/src/types/chatV2.ts`)

No changes required. The gateway types (`ChatV2Request`, `ChatV2Response`, `ThreadMessage`) use `structuredResponse: unknown | null`, which already accommodates any action shape. The discriminated union lives in `whatsNextEvaluator.ts` and is serialized as JSON in the structured response.

#### 4.1.2 Evaluator Updates (`gateway/src/services/whatsNextEvaluator.ts`)

Refactor the `NextAction` type into a discriminated union using `launch` as the discriminant field.

**New type structure:**

- `PanelActionTarget`: retains `screen`, `tab?`, `personaId`, `taskId?` (unchanged from current `NextActionTarget`).
- `PanelAction`: has `launch: 'panel'`, `target: PanelActionTarget`, plus shared fields (`id`, `label`, `reason`, `priority`).
- `ModalActionTarget`: has only `personaId` (for display/badge purposes, not routing).
- `ModalAction`: has `launch: 'modal'`, `modalId: string`, `target: ModalActionTarget`, plus shared fields.
- `NextAction = PanelAction | ModalAction` -- the union type exported for use across the codebase.
- `WhatsNextResult` stays the same shape (`explanation: string`, `actions: NextAction[]`).

**Action constant changes:**

- `DEFINE_TECH_STACK_ACTION` changes from `PanelAction` to `ModalAction`:
  - `launch: 'modal'`
  - `modalId: 'generate-standards'`
  - `target: { personaId: 'architect' }`
  - Drops `screen`, `tab`, `taskId` from target.
  - `id`, `label`, `reason`, `priority` remain unchanged.
- `REFRESH_TECH_STANDARDS_ACTION` changes to the exact same `ModalAction` shape (same `launch`, `modalId`, `target`); only `id`, `label`, and `reason` text differ.
- All other six action constants (`DEFINE_MISSION_ACTION`, `DEFINE_ROADMAP_ACTION`, `DEFINE_ARCHITECTURE_ACTION`, `DEFINE_TEST_STRATEGY_ACTION`, `REVIEW_ROADMAP_ACTION`, `REVIEW_ARCHITECTURE_ACTION`) remain as `PanelAction` unchanged.

### 4.2 Frontend Changes

#### 4.2.1 New Context: `ModalActionContext` (`frontend/src/contexts/ModalActionContext.tsx`)

A new React context following the `ImportActionsContext` pattern (same file structure: context, provider, hook). It provides a single callback for opening the Generate Standards modal.

- **Context value shape**: `{ openGenerateStandardsModal: () => void }`
- **Provider**: `ModalActionProvider` accepts `children` and an `openGenerateStandardsModal` callback prop. This matches the `ImportActionsProvider` pattern where the parent (TopBar) owns the handler and the provider merely exposes it to descendants.
- **Hook**: `useModalActions()` returns the context value. Uses a safe no-op default (like `PendingActionContext`) rather than throwing, to avoid test wrapper boilerplate.

#### 4.2.2 WhatsNextActionList Updates (`frontend/src/components/UnifiedChat/WhatsNextActionList.tsx`)

Update the local `NextAction` interface to a discriminated union matching the gateway type:

- Define `PanelAction` and `ModalAction` variants (or a single union type) with `launch: 'panel' | 'modal'`.
- The `launch` field type narrows from `string` to `'panel' | 'modal'` to catch type mistakes at compile time.
- `ModalAction` has `modalId: string` and `target: { personaId: string }` (no `screen`, `tab`, `taskId`).
- `PanelAction` retains the full `target: { screen, tab?, personaId, taskId? }`.
- The exported `NextAction` type becomes the union.
- No rendering changes needed -- the component only uses `id`, `label`, `reason` for display, all of which exist on both variants.

#### 4.2.3 UnifiedChatPanel `handleWhatsNextAction` Updates (`frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`)

Add a branch at the top of the existing `handleWhatsNextAction` callback:

1. Check `action.launch === 'modal'`.
2. If modal: call `openGenerateStandardsModal()` from `useModalActions()` context. Return early -- no navigation, no persona switch, no pending action, no panel state change.
3. If panel (else branch): execute the existing logic unchanged (same-screen persona/task switch or setPendingAction + navigate).

Import `useModalActions` from `../../contexts/ModalActionContext`.

The action parameter type on `handleWhatsNextAction` updates from the current inline type to the new `NextAction` union type imported from `WhatsNextActionList`.

#### 4.2.4 MessageBubble Updates (`frontend/src/components/UnifiedChat/MessageBubble.tsx`)

Update the `onActionClick` prop type from the current inline object type to accept the new union type. The `isWhatsNextActions` type guard's inner type annotation for the `actions` array elements should reflect the union (both `PanelAction` and `ModalAction` shapes are valid).

In practice this means the `launch` field in the type guard changes from `launch: string` to `launch: 'panel' | 'modal'`, and the `target` field allows both the full shape (with `screen`, `taskId`) and the minimal shape (with only `personaId`). Using a broader type annotation in the guard is acceptable since runtime narrowing happens in `handleWhatsNextAction`.

#### 4.2.5 TopBar Integration (`frontend/src/components/TopBar/TopBar.tsx`)

TopBar already owns `isGenerateStandardsModalOpen` state and `handleGenerateStandards` handler. Changes:

1. Import `ModalActionProvider` from `../../contexts/ModalActionContext`.
2. Wrap children with `ModalActionProvider` in addition to the existing `ImportActionsProvider`. Nesting order: `ImportActionsProvider` wraps `ModalActionProvider` wraps `{children}` (or reverse -- order is immaterial since they are independent).
3. Pass `openGenerateStandardsModal={handleGenerateStandards}` as the prop to `ModalActionProvider`.
4. The `generateStandardsDisabled` guard should be respected: if the guard is true (no loaded file, no active project, or no organisationId), `handleGenerateStandards` is still callable but the modal itself will render in a state that cannot proceed. This is acceptable for v1-B; the action card will open the modal and the modal's own UX handles the disabled state. No special disabled-state handling in the action card is required.

#### 4.2.6 App.tsx Provider Wiring

No changes needed to `App.tsx`. The `ModalActionProvider` is wired inside TopBar (same as `ImportActionsProvider`), not in the App provider tree. The existing `PendingActionProvider` remains in its current position wrapping `AppContent`.

### 4.3 Type Safety

The discriminated union approach ensures:

- **Compile-time exhaustiveness**: Switching on `action.launch` in `handleWhatsNextAction` will produce a type error if a new launch type is added without handling it (when using `never` in the default case).
- **No optional-field sprawl**: `ModalAction` does not carry `screen`, `tab`, or `taskId` fields. Attempting to access `action.target.screen` on a `ModalAction` will be a type error.
- **Narrowed frontend type**: The `launch` field is typed as `'panel' | 'modal'` (not `string`), catching typos and invalid values at compile time.

## 5. Data Flow

### Modal Action Flow (new)

1. User clicks "Define Tech Standards" or "Refresh Tech Standards" action card in `WhatsNextActionList`.
2. `WhatsNextActionList` calls `onActionClick(action)` where `action.launch === 'modal'`.
3. `handleWhatsNextAction` in `UnifiedChatPanel` receives the action.
4. Handler checks `action.launch === 'modal'` -- true.
5. Handler calls `openGenerateStandardsModal()` from `ModalActionContext`.
6. `TopBar` (the context provider) executes `handleGenerateStandards()`, setting `isGenerateStandardsModalOpen = true`.
7. `GenerateProjectStandardsModal` renders as open (same component, same props as menu-triggered flow).
8. RHS panel state is untouched -- no persona switch, no collapse/expand, no auto-message.
9. User interacts with modal normally (generates standards or cancels).
10. Modal closes via `onClose` callback. No auto-refresh of "What's Next" results.

### Panel Action Flow (unchanged from v1)

1. User clicks a panel-type action card (e.g., "Define Product Mission").
2. `WhatsNextActionList` calls `onActionClick(action)` where `action.launch === 'panel'`.
3. `handleWhatsNextAction` checks `action.launch` -- falls to panel branch.
4. If same screen: directly calls `selectPersona` + `selectTask`.
5. If different screen: calls `setPendingAction` + navigates via `architectureDispatch`.
6. Target screen's `UnifiedChatPanel` consumes the pending action on mount.

## 6. Testing Strategy

### Gateway Tests

- Update existing evaluator tests (Tests 2, 7, 8 in the whatsNextEvaluator test suite) to verify that `DEFINE_TECH_STACK_ACTION` and `REFRESH_TECH_STANDARDS_ACTION` now return `launch: 'modal'` and `modalId: 'generate-standards'` instead of `launch: 'panel'` with `screen`/`taskId`.
- Add a new test verifying the shape of the `ModalAction` variant (has `modalId`, `target.personaId` only, no `screen`/`taskId`).
- Verify all other action constants remain `PanelAction` with `launch: 'panel'`.
- Update test data fixtures for `whatsNextActionList.test.tsx` and `whatsNextIntegration.test.tsx` to include both `PanelAction` and `ModalAction` shapes.

### Frontend Tests

- Add a lightweight integration test verifying that clicking a `launch: 'modal'` action card calls `openGenerateStandardsModal` from context (not `setPendingAction` or navigation).
- Add a test verifying that clicking a `launch: 'panel'` action card still follows the existing navigation/persona-switch flow.
- Add a test verifying that `ModalActionProvider` passes the callback through and `useModalActions` returns it.
- Verify TopBar wraps children with `ModalActionProvider` (can be tested via the hook being callable in a descendant component).

## 7. Migration & Compatibility

This change is **backwards-compatible** in behavior but is a **breaking type contract change** between gateway and frontend:

- The gateway `evaluateNextActions` function now returns `NextAction[]` where `NextAction = PanelAction | ModalAction`. Previously all items were `PanelAction`-shaped.
- The frontend `WhatsNextActionList` local `NextAction` type must be updated in sync to accept both shapes.
- The JSON wire format is additive: `ModalAction` objects include `modalId` (new field) and have a narrower `target` (fewer fields). Existing frontends that only read `id`, `label`, `reason`, `priority` will not break. However, code that unconditionally reads `action.target.screen` will fail on `ModalAction` objects.
- Both gateway and frontend changes must be deployed together to avoid runtime errors from mismatched assumptions about the `target` shape.
- No database migration needed -- the structured response is stored as opaque JSON in thread messages and the shape change is transparent to the persistence layer.

## 8. Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `gateway/src/services/whatsNextEvaluator.ts` | Modify | Refactor `NextAction` into `PanelAction \| ModalAction` union; update `DEFINE_TECH_STACK_ACTION` and `REFRESH_TECH_STANDARDS_ACTION` to `ModalAction` shape |
| `frontend/src/contexts/ModalActionContext.tsx` | Create | New context with `ModalActionProvider` and `useModalActions` hook (follows `ImportActionsContext` pattern, uses safe no-op default) |
| `frontend/src/components/TopBar/TopBar.tsx` | Modify | Import `ModalActionProvider`; wrap children with it alongside `ImportActionsProvider`; pass `handleGenerateStandards` as callback |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | Modify | Import `useModalActions`; add `launch === 'modal'` branch in `handleWhatsNextAction` that calls `openGenerateStandardsModal()` |
| `frontend/src/components/UnifiedChat/WhatsNextActionList.tsx` | Modify | Update local `NextAction` type to discriminated union with `launch: 'panel' \| 'modal'`; add `ModalAction` variant with `modalId` and minimal target |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | Modify | Update `onActionClick` prop type and `isWhatsNextActions` type guard to accept both `PanelAction` and `ModalAction` shapes |
| `gateway/src/services/__tests__/whatsNextEvaluator.test.ts` | Modify | Update Tests 2, 7, 8 assertions for new `ModalAction` shape; add `ModalAction` shape validation test |
| `frontend/src/components/UnifiedChat/__tests__/whatsNextActionList.test.tsx` | Modify | Update test fixture data to include both `PanelAction` and `ModalAction` variants |
| `frontend/src/components/UnifiedChat/__tests__/whatsNextIntegration.test.tsx` | Modify | Update test fixtures; add modal dispatch integration test |
