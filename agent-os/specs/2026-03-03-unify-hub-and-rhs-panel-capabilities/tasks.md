# Task Breakdown: Unify Hub and RHS Panel Capabilities + Default-Open Hub

## Overview
Total Tasks: 38
Task Groups: 5
Estimated Increments: 5 sequential groups

## Key Source Files

| File | Path |
|------|------|
| UnifiedChatPanel | `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` |
| useChatThread hook | `frontend/src/hooks/useChatThread.ts` |
| chatV2Api client | `frontend/src/api/chatV2Api.ts` |
| DashboardView | `frontend/src/components/DashboardView/DashboardView.tsx` |
| ProductPage | `frontend/src/components/ProductView/ProductPage.tsx` |
| ProductRoadmapPage | `frontend/src/components/ProductView/ProductRoadmapPage.tsx` |
| MetaModelView | `frontend/src/components/MetaModelView/MetaModelView.tsx` |
| Backend types | `gateway/src/types/chatV2.ts` |
| Backend routes | `gateway/src/routes/chatV2.ts` |
| Task config: define-architecture | `gateway/src/config/tasks/architect--define-architecture.json` |
| Task config: define-tech-stack | `gateway/src/config/tasks/architect--define-tech-stack.json` |
| Task config: test-strategy | `gateway/src/config/tasks/test-engineer--test-strategy.json` |

## Task List

### Backend Layer

#### Task Group 1: Backend Types, Validation, and Task Configs
**Dependencies:** None
**Scope:** FR4, FR7 -- server-side `allowedPersonaIds` type, type guard, endpoint validation, and task JSON `availableFrom` updates.

- [x] 1.0 Complete backend types, validation, and config changes
  - [x] 1.1 Write 4 focused tests for server-side `allowedPersonaIds` validation
    - Test 1: POST `/api/chat/v2` returns 400 when `personaId` is not in `allowedPersonaIds`
    - Test 2: POST `/api/chat/v2` succeeds when `personaId` IS in `allowedPersonaIds`
    - Test 3: POST `/api/chat/v2` succeeds when `allowedPersonaIds` is omitted (unrestricted)
    - Test 4: POST `/api/chat/v2/generate` returns 400 when `personaId` is not in `allowedPersonaIds`
    - Place tests in: `gateway/src/__tests__/chatV2-allowedPersonaIds.test.ts`
  - [x] 1.2 Add `allowedPersonaIds` to `ChatV2Request` interface in `gateway/src/types/chatV2.ts`
    - Add `allowedPersonaIds?: string[];` field after the existing `files` field (line ~281)
    - This is an optional string array, matching the frontend mirror type
  - [x] 1.3 Update `isChatV2Request` type guard in `gateway/src/types/chatV2.ts`
    - At line ~340, after the `files` validation block, add a check for `allowedPersonaIds`
    - If `candidate.allowedPersonaIds` is defined: verify it is an array of strings
    - If undefined: pass through (optional field)
  - [x] 1.4 Add `allowedPersonaIds` validation to `POST /` handler in `gateway/src/routes/chatV2.ts`
    - After the `isChatV2Request` validation at line ~1635, extract `allowedPersonaIds` from the validated request
    - Add validation: if `allowedPersonaIds` is a non-empty array and `request.personaId` is not included, return `res.status(400).json({ error: 'Persona not allowed: {personaId} is not in allowedPersonaIds' })`
    - If `allowedPersonaIds` is missing, undefined, or empty array: skip validation
  - [x] 1.5 Add `allowedPersonaIds` validation to `POST /generate` handler in `gateway/src/routes/chatV2.ts`
    - After the existing `personaId` string validation at line ~735, add the same validation logic
    - Extract `allowedPersonaIds` from `req.body`
    - If non-empty array and `personaId` not in it: return 400 with error message
  - [x] 1.6 Add `allowedPersonaIds` validation to `POST /save-artifact` handler in `gateway/src/routes/chatV2.ts`
    - The save-artifact handler does not currently receive a `personaId` field. Two options:
      - Option A: Extract `personaId` from the thread's last assistant message (already done at line ~1549-1557) and validate against `allowedPersonaIds` from `req.body`
      - Option B: Add `personaId` as an optional field in the save-artifact request body
    - Recommended: Option A. Read `allowedPersonaIds` from `req.body`. Resolve `personaId` from the thread (existing logic at line ~1549-1557). Validate. Return 400 if not allowed
  - [x] 1.7 Update `architect--define-architecture.json` `availableFrom`
    - File: `gateway/src/config/tasks/architect--define-architecture.json`
    - Line 51: change `"availableFrom": ["hub"]` to `"availableFrom": ["hub", "panel"]`
  - [x] 1.8 Update `architect--define-tech-stack.json` `availableFrom`
    - File: `gateway/src/config/tasks/architect--define-tech-stack.json`
    - Line 50: change `"availableFrom": ["hub"]` to `"availableFrom": ["hub", "panel"]`
  - [x] 1.9 Update `test-engineer--test-strategy.json` `availableFrom`
    - File: `gateway/src/config/tasks/test-engineer--test-strategy.json`
    - Line 49: change `"availableFrom": ["hub"]` to `"availableFrom": ["hub", "panel"]`
  - [x] 1.10 Ensure backend tests pass
    - Run ONLY the 4 tests written in 1.1
    - Verify `isChatV2Request` accepts requests with and without `allowedPersonaIds`
    - Verify all three endpoints reject disallowed personas with 400
    - Verify all three endpoints pass through when `allowedPersonaIds` is absent
    - Do NOT run the entire gateway test suite at this stage

**Acceptance Criteria:**
- `ChatV2Request` interface includes optional `allowedPersonaIds` field
- `isChatV2Request` type guard accepts the optional `allowedPersonaIds` field
- All three POST endpoints (`/`, `/generate`, `/save-artifact`) validate `personaId` against `allowedPersonaIds` when present
- Missing/empty `allowedPersonaIds` means unrestricted (all personas allowed)
- Three task JSON files updated with `"panel"` in `availableFrom`
- The 4 tests from 1.1 pass

---

### Frontend API and Hook Layer

#### Task Group 2: Frontend API Client + useChatThread Hook -- Thread `allowedPersonaIds`
**Dependencies:** Task Group 1
**Scope:** FR8 -- frontend sends `allowedPersonaIds` in all three API calls.

- [x] 2.0 Complete frontend API client and hook updates for `allowedPersonaIds`
  - [x] 2.1 Write 4 focused tests for `allowedPersonaIds` pass-through
    - Test 1: `postChatV2` includes `allowedPersonaIds` in request body when provided
    - Test 2: `postChatV2` omits `allowedPersonaIds` when not provided
    - Test 3: `postGenerateArtifact` includes `allowedPersonaIds` in request body when provided
    - Test 4: `postSaveArtifact` includes `allowedPersonaIds` in request body when provided
    - Place tests in: `frontend/src/__tests__/chatV2-allowedPersonaIds.test.ts`
  - [x] 2.2 Update `postChatV2` in `frontend/src/api/chatV2Api.ts` to accept and pass `allowedPersonaIds`
    - Add optional `allowedPersonaIds?: string[]` parameter to the function signature
    - Currently at line 217: `export async function postChatV2(request: ChatV2Request)`
    - Option A: Add `allowedPersonaIds` to the `ChatV2Request` interface (line 125) and include it in the request object
    - Option B: Accept as a separate parameter and merge into the body
    - Recommended: Option A -- add `allowedPersonaIds?: string[];` to `ChatV2Request` at line ~141 (after `files`). The existing function signature passes the full request, so it will be included automatically
  - [x] 2.3 Update `postGenerateArtifact` in `frontend/src/api/chatV2Api.ts`
    - Currently at line 285: accepts `threadKey`, `personaId`, `taskId`
    - Add optional `allowedPersonaIds?: string[]` parameter
    - Include `allowedPersonaIds` in the `JSON.stringify` body at line 293 (spread conditionally to avoid sending undefined)
  - [x] 2.4 Update `postSaveArtifact` in `frontend/src/api/chatV2Api.ts`
    - Currently at line 316: accepts `threadKey`, `taskId`, `artifactId`, `content`
    - Add optional `allowedPersonaIds?: string[]` parameter
    - Include `allowedPersonaIds` in the `JSON.stringify` body at line 325
  - [x] 2.5 Thread `allowedPersonaIds` through `useChatThread` hook
    - File: `frontend/src/hooks/useChatThread.ts`
    - `UseChatThreadOptions` already has `allowedPersonaIds?: string[]` (line 129) -- no change needed to the options interface
    - Add a ref to hold `allowedPersonaIds` (similar to `onArtifactSavedRef` at line 239):
      ```
      const allowedPersonaIdsRef = useRef(options?.allowedPersonaIds);
      allowedPersonaIdsRef.current = options?.allowedPersonaIds;
      ```
    - Update `sendMessage` (line 486): pass `allowedPersonaIdsRef.current` to `postChatV2` via the request object
    - Update `generateArtifact` (line 315): pass `allowedPersonaIdsRef.current` to `postGenerateArtifact`
    - Update `confirmArtifact` (line 411): pass `allowedPersonaIdsRef.current` to `postSaveArtifact`
  - [x] 2.6 Ensure frontend API tests pass
    - Run ONLY the 4 tests written in 2.1
    - Verify `allowedPersonaIds` is included in request bodies when provided
    - Verify `allowedPersonaIds` is omitted when not provided
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- `postChatV2`, `postGenerateArtifact`, `postSaveArtifact` all accept and forward `allowedPersonaIds`
- `useChatThread` hook threads `allowedPersonaIds` from its options through to all three API calls
- When `allowedPersonaIds` is undefined, it is not included in request bodies
- The 4 tests from 2.1 pass

---

### UnifiedChatPanel Component Layer

#### Task Group 3: Panel State Persistence and Default-Open Behavior
**Dependencies:** None (can run in parallel with Task Groups 1-2)
**Scope:** FR1, FR2, FR3 -- `defaultOpen` prop, per-threadKey collapse persistence, per-threadKey width persistence.

- [x] 3.0 Complete UnifiedChatPanel state persistence and default-open changes
  - [x] 3.1 Write 5 focused tests for panel state persistence
    - Test 1: Panel initializes collapsed when `defaultOpen` is absent and no persisted state
    - Test 2: Panel initializes expanded when `defaultOpen={true}` and no persisted state
    - Test 3: Panel uses persisted collapse state from localStorage when available (overrides `defaultOpen`)
    - Test 4: Panel persists collapse state to localStorage keyed by threadKey on toggle
    - Test 5: Panel persists width to localStorage keyed by threadKey (not shared key)
    - Place tests in: `frontend/src/components/UnifiedChat/__tests__/panelPersistence.test.tsx`
  - [x] 3.2 Add `defaultOpen` prop to `UnifiedChatPanelProps`
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`, line 92
    - Add `defaultOpen?: boolean;` to the `UnifiedChatPanelProps` interface
    - Add JSDoc comment: `/** When true, panel starts expanded if no persisted collapse state exists */`
  - [x] 3.3 Add `threadKeyToString` import
    - File: `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`, line 55
    - Update the existing import: `import type { ThreadKey, FileAttachment } from '../../api/chatV2Api';`
    - Change to: `import { threadKeyToString } from '../../api/chatV2Api';` and keep `type { ThreadKey, FileAttachment }` as separate type import, or use a combined import
    - Reference: `threadKeyToString` is already exported at line 175 of `chatV2Api.ts`
  - [x] 3.4 Implement per-threadKey collapse persistence on mount
    - Remove or replace the current `useState(false)` for `isCollapsed` at line 140
    - Compute initial collapse state:
      1. Build storage key: `unified-chat-collapsed:${threadKeyToString(threadKey)}`
      2. Read from localStorage
      3. If a value exists (`'true'` or `'false'`), use it
      4. If no value exists, use `defaultOpen ? false : true` (defaultOpen=true means NOT collapsed)
    - Use a lazy initializer function in `useState` to avoid reading localStorage on every render
  - [x] 3.5 Persist collapse state to localStorage on toggle
    - Update `handleToggle` callback (line 148) to also write to localStorage
    - Key: `unified-chat-collapsed:${threadKeyToString(threadKey)}`
    - Value: string representation of the new `isCollapsed` state
    - Alternative: add a `useEffect` that writes `isCollapsed` to localStorage whenever it changes
  - [x] 3.6 Replace shared width storage key with per-threadKey key
    - Remove or update the `STORAGE_KEY` constant at line 62
    - Build per-threadKey width key: `unified-chat-width:${threadKeyToString(threadKey)}`
    - Update `getInitialWidth()` (line 73) to accept a storage key parameter, or inline the key computation
    - Update the `useState<number>` initializer at line 139 to use the per-threadKey key
    - Update the width persistence `useEffect` at line 197 to write to the per-threadKey key
  - [x] 3.7 Destructure `defaultOpen` in the component function
    - At line 109, add `defaultOpen` to the destructured props
  - [x] 3.8 Ensure panel persistence tests pass
    - Run ONLY the 5 tests written in 3.1
    - Verify default-open behavior works correctly
    - Verify per-threadKey collapse persistence works
    - Verify per-threadKey width persistence works
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- `defaultOpen` prop is accepted by `UnifiedChatPanel`
- When `defaultOpen={true}` and no persisted state: panel starts expanded
- When `defaultOpen` is absent and no persisted state: panel starts collapsed
- Persisted collapse state overrides `defaultOpen` prop
- Collapse state is persisted per-threadKey to localStorage
- Width is persisted per-threadKey to localStorage (not shared)
- The 5 tests from 3.1 pass

---

### Screen Wiring Layer

#### Task Group 4: Wire Props Across All Screen Components
**Dependencies:** Task Groups 1, 2, 3
**Scope:** FR1 (DashboardView `defaultOpen`), FR5 (`onArtifactSaved` callbacks), FR6 (`artifactExists` records), FR8 (per-screen `allowedPersonaIds`).

- [x] 4.0 Complete screen-level wiring for all four views
  - [x] 4.1 Write 6 focused tests for screen-level wiring
    - Test 1: DashboardView passes `defaultOpen={true}` to UnifiedChatPanel
    - Test 2: ProductPage passes `onArtifactSaved` callback and `artifactExists` record
    - Test 3: ProductRoadmapPage passes `onArtifactSaved` callback and `artifactExists` record
    - Test 4: MetaModelView passes `onArtifactSaved` callback (no `artifactExists`)
    - Test 5: ProductPage includes `allowedPersonaIds={['product-manager']}` (already present, verify unchanged)
    - Test 6: MetaModelView includes `allowedPersonaIds={['architect', 'ux-designer', 'test-engineer']}` (already present, verify unchanged)
    - Place tests in: `frontend/src/components/__tests__/screenPanelWiring.test.tsx`
  - [x] 4.2 Update DashboardView to pass `defaultOpen={true}`
    - File: `frontend/src/components/DashboardView/DashboardView.tsx`, line 523
    - Add `defaultOpen={true}` to the `<UnifiedChatPanel>` element
    - No other changes needed -- `onArtifactSaved` and `artifactExists` are already wired (lines 526-533)
  - [x] 4.3 Update ProductPage to pass `onArtifactSaved` and `artifactExists`
    - File: `frontend/src/components/ProductView/ProductPage.tsx`
    - Currently at line 152-157, the `<UnifiedChatPanel>` has only `threadKey`, `initialPersonaId`, `allowedPersonaIds`
    - Add `onArtifactSaved={fetchData}` -- the `fetchData` callback already exists at line 50 (calls `getDashboardSummary`)
    - Add `artifactExists` derived from `data` state (type `DashboardSummaryDto`):
      ```tsx
      artifactExists={{
        mission: data?.strategicFoundation?.productDefinition?.missionExists?.value === 1,
        roadmap: (data?.strategicFoundation?.roadmap?.state?.value ?? 0) > 0,
      }}
      ```
    - Follow the DashboardView pattern at lines 527-533
  - [x] 4.4 Update ProductRoadmapPage to pass `onArtifactSaved` and `artifactExists`
    - File: `frontend/src/components/ProductView/ProductRoadmapPage.tsx`
    - The `chatPanelOverlay` helper at line 501-507 currently has only `threadKey`, `initialPersonaId`, `allowedPersonaIds`
    - Need to add a `fetchDashboardData` callback for `onArtifactSaved`
    - Add state and fetch callback:
      - Import `getDashboardSummary` from `../../api/dashboardApi`
      - Import `DashboardSummaryDto` from `../../types/dashboard`
      - Add `const [dashboardData, setDashboardData] = useState<DashboardSummaryDto | null>(null);`
      - Add a `fetchDashboardData` callback using the same pattern as ProductPage (lines 50-63)
      - Call `fetchDashboardData()` in the existing `useEffect` alongside `loadRoadmapItems()` and `loadMetadata()`
    - Add `onArtifactSaved={fetchDashboardData}` to the `<UnifiedChatPanel>`
    - Add `artifactExists` derived from `dashboardData`:
      ```tsx
      artifactExists={{
        mission: dashboardData?.strategicFoundation?.productDefinition?.missionExists?.value === 1,
        roadmap: (dashboardData?.strategicFoundation?.roadmap?.state?.value ?? 0) > 0,
      }}
      ```
  - [x] 4.5 Update MetaModelView to pass `onArtifactSaved`
    - File: `frontend/src/components/MetaModelView/MetaModelView.tsx`
    - Currently at line 167-172, the `<UnifiedChatPanel>` has only `threadKey`, `initialPersonaId`, `allowedPersonaIds`
    - Add an `onArtifactSaved` callback that dispatches a `LOAD_MODEL` action:
      - The component already has `dispatch` from `useArchitectureDispatch()` (line 49)
      - Create callback: `const handleArtifactSaved = useCallback(() => { dispatch({ type: 'LOAD_MODEL' }); }, [dispatch]);`
      - Alternatively, if `LOAD_MODEL` is not the correct action, use a re-fetch of architecture data via the existing architecture context API
    - Add `onArtifactSaved={handleArtifactSaved}` to the `<UnifiedChatPanel>` at line 168
    - Do NOT add `artifactExists` (per spec: omit for MetaModel)
  - [x] 4.6 Verify `allowedPersonaIds` already correct on each screen
    - ProductPage (line 156): `allowedPersonaIds={['product-manager']}` -- already correct
    - ProductRoadmapPage (line 505): `allowedPersonaIds={['product-manager']}` -- already correct
    - MetaModelView (line 171): `allowedPersonaIds={['architect', 'ux-designer', 'test-engineer']}` -- already correct
    - DashboardView (line 523-534): no `allowedPersonaIds` -- correct (hub is unrestricted)
    - No changes needed for `allowedPersonaIds` on any screen
  - [x] 4.7 Ensure screen wiring tests pass
    - Run ONLY the 6 tests written in 4.1
    - Verify each screen passes the correct props to UnifiedChatPanel
    - Do NOT run the entire frontend test suite at this stage

**Acceptance Criteria:**
- DashboardView passes `defaultOpen={true}` to UnifiedChatPanel
- ProductPage passes `onArtifactSaved={fetchData}` and `artifactExists` record
- ProductRoadmapPage passes `onArtifactSaved` callback and `artifactExists` record
- MetaModelView passes `onArtifactSaved` callback (dispatches LOAD_MODEL or equivalent)
- MetaModelView does NOT pass `artifactExists`
- All `allowedPersonaIds` values are correct per screen
- The 6 tests from 4.1 pass

---

### Integration Testing

#### Task Group 5: Test Review and Gap Analysis
**Dependencies:** Task Groups 1-4
**Scope:** Cross-cutting integration validation of all changes.

- [x] 5.0 Review existing tests and fill critical gaps only
  - [x] 5.1 Review tests from Task Groups 1-4
    - Review the 4 backend tests from Task 1.1
    - Review the 4 API client tests from Task 2.1
    - Review the 5 panel persistence tests from Task 3.1
    - Review the 6 screen wiring tests from Task 4.1
    - Total existing tests for this feature: 19 tests
  - [x] 5.2 Analyze test coverage gaps for this feature only
    - Identify critical end-to-end workflows that lack test coverage
    - Focus ONLY on gaps related to this spec's feature requirements
    - Key workflows to evaluate:
      - Full flow: panel screen sends `allowedPersonaIds` -> backend validates -> rejects or processes
      - Collapse state round-trip: toggle -> persist -> remount -> restore
      - Width state round-trip: resize -> persist -> remount -> restore with per-threadKey key
      - `availableFrom` filtering: panel threadKey sees architect tasks in task-menu response
      - `onArtifactSaved` callback fires on save-artifact success
  - [x] 5.3 Write up to 8 additional integration tests to fill critical gaps
    - Test 1: `isChatV2Request` returns true when `allowedPersonaIds` is a valid string array
    - Test 2: `isChatV2Request` returns true when `allowedPersonaIds` is omitted
    - Test 3: `isChatV2Request` returns false when `allowedPersonaIds` is not an array of strings
    - Test 4: `POST /generate` returns 400 when persona not in `allowedPersonaIds`
    - Test 5: `POST /save-artifact` returns 400 when resolved persona not in `allowedPersonaIds`
    - Test 6: Task menu from panel threadKey includes `architect--define-architecture` (now in `availableFrom`)
    - Test 7: Panel collapse state persists and restores across simulated remounts with different threadKeys
    - Test 8: `useChatThread` passes `allowedPersonaIds` through to `postChatV2` call
    - Place backend tests in: `gateway/src/__tests__/chatV2-allowedPersonaIds-integration.test.ts`
    - Place frontend tests in: `frontend/src/__tests__/unify-panel-integration.test.ts`
  - [x] 5.4 Run all feature-specific tests
    - Run ONLY tests related to this spec (tests from 1.1, 2.1, 3.1, 4.1, and 5.3)
    - Expected total: approximately 27 tests
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All 27 feature-specific tests pass (19 from groups 1-4 + up to 8 from gap analysis)
- Critical end-to-end workflows are covered
- No more than 8 additional tests added
- Testing focused exclusively on this spec's feature requirements

---

## Execution Order

Recommended implementation sequence:

```
Task Group 1: Backend Types, Validation, and Task Configs
    |
    v                                    Task Group 3: Panel State Persistence
Task Group 2: Frontend API + Hook       (can run in parallel with Groups 1-2)
    |                                        |
    v                                        v
    +----------------------------------------+
                    |
                    v
        Task Group 4: Screen Wiring
                    |
                    v
        Task Group 5: Integration Testing
```

**Notes on parallelism:**
- Task Group 3 (UnifiedChatPanel changes) has no dependency on the backend or API client changes. It can be implemented in parallel with Task Groups 1 and 2.
- Task Group 4 depends on all three prior groups because it wires together the `defaultOpen` prop (Group 3), `allowedPersonaIds` pass-through (Group 2), and `onArtifactSaved`/`artifactExists` which require the backend to accept the updated task configs (Group 1).
- Task Group 5 must run last as it validates the integration of all changes.

## Summary of Changes by File

| File | Changes |
|------|---------|
| `gateway/src/types/chatV2.ts` | Add `allowedPersonaIds` to `ChatV2Request`; update `isChatV2Request` |
| `gateway/src/routes/chatV2.ts` | Add persona validation to POST `/`, `/generate`, `/save-artifact` |
| `gateway/src/config/tasks/architect--define-architecture.json` | `availableFrom: ["hub", "panel"]` |
| `gateway/src/config/tasks/architect--define-tech-stack.json` | `availableFrom: ["hub", "panel"]` |
| `gateway/src/config/tasks/test-engineer--test-strategy.json` | `availableFrom: ["hub", "panel"]` |
| `frontend/src/api/chatV2Api.ts` | Add `allowedPersonaIds` to `ChatV2Request`, `postGenerateArtifact`, `postSaveArtifact` |
| `frontend/src/hooks/useChatThread.ts` | Thread `allowedPersonaIds` ref through to all three API calls |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | Add `defaultOpen` prop; per-threadKey collapse/width persistence; import `threadKeyToString` |
| `frontend/src/components/DashboardView/DashboardView.tsx` | Add `defaultOpen={true}` |
| `frontend/src/components/ProductView/ProductPage.tsx` | Add `onArtifactSaved`, `artifactExists` |
| `frontend/src/components/ProductView/ProductRoadmapPage.tsx` | Add `onArtifactSaved`, `artifactExists`, dashboard data fetch |
| `frontend/src/components/MetaModelView/MetaModelView.tsx` | Add `onArtifactSaved` callback |
