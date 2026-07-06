# Code-Tier Oracle Program — Build Log

Branch: `feature/code-tier-oracle-program` (from main @ 58ad992). One commit per spec,
pushed after each. Build order (user-agreed, pure sequential):
G → H → L → M → J → K → N → I → F.

---

## Spec G — Deterministic Code-Stream Planning (2026-07-06)

**Status: BUILT + VERIFIED.**

### What landed

- NEW `gateway/src/services/migrationCodeStreamPlanner.ts` — deterministic Phase-1
  skeletons + Phase-2 stories for `target_service_api_implementation`,
  `api_soap_integration_compatibility`, and the NEW `internal_processing_implementation`
  stream. One story per interface (cap `MIGRATION_PLAN_API_CLUSTER_MAX_ENDPOINTS`,
  default 15), verb-group split (GET / POST+PUT+PATCH / other) then path-sorted chunks,
  SOAP alphabetical operation chunks, flag extraction (missing_baseline /
  attached_finding / soap_metadata_missing) into individual exceptional stories,
  MANUAL-GATE capture stories per below-floor interface sequenced BEFORE implementation,
  closure parity-sweep stories, prerequisite skeletons on unreadable/empty models,
  outbound-direction endpoints excluded (counted). Coverage checks THROW
  "regenerate the migration plan": unplanned endpoint, planned-but-gone, duplicates.
- Skeleton + expansion interception wired in `migrationBookOfWorkHandler.ts` /
  `migrationBookOfWorkExpansionHandler.ts` (mirrors the Spec B DB branches; model view
  fetched once per generation; expansion re-reads the model for the DRIFT check only,
  read failure → epic failed retryable, never a guess).
- `internal_processing_implementation` added to the workstream enum (gateway schema +
  frontend api types + wizard option + readiness defaults) and the stream rank map.
- Execution driver: `execution:manual-gate` items are never dispatched to IVS and never
  demanded spec-ready by the hard block (`migrationDriverAmsReads.ts` BookOfWorkItem
  gains `tags`).

### Deviations from the spec file (all conscious, all visible)

1. **AMS gap codes deferred to Spec I.** `no_committed_endpoints_for_protocol` /
   `internal_entry_points_unplanned` are NOT added AMS-side: the prerequisite skeletons
   already surface the same facts as blocked items with explicit missingInputs in the
   plan UI. Blocking-grade surfacing consolidates into Spec I's gate-code family.
2. **`endpoint_subtype` column deferred to Spec M.** Build-time verification confirmed
   the subtype lives ONLY in candidate `data` (no committed column, no save-back
   mapping, no trivial materialization point found). The internal partition uses the
   documented no-HTTP-verb heuristic; when the model has endpoints but none classify
   internal, the internal stream degrades to an explicit prerequisite naming the
   limitation. Column + save-back mapping belong to Spec M's internal-capture rework.
3. **Flagged stories are fully deterministic** (spec said "existing bespoke LLM rewrite
   retained for prose"). Deterministic fact-stamped stories are strictly more accurate;
   the code streams now make ZERO LLM calls in both phases (test-pinned).
4. **Scaffold gate is NOT skipped for code streams.** Initial implementation skipped it;
   that would have silently killed MAVEN scaffold injection (maven maps to the API
   workstream). Corrected: the scaffold homes onto the stream's lowest-sequence epic
   (foundations) and rides the same validate + atomic append. New pin covers it.
5. **No new AMS REST in G.** The planner reads the EXISTING full-model endpoint
   (`GET /api/model/projects/{p}/architectures/{a}` → `metaModel.entities.{interfaces,endpoints}`,
   field names verified against the AMS DTO source). Spec H/F still add the focused reads.

### Verification

- 22 new tests: `migrationCodeStreamPlanner.test.ts` (16 — anti-explosion 400→40 pin,
  verb-split, SOAP chunking, 3 coverage-throw pins, protocol + 100%-SOAP prerequisite,
  internal routing + heuristic degrade + outbound exclusion, flag/capture/manual-gate/
  closure pins, prerequisite pin) and `migrationBookOfWorkCodeExpansion.test.ts` (6 —
  real-pipeline expansion with throwing-LLM mock, drift → failed retryable, unreadable
  model → failed, maven-scaffold-on-foundations, driver dispatch skip + hard-block
  exemption).
- Legacy suites that used the API streams to pin the GENERIC LLM machinery switched to
  `target_frontend_implementation` (+ npm scaffold pairing where scaffold-related):
  handler, packEnsureWiring, findingsCoverage, scaffoldInjection, scaffoldGapAnalysis,
  expansion. All green.
- Full gateway suite: 3006 passed / 17 failed-at-full-parallelism. Baseline-verified:
  `manifestCodeMapping` + `llmClient` fail at the branch point too (pre-existing);
  `registryLoader` + 2 `chatV2` suites pass in isolation on BOTH sides (parallel-run
  interference via shared `threads/` state, not Spec G). Test-dirtied thread.json files
  restored before commit.
- Frontend: wizard suites are pre-existing red (SyntaxError at an `import type` line,
  identical with edits stashed — the known baseline-red frontend). Frontend edits are
  additive union/array/option entries only.

### Live-shakedown items (for the program review doc)

- G-1: generate a plan with the API streams selected against a real committed model;
  confirm the deterministic skeleton (epic structure, interface features) and that the
  full-model read's wire shape matches (`metaModel.entities.endpoints[].interface_id`).
- G-2: expand an interface epic; confirm cluster stories + coverage; mutate the model;
  confirm the drift throw surfaces as a retryable failed epic.
- G-3: Migrate run over a plan with capture stories: confirm they are never dispatched
  and don't block the hard gate.
