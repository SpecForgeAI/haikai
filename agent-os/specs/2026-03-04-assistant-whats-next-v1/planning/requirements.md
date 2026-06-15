# Spec Requirements: Assistant "What's Next" v1

## Initial Description

Enable @assistant "what's next" to produce a deterministic, grounded set of up to 5 recommended next actions (with reasons) based on current project signals and dashboard scope. Render actions as clickable items; clicking an action navigates to the correct screen/tab, opens the RHS chat panel, switches persona, and auto-sends the task label to begin that workflow. This is advisory (Level 1): nothing runs automatically without a click.

## Requirements Discussion

### First Round Questions

**Q1:** Should ProjectSignals call the real data sources directly (filesystem + architecture-model-service) or reuse the existing mock dashboard summary service? And should it share any helpers with the dashboard endpoint?
**Answer:** ProjectSignals should call real sources directly (filesystem + architecture-model-service) and not reuse the mock dashboard summary service; share only low-level helpers if convenient.

**Q2:** For filesystem-based signals (missionExists, techStandardsExists, testStrategyExists), should the gateway do a lightweight existence check (fs.access/fs.stat) rather than reading the full file contents?
**Answer:** Yes, ProjectSignals should do lightweight existence/mtime checks (fs.access/fs.stat) and not read full file contents.

**Q3:** How should `architectureBaselineExists` be determined -- is it enough to check that fetchMetaModelSummary returns a non-null result, or does a minimum count of entities need to be present?
**Answer:** Set architectureBaselineExists true when fetchMetaModelSummary returns non-zero meaningful counts (services/interfaces/entities > 0); no more specific check required for v1.

**Q4:** Should the v1 evaluator consume story-level signals (storyCount, storiesWithAC, storiesInProgress, etc.) or can those default to 0 since they require story fetching?
**Answer:** Default story-level signals to 0 in v1 (do not add story fetching in this increment).

**Q5:** Should "what's next" behaviour differ based on dashboard scope (ENTIRE_PRODUCT vs NEXT_5_EPICS vs QTR vs CUSTOM)? Or is it scope-independent for v1?
**Answer:** For v1, bootstrapping "what's next" is scope-independent; still forward scope for messaging context if easy, but do not gate logic on it yet.

**Q6:** What is the exact action contract shape to return to the frontend?
**Answer:** Use: `{ id, label, reason, priority, target: { screen, tab?, personaId, taskId? }, launch: "panel" }` (keep it minimal but explicit for routing).

**Q7:** Should the evaluator show ALL missing bootstrap items or cap at a certain number?
**Answer:** Show all missing bootstrap items up to 5, ordered by priority (mission alone if missing; otherwise include tech standards/roadmap/architecture/test strategy as applicable).

**Q8:** What should the optimisation actions be for a fully bootstrapped project?
**Answer:** Optimisation examples for v1: "Refine Backlog", "Review/Update Roadmap", "Review/Update Architecture Baseline", "Refresh Tech Standards", "Review Delivery Status" (last one may be omitted if delivery signals unavailable).

**Q9:** Should "what's next" use the LLM at all, or be fully deterministic?
**Answer:** Yes, short-circuit the LLM entirely for assistant--whats-next and return a computed structured response (deterministic).

**Q10:** Should the short-circuit be implemented as a new endpoint or within the existing POST /api/chat/v2 flow?
**Answer:** Implement via task-specific short-circuit within existing POST /api/chat/v2 flow (no new endpoint).

**Q11:** Should the structured response use a new type discriminator for the frontend renderer?
**Answer:** Yes, add structuredResponse.type = "whats-next-actions" with a dedicated renderer component.

**Q12:** How should the action cards be rendered -- simple list, cards, priority badges?
**Answer:** Render as task-menu-like clickable cards with a 1-2 line "reason" beneath the label (no extra priority UI beyond ordering).

**Q13:** How should the "pending action" handoff work when navigating to a target screen -- React context, URL params, or localStorage?
**Answer:** Use a shared "pending action" handoff across navigation via React context (preferred) or URL params; context is cleaner for non-URL state and avoids localStorage hacks.

**Q14:** Should every target screen be expected to have a UnifiedChatPanel, or should we limit actions to screens that already have one?
**Answer:** Assume yes only for screens already migrated to UnifiedChatPanel; if any target screen lacks the panel, omit that action in v1 rather than adding new panel work here.

**Q15:** Should the dashboard scope be passed to the gateway in the ChatV2Request?
**Answer:** Do not add scope to ChatV2Request for v1; if you include it, make it optional and informational only (no server-side derivation from threadKey).

**Q16:** Should actions that target screens/flows not yet implemented (e.g., implement-picker, generate-standards-modal) be shown as disabled or omitted?
**Answer:** Do not show implement-picker or generate-standards-modal actions in v1 (omit entirely; no disabled items).

**Q17:** What is explicitly out of scope for v1?
**Answer:** Explicitly exclude caching, action history/dismissal, analytics, proactive suggestions on load, and any changes to task registry beyond whats-next wiring.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: Roadmap first-turn short-circuit - Path: `gateway/src/routes/chatV2.ts` (lines 1828-1908)
  - Exact pattern for deterministic short-circuit within POST /api/chat/v2 flow
  - Shows how to persist user+assistant ThreadMessages and return ChatV2Response without LLM

- Feature: Task-menu structured response - Path: `gateway/src/routes/chatV2.ts` (lines 1711-1749)
  - Shows how to return structured response with `type: 'task-menu'` discriminator
  - Pattern for frontend rendering delegation in MessageBubble.tsx

- Feature: Context resolvers (file existence paths) - Path: `gateway/src/services/contextResolvers.ts`
  - MissionContextResolver, TechStackContextResolver, TestStrategyContextResolver show file paths
  - All use `{basePath}/agent-os/product/{FILENAME}` with uppercase-first, lowercase-fallback
  - For "what's next" we do `fs.access` instead of `fs.readFile`

- Feature: fetchMetaModelSummary / fetchProductSummary - Path: `gateway/src/services/architectureModelClient.ts`
  - fetchMetaModelSummary returns `MetaModelSummaryDto` with `services[]`, `data_entities[]`, `interfaces[]`, `relationships[]`
  - fetchProductSummary returns `ProductSummaryDto` with hierarchical `initiatives[]` (containing nested `epics[]`)

- Feature: ImportActionsContext (React context pattern) - Path: `frontend/src/contexts/ImportActionsContext.tsx`
  - Clean, minimal context pattern with Provider + useHook
  - Good model for PendingActionContext

- Feature: DashboardView navigation helper - Path: `frontend/src/components/DashboardView/DashboardView.tsx` (lines 47-63)
  - `navigateTo(dispatch, view, tab?)` function using `dispatch({ type: 'SET_VIEW' })` + `pushState`

- Feature: MessageBubble structured response delegation - Path: `frontend/src/components/UnifiedChat/MessageBubble.tsx`
  - Type guard pattern: `isTaskMenu()`, `isArtifactPreview()`, etc.
  - Conditional rendering chain in JSX with `structuredResponseArea` wrapper

- Feature: TaskMenu component - Path: `frontend/src/components/UnifiedChat/TaskMenu.tsx`
  - Clickable card UI pattern for task selection
  - `onSelectTask(taskId)` callback pattern

- Feature: UnifiedChatPanel props - Path: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` (lines 134-147)
  - Current props: threadKey, initialPersonaId, allowedPersonaIds, onArtifactSaved, artifactExists, defaultOpen

- Feature: App.tsx provider wrapping - Path: `frontend/src/App.tsx` (lines 183-195)
  - Provider nesting order: AppConfigProvider > ProjectProvider > ArchitectureProvider > AppContent
  - New PendingActionProvider would go inside ArchitectureProvider (needs dispatch access)

### Follow-up Questions

No follow-up questions needed. The codebase investigation confirmed all assumptions and revealed no gaps or ambiguities beyond what was already decided.

## Visual Assets

### Files Provided:
No visual assets provided.

## Codebase Investigation Findings

### Screens with UnifiedChatPanel (action targets are VALID)

| Screen | View | Tab | ThreadKey | Allowed Personas | Panel Props |
|--------|------|-----|-----------|-----------------|-------------|
| Dashboard | `dashboard` | n/a | `{ type: 'hub', projectId }` | All (no restriction) | defaultOpen=true, onArtifactSaved, artifactExists |
| Product Definition | `product` | `product` | `{ type: 'panel', projectId, screen: 'product' }` | `['product-manager']` | onArtifactSaved, artifactExists |
| Roadmap | `product` | `roadmap` | `{ type: 'panel', projectId, screen: 'roadmap' }` | `['product-manager']` | onArtifactSaved, artifactExists |
| Architecture (MetaModel) | `metamodel` | n/a | `{ type: 'panel', projectId, screen: 'metamodel' }` | `['architect', 'ux-designer', 'test-engineer']` | onArtifactSaved (no artifactExists) |

### Screens WITHOUT UnifiedChatPanel (action targets EXCLUDED in v1)

| Screen | View | Tab | Notes |
|--------|------|-----|-------|
| Diagrams | `diagrams` | n/a | No UnifiedChatPanel |
| Backlog | `product` | `backlog` | No UnifiedChatPanel (ProductBacklogPage) |
| Implement | `product` | `implement` | No UnifiedChatPanel (ProductImplementPage) |

### File Paths for Existence Checks

All relative to `getConfig().conversationPersistBasePath`:
- Mission: `agent-os/product/MISSION.MD` (uppercase-first, lowercase-fallback `mission.md`)
- Tech Stack: `agent-os/product/TECH-STACK.MD` (uppercase-first, lowercase-fallback `tech-stack.md`)
- Test Strategy: `agent-os/product/TEST-STRATEGY.MD` (uppercase-first, lowercase-fallback `test-strategy.md`)

### MetaModelSummaryDto Shape

```typescript
interface MetaModelSummaryDto {
  services: MetaModelEntitySummary[];
  data_entities: MetaModelEntitySummary[];
  interfaces: MetaModelEntitySummary[];
  relationships: MetaModelRelationshipSummary[];
}
```

architectureBaselineExists = `(services.length + data_entities.length + interfaces.length) > 0`

### ProductSummaryDto Shape

```typescript
interface ProductSummaryDto {
  initiatives: InitiativeSummary[];  // each has nested epics[]
}
```

roadmapExists = `initiatives.length > 0` (with at least one real initiative, not just orphan-epic wrapper)

### assistant--whats-next Task Definition

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

### View Navigation Pattern

```typescript
// DashboardView navigateTo helper
function navigateTo(dispatch, view: string, tab?: string) {
  if (view === 'product' && tab) {
    dispatch({ type: 'SET_VIEW', payload: 'product' });
    window.history.pushState({}, '', '?tab=' + tab);
  } else if (view === 'metamodel') {
    dispatch({ type: 'SET_VIEW', payload: 'metamodel' });
  }
}
```

Valid view values: `'dashboard'`, `'product'`, `'metamodel'`, `'diagrams'`
Valid product tabs: `'product'`, `'roadmap'`, `'backlog'`, `'implement'`

## Requirements Summary

### Functional Requirements

**Gateway - ProjectSignals Module:**
- New module that computes a snapshot of project state signals on-demand
- Signals: missionExists, techStandardsExists, testStrategyExists (filesystem via fs.access), roadmapExists (fetchProductSummary), architectureBaselineExists (fetchMetaModelSummary)
- Story-level signals default to 0 for v1
- All signal sources degrade gracefully (return false/0 on error)
- Uses lightweight fs.access/fs.stat for file checks, NOT full file reads

**Gateway - DeterministicNextActionsEvaluator Module:**
- Hard rule: if !missionExists, return ONLY "Define Product Mission" action
- Bootstrapping priority order: Mission > Tech Standards > Roadmap > Architecture Baseline > Test Strategy
- Show all missing bootstrap items up to 5, ordered by priority
- Once all bootstrap artifacts exist, propose optimisation actions (up to 5 total)
- Optimisation actions: "Refine Backlog", "Review/Update Roadmap", "Review/Update Architecture Baseline", "Refresh Tech Standards", "Review Delivery Status" (last one omitted if delivery signals unavailable)
- Each action has: `{ id, label, reason, priority, target: { screen, tab?, personaId, taskId? }, launch: "panel" }`
- Actions targeting screens WITHOUT UnifiedChatPanel are omitted (Backlog, Implement, Diagrams)

**Gateway - chatV2.ts Short-Circuit:**
- When taskId === 'assistant--whats-next', short-circuit the LLM entirely
- Compute ProjectSignals + NextActions deterministically
- Persist user + assistant ThreadMessages (following roadmap short-circuit pattern)
- Return ChatV2Response with structuredResponse.type = 'whats-next-actions'
- Scope is NOT gated on v1 but may be forwarded optionally

**Frontend - WhatsNextActions Renderer:**
- New component that renders action cards in MessageBubble
- Type guard: `isWhatsNextActions(structuredResponse)` checks `type === 'whats-next-actions'`
- Cards styled similarly to TaskMenu (clickable, card-like, with label + 1-2 line reason)
- No priority badge UI; ordering alone communicates priority

**Frontend - PendingActionContext:**
- New React context following ImportActionsContext pattern
- Holds a "pending action" object: `{ screen, tab?, personaId, taskId? }` or null
- Provider wraps at App level (inside ArchitectureProvider)
- DashboardView (or any source) sets the pending action, then navigates via SET_VIEW + pushState
- Target screen's UnifiedChatPanel consumes the pending action on mount:
  - Switches persona to action.personaId
  - Selects task action.taskId (or sends the task label)
  - Clears the pending action after consumption

**Frontend - Action Click Handler:**
- Clicking an action card in WhatsNextActions:
  1. Sets pending action in PendingActionContext
  2. Dispatches SET_VIEW to navigate to action.target.screen
  3. Pushes URL state with tab if applicable
- Target screen's UnifiedChatPanel picks up the pending action and auto-initiates

### Reusability Opportunities

- **Roadmap short-circuit pattern** (chatV2.ts lines 1828-1908): Direct template for the whats-next short-circuit
- **Task-menu structured response** (chatV2.ts lines 1711-1749): Pattern for returning structured responses
- **MessageBubble type-guard chain**: Add new `isWhatsNextActions` guard to existing chain
- **TaskMenu component styling**: Reuse or extend for WhatsNextActions card layout
- **ImportActionsContext**: Template for PendingActionContext implementation
- **DashboardView navigateTo()**: Reuse navigation helper for action click handling
- **Context resolvers file-path pattern**: Reuse uppercase/lowercase fallback for existence checks

### Scope Boundaries

**In Scope:**
- ProjectSignals snapshot builder (gateway service module)
- DeterministicNextActionsEvaluator (gateway service module)
- Short-circuit in POST /api/chat/v2 for assistant--whats-next task
- structuredResponse.type = 'whats-next-actions' response contract
- WhatsNextActions renderer component (frontend)
- PendingActionContext for cross-screen action handoff (frontend)
- Action click handler: navigate + set persona + auto-send task
- Wiring into existing assistant--whats-next task definition

**Out of Scope:**
- Caching of signals or actions
- Action history or dismissal tracking
- Analytics or telemetry
- Proactive suggestions on page load (user must trigger explicitly)
- Changes to task registry beyond whats-next wiring
- Implement-picker flow actions
- Generate-standards-modal actions
- Disabled action items (omit instead)
- Adding UnifiedChatPanel to screens that lack it (Backlog, Implement, Diagrams)
- Story-level signal fetching
- Scope-gated logic (scope forwarded informally only)
- New API endpoints (uses existing POST /api/chat/v2)
- LLM involvement (fully deterministic)
- Streaming, summarisation, completion chips, or diff/merge

### Technical Considerations

- **Short-circuit insertion point:** After task validation (Step 5 area) and before LLM call, following the roadmap first-turn pattern at line 1828
- **File existence checks** use the same base path as context resolvers: `getConfig().conversationPersistBasePath` + `agent-os/product/{FILENAME}`
- **Architecture baseline check** calls fetchMetaModelSummary (HTTP to architecture-model-service) and checks `services.length + data_entities.length + interfaces.length > 0`
- **Roadmap existence check** calls fetchProductSummary (HTTP to architecture-model-service) and checks `hasExistingRoadmap()` from roadmapSummaryBuilder
- **Action targets filtered** to only screens with UnifiedChatPanel: dashboard, product (product tab), product (roadmap tab), metamodel
- **PendingActionContext** must be consumed once and cleared to prevent re-triggering on re-renders
- **Navigation** uses `dispatch({ type: 'SET_VIEW', payload })` + `window.history.pushState` for tab routing
- **UnifiedChatPanel** currently exposes `selectTask` and `selectPersona` via useChatThread hook; PendingAction consumption will need to call these programmatically
- **Provider order** in App.tsx: AppConfigProvider > ProjectProvider > ArchitectureProvider > (new PendingActionProvider) > AppContent
- **Thread message persistence** follows the pattern: create user ThreadMessage + assistant ThreadMessage with structuredResponse, append both, return response
