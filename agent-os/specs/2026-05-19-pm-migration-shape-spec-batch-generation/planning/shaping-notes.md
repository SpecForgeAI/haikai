# Shaping Notes: PM Migration Shape-Spec Batch Generation

Status: all 23 clarifying questions resolved (R-1..R-13 + A-1..A-10), defaults accepted across the board. No follow-ups outstanding.

These notes are the authoritative resolution log for the spec-writer. They override anything in `raw-idea.md` that conflicts.

---

## 1. Persistence + linkage

### R-1 — Spec storage location
- Spec-writer MUST inspect `WorkItemImplementWorkspace` (entity, DTO, controller, repository) at write time.
- **If `WorkItemImplementWorkspace` can cleanly carry `generated_spec_text` + generation metadata with only minimal nullable additions:** EXTEND it in place.
- **Otherwise:** add the new `migration_story_spec_generations` table from the raw idea.
- Either way: WorkItem FK is the source of truth. **No orphan spec rows are permitted.**

### R-9 — WorkItem-to-spec linkage
- Linkage is via FK on whichever row holds the spec (the workspace row if extended, or the new spec-generation row).
- Add a read-only "Generated shape-spec available" chip on the WorkItem detail / Implement panel.
- **Do NOT add any new field on the `WorkItem` entity itself.**

### A-6 — `not_attempted` persistence semantics
- **Lazy.** No row is written until a story is first attempted.
- "Not attempted" is computed in-memory: `book_of_work_json` stories MINUS rows present in the spec-generation table (or workspace metadata).

### R-12 — Failure isolation
- Every per-story result is persisted whenever possible, including failures: `{ status: 'failed', errorMessage: '...' }` rows are written.
- If persistence itself fails for some results: the batch response MUST include
  - a `resultsCouldNotPersist` count, and
  - the unpersisted failure details inline in the response payload (so the UI can still display them).

---

## 2. Orchestration + batching

### R-2 — Generation orchestration
- **Gateway-only.** Mirrors Spec 1's Q-1 outcome.
- AMS owns persistence + the focused-context endpoints; gateway owns the LLM call + batch loop.

### R-3 — Batch processing model
- Synchronous per batch in v1. The frontend awaits the full batch response (no token streaming).
- Expected latency for ~25 stories: tens of seconds to a couple of minutes.

### R-4 — Within-batch concurrency
- **Serial in v1.** One story at a time inside a batch.
- Parallel-N execution is deferred as a future performance optimisation, not in scope here.

### R-6 — `skipped_blocked` policy
- Default behaviour: attempt every story; return `insufficient_context` where appropriate rather than skipping.
- `skipped_blocked` only occurs when the user explicitly toggles **"Skip blocked stories"** ON. The toggle defaults to OFF.

### R-8 — Re-run idempotency
- By default, re-runs skip stories already at `status='generated'`.
- Re-attempt stories at `failed`, `insufficient_context`, or `generated_with_warnings`.
- An explicit **"Regenerate all (including generated)"** toggle re-runs everything and bumps `generation_attempt_number`.
- **Never overwrite a manually-edited spec without an explicit confirm dialog.**

### A-9 — Batch concurrency control (UI side)
- The **"Generate next batch"** button is disabled while a batch is in-flight.
- Show an in-progress banner: e.g. "Batch in progress (story X of 25)".
- Navigating away does not cancel the batch; on return the workspace re-fetches the summary.

---

## 3. Focused-context + token budget

### R-5 — Token budget
- Cap: **~24K tokens** per story per LLM call on the focused-context payload.
- Reuse `applyTokenBudgetCascade` + `TokenBudgetOverflowError` from `gateway/src/services/migrationBookOfWorkHandler.ts` (Spec 1 helpers).
- Truncation cascade order:
  1. Drop oldest evidence first.
  2. Then drop mapping-rationale text.
  3. Then collapse baseline detail to summaries.
- **Always retain (never dropped):**
  - architecture refs for the story,
  - mappings touching the story,
  - contract / baseline IDs (even if their bodies are dropped).
- On overflow that cannot be resolved by the cascade: mark the story `insufficient_context` with the overflow recorded as `missingInputs[0]`.

### A-3 — Helper reuse
- Confirmed: reuse Spec 1's `applyTokenBudgetCascade` and `TokenBudgetOverflowError`. **Do not duplicate.**

### A-5 — Focused-context resolver
- Add a NEW endpoint and a NEW `MigrationSpecContextResolver` class, separate from the existing migration-summary resolver.
- The new resolver MAY internally call the existing summary resolver to obtain project-level base context, then layer story-scoped drill-down on top.

---

## 4. Quality signals

### R-7 — Confidence inference
- The LLM self-rates confidence in its response.
- The gateway then validates that self-rating against deterministic signals (presence/absence of mappings, baselines, contracts, evidence in the payload).
- If the LLM reports `high` but the payload was missing critical inputs, the gateway **downgrades** the confidence and attaches a structured warning explaining why the downgrade happened.

### R-10 — Predicted-vs-actual comparison
- Show **side-by-side `Predicted` / `Actual` columns** both in:
  - the batch results table, and
  - the story detail drawer.
- Add an optional summary metric on the workspace header (e.g. "12 of 14 predicted-ready actually generated").

---

## 5. Validation

### A-4 — Response validator
- Hand-rolled `assertSpecGenerationResponse(...)` with explicit per-status branch checks.
- Matches Spec 1's approach. **No Zod, no Ajv, no schema library.**
- Output rules from the raw idea (e.g. `specText` MUST start with `/agent-os:shape-spec`, MUST reference story title/scope; `missingInputs` REQUIRED when `status='insufficient_context'`) live inside the validator.

---

## 6. Auth

### R-11 — Auth gating
- Match `product-manager--migration-delivery-plan` (Spec 1's Q-17 resolution) verbatim. No new auth model invented here.

---

## 7. Tests + fixtures

### R-13 — Test fixtures
- Reuse Spec 1's `fixture-migration-delivery-plan-scenario.json` as upstream input.
- Add three NEW LLM-output fixtures:
  - `llm-output-generated.json`
  - `llm-output-insufficient-context.json`
  - `llm-output-failed.json`
- These three fixtures are created by the implementer during Group 1 (foundation) of the build — they are NOT user-supplied design assets.

### A-7 — Fixture placement
- Place the same JSON in BOTH locations:
  - `planning/visuals/` — for design-review visibility,
  - `gateway/src/__tests__/fixtures/` — for test consumption.

---

## 8. UI

### A-1 / A-2 — Existing UI / entity inspection
- Spec-writer MUST, at write time, inspect:
  - the `WorkItemImplementWorkspace` entity / DTO / controller / repository paths, AND
  - the existing WorkItem detail / Implement tab frontend component.
- Extend in place rather than building parallel structures.

### A-8 — Story result drawer
- Right-hand side-panel drawer, **~480–560px wide**.
- Overlays the batch results table.
- Dismissible via Esc key, backdrop click, or explicit X close button.

---

## 9. Scope

### A-10 — Out-of-scope boundary
- Keep the raw idea's "Out of scope" list verbatim for v1.
- No items added, no items deferred. The boundary as written stands.

---

## 10. Existing code reuse pointers (for spec-writer)

The spec-writer should reference these existing paths when laying out file targets:

- **Spec 1 gateway handler:** `gateway/src/services/migrationBookOfWorkHandler.ts`
  - Token budget cascade, hand-rolled validator, sync batch pattern, fixture-driven LLM testing.
- **Spec 1 hand-rolled schema validator:** `gateway/src/services/generatedMigrationBookOfWorkSchema.ts`
  - Precedent for the new `assertSpecGenerationResponse`.
- **Spec 1 AMS persistence layer:** `architecture-model-service/src/main/java/com/example/architecturemodel/{controller,service,model/{entity,dto},mapper,repository}/GeneratedMigrationBookOfWork*`
  - Closest existing shape for the new spec-generation persistence path.
- **Spec 1 frontend workspace:** `frontend/src/components/ProductManager/MigrationDeliveryPlan/*`
  - Modelling shell for the new spec-generation workspace.
- **`WorkItemImplementWorkspace`** entity + DTO + controller + frontend Implement-tab component
  - Spec-writer to locate and inspect at write time (paths to be discovered, not assumed).

---

## 11. Visual assets

- **None supplied by the user.**
- The three LLM-output JSON fixtures listed in section 7 are implementation artefacts produced in Group 1 of the build, not user-supplied design assets.
- Spec-writer and implementers work from textual descriptions in `raw-idea.md`, these `shaping-notes.md`, and the Spec 1 sibling spec for UI consistency.

---

## 12. Decision index (quick reference)

| ID   | Topic                                  | Resolution (default accepted)                                     |
|------|----------------------------------------|-------------------------------------------------------------------|
| R-1  | Spec storage                           | Extend `WorkItemImplementWorkspace` if clean, else new table       |
| R-2  | Orchestration                          | Gateway-only                                                       |
| R-3  | Batch processing                       | Synchronous per batch, no streaming                                |
| R-4  | Within-batch concurrency               | Serial in v1                                                       |
| R-5  | Token budget                           | ~24K cap, reuse Spec 1 cascade helpers                             |
| R-6  | `skipped_blocked` policy               | Attempt by default; toggle OFF by default                          |
| R-7  | Confidence inference                   | LLM self-rates; gateway validates + downgrades                     |
| R-8  | Re-run idempotency                     | Skip `generated`; regen-all toggle bumps attempt #; no overwrite   |
| R-9  | WorkItem-to-spec linkage               | FK on spec/workspace row + read-only chip; no WorkItem field       |
| R-10 | Predicted-vs-actual comparison         | Side-by-side columns + drawer + optional header metric             |
| R-11 | Auth gating                            | Match Spec 1 Q-17 verbatim                                         |
| R-12 | Failure isolation                      | Always persist when possible; `resultsCouldNotPersist` fallback    |
| R-13 | Test fixtures                          | Reuse Spec 1 input; add 3 new LLM-output fixtures                  |
| A-1  | Existing UI inspection                 | Inspect Implement-tab component at write time                      |
| A-2  | Existing entity inspection             | Inspect `WorkItemImplementWorkspace` paths at write time           |
| A-3  | Helper reuse                           | Reuse `applyTokenBudgetCascade` + `TokenBudgetOverflowError`       |
| A-4  | Response validator                     | Hand-rolled `assertSpecGenerationResponse`                         |
| A-5  | Focused-context resolver               | New endpoint + new `MigrationSpecContextResolver`                  |
| A-6  | `not_attempted` persistence            | Lazy; compute in-memory from BoW minus existing rows               |
| A-7  | Fixture placement                      | Both `planning/visuals/` AND `gateway/src/__tests__/fixtures/`     |
| A-8  | Story result drawer                    | Right-hand drawer ~480–560px, Esc/backdrop/X dismissible           |
| A-9  | Batch concurrency control (UI)         | Disable next-batch + in-progress banner + refetch on return        |
| A-10 | Out-of-scope boundary                  | Raw idea's "Out of scope" list as-is                               |
