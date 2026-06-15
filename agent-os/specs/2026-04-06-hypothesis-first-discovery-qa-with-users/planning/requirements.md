# Spec Requirements: Hypothesis-First Discovery Q&A with Users

## Initial Description
Implement hypothesis-first discovery with human-in-the-loop Q&A validation -- generating hypotheses from weak/ambiguous discovery results, asking targeted questions via existing chat/persona system, capturing structured answers, and using them to refine evidence, clusters, and candidates -- as increment 15 of 16 for the legacy/current-state discovery capability.

## Requirements Discussion

### First Round Questions

**Q1:** I assume the "hypothesis generation" step is an automated process that runs after Phase 1 (and optionally after log-based enrichment from increment 14), analyzing evidence atoms, clusters, and candidates to identify items with low confidence, ambiguous cluster membership, conflicting evidence, or missing attributes -- and then formulating specific hypotheses about those items (e.g., "We believe ServiceX communicates with DatabaseY based on weak log evidence, but this needs confirmation"). Is that the correct trigger and scope, or is hypothesis generation driven by something else?
**Answer:** Yes, it is an automated step triggered after Phase 1 (and optionally after log enrichment), focused on low-confidence, ambiguous, or incomplete areas.

**Q2:** I'm assuming the "targeted questions" are generated per-hypothesis and routed to the user through the existing chatV2 persona/task conversation system -- likely as a new task under the Architect persona (or possibly a new discovery-specific persona), using the existing "discovery" mode with structured Q&A sections. The system would present a hypothesis with its supporting evidence and ask the user to confirm, deny, or elaborate. Is that the right integration model, or should questions be surfaced through a different mechanism (e.g., a dedicated review queue rather than chat)?
**Answer:** Yes, use the existing chat/persona system with a discovery-oriented task; do not introduce a separate queue system in this increment.

**Q3:** For "structured answers," I assume the system captures the user's response as a structured data object (e.g., `{ hypothesisId, verdict: 'confirmed' | 'denied' | 'partially_confirmed' | 'needs_more_info', freeTextNotes, confidenceAdjustment }`) and persists this alongside the evidence graph -- effectively creating a new evidence source type (source: "human_qa" alongside existing source: "code" and source: "log"). Is that the right shape, or should answers be simpler/more complex?
**Answer:** Yes, capture answers in a structured form tied to hypotheses and treat them as a new evidence source (human_qa), but keep the structure simple.

**Q4:** I assume the "refine evidence, clusters, and candidates" step means that confirmed hypotheses boost confidence scores (using the same additive model from increment 14), denied hypotheses reduce or flag items, and partially confirmed responses may split or re-cluster evidence. This refinement should be non-destructive to already-saved canonical entities (consistent with the pattern from previous increments). Is that correct, and should refinement be automatic after answer capture or require an explicit user trigger?
**Answer:** Apply refinement automatically after answers are captured; keep it non-destructive to canonical entities.

**Q5:** Regarding scope within the pipeline: I assume this Q&A loop happens after Phase 1d (candidate generation) but before final save-back to the canonical model. The flow would be: Phase 1a-1d produces candidates -> hypothesis generator identifies weak/ambiguous items -> questions are asked -> answers refine the results -> user can then proceed to the existing review/approval workflow from increment 13. Is that the right placement, or can the Q&A loop also be triggered mid-pipeline (e.g., after Phase 1b clustering)?
**Answer:** Primarily after Phase 1d and before save/review; do not introduce mid-pipeline Q&A in this increment.

**Q6:** I assume this increment does NOT introduce a new persona or task type in the chatV2 system -- instead, it reuses the existing Architect persona and adds a new task (e.g., `architect--discovery-qa` in "discovery" mode) that the system can invoke when hypotheses are ready. The frontend would present this as a conversation initiated by the system rather than by the user. Is that right, or should Q&A questions appear inline within the existing discovery results UI instead?
**Answer:** Reuse the existing architect persona with a new discovery-QA style task; no new persona needed.

**Q7:** For the number and batching of questions: I assume the system groups related hypotheses and asks 2-4 targeted questions per round (consistent with the existing discovery mode pattern), rather than presenting all hypotheses at once or asking one at a time. Should there be a maximum number of Q&A rounds, or does the loop continue until all hypotheses are resolved or the user explicitly moves on?
**Answer:** Yes, small grouped batches of questions per round; keep the loop simple and allow the user to stop rather than enforcing complex round limits.

**Q8:** Is there anything that should be explicitly excluded from this increment that might otherwise seem like a natural part of hypothesis-driven Q&A? For example: automated hypothesis generation using LLMs (vs. rule-based), multi-user Q&A routing (sending different hypotheses to different domain experts), integration with external knowledge bases, or the ability to add entirely new entities based on user answers (vs. only refining existing candidates)?
**Answer:** Exclude LLM-driven hypothesis generation, multi-user routing, external knowledge integration, and creation of entirely new entities purely from answers.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: chatV2 persona/task conversation system - Path: `gateway/src/config/personas/`, `gateway/src/config/tasks/` -- the existing persona definitions and task JSON files that define conversation modes, context needs, and artifact outputs. The new discovery-QA task will follow this pattern.
- Feature: Architect persona - Path: `gateway/src/config/personas/architect.json` -- the persona under which the new discovery-QA task will be registered.
- Feature: Existing discovery-mode tasks - Path: `gateway/src/config/tasks/` -- tasks using `"mode": "discovery"` with structured Q&A sections provide the template for the new task.
- Feature: Task prompt files - Path: `gateway/src/config/prompts/*.task.md` -- prompt templates that define how personas ask questions; the new discovery-QA task will need its own prompt file.
- Feature: Discovery pipeline orchestration - Path: `discovery-service/` -- the existing Phase 1 pipeline and run model where hypothesis generation will be triggered after Phase 1d completion.
- Feature: Evidence atom model - Path: discovery-service types/models -- the existing evidence atom schema with source markers (source: "code", source: "log") that will be extended with source: "human_qa".
- Feature: Confidence scoring - existing additive confidence model from increment 14 (log-based enrichment) that will be reused for Q&A-driven refinement.
- Feature: Discovery run entity - Path: `architecture-model-service/` -- the DiscoveryRunEntity and related persistence stack where Q&A state and hypothesis data will be stored.
- Feature: chatV2 type definitions - Path: `gateway/src/types/chatV2.ts` -- TypeScript types for conversations, messages, and structured responses.

### Follow-up Questions
No follow-up questions were needed. All answers were clear and specific, with well-defined scope boundaries and explicit exclusions.

## Visual Assets

### Files Provided:
No visual assets provided (confirmed via file system check).

### Visual Insights:
N/A -- no visual assets to analyze.

## Requirements Summary

### Functional Requirements

**Hypothesis Generation (automated, rule-based):**
- An automated step that runs after Phase 1d completion (and optionally after log-based enrichment from increment 14)
- Analyzes the evidence graph, clusters, and candidates to identify: low-confidence items, ambiguous cluster membership, conflicting evidence across sources, missing attributes or incomplete data
- Produces structured hypothesis objects describing what is uncertain and why, with references to the supporting/conflicting evidence
- Rule-based logic only -- no LLM-driven hypothesis generation in this increment
- Hypotheses are persisted as part of the discovery run state

**Targeted Question Generation and Delivery:**
- Each hypothesis maps to one or more targeted questions designed to resolve the uncertainty
- Questions are delivered through the existing chatV2 persona/task conversation system
- A new task (e.g., `architect--discovery-qa`) is added under the existing Architect persona, using discovery mode with structured Q&A sections
- Questions are grouped into small batches (2-4 per round), with related hypotheses batched together
- Each question presents the hypothesis, its supporting evidence summary, and asks the user to confirm, deny, or elaborate
- The Q&A loop is simple: the user can answer rounds of questions and stop at any time (no enforced round limits or complex loop control)

**Structured Answer Capture:**
- User answers are captured as structured data tied to specific hypotheses
- Simple structure including: hypothesis reference, verdict (confirmed/denied/partially confirmed/needs more info), and free-text notes
- Answers are treated as a new evidence source type: `source: "human_qa"`
- Answer data is persisted alongside the evidence graph as human_qa evidence atoms
- Answers reference the originating hypothesis and the discovery run

**Automatic Refinement from Answers:**
- After answers are captured, refinement is applied automatically (no separate user trigger)
- Confirmed hypotheses boost confidence scores of related candidates/clusters using the existing additive confidence model
- Denied hypotheses reduce confidence or flag related items for review
- Partially confirmed responses may adjust cluster membership or attribute completeness
- Refinement is non-destructive to already-saved canonical entities (consistent with all previous increments)
- Refinement updates are recorded in the discovery run state for traceability

**Pipeline Placement:**
- The Q&A loop sits after Phase 1d (candidate generation) and before the save/review workflow (increment 13)
- Flow: Phase 1a-1d -> hypothesis generation -> Q&A rounds -> refinement -> review/approval -> save-back
- No mid-pipeline Q&A (e.g., after 1b or 1c) in this increment
- The Q&A step is optional -- users can skip it and proceed directly to review/approval

**Chat/Persona Integration:**
- New task definition JSON file for the Architect persona (e.g., `architect--discovery-qa.json`)
- Task uses discovery mode with structured Q&A sections
- New prompt file defining how the Architect persona presents hypotheses and asks questions
- Task registered in the Architect persona's task list
- Frontend presents the Q&A as a conversation within the existing chat panel

### Reusability Opportunities
- chatV2 persona/task system (personas, tasks, prompts, type definitions) provides the complete interaction framework -- no new UI paradigm needed
- Existing discovery-mode task pattern (structured Q&A with sections) is the direct template for the new task
- Additive confidence scoring model from increment 14 (log-based enrichment) is reused for answer-driven refinement
- Evidence atom model with source markers (source: "code", source: "log") is extended with source: "human_qa"
- Discovery run entity and persistence stack stores hypothesis and Q&A state
- Discovery pipeline orchestration manages the new hypothesis generation step placement

### Scope Boundaries

**In Scope:**
- Rule-based hypothesis generation from weak/ambiguous/incomplete discovery results
- Hypothesis data model and persistence within the discovery run
- New Architect persona task for discovery Q&A (task JSON, prompt file, persona registration)
- Targeted question generation from hypotheses, delivered via existing chat/persona system
- Small-batch question grouping (2-4 per round) with user-controlled stop
- Structured answer capture with verdict, notes, and hypothesis reference
- Human_qa evidence source type integrated into the evidence atom model
- Automatic non-destructive refinement of confidence scores, clusters, and candidates based on answers
- Traceability of refinements back to specific Q&A answers and hypotheses
- Integration into the pipeline flow after Phase 1d, before review/approval
- Unit tests for all new code

**Out of Scope:**
- LLM-driven hypothesis generation (rule-based only in this increment)
- Multi-user Q&A routing (sending different hypotheses to different domain experts)
- Integration with external knowledge bases
- Creation of entirely new entities purely from user answers (only refinement of existing candidates)
- Mid-pipeline Q&A (e.g., after Phase 1b clustering)
- Complex round-limit enforcement or sophisticated loop control
- Separate dedicated Q&A review queue UI (uses existing chat system)
- New persona creation (reuses Architect persona)
- Frontend-heavy hypothesis visualization or evidence graph rendering
- Destructive changes to already-saved canonical entities

### Technical Considerations
- The new task follows existing patterns in `gateway/src/config/tasks/` and `gateway/src/config/prompts/` -- a new JSON task definition and markdown prompt file
- The Architect persona JSON (`gateway/src/config/personas/architect.json`) needs to be updated to include the new task in its tasks array
- Hypothesis objects should be stored within the discovery run's JSONB payload (following the pattern from increment 5 where step results are stored in the run)
- Human_qa evidence atoms follow the same schema as code and log atoms, with `source: "human_qa"` and references to the hypothesis ID and Q&A round
- The confidence adjustment model should be consistent with the additive approach established in increment 14 (log-based enrichment)
- The Q&A step is positioned as an optional phase between Phase 1d completion and the review/approval workflow -- the pipeline must support skipping this step
- This is increment 15 of 16 -- the final increment (16) may build on the Q&A patterns established here, so the hypothesis and answer models should be designed for extensibility
- Previous increment (14, log-based enrichment) explicitly notes that it "enables increment 15 (hypothesis-first discovery and Q&A with users)" -- this increment fulfills that dependency
