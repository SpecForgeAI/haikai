# Specification: Unify Hub and RHS Panel Capabilities + Default-Open Hub

## Goal

Make the Dashboard Hub and all RHS screen panels use a single, consistent UnifiedChatPanel with per-screen persistence, enable artifact-generating tasks on panel screens restricted only by `allowedPersonaIds`, and add server-side persona enforcement to prevent bypass.

## User Stories

- As a user on the Dashboard, I want the chat panel to be open by default so that I can immediately interact with personas without needing to click to expand.
- As a user on the MetaModel screen, I want to run artifact-generating tasks (Define Architecture, Define Tech Stack, Test Strategy) directly from the RHS panel so that I do not need to switch to the Dashboard Hub.
- As a developer, I want persona restrictions enforced server-side so that a client cannot bypass the frontend `allowedPersonaIds` constraint.

## Specific Requirements

**FR1 - Default-Open Panel on Dashboard**
- Add `defaultOpen?: boolean` prop to `UnifiedChatPanelProps` in `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` (line 92).
- When `defaultOpen` is `true` and no persisted collapse state exists in localStorage, initialize `isCollapsed` to `false` (expanded). When `defaultOpen` is absent or `false` and no persisted state exists, initialize `isCollapsed` to `true` (collapsed).
- DashboardView (line 523) passes `defaultOpen={true}` to the `<UnifiedChatPanel>` element.
- No other screen passes `defaultOpen`; they rely on the persisted state or default-collapsed.

**FR2 - Per-ThreadKey Collapse/Expand Persistence**
- On collapse/expand toggle, persist the boolean value to localStorage keyed by `unified-chat-collapsed:${threadKeyToString(threadKey)}`.
- On mount, read the persisted value from localStorage for the current threadKey. If a value exists, use it. If no value exists, fall back to the inverse of the `defaultOpen` prop (or `true`/collapsed if `defaultOpen` is not provided).
- Import `threadKeyToString` from `../../api/chatV2Api` in `UnifiedChatPanel.tsx`.
- Each screen gets its own independent collapse state because each screen uses a different threadKey (e.g., `project:{id}:hub` vs `project:{id}:panel:metamodel`).

**FR3 - Per-ThreadKey Width Persistence**
- Replace the current shared `STORAGE_KEY = 'unified-chat-panel-width'` (line 62) with a per-threadKey key: `unified-chat-width:${threadKeyToString(threadKey)}`.
- Update `getInitialWidth()` to accept the threadKey-based storage key as a parameter.
- Update the width-persistence `useEffect` (line 197) to write to the per-threadKey key.
- Width naturally becomes per-screen by virtue of the threadKey-based key. No new width scheme is needed.

**FR4 - Enable Artifact Flows on Panel Screens**
- Update `availableFrom` in three task JSON config files under `gateway/src/config/tasks/`:
  - `architect--define-architecture.json` (line 51): change `["hub"]` to `["hub", "panel"]`.
  - `architect--define-tech-stack.json` (line 50): change `["hub"]` to `["hub", "panel"]`.
  - `test-engineer--test-strategy.json` (line 49): change `["hub"]` to `["hub", "panel"]`.
- Do NOT change `product-manager--define-product.json` (stays `["hub"]` only).
- Do NOT change `product-manager--roadmap.json` (already `["hub", "panel"]`).
- The MetaModel-only restriction is emergent: only MetaModel's `allowedPersonaIds` includes `architect` and `test-engineer`, so these tasks only appear in the MetaModel panel's task menu.

**FR5 - Screen-Specific `onArtifactSaved` Callbacks**
- ProductPage (`frontend/src/components/ProductView/ProductPage.tsx`, line 153): pass `onArtifactSaved={fetchData}` where `fetchData` is the existing `getDashboardSummary` callback (line 50).
- ProductRoadmapPage (`frontend/src/components/ProductView/ProductRoadmapPage.tsx`, line 501): pass `onArtifactSaved` on the `chatPanelOverlay` variable. The callback should call `getDashboardSummary` to re-fetch dashboard data. Add a `fetchDashboardData` callback similar to ProductPage's `fetchData`.
- MetaModelView (`frontend/src/components/MetaModelView/MetaModelView.tsx`, line 168): pass `onArtifactSaved` that dispatches a `LOAD_MODEL` action or re-fetches the architecture model. The exact mechanism should use the existing `useArchitectureDispatch` pattern to reload model data.
- DashboardView: keep existing `onArtifactSaved={fetchData}` (line 526, unchanged).

**FR6 - Screen-Specific `artifactExists` Records**
- ProductPage: pass `artifactExists` derived from its existing `data` state (DashboardSummaryDto), using the same pattern as DashboardView (mission, roadmap, architecture, techStack, testStrategy flags).
- ProductRoadmapPage: pass `artifactExists` derived from dashboard summary data. Add a `getDashboardSummary` fetch and `data` state mirroring the ProductPage pattern.
- MetaModelView: omit `artifactExists` for now (no warning on artifact re-run).
- DashboardView: keep existing `artifactExists` record (lines 527-533, unchanged).

**FR7 - Server-Side `allowedPersonaIds` Validation**
- Add `allowedPersonaIds?: string[]` to the `ChatV2Request` interface in `gateway/src/types/chatV2.ts` (line 264).
- Update the `isChatV2Request` type guard (line 309) to accept the optional field: if present, validate it is an array of strings.
- Add validation logic to all three POST endpoint handlers in `gateway/src/routes/chatV2.ts`:
  - `POST /` (line 1629): after the `isChatV2Request` guard passes, check `request.allowedPersonaIds`.
  - `POST /generate` (line 716): after validating `personaId`, check `req.body.allowedPersonaIds`.
  - `POST /save-artifact` (line 1311): after validating `taskId`, extract `personaId` from the task registry lookup and check `req.body.allowedPersonaIds`.
- Validation pseudocode: if `allowedPersonaIds` is a non-empty array and `personaId` is not in it, return HTTP 400 with body `{ error: "Persona '${personaId}' is not allowed in this context. Allowed: ${allowedPersonaIds.join(', ')}" }`.
- If `allowedPersonaIds` is missing, undefined, or an empty array, skip validation (all personas allowed).

**FR8 - Frontend Sends `allowedPersonaIds` in API Calls**
- Update `postChatV2` in `frontend/src/api/chatV2Api.ts` (line 217): extend the `ChatV2Request` interface (line 125) to include `allowedPersonaIds?: string[]` and pass it through in `JSON.stringify(request)`.
- Update `postGenerateArtifact` (line 285): add an `allowedPersonaIds?: string[]` parameter and include it in the request body.
- Update `postSaveArtifact` (line 316): add an `allowedPersonaIds?: string[]` parameter and include it in the request body.
- The `useChatThread` hook must thread the `allowedPersonaIds` from its options through to all three API calls. Store `options.allowedPersonaIds` in a ref and include it in each API request body.
- Per-screen values: Product sends `['product-manager']`, Roadmap sends `['product-manager']`, MetaModel sends `['architect', 'ux-designer', 'test-engineer']`, Dashboard hub omits the field.

**FR9 - Navigation Mid-Generation**
- No navigation blocking or special UX is required.
- When a user navigates away during generation and returns, the thread history reload on mount restores the conversation state.

## Visual Design

No visual assets provided.

## Existing Code to Leverage

**UnifiedChatPanel component (`frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`)**
- Already fully generic with no conditional logic based on threadKey type. All hub vs panel differentiation is via props from parent screens.
- Current width persistence uses a shared `STORAGE_KEY` (line 62) and `getInitialWidth()` helper (line 73). These need to be parameterized by threadKey string but the overall pattern stays the same.
- Collapsed state is `useState(false)` (line 140) with no persistence. The new localStorage persistence follows the same pattern as width persistence.

**useChatThread hook (`frontend/src/hooks/useChatThread.ts`)**
- Already completely agnostic to hub vs panel. `TASK_ARTIFACT_MAP` (line 71), `generateArtifact`, `confirmArtifact`, and `selectTask` all work regardless of threadKey type.
- `onArtifactSaved` callback fires via `onArtifactSavedRef` (line 449). No changes needed to the hook's artifact flow logic itself.
- The hook receives `allowedPersonaIds` via options (line 129) but currently does not forward it to API calls. This is the only change needed in the hook.

**DashboardView hub wiring (`frontend/src/components/DashboardView/DashboardView.tsx`, lines 522-535)**
- Demonstrates the complete pattern for wiring `onArtifactSaved` and `artifactExists` props. Product and Roadmap screens should replicate this pattern.
- The `artifactExists` record structure (mission, roadmap, architecture, techStack, testStrategy) is derived from `DashboardSummaryDto` and should be reused identically.

**Backend task menu filtering (`gateway/src/routes/chatV2.ts`, lines 1674-1711)**
- The `entryPointMap` and `availableFrom.includes(entryPoint)` filter require no structural changes. Only the task JSON files need their `availableFrom` arrays updated to include `"panel"`.

**Backend type guard (`gateway/src/types/chatV2.ts`, lines 309-356)**
- The `isChatV2Request` function validates structure only. Adding `allowedPersonaIds` validation (optional array of strings) follows the same pattern as the existing `files` optional-array validation (lines 340-353).

## Out of Scope

- Assistant persona in panels (stays hub-only via `allowedPersonaIds` restrictions on each screen).
- New per-screen width schemes beyond using per-threadKey localStorage key.
- Navigation blocking or in-progress-generation UX when user switches screens.
- `product-manager--define-product` task on panel screens (stays `["hub"]` only).
- Changes to the Implement screen or its embedded chat.
- Changes to summarisation logic or thread summariser.
- New endpoints or new artifact gating abstractions beyond `allowedPersonaIds`.
- Refactoring existing MCP tool contracts (`save_product_artifacts`, `save_architecture_baseline`, `save_markdown_artifact`, etc.).
- Any `availableFrom` format changes such as `"panel:metamodel"` screen-qualified entries.
- Changes to Feature thread keys or embedded chat behavior.
