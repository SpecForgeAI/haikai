# Spec Requirements: RM Increment 2 -- Internal Roadmap Pre-check + Branching Logic

## Initial Description

When the Roadmap PM chat panel opens and the user sends the first bootstrap message, the gateway should pre-check whether the project already has an internal roadmap (Initiatives and Epics in the architecture-model-service). Based on that result, the gateway returns a deterministic first assistant response -- either summarizing the existing roadmap and offering to refine it, or asking whether the user has an external roadmap (e.g., Jira). This increment does NOT include Jira import, roadmap saving, or any frontend changes. All branching logic is server-side in the gateway.

## Requirements Discussion

### First Round Questions

**Q1:** Reusing `fetchProductSummary()` vs. a new endpoint. The gateway already has `fetchProductSummary(projectId)` which calls `GET /api/projects/{projectId}/product-summary` and returns `ProductSummaryDto` with `initiatives[].epics[].features[]`. I assume the pre-check should reuse this existing function rather than creating a new work-items endpoint, checking `initiatives.length > 0` (or more specifically, checking that at least one INITIATIVE or EPIC exists). Is that correct, or do you want a separate, lighter-weight endpoint (e.g., just a count)?

**Answer:** Yes, reuse `fetchProductSummary()` for the pre-check (`initiatives.length > 0`) to keep this increment minimal; no new endpoint/count route.

**Q2:** "First turn" detection strategy. The frontend currently auto-sends the bootstrap message `"Help me define the high-level roadmap for {productName}."` on mount when `getImplementConversation()` returns no messages. The pre-check needs to happen on that first turn. I assume the gateway should detect "first turn" by checking `session.conversation` is empty/undefined (i.e., `getOrCreateSession()` returns a fresh session with no conversation history) combined with `context.mode === 'roadmap_pm'`. Is that correct, or should the frontend send an explicit flag like `context.phase = 'bootstrap'` (mirroring the `implement_feature` mode pattern)?

**Answer:** Gateway should detect "first turn" by checking whether a persisted/rehydrated conversation exists for `kind=roadmap_pm` (or session has no prior messages); no new frontend bootstrap flag.

**Q3:** Short-circuit pattern (deterministic first response vs. LLM call). For the SA mode, the "standards-missing" case returns a deterministic response without calling the LLM. I assume for RM Increment 2, the "roadmap exists" branch should similarly short-circuit the LLM and return a deterministic `RoadmapPmResponse` with a pre-built summary like "I found an existing roadmap with N initiatives and M epics. Let's refine and extend it." along with the roadmap summary data. For the "no roadmap exists" branch, should the gateway also return a deterministic response asking "Do you have an existing roadmap externally? (No = create new, Yes = Jira + JQL)" without calling the LLM, or should it augment the system prompt with "no internal roadmap found" context and let the LLM generate the response?

**Answer:** Short-circuit the LLM for BOTH branches: return deterministic first assistant response (with a valid `roadmapPmResponse`) for "roadmap exists" AND for "no roadmap" (asks external roadmap question); LLM starts from the next user reply.

**Q4:** Roadmap summary injection into system prompt. When an internal roadmap is found, I assume the existing initiatives/epics should be injected into the system prompt as a new `=== EXISTING ROADMAP ===` section (similar to how `=== PRODUCT MISSION ===` is appended), formatted as a condensed text summary (Initiative title + description, then indented Epics). I assume a reasonable size limit would be the same 50,000-character truncation used for MISSION.MD. Is that correct? Should the summary include Features beneath Epics, or only Initiatives and Epics (matching the raw idea's scope of L1/L2)?

**Answer:** Summary should include ONLY Initiatives + Epics (L1/L2), exclude Features; cap injected summary to ~2,000 characters (truncate with "...truncated").

**Q5:** The "modify existing roadmap" mode prompt changes. When the roadmap exists, the LLM prompt section `roadmap_existence_check` becomes pre-answered. I assume the system prompt should explicitly instruct the LLM to skip that section and start from `outcome_alignment` (or whichever section makes sense), mentioning that a roadmap already exists in the tool. Should the prompt template be modified to include a conditional section, or should this be handled by appending an additional instruction block (similar to `FOLLOW_UP_TURN_GUIDANCE`)?

**Answer:** Yes, append an instruction block in the system prompt when roadmap exists: "A roadmap exists; skip existence check and proceed to review/modify questions."

**Q6:** Error handling when architecture-model-service is unreachable. If `fetchProductSummary()` fails (network error, 500, timeout), I assume the gateway should log a warning and fall through to the "no roadmap" branch (graceful degradation -- the same pattern used for bootstrap summaries in `tryFetchBootstrapSummaries()`). The user would then be asked about external roadmaps as if no internal roadmap exists. Is that correct, or should there be an error message surfaced to the user?

**Answer:** Gracefully degrade to the "no roadmap" branch if model-service is unreachable (log warning); do not hard-error the user in this increment.

**Q7:** EPICs without parent INITIATIVEs. The `ProductSummaryDto` structure nests epics inside initiatives. But what if a project has EPICs that have no parent INITIATIVE (orphan epics)? Should the pre-check consider the roadmap as "existing" if there are orphan EPICs, and if so, how should they appear in the summary -- under a synthetic "Uncategorized" initiative, or as top-level items?

**Answer:** Yes, orphans mean a roadmap exists; include an "Orphan Epics" section in the summary listing them (titles only, truncated).

**Q8:** Scope exclusions confirmation. The raw idea says "no Jira calls/import" and "no saving of roadmap items." I assume the "Yes = Jira + JQL" branch should only present the user with a message like "Jira import is coming in a future increment; please provide the JQL anyway so we're ready"; frontend unchanged with all branching server-side.

**Answer:** Yes, the Jira branch should respond "Jira import is coming in a future increment; please provide the JQL anyway so we're ready"; frontend unchanged with all branching server-side.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: SA mode standards-missing short-circuit -- Path: `gateway/src/routes/chat.ts` (lines ~833-880) -- Deterministic gateway response pattern that bypasses the LLM and returns a valid structured response directly
- Feature: fetchProductSummary() -- Path: `gateway/src/services/architectureModelClient.ts` (line 298) -- Existing function to fetch hierarchical work items (Initiatives > Epics > Features) from architecture-model-service
- Feature: tryFetchBootstrapSummaries() -- Path: `gateway/src/routes/chat.ts` (line ~655) -- Graceful degradation pattern when architecture-model-service is unreachable (log warning, continue with null)
- Feature: PRODUCT MISSION prompt injection -- Path: `gateway/src/services/promptBuilder.ts` (line ~1660) -- Pattern for appending `=== PRODUCT MISSION ===` section to system prompt in the `roadmap_pm` branch of `buildSystemPrompt()`
- Feature: FOLLOW_UP_TURN_GUIDANCE -- Path: `gateway/src/services/promptBuilder.ts` (line 184) -- Pattern for conditional appended instruction blocks in system prompts
- Feature: RoadmapPmResponse type -- Path: `gateway/src/types/chat.ts` (line 769) -- Existing structured response type with phase, section, questions, summary, proposedInitiatives, assumptions, openItems
- Feature: RoadmapPmChatPanel bootstrap message -- Path: `frontend/src/components/ProductView/RoadmapPmChatPanel.tsx` -- How the frontend auto-sends the bootstrap message on mount; this file should NOT be changed
- Feature: GatewaySession.conversation -- Path: `gateway/src/types/session.ts` (line 65) -- `conversation?: OpenAIMessage[]` field used for first-turn detection

### Follow-up Questions

No follow-up questions were needed.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via directory check).

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements
- On the first turn of a `roadmap_pm` conversation, the gateway calls `fetchProductSummary(projectId)` to check whether an internal roadmap exists (at least one Initiative or Epic, including orphan Epics)
- If a roadmap exists (initiatives.length > 0 OR orphan epics exist): return a deterministic `RoadmapPmResponse` summarizing the existing Initiatives and Epics (L1/L2 only, no Features), and offering to review/modify
- If no roadmap exists: return a deterministic `RoadmapPmResponse` asking the user whether they have an external roadmap (e.g., Jira) or want to create one from scratch
- Both branches short-circuit the LLM entirely -- the first assistant message is deterministic; the LLM is only invoked starting from the user's second message
- When an internal roadmap exists, the system prompt is augmented with an `=== EXISTING ROADMAP ===` section containing a condensed Initiatives + Epics summary (max ~2,000 characters, truncated with "...truncated")
- When an internal roadmap exists, an additional instruction block is appended to the system prompt telling the LLM to skip the `roadmap_existence_check` section and proceed directly to review/modify questions
- Orphan EPICs (no parent INITIATIVE) are included under an "Orphan Epics" heading in the summary (titles only, truncated)
- The "Jira" branch responds with "Jira import is coming in a future increment; please provide the JQL anyway so we're ready" -- no actual Jira calls or import
- First-turn detection uses session.conversation being empty/undefined (no new frontend flag)
- If `fetchProductSummary()` fails (network error, timeout, 500), gracefully degrade to the "no roadmap" branch with a warning log

### Reusability Opportunities
- Reuse `fetchProductSummary()` from `gateway/src/services/architectureModelClient.ts` -- no new service endpoint
- Follow the SA short-circuit pattern from `gateway/src/routes/chat.ts` for deterministic response construction
- Follow the `=== PRODUCT MISSION ===` injection pattern in `promptBuilder.ts` for roadmap context injection
- Follow the `FOLLOW_UP_TURN_GUIDANCE` pattern for conditional prompt instruction blocks
- Follow the graceful degradation pattern from `tryFetchBootstrapSummaries()` for error handling
- The deterministic responses must produce valid `RoadmapPmResponse` objects (matching existing type contract: phase, section, questions, summary, proposedInitiatives, assumptions, openItems)

### Scope Boundaries

**In Scope:**
- Gateway-side first-turn detection for `roadmap_pm` mode
- Calling `fetchProductSummary()` on first turn to check for existing roadmap
- Deterministic first assistant response for "roadmap exists" branch (with summary)
- Deterministic first assistant response for "no roadmap" branch (external roadmap question)
- System prompt augmentation with `=== EXISTING ROADMAP ===` section when roadmap exists
- System prompt instruction block to skip `roadmap_existence_check` when roadmap exists
- Orphan EPIC handling in summary
- Graceful degradation on model-service failure
- "Jira import coming soon" placeholder message
- Condensed L1/L2 summary formatting with ~2,000 character cap

**Out of Scope:**
- No Jira API calls or Jira import functionality
- No saving/persisting of roadmap items to architecture-model-service
- No frontend changes (RoadmapPmChatPanel remains unchanged)
- No new API endpoints on architecture-model-service
- No new frontend flags or phase values
- Features (L3) are excluded from the roadmap summary
- Stories (L4) are excluded from the roadmap summary

### Technical Considerations
- The `fetchProductSummary()` function returns `ProductSummaryDto | null` -- null indicates either no data or a service error; the gateway must differentiate between "service returned empty initiatives" (no roadmap) and "service failed" (graceful degradation)
- The deterministic responses must be valid `RoadmapPmResponse` objects that pass the existing validation logic
- The `session.conversation` field (`OpenAIMessage[] | undefined`) is the mechanism for first-turn detection; a fresh session from `getOrCreateSession()` will have `conversation` as `undefined`
- The `=== EXISTING ROADMAP ===` prompt injection should be appended in the `roadmap_pm` branch of `buildSystemPrompt()`, alongside the existing `=== PRODUCT MISSION ===` injection
- The conditional instruction block (skip `roadmap_existence_check`) should be appended similarly to how `FOLLOW_UP_TURN_GUIDANCE` is appended in implement_feature mode
- The ~2,000 character truncation for the roadmap summary is significantly smaller than the 50,000-char MISSION.MD limit, reflecting the goal of keeping the summary compact
- The `ProductSummaryDto.initiatives[].epics[].features[]` structure needs to be traversed but Features should be excluded from the summary output
- Orphan EPICs need special handling since `ProductSummaryDto` nests epics inside initiatives -- if the model-service returns them differently (e.g., in an initiative with an empty title), this must be accounted for
