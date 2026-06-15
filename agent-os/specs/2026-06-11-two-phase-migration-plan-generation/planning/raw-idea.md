# Two-Phase Migration Delivery Plan Generation (skeleton → expand) with Inventory Batching + Template Stamping

## Problem
The PM "Create Migration Delivery Plan" wizard's Generate step makes LLM calls to generate a draft migration book of work. The original single whole-plan call exceeded the Azure OpenAI relay's hard ~300s request cap (HTTP 504 "Endpoint request timed out" at ~5 minutes). A per-delivery-stream split (one parallel LLM call per selected stream, deterministic assembly) was just built and mitigates this, but a single stream can still overflow the cap for large inventories — e.g. 100+ API endpoints in target_service_api_implementation or 100+ tables in target_database_schema_implementation. The binding constraint is OUTPUT tokens per call (models generate serially; 100 detailed stories ≈ 30-60k output tokens).

## Solution outline (three combined techniques + a two-phase UX)

### Phase 1 — "Generate plan" (skeleton)
The existing wizard Generate button produces ONLY the initiative → epic → feature skeleton per selected delivery stream (titles, one-line descriptions, NO stories, NO acceptance criteria). Small bounded output per call; fast (<1 min/stream). The skeleton draft persists to AMS and opens in the existing review workspace. The PM reviews the high-level backlog BEFORE spending tokens on detail.

### Phase 2 — "Expand" (detailed stories), user-triggered in the review workspace
- An "Expand epic" action per epic row PLUS an "Expand all epics" bulk control (consistent with the product rule: never individual-only actions).
- Expansion generates the epic's stories and appends them to the persisted draft (AMS needs a draft append-items/update path).
- Per-epic expansion state machine: not_expanded / expanding / expanded / failed (retryable). Partial progress visible and resumable — a failed epic re-expands without regenerating the rest.
- NOTE terminology: phase 2 produces detailed STORIES in the book of work. The downstream per-story SHAPE-SPEC generation stage (already wired) remains unchanged and is the implementation-correctness stage.

### Deterministic inventory batching (inside phase 2)
For inventory-driven epics (endpoints, tables/columns), the gateway partitions the inventory deterministically BEFORE calling (it already has the discovery context: endpoints, tables, mappings, baselines) — e.g. 100 endpoints → batches of ~12 → one expansion call per batch under the skeleton's epic ids. Predictive sizing (from counts) rather than reactive timeout discovery. Concurrency pool (e.g. 4-6 in flight) rather than unbounded Promise.all to respect LLM rate limits.

### Template + exception stamping (the big lever for 100-of-X inventories)
Homogeneous bulk stories (e.g. "Implement {METHOD} {path} with behavioural parity to baseline {id}") are NOT individually LLM-written. Instead the LLM produces: (a) the story template(s) per work type, (b) a classification of which inventory items are standard vs exceptional, (c) full bespoke stories ONLY for the exceptions. The gateway stamps the template across the inventory in code, substituting real model facts (method/path/baseline id/data-effect entities/mappings). Coverage becomes a code guarantee (every endpoint in the model gets a story — code cannot drop item 73 of 100; an LLM can). Items get a provenance tag (e.g. stamped vs generated, mirroring the existing per-item stream:<name> tag convention).

### Layered verification (the user's explicit confidence requirement)
1. Code-level referential checks on every stamped item (endpoint exists, baseline resolves, data-effect entities resolve) — deterministic, blocking.
2. Hard-wired classification overrides in code: endpoints with attached findings, live conflicts, missing baselines, SOAP operations with complex message schemas, anything not ready_for_spec → ALWAYS bespoke LLM-written, never template-stamped, regardless of the LLM classification.
3. LLM judge pass per stamped batch: review stamped stories against their endpoints' contracts/baselines/findings; flagged items are re-routed to the bespoke path and rewritten individually (adversarial-verify pattern; verdict-only output, cheap).
4. Downstream safety net: the per-story shape-spec stage re-derives implementation detail from the model, so template genericness cannot produce incorrect implementation.

## Existing foundations to build on (all in this repo)
- gateway/src/services/migrationBookOfWorkHandler.ts — the per-stream split + assembleBookOfWork (id namespacing <stream>:<id>, delivery-dependency stream ordering via STREAM_SEQUENCE_RANK, global sequenceOrder renumbering, deterministic counts, worst-of qualityAssessment, per-item stream:<name> tags, one-retry-per-stream, atomic AMS write). Built 2026-06-11, uncommitted.
- gateway/src/services/generatedMigrationBookOfWorkSchema.ts — GeneratedMigrationBookOfWork schema + validateBookOfWorkHierarchy (initiative→epic→feature→story, no orphans/cycles/level-jumps, duplicate-id rejection).
- gateway/src/config/prompts/product-manager.migration-delivery-plan.task.md — the system prompt (hard constraints: sequenceOrder dependencies, workstream vocabulary of 14 values, captured-decision alignment, [decision:<code>] tags).
- AMS: POST /api/projects/{projectId}/migration-books-of-work creates the draft; draft fields title/summary/generation_inputs_json/generation_summary_json/quality_assessment_json/book_of_work_json. NO append/update path for items yet (phase 2 needs one).
- frontend: MigrationDeliveryPlanWizard.tsx (Generate), MigrationBookOfWorkReviewWorkspace.tsx (review), migrationDeliveryPlanApi.ts.
- Constraint references: Azure relay hard ~300s per request; node undici default ~300s would be the next ceiling if relay were raised.

## Decisions already made with the user (treat as settled)
- Two-phase UX with phase-1 skeleton on the existing Generate button and phase-2 expansion in the review workspace, per-epic AND all-epics controls (user's explicit choice).
- Template stamping with the 4-layer verification above (user explicitly asked for LLM-involved checks).
- Small streams (cutover_rollback_decommission, reconciliation_reporting etc.) may stay on the current single-call-per-stream path where one call already fits — no machinery where not needed.
- Atomicity per unit: skeleton write atomic as today; per-epic expansion atomic per epic (a failed epic leaves other epics' stories intact).
- Back-compat: no-streams-selected legacy combined path must keep working.
