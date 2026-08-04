# Spec 2 — Structural findings dispositions + known-gap items

Program: `agent-os/planning/2026-08-03-manual-work-and-structural-gaps-program.md`
Depends on: Spec 1 (execution-class unification).

## Goal

Structural warnings stop being stories. They become PRE-PLAN DISPOSITIONS on
the Schema-migration screen; only `known_gap` dispositions leave a trace in
the plan, as a new manual-class work-item type. The original bug (structural
gap stories parented to the epic → hierarchy validation failure → "Expansion
failed") dies with the deleted emission.

## As built (gateway)

- `dbMigrationPack/types.ts`: `StructuralFinding {kind, subject, message}` +
  `structuralFindingKey` (`kind:subject`); manifest field
  `structural_findings` alongside legacy `structural_warnings` (both emitted;
  legacy strings derived from the same pass in `inputs.ts
  deriveStructuralFindings`; handler emits both).
- `migrationStructuralFindings.ts` (new): finding⋈disposition join.
  Closing dispositions = accepted | known_gap; fix_upstream + undispositioned
  stay OPEN. Legacy manifests fall back to `legacy_warning:<slug-of-head>`
  identities (stable while text unchanged). Stale dispositions (finding no
  longer emitted) are ignored — auto-clear; the generator is the only
  resolution oracle.
- `PackView.structuralDispositions?` — best-effort AMS read
  (`GET /api/projects/:pid/db-structural-finding-dispositions`), degrades [].
- GATES:
  - Plan generation (`migrationBookOfWorkHandler`): DB stream selected + pack
    readable + open findings ⇒ throw `MigrationStructuralFindingsOpenError`;
    route maps to 409 `{reason:'structural_findings_open', findings[]}`.
  - Expansion (`migrationDbPackPlanner`): open findings reaching expansion
    (pack regenerated after plan) throw with disposition instructions —
    epic failed (retryable), never silent.
  - Migrate (`migrationDbExecutionGate`): new reason
    `db_structural_findings_open`.
- PLANNER: structural-gap story emission DELETED. `known_gap`-dispositioned
  findings emit `${epic.id}-f-known-gaps` feature + one `known_gap`-type item
  each (`${epic.id}-kg-<key>`), tagged `execution:manual` + `known_gap`,
  readiness `blocked`, note carried in description/readinessReasons.
- SCHEMA: new item type `known_gap` (parent MUST be feature). AMS work_item
  `type` column is free-text — saves fine. Driver/spec-gen exclude it by
  type; manual tag is belt-and-braces.
- ROUTES (`routes/dbMigrationPack.ts`):
  - `GET  /:packId/structural-findings` — merged states for the panel.
  - `PUT  /:packId/structural-findings/:findingKey/disposition` — AMS proxy.
  - `DELETE` same path — un-disposition (finding re-opens).

## AMS (agent-built)

Project-scoped table `db_structural_finding_dispositions`
(uq project_id+finding_key; disposition CHECK accepted|fix_upstream|known_gap;
note REQUIRED for accepted/known_gap), entity/repo/service/controller at
`/api/projects/{projectId}/db-structural-finding-dispositions`
(GET list / PUT {findingKey} upsert / DELETE), snake_case wire.

## FE (agent-built)

Findings panel on the Schema-migration screen (beside the translation queue):
list findings with disposition state, three actions (accept-with-reason /
fix-upstream / known-gap-with-note), un-disposition; 409
`structural_findings_open` surfaced on plan generate; `known_gap` items render
in the plan tree as debt (manual badge + Known gap chip).

## Verification

Gateway: full jest 437 suites — only the 3 pre-existing baseline failures
(llmClient/azureOpenaiClient/manifestCodeMapping, verified failing on
unmodified main). New suites: migrationStructuralFindings (8),
planner rewrite (18 in migrationDbPackPlanner.test.ts incl. throw-on-open /
fix_upstream-blocks / known-gap emission / accepted-leaves-no-trace).
