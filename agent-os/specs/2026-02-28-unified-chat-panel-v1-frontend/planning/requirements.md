# Spec Requirements: Unified Chat Panel v1 (Frontend)

## Initial Description

**Increment 2: Unified Chat Panel v1 (Frontend)**

This is Increment 2 of an 11-increment unified conversation engine plan. Increment 1 (Backend) is complete -- POST /api/chat/v2 endpoint, persona/task registries, thread persistence, and prompt composition pipeline are all working. Now we need the frontend chat panel component that consumes it.

Key areas:
1. Reusable React chat panel component (UnifiedChatPanel) -- renders conversation thread, text input, @-mention persona selection, task menu, structured responses, file attachment, resizable/collapsible
2. Chat API client service -- calls POST /api/chat/v2, handles responses
3. Chat state management -- React context/state for thread messages, active persona/task, loading, panel state
4. Message rendering -- user/assistant/system messages with persona attribution, structured response tables, error display
5. Task menu hook -- displays clickable task options when persona returns task list

## Requirements Discussion

### First Round Questions

**Q1:** The existing bespoke chat panels (ProductManagerChatPanel, SolutionArchitectChatPanel, RoadmapPmChatPanel) are each self-contained monoliths with their own state, API calls, and rendering all in one file. The new UnifiedChatPanel is meant to be reusable across Hub, Side Panels, and potentially Embedded contexts. Should we decompose it into smaller subcomponents (e.g., UnifiedChatPanel as the container, plus ChatThread, PersonaMessageBubble, TaskMenu, StructuredQuestionsRenderer, MentionInput, FileAttachmentBar) rather than another monolith?
**Answer:** Decompose into smaller subcomponents with a thin UnifiedChatPanel container. Keep them co-located; avoid over-engineering.

**Q2:** The component needs to work for Hub (Increment 3), Side Panels (Increments 8-9), and potentially Embedded. Should UnifiedChatPanel accept a threadKey (matching the ThreadKey type from gateway/src/types/chatV2.ts), an optional initialPersonaId, and an optional list of allowedPersonaIds to constrain which personas are @-mentionable? Should more state be externalized (e.g., messages passed in as a prop)?
**Answer:** UnifiedChatPanel should own its state and accept threadKey, optional initialPersonaId, and optional allowedPersonaIds. Do not pass messages as props.

**Q3:** The existing app uses React Context for global state (ArchitectureContext, ProjectContext, PersonaPanelContext, AppConfigContext) and local useState/useRef within each chat panel -- there is no Redux or Zustand. Should we follow this pattern with a new ChatPanelContext, or use a custom hook approach (e.g., useChatThread(threadKey)) without a context layer?
**Answer:** Use a custom hook like useChatThread(threadKey) with local state. Do not introduce a new Context yet.

**Q4:** The design doc describes @-mention for persona selection in the chat input. What UX model should the @-mention follow? Inline @-mention with a dropdown, or a separate persona selector button/chip?
**Answer:** Implement inline @-mention with a filterable, keyboard-navigable dropdown that inserts the persona inline.

**Q5:** When the v2 endpoint returns taskId: 'unknown' and structuredResponse.type: 'task-menu', the response includes a list of tasks with taskId, menuLabel, and description. Should these render as clickable buttons/cards in the chat thread, and should clicking one auto-send a message or just set the task silently?
**Answer:** Render task options as clickable buttons/cards in the chat and auto-send a system message that sets the selected task.

**Q6:** The existing QuestionsTable and QuestionsTableRow components in ProductView/ are tightly coupled to the Implement screen's Question type. Should we create a new generic StructuredQuestionsRenderer for the unified chat, or refactor the existing QuestionsTable to be generic enough for both use cases?
**Answer:** Create a new generic StructuredQuestionsRenderer inspired by QuestionsTable. Do not refactor the Implement-specific one yet.

**Q7:** The backend persona configs define colors as hex values (Product Manager: #00897B, Architect: #7B1FA2, etc.) and display names. The existing ChatBubble component only supports three hardcoded color variants. Should persona definitions come from a backend GET endpoint, or from frontend config? And what shape should persona avatars take?
**Answer:** Provide persona definitions from frontend config for now. Render avatars as colored circles with initials using the defined hex colors.

**Q8:** The existing ChatPanel (OAS assistant) implements its own collapse/resize with refs and mouse event handlers. PersonaHelperPanel is a fixed-width drawer. ResizableSplitPane handles resizable layouts. Should the UnifiedChatPanel use a header toggle button for collapse/expand, or integrate with the PersonaPanelContext open/close mechanism?
**Answer:** Use a header toggle button for collapse/expand within the panel itself and persist width to localStorage.

**Q9:** On mount, the component needs to load existing thread messages. There is no GET endpoint for v2 threads yet -- only the v1 getImplementConversation for the implement workflow. Should this spec include building a thread-load endpoint, or should the panel start empty and rely on server-side thread continuity?
**Answer:** Yes, include a GET /api/chat/v2/thread endpoint in this increment so history loads on mount.

**Q10:** The existing PM and SA chat panels use a Paperclip button from lucide-react with inline file chips and the fileUploadUtils.ts validation/base64 utilities. The v2 endpoint already supports files in ChatV2Request. Should we reuse the same pattern and utilities as-is?
**Answer:** Reuse the existing Paperclip button, file chips pattern, and fileUploadUtils.ts as-is.

**Q11:** The increment plan says the AC includes "Panel renders on Dashboard." Should the Dashboard integration be minimal (just prove the panel renders with a hardcoded persona like Assistant), or should it be fully wired with persona selection?
**Answer:** Keep Dashboard integration minimal: render the panel with a hardcoded Assistant persona to prove wiring.

**Q12:** Is there anything explicitly out of scope beyond what the increment plan states? For example: streaming responses, artifact save/preview UX, completion chips, thread summarisation, or mobile/responsive layout considerations?
**Answer:** Streaming, artifact preview/save, completion chips, summarisation, mobile/responsive refinements are all out of scope.

### Existing Code to Reference

**Similar Features Identified:**

- Feature: Existing OAS Chat Panel - Path: `frontend/src/components/chat/` (ChatPanel, ChatBubble, ChatInput, ChatMessageList) -- collapse/resize/message rendering patterns
- Feature: Questions Table - Path: `frontend/src/components/ProductView/QuestionsTable.tsx` + `QuestionsTableRow.tsx` -- structured questions rendering pattern to inspire the new StructuredQuestionsRenderer
- Feature: Product Manager Chat Panel - Path: `frontend/src/components/ProductView/ProductManagerChatPanel.tsx` -- persona-specific chat panel patterns, file attachment, conversation rehydration
- Feature: Solution Architect Chat Panel - Path: `frontend/src/components/ProductView/SolutionArchitectChatPanel.tsx` -- similar patterns to PM panel
- Feature: Persona Helper Panel - Path: `frontend/src/components/PersonaHelperPanel/PersonaHelperPanel.tsx` + `.module.css` -- current RHS drawer placeholder that the unified panel replaces on Dashboard
- Feature: Resizable Split Pane - Path: `frontend/src/components/shared/ResizableSplitPane.tsx` -- resize/drag handle patterns
- Feature: Persona Panel Context - Path: `frontend/src/contexts/PersonaPanelContext.tsx` -- panel open/close state management reference
- Feature: Chat API Client (v1) - Path: `frontend/src/api/chatApi.ts` -- existing API client patterns, type definitions, ChatRequest/ChatResponse shapes
- Feature: File Upload Utilities - Path: `frontend/src/utils/fileUploadUtils.ts` -- file validation (MAX_FILES, MAX_FILE_SIZE_BYTES, ACCEPTED_EXTENSIONS), base64 reading; reuse directly
- Feature: ChatV2 Types (Backend) - Path: `gateway/src/types/chatV2.ts` -- ChatV2Request, ChatV2Response, ThreadKey, ThreadMessage types that frontend must mirror
- Feature: ChatV2 Route Handler - Path: `gateway/src/routes/chatV2.ts` -- v2 endpoint implementation showing task-menu response shape, structured response validation, file handling
- Feature: Persona Registry Configs - Path: `gateway/src/config/personas/*.json` -- persona display names, hex colors, task lists, menuLabel strings (source of truth for frontend config)
- Feature: Task Registry Configs - Path: `gateway/src/config/tasks/*.json` -- task definitions with menuLabel, description, contextNeeds, responseFormat

### Follow-up Questions

No follow-up questions were needed. All answers were specific and actionable.

## Visual Assets

### Files Provided:

No visual assets provided. Bash check of `agent-os/specs/2026-02-28-unified-chat-panel-v1-frontend/planning/visuals/` confirmed no image files found.

### Visual Insights:

N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

- **Reusable UnifiedChatPanel component** that renders a full conversation thread with persona-attributed message bubbles, text input with @-mention, task menu, structured response rendering, file attachment, and collapse/resize behavior
- **Decomposed subcomponent architecture**: thin UnifiedChatPanel container with co-located subcomponents (ChatThread, PersonaMessageBubble, TaskMenu, StructuredQuestionsRenderer, MentionInput, FileAttachmentBar)
- **Props interface**: accepts `threadKey` (matching backend ThreadKey type), optional `initialPersonaId`, optional `allowedPersonaIds`; owns all internal state
- **Custom hook `useChatThread(threadKey)`**: manages thread messages, active persona/task, loading state locally with useState -- no new React Context
- **Chat API client service**: calls POST /api/chat/v2 and new GET /api/chat/v2/thread endpoint; handles ChatV2Response parsing; manages loading and error states
- **New GET /api/chat/v2/thread endpoint**: returns thread messages for a given threadKey so history loads on mount (backend addition included in this increment)
- **Inline @-mention**: typing `@` in the text input shows a filterable, keyboard-navigable dropdown of available personas (constrained by `allowedPersonaIds`); selecting a persona inserts it inline and sets `personaId` on the next request
- **Task menu rendering**: when v2 returns `structuredResponse.type: 'task-menu'`, display tasks as clickable buttons/cards in the chat thread; clicking a task auto-sends a system message that sets the selected taskId
- **Structured questions rendering**: new generic `StructuredQuestionsRenderer` component inspired by existing QuestionsTable; renders questions from structured responses with per-question answer inputs; formats answers as numbered list on submit
- **Persona visual identity**: frontend persona config (mirroring backend registry data) provides display names and hex colors; avatars rendered as colored circles with initials
- **Message rendering**: user messages (right-aligned), assistant messages (left-aligned with persona color and avatar/name), system messages (subtle centered), error messages
- **File attachment**: reuse existing Paperclip button, file chips pattern, and `fileUploadUtils.ts` (same max files, size limits, accepted types)
- **Panel collapse/expand**: header toggle button within the panel itself; collapsed state shows a slim vertical tab with icon
- **Panel resize**: left-edge drag handle for width adjustment; width persisted to localStorage keyed by panel context
- **Dashboard integration (minimal)**: render the UnifiedChatPanel on the Dashboard with a hardcoded Assistant persona to prove wiring; replaces or sits alongside PersonaHelperPanel

### Reusability Opportunities

- **fileUploadUtils.ts**: Reuse directly for file validation and base64 reading -- no modifications needed
- **ChatBubble/ChatInput patterns from `frontend/src/components/chat/`**: Inspire subcomponent design but create new implementations for dynamic persona support
- **QuestionsTable/QuestionsTableRow from ProductView**: Inspire the new StructuredQuestionsRenderer's layout and interaction patterns
- **PersonaHelperPanel CSS patterns**: Reference for RHS drawer positioning, header layout, border/shadow styles
- **ResizableSplitPane**: Reference for drag-handle and resize logic patterns
- **Persona registry JSON configs**: Source of truth for building the frontend persona config (display names, colors, task lists)
- **chatApi.ts patterns**: Reference for API client structure, error handling, fetch patterns

### Scope Boundaries

**In Scope:**
- UnifiedChatPanel reusable component with all subcomponents
- useChatThread custom hook for local state management
- Chat API client for v2 endpoint (POST and new GET)
- New GET /api/chat/v2/thread backend endpoint for thread loading
- Inline @-mention with filterable keyboard-navigable dropdown
- Task menu display and auto-send on selection
- New StructuredQuestionsRenderer for structured response questions
- Persona avatars as colored circles with initials from frontend config
- User/assistant/system/error message rendering
- File attachment using existing utilities
- Panel collapse/expand toggle and width resize with localStorage persistence
- Minimal Dashboard integration with hardcoded Assistant persona

**Out of Scope:**
- Streaming responses (SSE/WebSocket)
- Artifact save/preview UX
- Completion chips
- Thread summarisation
- Mobile/responsive layout refinements
- Refactoring existing QuestionsTable to be generic
- Introducing new React Context for chat state
- Full Hub integration with @-mention routing (Increment 3)
- Side Panel integration (Increments 8-9)
- Backend persona GET endpoint (using frontend config instead)

### Technical Considerations

- **Frontend stack**: React 18, TypeScript 5, Vite 5, CSS Modules (vanilla CSS), no UI component library (MUI/Tailwind)
- **State management**: Local useState/useRef via custom hook; follows existing app pattern of no Redux/Zustand
- **API integration**: New v2 API client calls POST /api/chat/v2 (existing) and GET /api/chat/v2/thread (new); mirrors ChatV2Request/ChatV2Response types from `gateway/src/types/chatV2.ts`
- **Backend addition**: GET /api/chat/v2/thread endpoint needs to be added to `gateway/src/routes/chatV2.ts` alongside the existing POST handler; reads from existing threadStore
- **Component location**: New components under `frontend/src/components/` -- likely `frontend/src/components/UnifiedChat/` or extending `frontend/src/components/chat/`
- **Persona config**: Frontend-side persona definitions (id, displayName, color, tasks) mirroring `gateway/src/config/personas/*.json`; avoids runtime backend fetch for v1
- **File handling**: Reuse `frontend/src/utils/fileUploadUtils.ts` unchanged; v2 endpoint already supports `files` field
- **Styling**: CSS Modules following existing patterns (`.module.css` files); reference PersonaHelperPanel.module.css for RHS drawer positioning
- **Panel z-index**: Must coordinate with existing z-index layers (PersonaHelperPanel uses z-index 900, modals use 1000)
- **TopBar height**: Panel positioned below 60px TopBar (matching existing PersonaHelperPanel positioning)
- **localStorage key**: Width persistence needs a stable key format (e.g., `unified-chat-panel-width` or context-specific)
- **Thread key format**: Follows backend ThreadKey type structure (type + projectId + optional scope fields)
- **Icon library**: lucide-react already in use (Paperclip icon for file attachment)
