# Task Breakdown: Phase 0 Discovery Framing Conversation

## Overview
Total Tasks: 3 task groups, 14 sub-tasks

This is Increment 3 of 16 -- a pure configuration/content increment requiring exactly 2 new files and 1 line change. No code changes to the gateway engine, frontend, or any other service. The deliverables are:

1. A new task definition JSON file
2. A new task prompt markdown file
3. One entry added to the architect persona's tasks array

## Task List

### Configuration Layer

#### Task Group 1: Task Definition JSON
**Dependencies:** None

- [x] 1.0 Create the task definition JSON file
  - [x] 1.1 Create `gateway/src/config/tasks/architect--discovery-framing.json` using `architect--detailed-data-model.json` as the primary template
    - Copy the structure from `gateway/src/config/tasks/architect--detailed-data-model.json` (the closest pattern match: section-based discovery with accumulating data fields)
    - Set top-level fields:
      - `id`: `"architect--discovery-framing"`
      - `personaId`: `"architect"`
      - `menuLabel`: `"Discovery Framing"`
      - `description`: A concise description of the discovery framing conversation purpose
      - `mode`: `"discovery"`
      - `taskPromptRef`: `"prompts/architect.discovery-framing.task.md"`
      - `contextNeeds`: `["mission", "meta-model-summary"]`
      - `persistence`: `"hub"`
      - `artifacts`: `[]` (empty -- no tool wiring until Increment 4)
      - `phases`: `null`
      - `availableFrom`: `["hub", "panel"]`
  - [x] 1.2 Define the `responseFormat` object with standard required fields
    - `type`: `"object"`
    - `required`: `["phase", "section", "questions", "summary"]` (only the 4 standard fields -- accumulating data fields are NOT in required, matching the `architect--detailed-data-model.json` pattern)
    - `properties.phase`: `{ "type": "string", "enum": ["questions", "ready"] }`
    - `properties.section`: `{ "type": "string", "enum": ["context_and_scope", "applications_and_components", "repo_identification", "repo_application_mapping", "technology_hints", "exclusions_and_notes", "final_review"] }`
    - `properties.questions`: `{ "type": "array", "items": { "type": "string" } }`
    - `properties.summary`: `{ "type": "string" }`
  - [x] 1.3 Define the accumulating data fields in `responseFormat.properties` (all optional, NOT in `required` array)
    - `applications`: array of objects with properties `name` (string) and `description` (string)
    - `appComponents`: array of objects with properties `name` (string), `applicationName` (string), `description` (string)
    - `repos`: array of objects with properties `url` (string), `branch` (string), `includePaths` (array of strings), `excludePaths` (array of strings)
    - `repoApplicationMappings`: array of objects with properties `repoUrl` (string), `path` (string), `applicationName` (string)
    - `techHints`: array of objects with properties `repoUrl` (string), `path` (string), `technology` (string), `language` (string)
    - `exclusions`: array of objects with properties `pattern` (string), `reason` (string)
    - `notes`: `{ "type": "array", "items": { "type": "string" } }`
  - [x] 1.4 Verify JSON validity and schema correctness
    - Parse the file with `node -e "console.log(JSON.stringify(require('./gateway/src/config/tasks/architect--discovery-framing.json'), null, 2))"` to confirm valid JSON
    - Confirm `required` array contains exactly `["phase", "section", "questions", "summary"]`
    - Confirm section enum contains exactly 7 values matching the spec
    - Confirm all accumulating field names match the `config_payload` JSONB shape from the Phase 0 persistence contract: `repos`, `repoApplicationMappings`, `techHints`, `exclusions`, `notes`
    - Confirm `applications` and `appComponents` are present as anchor reference fields

**Acceptance Criteria:**
- File exists at `gateway/src/config/tasks/architect--discovery-framing.json`
- JSON is valid and parseable
- All top-level task fields match the spec exactly (`id`, `personaId`, `menuLabel`, `mode`, `taskPromptRef`, `contextNeeds`, `persistence`, `artifacts`, `phases`, `availableFrom`)
- `responseFormat` has the 4 standard required fields plus 7 optional accumulating data fields
- Section enum has exactly 7 values: `context_and_scope`, `applications_and_components`, `repo_identification`, `repo_application_mapping`, `technology_hints`, `exclusions_and_notes`, `final_review`
- Field names and types for `repos`, `repoApplicationMappings`, `techHints`, `exclusions`, `notes` align exactly with the Phase 0 persistence contract's `config_payload` shape

---

#### Task Group 2: Task Prompt Markdown
**Dependencies:** Task Group 1 (the prompt must reference the same section enum and field names defined in the JSON)

- [x] 2.0 Create the task prompt markdown file
  - [x] 2.1 Create `gateway/src/config/prompts/architect.discovery-framing.task.md` using `architect.define-architecture.task.md` as the structural template
    - Follow the same section ordering as the template: YOUR ROLE, SECTIONS, QUESTION STRATEGY, SECTION PROGRESSION, HANDLING UNCERTAINTY, READINESS GATE, RESPONSE FORMAT, RULES, CONTEXT ALIGNMENT
    - Reference `architect.detailed-data-model.task.md` for the accumulating data field documentation pattern in the RESPONSE FORMAT section
  - [x] 2.2 Write the YOUR ROLE section
    - Position the role as discovery framing facilitator (setup for legacy code scanning), NOT solution architecture design
    - Explicitly instruct the LLM to avoid: designing target architecture, recommending technology choices, proposing service decompositions, generating architecture artifacts, or discussing CI/CD / deployment / authentication topics
    - Frame the purpose: gather structured inputs (applications, app_components, repos, technology hints, exclusions) to scope Phase 1 code scanning
  - [x] 2.3 Write the DISCOVERY FRAMING SECTIONS section
    - Define all 7 sections with numbered descriptions matching the spec:
      - 0. `context_and_scope` -- understand what is being discovered: which codebases, what the user hopes to learn, the overall discovery objective
      - 1. `applications_and_components` -- confirm or define application and app_component anchors; reference existing entities from injected meta-model context rather than asking the user to re-describe them
      - 2. `repo_identification` -- gather repo URLs/identifiers, understand branch strategy, determine which branches to scan
      - 3. `repo_application_mapping` -- map each repo (or paths within repos) to confirmed applications/app_components
      - 4. `technology_hints` -- collect technology and language hints per repo or path to guide Phase 1 analyzers
      - 5. `exclusions_and_notes` -- gather paths/patterns to exclude from scanning, ignore rules, and free-text ambiguity notes
      - 6. `final_review` -- present a consolidated discovery framing recap; set phase="ready" when the user confirms
  - [x] 2.4 Write the QUESTION STRATEGY section
    - 2-4 focused questions per round
    - Soft cap of approximately 8 total question rounds
    - Keep questions conversational and iterative, not rigid upfront input
    - Accept answers at face value without drilling into implementation details -- this is high-level framing, not detailed design
  - [x] 2.5 Write the SECTION PROGRESSION section
    - Define the expected section order: `context_and_scope` -> `applications_and_components` -> `repo_identification` -> `repo_application_mapping` -> `technology_hints` -> `exclusions_and_notes` -> `final_review`
    - Must reach `final_review` before setting `phase="ready"`
  - [x] 2.6 Write the HANDLING UNCERTAINTY section
    - Follow the same pattern from `architect.define-architecture.task.md`: accept skip/unknown gracefully, make reasonable assumptions, move on, never block section progression
  - [x] 2.7 Write the META-MODEL CONTEXT AWARENESS section
    - Instruct the LLM to check injected META-MODEL SUMMARY context
    - When existing applications/app_components are present: present them for confirmation in the `applications_and_components` section rather than asking from scratch
    - When empty (new project): guide user to define anchors conversationally
  - [x] 2.8 Write the READINESS GATE section
    - All 7 sections visited or explicitly skipped
    - At least one repo identified in the `repos` array
    - At least one application anchor confirmed or proposed in the `applications` array
    - When satisfied: set `phase="ready"`, `section="final_review"`, `questions` to empty array
    - Include a consolidated discovery framing recap in `summary` enumerating all confirmed repos, applications, mappings, tech hints, and exclusions
  - [x] 2.9 Write the RESPONSE FORMAT section with example JSON and field definitions
    - Include an example JSON showing all fields (4 required + 7 accumulating data fields)
    - Document each field: phase, section, questions, summary (required in every response), plus applications, appComponents, repos, repoApplicationMappings, techHints, exclusions, notes (optional during questions, required-populated when ready)
    - Follow the pattern from `architect.detailed-data-model.task.md` lines 157-183 for how to document optional accumulating fields
  - [x] 2.10 Write the RULES section
    - Respond with ONLY valid JSON -- no markdown, no prose outside JSON
    - phase must be exactly "questions" or "ready"
    - section must be one of the 7 enumerated values
    - Include all 4 required fields in every response
    - Do NOT call MCP tools, use tool_calls/function_calls, generate code, or include extra fields
    - Do NOT design target architecture, recommend technology choices, or propose service decompositions
    - When phase is "ready", questions array must be empty
    - When phase is "questions", questions array must be non-empty
    - summary must always be present and non-empty
    - Do not repeat questions already answered
    - Progressively accumulate structured data fields as information is gathered
  - [x] 2.11 Write the CONTEXT ALIGNMENT section
    - MISSION context: use as internal reasoning only -- do NOT output, quote, or paraphrase it to the user
    - META-MODEL SUMMARY context: use to reference existing canonical entities (applications, app_components) -- present for confirmation rather than asking from scratch

**Acceptance Criteria:**
- File exists at `gateway/src/config/prompts/architect.discovery-framing.task.md`
- Contains all required sections: YOUR ROLE, SECTIONS, QUESTION STRATEGY, SECTION PROGRESSION, HANDLING UNCERTAINTY, META-MODEL CONTEXT AWARENESS, READINESS GATE, RESPONSE FORMAT, RULES, CONTEXT ALIGNMENT
- YOUR ROLE clearly positions this as discovery framing, not solution architecture
- Section enum values in the prompt match the JSON definition exactly (7 values)
- Accumulating field names in the RESPONSE FORMAT match the JSON definition exactly
- READINESS GATE requires at least one repo and at least one application
- RULES prohibit tool calls, code generation, architecture design, and extra fields
- CONTEXT ALIGNMENT covers both mission (internal only) and meta-model-summary (present for confirmation)

---

### Persona Registration

#### Task Group 3: Architect Persona Update and End-to-End Verification
**Dependencies:** Task Groups 1 and 2

- [x] 3.0 Register the new task with the architect persona and verify the full configuration
  - [x] 3.1 Add `"architect--discovery-framing"` to the `tasks` array in `gateway/src/config/personas/architect.json`
    - Add as the first entry in the array (discovery framing logically precedes architecture definition)
    - Resulting tasks array should be: `["architect--discovery-framing", "architect--tech-standards", "architect--define-architecture", "architect--detailed-data-model", "architect--service-breakdown", "architect--oas-spec", "architect--generate-architecture-diagram"]`
    - Alternatively, add at the end if position is not specified -- the key requirement is that the entry is present
  - [x] 3.2 Verify JSON validity of the updated `architect.json`
    - Parse with `node -e "console.log(JSON.stringify(require('./gateway/src/config/personas/architect.json'), null, 2))"` to confirm valid JSON after edit
  - [x] 3.3 Run cross-file consistency checks
    - Confirm the task ID in `architect--discovery-framing.json` (`"architect--discovery-framing"`) matches the entry added to `architect.json`
    - Confirm the `personaId` in the task JSON (`"architect"`) matches the persona's `id` in `architect.json`
    - Confirm the `taskPromptRef` in the task JSON (`"prompts/architect.discovery-framing.task.md"`) points to the file created in Task Group 2
    - Confirm the `contextNeeds` array references only resolvers that exist: `"mission"` and `"meta-model-summary"` (both registered in `gateway/src/services/contextResolvers.ts`)

**Acceptance Criteria:**
- `gateway/src/config/personas/architect.json` contains `"architect--discovery-framing"` in its `tasks` array
- The persona JSON remains valid after the edit
- All cross-references are consistent: task ID matches persona entry, personaId matches persona file, taskPromptRef points to existing prompt file
- No other files were modified (no changes to chatV2.ts, registryLoader.ts, promptComposer.ts, contextResolvers.ts, or any other engine file)
- The registry loader will auto-discover the new task JSON at startup with no code changes

## Execution Order

Recommended implementation sequence:
1. **Task Group 1: Task Definition JSON** -- Create the task JSON first because it defines the canonical field names, section enum, and response format schema that the prompt must reference.
2. **Task Group 2: Task Prompt Markdown** -- Write the prompt using the section enum and field names established in the JSON. This is the largest deliverable and carries the most content.
3. **Task Group 3: Persona Registration and Verification** -- Wire the task into the architect persona and verify all cross-references. This is the final step because it makes the task discoverable by the registry loader.

## Files Modified/Created Summary

| Action  | File Path |
|---------|-----------|
| CREATE  | `gateway/src/config/tasks/architect--discovery-framing.json` |
| CREATE  | `gateway/src/config/prompts/architect.discovery-framing.task.md` |
| MODIFY  | `gateway/src/config/personas/architect.json` (add 1 entry to tasks array) |

## Key Template References

| Template File | What to Reuse |
|---------------|---------------|
| `gateway/src/config/tasks/architect--detailed-data-model.json` | Accumulating data fields pattern (optional fields outside `required` array) |
| `gateway/src/config/tasks/architect--define-architecture.json` | Top-level task JSON schema and standard section-based responseFormat |
| `gateway/src/config/prompts/architect.define-architecture.task.md` | Prompt section structure (YOUR ROLE, SECTIONS, QUESTION STRATEGY, etc.) |
| `gateway/src/config/prompts/architect.detailed-data-model.task.md` | Accumulating field documentation in RESPONSE FORMAT section |
| `gateway/src/config/personas/architect.json` | Tasks array to extend |
