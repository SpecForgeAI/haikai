# Forced-Regression Acceptance Record

This document records the Task Group 7 manual acceptance gate for the V3
evaluation harness. Its purpose is to prove the harness actually catches a
pack-recall regression with exit code `1` and a correct per-metric verdict.

The acceptance was run on `2026-04-19` against the spring-classic framework
(10 fixtures, baseline `packRecall = 1.0`).

## Procedure

1. Record the pre-sabotage state.
2. Temporarily sabotage a spring-classic pack-detection rule in
   `discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`.
3. Run `npx tsx scripts/run-evaluation.ts --framework spring-classic` and
   confirm exit code `1` plus a `packRecall` `fail` verdict.
4. Restore the adapter verbatim from version control.
5. Re-run the evaluation and confirm exit code `0`.
6. Re-run `--all` to confirm no other framework is affected.
7. Confirm `git diff` shows only documentation changes.

## Sabotage Technique Used

The spec's suggested technique (per the Group 7 task description) was to
neutralize `@Controller` detection by emptying the `CONTROLLER_ANNOTATIONS`
list. That sabotage was attempted first but was **insufficient** to trigger a
regression against the current fixture set — none of the 10 spring-classic
fixtures contain an `@Controller` / `@RestController` class, so the harness
correctly reported no delta and exited `0`. This reveals a fixture-coverage gap
that a future spec can address, but for the purposes of the acceptance gate we
needed a sabotage that actually exercises the fixtures.

The sabotage that **did** trigger a regression (and is documented below) was a
minimal, one-line neutralization of `@Entity` detection in `processJpaEntity`.
`@Entity` is the closest "equivalent logic" to `@Controller` — both are
stereotype-annotation guards that short-circuit the pack detector when absent —
and is heavily exercised by the fixture set (5 of 10 fixtures pack-expect
`physical_entity` / `physical_attribute` / `entity_relationship` candidates
that only emit when `@Entity` is detected).

The exact sabotage was a single-line change in
`discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`:

```diff
 function processJpaEntity(
   cls: ClassIR,
   file: SourceFileIR,
   runId: string,
   out: AdapterOutput,
   classIndex: ClassIndex,
 ): void {
-  if (!hasAnnotation(cls.annotations, 'Entity')) return;
+  if (!hasAnnotation(cls.annotations, '__SABOTAGED_Entity')) return;
```

This makes the guard match no real class, so `processJpaEntity` returns early
for every input and the adapter stops emitting physical-entity candidates.

## Pre-Sabotage Run (Baseline Healthy)

Command: `npx tsx scripts/run-evaluation.ts --framework spring-classic`

```
### Framework: spring-classic

| Metric              | Current | Baseline |   Δ    | Direction | Verdict |
|---------------------|--------:|---------:|-------:|-----------|---------|
| Pack recall         |  1.000  |  1.000   | +0.000 |     =     |  pass   |
| Gap-fill precision  |   n/a   |   n/a    |  n/a   |  ↓ worse  |  pass   |
| Gap-fill recall     |  0.000  |  0.000   | +0.000 |     =     |  pass   |
| Duplication rate    |   n/a   |   n/a    |  n/a   |  ↓ better |  pass   |
| Hallucination rate  |   n/a   |   n/a    |  n/a   |  ↓ better |  pass   |

OVERALL: PASS
```

Exit code: `0`.

## Sabotaged Run (Regression Detected)

Command: `npx tsx scripts/run-evaluation.ts --framework spring-classic`

```
### Framework: spring-classic

| Metric              | Current | Baseline |    Δ    | Direction | Verdict |
|---------------------|--------:|---------:|--------:|-----------|---------|
| Pack recall         |  0.188  |  1.000   |  -0.813 |  ↓ worse  |  fail   |
| Gap-fill precision  |   n/a   |   n/a    |   n/a   |  ↓ worse  |  pass   |
| Gap-fill recall     |  0.000  |  0.000   |  +0.000 |     =     |  pass   |
| Duplication rate    |   n/a   |   n/a    |   n/a   |  ↓ better |  pass   |
| Hallucination rate  |   n/a   |   n/a    |   n/a   |  ↓ better |  pass   |

OVERALL: FAIL
```

Exit code: `1`.

JSON report `packRecall` verdict block (from
`evaluation/reports/spring-classic-2026-04-19T14-25-08-972Z.json`, reports
directory is gitignored):

```json
"packRecall": {
  "current": 0.1875,
  "baseline": 1,
  "delta": -0.8125,
  "direction": "decrease",
  "threshold": 0.05,
  "status": "fail"
}
```

Affected fixtures (pack candidates dropped):

| Fixture                    | Pack-expected emitted before | After sabotage |
|----------------------------|-----------------------------:|---------------:|
| allergy-reaction           | 5 / 5                        | 0 / 5          |
| concept-attribute          | 2 / 2                        | 0 / 2          |
| encounter-provider         | 5 / 5 (pack entity items)    | 0 / 5          |
| person-attribute           | 5 / 5 (pack entity items)    | 0 / 5          |
| visit                      | 9 / 9                        | 0 / 9          |
| location-service           | 6 / 6 (business_logic)       | 6 / 6          |

Pack recall collapses from 32/32 = `1.0` to 6/32 ≈ `0.1875` — a `-0.8125` delta
that easily exceeds the default `0.05` threshold and flips the verdict to
`fail`.

## Post-Restore Run (Adapter Restored)

Command: `npx tsx scripts/run-evaluation.ts --framework spring-classic`

```
### Framework: spring-classic

| Metric              | Current | Baseline |   Δ    | Direction | Verdict |
|---------------------|--------:|---------:|-------:|-----------|---------|
| Pack recall         |  1.000  |  1.000   | +0.000 |     =     |  pass   |
| Gap-fill precision  |   n/a   |   n/a    |  n/a   |  ↓ worse  |  pass   |
| Gap-fill recall     |  0.000  |  0.000   | +0.000 |     =     |  pass   |
| Duplication rate    |   n/a   |   n/a    |  n/a   |  ↓ better |  pass   |
| Hallucination rate  |   n/a   |   n/a    |  n/a   |  ↓ better |  pass   |

OVERALL: PASS
```

Exit code: `0`.

A full `--all` run was also executed after restore — all three frameworks
(`django`, `rails`, `spring-classic`) produced `OVERALL: PASS` with exit code
`0`, confirming no collateral damage.

## Git-Diff Verification

After restore, `git diff discovery-service/src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`
is empty (modulo the pre-existing LF/CRLF warning on Windows), confirming the
sabotage was fully reverted.

## How to Re-Run This Procedure

If you ever need to re-verify the harness catches a regression (for example
after a CI change, a baseline update, or a refactor of the evaluation runner),
follow these steps:

1. From a clean working tree, run
   `cd discovery-service && npx tsx scripts/run-evaluation.ts --framework spring-classic`
   and confirm exit code `0`.
2. Apply a one-line sabotage to
   `src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`.
   Recommended: change `hasAnnotation(cls.annotations, 'Entity')` in
   `processJpaEntity` to `hasAnnotation(cls.annotations, '__SABOTAGED_Entity')`.
3. Re-run the evaluation. Confirm exit code `1`, `OVERALL: FAIL`, and a
   `packRecall` verdict of `fail` with a `decrease` delta exceeding `0.05`.
4. Restore the file with `git checkout src/services/extensionPacks/frameworkAdapters/springClassic/index.ts`.
5. Re-run the evaluation and confirm exit code `0` again.
6. Run `git diff` and confirm no adapter changes remain.

## Outcome

The V3 evaluation harness correctly gates spring-classic pack regressions:
a one-line pack-detection break produced `packRecall = 0.1875`, a `-0.8125`
delta against the committed baseline, a `fail` verdict, and exit code `1`.
The harness is ready to gate Spec-4 pack migrations.
