# Task Breakdown: Hypothesis-First Discovery Q&A with Users

## Overview
Total Tasks: 6 Task Groups, ~38 sub-tasks

This is Increment 15 of 16 for the legacy/current-state discovery capability. It introduces a hypothesis-first validation loop that identifies weak or ambiguous discovery results after Phase 1d, generates targeted questions for the user via the existing chat/persona system, captures structured answers as `human_qa` evidence, and automatically applies non-destructive refinements to confidence scores, clusters, and candidates.

## Task List

### Discovery Service -- Types and Constants

#### Task Group 1: Hypothesis Data Model and QA Constants
**Dependencies:** None

- [x] 1.0 Complete hypothesis types and QA constants
  - [x] 1.1 Write 4-6 focused tests for hypothesis types and constants
    - Test that `Hypothesis` interface fields are correctly typed (category enum, status enum, subjectType enum)
    - Test that `HypothesisAnswer` interface fields are correctly typed (verdict enum matches status enum excluding `pending`)
    - Test that `QaOrigin` interface has required fields (`hypothesisId`, `verdict`, `freeTextNotes`, `answeredAt`)
    - Test QA constants values: `QA_CONFIRMATION_CONFIDENCE_BOOST`, `QA_DENIAL_CONFIDENCE_PENALTY`, and that `LOG_MAX_CONFIDENCE_CAP` is reused (not duplicated)
    - Test that the extended `EvidenceAtom.source` union accepts `'human_qa'` alongside `'code'` and `'log'`
  - [x] 1.2 Create `Hypothesis` interface in `discovery-service/src/types/hypothesis.ts`
    - Fields: `id` (string/UUID), `runId` (string), `category` (enum: `low_confidence`, `ambiguous_type`, `conflicting_evidence`, `missing_attribute`, `weak_cluster`), `subjectType` (`candidate` | `cluster`), `subjectId` (string), `description` (string), `evidenceRefs` (string array of atom/relationship/cluster IDs), `status` (`pending` | `confirmed` | `denied` | `partially_confirmed` | `needs_more_info`), `createdAt` (string)
    - Export `HypothesisCategory` and `HypothesisStatus` as union types for reuse
  - [x] 1.3 Create `HypothesisAnswer` interface in `discovery-service/src/types/hypothesis.ts`
    - Fields: `hypothesisId` (string), `verdict` (`confirmed` | `denied` | `partially_confirmed` | `needs_more_info`), `freeTextNotes` (optional string), `answeredAt` (string)
    - Export `HypothesisVerdict` as a union type (matches `HypothesisStatus` excluding `pending`)
  - [x] 1.4 Create `QaOrigin` interface in `discovery-service/src/types/evidenceAtom.ts`
    - Fields: `hypothesisId` (string), `verdict` (string), `freeTextNotes` (optional string), `answeredAt` (string)
    - Follow the pattern of the existing `LogOrigin` interface in the same file
  - [x] 1.5 Extend `EvidenceAtom` interface in `discovery-service/src/types/evidenceAtom.ts`
    - Extend `source` union from `'code' | 'log'` to `'code' | 'log' | 'human_qa'`
    - Add optional `qaOrigin?: QaOrigin` field parallel to the existing `logOrigin?: LogOrigin`
    - Update JSDoc comments to document the new source value and field
  - [x] 1.6 Create `discovery-service/src/constants/hypothesisQaDefaults.ts`
    - Define `QA_CONFIRMATION_CONFIDENCE_BOOST` (e.g., 0.12 -- slightly higher than `LOG_CORROBORATION_CONFIDENCE_BOOST` of 0.10 since human confirmation is stronger signal)
    - Define `QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST` (e.g., 0.05 -- smaller than full confirmation)
    - Define `QA_DENIAL_CONFIDENCE_PENALTY` (e.g., 0.20 -- configurable decrement)
    - Import and reuse `LOG_MAX_CONFIDENCE_CAP` from `logEnrichmentDefaults.ts` (do not redefine)
    - Follow the documentation style of `discovery-service/src/constants/logEnrichmentDefaults.ts`
  - [x] 1.7 Export new types from `discovery-service/src/types/index.ts` barrel
    - Add exports for `Hypothesis`, `HypothesisAnswer`, `HypothesisCategory`, `HypothesisStatus`, `HypothesisVerdict`, `QaOrigin`
  - [x] 1.8 Ensure type and constant tests pass
    - Run ONLY the 4-6 tests written in 1.1
    - Verify TypeScript compilation succeeds with the new types
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 1.1 pass
- `Hypothesis` and `HypothesisAnswer` interfaces compile and export correctly
- `EvidenceAtom.source` union includes `'human_qa'` without breaking existing `'code'` and `'log'` usage
- `QaOrigin` interface mirrors `LogOrigin` pattern
- QA constants are defined in a dedicated file paralleling `logEnrichmentDefaults.ts`
- Barrel export exposes all new types

---

### Discovery Service -- Hypothesis Generation Engine

#### Task Group 2: Rule-Based Hypothesis Generation
**Dependencies:** Task Group 1

- [x] 2.0 Complete hypothesis generation engine
  - [x] 2.1 Write 6-8 focused tests for hypothesis generation rules
    - Test low-confidence rule: produces hypothesis for candidates below `CANDIDATE_AUTO_ACCEPT_THRESHOLD`
    - Test ambiguous-type rule: produces hypothesis for clusters with `clusterType: 'unknown'`
    - Test conflicting-evidence rule: produces hypothesis when a candidate has both code-sourced and log-sourced atoms that disagree (e.g., different names or types inferred)
    - Test missing-attribute rule: produces hypothesis when candidate `data` payload is missing critical attributes (e.g., empty name, no description)
    - Test weak-cluster rule: produces hypothesis for low-confidence clusters
    - Test that each rule returns zero hypotheses when conditions are not met (no false positives)
    - Test that generated hypotheses have correct `runId`, `subjectType`, `subjectId`, and `evidenceRefs` populated
    - Test that hypotheses are persisted correctly into `steps_payload` structure
  - [x] 2.2 Create hypothesis generation engine in `discovery-service/src/services/hypothesisGenerationEngine.ts`
    - Main function `generateHypotheses(runId, candidates, clusters, atoms, relationships)` returns `Hypothesis[]`
    - Loads all candidates, clusters, and evidence atoms for the given run
    - Iterates over a set of deterministic rule functions, each receiving the full dataset
    - Each rule function returns `Hypothesis[]` (zero or more)
    - Aggregates all hypothesis results and assigns UUIDs
    - No LLM calls -- strictly deterministic rule evaluation
  - [x] 2.3 Implement individual hypothesis rules as functions within the engine
    - `checkLowConfidenceCandidates`: flag candidates with `confidence < CANDIDATE_AUTO_ACCEPT_THRESHOLD`
    - `checkAmbiguousClusterTypes`: flag clusters with `clusterType === 'unknown'`
    - `checkConflictingEvidence`: flag candidates whose source clusters contain atoms from different sources (code vs log) with conflicting implications
    - `checkMissingAttributes`: flag candidates with empty or missing critical fields in `data` payload
    - `checkWeakClusters`: flag clusters with confidence below a threshold (reuse `CANDIDATE_AMBIGUOUS_THRESHOLD`)
    - Each rule creates `Hypothesis` objects with appropriate `category`, `description`, and `evidenceRefs`
  - [x] 2.4 Implement hypothesis persistence into `steps_payload`
    - Add hypotheses array to `steps_payload` under a `hypothesisQa` key (e.g., `steps_payload.hypothesisQa.hypotheses`)
    - Use `archModelClient.updateDiscoveryRun` with the updated `steps_payload`
    - Follow the existing pattern used by other step results in `runManager.ts`
  - [x] 2.5 Ensure hypothesis generation tests pass
    - Run ONLY the 6-8 tests written in 2.1
    - Verify all rule functions produce correct hypotheses for matching inputs
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 2.1 pass
- All five rule categories produce correct hypotheses when conditions are met
- Rules return empty arrays when conditions are not met
- Hypotheses include correct `evidenceRefs` linking to source atom/cluster/relationship IDs
- Hypotheses are correctly persisted to `steps_payload.hypothesisQa.hypotheses`

---

### Discovery Service -- Question Generation and Refinement

#### Task Group 3: Question Batching, Answer Capture, and Confidence Refinement
**Dependencies:** Task Group 2

- [x] 3.0 Complete question generation, answer capture, and refinement logic
  - [x] 3.1 Write 6-8 focused tests for question batching, answer capture, and refinement
    - Test question batching groups related hypotheses (same cluster, same category) into batches of 2-4
    - Test question batch output includes hypothesis description, evidence summary, and answer options
    - Test that `confirmed` verdict applies `QA_CONFIRMATION_CONFIDENCE_BOOST` additive boost to candidate confidence, capped at `LOG_MAX_CONFIDENCE_CAP`
    - Test that `denied` verdict applies `QA_DENIAL_CONFIDENCE_PENALTY` decrement and sets candidate status to `pending_review`
    - Test that `partially_confirmed` verdict applies `QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST` and annotates candidate `data` with notes
    - Test that `needs_more_info` verdict makes no confidence change and hypothesis remains `pending`
    - Test that `human_qa` evidence atoms are correctly created from answers with `qaOrigin` populated
    - Test that refinement operations are recorded in `steps_payload` for traceability
  - [x] 3.2 Create question batch generator in `discovery-service/src/services/questionBatchGenerator.ts`
    - Function `generateQuestionBatches(hypotheses: Hypothesis[])` returns array of question batch objects
    - Groups related hypotheses together: all `low_confidence` candidates from the same cluster, all `ambiguous_type` items, etc.
    - Each batch contains 2-4 questions maximum
    - Each question includes: hypothesis ID, hypothesis description, short evidence summary (which atoms/sources contributed), and expected answer options (confirm / deny / partially confirm / need more info)
    - Output is structured context ready for the discovery-QA task prompt
  - [x] 3.3 Create answer capture and evidence atom creation in `discovery-service/src/services/hypothesisAnswerProcessor.ts`
    - Function `processAnswers(runId, answers: HypothesisAnswer[], hypotheses: Hypothesis[])` returns created `EvidenceAtom[]`
    - For each answer, creates a `human_qa` evidence atom with: `source: 'human_qa'`, `qaOrigin` populated from the answer, `runId`, `repoUrl` from the original hypothesis subject, type set to `string_pattern` (with descriptive data payload)
    - Persists atoms via `archModelClient.bulkSaveEvidence`
    - Stores `HypothesisAnswer` objects within `steps_payload.hypothesisQa.answers`
    - Updates hypothesis status from `pending` to the answer's verdict
  - [x] 3.4 Create refinement engine in `discovery-service/src/services/hypothesisRefinementEngine.ts`
    - Function `applyRefinements(runId, answers: HypothesisAnswer[], hypotheses: Hypothesis[], candidates, clusters)` returns refinement summary
    - `confirmed`: additive boost using `QA_CONFIRMATION_CONFIDENCE_BOOST`, capped at `LOG_MAX_CONFIDENCE_CAP`; update candidate via `archModelClient.updateCandidate`
    - `denied`: subtract `QA_DENIAL_CONFIDENCE_PENALTY` (floor at 0.0); set candidate `status` to `pending_review`; update via `archModelClient.updateCandidate`
    - `partially_confirmed`: apply `QA_PARTIAL_CONFIRMATION_CONFIDENCE_BOOST`; annotate candidate `data` with partial confirmation notes
    - `needs_more_info`: no confidence change; hypothesis stays open
    - Record all refinement operations (which hypothesis drove which confidence change) in `steps_payload.hypothesisQa.refinements`
    - All modifications are non-destructive to canonical model entities -- only discovery run candidates and clusters are modified
  - [x] 3.5 Ensure question generation, answer capture, and refinement tests pass
    - Run ONLY the 6-8 tests written in 3.1
    - Verify question batching, answer processing, and all four verdict refinement paths
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 6-8 tests written in 3.1 pass
- Question batches group related hypotheses with 2-4 items per batch
- All four verdict types produce correct confidence adjustments
- `human_qa` evidence atoms are created with correct `qaOrigin` metadata
- Refinement operations are recorded in `steps_payload` for traceability
- No canonical model entities are modified (only discovery run candidates/clusters)

---

### Discovery Service -- Routes

#### Task Group 4: Hypothesis Q&A Route Endpoints
**Dependencies:** Task Groups 2 and 3

- [x] 4.0 Complete hypothesis Q&A route
  - [x] 4.1 Write 4-6 focused tests for hypothesis Q&A route endpoints
    - Test `POST /discovery/hypothesis-qa/generate` returns 400 if required fields (`projectId`, `runId`) are missing
    - Test `POST /discovery/hypothesis-qa/generate` returns 400/404 if run does not exist or is not COMPLETED
    - Test `POST /discovery/hypothesis-qa/generate` succeeds and returns hypothesis summary for a valid completed run
    - Test `POST /discovery/hypothesis-qa/refine` returns 400 if required fields are missing
    - Test `POST /discovery/hypothesis-qa/refine` succeeds, applies refinements, and returns refinement summary
    - Test that generate endpoint persists hypotheses to `steps_payload` and refine endpoint updates candidate confidence
  - [x] 4.2 Create route file `discovery-service/src/routes/hypothesisQa.ts`
    - Create Express Router with two endpoints
    - `POST /generate`: accepts `{ projectId, runId }` body; validates run exists via `archModelClient.getDiscoveryRun` and is COMPLETED; loads candidates, clusters, atoms via `archModelClient.getCandidatesByRun`, `getClustersByRun`, `getEvidenceByRun`; calls `generateHypotheses`; persists to `steps_payload`; returns `{ hypothesisCount, categoryCounts, hypotheses }` summary
    - `POST /refine`: accepts `{ projectId, runId, answers }` body; validates run exists; reads hypotheses from `steps_payload`; calls `processAnswers` to create evidence atoms and store answers; calls `applyRefinements` to update candidates/clusters; returns `{ refinementsApplied, confidenceChanges, atomsCreated }` summary
    - Follow error handling patterns from `discovery-service/src/routes/logEnrichment.ts`
  - [x] 4.3 Mount the new router in `discovery-service/src/routes/index.ts`
    - Import `hypothesisQaRouter` from `./hypothesisQa`
    - Mount at `/hypothesis-qa`: `discoveryRouter.use('/hypothesis-qa', hypothesisQaRouter)`
    - Add comment: `// Spec 2026-04-06: Hypothesis-First Discovery Q&A (Increment 15)`
  - [x] 4.4 Ensure route tests pass
    - Run ONLY the 4-6 tests written in 4.1
    - Verify both endpoints respond correctly for valid and invalid inputs
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 4-6 tests written in 4.1 pass
- `POST /generate` validates run status and returns hypothesis summary
- `POST /refine` processes answers, creates evidence atoms, applies refinements, and returns summary
- Route is mounted at `/discovery/hypothesis-qa` alongside existing routes
- Error responses follow existing patterns (400, 404 with descriptive messages)

---

### Gateway -- Task Definition and Prompt

#### Task Group 5: Architect Discovery-QA Task and Prompt
**Dependencies:** None (can run in parallel with Task Groups 1-4)

- [x] 5.0 Complete Architect discovery-QA task configuration
  - [x] 5.1 Write 3-4 focused tests for task definition and persona registration
    - Test that `architect--discovery-qa.json` is valid JSON and contains all required fields (`id`, `personaId`, `mode`, `taskPromptRef`, `responseFormat`, `contextNeeds`, `persistence`, `availableFrom`)
    - Test that `responseFormat` schema includes `phase` (enum: `questions`, `done`), `verdicts` (array of `{ hypothesisId, verdict, notes }`), and `summary` fields
    - Test that `architect.json` persona tasks array includes `"architect--discovery-qa"`
    - Test that prompt file `architect.discovery-qa.task.md` exists and is non-empty
  - [x] 5.2 Create task definition `gateway/src/config/tasks/architect--discovery-qa.json`
    - `"id": "architect--discovery-qa"`
    - `"personaId": "architect"`
    - `"menuLabel": "Discovery Q&A"` (or similar descriptive label)
    - `"description"`: Describes the hypothesis validation Q&A loop
    - `"mode": "discovery"` (matching discovery-framing)
    - `"taskPromptRef": "prompts/architect.discovery-qa.task.md"`
    - `"responseFormat"`: JSON schema with `phase` (enum: `questions`, `done`), `verdicts` (array of objects with `hypothesisId`, `verdict`, `notes`), `summary` (string), `questions` (array of strings)
    - `"contextNeeds": ["discovery-run-id", "project-id"]` (so prompt can load hypothesis data)
    - `"persistence": "hub"` (matching discovery-framing)
    - `"artifacts"`: appropriate artifact definition for Q&A results if needed, or empty array
    - `"phases": null`
    - `"availableFrom": ["hub"]` (system-initiated, not user-browsable from the panel)
  - [x] 5.3 Create prompt file `gateway/src/config/prompts/architect.discovery-qa.task.md`
    - Follow the structure of `architect.discovery-framing.task.md`
    - YOUR ROLE section: Architect persona presenting hypotheses with evidence summaries, asking user to validate
    - HYPOTHESIS PRESENTATION section: for each hypothesis, show description, category, evidence summary, answer options
    - QUESTION STRATEGY section: 2-4 questions per round, grouped by related hypotheses; conversational tone
    - HANDLING UNCERTAINTY section: accept skip/unknown/pass answers; do not pressure; mark as `needs_more_info`
    - READINESS GATE section: set `phase: "done"` when all hypotheses resolved OR user signals they want to stop
    - RESPONSE FORMAT section: JSON-only matching the task's `responseFormat` schema; include example
    - RULES section: respond with only valid JSON; no markdown outside JSON; handle all verdict types
  - [x] 5.4 Register new task in `gateway/src/config/personas/architect.json`
    - Add `"architect--discovery-qa"` to the `tasks` array
    - Place it after `"architect--discovery-framing"` in the array for logical ordering
  - [x] 5.5 Ensure task configuration tests pass
    - Run ONLY the 3-4 tests written in 5.1
    - Verify JSON validity, schema correctness, persona registration, and prompt file presence
    - Do NOT run the entire test suite at this stage

**Acceptance Criteria:**
- The 3-4 tests written in 5.1 pass
- Task JSON file follows the exact pattern of `architect--discovery-framing.json`
- Prompt file provides clear instructions for hypothesis presentation and verdict collection
- `responseFormat` captures per-hypothesis verdicts with `hypothesisId`, `verdict`, and `notes`
- Task is registered in the Architect persona's task list
- `availableFrom` is set to `["hub"]` (system-initiated)

---

### Test Review and Integration

#### Task Group 6: Test Review, Gap Analysis, and Integration Verification
**Dependencies:** Task Groups 1-5

- [x] 6.0 Review existing tests and fill critical gaps only
  - [x] 6.1 Review tests from Task Groups 1-5
    - Review the 4-6 tests from Task Group 1 (types and constants)
    - Review the 6-8 tests from Task Group 2 (hypothesis generation engine)
    - Review the 6-8 tests from Task Group 3 (question batching, answer capture, refinement)
    - Review the 4-6 tests from Task Group 4 (route endpoints)
    - Review the 3-4 tests from Task Group 5 (task definition and prompt)
    - Total existing tests: approximately 23-32 tests
  - [x] 6.2 Analyze test coverage gaps for THIS feature only
    - Identify whether the end-to-end flow is tested: generate hypotheses -> batch questions -> capture answers -> refine -> verify updated confidence
    - Check that the `EvidenceAtom` source extension does not break existing atom handling in log enrichment or Phase 1a code
    - Verify the Q&A optional-skip path is tested (user proceeds to review/approval without doing Q&A)
    - Assess whether `steps_payload` round-trip (write hypotheses, read back for refinement) is tested
    - Verify backward compatibility: existing atoms without `source` or `qaOrigin` fields still work
  - [x] 6.3 Write up to 10 additional strategic tests maximum
    - End-to-end integration test: generate -> refine cycle with realistic mock data covering multiple hypothesis categories
    - Backward compatibility test: existing `EvidenceAtom` objects without `source` field still function correctly
    - Round-trip `steps_payload` test: hypotheses written by generate endpoint are correctly read by refine endpoint
    - Question batch boundary test: verify batches never exceed 4 questions and never produce empty batches (for non-empty hypothesis input)
    - Confidence capping test: verify that multiple confirmed verdicts do not push confidence above `LOG_MAX_CONFIDENCE_CAP`
    - Denial floor test: verify that denied verdict does not push confidence below 0.0
    - Skip-path test: verify that Q&A step being skipped (no hypotheses generated or user skips) does not block the review/approval workflow
    - Multiple round test: verify that unresolved hypotheses from round 1 carry over correctly to round 2
  - [x] 6.4 Run feature-specific tests only
    - Run ONLY tests related to this spec's feature (tests from 1.1, 2.1, 3.1, 4.1, 5.1, and 6.3)
    - Expected total: approximately 31-42 tests maximum
    - Do NOT run the entire application test suite
    - Verify all critical workflows pass

**Acceptance Criteria:**
- All feature-specific tests pass (approximately 31-42 tests total)
- End-to-end generate-refine cycle works correctly
- Backward compatibility confirmed -- existing evidence atoms unaffected
- `steps_payload` round-trip integrity verified
- Confidence adjustments respect both the cap (`LOG_MAX_CONFIDENCE_CAP`) and floor (0.0)
- Q&A skip path does not block downstream review/approval workflow
- No more than 10 additional tests added when filling in testing gaps

---

## Execution Order

Recommended implementation sequence:

1. **Task Group 1** (Types and Constants) -- foundational data model that all other groups depend on
2. **Task Group 5** (Gateway Task Definition and Prompt) -- can start in parallel with Task Group 1 since it is gateway-side config with no discovery-service code dependency
3. **Task Group 2** (Hypothesis Generation Engine) -- depends on Task Group 1 types
4. **Task Group 3** (Question Generation, Answer Capture, Refinement) -- depends on Task Group 2 for hypothesis objects
5. **Task Group 4** (Route Endpoints) -- depends on Task Groups 2 and 3 for the functions it orchestrates
6. **Task Group 6** (Test Review and Integration) -- depends on all prior groups

Parallelism opportunities:
- Task Groups 1 and 5 can execute in parallel (different codebases: discovery-service vs gateway)
- Task Groups 2 and 5 can overlap if Task Group 1 finishes first

## File Inventory

### New Files
| File | Task Group |
|------|-----------|
| `discovery-service/src/types/hypothesis.ts` | 1 |
| `discovery-service/src/constants/hypothesisQaDefaults.ts` | 1 |
| `discovery-service/src/services/hypothesisGenerationEngine.ts` | 2 |
| `discovery-service/src/services/questionBatchGenerator.ts` | 3 |
| `discovery-service/src/services/hypothesisAnswerProcessor.ts` | 3 |
| `discovery-service/src/services/hypothesisRefinementEngine.ts` | 3 |
| `discovery-service/src/routes/hypothesisQa.ts` | 4 |
| `gateway/src/config/tasks/architect--discovery-qa.json` | 5 |
| `gateway/src/config/prompts/architect.discovery-qa.task.md` | 5 |

### Modified Files
| File | Task Group | Change |
|------|-----------|--------|
| `discovery-service/src/types/evidenceAtom.ts` | 1 | Add `'human_qa'` to source union, add `QaOrigin` interface and `qaOrigin` field |
| `discovery-service/src/types/index.ts` | 1 | Export new hypothesis types |
| `discovery-service/src/routes/index.ts` | 4 | Mount `hypothesisQaRouter` at `/hypothesis-qa` |
| `gateway/src/config/personas/architect.json` | 5 | Add `"architect--discovery-qa"` to tasks array |

### New Test Files
| File | Task Group |
|------|-----------|
| `discovery-service/src/__tests__/hypothesisTypes.test.ts` | 1 |
| `discovery-service/src/__tests__/hypothesisGenerationEngine.test.ts` | 2 |
| `discovery-service/src/__tests__/questionBatchAndRefinement.test.ts` | 3 |
| `discovery-service/src/__tests__/hypothesisQaRoutes.test.ts` | 4 |
| `gateway/src/__tests__/architectDiscoveryQaTask.test.ts` | 5 |
| `discovery-service/src/__tests__/hypothesisQaIntegration.test.ts` | 6 |
