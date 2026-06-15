# Spec Requirements: What's Next v1-C -- Work Item Picker

## Initial Description
For "What's Next" actions that route to the Implement screen, require the user to select a specific work item first. When the user clicks an Implement-targeting action, the assistant asks "For which work item?". The user replies with a short text query; the system returns up to 5 clickable work items ranked with in-scope matches first (based on current dashboard scope), but also including out-of-scope matches. If no matches, assistant prompts the user to try again and repeats the search loop. Clicking a result navigates to the Implement screen with that work item selected and the embedded Implement chat ready.

## Requirements Discussion

### First Round Questions

**Q1:** Should we add a third discriminated union variant to NextAction (e.g., PickerAction with its own launch type), or should we infer picker behavior from the existing PanelAction when target.screen==='implement'?
**Answer:** Add a third discriminated union variant (e.g., PickerAction with launch:'picker' or 'implementPicker') rather than inferring from target.screen==='implement'.

**Q2:** What prerequisites must be met before Implement-targeting actions appear in the What's Next evaluator? Should they require the bootstrap-complete branch plus a minimum story count, or just bootstrap-complete?
**Answer:** Include Implement-targeting actions only after the bootstrap-complete branch is reached (mission + tech standards + roadmap + architecture baseline exist); do not require story-count signals yet.

**Q3:** Should the work item text search be implemented as a server-side JPA query (ILIKE/LIKE) in architecture-model-service, or should the gateway fetch all work items and filter in memory?
**Answer:** Implement search in architecture-model-service as a new Spring Data JPA repository query (ILIKE/LIKE on title/summary) and call it from the gateway (do not fetch-all-and-filter in memory).

**Q4:** How should the current dashboard scope be communicated to the search layer? Should the frontend pass the scope value to the gateway, or should scope resolution happen entirely server-side?
**Answer:** Frontend passes selectedScope (type + value) to the gateway; gateway resolves in-scope epic IDs (or equivalent) server-side and uses them only for ranking, not filtering.

**Q5:** Should the picker conversation flow use the LLM for intent extraction (parsing the user's search query), or should it remain entirely deterministic (pass the raw text as a search term)?
**Answer:** Keep the picker flow entirely deterministic inside the existing hub thread (no LLM for search intent extraction).

**Q6:** Which work item types should be searchable -- all four levels (INITIATIVE, EPIC, FEATURE, STORY), or only the levels relevant to Implement (FEATURE and STORY)?
**Answer:** Search FEATURE and STORY only (exclude EPIC and INITIATIVE for v1 to match Implement semantics).

**Q7:** How should the search results be rendered -- as a new structured response type with a dedicated component, or reuse the existing WhatsNextActionList pattern?
**Answer:** Render results as a new structured response type (type:'work-item-search-results') with a dedicated component similar to WhatsNextActionList.

**Q8:** For navigating to the Implement screen with a selected work item, should we use a URL-based approach (?tab=implement&workItemId=...) or extend PendingActionContext to carry a workItemId?
**Answer:** Use a URL-based approach for Implement selection (e.g., ?tab=implement&workItemId=...) so it survives refresh; avoid extending PendingAction unless routing can't support it.

**Q9:** Should there be an explicit "Cancel" option that exits the picker flow and returns to normal chat, or should the user just type a new message to break out?
**Answer:** Provide an explicit "Cancel" clickable item in the results/loop that ends the picker state and returns to normal chat.

**Q10:** When the user clicks the Implement action card in What's Next, should it immediately prompt within the current hub thread, or should it switch to a separate task/thread first?
**Answer:** Clicking the action card should immediately prompt within the current hub thread (no separate task switch).

**Q11:** After the user selects a work item and navigates to the Implement screen, should the system auto-send an initial chat message to the Implement persona, or just land on the ready state?
**Answer:** Do not auto-send any Implement chat message; just land on the ready state with the work item selected.

**Q12:** Within each ranking bucket (in-scope vs. out-of-scope), how should results be sorted -- by text relevance, by status (e.g., prefer in-progress), or by hierarchy position?
**Answer:** Within each bucket, sort by text relevance then prefer IN_PROGRESS/ACTIVE over others if available; keep it simple (no advanced prioritization).

**Q13:** Are there any specific features or capabilities that should be explicitly excluded from v1 scope?
**Answer:** Exclude fuzzy/phonetic search, description-field search, caching, recents/bookmarks, pagination/show-more, and any Jira integration beyond existing imported data.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: WhatsNextActionList -- Path: `frontend/src/components/UnifiedChat/` (pattern for the new work-item-search-results component)
- Feature: handleWorkOnThis -- Path: `frontend/src/components/ProductView/` (existing Backlog-to-Implement navigation via URL params)
- Feature: whatsNextEvaluator -- Path: `gateway/src/` (NextAction discriminated union to extend with PickerAction)
- Feature: chatV2 short-circuit pattern -- Path: `gateway/src/routes/chatV2.ts` (pattern for deterministic work-item-search endpoint)
- Feature: WorkItemController -- Path: `architecture-model-service` (Java controller/repository to extend with search endpoint)
- Feature: MessageBubble structured response rendering -- Path: `frontend/src/components/UnifiedChat/MessageBubble.tsx` (type-based branching for new response type)

### Follow-up Questions
No follow-up questions were needed. All answers are comprehensive, internally consistent, and address the key architectural decisions without ambiguity.

## Visual Assets

### Files Provided:
No visual assets provided.

## Requirements Summary

### Functional Requirements
- Add a new PickerAction variant to the NextAction discriminated union with a dedicated launch type
- Surface Implement-targeting actions in What's Next only after bootstrap-complete (mission + tech standards + roadmap + architecture baseline exist)
- When user clicks an Implement-targeting action, prompt "For which work item?" within the current hub thread
- Accept user's text query and search FEATURE and STORY work items via server-side ILIKE/LIKE on title and summary fields
- Return up to 5 results ranked with in-scope items first (based on dashboard scope), then out-of-scope items
- Within each ranking bucket, sort by text relevance, then prefer IN_PROGRESS/ACTIVE status
- Scope is used for ranking only, not filtering -- out-of-scope results are still shown
- Frontend passes selectedScope (type + value) to gateway; gateway resolves in-scope epic IDs server-side
- Render results as a new structured response type (type:'work-item-search-results') with a dedicated component
- Include an explicit "Cancel" clickable item to exit picker state and return to normal chat
- If no matches found, prompt user to try again (search loop)
- On work item selection, navigate via URL (?tab=implement&workItemId=...) to the Implement screen
- Do not auto-send any chat message on the Implement screen; land on ready state with work item selected
- Entire picker flow is deterministic -- no LLM involvement for search intent extraction

### Reusability Opportunities
- WhatsNextActionList component pattern for the new work-item-search-results renderer
- Existing handleWorkOnThis navigation flow from Backlog for URL-based Implement navigation
- chatV2 short-circuit pattern for deterministic search endpoint
- MessageBubble type-based branching for rendering the new structured response
- Spring Data JPA repository patterns already in architecture-model-service for the new search query

### Scope Boundaries
**In Scope:**
- New PickerAction variant in NextAction union
- Bootstrap-complete prerequisite check for Implement actions
- Server-side text search endpoint (ILIKE on title/summary for FEATURE and STORY)
- Scope-aware ranking (in-scope first, out-of-scope second)
- New structured response type and dedicated results component
- Cancel flow to exit picker
- URL-based navigation to Implement screen with workItemId
- Simple relevance + status sorting within buckets

**Out of Scope:**
- Fuzzy or phonetic search
- Description-field search (title and summary only)
- Search result caching
- Recents or bookmarks
- Pagination or "show more" for results
- Jira integration beyond existing imported data
- LLM-based search intent extraction
- Auto-sending chat messages on Implement screen arrival
- Searching EPIC or INITIATIVE work item types
- Story-count signals as a prerequisite for Implement actions
- Advanced prioritization or ranking algorithms

### Technical Considerations
- Database is PostgreSQL, so native ILIKE is available for case-insensitive search
- Dashboard selectedScope is currently local state in DashboardView -- frontend must pass it explicitly when initiating search
- PendingActionContext will NOT be extended; URL params handle the Implement navigation handoff
- The search endpoint lives in architecture-model-service (Spring Data JPA) and is called by the gateway
- The picker conversation flow is a multi-turn deterministic sub-flow within the existing hub thread
- New Spring Data JPA repository method needed in WorkItemRepository for text search
- Gateway needs a new route or extension to chatV2 for the work-item search short-circuit

## User Decisions

**1. Action Type Modeling:**
Add a third discriminated union variant (e.g., PickerAction with launch:'picker' or 'implementPicker') rather than inferring from target.screen==='implement'.

**2. Implement Action Prerequisites:**
Include Implement-targeting actions only after the bootstrap-complete branch is reached (mission + tech standards + roadmap + architecture baseline exist); do not require story-count signals yet.

**3. Search Implementation:**
Implement search in architecture-model-service as a new Spring Data JPA repository query (ILIKE/LIKE on title/summary) and call it from the gateway (do not fetch-all-and-filter in memory).

**4. Scope Communication and Usage:**
Frontend passes selectedScope (type + value) to the gateway; gateway resolves in-scope epic IDs (or equivalent) server-side and uses them only for ranking, not filtering.

**5. Picker Flow Intelligence:**
Keep the picker flow entirely deterministic inside the existing hub thread (no LLM for search intent extraction).

**6. Searchable Work Item Types:**
Search FEATURE and STORY only (exclude EPIC and INITIATIVE for v1 to match Implement semantics).

**7. Results Rendering:**
Render results as a new structured response type (type:'work-item-search-results') with a dedicated component similar to WhatsNextActionList.

**8. Implement Navigation Mechanism:**
Use a URL-based approach for Implement selection (e.g., ?tab=implement&workItemId=...) so it survives refresh; avoid extending PendingAction unless routing can't support it.

**9. Cancel Behavior:**
Provide an explicit "Cancel" clickable item in the results/loop that ends the picker state and returns to normal chat.

**10. Action Card Behavior:**
Clicking the action card should immediately prompt within the current hub thread (no separate task switch).

**11. Implement Screen Arrival State:**
Do not auto-send any Implement chat message; just land on the ready state with the work item selected.

**12. Result Sorting:**
Within each bucket, sort by text relevance then prefer IN_PROGRESS/ACTIVE over others if available; keep it simple (no advanced prioritization).

**13. Explicit v1 Exclusions:**
Exclude fuzzy/phonetic search, description-field search, caching, recents/bookmarks, pagination/show-more, and any Jira integration beyond existing imported data.
