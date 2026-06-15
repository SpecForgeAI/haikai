# Spec Requirements: What's Next v1-B -- Modal Launch

## Initial Description

Extend the clickable "What's Next" actions to support non-panel launch types, starting with "Define Tech Standards" which must open the existing Generate Standards modal (same behavior as menu Product -> Generate Standards). Keep all existing panel launches working unchanged. No implement work-item picker in this increment.

**Key scope items:**
- Introduce a discriminated union for action types: `PanelAction | ModalAction`
- Two actions change from `launch: 'panel'` to `launch: 'modal'`: "Define Tech Standards" and "Refresh Tech Standards"
- New `ModalActionContext` enables cross-component modal triggering (TopBar owns the modal state; UnifiedChatPanel consumes the context)
- No navigation required; modal opens directly from any screen via TopBar
- RHS panel remains untouched when launching the modal
- No auto-refresh of "What's Next" after modal completes

## Requirements Discussion

### First Round Questions

**Q1:** For the NextAction type on the gateway, should we use a discriminated union (PanelAction | ModalAction) with a launch field as discriminant, or a single interface with optional modal-specific fields?
**Answer:** Use a discriminated union (PanelAction | ModalAction) to keep types safe and avoid optional-field sprawl.

**Q2:** What exact shape should the "Define Tech Standards" action constant have? Should it replace DEFINE_TECH_STACK_ACTION entirely, or should we keep the existing panel fields alongside the new modal fields?
**Answer:** Replace DEFINE_TECH_STACK_ACTION entirely for this flow: make it launch:'modal' with modalId:'generate-standards'; keep personaId for display but drop screen/taskId unless the UI needs them for routing.

**Q3:** Should "Refresh Tech Standards" (the optimisation-phase action) also launch the modal, or remain as launch:'panel'?
**Answer:** Yes, "Refresh Tech Standards" should also be launch:'modal' (it's the same user operation: open the Generate Standards modal again).

**Q4:** For the frontend action execution, should we create a separate ActionRouter abstraction, or is it acceptable to add a simple branch in the existing handleWhatsNextAction callback?
**Answer:** It's acceptable to branch in the existing handleWhatsNextAction callback (no need for a separate router abstraction yet).

**Q5:** Where should the modal launch branch live -- in UnifiedChatPanel.tsx alongside the existing handler, or extracted to a utility?
**Answer:** Keep it inside UnifiedChatPanel.tsx for now (simplest); extract later if it grows.

**Q6:** For cross-component communication (UnifiedChatPanel needs to tell TopBar to open the modal), which approach: (A) introduce a ModalActionContext that TopBar subscribes to, (B) use a custom event on window, or (C) lift state to a shared ancestor?
**Answer:** Option A: introduce a small ModalActionContext that TopBar subscribes to in order to open the modal.

**Q7:** Should clicking "Define Tech Standards" navigate to the Product screen first then open the modal, or open the modal directly from any screen?
**Answer:** No navigation is required; open the modal directly from any screen via TopBar.

**Q8:** When the modal action is triggered, should the RHS panel switch to the architect persona or send any auto-message?
**Answer:** Yes, leave RHS panel untouched when launching the modal (no persona switch/task message required).

**Q9:** After the modal completes (standards generated), should we auto-refresh the "What's Next" results, or leave that as a manual re-trigger?
**Answer:** Manual re-trigger; do not auto-refresh "What's Next" after modal completes in this increment.

**Q10:** For the frontend `launch` field type, should we narrow it to `'panel' | 'modal'` or leave it as a generic string for extensibility?
**Answer:** Narrow frontend typing to 'panel' | 'modal' to catch mistakes early (don't leave it as arbitrary string).

**Q11:** Which actions change to launch:'modal' in this increment?
**Answer:** Only "Define Tech Standards" and "Refresh Tech Standards" change to launch:'modal' in this increment; nothing else.

**Q12:** What testing expectations do you have for this feature?
**Answer:** Add a small unit/integration test that clicking the action dispatches the modal open event and that TopBar receives it (lightweight, not exhaustive).

### Existing Code to Reference

**Similar Features Identified:**
- Feature: ImportActionsContext - Path: `frontend/src/contexts/ImportActionsContext.tsx`
  - Exact pattern for the new ModalActionContext: createContext, Provider with callback props, consumer hook
  - TopBar already wraps its children with ImportActionsProvider (TopBar.tsx lines 1082-1089)
- Feature: PendingActionContext - Path: `frontend/src/contexts/PendingActionContext.tsx`
  - Cross-screen action handoff pattern (set/clear); different from ModalActionContext but instructive
  - Uses safe no-op default instead of throwing on missing provider
- Feature: GenerateProjectStandardsModal - Path: `frontend/src/components/Project/GenerateProjectStandardsModal.tsx`
  - The modal to be opened; props: `isOpen`, `onClose`, `activeProject`
  - Already rendered in TopBar.tsx at lines 1133-1138
- Feature: TopBar modal state pattern - Path: `frontend/src/components/TopBar/TopBar.tsx`
  - `isGenerateStandardsModalOpen` state (line 187), `handleGenerateStandards` handler (lines 476-478)
  - `generateStandardsDisabled` guard (line 237): requires `state.loadedFileName && activeProject && activeProject.organisationId`
- Feature: Gateway WhatsNextEvaluator - Path: `gateway/src/services/whatsNextEvaluator.ts`
  - Current NextAction interface and action constants to refactor
  - Action constants: DEFINE_TECH_STACK_ACTION (line 70), REFRESH_TECH_STANDARDS_ACTION (line 124)

### Follow-up Questions

**Follow-up 1:** The ModalAction variant in the discriminated union will drop target.screen and target.taskId (per answer #2). But REFRESH_TECH_STANDARDS_ACTION (the optimisation-phase action, answer #3) currently has target.screen: 'metamodel' and target.taskId: 'architect--define-tech-stack'. Should REFRESH_TECH_STANDARDS_ACTION use the exact same shape as the new DEFINE_TECH_STACK_ACTION (i.e., launch: 'modal', modalId: 'generate-standards', with target containing only personaId: 'architect' for display), or does it need any different fields?
**Answer:** REFRESH_TECH_STANDARDS_ACTION should use the exact same action shape as DEFINE_TECH_STACK_ACTION (launch:'modal', modalId:'generate-standards', target:{ personaId:'architect' }); only the label/reason text differs.

**Follow-up 2:** The ModalActionContext pattern (answer #6) requires TopBar to provide the openGenerateStandardsModal callback. TopBar already wraps its children with ImportActionsProvider (lines 1082-1089). Should the new ModalActionContext be a separate provider that TopBar also wraps (nested inside or alongside ImportActionsProvider), or should we extend the existing ImportActionsContext to include the modal trigger? Extending would be a smaller change but mixes concerns; a separate provider follows the existing single-responsibility pattern more cleanly.
**Answer:** Create a separate ModalActionContext provider rather than extending ImportActionsContext to keep responsibilities clean and avoid coupling unrelated modal/event triggers.

## Visual Assets

### Files Provided:
No visual assets provided. (Bash check of `agent-os/specs/2026-03-04-whats-next-v1b-modal-launch/planning/visuals/` found no image files.)

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- Introduce a discriminated union type `PanelAction | ModalAction` for NextAction on both gateway and frontend
- `PanelAction` retains all existing fields: id, label, reason, priority, target (screen, tab, personaId, taskId), launch: 'panel'
- `ModalAction` has: id, label, reason, priority, launch: 'modal', modalId: string, target with personaId (for display only)
- Change DEFINE_TECH_STACK_ACTION to ModalAction with modalId: 'generate-standards'
- Change REFRESH_TECH_STANDARDS_ACTION to ModalAction with modalId: 'generate-standards' (identical shape to DEFINE_TECH_STACK_ACTION; only label/reason text differs)
- All other 6 action constants remain as PanelAction unchanged
- Add a branch in UnifiedChatPanel.handleWhatsNextAction: if action.launch === 'modal', use ModalActionContext to open the modal
- Create a separate ModalActionContext (following ImportActionsContext pattern but as its own provider) with an openGenerateStandardsModal callback
- TopBar provides the ModalActionContext, setting isGenerateStandardsModalOpen = true when triggered
- GenerateProjectStandardsModal is already rendered in TopBar; no new modal component needed
- No navigation occurs when opening the modal; it opens from any screen
- RHS panel state is untouched (no persona switch, no auto-message)
- No auto-refresh of "What's Next" after modal completes
- Frontend launch type narrowed to 'panel' | 'modal' (not arbitrary string)

### Reusability Opportunities
- ImportActionsContext (`frontend/src/contexts/ImportActionsContext.tsx`) -- exact template for ModalActionContext (but kept as a separate provider to avoid coupling)
- TopBar already renders GenerateProjectStandardsModal -- only needs to subscribe to context
- GenerateProjectStandardsModal requires no changes (same props: isOpen, onClose, activeProject)
- PendingActionContext -- no changes needed; modal actions bypass the pending-action/navigation flow entirely

### Scope Boundaries

**In Scope:**
- Gateway: Refactor NextAction into PanelAction | ModalAction discriminated union
- Gateway: Update DEFINE_TECH_STACK_ACTION and REFRESH_TECH_STANDARDS_ACTION constants (identical shape, different label/reason)
- Gateway: Update evaluateNextActions return type and WhatsNextResult
- Frontend: Create separate ModalActionContext (context, provider, hook) in `frontend/src/contexts/`
- Frontend: TopBar wraps children with ModalActionContext provider (separate from ImportActionsProvider)
- Frontend: Update handleWhatsNextAction in UnifiedChatPanel to branch on launch type
- Frontend: Update NextAction type in WhatsNextActionList.tsx (and MessageBubble.tsx inline types) to use discriminated union with launch: 'panel' | 'modal'
- Frontend: Update isWhatsNextActions type guard to accept both launch types
- Tests: Update gateway whatsNextEvaluator tests (Test 2, 7, 8 affected)
- Tests: Add lightweight integration test for modal action dispatch and TopBar receipt
- Tests: Update frontend test data in whatsNextActionList.test.tsx and whatsNextIntegration.test.tsx

**Out of Scope:**
- Implement work-item picker actions or implement-screen navigation
- Changes to how standards are generated/saved (modal internals unchanged)
- New endpoints (no backend API changes)
- Streaming, summarisation, completion chips, artifact preview/save
- Auto-refresh of "What's Next" after modal completes
- Separate ActionRouter abstraction (deferred to future increment)
- Extracting modal handler from UnifiedChatPanel to a utility (deferred)
- Extending ImportActionsContext (explicitly decided against; separate ModalActionContext instead)

### Technical Considerations
- The gateway NextAction type change is a breaking contract change for the frontend -- both sides must update in sync
- WhatsNextActionList.tsx has its own local NextAction interface (not shared) -- must be updated to match the union
- MessageBubble.tsx uses inline type annotations for onActionClick prop -- must be updated to use the union
- TopBar already has `generateStandardsDisabled` guard requiring `loadedFileName + activeProject + organisationId` -- the modal action should respect this (if disabled, the action card click should either be a no-op or show a message)
- The ModalActionContext provider must be positioned so that both TopBar (provider) and UnifiedChatPanel (consumer) are within the tree -- same wrapping pattern as ImportActionsProvider but as a separate provider
- PendingActionContext uses a safe no-op default for tests; ModalActionContext should consider the same pattern to avoid test wrapper boilerplate
- Component tree: App -> AppConfigProvider -> ProjectProvider -> ArchitectureProvider -> PendingActionProvider -> AppContent -> TopBar -> ImportActionsProvider -> ModalActionProvider -> {children including views with UnifiedChatPanel}
- REFRESH_TECH_STANDARDS_ACTION and DEFINE_TECH_STACK_ACTION share identical structure (launch, modalId, target) -- only label and reason text differ
