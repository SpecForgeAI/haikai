# Discovery Run Scoring Rubric

This document is the scoring authority for discovery-run performance
analysis. The LLM scorer reads this file as part of its system prompt
and produces a structured JSON score per run, which is then formatted
into a per-run markdown file under `runs/` and a row in `scoresheet.md`.

The rubric is designed to be:

- **Type-aware** — each of the 13 candidate types has its own expectations
  for what "good" looks like (e.g. `interfaces` should be adapter-heavy on
  Java; `logical_data_entities` LLM-heavy is fine).
- **Repo-internal** — the score reflects whether the run's counts and
  samples are plausible **for the scoped repo**. The golden run for a
  pack combo is a *score* calibration anchor only — counts vary repo to
  repo and MUST NOT be compared between runs. (A 50-controller microservice
  legitimately has fewer interfaces than a 200-controller monolith.) When
  no golden exists for the pack, scoring is absolute and the result is
  tagged `confidence: 'no-baseline'`.
- **Evidence-gated absence** — types with count 0 default to
  `Coverage = 5` (nothing was missed) UNLESS a deterministic flag
  explicitly confirms the type was expected for this run. A backend
  service without a database, an ETL worker, a stateless gateway — all
  legitimately have 0 `physical_data_entities` and must not be penalised
  for that. The deterministic heuristics gate "expected presence"
  signals (Repository/Dao classes, `@Transactional`, JDBC bean factories,
  …) and only raise the absence flag when those signals are present.
- **Anomaly-aware** — deterministic heuristic checks (see
  `services/performanceHeuristics.ts`) flag obvious gaps before the LLM
  scoring, so flags like "Spring web app + 0 controllers" reach the LLM
  as pre-computed signals, not heuristic guesses.

---

## Per-type scoring

For each of the 13 candidate types, the LLM rates four axes on a 0–5
scale. The per-type score is the unweighted mean of the four axes.

### Axes

| Axis | Question | What 5 looks like | What 0 looks like |
|---|---|---|---|
| **Coverage** | Given the **scoped repo** (NOT the golden anchor), is the count plausible? Cross-reference: scope path, files-analysed, the kinds of candidates actually in the sample, and any deterministic flags. | Count fits what the scope/sample/flags suggest should be present. Type genuinely absent from the scope and no deterministic flag says it should exist → also a 5 (nothing was missed). | A deterministic flag confirms the type was expected (e.g. `jpa-pack-no-entities` fires only when DB-layer evidence is also present), and the count is 0 or implausibly low. OR count is implausibly high (≥10× what the scope suggests). **Never** scored 0 just because the count is below another run's count. |
| **Accuracy** | Sample 10 candidates of this type. How many are real architectural elements vs hallucinations / boilerplate / mis-classifications? | 10/10 are real. | <5/10 are real. |
| **Metadata richness** | Of the structured-data fields the type SHOULD have (per the field map below), what % are populated? | ≥90% populated, including optional context fields. | <30% populated; bare names with no structure. |
| **Provenance balance** | Is the adapter-vs-LLM split appropriate for this type given the active language/framework pack? | Adapter-heavy where the pack is supposed to cover it; LLM-heavy where the pack genuinely cannot see (e.g. cross-language refs). | Adapter-supported types are 100% LLM (pack failed) or pack-only types are 100% LLM (over-emission). |

**Count-zero scoring is BINARY, not gradient.** When a type has count = 0,
either the absence is genuinely correct or it's a real gap. There is **no
middle ground** based on partial / circumstantial evidence. Pick one:

- **Correct absence → ALL FOUR axes = 5** (Coverage, Accuracy, Metadata
  richness, Provenance balance). Per-type score = 5.0. There are no rows,
  so Accuracy / Metadata are not assessable (treat as 5 = "no problems
  to score") and Provenance has nothing to balance (also 5).
- **Real gap → Coverage ≤ 1** (the type was expected but missing) and
  Provenance ≤ 1 (the adapter should have emitted but didn't). Accuracy
  / Metadata stay at 5 if there are still no rows to fault, but the
  per-type score lands ≤ 3.

To decide between "correct absence" and "real gap", apply these rules in
order:

1. **No deterministic flag for this type → correct absence (score 5.0).**
2. **Deterministic flag fires + real persistence-layer code in samples →
   real gap.** Examples of "real persistence-layer code": `@Entity` /
   `@Table` / `@MappedSuperclass` annotations on classes that look like
   domain models; ORM mapping files (`*.hbm.xml`, `persistence.xml`);
   genuine domain-table SQL in `JdbcTemplate` calls (e.g.
   `INSERT INTO orders (...) VALUES (...)` not just admin
   `SELECT COUNT(*) FROM cache_metadata`); Liquibase / Flyway change-sets
   referencing domain tables.
3. **Deterministic flag fires + ONLY config / naming hints in samples →
   correct absence (score 5.0).** **Configuration naming is not
   persistence evidence.** None of the following count as "real
   persistence-layer code" — they're operational plumbing or naming
   conventions, not actual domain persistence:
     - An imported XML resource named `*-dataSource.xml` /
       `*-jdbc.xml` / `applicationContext-database.xml`. Many UI /
       aggregator services import a DataSource for use by Coherence,
       DataFabric, or external libraries; that's not the same as having
       entities to persist.
     - Class names containing "Database", "Persistence", "Repository",
       "Dao", "Storage", "Store" without any of the real-persistence
       evidence above. `DatabaseService` is a class name; it tells you
       nothing about whether the service holds `@Entity` classes.
     - `DataSource` / `JdbcTemplate` / `EntityManagerFactory` *bean
       factory definitions* without corresponding entity classes or
       domain-table SQL. The bean exists for downstream consumers to
       wire — that doesn't mean *this* service persists anything.
     - "Repository" classes that are proprietary cache / data-grid
       patterns (Oracle Coherence, DataFabric, custom in-memory stores),
       not Spring Data JPA repositories.
     - JdbcTemplate used only for operational / admin queries (cache
       stats, table size diagnostics, audit logs), not for domain entity
       persistence.
     - UI / aggregator / API-gateway / ETL / cache-grid services where
       the data layer is genuinely not in scope.
   In this case **explicitly note the override in `reasoning`**: "Flag
   fired but samples show only configuration / naming hints, not
   persistence-layer code; 0 rows is correct; all axes 5."

**Count-positive scoring rules:**

4. **Count > 0 → Coverage based on plausibility for the scoped repo.**
   Sample-shape, file-count, and adapter share inform plausibility — not
   the golden's count.
5. **Never compare counts to the golden anchor.** The golden is a different
   repo. Use the golden ONLY for score calibration ("what 4.5 looks like
   on this pack"), never as a count benchmark.

### Required structured-metadata fields per type

Used by the **Metadata richness** axis. The percentage = populated / required for each candidate, averaged across the type's rows.

| Type | Required (per candidate) | Optional context |
|---|---|---|
| `interfaces` | `name`, plus AT LEAST ONE of `controllerType`, `springConfigKind`, `serviceInterfaceKind`, `feignName`, `className` | `packageName`, `enabledFeatures`, `importedConfigs`, `componentScanPackages`, `xmlBeanIds` |
| `endpoints` | `httpMethod` AND ONE of `fullPath`/`path`/`url`; OR `endpoint_subtype` ∈ {message-listener, scheduled, event-listener} with destination/cron context | `controllerClassName`, `methodName`, `responseType`, `requestBodyType`, `unwrappedReturnType` |
| `logical_data_entities` | `name` (a class identifier) | `className`, `packageName`, `source` |
| `logical_data_attributes` | `logicalEntityName`, `fieldName` (after auto-derive from `Class.field` names) | `dataType` |
| `physical_data_entities` | `name` (entity or table) | `entityClassName`, `tableName`, `schema`, `catalog`, `packageName` |
| `physical_data_attributes` | `entityClassName`, `fieldName`, `columnName` | `fieldType`, `isPrimaryKey`, `isNullable`, `inheritedFrom`, `hasColumnAnnotation`, `hasIdAnnotation` |
| `logical_data_entity_relationships` | `sourceEntity`, `targetEntity` | `cardinality`, `relationshipType`, `fieldName`, `inheritedFrom` |
| `interface_logical_entities` | `interfaceClassName`, `logicalEntityName` | (none) |
| `logical_data_entity_physical_data_entities` | `logicalEntityName`, `physicalEntityName` | `physicalTableName`, `source` |
| `logical_data_attribute_physical_data_attributes` | `logicalEntityName`, `logicalAttributeName`, `physicalAttributeName` | `physicalColumnName`, `source` |
| `business_logics` | `className`, plus `name` (method) | `returnType`, `parameterCount`, `beanKind`, `beanName`, `adviceKind`, `pointcutExpression` |
| `ui_screens` | `name` (route or screen identifier) | `route`, `controllerName`, `templateUrl`, `routerKind` |
| `ui_components` | `name` | `component_type`, `registrationMethod`, `selector`, `className` |

A row is fully metadata-rich when ALL required fields are populated. Optional context fields raise the row's perceived signal but don't count toward the % gate.

### Logical↔physical mapping types — scoring notes

`logical_data_entity_physical_data_entities` and
`logical_data_attribute_physical_data_attributes` are pure 1:1 link
relationships emitted by adapters that have already extracted both
sides. Treat them as follows:

- **Absence is correct (all four axes 5)** when the run's samples show
  no JPA `@Entity`, no Hibernate HBM XML, no TypeORM `@Entity` — i.e.,
  the codebase has no ORM-mapped persistence at all (pure REST gateway,
  ETL worker, frontend SPA, pre-JPA JDBC-only service, …). The
  `logical_data_entities` and `physical_data_entities` counts may also
  be 0; the absence of links is a downstream consequence.
- **Absence is a gap** when the run emits BOTH `logical_data_entities`
  (with `source: 'jpa-entity'`) AND `physical_data_entities` (with
  `entityClassName` set) but emits 0 link rows. This is an adapter bug
  — the pack saw both sides but failed to connect them. Coverage and
  Provenance both ≤ 1.
- **Coverage** for count-positive runs: ratio of linked pairs to
  unlinked logical entities of the same source. Near 1.0 (every JPA
  entity is linked) → score 5; partial linking suggests an extractor
  gap.
- **Provenance balance**: these types should be ~100% adapter (the
  signal is explicit annotations / XML mappings, no LLM reasoning
  required). LLM-emitted link rows are suspicious — likely
  hallucinations.
- **Metadata richness**: the entity-link type requires
  `logicalEntityName` + `physicalEntityName`; the attribute-link type
  also requires `logicalAttributeName` + `physicalAttributeName`. Both
  should additionally carry `physicalTableName` / `physicalColumnName`
  context — count these as optional richness, not as required.
- **Accuracy**: spot-check that linked names match — `Customer` (logical)
  → `customers` (physical) is plausible; `Customer` → `orders` is a bug.

### Per-type weighting (used to compute the run-level overall)

Different services emphasise different surfaces. The LLM is told which weight set applies based on the pack combo. Weight sets:

#### `backend-service` (default for Java/Spring/Spring-Boot/Hibernate, .NET, Rails-API, Django, Flask, etc.)

| Type | Weight |
|---|--:|
| `interfaces` | 1.5 |
| `endpoints` | 1.5 |
| `physical_data_entities` | 1.5 |
| `physical_data_attributes` | 1.0 |
| `logical_data_entity_relationships` | 1.0 |
| `business_logics` | 1.5 |
| `interface_logical_entities` | 1.0 |
| `logical_data_entity_physical_data_entities` | 1.0 |
| `logical_data_attribute_physical_data_attributes` | 0.7 |
| `logical_data_entities` | 0.7 |
| `logical_data_attributes` | 0.5 |
| `ui_screens` | 0.0 |
| `ui_components` | 0.0 |

#### `frontend-spa` (React, Angular, AngularJS, Vue, etc.)

| Type | Weight |
|---|--:|
| `ui_screens` | 1.5 |
| `ui_components` | 1.5 |
| `interfaces` | 1.0 |
| `endpoints` | 1.5 |
| `business_logics` | 1.0 |
| `logical_data_entities` | 1.0 |
| `logical_data_attributes` | 0.7 |
| `physical_data_entities` | 0.0 |
| `physical_data_attributes` | 0.0 |
| `logical_data_entity_relationships` | 0.0 |
| `logical_data_entity_physical_data_entities` | 0.0 |
| `logical_data_attribute_physical_data_attributes` | 0.0 |
| `interface_logical_entities` | 0.7 |

#### `fullstack-monolith` (server-rendered, e.g. Wordpress, Magento, classic Rails, JSP-based Spring)

| Type | Weight |
|---|--:|
| Everything | 1.0 (all 13 types contribute equally) |

A row's pack combo selects the weight set; types with weight 0.0 are SKIPPED from the overall calculation entirely (not zero-scored).

---

## Cross-cutting axes (run-level)

Independent of any single type, the run is scored on four cross-cutting
axes (0–5 each) that capture overall run health.

| Axis | What 5 looks like | What 0 looks like |
|---|---|---|
| **Determinism** | Adapter share is appropriate for the pack: ~60–80% on annotation-rich Java/Spring or .NET stacks; lower on dynamic languages. Deterministic provenance dominates LLM where the pack is designed to cover it. | <30% adapter share on a pack that's supposed to fully cover the language (suggests pack failure). Or 100% adapter with no LLM contribution at all (suggests gap-fill stage skipped or failed). |
| **Hallucination rate** | <5% of LLM rows are clearly ungrounded (e.g. fictitious endpoint paths, ALL_CAPS constants emitted as classes, generic method names like `size`/`union` as business_logics). | >25% of LLM rows are clearly ungrounded. |
| **Coverage of obvious gaps** | All deterministic heuristic checks pass (no flags raised). | Multiple suspicious flags ("Spring web app + 0 controllers", "JPA pack + 0 entities", etc.). |
| **Cost** | $/run is in line with pack norms; no runaway prompt sizes. | $/run substantially above norm (e.g. >2× the prior best run on the same pack). |

The run-level overall is computed as:

```
overall = 0.60 * weighted_mean(per_type_scores)
       + 0.40 * mean(cross_cutting_axis_scores)
```

The 60/40 weighting prioritises type-level signal (which is fine-grained and codebase-specific) while still giving cross-cutting axes a meaningful voice (they catch systemic issues a per-type rollup might mask).

---

## Score interpretation

| Overall | Interpretation |
|---|---|
| 4.5–5.0 | Excellent. Production-quality coverage with minor gaps only. The architectural picture from this run can be trusted with light review. |
| 3.5–4.4 | Good. Most surfaces covered; some types weak but the dominant types are sound. Standard review burden. |
| 2.5–3.4 | Mixed. At least one major type missing or noisy. Review burden high. Likely a pack/framework mismatch or a missing extractor. |
| 1.5–2.4 | Poor. Multiple major surfaces missing or hallucinated. Don't trust this run without re-scanning. |
| 0–1.4 | Failed. The pack didn't fire, or the run produced largely noise. |

---

## Output schema (what the LLM emits)

The scorer writes a JSON object with this shape (validated by `performancePostRun.ts`):

```json
{
  "runId": "string",
  "scoredAt": "ISO 8601 timestamp",
  "rubricVersion": "1",
  "packCombo": { "language": "Java", "frameworks": ["Spring (classic)", "Hibernate"] },
  "weightSet": "backend-service",
  "goldenAnchor": { "runId": "string|null", "score": "number|null" },
  "deterministicFlags": [
    { "code": "string", "severity": "info|warn|suspicious", "message": "string" }
  ],
  "perType": {
    "interfaces": {
      "count": 124,
      "axes": { "coverage": 4, "accuracy": 5, "metadataRichness": 5, "provenanceBalance": 5 },
      "score": 4.75,
      "reasoning": "string — 1-3 sentences explaining the score"
    },
    "endpoints": { "...": "..." },
    "...": "..."
  },
  "crossCutting": {
    "determinism": 4,
    "hallucinationRate": 4,
    "coverageOfObviousGaps": 5,
    "cost": 4
  },
  "overall": 4.2,
  "confidence": "baseline-anchored | no-baseline",
  "anomalies": [
    "string — free-text notes about anything notable"
  ]
}
```

## Scorer constraints

- **No fabricated counts.** The LLM is given the exact counts and samples; it must not invent numbers.
- **Every score has a `reasoning` field.** Per-type reasoning is 1–3 sentences. Cross-cutting reasoning rolls up into `anomalies[]`.
- **Decimal scores allowed.** Per-axis scores are integers 0–5; per-type and overall use one decimal place.

### How to treat deterministic flags

Deterministic flags are **HEURISTIC HINTS, not commands**. They mark
patterns worth investigating, but the heuristics are crude and routinely
produce false positives (e.g. flagging "missing JPA entities" because a
class is named `XyzRepository` when in fact it's a proprietary cache or
data-grid pattern, not a Spring Data repository).

The LLM scorer's job, when a flag fires, is to:

1. **Read the actual candidate samples for the affected type.** If the
   samples confirm the gap (e.g. clear JPA `@Entity` evidence somewhere
   else but 0 `physical_data_entities` extracted), honour the flag and
   score Coverage low.
2. **Look for refuting evidence.** If the samples show the codebase is a
   UI layer / aggregator / API gateway / ETL worker / cache-only
   service, or the only "Repository" classes are proprietary
   non-JPA patterns (Coherence, DataFabric, in-memory grid abstractions),
   or the only JDBC use is admin/operational queries — the flag is a
   FALSE POSITIVE.
3. **When the flag is a false positive, OVERRIDE it explicitly.** For
   **count-zero types** the override is binary per the rules in
   "Count-zero scoring is BINARY, not gradient" above — score **all four
   axes (Coverage, Accuracy, Metadata, Provenance) as 5** so the per-type
   score is 5.0. Do not split the difference based on partial /
   circumstantial evidence (XML naming, class-name hints, downstream
   bean factories — see the explicit not-evidence list above). Either
   the codebase has real persistence-layer code in its samples (`@Entity`,
   `@Table`, ORM mapping files, domain-table SQL), in which case the
   flag is correct; or it doesn't, in which case the flag is a false
   positive and the absence is correct. Call out the override in
   `reasoning`:
   *"Flag X fired but samples show only configuration / naming hints,
   not real persistence-layer code; 0 rows is correct; all axes 5."*
4. **Reflect the override in `anomalies[]`** so reviewers can audit
   when and why the heuristic was wrong, which feeds back into
   tightening it.

The LLM's reasoned analysis of the actual samples ALWAYS takes
precedence over the heuristic flag. A flag is a question
("is something missing here?"), not a verdict.
