# What's Next v1-C: Work Item Picker

## 1. Overview

Extend the "What's Next" action system with a third discriminated union variant -- `PickerAction` -- that triggers a deterministic, multi-turn work item search flow within the hub thread. When the user clicks an Implement-targeting action card, the assistant prompts "For which work item?", the user provides a text query, the system searches FEATURE and STORY work items server-side (ILIKE on title/summary), returns up to 5 ranked clickable results (in-scope first based on dashboard scope), and on selection navigates to the Implement screen with that work item pre-loaded via URL parameters.

## 2. Background & Context

### What Exists Today

**v1** established the deterministic "What's Next" evaluator (`whatsNextEvaluator.ts`) with `ProjectSignals`, a short-circuit in `chatV2.ts` that bypasses the LLM, and `WhatsNextActionList` as a dedicated structured response renderer. The evaluator returns `NextAction[]` where `NextAction = PanelAction | ModalAction`. Actions either navigate to a screen and open the RHS panel (`PanelAction`, launch: `'panel'`) or open a modal directly (`ModalAction`, launch: `'modal'`).

**v1-B** refactored `NextAction` from a single interface into a discriminated union on the `launch` field (`'panel' | 'modal'`), added `ModalActionContext` for cross-component modal triggering, and converted the two tech-standards actions to `ModalAction` variants.

### The Gap

There is no mechanism to route to the Implement screen from "What's Next". The Implement screen requires a specific work item (FEATURE or STORY) to be selected before it is useful. Today the v1 action catalog explicitly omits Implement-targeting actions because there is no picker flow. This spec adds a `PickerAction` variant that triggers an inline work item search dialog in the hub thread before navigating.

## 3. Goals & Non-Goals

### Goals

1. Add a `PickerAction` variant (launch: `'implementPicker'`) to the `NextAction` discriminated union, with new Implement-targeting action constants in the evaluator.
2. Build a server-side text search endpoint in architecture-model-service (Spring Data JPA ILIKE on title and description columns, filtering to FEATURE and STORY types only).
3. Implement a deterministic, multi-turn picker state machine inside the existing `chatV2.ts` short-circuit: prompt -> user query -> search -> results/retry -> selection -> URL navigation.
4. Create a new `WorkItemSearchResults` structured response component for rendering search results as clickable cards with a Cancel option.
5. Navigate to Implement via URL params (`?tab=implement&workItemId=...`) for refresh survival.

### Non-Goals

- Fuzzy or phonetic search
- Description-field search beyond the title and summary columns exposed by the new ILIKE query
- Search result caching on gateway or frontend
- Recents or bookmarks for previously selected work items
- Pagination or "show more" for search results
- Jira integration beyond existing imported data
- LLM-based search intent extraction or query refinement
- Auto-sending a chat message to the Implement persona on arrival
- Searching EPIC or INITIATIVE work item types
- Story-count signals as a prerequisite for showing Implement actions
- Advanced prioritization or ranking algorithms beyond the two-bucket approach
- Adding UnifiedChatPanel to the Implement screen

## 4. Detailed Design

### 4.1 Backend: Architecture Model Service Changes

#### 4.1.1 New Search Endpoint

A new GET endpoint on `WorkItemController` for text search:

- **URL**: `GET /api/model/projects/{projectId}/work-items/search?q={query}&types=FEATURE,STORY&limit=10`
- **Repository method**: A new `@Query` method on `WorkItemRepository` using native PostgreSQL ILIKE: `WHERE project_id = :projectId AND type IN (:types) AND (title ILIKE '%' || :query || '%' OR description ILIKE '%' || :query || '%') ORDER BY sort_order ASC, created_at ASC LIMIT :limit`
- **Service method**: `WorkItemService.searchWorkItems(UUID projectId, String query, List<String> types, int limit)` delegates to the repository, maps entities to `WorkItemDto` list
- **Controller method**: `WorkItemController.searchWorkItems(@PathVariable UUID projectId, @RequestParam String q, @RequestParam List<String> types, @RequestParam(defaultValue = "10") int limit)` -- validates `q` is non-blank, types are valid, limit is between 1-50
- **Response**: `List<WorkItemDto>` -- same DTO shape as existing endpoints (snake_case JSON)
- **Limit**: Gateway will request `limit=10` (more than the 5 shown to user, to allow server-side re-ranking by scope before truncating to 5)

#### 4.1.2 Entity, DTO, Mapper

No changes needed to `WorkItemEntity`, `WorkItemDto`, or `WorkItemMapper` -- the search endpoint returns the same DTO shape as existing CRUD endpoints.

### 4.2 Backend: Gateway Changes

#### 4.2.1 Type Updates (PickerAction variant)

Extend the `NextAction` discriminated union in `gateway/src/services/whatsNextEvaluator.ts` with a third variant:

- **`PickerActionTarget`**: `{ personaId: string }` -- minimal target, similar to `ModalActionTarget` (no screen/tab since navigation is deferred until a work item is selected)
- **`PickerAction`**: `{ id, label, reason, priority, launch: 'implementPicker', target: PickerActionTarget }` -- the `launch` value `'implementPicker'` serves as the discriminant
- **`NextAction = PanelAction | ModalAction | PickerAction`** -- the union now has three variants
- The `launch` field type on the frontend `WhatsNextActionList` narrows from `'panel' | 'modal'` to `'panel' | 'modal' | 'implementPicker'`

#### 4.2.2 Evaluator Updates

Add new action constants for Implement-targeting actions in the bootstrap-complete (optimisation) branch:

- **`START_IMPLEMENTATION_ACTION`**: `{ id: 'start-implementation', label: 'Start Implementation', reason: 'All foundational artifacts are in place. Pick a feature or story to begin implementation.', priority: 45, launch: 'implementPicker', target: { personaId: 'developer' } }`
- **Inclusion criteria**: Only added when all bootstrap signals are true (same branch that currently adds `REVIEW_ROADMAP_ACTION`, `REVIEW_ARCHITECTURE_ACTION`, `REFRESH_TECH_STANDARDS_ACTION`). No additional story-count checks.
- **Priority**: 45 (inserted between REVIEW_ROADMAP at 40 and the bootstrap actions at 50+), making it the first action shown in the optimisation list.

#### 4.2.3 Work Item Search Service

A new module `gateway/src/services/workItemSearchService.ts`:

- **`searchWorkItems(projectId: string, query: string, scopeType?: ScopeType, scopeValue?: string): Promise<WorkItemSearchResult[]>`**
- Calls `GET {architectureModelServiceBaseUrl}/api/model/projects/{projectId}/work-items/search?q={query}&types=FEATURE,STORY&limit=10` using the same fetch pattern as `fetchProductSummary` in `architectureModelClient.ts`
- If `scopeType` and `scopeValue` are provided, resolves in-scope epic IDs server-side by calling the existing `fetchProductSummary(projectId)` to get the roadmap hierarchy, then deriving which epic IDs are "in scope" (e.g., for NEXT_5_EPICS, the first 5 epics by sort order; for ENTIRE_PRODUCT, all epics)
- **Ranking algorithm**:
  1. Partition results into two buckets: in-scope (work item's ancestor epic is in the in-scope set) and out-of-scope
  2. Within each bucket: keep the order returned by the database (text relevance via ILIKE position) but boost items with status `IN_PROGRESS` or `ACTIVE` to the top of their bucket
  3. Concatenate in-scope bucket first, then out-of-scope bucket
  4. Truncate to 5 results
- **`WorkItemSearchResult` shape**: `{ id: string, title: string, type: 'FEATURE' | 'STORY', status: string, parentTitle: string | null, inScope: boolean }` -- parent title is derived from the roadmap hierarchy for display context
- Graceful degradation: if the architecture-model-service call fails, return an empty array (let the picker prompt the user to try again)

#### 4.2.4 Picker State Machine in chatV2

The picker flow is a multi-turn deterministic sub-flow within the existing hub thread, implemented as a new short-circuit block in `chatV2.ts`. It uses a per-thread in-memory state map to track picker mode.

**State tracking**:
- New module-level `Map<string, PickerState>` in `chatV2.ts` (or a separate `pickerStateManager.ts`)
- `PickerState`: `{ mode: 'awaiting-query' | 'awaiting-selection', actionId: string }`
- State is keyed by serialized thread key string
- State is ephemeral (in-memory only, not persisted) -- if the gateway restarts, picker mode is lost and the user sees normal chat

**Flow -- PickerAction click** (frontend sends a message like `"[Action: Start Implementation]"`):
1. The `chatV2.ts` handler detects that the message matches the action-click pattern for a picker action (e.g., a structured marker in the request or a specific `taskId` convention)
2. Sets `pickerState[threadKey] = { mode: 'awaiting-query', actionId: 'start-implementation' }`
3. Persists a user message and an assistant message with content "For which work item? Type a search term (feature or story title)." and `structuredResponse: null`
4. Returns the response. No LLM call.

**Flow -- User sends search query** (while `pickerState.mode === 'awaiting-query'`):
1. Takes the raw user message as the search query (no LLM parsing)
2. Calls `searchWorkItems(projectId, query, scopeType, scopeValue)` where scope comes from the request body (frontend passes `selectedScope`)
3. If results are non-empty: persists user message + assistant message with `structuredResponse: { type: 'work-item-search-results', results: [...], query }`, sets `pickerState.mode = 'awaiting-selection'`
4. If no results: persists user message + assistant message with content "No work items found matching '{query}'. Try a different search term." and `structuredResponse: null`, keeps `pickerState.mode = 'awaiting-query'`
5. Returns response. No LLM call.

**Flow -- User selects a work item** (while `pickerState.mode === 'awaiting-selection'`, frontend sends `"[Selected: {workItemId}]"`):
1. Persists user message + assistant message with content "Navigating to Implement for '{workItemTitle}'..." and a `structuredResponse: { type: 'work-item-selected', workItemId, workItemTitle }`
2. Deletes `pickerState[threadKey]`
3. Returns response with the navigation target embedded so the frontend can route

**Flow -- Cancel** (user clicks Cancel in the results):
1. Frontend sends `"[Cancel picker]"`
2. Persists user message + assistant message with content "Work item selection cancelled."
3. Deletes `pickerState[threadKey]`
4. Returns normal response. Future messages in this thread are handled normally.

**Detection mechanism**: To distinguish picker-flow messages from normal chat, add an optional `pickerAction` field to `ChatV2Request`: `{ pickerAction?: 'initiate' | 'search' | 'select' | 'cancel', pickerPayload?: { actionId?: string, query?: string, workItemId?: string, workItemTitle?: string, scopeType?: string, scopeValue?: string } }`. This avoids parsing message content and keeps the protocol explicit.

**Thread message persistence**: Every turn in the picker flow persists both user and assistant messages to the thread via `appendMessage`, following the exact pattern of the existing `assistant--whats-next` short-circuit. This ensures the picker conversation is visible when the thread is reloaded.

### 4.3 Frontend Changes

#### 4.3.1 Type Updates (PickerAction in WhatsNextActionList)

Update `frontend/src/components/UnifiedChat/WhatsNextActionList.tsx`:

- Add `PickerAction` interface extending `BaseAction` with `launch: 'implementPicker'` and `target: { personaId: string }`
- Update `NextAction = PanelAction | ModalAction | PickerAction`
- No rendering changes needed in `WhatsNextActionList` itself -- it only uses `id`, `label`, `reason` for display

#### 4.3.2 UnifiedChatPanel Handler (picker action click)

Update `handleWhatsNextAction` in `UnifiedChatPanel.tsx`:

- Add a new branch: `if (action.launch === 'implementPicker')`
- When triggered: call `sendMessage` with the picker initiation payload (via the new `pickerAction` field on the chat request, or by passing a structured message)
- Specifically, the handler calls `sendMessage('[Action: Start Implementation]', { pickerAction: 'initiate', pickerPayload: { actionId: action.id } })` -- this sends the message to the hub thread's chatV2 endpoint with the picker flag
- The `selectedScope` from DashboardView must be passed along. Since DashboardView owns `selectedScope` as local state, add it to the `UnifiedChatPanel` props (new optional prop `selectedScope?: { type: string, value?: string }`) and thread it through to the picker flow in the sendMessage call
- No navigation occurs at this point -- the user stays in the hub thread

#### 4.3.3 WorkItemSearchResults Component (new)

A new component `frontend/src/components/UnifiedChat/WorkItemSearchResults.tsx`:

- **Props**: `{ results: WorkItemSearchResult[], query: string, onSelect: (workItemId: string, title: string) => void, onCancel: () => void }`
- **Rendering**: Similar card layout to `WhatsNextActionList` -- vertical stack of clickable buttons, each showing:
  - Work item title (primary text, bold)
  - Type badge (FEATURE/STORY) + status badge + parent title if available (secondary line)
  - Scope indicator (subtle "In scope" tag for in-scope items)
- **Cancel item**: A distinct "Cancel" button at the bottom of the list, styled differently (e.g., text-only, muted) that calls `onCancel()`
- **CSS Module**: `WorkItemSearchResults.module.css` following `WhatsNextActionList.module.css` patterns

#### 4.3.4 MessageBubble Updates

Update `frontend/src/components/UnifiedChat/MessageBubble.tsx`:

- Add `isWorkItemSearchResults` type guard: checks `sr.type === 'work-item-search-results'` and `Array.isArray(sr.results)`
- Add new props: `onWorkItemSelect?: (workItemId: string, title: string) => void` and `onPickerCancel?: () => void`
- Add rendering branch in the ternary chain (after the `showWhatsNextActions` branch): renders `WorkItemSearchResults` component
- Update `showQuestions` guard to exclude `work-item-search-results` type

#### 4.3.5 Cancel Button Handling

When the user clicks Cancel in the `WorkItemSearchResults` component:

- The `onPickerCancel` callback in `UnifiedChatPanel` sends a cancel message to the hub thread: `sendMessage('[Cancel picker]', { pickerAction: 'cancel' })`
- The gateway clears the picker state and returns a normal assistant message
- The hub thread returns to normal chat mode

#### 4.3.6 Navigation to Implement

When the user clicks a work item result:

- The `onWorkItemSelect` callback in `UnifiedChatPanel` sends a selection message: `sendMessage('[Selected: {workItemId}]', { pickerAction: 'select', pickerPayload: { workItemId, workItemTitle } })`
- On receiving the success response, the handler navigates using URL params: `architectureDispatch({ type: 'SET_VIEW', payload: 'product' })` then `window.history.pushState({}, '', '?tab=implement&workItemId=' + workItemId)`
- This reuses the exact URL scheme that `ProductView.tsx` already parses via `parseTabFromUrl()` and `getWorkItemIdFromUrl()` (lines 82-103)
- `ProductImplementPage` receives the `workItemId` prop derived from URL params and loads the work item -- no changes needed to `ProductImplementPage`
- No auto-send of any Implement chat message; the user lands in the ready state

## 5. Data Flow

### Happy Path

1. User opens Dashboard, clicks "What's Next?" on the assistant
2. Evaluator returns actions including "Start Implementation" (PickerAction)
3. User clicks "Start Implementation" card
4. Frontend sends `POST /api/chat/v2` with `pickerAction: 'initiate'`
5. Gateway sets picker state to `awaiting-query`, returns prompt "For which work item?"
6. User types "login page" and sends
7. Frontend sends `POST /api/chat/v2` with `pickerAction: 'search'`, `pickerPayload: { query: 'login page', scopeType: 'NEXT_5_EPICS' }`
8. Gateway calls `GET /api/model/projects/{id}/work-items/search?q=login%20page&types=FEATURE,STORY&limit=10`
9. Gateway ranks results (in-scope first, status boost), truncates to 5
10. Gateway returns `structuredResponse: { type: 'work-item-search-results', results: [...], query: 'login page' }`
11. Frontend renders `WorkItemSearchResults` with 5 clickable cards + Cancel
12. User clicks "Login Page Feature" card
13. Frontend sends `POST /api/chat/v2` with `pickerAction: 'select'`, `pickerPayload: { workItemId: '...', workItemTitle: 'Login Page Feature' }`
14. Gateway clears picker state, returns confirmation message
15. Frontend navigates to `?tab=implement&workItemId=...`
16. `ProductView` parses URL, renders `ProductImplementPage` with that work item

### No Results Path

1. Steps 1-7 same as happy path
2. Gateway search returns 0 results
3. Gateway returns message "No work items found matching 'xyz'. Try a different search term." with no structured response
4. Picker state remains `awaiting-query`
5. User types a new query, flow returns to step 7

### Cancel Path

1. Steps 1-11 same as happy path (results are showing)
2. User clicks "Cancel"
3. Frontend sends `POST /api/chat/v2` with `pickerAction: 'cancel'`
4. Gateway clears picker state, returns "Work item selection cancelled."
5. Hub thread returns to normal chat mode

## 6. API Contracts

### 6.1 Architecture Model Service: Search Work Items

```
GET /api/model/projects/{projectId}/work-items/search
  ?q=login+page
  &types=FEATURE,STORY
  &limit=10

Response 200:
[
  {
    "id": "uuid",
    "project_id": "uuid",
    "type": "FEATURE",
    "parent_id": "uuid-of-epic",
    "title": "Login Page",
    "description": "User login with OAuth...",
    "status": "IN_PROGRESS",
    "sort_order": 1,
    "priority": null,
    "target_window": null,
    "tags": null,
    "external_system": null,
    "external_key": null,
    "created_at": "2026-03-01T...",
    "updated_at": "2026-03-01T..."
  }
]
```

### 6.2 Gateway: POST /api/chat/v2 (picker interactions)

Extended `ChatV2Request` with optional picker fields:

```typescript
interface ChatV2Request {
  // ... existing fields ...
  pickerAction?: 'initiate' | 'search' | 'select' | 'cancel';
  pickerPayload?: {
    actionId?: string;       // for 'initiate'
    query?: string;          // for 'search'
    workItemId?: string;     // for 'select'
    workItemTitle?: string;  // for 'select'
    scopeType?: string;      // for 'search' -- from dashboard scope
    scopeValue?: string;     // for 'search' -- e.g., quarter identifier
  };
}
```

### 6.3 Structured Response Shapes

**Work Item Search Results** (type: `'work-item-search-results'`):

```typescript
{
  type: 'work-item-search-results';
  query: string;
  results: Array<{
    id: string;
    title: string;
    type: 'FEATURE' | 'STORY';
    status: string;
    parentTitle: string | null;
    inScope: boolean;
  }>;
}
```

**Work Item Selected** (type: `'work-item-selected'`):

```typescript
{
  type: 'work-item-selected';
  workItemId: string;
  workItemTitle: string;
}
```

## 7. Testing Strategy

### Architecture Model Service

- Unit test for the new `WorkItemRepository` ILIKE query method with H2 (H2 supports ILIKE natively or via a compatibility mode; if not, use `LOWER(title) LIKE LOWER(...)` fallback for tests)
- Controller integration test: verify `GET .../work-items/search?q=...&types=FEATURE,STORY&limit=5` returns filtered, typed results
- Edge cases: empty query returns 400, no matches returns empty array, special characters in query are safely escaped

### Gateway

- Unit tests for `workItemSearchService.ts`: mock `fetch` calls to architecture-model-service, verify scope resolution and ranking algorithm (in-scope first, status boost, truncation to 5)
- Unit tests for picker state machine: initiate -> awaiting-query, search with results -> awaiting-selection, select -> cleared, cancel -> cleared, search with no results -> stays awaiting-query
- Update existing `whatsNextEvaluator.test.ts`: verify `START_IMPLEMENTATION_ACTION` appears in the bootstrap-complete branch with `launch: 'implementPicker'`
- Integration test for chatV2 picker short-circuit: full request/response cycle for initiate, search, select, and cancel

### Frontend

- `WorkItemSearchResults` component test: renders results, fires onSelect callback with correct ID, fires onCancel
- `WhatsNextActionList` type test: verify PickerAction renders without errors
- `MessageBubble` test: verify `isWorkItemSearchResults` type guard and rendering branch
- `UnifiedChatPanel` test: verify picker action click sends correct pickerAction payload, verify navigation after selection
- Integration test: end-to-end from action card click through search to navigation URL

## 8. Migration & Compatibility

This change is backwards-compatible with v1 and v1-B:

- **Additive type change**: `NextAction` gains a third union variant (`PickerAction`). Existing `PanelAction` and `ModalAction` handling is untouched. The frontend `handleWhatsNextAction` function already has branches for `'panel'` and `'modal'` -- a new `'implementPicker'` branch is added.
- **Additive API change**: `ChatV2Request` gains optional `pickerAction` and `pickerPayload` fields. Existing requests without these fields work identically. The `isChatV2Request` type guard does not need changes since these fields are optional.
- **New endpoint**: The architecture-model-service search endpoint is entirely new and does not affect existing endpoints.
- **Evaluator**: The `START_IMPLEMENTATION_ACTION` constant is only added in the bootstrap-complete branch. Projects that have not completed bootstrap see no change in their action list.
- **No database migration**: The search endpoint uses existing tables and columns.
- **Deploy order**: Architecture-model-service must be deployed first (new search endpoint), then gateway (new search service + picker state machine + evaluator update), then frontend (new component + handler branch). Gateway and frontend should be deployed together to avoid frontend sending picker actions that the gateway does not yet handle.

## 9. Files to Modify

| File | Action | Description |
|------|--------|-------------|
| `architecture-model-service/.../repository/entity/WorkItemRepository.java` | Modify | Add `@Query` method for ILIKE search on title and description, filtered by type list |
| `architecture-model-service/.../service/WorkItemService.java` | Modify | Add `searchWorkItems(UUID, String, List<String>, int)` method delegating to repository |
| `architecture-model-service/.../controller/WorkItemController.java` | Modify | Add `GET .../work-items/search` endpoint with query, types, and limit params |
| `gateway/src/services/whatsNextEvaluator.ts` | Modify | Add `PickerAction` type, `PickerActionTarget` interface, `START_IMPLEMENTATION_ACTION` constant; update `NextAction` union; add action to optimisation branch |
| `gateway/src/services/workItemSearchService.ts` | Create | New service: calls architecture-model-service search endpoint, resolves scope, ranks results, returns top 5 |
| `gateway/src/routes/chatV2.ts` | Modify | Add picker state map and picker short-circuit block (initiate, search, select, cancel flows); extend `ChatV2Request` validation for optional picker fields |
| `gateway/src/types/chatV2.ts` | Modify | Add optional `pickerAction` and `pickerPayload` fields to `ChatV2Request` interface and `isChatV2Request` type guard |
| `frontend/src/components/UnifiedChat/WhatsNextActionList.tsx` | Modify | Add `PickerAction` interface; update `NextAction` union to include `'implementPicker'` launch type |
| `frontend/src/components/UnifiedChat/WorkItemSearchResults.tsx` | Create | New component: renders search results as clickable cards with Cancel button |
| `frontend/src/components/UnifiedChat/WorkItemSearchResults.module.css` | Create | CSS module for WorkItemSearchResults component |
| `frontend/src/components/UnifiedChat/MessageBubble.tsx` | Modify | Add `isWorkItemSearchResults` type guard, rendering branch, `onWorkItemSelect` and `onPickerCancel` props |
| `frontend/src/components/UnifiedChat/UnifiedChatPanel.tsx` | Modify | Add `'implementPicker'` branch in `handleWhatsNextAction`; add picker select/cancel handlers; add navigation on selection; accept and forward `selectedScope` prop |
| `frontend/src/components/UnifiedChat/ChatThread.tsx` | Modify | Thread `onWorkItemSelect` and `onPickerCancel` props through to MessageBubble instances |
| `frontend/src/components/DashboardView/DashboardView.tsx` | Modify | Pass `selectedScope` to `UnifiedChatPanel` as a new prop |
