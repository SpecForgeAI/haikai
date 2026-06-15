# Research Notes: Unify Hub and RHS Panel Capabilities

## 1. UnifiedChatPanel Component Analysis

**File:** `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx`

### Props Interface (lines 92-103)
```typescript
export interface UnifiedChatPanelProps {
  threadKey: ThreadKey;
  initialPersonaId?: string;
  allowedPersonaIds?: string[];
  onArtifactSaved?: () => void;
  artifactExists?: Record<string, boolean>;
}
```

### Key Observations
- **No `defaultOpen` prop exists.** Collapsed state is initialized as `useState(false)` (line 140), meaning the panel always starts expanded.
- Panel width persisted to `localStorage` key `unified-chat-panel-width` (shared across all instances).
- Collapsed/expanded state is **not persisted** -- always resets to expanded on mount.
- All artifact flow props (`onArtifactSaved`, `artifactExists`) are optional and passed through to `useChatThread`.
- The component is **completely generic** -- no conditional logic based on threadKey type. All differentiation happens via the props passed by the parent.

### Artifact Flow
- `useChatThread` hook receives `onArtifactSaved` and `artifactExists` through options.
- `confirmArtifact` calls `postSaveArtifact` API, then fires `onArtifactSavedRef.current?.()`.
- `artifactExists` is used in `selectTask` to show a warning message when re-running a task whose artifact already exists.
- Nothing in the component or hook gates artifact generation based on `threadKey.type`. The gating is purely via:
  1. `allowedPersonaIds` -- controls which personas appear in the UI.
  2. `availableFrom` in task definitions -- controls which tasks appear in the task menu (filtered by entryPoint derived from `threadKey.type`).

---

## 2. Hub Chat Usage (DashboardView)

**File:** `frontend/src/components/DashboardView/DashboardView.tsx`

### How UnifiedChatPanel is rendered (lines 522-535):
```typescript
const chatThreadKey: ThreadKey = { type: 'hub', projectId: activeProject.id };

<UnifiedChatPanel
  threadKey={chatThreadKey}
  initialPersonaId="assistant"
  onArtifactSaved={fetchData}
  artifactExists={{
    mission: data?.strategicFoundation?.productDefinition?.missionExists?.value === 1,
    roadmap: (data?.strategicFoundation?.roadmap?.state?.value ?? 0) > 0,
    architecture: (data?.strategicFoundation?.highLevelArchitecture?.overall?.value ?? 0) > 0,
    techStack: (data?.strategicFoundation?.standards?.companyStandards?.value ?? 0) > 0,
    testStrategy: (data?.strategicFoundation?.standards?.productStandards?.value ?? 0) > 0,
  }}
/>
```

### Key Differences from Panel Screens
- Uses `type: 'hub'` threadKey.
- Passes `onArtifactSaved={fetchData}` to trigger dashboard re-fetch after save.
- Passes `artifactExists` record computed from dashboard summary data.
- Does NOT pass `allowedPersonaIds` (all personas available).
- Does NOT pass a `defaultOpen` prop (doesn't exist).

---

## 3. RHS Panel Usage on Other Screens

### ProductPage (`frontend/src/components/ProductView/ProductPage.tsx`)
```typescript
<UnifiedChatPanel
  threadKey={{ type: 'panel', projectId: activeProject.id, screen: 'product' }}
  initialPersonaId="product-manager"
  allowedPersonaIds={['product-manager']}
/>
```
- **No `onArtifactSaved`** -- comment says "advisory tasks only".
- **No `artifactExists`** -- same reason.

### ProductRoadmapPage (`frontend/src/components/ProductView/ProductRoadmapPage.tsx`)
```typescript
<UnifiedChatPanel
  threadKey={{ type: 'panel', projectId: activeProject.id, screen: 'roadmap' }}
  initialPersonaId="product-manager"
  allowedPersonaIds={['product-manager']}
/>
```
- Same pattern: no `onArtifactSaved`, no `artifactExists`.

### MetaModelView (`frontend/src/components/MetaModelView/MetaModelView.tsx`)
```typescript
<UnifiedChatPanel
  threadKey={{ type: 'panel', projectId: activeProject.id, screen: 'metamodel' }}
  initialPersonaId="architect"
  allowedPersonaIds={['architect', 'ux-designer', 'test-engineer']}
/>
```
- Broader set of allowed personas.
- Still no `onArtifactSaved` or `artifactExists`.

---

## 4. useChatThread Hook Analysis

**File:** `frontend/src/hooks/useChatThread.ts`

### TASK_ARTIFACT_MAP (lines 71-119)
Maps 5 task IDs to their artifact metadata:
- `product-manager--define-product` -> mission
- `product-manager--roadmap` -> roadmap
- `architect--define-architecture` -> architecture
- `architect--define-tech-stack` -> techStack
- `test-engineer--test-strategy` -> testStrategy

### Key Observations
- No conditional logic based on threadKey type. The hook is completely agnostic to whether it's hub or panel.
- `onArtifactSaved` callback is called after successful save regardless of thread type.
- `artifactExists` is used only for the warning message in `selectTask`.
- `sealedTaskIds` computed from completion-chip messages in the thread.

---

## 5. ThreadKey Types

**File:** `frontend/src/api/chatV2Api.ts` (lines 22-52)

Three types:
- `HubThreadKey`: `{ type: 'hub', projectId }` -> serialized `project:{projectId}:hub`
- `FeatureThreadKey`: `{ type: 'feature', projectId, featureId }` -> serialized `project:{projectId}:feature:{featureId}`
- `PanelThreadKey`: `{ type: 'panel', projectId, screen, entityId? }` -> serialized `project:{projectId}:panel:{screen}:{entityId?}`

---

## 6. Backend Chat Endpoint Analysis

**File:** `gateway/src/routes/chatV2.ts`

### Task Menu Filtering (lines 1674-1711)
When `taskId === 'unknown'`, the backend builds a task menu:
```typescript
const entryPointMap = { hub: 'hub', panel: 'panel', feature: 'embedded' };
const entryPoint = entryPointMap[threadKey.type] || 'hub';

const taskList = persona.tasks
  .filter(taskId => {
    const taskDef = taskRegistry.get(taskId);
    if (!taskDef || !taskDef.availableFrom || taskDef.availableFrom.length === 0) return true;
    return taskDef.availableFrom.includes(entryPoint);
  })
  .map(...);
```

### Task availableFrom values (from registry scan):
| Task | availableFrom |
|------|--------------|
| architect--define-architecture | hub only |
| architect--define-tech-stack | hub only |
| product-manager--define-product | hub only |
| product-manager--roadmap | hub, panel |
| test-engineer--test-strategy | hub only |
| assistant--freeform | hub only |
| assistant--whats-next | hub only |
| All other tasks | hub, panel |

### Server-Side Persona Enforcement
**NONE.** Searched the entire gateway codebase -- there is no validation that checks whether a given personaId is "allowed" for a particular screen or threadKey. The `allowedPersonaIds` restriction is purely frontend (ChatInputBar restricts @-mention options).

### Artifact Save/Generate Endpoints
- `/generate` and `/save-artifact` do NOT check threadKey type. They work with any thread.
- Artifact type routing is based on `taskRegistry.get(taskId).artifacts[0].artifactId`, not threadKey.
- This means if a panel thread somehow invoked a hub-only task (e.g., `product-manager--define-product`), the backend would process it identically.

---

## 7. Artifact Save Flow

**File:** `frontend/src/api/chatV2Api.ts` (lines 316-333)

`postSaveArtifact(threadKey, taskId, artifactId, content)` -> `POST /api/chat/v2/save-artifact`

- No hub-only logic in the save flow. The threadKey is passed but not used to gate the save.
- Backend `/save-artifact` handler (lines 1311-1597) routes by artifactType derived from task registry, not threadKey.
- On success, backend persists a completion-chip message to the thread and returns `{ success: true }`.
- Frontend `confirmArtifact` in useChatThread inserts an optimistic completion-chip and calls `onArtifactSavedRef.current?.()`.

---

## 8. Summary of Current Gating Mechanisms

| Gating Mechanism | Where | What it controls |
|-----------------|-------|-----------------|
| `allowedPersonaIds` prop | Frontend (ChatInputBar) | Which personas can be @-mentioned |
| `availableFrom` in task JSON | Backend (task menu builder) | Which tasks appear in menu based on entry point (hub/panel/embedded) |
| `onArtifactSaved` prop | Frontend (useChatThread) | Whether dashboard re-fetches after artifact save |
| `artifactExists` prop | Frontend (useChatThread) | Whether a warning shows when re-running a task |

**There is no gating that prevents artifact generation/save in panel contexts.** The only reason panels don't currently generate artifacts is:
1. Hub-only tasks like `define-product` have `availableFrom: ["hub"]` so they don't appear in panel task menus.
2. Panel screens don't pass `onArtifactSaved` or `artifactExists`, so the UX is incomplete but not blocked.

---

## 9. ChatV2Request Type Analysis

**File:** `gateway/src/types/chatV2.ts`

Current request body type:
```typescript
export interface ChatV2Request {
  threadKey: {
    type: 'hub' | 'feature' | 'panel';
    projectId: string;
    featureId?: string;
    screen?: string;
    entityId?: string;
  };
  personaId: string;
  taskId: string;
  message: string;
  files?: Array<{ filename: string; mimeType: string; base64: string }>;
}
```

- **No `allowedPersonaIds` field exists.** This is a new addition.
- The `isChatV2Request` type guard validates structure but does not validate business logic. It will need updating to accept the new optional field.

---

## 10. Decision Log

### Round 1 Decisions (8 questions)

| # | Topic | Decision | Rationale |
|---|-------|----------|-----------|
| 1 | ThreadKey type for hub | Keep `{type:'hub', projectId}` -- do NOT migrate to panel | Avoid migration complexity; add `"panel"` availability to tasks instead |
| 2 | Which tasks available from panels | `define-product` hub-only; `roadmap` already has panel; add panel to `define-architecture`, `define-tech-stack`, `test-strategy` (MetaModel only via allowedPersonaIds) | MetaModel restriction is emergent from persona filtering, not a new format |
| 3 | defaultOpen behavior | Dashboard default-open; other screens unchanged; collapse state persists per threadKey in localStorage | Per-threadKey persistence gives independent state per screen |
| 4 | onArtifactSaved callbacks | Each screen passes its own refresh: Product/Roadmap re-fetch dashboard summary; MetaModel re-fetches metamodel summary; Dashboard keeps fetchData | Screen-appropriate refresh behavior |
| 5 | artifactExists handling | Pass on Product/Roadmap (have summary data); MetaModel omits for now; warning only where data is available | Pragmatic -- avoids fetching extra data for MetaModel |
| 6 | Server-side persona enforcement | Pass `allowedPersonaIds` in request body; validate server-side; no new config formats | Simple, frontend-driven, authoritative for context |
| 7 | Navigation mid-generation | Rely on thread history reload on return; no blocking UX | Keep scope small for this increment |
| 8 | Out of scope items | No assistant persona in panels; no new width scheme beyond per-threadKey localStorage key | Width becomes per-screen naturally via threadKey-based key |

### Round 2 Decisions (3 follow-up questions)

| # | Topic | Decision | Rationale |
|---|-------|----------|-----------|
| F1 | availableFrom format for screen restriction | Option (A): Keep `["hub", "panel"]` simple format; rely on `allowedPersonaIds` for MetaModel-only restriction | No `panel:screen` format invention needed; persona filtering is sufficient |
| F2 | Scope of allowedPersonaIds validation | Validate on ALL THREE endpoints: `/api/chat/v2`, `/api/chat/v2/generate`, `/api/chat/v2/save-artifact` | Prevents bypass via direct artifact calls |
| F3 | Hub behavior when allowedPersonaIds omitted | Treat missing/undefined as "no restriction / all personas allowed" (skip validation) | Backward compatible; hub doesn't need to know all persona IDs |

---

## 11. Key Implementation Implications (Updated)

### To enable artifact flows on panel screens:
1. Change `availableFrom` in 3 task JSONs to include `"panel"`:
   - `architect--define-architecture.json`: `["hub"]` -> `["hub", "panel"]`
   - `architect--define-tech-stack.json`: `["hub"]` -> `["hub", "panel"]`
   - `test-engineer--test-strategy.json`: `["hub"]` -> `["hub", "panel"]`
2. Wire `onArtifactSaved` callbacks on Product, Roadmap, and MetaModel screens.
3. Wire `artifactExists` records on Product and Roadmap screens (MetaModel omits).

### To make hub default-open with per-threadKey persistence:
1. Add `defaultOpen?: boolean` prop to `UnifiedChatPanelProps`.
2. Initialize collapse state from localStorage (keyed by serialized threadKey); fall back to `defaultOpen` prop; fall back to collapsed.
3. Persist collapse state changes to the same localStorage key.
4. Change width localStorage key from shared `unified-chat-panel-width` to per-threadKey key.
5. DashboardView passes `defaultOpen={true}`.

### To enforce persona server-side:
1. Add optional `allowedPersonaIds?: string[]` to `ChatV2Request` interface.
2. Update `isChatV2Request` type guard to accept the new optional field.
3. Add validation logic to all three endpoint handlers:
   - If `allowedPersonaIds` is present, non-empty, and `personaId` is not in the list: return 400 with descriptive error.
   - If `allowedPersonaIds` is missing/undefined/empty: skip validation.
4. Frontend API client includes `allowedPersonaIds` in request body when configured.

### Files requiring changes:
**Frontend:**
- `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` -- new `defaultOpen` prop, per-threadKey localStorage for collapse and width
- `frontend/src/components/DashboardView/DashboardView.tsx` -- pass `defaultOpen={true}`
- `frontend/src/components/ProductView/ProductPage.tsx` -- wire `onArtifactSaved`, `artifactExists`
- `frontend/src/components/ProductView/ProductRoadmapPage.tsx` -- wire `onArtifactSaved`, `artifactExists`
- `frontend/src/components/MetaModelView/MetaModelView.tsx` -- wire `onArtifactSaved`
- `frontend/src/api/chatV2Api.ts` -- include `allowedPersonaIds` in request bodies

**Backend:**
- `gateway/src/types/chatV2.ts` -- add `allowedPersonaIds` to `ChatV2Request`, update type guard
- `gateway/src/routes/chatV2.ts` -- add validation on all three endpoints
- `gateway/src/config/tasks/architect--define-architecture.json` -- update `availableFrom`
- `gateway/src/config/tasks/architect--define-tech-stack.json` -- update `availableFrom`
- `gateway/src/config/tasks/test-engineer--test-strategy.json` -- update `availableFrom`
