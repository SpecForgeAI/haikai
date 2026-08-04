# Spec 4 — LLM gap-proposal review queue

Program: `agent-os/planning/2026-08-03-manual-work-and-structural-gaps-program.md`
Depends on: Spec 2 (findings), Spec 3's write-back seam (MCP model writes).

## Goal

For fix_upstream findings where no live source DB is reachable, the LLM
drafts the missing structural metadata FROM the committed model (inference,
never invention); a human approves each draft (translation-queue idiom);
approval writes back additively; pack regeneration clears the finding.

## Scope of drafting (v1)

- `relationships_without_fk_columns` → fk_join proposals (naming-convention
  join inference per join-less relationship).
- `no_primary_keys` / `constraints_metadata_absent` → primary_key proposals
  (identity/`id` naming/minimal natural key).
- `no_indexes` / `no_code_objects` → UNSUPPORTED by design (would be
  invention): the generate endpoint answers supported:false pointing at
  harvest or accept/known-gap.

## As built

- `gateway/src/services/dbGapProposalGeneration.ts`: prompt build over the
  committed model (defaultFetchModel shapes), strict-JSON parsing, and a
  HALLUCINATION GUARD — every table/column/relationship named must exist in
  the model or the proposal is dropped with an honest warning. Stable
  proposal keys: `fk--<relationship_id>`, `pk--<table>`. 9 tests.
- AMS queue (agent-built): `db_gap_proposals` (uq project+proposal_key;
  review_status; origin llm|manual; applied_at) at
  `/api/projects/{pid}/db-gap-proposals` (GET/PUT bulk/PATCH review/DELETE).
- MCP apply (agent-built): `POST /mcp/tools/apply_gap_metadata` — additive
  model write (fk_columns only-if-empty; pk flags + constraints_metadata
  primary_key only-if-absent; per-delta skip notes).
- Gateway routes (agent-built): `/projects/:pid/db-gap-proposals`
  generate | list | :id/review (approve → MCP apply → applied_at) | manual
  (validated hand-entry through the same queue).
- FE (agent-built): proposals queue UI from the findings panel.

## Resolution invariant

Approval + apply NEVER flips a finding closed by hand: the pack regenerates
from the now-richer model and simply stops emitting the finding — the
generator stays the only resolution oracle.
