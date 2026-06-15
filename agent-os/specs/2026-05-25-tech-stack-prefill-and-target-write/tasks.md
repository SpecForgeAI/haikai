# Task Breakdown: Tech-Stack.md Pre-fill + Target-Tech-Stack.md Write

## Overview
Total Tasks: 7 task groups, 52 sub-tasks
Single commit boundary. All LLM mocked at the `ArchitectLlmClient` seam. No AMS schema changes, no Liquibase changesets. Implementing-service Skill update deferred to a follow-up spec.

## Task List

### Backend - Loader Layer

#### Task Group 1: Two-file Tech-Stack Loader + Path Sanitisation Helper
**Dependencies:** None

- [x] 1.0 Complete the two-file tech-stack loader
  - [x] 1.1 Write 4-8 focused tests for the loader
    - File: `gateway/src/services/architectConversation/__tests__/techStackLoader.test.ts`
    - Both files present returns both markdowns + both paths
    - Only org present returns org with `projectMarkdown: null`
    - Only project present returns project with `orgMarkdown: null`
    - Neither present returns both null
    - `project.name` containing `..`, `/`, or `\` rejected with clean loader error
    - Oversized file (>50K chars) truncated, `*Truncated` flag set
    - Lowercase + uppercase filename variants both resolved
    - All AMS calls (`fetchProjectFolder`, `fetchProductName`) mocked
  - [x] 1.2 Create shared `project.name` sanitisation helper
    - File: `gateway/src/services/architectConversation/projectNameSanitiser.ts`
    - Function `sanitiseProjectName(name: string): string` — throws on `..`, `/`, `\`
    - Centralised so loader, writer, and resolver share one implementation
    - Plain-English error messages (no invented acronyms)
  - [x] 1.3 Create `techStackLoader.ts`
    - File: `gateway/src/services/architectConversation/techStackLoader.ts`
    - Signature: `loadTechStackMarkdown(projectId): Promise<{ orgMarkdown, projectMarkdown, orgTruncated, projectTruncated, orgPath, projectPath }>`
    - Org path: `{project_parent_folder}/agent-os/product/tech-stack.md`
    - Project path: `{project_parent_folder}/{sanitised project.name}/agent-os/product/tech-stack.md`
    - Resolve org root via `fetchProjectFolder(projectId)` and `project.name` via `fetchProductName(projectId)` from `architectureModelClient.ts`
    - Case-tolerant filename lookup mirroring `chatV2.ts` / `projectSignals.ts` precedent
    - 50K-char hard cap per file — truncate and set `*Truncated` flag when exceeded
    - No parsing — raw markdown strings only
    - Code comment spelling out audit finding 1 (`project_parent_folder` IS the organisation root)
  - [x] 1.4 Ensure loader tests pass
    - Run ONLY the tests written in 1.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 tests written in 1.1 pass
- `project.name` sanitisation reuses one shared helper across loader/writer/resolver
- 50K-char cap enforced per file with truncation flag
- Case-tolerant filename resolution works for both org and project files
- No AMS schema or endpoint changes

### Backend - LLM Adapter + Pre-fill Layer

#### Task Group 2: Pre-fill LLM Call + Validator + `callSingleShot` Adapter
**Dependencies:** Task Group 1

- [x] 2.0 Complete pre-fill LLM call + validator + new adapter method
  - [x] 2.1 Write 4-8 focused tests for the pre-fill call + validator
    - Files: `gateway/src/services/architectConversation/__tests__/prefillFromTechStack.test.ts` and `.../techStackPrefillResponseValidator.test.ts`
    - Happy path: representative two-file context produces expected matched/unmatched split (LLM mocked)
    - Project-level wins over org-level when both name the same standard (assert prompt construction labels both sections correctly)
    - Validator rejects hallucinated `decisionCode` not in library
    - Validator rejects missing or non-contained `sourceQuote` (whitespace-normalised contains-check across both markdown blobs)
    - Validator rejects duplicate `decisionCode` entries
    - Validator rejects `decisionCode` that appears in both `preFilledAnswers` and `unmatchedCodes`
    - LLM call failure surfaces failure-variant banner signal and writes zero rows
    - All LLM mocked at `callSingleShot` boundary
  - [x] 2.2 Add `ArchitectLlmClient.callSingleShot(prompt, responseSchema)` sibling method
    - File: extend existing `gateway/src/services/architectConversation/ArchitectLlmClient.ts` (or equivalent location)
    - System + user prompt pair returning JSON string
    - No tool-call loop
    - Same mock seam as the existing tool-loop method
    - Throws structured error on LLM call failure (caught by `prefillFromTechStack`)
  - [x] 2.3 Create `techStackPrefillResponseValidator.ts`
    - File: `gateway/src/services/architectConversation/techStackPrefillResponseValidator.ts`
    - Mirror pattern of `migrationDeliverySequencingResponseValidator.ts` (hand-rolled, no JSON-schema library)
    - Rules: every `decisionCode` exists in library and not in `unmatchedCodes`; `value` non-empty; `sourceQuote` non-empty and present in org OR project markdown via whitespace-normalised contains-check; no duplicates
    - Structured warning / error return shape mirroring Spec 4's validator
  - [x] 2.4 Create `prefillFromTechStack.ts`
    - File: `gateway/src/services/architectConversation/prefillFromTechStack.ts`
    - Signature accepts `{ orgMarkdown, projectMarkdown, candidateDecisionCodes, projectName, currentArchitectureId, targetArchitectureId }`
    - Build prompt with labelled sections `## ORGANISATION STANDARDS` and `## PROJECT STANDARDS` (omit absent ones)
    - Filter question library to the supplied candidate codes (auto-skip-relevant only)
    - Include brief project context (name, currentArchitectureId, targetArchitectureId)
    - Prompt rules: strong-connection matching only; bias toward unmatched when in doubt; never hallucinate; extract value verbatim; cite source quote; project-level overrides org-level when both name the same standard
    - Single shot covering all candidate codes (no chunking)
    - Response shape: `{ preFilledAnswers: [{ decisionCode, value, sourceQuote }], unmatchedCodes: string[], summary: string }`
    - Returns failure signal on LLM error or validator failure (caller decides banner variant)
  - [x] 2.5 Ensure pre-fill + validator tests pass
    - Run ONLY the tests written in 2.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 tests written in 2.1 pass
- `callSingleShot` adapter exists with the same mock seam as the tool-loop method
- Validator catches hallucinated codes, missing/uncontained source quotes, and duplicates
- Failure path returns zero rows with failure signal
- Prompt construction explicitly labels org vs project sections

### Backend - Orchestrator Integration

#### Task Group 3: Orchestrator `open` Turn Wiring + Pre-fill Row Writes
**Dependencies:** Task Group 2

- [x] 3.0 Wire the loader + pre-fill into the architect conversation `open` turn
  - [x] 3.1 Write 4-8 focused tests for orchestrator integration
    - File: `gateway/src/services/architectConversation/__tests__/openTurnTechStackPrefill.test.ts` (or extend an existing Spec 3 orchestrator test)
    - Auto-skip runs before pre-fill: pre-fill only sees auto-skip-relevant codes
    - Pre-fill rows POST with `created_by_task = 'tech-stack-md-prefill'`, `scope_kind = 'architecture'`, `standardsLookupRef = null`, `answer_value` JSON-stringified `{ value, sourceQuote }`
    - Pre-fill-matched codes are not re-asked during the conversation
    - Both-files-absent path appends synthetic system turn and routes banner to no-standards variant; LLM not invoked
    - Partial-failure aborts remaining POSTs and merges failed codes into the unmatched list
    - Oversized truncation routes to failure-variant banner with zero rows written
    - All LLM mocked at `callSingleShot` boundary
  - [x] 3.2 Integrate loader + pre-fill into the Spec 3 `open` turn handler
    - Extend existing open-turn orchestration code path (no new endpoint)
    - Sequence after `open` turn appended:
      1. Run auto-skip (existing behaviour) — produce candidate code set
      2. Invoke `loadTechStackMarkdown(projectId)`
      3. If both files absent: append synthetic "no tech standards found" system turn, set banner = no-standards, return
      4. If at least one file present AND not truncated past cap: invoke `prefillFromTechStack` against candidate codes
      5. If truncation OR LLM failure OR validator failure: append synthetic failure system turn carrying reason, set banner = failure, write zero rows
      6. On success: POST each pre-fill row, then append review-banner turn
  - [x] 3.3 POST pre-fill rows via Spec 2's existing endpoint
    - Reuse `targetStateCapturedDecisionsClient.ts.postCapturedDecision` unchanged
    - Per row: `created_by_task = 'tech-stack-md-prefill'`, `standardsLookupRef = null`, `scope_kind = 'architecture'`, `answer_value = JSON.stringify({ value, sourceQuote })`
    - On first POST failure: abort remaining writes, capture failed codes
    - Pre-fill independently checks both files for downstream cascade codes per Q21; do NOT auto-fire the library cascade map from pre-fill matches
  - [x] 3.4 Append review-banner turn to transcript
    - Single cascade-summary-shaped turn (or a new dedicated turn kind — implementer's call) surfacing the pre-fill batch as a reviewable group
    - Reuse `targetStateConversationStore.ts` turn-appending path unchanged
    - Turn payload carries: matched count, denominator (51), banner variant key, source-file presence indicators, partial-failure flag if applicable
    - Source-quote text MUST NOT be embedded in main transcript turn payload (lives only on captured-decision rows for `<SummaryPanel />`)
  - [x] 3.5 Ensure orchestrator integration tests pass
    - Run ONLY the tests written in 3.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 tests written in 3.1 pass
- Auto-skip strictly precedes pre-fill; pre-fill cannot revive an auto-skipped code
- All pre-fill rows carry the correct audit attributes and structured `answer_value`
- Both-files-absent, oversized-truncation, LLM-failure, and partial-failure paths all behave per spec
- No modifications to `targetStateCapturedDecisionsClient.ts` or `targetStateConversationStore.ts`

### Backend - Close-turn Writer + Resolver

#### Task Group 4: Conversation Close — Deterministic Target File Write + New Resolver
**Dependencies:** Task Group 3

- [x] 4.0 Implement deterministic close-turn write + new `target-tech-stack-context` resolver
  - [x] 4.1 Write 4-8 focused tests covering the close write + resolver
    - Files: `gateway/src/services/architectConversation/__tests__/closeTurnTargetTechStackWrite.test.ts` and `gateway/src/config/contextResolvers/__tests__/TargetTechStackContextResolver.test.ts`
    - Close write: file written deterministically at `{project_parent_folder}/{project.name}/agent-os/product/target-tech-stack-<lowercased-uuid>.md`
    - Close write: per-element exceptions appear as their own rows under the right section
    - Close write: write-failure surfaces clean error in close payload without aborting the rest of the close turn
    - Close write: reopen-then-close re-writes the file
    - Close write: `project.name` sanitisation rejects malicious names (`..`, `/`, `\`) at write time
    - Resolver: returns raw markdown when file exists
    - Resolver: returns distinct "no migration target tech stack written yet" message when absent (different from empty / fetch-failed)
    - Resolver: scopes the read via `fetchActiveTargetArchitectureId`; per-invocation cache hits do not re-read
    - Existing `TechStackContextResolver` behaviour unchanged (assertion on absence of edits / behaviour parity)
  - [x] 4.2 Add hardcoded `decision_code → section heading` mapping
    - File: `gateway/src/services/architectConversation/targetTechStackSectionMapping.ts`
    - Map every library decision code to a section heading (Frontend / Backend / Database / Observability / etc) per Q2/Q15 reconciliation
    - Plain-English headings (no invented acronyms)
  - [x] 4.3 Implement deterministic close-turn renderer + writer
    - File: `gateway/src/services/architectConversation/writeTargetTechStackMarkdown.ts`
    - Walks captured-decision rows for the conversation's target architecture
    - Groups rows by section using the mapping from 4.2
    - Emits free-form structured markdown mirroring the source `tech-stack.md` shape
    - Per-element exceptions emit their own rows including element id + exception value (per Spec 3's exception sub-dialog model)
    - Optionally cite each row's source decision code as a markdown comment / footnote so a reader can trace back
    - Path: `{project_parent_folder}/{sanitised project.name}/agent-os/product/target-tech-stack-<targetArchitectureId.toLowerCase()>.md`
    - Reuse `sanitiseProjectName` helper from Task 1.2
    - No LLM call on close (per Q15)
    - On filesystem error: surface clean error on the close-turn payload with path + size omitted; rest of close turn proceeds
    - Close-turn payload gains a new field indicating file written (path + size on success; error reason on failure)
  - [x] 4.4 Hook the writer into the existing Spec 3 `close` turn handler
    - File: existing close-turn orchestration code path
    - Invoke after captured decisions are finalised
    - File only written on close (not on open) per Q16
  - [x] 4.5 Implement `target-tech-stack-context` resolver
    - File: `gateway/src/config/contextResolvers/TargetTechStackContextResolver.ts`
    - Register in `KNOWN_CONTEXT_KEYS` under key `target-tech-stack-context`
    - Mirror Spec 2's resolver pattern using `fetchActiveTargetArchitectureId(projectId)` to pick the migration file
    - Path: `{project_parent_folder}/{sanitised project.name}/agent-os/product/target-tech-stack-<lowercased-uuid>.md`
    - Reuse `sanitiseProjectName` helper from Task 1.2
    - Returns raw markdown on hit; returns distinct "no migration target tech stack written yet" message on miss (distinguishable from empty file and from fetch-failed)
    - Per-invocation cache only (no cross-request cache)
    - Do NOT modify the existing `TechStackContextResolver` (per Follow-up E)
  - [x] 4.6 Ensure close-turn write + resolver tests pass
    - Run ONLY the tests written in 4.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 tests written in 4.1 pass
- Target file always written on close, deterministically, at the project-level path with lowercased UUID
- `project.name` sanitisation applied at write time via the shared helper
- Resolver registered under `target-tech-stack-context`, project-folder-aware, scoped via `fetchActiveTargetArchitectureId`
- Existing `TechStackContextResolver` untouched (file-presence / no-diff assertion)
- No LLM call on close

### Frontend

#### Task Group 5: Frontend Banner + `<SummaryPanel />` Source-quote Display
**Dependencies:** Task Group 3 (banner payload shape established)

- [x] 5.0 Add banner variants + source-quote review affordance
  - [x] 5.1 Write 4-6 focused frontend tests
    - File: `frontend/src/components/architect/__tests__/ArchitectConversationTab.prefillBanner.test.tsx` (or equivalent)
    - Both-files-found variant renders matched count + both filenames
    - One-file-found variant renders only the present source (organisation OR project)
    - No-standards variant renders "all questions will be asked manually" copy
    - Failure variant renders the no-retry failure copy
    - `<SummaryPanel />` review surface lists pre-fills with their source quotes
    - Source-quote isolation test: source-quote text appears in `<SummaryPanel />` props but is NOT present in the main transcript-pane render output (per Q22)
    - All architecture / pending-action / modal-action contexts mocked per project test patterns
  - [x] 5.2 Add banner component to `ArchitectConversationTab.tsx`
    - File: `frontend/src/components/architect/ArchitectConversationTab.tsx`
    - Banner at top of transcript pane (or inline as the first turn after `open`)
    - Five variants:
      - Both files found: `"X of 51 questions pre-filled from your tech standards (organisation: <orgFile>, project: <projFile>)"`
      - Only org found: `"X of 51 pre-filled from your organisation tech standards"`
      - Only project found: `"X of 51 pre-filled from your project tech standards"`
      - Neither found: `"No tech standards found — all questions will be asked manually."`
      - Failure (validator / LLM call / oversized truncation): `"Tech standards loaded but pre-fill could not run — all questions will be asked manually."` (no retry button)
    - Denominator hardcoded to 51 (per Q12)
    - Plain-English copy — no invented acronyms
  - [x] 5.3 Extend existing `<SummaryPanel />` at `ArchitectConversationTab.tsx:628` with per-row source-quote display
    - Only new affordance is per-row source-quote rendering
    - No new modal, no new tab, no new navigation
    - Source-quote rendered ONLY in the SummaryPanel review surface, NEVER in the main transcript pane
  - [x] 5.4 Wire banner state from the new orchestrator turn payload
    - Read variant key + matched count + source-file presence flags from the cascade-summary-shaped turn (or dedicated turn kind) added in Task 3.4
  - [x] 5.5 Ensure frontend tests pass
    - Run ONLY the tests written in 5.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 5.1 pass
- All five banner variants render correct copy
- Source-quote text confirmed absent from main transcript render output and present in `<SummaryPanel />`
- No frontend changes outside the banner + `<SummaryPanel />` extension
- AppShell per-(project, architecture) model cache untouched (no model-state mutations on this path)

### Backend - PM Prompt + Config

#### Task Group 6: PM Book of Work + Shape-Spec Prompt Updates + `contextNeeds` Additions
**Dependencies:** Task Group 4 (resolver registered)

- [x] 6.0 Update PM task prompts + JSON configs to consume the new resolver
  - [x] 6.1 Write 4-8 focused structural-assertion tests
    - File: `gateway/src/config/prompts/__tests__/pmTechStackContextWiring.test.ts`
    - `product-manager.migration-delivery-plan.task.md` contains the new `## Target Tech Stack Context` section heading
    - `product-manager.migration-shape-spec-generation.task.md` contains the new `## Target Tech Stack Context` section heading
    - `product-manager--migration-delivery-plan.json` includes `target-tech-stack-context` in `contextNeeds`
    - `product-manager--migration-shape-spec-generation.json` includes `target-tech-stack-context` in `contextNeeds`
    - Existing rules and existing `contextNeeds` entries unchanged (assertion on prior entries still present)
    - File-presence checks on the new resolver registration
  - [x] 6.2 Update `product-manager.migration-delivery-plan.task.md`
    - File: `gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md`
    - Add `## Target Tech Stack Context` section explaining the new resolver feeds the migration-specific target-state in `tech-stack.md` shape
    - Existing prompt rules unchanged
    - Plain-English prose (no invented acronyms; spell out "Product Manager", "Architecture Model Service", etc)
  - [x] 6.3 Update `product-manager.migration-shape-spec-generation.task.md`
    - File: `gateway/src/config/prompts/product-manager.migration-shape-spec-generation.task.md`
    - Same `## Target Tech Stack Context` section addition
    - Existing rules unchanged
  - [x] 6.4 Update both PM task JSON configs
    - Files: `gateway/src/config/prompts/product-manager--migration-delivery-plan.json` and `gateway/src/config/prompts/product-manager--migration-shape-spec-generation.json` (or equivalent filenames)
    - Append `target-tech-stack-context` to `contextNeeds` array — additive only
    - No other config changes
  - [x] 6.5 Ensure PM config + prompt structural tests pass
    - Run ONLY the tests written in 6.1
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-8 tests written in 6.1 pass
- Both PM prompt files gain the new section heading; existing rules intact
- Both PM JSON configs include the new context key alongside existing entries
- No other PM task orchestration changes

### Verification

#### Task Group 7: Verification + Definition-of-Done Walkthrough
**Dependencies:** Task Groups 1-6

- [x] 7.0 Verify the feature end-to-end against the Definition of Done
  - [x] 7.1 Review existing tests from Task Groups 1-6
    - Loader tests (Task 1.1): approximately 4-8
    - Pre-fill + validator tests (Task 2.1): approximately 4-8
    - Orchestrator integration tests (Task 3.1): approximately 4-8
    - Close-turn write + resolver tests (Task 4.1): approximately 4-8
    - Frontend banner + source-quote isolation tests (Task 5.1): approximately 4-6
    - PM config + prompt structural tests (Task 6.1): approximately 4-8
    - Total existing tests: approximately 24-46 tests
  - [x] 7.2 Identify critical gaps for THIS feature only
    - Focus ONLY on gaps related to this spec's feature requirements
    - Prioritise end-to-end workflow gaps: full open → pre-fill → walk-through → close round trip
    - Do NOT assess application-wide test coverage
    - Skip edge cases, performance, and accessibility tests unless business-critical
  - [x] 7.3 Add up to 10 additional strategic tests if necessary
    - Maximum of 10 new tests across any surface
    - Focus on integration points: pre-fill rows survive in `<SummaryPanel />` correctly, close-turn payload carries the file-written field, resolver returns the just-written file on the next PM task
    - Do NOT write exhaustive coverage
  - [x] 7.4 Run grep sweeps for banned residue
    - No new AMS endpoints (assert no new methods on `architectureModelClient.ts`)
    - No new gateway client methods on `targetStateCapturedDecisionsClient.ts`
    - No Liquibase changeset additions
    - No deletions from `questionLibrary.ts` hardcoded seed maps (`defaultsWhenUnchanged` + `cascades.standardsLookupResult` still present)
    - No modifications to existing `TechStackContextResolver` (file unchanged)
    - No edits under `discovery-service/src/**` (not applicable to this spec)
    - Implementing-service `.claude/skills/global-tech-stack/SKILL.md` NOT modified (deferred follow-up)
  - [x] 7.5 Run feature-specific test sweep
    - Run ONLY tests related to this spec (1.1, 2.1, 3.1, 4.1, 5.1, 6.1, plus any added in 7.3)
    - Expected total: approximately 24-56 tests
    - Do NOT run the entire application test suite
    - Verify pre-existing test failures in project memory remain unmodified (no fix attempts on those)
  - [x] 7.6 Walk through the Definition of Done bullet-by-bullet
    - Open with at least one tech-stack file present: auto-skip first, then pre-fill, then row writes, then review turn — verified
    - Banner renders the correct variant for each of the five cases including the source-quote isolation assertion
    - Pre-filled codes not re-asked; unmatched + partial-failure-promoted codes walked normally
    - User override via Spec 3's revise-prior-answer flow writes `created_by_task = 'architect-persona-conversation'` superseding row
    - Close always writes the project-level target file deterministically with lowercased UUID and `project.name` sanitisation
    - `target-tech-stack-context` resolver registered, scoped via `fetchActiveTargetArchitectureId`, project-folder-aware, with distinct "no migration target tech stack written yet" miss message
    - Both PM task prompts + JSON configs updated
    - Existing `TechStackContextResolver` + `chatV2.ts` unchanged
    - `project.name` sanitisation rejects `..`, `/`, `\` across loader, writer, resolver
    - 50K-char cap routes to failure variant with zero rows
    - No AMS endpoints, no schema changes, no Liquibase changesets, no new gateway client methods
    - Implementing-service Skill update NOT in this commit (deferred)

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 24-56 tests total)
- All Definition-of-Done bullets verified
- No more than 10 additional tests added in 7.3 when filling critical gaps
- Grep sweeps confirm no banned residue
- Pre-existing test failures listed in project memory remain unmodified

## Execution Order

Recommended implementation sequence:
1. Task Group 1 — Loader + path sanitisation helper (no dependencies)
2. Task Group 2 — Pre-fill LLM call + validator + `callSingleShot` adapter
3. Task Group 3 — Orchestrator `open` turn integration + pre-fill row writes
4. Task Group 4 — Close-turn deterministic writer + new resolver
5. Task Group 5 — Frontend banner + `<SummaryPanel />` source-quote display (after the orchestrator's turn payload shape is established)
6. Task Group 6 — PM prompt + config additions (after the resolver is registered)
7. Task Group 7 — End-to-end verification + Definition-of-Done walkthrough

All work ships in a single commit.
