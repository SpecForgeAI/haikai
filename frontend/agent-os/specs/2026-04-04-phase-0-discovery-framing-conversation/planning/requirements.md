# Spec Requirements: Phase 0 Architecture Persona Discovery Framing Conversation

## Initial Description
Increment 3 of 16 for the legacy/current-state discovery capability. This increment introduces the Phase 0 architecture persona conversation flow dedicated to discovery framing -- gathering structured inputs (applications, app_components, repos, technology hints, exclusions) before any code scanning occurs in Phase 1. The conversation reuses existing chatV2 patterns and operates within project context, producing outputs structurally aligned with the Phase 0 persistence contract (Increment 2) even though actual persistence is deferred to Increment 4.

## Requirements Discussion

### First Round Questions

**Q1:** I assume this task should live under the existing `architect` persona (persona ID `architect`, currently defined in `gateway/src/config/personas/architect.json` with tasks like `architect--define-architecture`, `architect--define-tech-stack`, etc.) rather than creating a new persona. The new task ID would follow the naming convention `architect--discovery-framing` and would be added to the `architect.json` persona's tasks array. Is that correct, or should this use a different persona or a brand-new persona dedicated to discovery?
**Answer:** Keep it under the existing architect persona as a new discovery-framing task, not a brand-new persona.

**Q2:** I assume the conversation should follow the established section-based discovery pattern used by `architect--define-architecture` and `architect--define-tech-stack` -- that is, a responseFormat with `phase` ("questions" / "ready"), `section` (enum of discovery sections), `questions` (array of strings), and `summary` (string). The discovery sections would be something like: `context_and_scope`, `applications_and_components`, `repo_identification`, `repo_application_mapping`, `technology_hints`, `exclusions_and_notes`, `final_review`. Should I follow this exact pattern, or do you have a different set of sections or a different conversation structure in mind?
**Answer:** Yes -- use the established section-based pattern, with discovery-framing sections like scope, anchors, repos, mappings, tech hints, exclusions, and final review.

**Q3:** The raw idea mentions the conversation output should be "structurally aligned" with the Phase 0 persistence contract's `config_payload` JSONB shape (repos, repoApplicationMappings, techHints, exclusions, notes). I assume the responseFormat should include accumulating structured data fields alongside the standard phase/section/questions/summary -- similar to how `architect--detailed-data-model` accumulates `logicalDataEntities`, `physicalDataEntities`, etc., or how `product-manager--backlog` accumulates `proposedFeatures`. This way the LLM progressively builds a structured discovery config object that can be extracted when phase="ready". Is that correct?
**Answer:** Yes -- the task should progressively accumulate structured discovery-framing data so it can cleanly hand off when ready.

**Q4:** For context injection, I assume this task needs `contextNeeds: ["mission", "meta-model-summary"]` so the conversation can reference existing canonical architecture entities (applications, app_components) when they are already defined in the project model. The meta-model-summary context resolver already exists and returns the full model summary. Should any other context be injected (e.g., `tech-stack`, `architecture-baseline`), or are mission and meta-model-summary sufficient?
**Answer:** Use existing architectural context where helpful, especially canonical architecture/meta-model context; do not over-inject unrelated context at this stage.

**Q5:** The raw idea says "No persistence is required yet in this increment -- only alignment of structure." I assume this means no artifact or tool declarations in the task JSON for now (i.e., the `artifacts` array can be empty or contain a placeholder entry that is not wired to any tool execution yet). The actual `save_discovery_config` tool wiring would come in Increment 4. Is that correct?
**Answer:** Correct -- no save wiring in this increment; persistence and artifact generation come in Increment 4.

**Q6:** For the identity prompt, the existing `architect.identity.md` describes a "Senior Solution Architect conducting structured architecture discovery" focused on system design and service decomposition. Since the raw idea emphasizes this must be "clearly distinct from solution architecture persona flows" and focused on "discovery framing, not designing target architecture," should we: (a) create a separate identity prompt that reframes the architect as a discovery/framing facilitator, or (b) reuse the existing architect identity and rely on the task prompt alone to differentiate the behavior?
**Answer:** Reuse the existing architect identity, but make the task prompt clearly position it as discovery framing rather than solution design.

**Q7:** For thread persistence, I assume this conversation uses `"persistence": "hub"` and `"availableFrom": ["hub", "panel"]`, consistent with all other architect tasks. This means it shares the hub thread and can be invoked from both the hub chat panel and the side panel. Is that correct, or should discovery framing have its own isolated thread scope?
**Answer:** Use the normal architect/hub-style persistence pattern; no special isolated thread is needed in this increment.

**Q8:** Is there anything you want to explicitly exclude from this increment beyond what the raw idea lists? For example: should the conversation avoid asking about or collecting information related to CI/CD pipelines, deployment environments, or authentication/authorization for the repos -- keeping it strictly to code-repo scope, technology hints, and exclusions?
**Answer:** Yes -- keep it tightly focused on discovery framing for repos, anchors, tech hints, exclusions, and similar setup information; do not expand into broader solution topics.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: architect--define-architecture task (section-based discovery pattern, responseFormat with phase/section/questions/summary) - Path: `gateway/src/config/tasks/architect--define-architecture.json` and `gateway/src/config/prompts/architect.define-architecture.task.md`
- Feature: architect--define-tech-stack task (section-based discovery pattern) - Path: `gateway/src/config/tasks/architect--define-tech-stack.json` and `gateway/src/config/prompts/architect.define-tech-stack.task.md`
- Feature: architect--detailed-data-model task (accumulating structured data in responseFormat) - Path: `gateway/src/config/tasks/architect--detailed-data-model.json` and `gateway/src/config/prompts/architect.detailed-data-model.task.md`
- Feature: product-manager--backlog task (progressive accumulation of structured output -- proposedFeatures, selectedEpic, assumptions, openItems) - Path: `gateway/src/config/tasks/product-manager--backlog.json` and `gateway/src/config/prompts/product-manager.backlog.task.md`
- Feature: Architect persona definition (tasks array to extend) - Path: `gateway/src/config/personas/architect.json`
- Feature: Architect identity prompt (reused as-is) - Path: `gateway/src/config/prompts/architect.identity.md`
- Feature: Prompt composer pipeline (auto-composes identity + task prompt + context + response format) - Path: `gateway/src/services/promptComposer.ts`
- Feature: Context resolvers (mission, meta-model-summary resolvers) - Path: `gateway/src/services/contextResolvers.ts`
- Feature: Registry loader (auto-discovers new JSON persona/task files at startup) - Path: `gateway/src/services/registryLoader.ts`
- Feature: Thread store (hub-type persistence) - Path: `gateway/src/services/threadStore.ts`
- Feature: chatV2 route handler (handles any registered task generically) - Path: `gateway/src/routes/chatV2.ts`
- Feature: chatV2 types (TaskDefinition, PersonaDefinition, ThreadKey, ThreadMessage interfaces) - Path: `gateway/src/types/chatV2.ts`
- Feature: Phase 0 persistence contract spec (defines config_payload JSONB shape that this conversation's output must align with) - Path: `agent-os/specs/2026-04-04-phase-0-persistence-contract/spec.md`
- Feature: Discovery capability skeleton spec (defines the discovery-service skeleton and gateway awareness) - Path: `agent-os/specs/2026-04-04-legacy-discovery-capability-skeleton/spec.md`
- Feature: Tool types (save_discovery_config already registered in ToolName union -- for future Increment 4 wiring) - Path: `gateway/src/types/tools.ts`

No additional similar features were identified by the user beyond those found during codebase research.

### Follow-up Questions
No follow-up questions were needed. The user's first-round answers were clear and complete.

## Visual Assets

### Files Provided:
No visual assets provided. Bash check of `frontend/agent-os/specs/2026-04-04-phase-0-discovery-framing-conversation/planning/visuals/` confirmed no image files present.

### Visual Insights:
N/A -- no visual files found.

## Requirements Summary

### Functional Requirements

**New task definition JSON: `architect--discovery-framing.json`**
- Task ID: `architect--discovery-framing`
- Persona ID: `architect`
- Mode: `discovery`
- Menu label: a descriptive label such as "Discovery Framing" or "Legacy Discovery Setup"
- Task prompt ref: `prompts/architect.discovery-framing.task.md`
- Context needs: `["mission", "meta-model-summary"]` -- inject the product mission for alignment and the architecture meta-model summary so the LLM can reference existing canonical entities (applications, app_components) without asking the user to re-describe them
- Persistence: `"hub"` (standard hub-level thread)
- Available from: `["hub", "panel"]` (accessible from both hub chat and side panel)
- Artifacts: empty array `[]` -- no persistence or tool wiring in this increment (deferred to Increment 4)
- Phases: `null` (single-phase discovery, not a workflow task)
- Response format: structured JSON object with the standard section-based fields plus accumulating discovery config fields (detailed below)

**Response format schema**
The responseFormat must include:
1. Standard section-based fields (matching the define-architecture / define-tech-stack pattern):
   - `phase`: string enum `["questions", "ready"]`
   - `section`: string enum of discovery framing sections (see section list below)
   - `questions`: array of strings (discovery questions for the user)
   - `summary`: string (running summary of what the LLM understands so far)
2. Accumulating structured discovery config fields (matching the config_payload JSONB shape from the Phase 0 persistence contract):
   - `repos`: array of objects -- each with fields for repo URL/identifier, branch, include paths, exclude paths
   - `repoApplicationMappings`: array of objects -- each mapping a repo/path to an application name
   - `techHints`: array of objects -- each with technology/language hints per repo or path
   - `exclusions`: array of objects -- each with paths/patterns to exclude from scanning
   - `notes`: array of strings -- free-text ambiguity notes
3. Anchor entity references:
   - `applications`: array of objects -- confirmed or newly proposed application names with optional descriptions
   - `appComponents`: array of objects -- confirmed or newly proposed app_component names mapped to applications

**Discovery framing sections (section enum)**
The conversation progresses through sections in order:
1. `context_and_scope` -- Understand what is being discovered: which codebase(s), what the user hopes to learn, the overall discovery objective
2. `applications_and_components` -- Confirm or define the application and app_component anchors that repos will map to; reference existing canonical entities from injected meta-model context
3. `repo_identification` -- Gather repo URLs, identifiers, or descriptions; understand branch strategies and which branches to scan
4. `repo_application_mapping` -- Map each repo (or paths within repos) to the confirmed applications/app_components
5. `technology_hints` -- Collect technology and language hints per repo or path to guide Phase 1 analyzers
6. `exclusions_and_notes` -- Gather paths/patterns to exclude from scanning, ignore rules, and free-text ambiguity notes
7. `final_review` -- Present a consolidated discovery framing recap; set phase="ready" when the user confirms

**Task prompt markdown: `architect.discovery-framing.task.md`**
- Must clearly position the conversation as discovery framing (setup for code scanning), not solution architecture design
- Must instruct the LLM to avoid designing target architecture, recommending technology choices, or proposing service decompositions
- Must instruct the LLM to reference injected meta-model context to confirm existing applications/app_components rather than asking the user to re-describe them
- Must follow the section-based progression pattern from define-architecture task prompt (section ordering, question strategy, handling uncertainty, readiness gate)
- Must instruct the LLM to progressively accumulate the structured discovery config fields in every response
- Must define the readiness gate: all sections visited or skipped, at least one repo identified, at least one application anchor confirmed or proposed
- Must instruct the LLM to keep questions conversational and iterative, not enforce rigid upfront input
- Must instruct the LLM to respond with ONLY valid JSON matching the response format contract
- Must include rules prohibiting tool calls, function calls, code generation, and fields beyond those defined in the response format

**Architect persona extension**
- Add `"architect--discovery-framing"` to the `tasks` array in `gateway/src/config/personas/architect.json`

**Identity prompt reuse**
- Reuse the existing `gateway/src/config/prompts/architect.identity.md` without modification
- The task prompt alone is responsible for positioning the conversation as discovery framing rather than solution design

**Context injection behavior**
- When `meta-model-summary` context is available (project has existing architecture entities), the LLM should present existing applications and app_components to the user for confirmation rather than asking from scratch
- When `meta-model-summary` context is empty or unavailable (new project with no model), the LLM should guide the user to define applications and app_components conversationally
- The `mission` context provides product alignment as internal reasoning context -- the LLM should not quote or paraphrase it to the user

**Output structure alignment with Phase 0 persistence contract**
The accumulated structured data in the response format must align with the `config_payload` JSONB shape defined in the Phase 0 persistence contract (Increment 2):
- `repos`: array of `{ url: string, branch?: string, includePaths?: string[], excludePaths?: string[] }`
- `repoApplicationMappings`: array of `{ repoUrl: string, path?: string, applicationName: string }`
- `techHints`: array of `{ repoUrl?: string, path?: string, technology: string, language?: string }`
- `exclusions`: array of `{ pattern: string, reason?: string }`
- `notes`: array of free-text strings capturing ambiguities or open items

This structural alignment ensures that when Increment 4 wires persistence, the data can be extracted directly from the conversation's final structured response and passed to `save_discovery_config` without transformation.

### Reusability Opportunities
- The entire chatV2 conversation engine (prompt composer, context resolvers, registry loader, thread store, response validation) is reused as-is with zero code changes
- The architect persona definition is extended by adding one entry to the tasks array -- not duplicated
- The existing `architect.identity.md` prompt is reused without modification
- The section-based responseFormat pattern from `architect--define-architecture` and `architect--define-tech-stack` is the direct structural template for the task JSON
- The accumulating structured data pattern from `architect--detailed-data-model` (logicalDataEntities, physicalDataEntities) and `product-manager--backlog` (proposedFeatures, selectedEpic) is the template for progressive discovery config building in the responseFormat
- The task prompt markdown follows the same style, structure, and rules pattern established in `architect.define-architecture.task.md` and `architect.define-tech-stack.task.md`
- Context resolvers for `mission` and `meta-model-summary` are already implemented as live resolvers -- no new resolver code needed
- The registry loader auto-discovers new JSON files in `gateway/src/config/tasks/` at startup -- no loader changes needed
- The chatV2 route handler processes any registered task generically -- no route handler changes needed
- The frontend renders any persona/task returned by the backend -- no frontend changes needed

### Scope Boundaries

**In Scope:**
- New task definition JSON file: `gateway/src/config/tasks/architect--discovery-framing.json`
- New task prompt markdown file: `gateway/src/config/prompts/architect.discovery-framing.task.md`
- Addition of `"architect--discovery-framing"` to the tasks array in `gateway/src/config/personas/architect.json`
- Structured responseFormat with section-based progression and accumulating discovery config fields aligned to the Phase 0 persistence contract's config_payload shape
- Context needs configuration for mission and meta-model-summary injection
- Hub-level thread persistence and hub+panel availability

**Out of Scope:**
- Persistence of Phase 0 outputs (deferred to Increment 4)
- Phase 0 markdown artifact generation (deferred to Increment 4)
- Tool execution or MCP tool wiring (save_discovery_config is already registered in tool types from Increment 2, but not wired to this task until Increment 4)
- Phase 1 discovery execution or pipeline logic
- Repo scanning, code analysis, or AST logic
- Analyzer packs or analyzer registry integration
- DecisionTask engine
- Evidence schema
- Save-back to canonical architecture model
- Frontend-specific UX changes beyond the existing chat interface
- New identity prompt (reusing existing architect identity)
- Changes to chatV2.ts route handler
- Changes to promptComposer.ts, contextResolvers.ts, registryLoader.ts, or threadStore.ts
- Broader solution architecture topics (CI/CD, deployment environments, authentication, service decomposition, target architecture design)

### Technical Considerations
- **File locations**: Task JSON at `gateway/src/config/tasks/architect--discovery-framing.json`, task prompt at `gateway/src/config/prompts/architect.discovery-framing.task.md`, persona update at `gateway/src/config/personas/architect.json`
- **Zero code changes to engine**: The registry loader, prompt composer, chatV2 route handler, context resolvers, and thread store all operate generically on registered configuration. This increment is purely configuration/content: two new files (task JSON + task prompt) and one line added to the persona's tasks array.
- **Response format complexity**: The responseFormat schema includes both the standard 4 section-based fields and additional accumulating data fields. The chatV2 response validator checks required fields and type conformance -- the schema must be designed so that accumulating fields are not in the `required` array (they start empty/null and are progressively populated). Follow the `architect--detailed-data-model` pattern where only `phase`, `section`, `questions`, `summary` are required, and the accumulating data fields are optional.
- **Task prompt as the primary differentiator**: Since the existing architect identity prompt is reused, the task prompt carries the full responsibility for: (a) positioning the conversation as discovery framing not solution design, (b) defining section progression and question strategy, (c) instructing progressive accumulation of structured data, (d) defining the readiness gate, (e) enforcing JSON-only response rules. This prompt must be comprehensive and self-contained.
- **Meta-model context awareness**: The task prompt must handle two scenarios: (a) the project already has canonical applications/app_components in its meta-model (LLM should present them for confirmation), and (b) the project has no existing model (LLM should guide the user to define anchors from scratch). The prompt must instruct the LLM to check the injected meta-model context and adapt accordingly.
- **Alignment with Increment 4**: The structured data shape accumulated during the conversation must match the `config_payload` JSONB shape exactly so that Increment 4 can extract the data from the final ready-phase response and pass it directly to `save_discovery_config` without transformation. The field names, nesting, and types should be consistent between the responseFormat schema and the persistence contract.
