# Specification: Hypothesis-First Discovery Q&A with Users

## Goal
Introduce a hypothesis-first validation loop into the discovery pipeline that identifies weak, ambiguous, or incomplete results after Phase 1d, generates targeted questions for the user via the existing chat/persona system, captures structured answers as a new `human_qa` evidence source, and automatically applies non-destructive refinements to confidence scores, clusters, and candidates before the review/approval workflow.

## User Stories
- As an architect, I want the system to surface uncertain discovery results as clear hypotheses with supporting evidence so that I can confirm, deny, or clarify them without manually auditing the full evidence graph.
- As an architect, I want my answers to automatically refine candidate confidence and cluster membership so that the review/approval step reflects my validated knowledge rather than raw machine output.

## Specific Requirements

**Hypothesis Generation Engine (rule-based)**
- A new service module in `discovery-service/src/services/` that runs after Phase 1d completion (and optionally after log enrichment from increment 14)
- Loads all candidates, clusters, and evidence atoms for a completed run and applies rule-based checks to identify: candidates below the auto-accept threshold, clusters with `clusterType: 'unknown'`, candidates with conflicting source evidence (e.g., code says X, log says Y), candidates with missing critical attributes in their `data` payload, candidates whose confidence dropped after log enrichment
- Each rule produces zero or more `Hypothesis` objects describing the uncertainty, referencing specific candidate/cluster/atom IDs
- Hypotheses are persisted in the discovery run's `steps_payload` JSONB field (following the pattern used by other step results in `runManager.ts`)
- No LLM calls -- strictly deterministic rule evaluation

**Hypothesis Data Model**
- New TypeScript interface in `discovery-service/src/types/` with fields: `id` (UUID), `runId`, `category` (enum: `low_confidence`, `ambiguous_type`, `conflicting_evidence`, `missing_attribute`, `weak_cluster`), `subjectType` (`candidate` or `cluster`), `subjectId`, `description` (human-readable statement of the uncertainty), `evidenceRefs` (array of atom/relationship/cluster IDs supporting the hypothesis), `status` (`pending`, `confirmed`, `denied`, `partially_confirmed`, `needs_more_info`), `createdAt`
- A companion `HypothesisAnswer` interface with: `hypothesisId`, `verdict` (matches status enum excluding `pending`), `freeTextNotes` (optional string), `answeredAt`
- Both interfaces are standalone types, not modifications to existing interfaces

**Targeted Question Generation**
- A function that takes an array of `Hypothesis` objects and produces grouped question batches of 2-4 questions each, with related hypotheses batched together (e.g., all `low_confidence` candidates in the same cluster grouped)
- Each question includes: the hypothesis description, a short evidence summary (which atoms/sources contributed), and the expected answer options (confirm / deny / partially confirm / need more info)
- Question batches are formatted as structured context for the new architect discovery-QA task prompt

**New Architect Discovery-QA Task**
- New task JSON file `gateway/src/config/tasks/architect--discovery-qa.json` following the exact structure of `architect--discovery-framing.json`
- Task uses `"mode": "discovery"` with structured Q&A sections
- `contextNeeds` includes the discovery run ID and project ID so the prompt can load hypothesis data
- `responseFormat` schema captures per-hypothesis verdicts: an array of `{ hypothesisId, verdict, notes }` objects plus a `phase` field (`questions` or `done`) and a `summary` field
- `persistence` set to `"hub"` matching the discovery-framing task
- `availableFrom` set to `["hub"]` -- system-initiated, not user-browsable from the panel
- Register the task ID in `gateway/src/config/personas/architect.json` tasks array

**New Discovery-QA Prompt File**
- New prompt file `gateway/src/config/prompts/architect.discovery-qa.task.md` following the structure of `architect.discovery-framing.task.md`
- Instructs the Architect persona to present hypotheses with evidence summaries and ask the user to confirm, deny, or elaborate
- Enforces 2-4 questions per round, conversational tone, and acceptance of skip/unknown answers
- Includes the readiness gate: set `phase: "done"` when all hypotheses are resolved or the user indicates they want to stop
- Response must be JSON-only matching the task's `responseFormat`

**Structured Answer Capture and human_qa Evidence Atoms**
- Extend the `EvidenceAtom.source` union type from `'code' | 'log'` to `'code' | 'log' | 'human_qa'` in `discovery-service/src/types/evidenceAtom.ts`
- Add an optional `qaOrigin` field to `EvidenceAtom` (parallel to `logOrigin`) containing: `hypothesisId`, `verdict`, `freeTextNotes`, `answeredAt`
- When a user answers a hypothesis, create a new `human_qa` evidence atom referencing the hypothesis and persist it via `archModelClient.bulkSaveEvidence`
- Answers are also stored as `HypothesisAnswer` objects within the run's `steps_payload`

**Automatic Refinement from Answers**
- A refinement function that processes all captured answers for a run and applies non-destructive updates
- `confirmed` verdicts: apply an additive confidence boost to the related candidate (reuse `LOG_CORROBORATION_CONFIDENCE_BOOST` constant pattern, with a new `QA_CONFIRMATION_CONFIDENCE_BOOST` constant), capped at `LOG_MAX_CONFIDENCE_CAP`
- `denied` verdicts: reduce candidate confidence by a configurable decrement (new `QA_DENIAL_CONFIDENCE_PENALTY` constant) and set candidate status to `pending_review` to force human review
- `partially_confirmed` verdicts: apply a smaller boost than full confirmation and annotate the candidate's `data` payload with the partial confirmation notes
- `needs_more_info` verdicts: no confidence change; hypothesis remains open for a future round
- All refinements are non-destructive to canonical model entities -- only discovery run candidates and clusters are modified
- Refinement operations are recorded in `steps_payload` for traceability (which hypotheses drove which confidence changes)

**Pipeline Integration and Route**
- New route in `discovery-service/src/routes/` (e.g., `hypothesisQa.ts`) mounted at `/discovery/hypothesis-qa` with two endpoints: `POST /generate` (triggers hypothesis generation for a completed run) and `POST /refine` (applies answer-based refinement for a run)
- The generate endpoint validates the run exists and is COMPLETED, runs the hypothesis engine, persists results to `steps_payload`, and returns the hypothesis summary
- The refine endpoint validates the run, reads answers from `steps_payload`, executes the refinement function, updates candidates/clusters via `archModelClient`, and returns a refinement summary
- Mount the new router in `discovery-service/src/routes/index.ts` alongside existing routes
- The Q&A step is optional -- users can skip directly to the review/approval workflow from increment 13

**Q&A Loop Flow Control**
- The loop is user-controlled: the system presents a batch of questions, the user answers, refinement applies automatically, and the system checks for remaining unresolved hypotheses
- If unresolved hypotheses remain, the next batch is presented; if all are resolved or the user signals done, the loop ends
- No enforced maximum round count -- the user can stop at any time by answering with the `done` phase in the chat response
- The Q&A conversation persists in the thread so it can be resumed if the user navigates away

## Visual Design
No visual assets were provided for this increment. The Q&A interaction uses the existing chat panel UI with no new frontend components.

## Existing Code to Leverage

**Discovery-framing task pattern (`gateway/src/config/tasks/architect--discovery-framing.json`)**
- Provides the exact JSON structure for the new discovery-QA task: id, personaId, menuLabel, description, mode, taskPromptRef, responseFormat, contextNeeds, persistence, artifacts, phases, availableFrom
- The `responseFormat` with `phase`/`section`/`questions`/`summary` pattern should be adapted for hypothesis-specific verdicts
- The `"mode": "discovery"` and `"persistence": "hub"` settings should be reused directly

**Discovery-framing prompt (`gateway/src/config/prompts/architect.discovery-framing.task.md`)**
- Provides the template for structured Q&A prompts: role definition, section progression, question strategy (2-4 per round), handling uncertainty, readiness gate, JSON-only response format, and rules
- The discovery-QA prompt should follow the same structure but replace framing sections with hypothesis presentation and verdict collection

**Evidence atom model (`discovery-service/src/types/evidenceAtom.ts`)**
- The `source` field union (`'code' | 'log'`) needs extension with `'human_qa'`
- The `LogOrigin` interface pattern should be mirrored for the new `QaOrigin` interface
- Backward compatibility is maintained: existing atoms without the new field are unaffected

**Log enrichment confidence model (`discovery-service/src/constants/logEnrichmentDefaults.ts`, `discovery-service/src/services/logEnrichmentMetadata.ts`)**
- `LOG_CORROBORATION_CONFIDENCE_BOOST` (0.10) and `LOG_MAX_CONFIDENCE_CAP` (0.98) establish the additive confidence adjustment pattern that Q&A refinement should follow
- `computeLogEnrichmentForCandidate` demonstrates iterating cluster members to find source-typed atoms -- the same traversal pattern applies to counting `human_qa` atoms
- New constants should be defined in a parallel `discovery-service/src/constants/hypothesisQaDefaults.ts` file

**Run manager and archModelClient (`discovery-service/src/services/runManager.ts`, `discovery-service/src/services/archModelClient.ts`)**
- `steps_payload` JSONB field on the discovery run entity is the storage location for hypothesis and answer data
- `archModelClient.updateDiscoveryRun` with `steps_payload` is the persistence mechanism
- `archModelClient.getCandidatesByRun`, `getClustersByRun`, `getEvidenceByRun` provide the data loading methods needed by the hypothesis engine
- `archModelClient.updateCandidate` enables per-candidate confidence and status updates during refinement

## Out of Scope
- LLM-driven hypothesis generation (this increment uses rule-based logic only)
- Multi-user Q&A routing (all questions go to a single user via the existing chat system)
- Integration with external knowledge bases for hypothesis validation
- Creation of entirely new entities from user answers (only refinement of existing candidates and clusters)
- Mid-pipeline Q&A triggered during Phase 1b or 1c (Q&A runs only after Phase 1d)
- Complex round-limit enforcement or sophisticated loop control logic
- A dedicated Q&A review queue UI separate from the chat panel
- A new persona for discovery Q&A (reuses the existing Architect persona)
- Frontend visualization of the hypothesis evidence graph or interactive evidence rendering
- Destructive changes to already-saved canonical model entities
