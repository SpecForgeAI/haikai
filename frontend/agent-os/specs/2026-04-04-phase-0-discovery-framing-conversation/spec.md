# Specification: Phase 0 Discovery Framing Conversation

## Goal
Introduce a new architect task (`architect--discovery-framing`) that conducts a structured, section-based conversation to gather discovery framing inputs -- applications, app_components, repos, technology hints, and exclusions -- before any Phase 1 code scanning occurs, producing structured output aligned with the Phase 0 persistence contract's `config_payload` JSONB shape.

## User Stories
- As a user setting up legacy code discovery, I want to describe my repos, map them to applications, and provide technology hints through a guided conversation so that Phase 1 analyzers receive a well-framed discovery scope.
- As the Phase 0 pipeline, I want the conversation output to match the `config_payload` JSONB shape exactly so that Increment 4 can extract and persist the data without transformation.

## Specific Requirements

**Task definition JSON: `architect--discovery-framing.json`**
- File location: `gateway/src/config/tasks/architect--discovery-framing.json`
- Follow the exact schema used by `architect--define-architecture.json` and `architect--detailed-data-model.json`: `id`, `personaId`, `menuLabel`, `description`, `mode`, `taskPromptRef`, `responseFormat`, `contextNeeds`, `persistence`, `artifacts`, `phases`, `availableFrom`
- `id`: `"architect--discovery-framing"`, `personaId`: `"architect"`, `menuLabel`: `"Discovery Framing"`, `mode`: `"discovery"`
- `taskPromptRef`: `"prompts/architect.discovery-framing.task.md"`
- `contextNeeds`: `["mission", "meta-model-summary"]` -- both resolvers are already live-implemented in `contextResolvers.ts`
- `persistence`: `"hub"`, `availableFrom`: `["hub", "panel"]`, `phases`: `null`, `artifacts`: `[]` (no tool wiring in this increment)

**Response format schema with accumulating structured data**
- `required` array contains only the 4 standard fields: `["phase", "section", "questions", "summary"]` -- accumulating data fields are optional (matching the `architect--detailed-data-model` pattern where `logicalDataEntities`, `physicalDataEntities`, etc. are not in `required`)
- Standard fields: `phase` (enum `["questions", "ready"]`), `section` (enum of the 7 discovery sections), `questions` (array of strings), `summary` (string)
- Accumulating data field `applications`: array of objects with `name` (string) and `description` (string) -- confirmed or proposed application anchor entities
- Accumulating data field `appComponents`: array of objects with `name` (string), `applicationName` (string), `description` (string) -- confirmed or proposed app_component entities mapped to their parent application
- Accumulating data field `repos`: array of objects with `url` (string), `branch` (string), `includePaths` (array of strings), `excludePaths` (array of strings) -- aligned with `config_payload.repos`
- Accumulating data field `repoApplicationMappings`: array of objects with `repoUrl` (string), `path` (string), `applicationName` (string) -- aligned with `config_payload.repoApplicationMappings`
- Accumulating data field `techHints`: array of objects with `repoUrl` (string), `path` (string), `technology` (string), `language` (string) -- aligned with `config_payload.techHints`
- Accumulating data field `exclusions`: array of objects with `pattern` (string), `reason` (string) -- aligned with `config_payload.exclusions`
- Accumulating data field `notes`: array of strings -- free-text ambiguity/open-item notes aligned with `config_payload.notes`

**Discovery framing sections (section enum with 7 values)**
- `context_and_scope` -- understand what is being discovered: which codebases, what the user hopes to learn, the overall discovery objective
- `applications_and_components` -- confirm or define application and app_component anchors; reference existing entities from injected meta-model context rather than asking the user to re-describe them
- `repo_identification` -- gather repo URLs/identifiers, understand branch strategy, determine which branches to scan
- `repo_application_mapping` -- map each repo (or paths within repos) to confirmed applications/app_components
- `technology_hints` -- collect technology and language hints per repo or path to guide Phase 1 analyzers
- `exclusions_and_notes` -- gather paths/patterns to exclude from scanning, ignore rules, and free-text ambiguity notes
- `final_review` -- present a consolidated discovery framing recap; set `phase="ready"` when the user confirms

**Task prompt markdown: `architect.discovery-framing.task.md`**
- File location: `gateway/src/config/prompts/architect.discovery-framing.task.md`
- Follow the same structural pattern as `architect.define-architecture.task.md`: YOUR ROLE, SECTIONS, QUESTION STRATEGY, SECTION PROGRESSION, HANDLING UNCERTAINTY, READINESS GATE, RESPONSE FORMAT, RULES, CONTEXT ALIGNMENT sections
- YOUR ROLE must clearly position this as discovery framing (setup for code scanning), explicitly instructing the LLM to avoid designing target architecture, recommending technology choices, proposing service decompositions, or generating architecture artifacts
- Must instruct the LLM to progressively accumulate the structured discovery config fields in every response, building up `applications`, `appComponents`, `repos`, `repoApplicationMappings`, `techHints`, `exclusions`, `notes` as the conversation progresses
- Must instruct the LLM to check injected META-MODEL SUMMARY context: if existing applications/app_components are present, present them for confirmation rather than asking from scratch; if empty, guide user to define anchors conversationally
- Must instruct the LLM to use MISSION context as internal reasoning only -- do not quote or paraphrase it to the user

**Readiness gate definition**
- All 7 sections visited or explicitly skipped
- At least one repo identified in the `repos` array
- At least one application anchor confirmed or proposed in the `applications` array
- When satisfied: set `phase="ready"`, `section="final_review"`, `questions` to empty array, and include a consolidated discovery framing recap in `summary` enumerating all confirmed repos, applications, mappings, tech hints, and exclusions

**Question strategy**
- Ask 2-4 focused questions per round
- Soft cap of approximately 8 total question rounds
- Keep questions conversational and iterative, not rigid upfront input
- Accept answers at face value without drilling into implementation details -- this is high-level framing, not detailed design
- Handle uncertainty/skip responses gracefully: accept, make reasonable assumptions, move on without blocking section progression

**Context injection behavior**
- When `meta-model-summary` returns existing applications/app_components, the LLM should present them for confirmation in the `applications_and_components` section rather than asking the user to describe them from scratch
- When `meta-model-summary` is empty (new project), the LLM should guide the user to define application and app_component anchors conversationally
- `mission` context provides product alignment as internal reasoning only -- the LLM must not output, quote, or paraphrase it to the user

**Architect persona extension**
- Add `"architect--discovery-framing"` to the `tasks` array in `gateway/src/config/personas/architect.json`
- No other changes to the persona definition; the identity prompt (`architect.identity.md`) is reused without modification

**Response format rules (enforced in task prompt)**
- Respond with ONLY valid JSON -- no markdown, no prose outside the JSON structure
- Include all 4 required fields (`phase`, `section`, `questions`, `summary`) in every response
- Accumulating data fields are optional during `phase="questions"` but should be included and progressively built as information is gathered
- When `phase="ready"`, all accumulating data fields must reflect the final confirmed state
- Do NOT call MCP tools, use tool_calls/function_calls, generate code, or include extra fields beyond those defined in the response format
- `phase` must be exactly `"questions"` or `"ready"`; `section` must be one of the 7 enumerated values

**Structural alignment with Phase 0 persistence contract**
- The field names, nesting, and types of `repos`, `repoApplicationMappings`, `techHints`, `exclusions`, and `notes` in the response format must exactly match the `config_payload` JSONB shape defined in the Phase 0 persistence contract (Increment 2 spec)
- The `applications` and `appComponents` fields are anchor references used for canonical model alignment but are not part of `config_payload` -- they will be handled separately during Increment 4 save wiring

## Visual Design
No visual assets provided for this increment.

## Existing Code to Leverage

**`architect--detailed-data-model.json` accumulating data pattern**
- Located at `gateway/src/config/tasks/architect--detailed-data-model.json`
- Demonstrates how to declare optional accumulating data fields (`logicalDataEntities`, `physicalDataEntities`, `entityMappings`, `dataEntityRelationships`) alongside the 4 required section-based fields in `responseFormat`
- Only `phase`, `section`, `questions`, `summary` are in the `required` array; all accumulating fields are optional properties
- This exact pattern should be replicated for the discovery config's `repos`, `repoApplicationMappings`, `techHints`, `exclusions`, `notes`, `applications`, `appComponents`

**`architect.define-architecture.task.md` prompt structure**
- Located at `gateway/src/config/prompts/architect.define-architecture.task.md`
- Provides the canonical template for section-based task prompts: YOUR ROLE, SECTIONS list with descriptions, QUESTION STRATEGY, SECTION PROGRESSION, HANDLING UNCERTAINTY, READINESS GATE, RESPONSE FORMAT with example JSON, field definitions, RULES list, CONTEXT ALIGNMENT
- The new discovery-framing task prompt should follow this same structure but with discovery-framing-specific content, sections, and rules

**`architect--define-architecture.json` task JSON structure**
- Located at `gateway/src/config/tasks/architect--define-architecture.json`
- Canonical example of the task JSON schema with all required fields: `id`, `personaId`, `menuLabel`, `description`, `mode`, `taskPromptRef`, `responseFormat`, `contextNeeds`, `persistence`, `artifacts`, `phases`, `availableFrom`
- The response format `required` array pattern (`["phase", "section", "questions", "summary"]`) and section enum pattern should be followed exactly

**Context resolvers for `mission` and `meta-model-summary`**
- Located at `gateway/src/services/contextResolvers.ts`
- `MissionContextResolver` reads `MISSION.MD` from the project's `agent-os/product/` folder
- `MetaModelSummaryContextResolver` calls `fetchMetaModelSummary(projectId)` and returns JSON-stringified result containing existing architecture entities (applications, app_components, services, etc.)
- Both resolvers are already live-implemented and registered in `initializeContextResolverRegistry()` -- no new code needed

**Registry auto-discovery (registryLoader + chatV2 route)**
- `gateway/src/services/registryLoader.ts` auto-discovers JSON files in `gateway/src/config/tasks/` and `gateway/src/config/personas/` at startup
- `gateway/src/routes/chatV2.ts` processes any registered task generically using the prompt composer pipeline
- Adding a new JSON task file and updating the persona tasks array is sufficient for the task to be available -- no route handler or loader changes needed

## Out of Scope
- Persistence of Phase 0 outputs to the `discovery_config` table (deferred to Increment 4)
- Phase 0 markdown artifact generation / discovery brief (deferred to Increment 4)
- Tool execution or MCP tool wiring -- `save_discovery_config` is already registered in `gateway/src/types/tools.ts` but is not wired to this task's `artifacts` array until Increment 4
- Phase 1 discovery execution, repo scanning, code analysis, or AST logic
- Analyzer packs or analyzer registry integration
- DecisionTask engine or evidence schema
- Save-back to canonical architecture model (applications/app_components persistence)
- Frontend-specific UX changes beyond the existing chat interface
- New identity prompt or changes to `architect.identity.md`
- Changes to `chatV2.ts` route handler, `promptComposer.ts`, `contextResolvers.ts`, `registryLoader.ts`, or `threadStore.ts`
- Broader solution architecture topics: CI/CD pipelines, deployment environments, authentication, service decomposition, target architecture design
