# Residual 1 — data-echo attribution for break-glass reconciles

**Program:** Plan-screen unification residuals (2026-07-20). When the operator
break-glasses past the DB-plane data-parity gate, the Service plane's API
reconcile runs under KNOWN data divergence — a break can be a service-code
defect OR an echo of the divergent data. Mixing them burns the second oracle;
this partitions them deterministically. No LLM anywhere in the verdict.

## FR1 — record the override on the run

`resumeMigration({override:true})` at a DB pause freezes onto the run's
`decision_log_json`: `{type:'data_parity_override', at, parity_codes,
divergent_tables[]}` — the UNWAIVED divergent tables at the MOMENT of override
(the gate reason now carries the structured, uncapped table list). Judged
against what the operator knew, not whatever parity looks like later.
Best-effort — recording failure never blocks the resume. Zero DDL
(decision_log_json exists).

## FR2 — classify every break at reconcile time

`migrationReconciliationEchoClassifier`: one UNfiltered AMS full-model read
(endpoints + endpoint_data_effects) → per-break verdict by matching the
break's method+path to a committed endpoint (template-aware) and testing its
data-effect material (entity-point refs + effect metadata, single-sourced from
discovery) for the frozen divergent tables (qualified AND bare names):

- hit → `possible_data_echo` + the specific tables (detail_json.echo_tables);
- miss / unknown endpoint / **no data-effect metadata → `unexplained`** —
  missing metadata must never hide a real defect behind an echo label.

Every classified break also carries `ran_under_data_parity_override` (at +
tables) — the report stamp. Clean-context runs (no override entry) are
untouched. Failure-isolated: a facts-read hiccup leaves breaks unclassified.

## FR3 — surfacing

Reconciliation panel: an alert banner when the run reconciled under override
(divergent tables + the partition counts: "N unexplained (treat as real
defects) · M possible data echo"), and a per-break `data echo? (tables)` badge.
Unexplained rows carry no extra chrome — full authority is the default.

## Verification

Gateway: classifier units (echo hit incl. template + bare-name matching;
conservative unexplained for no-metadata / unknown / empty-frozen-set),
override recording freezes the divergent set on the decision log, gate
structured-tables field. Frontend: panel suite green with the banner + badge
additions. Driver glue typechecked + fail-soft.
