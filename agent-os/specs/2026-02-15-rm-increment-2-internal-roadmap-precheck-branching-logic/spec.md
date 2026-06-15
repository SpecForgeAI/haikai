# Specification: RM Increment 2 -- Internal Roadmap Pre-check + Branching Logic

## Goal
Enhance the `roadmap_pm` conversation startup so the gateway pre-checks whether the project already has an internal roadmap (Initiatives/Epics in the architecture-model-service), then returns a deterministic first assistant response for both branches -- "roadmap exists" (summarize and offer to refine) or "no roadmap" (ask about external roadmap) -- without calling the LLM, keeping all branching logic server-side in the gateway.

## User Stories
- As a product team member, I want the Roadmap PM to automatically detect my existing roadmap so that the conversation starts with awareness of what has already been defined rather than asking me from scratch.
- As a product team member, I want to be asked whether I have an external roadmap (e.g., Jira) when no internal roadmap exists so that the PM conversation can branch appropriately from the first message.

## Specific Requirements

**First-turn detection for `roadmap_pm` mode**
- Detect first turn by checking that `session.conversation` is `undefined` or empty (no prior messages) combined with `context.mode === 'roadmap_pm'`
- No new frontend flag or phase value is needed; the existing `GatewaySession.conversation?: OpenAIMessage[]` field (undefined on fresh sessions from `getOrCreateSession()`) is sufficient
- This check must occur early in the `chat.ts` POST handler, after `getOrCreateSession()` but before `buildSystemPrompt()` and `sendChatRequest()`

**Call `fetchProductSummary()` on first turn**
- When first-turn is detected for `roadmap_pm`, call `fetchProductSummary(context.filename)` to retrieve the `ProductSummaryDto` containing `initiatives[].epics[].features[]`
- Reuse the existing `fetchProductSummary()` function from `gateway/src/services/architectureModelClient.ts`; do not create a new endpoint or count route
- A roadmap "exists" when: `initiatives.length > 0` OR orphan EPICs are present (see orphan handling requirement below)
- A roadmap "does not exist" when: `initiatives` is an empty array and no orphan EPICs are detected

**Deterministic first response: "roadmap exists" branch**
- Short-circuit the LLM entirely and return a deterministic `RoadmapPmResponse` with: `phase: "questions"`, `section: "outcome_alignment"` (skip roadmap_existence_check since it is pre-answered), `summary` containing a human-readable roadmap summary (e.g., "I found an existing roadmap with N initiatives and M epics. Let's review and refine it."), `questions` with 2-3 review/refinement questions, `proposedInitiatives: []`, `assumptions: []`, `openItems: []`
- The summary must include initiative and epic counts derived from the fetched data
- The response must be a valid `RoadmapPmResponse` that passes the existing `validateRoadmapPmResponse()` validation
- Persist the short-circuit messages (system empty, user bootstrap message, assistant deterministic response) via `persistConversation()` and append to transcript via `appendTranscriptEntry()` and `flushTranscriptToDisk()`

**Deterministic first response: "no roadmap" branch**
- Short-circuit the LLM entirely and return a deterministic `RoadmapPmResponse` with: `phase: "questions"`, `section: "roadmap_existence_check"`, `summary` (e.g., "No internal roadmap found for this project. Let's figure out the best starting point."), `questions` asking whether the user has an external roadmap (e.g., Jira) or wants to create one from scratch, `proposedInitiatives: []`, `assumptions: []`, `openItems: []`
- One of the questions should explicitly mention Jira/external roadmap as an option
- Same persistence pattern as the "roadmap exists" branch

**Jira branch placeholder response**
- When the user replies indicating they have a Jira roadmap, the LLM (now handling from turn 2 onward) should be guided by the system prompt to respond with: "Jira import is coming in a future increment; please provide the JQL query anyway so we're ready."
- No actual Jira API calls or import functionality; this is a conversational placeholder only
- The system prompt should include a Jira-awareness instruction block so the LLM knows how to handle this conversational path

**Roadmap summary injection into system prompt (`=== EXISTING ROADMAP ===`)**
- When the pre-check finds an existing roadmap, build a condensed text summary of Initiatives (L1) and Epics (L2) ONLY; exclude Features (L3) and Stories (L4)
- Format: each Initiative title + description on one line, indented Epic titles beneath it
- Cap the injected summary at approximately 2,000 characters; if exceeded, truncate with "...truncated" suffix
- Append this as a new `=== EXISTING ROADMAP ===` delimited section in the `roadmap_pm` branch of `buildSystemPrompt()`, alongside the existing `=== PRODUCT MISSION ===` injection
- The summary builder should be a separate pure function (e.g., `buildRoadmapSummary(productSummary: ProductSummaryDto, maxChars: number): string`) for testability

**Conditional prompt instruction block when roadmap exists**
- When roadmap data is present, append an additional instruction block to the system prompt (similar pattern to `FOLLOW_UP_TURN_GUIDANCE`) telling the LLM: "A roadmap already exists in the tool. The roadmap_existence_check section is pre-answered. Skip directly to outcome_alignment and focus on reviewing, refining, and extending the existing roadmap."
- This block should only be appended when the roadmap summary is injected, not on every turn

**Orphan EPICs handling**
- EPICs without a parent Initiative (orphan EPICs) must count as "roadmap exists"
- The `ProductSummaryDto` nests epics inside initiatives, so orphan EPICs may appear as an initiative with an empty or missing title; the implementation must detect this case
- Include orphan EPICs in the summary under an "Orphan Epics" heading, listing titles only (truncated within the 2,000-char cap)
- Orphan EPICs should contribute to the total epic count displayed in the deterministic summary message

**Graceful degradation on architecture-model-service failure**
- If `fetchProductSummary()` returns `null` (network error, timeout, HTTP 500), log a warning and fall through to the "no roadmap" branch
- Do not surface an error message to the user; this follows the `tryFetchBootstrapSummaries()` graceful degradation pattern
- The warning log must include `requestId`, `sessionId`, and the error reason

**Pass roadmap context through `buildSystemPrompt()`**
- Extend the `buildSystemPrompt()` function signature to accept an optional `existingRoadmapSummary?: string` parameter (8th parameter)
- In the `roadmap_pm` branch, if `existingRoadmapSummary` is non-empty, append both the `=== EXISTING ROADMAP ===` section and the conditional instruction block

## Existing Code to Leverage

**SA standards-missing short-circuit in `chat.ts` (lines ~833-880)**
- Provides the exact pattern for returning a deterministic `ChatResponse` without calling the LLM: build a valid structured response object, create short-circuit messages for persistence, persist conversation, append transcript entries, flush to disk, log, and return early with `res.json()`
- Both the "roadmap exists" and "no roadmap" branches should replicate this pattern, constructing valid `RoadmapPmResponse` objects instead of `SolutionArchitectResponse`

**`fetchProductSummary()` in `gateway/src/services/architectureModelClient.ts` (line 298)**
- Existing function that calls `GET /api/projects/{projectId}/product-summary` and returns `ProductSummaryDto | null`
- Returns `null` on HTTP error or network failure (already handles error logging internally)
- The `ProductSummaryDto` has `initiatives: InitiativeSummary[]` where each `InitiativeSummary` has `id`, `title`, `description`, `epics: EpicSummary[]`, and each `EpicSummary` has `id`, `title`, `description`, `features: FeatureSummary[]`

**`tryFetchBootstrapSummaries()` in `chat.ts` (line ~655)**
- Demonstrates the graceful degradation pattern: call `fetchProductSummary()` inside a `.catch()` that logs a warning and returns `null`, then check for null results and log context-specific warnings
- The roadmap pre-check should follow this same catch-and-degrade approach

**PRODUCT MISSION injection in `promptBuilder.ts` (line ~1660)**
- Shows the pattern for appending a delimited context section (`=== PRODUCT MISSION ===`) to the system prompt in the `roadmap_pm` branch of `buildSystemPrompt()`
- The `=== EXISTING ROADMAP ===` section should be appended in the same style, after the PRODUCT MISSION section

**`FOLLOW_UP_TURN_GUIDANCE` in `promptBuilder.ts` (line 184)**
- Demonstrates the pattern for conditionally appending an instruction block to the system prompt based on conversation state
- The "roadmap exists" instruction block should follow this pattern: a constant string that is conditionally appended when the roadmap summary is present

## Out of Scope
- No Jira API calls or Jira import functionality (placeholder message only)
- No saving or persisting of roadmap items (Initiatives, Epics) to the architecture-model-service
- No frontend changes -- `RoadmapPmChatPanel` remains unchanged; all branching logic is server-side
- No new API endpoints on the architecture-model-service or mcp-server
- No new frontend flags, phase values, or bootstrap signal changes
- Features (L3) and Stories (L4) are excluded from the roadmap summary
- No work_item writes or mutations from the gateway
- No changes to the existing `RoadmapPmResponse` type contract (the 7-field schema is unchanged)
- No changes to `roadmapPmResponseValidator.ts` (existing validator is reused as-is for deterministic responses)
- No TECH-STACK.MD injection into the roadmap PM system prompt
