# Spec 1 — Execution-class unification (automated | manual)

Program: `agent-os/planning/2026-08-03-manual-work-and-structural-gaps-program.md`

## Goal

ONE first-class execution-class distinction — `automated` (IVS work) vs
`manual` (human work) — computed by ONE classifier and enforced at every
IVS-facing choke point. Replaces three divergent mechanisms (only the first
was enforced):

1. `execution:manual-gate` (code stream) — enforced in driver.
2. db-pack review stories (`provenance:pack` without `seed_db_pack_files`) —
   "never dispatched" claim was a COMMENT ONLY; they got deterministic
   `generated` specs and WERE dispatchable.
3. `provenance:prerequisite` stories — blocked the run via
   `insufficient_context` spec rows.

## Design

- New leaf module `gateway/src/services/migrationExecutionClass.ts` (no
  imports from other services — tag literals are stable wire constants):
  - `MANUAL_EXECUTION_TAG = 'execution:manual'` (canonical going forward)
  - `executionClassForItem({tags})`: manual iff canonical tag OR legacy
    inference (manual-gate tag; pack-provenance without seed_db_pack_files;
    prerequisite tag). Legacy inference keeps ALREADY-PERSISTED books correct.
- Enforcement points (all import the one classifier):
  - Driver `evaluateHardBlock` — manual items exempt from spec gate.
  - Driver `buildOrderedDispatchSet` — manual items never dispatched.
  - Spec generation `selectEligibleStories` — manual stories never selected;
    no hollow "this is human work" specs, no insufficient_context rows.
  - Parity scope guards (verdict emitter, run parity status, code execution
    gate) — switch manual-gate check to the classifier (superset; no
    behavioural change since the extra members carry no endpoints).
- Planners stamp `MANUAL_EXECUTION_TAG` on every human item they emit
  (code-stream capture/closure, db-pack review/jobs-re-homing/payload-less,
  prerequisite items). Legacy tags remain as provenance.
- Preflight routes UNCHANGED (db_pack_review queue readiness, prerequisite
  blocked-reasons, manual_gate) — they are useful UI signals; only spec
  GENERATION and DISPATCH change.
- FE: mirrored `executionClassForTags` helper; "Manual" badge on plan rows;
  manual stories excluded from spec-completeness counts driving Start.

## Accepted semantic change

Prerequisite stories no longer block Start via story_not_spec_ready (they are
manual ⇒ exempt from the spec gate). Plane-level blocking remains with the
plane gates (DB pack readiness gate; Spec 2 adds the structural-findings
gate). Rationale: gates belong to planes/conditions, not to pseudo-stories.

## Verification

Jest: new migrationExecutionClass tests; driver tests proving a db-pack
review story with a persisted generated spec row is NOT dispatched and does
NOT spec-gate; selection test proving manual stories are never selected.
Existing suites green.
