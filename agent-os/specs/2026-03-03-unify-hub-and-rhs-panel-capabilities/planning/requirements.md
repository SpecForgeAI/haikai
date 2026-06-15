# Spec Requirements: Unify Hub and RHS Panel Capabilities

## Initial Description

Make the Dashboard Hub use the same RHS UnifiedChatPanel pattern (default open), and allow RHS panels on other screens to support the same artifact-generating capabilities as Hub, with restriction enforced only via allowedPersonaIds (no new artifact gating abstractions).

Key goals from the raw idea:
- Dashboard Hub appears as a right-anchored UnifiedChatPanel, default open.
- Remove any logic treating Hub as a special artifact-capable variant.
- Screen panels (Product, Roadmap, MetaModel) gain artifact preview/confirm/save when using permitted personas.
- Server-side persona enforcement: reject with 400 if persona is not allowed for the given context.
- No new endpoints, no new artifact gating abstractions, no refactor of existing MCP tool contracts.

## Requirements Discussion

### First Round Questions

**Q1:** ThreadKey type -- should the hub migrate from `{type:'hub', projectId}` to use `{type:'panel', projectId, screen:'dashboard'}`, or keep `hub` as its own type?
**Answer:** Keep `hub` as `{type:'hub', projectId}` -- do NOT migrate to panel. Instead add `"panel"` availability to whichever tasks should run in panels. The hub threadKey type stays as-is.

**Q2:** Which artifact-generating tasks should be available from panel screens?
**Answer:**
- `product-manager--define-product` stays hub-only (no panel availability).
- `product-manager--roadmap` already has `availableFrom: ["hub", "panel"]` -- keep as-is.
- `architect--define-architecture`, `architect--define-tech-stack`, `test-engineer--test-strategy` should be available from the MetaModel panel ONLY. Add `"panel"` to their `availableFrom` arrays; the MetaModel-only restriction is enforced by `allowedPersonaIds` (since only MetaModel allows architect and test-engineer personas).

**Q3:** Should the panel be default-open on any screens besides the Dashboard?
**Answer:**
- Dashboard should be default-open.
- Other screens remain as they are today (no change to their initial state).
- Collapse/expand state persists in localStorage per threadKey (hub vs each panel screen).

**Q4:** What should the `onArtifactSaved` callback do on each screen?
**Answer:**
- Each screen passes its own refresh callback.
- Product and Roadmap screens re-fetch the dashboard summary.
- MetaModel screen re-fetches the metamodel summary.
- Dashboard keeps its current refresh behavior (`fetchData`).

**Q5:** How should `artifactExists` be handled on panel screens?
**Answer:**
- Pass `artifactExists` on Product and Roadmap screens (they already have summary data available).
- MetaModel can omit `artifactExists` for now.
- The artifact-exists warning appearing only on dashboard/product/roadmap is acceptable.

**Q6:** How should the server-side persona enforcement work?
**Answer:** Pass `allowedPersonaIds` in the request body and validate server-side against it. Simple approach -- no new config formats, no server-side screen-to-persona mapping. The frontend sends its `allowedPersonaIds` array and the backend treats it as authoritative for that panel/hub context.

**Q7:** What happens if the user navigates away from a screen mid-generation?
**Answer:** Rely on thread history reload on return. No navigation blocking or extra UX in this increment.

**Q8:** What is explicitly out of scope?
**Answer:**
- Assistant persona in panels (keep hub-only for now).
- Any new per-screen width scheme beyond using a per-threadKey localStorage key (width naturally becomes per-screen by virtue of the threadKey-based key).

### Existing Code to Reference

**Similar Features Identified:**
- Feature: UnifiedChatPanel component - Path: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`
- Feature: useChatThread hook - Path: `frontend/src/hooks/useChatThread.ts`
- Feature: DashboardView hub usage - Path: `frontend/src/components/DashboardView/DashboardView.tsx` (lines 522-535)
- Feature: MetaModelView panel usage - Path: `frontend/src/components/MetaModelView/MetaModelView.tsx`
- Feature: ProductPage panel usage - Path: `frontend/src/components/ProductView/ProductPage.tsx`
- Feature: ProductRoadmapPage panel usage - Path: `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
- Feature: Backend chat endpoint - Path: `gateway/src/routes/chatV2.ts`
- Feature: Backend type definitions - Path: `gateway/src/types/chatV2.ts`
- Feature: Task JSON configs - Path: `gateway/src/config/tasks/` (all task JSON files)
- Feature: ChatV2 API client - Path: `frontend/src/api/chatV2Api.ts`

### Follow-up Questions

**Follow-up 1:** The `availableFrom` format for screen-restricted tasks -- should we extend `availableFrom` to support screen-specific entries like `["hub", "panel:metamodel"]` (option B), or simply use `["hub", "panel"]` and rely on `allowedPersonaIds` for MetaModel-only restriction (option A)?
**Answer:** Option (A) is acceptable. Keep `availableFrom` as `["hub", "panel"]` and rely on `allowedPersonaIds` (plus server-side validation) for MetaModel-only restriction. No `panel:screen` format invention.

**Follow-up 2:** Should server-side `allowedPersonaIds` validation apply to all three endpoints (`/api/chat/v2`, `/api/chat/v2/generate`, `/api/chat/v2/save-artifact`) or just the main chat endpoint?
**Answer:** Apply `allowedPersonaIds` validation on ALL THREE endpoints: `POST /api/chat/v2`, `POST /api/chat/v2/generate`, and `POST /api/chat/v2/save-artifact`. This prevents bypass via direct artifact calls.

**Follow-up 3:** When the hub omits `allowedPersonaIds` from the request body, should the backend treat missing as "no restriction" (option A) or require the full list (option B)?
**Answer:** Option (A). Hub can omit `allowedPersonaIds` and the backend treats missing/undefined as "no restriction / all personas allowed" (skip validation).

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
N/A -- no visual files were found in the `planning/visuals/` directory.

## Requirements Summary

### Functional Requirements

**FR1 - Default-Open Panel on Dashboard:**
- Add a `defaultOpen` prop to `UnifiedChatPanelProps`.
- Dashboard passes `defaultOpen={true}`.
- Other screens do not pass this prop (remain collapsed on mount).

**FR2 - Per-ThreadKey Collapse/Expand Persistence:**
- Persist collapsed/expanded state to localStorage keyed by the serialized threadKey string.
- On mount, restore the persisted state; if no persisted state exists, fall back to the `defaultOpen` prop (or collapsed if not provided).
- This naturally gives each screen its own independent collapse state.

**FR3 - Per-ThreadKey Width Persistence:**
- Change the localStorage key for panel width from the current shared `unified-chat-panel-width` to a per-threadKey key.
- Width naturally becomes per-screen by virtue of the threadKey-based key. No new width scheme needed.

**FR4 - Enable Artifact Flows on Panel Screens:**
- Update `availableFrom` in task JSON configs:
  - `architect--define-architecture`: change from `["hub"]` to `["hub", "panel"]`.
  - `architect--define-tech-stack`: change from `["hub"]` to `["hub", "panel"]`.
  - `test-engineer--test-strategy`: change from `["hub"]` to `["hub", "panel"]`.
  - `product-manager--define-product`: keep as `["hub"]` (hub-only).
  - `product-manager--roadmap`: keep as `["hub", "panel"]` (already correct).
- The MetaModel-only restriction for architect/test-engineer tasks is enforced by `allowedPersonaIds`, not by `availableFrom`.

**FR5 - Screen-Specific `onArtifactSaved` Callbacks:**
- Product screen: pass a callback that re-fetches the dashboard summary.
- Roadmap screen: pass a callback that re-fetches the dashboard summary.
- MetaModel screen: pass a callback that re-fetches the metamodel summary.
- Dashboard: keep existing `fetchData` callback.

**FR6 - Screen-Specific `artifactExists` Records:**
- Product screen: pass `artifactExists` derived from available summary data.
- Roadmap screen: pass `artifactExists` derived from available summary data.
- MetaModel screen: omit `artifactExists` for now (no warning on re-run).
- Dashboard: keep existing `artifactExists` record.

**FR7 - Server-Side `allowedPersonaIds` Validation:**
- Add optional `allowedPersonaIds?: string[]` field to `ChatV2Request` type.
- On all three endpoints (`/api/chat/v2`, `/api/chat/v2/generate`, `/api/chat/v2/save-artifact`):
  - If `allowedPersonaIds` is present and non-empty, validate that the request's `personaId` is included in the list.
  - If validation fails, reject with HTTP 400 and a descriptive error message.
  - If `allowedPersonaIds` is missing, undefined, or empty, skip validation (all personas allowed).
- Frontend sends `allowedPersonaIds` in the request body for panel screens.
- Hub omits `allowedPersonaIds` (unrestricted).

**FR8 - Frontend Sends `allowedPersonaIds` in API Calls:**
- Update the frontend chat API client to include `allowedPersonaIds` in request bodies when it is configured on the panel.
- Product screen sends `allowedPersonaIds: ['product-manager']`.
- Roadmap screen sends `allowedPersonaIds: ['product-manager']`.
- MetaModel screen sends `allowedPersonaIds: ['architect', 'ux-designer', 'test-engineer']`.
- Dashboard hub omits the field.

**FR9 - Navigation Mid-Generation:**
- No navigation blocking or special UX.
- Rely on thread history reload when the user returns to a screen.

### Reusability Opportunities

- `UnifiedChatPanel` is already fully generic -- no conditional logic based on threadKey type. All changes are in the props passed by parent screens.
- `useChatThread` hook is already agnostic to hub vs panel. No changes needed to artifact flow logic.
- Backend `/generate` and `/save-artifact` already work with any threadKey type. Only the `allowedPersonaIds` validation is new.
- The `isChatV2Request` type guard in `gateway/src/types/chatV2.ts` needs to be updated to accept the new optional `allowedPersonaIds` field.
- The existing `entryPointMap` and `availableFrom` filtering logic in `chatV2.ts` (lines 1674-1711) requires no structural changes -- only the task JSON files need their `availableFrom` arrays updated.

### Scope Boundaries

**In Scope:**
- Adding `defaultOpen` prop to UnifiedChatPanel.
- Per-threadKey localStorage persistence for collapse state and width.
- Updating `availableFrom` on three task JSON configs to include `"panel"`.
- Wiring `onArtifactSaved` and `artifactExists` props on Product, Roadmap, and MetaModel screens.
- Adding `allowedPersonaIds` to the request body type.
- Server-side validation of `allowedPersonaIds` on all three chat endpoints.
- Frontend sending `allowedPersonaIds` in API calls.

**Out of Scope:**
- Assistant persona in panels (stays hub-only).
- New per-screen width schemes beyond threadKey-based localStorage key.
- Navigation blocking or in-progress-generation UX.
- `product-manager--define-product` task on panel screens.
- Changes to the Implement screen.
- Changes to summarisation logic.
- New endpoints or artifact gating abstractions.
- Refactoring existing MCP tool contracts (`save_product_artifacts`, etc.).
- Any `availableFrom` format changes (no `panel:screen` entries).

### Technical Considerations

- **ThreadKey types remain unchanged.** Hub keeps `{type:'hub', projectId}`, panels keep `{type:'panel', projectId, screen}`.
- **`availableFrom` format stays simple string arrays.** No screen-qualified entries like `"panel:metamodel"`. Screen restriction is an emergent property of `allowedPersonaIds`.
- **Backend validation is request-body-driven.** The server does not maintain its own screen-to-persona mapping. The frontend is the source of truth for which personas are allowed, and the backend enforces what the frontend declares.
- **Missing `allowedPersonaIds` means unrestricted.** This maintains backward compatibility with existing hub behavior and any other callers that do not send the field.
- **localStorage key format for collapse state:** Should use the serialized threadKey string (e.g., `unified-chat-collapsed:project:{projectId}:hub` or `unified-chat-collapsed:project:{projectId}:panel:metamodel`).
- **localStorage key format for width:** Same approach -- key by serialized threadKey string (e.g., `unified-chat-width:project:{projectId}:panel:metamodel`).
- **`isChatV2Request` type guard** must be updated to optionally accept `allowedPersonaIds` as a string array.
- **Three task JSON files to update:** `architect--define-architecture.json`, `architect--define-tech-stack.json`, `test-engineer--test-strategy.json` -- add `"panel"` to their `availableFrom` arrays.
