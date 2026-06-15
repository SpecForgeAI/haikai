# Spec Requirements: Increment 7 -- Hub Bootstrap 4/5: SA Tech Stack + TE Test Strategy End-to-End

## Initial Description
This is Increment 7 of the 11-increment unified conversation engine plan. Increments 1-6 are complete and verified. This increment wires TWO bootstrap conversations through the hub conversation engine:

1. **Solution Architect "Define Tech Stack"** (4th bootstrap conversation): task registration, inline context injection (MISSION.MD + architecture baseline summary via `fetchMetaModelSummary` + optional existing TECH-STACK.MD), tech-stack generation via direct LLM call with jsonMode and corrective retry, TechStackPreviewBubble with structured categories, adapter-pattern save via new generic `save_markdown_artifact` MCP tool, completion chip, dashboard exists/not-exists state, and transcript download.

2. **Test Engineer "Define Test Strategy"** (5th bootstrap conversation): task registration, inline context injection (MISSION.MD + ROADMAP via `fetchRoadmapSummary` + TECH-STACK.MD), test-strategy generation via direct LLM call with jsonMode and corrective retry, TestStrategyPreviewBubble with collapsible sections, adapter-pattern save via same generic `save_markdown_artifact` MCP tool, completion chip, dashboard exists/not-exists state, and transcript download.

## Requirements Discussion

### First Round Questions

**Q1:** The design doc (`docs/unified-conversation-engine-analysis.txt`, line 490) describes Increment 7 as covering BOTH "Architect: Generate Technical Standards" AND "Test Engineer: Define Test Strategy" as two separate tasks. However, the raw idea only references the Solution Architect's Tech Stack task. I am assuming this spec covers ONLY the SA Tech Stack (the 4th bootstrap conversation), and the Test Strategy task will be a separate future spec. Is that correct, or should this spec include the Test Engineer's "Define Test Strategy" flow as well?

**Answer:** Cover BOTH: ship SA "Define Tech Stack" + Test Engineer "Define Test Strategy" in this increment (they are the 4th/5th bootstrap conversations).

**Q2:** There is an existing task definition `architect--tech-standards.json` with `mode: "advisory"`, `responseFormat: null`, no artifacts, and no contextNeeds. This is a freeform advisory task that produces no saved artifact. For the new tech stack bootstrap flow, I assume we need a completely NEW task definition (e.g., `architect--define-tech-stack.json`) with `mode: "discovery"`, a structured `responseFormat` (matching the architecture pattern with `phase`, `section`, `questions`, `summary`), `contextNeeds: ["mission", "architecture-baseline"]`, and an `artifacts` entry pointing to a `save_tech_stack` tool. The existing `architect--tech-standards` task would remain untouched as a separate advisory capability. Is that correct, or should we repurpose/modify the existing `architect--tech-standards` task instead?

**Answer:** Create NEW discovery tasks (`architect--define-tech-stack` and `test-engineer--define-test-strategy`) and leave the existing `architect--tech-standards` advisory task untouched. Note: a `test-engineer--test-strategy.json` task file already exists with `mode: "discovery"` but has `responseFormat: null`, empty `contextNeeds`, and empty `artifacts` -- this will need to be upgraded in-place rather than creating a net-new file.

**Q3:** For context injection during the discovery conversation (the POST `/api/chat/v2` handler), I assume the following context files should be loaded inline, mirroring the architecture baseline pattern in `chatV2.ts` lines 1322-1358:
- **MISSION.MD** (same two-path fallback: `MISSION.MD` then `mission.md`)
- **ARCHITECTURE_BASELINE** (the saved architecture baseline JSON from the backend -- needs a fetch call, or loaded from disk as a JSON file)
- **Existing TECH-STACK.MD** (optional: if the user has already generated a tech stack, inject it so the LLM can refine rather than start from scratch)

The architecture baseline is currently stored via the MCP backend (not as a flat file), so loading it would require a `fetchMetaModelSummary()` call or similar. Should we (a) call `fetchMetaModelSummary(projectId)` and serialize the result as context, (b) introduce a new fetch function that returns the raw baseline JSON, or (c) skip architecture baseline injection for now and only inject MISSION.MD + existing TECH-STACK.MD?

**Answer:** Inject MISSION.MD (if present) + existing TECH-STACK.MD (if present); for architecture baseline, inject a serialized `fetchMetaModelSummary(projectId)` result (no new raw-baseline fetch yet). For test strategy, context would include MISSION.MD + ROADMAP + TECH-STACK.MD.

**Q4:** For the tech stack artifact's JSON shape, the architecture baseline uses a flat structure with 7 entity arrays. For a tech stack, I am assuming a categorized structure would be more appropriate, something like:
```json
{
  "categories": [
    {
      "name": "Frontend",
      "technologies": [
        { "name": "React", "version": "18.x", "purpose": "UI framework", "rationale": "..." }
      ]
    }
  ],
  "designDecisions": [
    { "title": "JSON-First Design", "description": "...", "rationale": "..." }
  ]
}
```
Is this the right shape, or should we use a simpler flat list? Should `designDecisions` be included or kept out of scope? Should we also include `constraints` or `standards` arrays?

**Answer:** Categorized structure is appropriate. Include `designDecisions`. Also include a lightweight `constraints` array (e.g., hosting/compliance/perf). Do NOT add a separate `standards` array in this increment.

**Q5:** For the generation approach (POST `/api/chat/v2/generate`), I assume we follow the exact architecture-baseline pattern: direct LLM call with `jsonMode: true`, `temperature: 0.2`, `maxTokens: 64000`, a dedicated `TECH_STACK_GENERATION_PROMPT_TEMPLATE`, plus JSON shape validation and a single corrective retry on failure. Is that correct? Are there any differences in generation parameters (e.g., lower maxTokens since tech stacks are smaller)?

**Answer:** Follow the same direct jsonMode + validation + one corrective retry pattern, but use lower maxTokens (e.g., 8k-16k) since outputs are smaller.

**Q6:** For the save mechanism, there is currently NO `save_tech_stack` tool in any layer (not in `gateway/src/types/tools.ts`, not in `gateway/src/services/toolExecutor.ts`, not in the MCP server). The design doc (line 495) says "store as markdown artifact initially." I assume we need the full save pipeline. What is the preferred storage format: JSON file written to `agent-os/product/`, Markdown file (TECH-STACK.MD), or database-persisted via the MCP backend (like architecture baseline)?

**Answer:** Store as Markdown TECH-STACK.MD in the same artifact system (`agent-os/product/`) via existing `save_product_artifacts` (no new save tool this increment). [SUPERSEDED by Follow-up 1: a new generic `save_markdown_artifact` tool will be introduced instead.]

**Q7:** For the TechStackPreviewBubble component, I assume it should follow the ArchitecturePreviewBubble pattern with collapsible category sections, each expanding to show technologies with name/version/purpose, plus a "Show JSON" toggle and Confirm/Reject buttons. Is that the right design, or should it be simpler?

**Answer:** Use a TechStackPreviewBubble: collapsible categories + key fields + Show JSON toggle + Confirm/Reject (do not do markdown-only).

**Q8:** For the dashboard, the current `dashboardSummary.ts` has a `strategicFoundation.standards` section with `companyStandards` and `productStandards` MetricCards (currently mock). Should we wire tech stack data into this existing standards section, add a new dedicated `techStack` sub-section, or just use a simple exists/not-exists state?

**Answer:** Keep dashboard as exists/not-exists state for now (mission/roadmap/arch/tech-stack booleans) and do not restructure strategicFoundation; optionally show a simple "Tech Stack: Present/Missing" line under Standards.

**Q9:** For first-turn behavior, the architecture task has NO deterministic first-turn (the LLM drives naturally), while the roadmap task has a canned first-turn. Should the tech stack task follow the architecture pattern, or have a deterministic first-turn?

**Answer:** No deterministic first-turn; let the LLM drive, but include a short system hint if TECH-STACK.MD already exists that this will update it.

**Q10:** The raw idea mentions "transcript download support." I assume the tech stack conversation will automatically get transcript download through the existing generic thread persistence mechanism. Is transcript download already handled generically, or does each task need explicit wiring?

**Answer:** Transcript download remains generic (no per-task wiring beyond including artifact markers when saves occur).

**Q11:** For the `useChatThread.ts` TASK_ARTIFACT_MAP, I assume we add a 4th entry with taskId `architect--define-tech-stack`, `artifactId: 'tech-stack'`, `previewType: 'tech-stack-preview'`. Is that the right task ID and artifact naming? Should the `artifactKey` be `techStack` or `standards`?

**Answer:** Yes: add TASK_ARTIFACT_MAP entry for task `architect--define-tech-stack` with `artifactId: 'tech-stack'` and `previewType: 'tech-stack-preview'`, and use `artifactKey: 'techStack'` (not `standards`).

**Q12:** What is explicitly OUT of scope? I assume: Test Engineer "Define Test Strategy" flow, external standards service integration, tech stack auto-detection from codebase, version checking/dependency analysis, and no changes to the existing `architect--tech-standards` advisory task. Correct?

**Answer:** Correct out of scope: no external standards integration, no auto-detection/version checking, no changes to advisory task; also out of scope: test-case generation beyond a high-level strategy and any CI integration. Note: Test Engineer "Define Test Strategy" IS in scope (moved from out-of-scope per Q1 answer).

### Existing Code to Reference

**Similar Features Identified (from codebase research):**
- Feature: Architecture Baseline Bootstrap (Inc 6) - Path: `gateway/src/routes/chatV2.ts` (lines 607-732 for /generate, lines 934-970 for /save-artifact, lines 1322-1358 for context injection)
- Feature: Architecture Task Definition - Path: `gateway/src/config/tasks/architect--define-architecture.json`
- Feature: Architecture Preview Bubble - Path: `frontend/src/components/UnifiedChat/ArchitecturePreviewBubble.tsx`
- Feature: Roadmap Preview Bubble - Path: `frontend/src/components/UnifiedChat/RoadmapPreviewBubble.tsx`
- Feature: TASK_ARTIFACT_MAP - Path: `frontend/src/hooks/useChatThread.ts` (lines 64-96, currently 3 entries)
- Feature: Tool definitions - Path: `gateway/src/types/tools.ts`
- Feature: Tool executor - Path: `gateway/src/services/toolExecutor.ts`
- Feature: Dashboard summary - Path: `gateway/src/routes/dashboardSummary.ts`
- Feature: Dashboard mock service - Path: `gateway/src/services/dashboardSummaryMockService.ts`
- Feature: Architecture generation prompt template - Path: `gateway/src/services/promptBuilder.ts` (line 749+)
- Feature: Existing tech-standards advisory task - Path: `gateway/src/config/tasks/architect--tech-standards.json` (DO NOT MODIFY)
- Feature: Existing test-strategy task shell - Path: `gateway/src/config/tasks/test-engineer--test-strategy.json` (UPGRADE IN-PLACE, keep task ID)
- Feature: Test strategy prompt (stub) - Path: `gateway/src/config/prompts/test-engineer.test-strategy.task.md`
- Feature: Tech standards prompt (stub) - Path: `gateway/src/config/prompts/architect.tech-standards.task.md`
- Feature: V1 baseline generation flow - Path: `gateway/src/routes/chat.ts` (line 1800+)
- Feature: MCP save_product_artifacts route - Path: `mcp-server/src/routes/saveProductArtifactsRoute.ts` (reference for building new `save_markdown_artifact` route)

### Follow-up Questions

**Follow-up 1:** You said to reuse `save_product_artifacts` for saving TECH-STACK.MD, but my research shows this tool is hardcoded end-to-end to write MISSION.MD specifically:
- Gateway `toolExecutor.ts` requires params: `['projectParentFolder', 'projectId', 'productName', 'missionMarkdown']`
- MCP route `saveProductArtifactsRoute.ts` validates `missionMarkdown` as required, writes to hardcoded path `agent-os/product/MISSION.MD`

To reuse it for TECH-STACK.MD, we would need one of these approaches:
- **(a) Extend save_product_artifacts**: Add optional `techStackMarkdown` param; if present, write TECH-STACK.MD instead of (or in addition to) MISSION.MD. This modifies an existing tool contract.
- **(b) Create save_tech_stack as a thin clone**: New MCP endpoint that writes to `agent-os/product/TECH-STACK.MD`, new gateway tool registration. Clean separation but "no new save tool" conflicts with your answer.
- **(c) Generic save_markdown_artifact**: A new general-purpose tool with `{ filename, content }` params that writes to `agent-os/product/`. Could serve both tech-stack and test-strategy.
- **(d) Gateway-only file write**: Skip MCP entirely; have the `chatV2.ts` `/save-artifact` handler write TECH-STACK.MD directly to disk (bypassing the tool executor pattern). Simplest but breaks the established MCP-mediated save pattern.

Which approach do you prefer?

**Answer:** Choose (c): introduce a generic `save_markdown_artifact` MCP tool that takes `{ projectId, artifactName/filename, markdown }` and use it for TECH-STACK.MD and future markdown artifacts.

**Follow-up 2:** For the Test Strategy artifact, what storage format and save mechanism should be used? Paralleling the tech stack answer, should it also be saved as markdown (e.g., `TEST-STRATEGY.MD`) to `agent-os/product/`? And should the same save approach (from Follow-up 1) be used for both artifacts?

**Answer:** Yes: save Test Strategy as markdown (e.g., `TEST-STRATEGY.MD` under `agent-os/product/`) and use the exact same generic markdown-save tool/path as TECH-STACK.MD.

**Follow-up 3:** For the Test Strategy's JSON shape (generated via jsonMode before being converted to markdown for save), what structure is appropriate? I am assuming something like:
```json
{
  "testLevels": [
    { "name": "Unit", "scope": "...", "coverageTarget": "80%", "tools": ["Vitest"], "rationale": "..." }
  ],
  "qualityGates": [
    { "name": "PR Merge Gate", "criteria": ["All tests pass", "Coverage >= 80%"], "enforcement": "automated" }
  ],
  "testingPrinciples": [
    { "title": "Test Pyramid", "description": "..." }
  ]
}
```
Is this the right shape, or should it be simpler/different? Does the test strategy need a `TestStrategyPreviewBubble` with the same collapsible pattern, or a different layout?

**Answer:** That JSON shape is good. Yes, add a TestStrategyPreviewBubble with collapsible sections (testLevels/qualityGates/principles) plus Show JSON toggle and Confirm/Reject.

**Follow-up 4:** For the `useChatThread.ts` TASK_ARTIFACT_MAP, I need to also add a 5th entry for the test strategy. I assume:
```typescript
'test-engineer--define-test-strategy': {
  artifactId: 'test-strategy',
  artifactKey: 'testStrategy',
  completionMessage: 'Test Strategy complete.',
  warningText: 'A Test Strategy already exists. Completing this conversation will replace it.',
  previewType: 'test-strategy-preview',
}
```
However, the existing task file is named `test-engineer--test-strategy` (not `test-engineer--define-test-strategy`). Should I keep the existing task ID `test-engineer--test-strategy` and upgrade it in-place, or rename the task ID to follow the `define-` naming convention used by the other discovery tasks?

**Answer:** Keep the existing task ID (`test-engineer--test-strategy`) and upgrade it in-place to discovery + artifacts to avoid churn.

**Follow-up 5:** For context injection in the Test Strategy conversation, you said to include MISSION.MD + ROADMAP + TECH-STACK.MD. The ROADMAP is stored in the database (via `save_roadmap_structure`), not as a flat file. Should I use `fetchRoadmapSummary(projectId)` or a similar existing function to load the roadmap data for injection, similar to how `fetchMetaModelSummary(projectId)` is used for the architecture baseline in the tech stack context?

**Answer:** Yes: inject roadmap context by calling the existing `fetchRoadmapSummary(projectId)` (or equivalent initiative/epic summary fetch) and serializing it into the prompt context.

## Visual Assets

### Files Provided:
No visual assets provided. (Verified via bash check of `planning/visuals/` directory after both question rounds.)

### Visual Insights:
N/A

## Requirements Summary

### Functional Requirements

**Flow 1: SA "Define Tech Stack" (4th bootstrap conversation)**
- New task definition `architect--define-tech-stack.json` with `mode: "discovery"`, structured `responseFormat` (phase/section/questions/summary), `contextNeeds: ["mission", "architecture-baseline"]`, and artifact entry pointing to `save_markdown_artifact`
- New detailed discovery prompt replacing the stub in `architect.tech-standards.task.md` (new file for the new task: `architect.define-tech-stack.task.md`)
- Context injection in POST `/api/chat/v2`: MISSION.MD (two-path fallback) + serialized `fetchMetaModelSummary(projectId)` for architecture baseline + existing TECH-STACK.MD (two-path fallback, optional)
- System hint injected if TECH-STACK.MD already exists (informing LLM this is an update, not initial creation)
- No deterministic first-turn; LLM drives discovery naturally
- Generation via POST `/api/chat/v2/generate`: new `TECH_STACK_GENERATION_PROMPT_TEMPLATE` with `{missionContent}`, `{architectureContext}`, `{existingTechStack}`, `{conversationTranscript}` placeholders; jsonMode=true, temperature=0.2, maxTokens=16000; JSON shape validation + one corrective retry
- Tech stack JSON schema: `{ categories: [{ name, technologies: [{ name, version, purpose, rationale }] }], designDecisions: [{ title, description, rationale }], constraints: [{ name, description, type }] }`
- TechStackPreviewBubble component: collapsible category sections with technology count in header, technology rows showing name/version/purpose, design decisions section, constraints section, Show JSON toggle, Confirm/Reject buttons
- Save via POST `/api/chat/v2/save-artifact`: new adapter branch calling `save_markdown_artifact` with `{ projectId, artifactFilename: 'TECH-STACK.MD', markdown: <converted content> }` -- JSON-to-markdown conversion in the adapter
- Completion chip after successful save
- TASK_ARTIFACT_MAP 4th entry: `'architect--define-tech-stack': { artifactId: 'tech-stack', artifactKey: 'techStack', completionMessage: 'Tech Stack complete.', warningText: 'A Tech Stack already exists...', previewType: 'tech-stack-preview' }`
- Dashboard: exists/not-exists boolean for tech stack; simple "Tech Stack: Present/Missing" indicator under Standards

**Flow 2: TE "Define Test Strategy" (5th bootstrap conversation)**
- Upgrade existing `test-engineer--test-strategy.json` in-place: keep task ID `test-engineer--test-strategy`, change to structured `responseFormat` (phase/section/questions/summary), add `contextNeeds: ["mission", "roadmap", "tech-stack"]`, add artifact entry pointing to `save_markdown_artifact`
- New detailed discovery prompt replacing the one-line stub in `test-engineer.test-strategy.task.md`
- Context injection in POST `/api/chat/v2`: MISSION.MD (two-path fallback) + serialized `fetchRoadmapSummary(projectId)` for roadmap + TECH-STACK.MD (two-path fallback, optional)
- System hint injected if TEST-STRATEGY.MD already exists (informing LLM this is an update)
- No deterministic first-turn; LLM drives discovery naturally
- Generation via POST `/api/chat/v2/generate`: new `TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE` with `{missionContent}`, `{roadmapContext}`, `{techStackContent}`, `{conversationTranscript}` placeholders; jsonMode=true, temperature=0.2, maxTokens=16000; JSON shape validation + one corrective retry
- Test strategy JSON schema: `{ testLevels: [{ name, scope, coverageTarget, tools: string[], rationale }], qualityGates: [{ name, criteria: string[], enforcement }], testingPrinciples: [{ title, description }] }`
- TestStrategyPreviewBubble component: collapsible sections for testLevels, qualityGates, testingPrinciples, with counts in headers, Show JSON toggle, Confirm/Reject buttons
- Save via POST `/api/chat/v2/save-artifact`: new adapter branch calling `save_markdown_artifact` with `{ projectId, artifactFilename: 'TEST-STRATEGY.MD', markdown: <converted content> }` -- JSON-to-markdown conversion in the adapter
- Completion chip after successful save
- TASK_ARTIFACT_MAP 5th entry: `'test-engineer--test-strategy': { artifactId: 'test-strategy', artifactKey: 'testStrategy', completionMessage: 'Test Strategy complete.', warningText: 'A Test Strategy already exists...', previewType: 'test-strategy-preview' }`
- Dashboard: exists/not-exists boolean for test strategy

**Shared: New `save_markdown_artifact` MCP Tool**
- New generic MCP tool `save_markdown_artifact` with params: `{ projectId: string, artifactFilename: string, markdown: string }`
- Writes markdown content to `<basePath>/agent-os/product/<artifactFilename>` with atomic write (tmp + rename pattern, matching `saveProductArtifactsRoute.ts`)
- Validation: `artifactFilename` must be a safe filename (no path traversal, must end in `.MD` or `.md`), `markdown` must be non-empty string with reasonable size limit (200KB), `projectId` must be valid UUID
- Gateway registration: add `save_markdown_artifact` to `ToolName` union, `ALLOWED_TOOL_NAMES`, `TOOL_ENDPOINTS`, `TOOL_REQUIRED_PARAMS`, and `TOOL_DEFINITIONS` in `gateway/src/types/tools.ts` and `gateway/src/services/toolExecutor.ts`
- MCP endpoint: new route at `/mcp/tools/save_markdown_artifact`
- Reusable for any future markdown artifact saves (not just tech stack and test strategy)

**Shared: Transcript Download**
- Transcript download works generically through existing thread persistence mechanism; no per-task wiring needed

### Reusability Opportunities
- ArchitecturePreviewBubble pattern (collapsible sections, Show JSON toggle, Confirm/Reject) can be adapted for both TechStackPreviewBubble and TestStrategyPreviewBubble
- Architecture baseline /generate branch pattern (jsonMode + corrective retry) applies directly to both artifacts, with lower maxTokens (8k-16k)
- Save-artifact adapter pattern in chatV2.ts needs two new branches, both calling same `save_markdown_artifact` tool
- TASK_ARTIFACT_MAP pattern in useChatThread.ts -- needs 4th and 5th entries
- Inline context assembly pattern from chatV2.ts (file loading with two-path fallback) for MISSION.MD and TECH-STACK.MD
- `fetchMetaModelSummary(projectId)` for architecture baseline context in tech stack flow
- `fetchRoadmapSummary(projectId)` (or equivalent) for roadmap context in test strategy flow
- Existing `test-engineer--test-strategy.json` task file upgraded in-place (keep task ID)
- `saveProductArtifactsRoute.ts` as reference implementation for building `save_markdown_artifact` route
- New `save_markdown_artifact` tool is itself reusable for any future markdown artifact

### Scope Boundaries
**In Scope:**
- SA "Define Tech Stack" full end-to-end flow (4th bootstrap conversation)
- TE "Define Test Strategy" full end-to-end flow (5th bootstrap conversation)
- New task definition: `architect--define-tech-stack.json`
- Upgraded task definition: `test-engineer--test-strategy.json` (keep ID, add responseFormat, contextNeeds, artifacts)
- New discovery prompt: `architect.define-tech-stack.task.md`
- Upgraded discovery prompt: `test-engineer.test-strategy.task.md` (replace one-line stub)
- New generation prompt templates: `TECH_STACK_GENERATION_PROMPT_TEMPLATE` and `TEST_STRATEGY_GENERATION_PROMPT_TEMPLATE`
- JSON shape validation functions for both artifacts
- TechStackPreviewBubble component (collapsible categories + Show JSON + Confirm/Reject)
- TestStrategyPreviewBubble component (collapsible testLevels/qualityGates/principles + Show JSON + Confirm/Reject)
- New generic `save_markdown_artifact` MCP tool (endpoint + gateway registration)
- Save adapter branches in chatV2.ts `/save-artifact` handler for both artifact types
- Generate branches in chatV2.ts `/generate` handler for both artifact types
- JSON-to-markdown conversion logic for both artifacts in save adapter
- TASK_ARTIFACT_MAP entries (4th for tech-stack, 5th for test-strategy)
- Dashboard exists/not-exists state for both artifacts
- Completion chips for both conversations
- System hint for existing artifact detection (both tasks)
- Context injection: `fetchMetaModelSummary` for tech stack, `fetchRoadmapSummary` for test strategy

**Out of Scope:**
- External standards service or governance tooling integration
- Tech stack auto-detection from existing codebase
- Version checking or dependency analysis
- Migration path analysis between tech stacks
- Changes to existing `architect--tech-standards` advisory task (DO NOT MODIFY)
- Test-case generation beyond high-level strategy
- CI/CD integration or pipeline configuration
- Restructuring the dashboard strategicFoundation section
- Rich metric counts (technology count, coverage percentages) on dashboard
- Renaming the `test-engineer--test-strategy` task ID (keep as-is)

### Technical Considerations
- New `save_markdown_artifact` MCP tool needs full implementation: MCP route, gateway tool type registration, tool executor endpoint mapping, tool definition for OpenAI
- `save_markdown_artifact` must validate filename against path traversal (no `..`, no `/`, must end in `.MD` or `.md`)
- JSON-to-markdown conversion is needed in the `/save-artifact` adapter since generation produces JSON (via jsonMode) but storage is markdown -- conversion logic must be defined for both tech stack and test strategy schemas
- Architecture baseline context for tech stack flow requires `fetchMetaModelSummary(projectId)` call -- this function exists in the codebase and returns a serializable summary
- Roadmap context for test strategy flow requires `fetchRoadmapSummary(projectId)` or equivalent -- need to verify this function exists and what shape it returns
- Lower maxTokens (16000) for both generation calls vs. architecture baseline's 64000
- Both preview bubbles can share a common base pattern extracted from ArchitecturePreviewBubble (collapsible sections, Show JSON toggle, Confirm/Reject pattern)
- Existing `test-engineer--test-strategy.json` already has `mode: "discovery"` and `persistence: "hub"` -- upgrade adds responseFormat, contextNeeds, and artifacts without changing existing fields
- The `useChatThread.ts` preview type routing logic (lines 309-318) currently has explicit branches for `roadmap-preview` and `architecture-preview`; two new branches needed for `tech-stack-preview` and `test-strategy-preview`
- Tech stack JSON schema: `{ categories: [{ name: string, technologies: [{ name: string, version: string, purpose: string, rationale: string }] }], designDecisions: [{ title: string, description: string, rationale: string }], constraints: [{ name: string, description: string, type: string }] }`
- Test strategy JSON schema: `{ testLevels: [{ name: string, scope: string, coverageTarget: string, tools: string[], rationale: string }], qualityGates: [{ name: string, criteria: string[], enforcement: string }], testingPrinciples: [{ title: string, description: string }] }`
