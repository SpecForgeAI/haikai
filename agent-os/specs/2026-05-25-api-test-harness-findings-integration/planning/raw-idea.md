# Raw Idea: API Test Harness — Findings Integration

## Why this spec exists

Spec #5 (just shipped) produces structured diff items per target-vs-source baseline pair: status drift, body shape drift, body value drift, source-only, target-only. The Drift report tab renders them in a table on the target baseline detail view. That works for one-shot review, but **the diff items don't surface anywhere else**: they don't drive the migration evidence panels, they don't show up in the standard Findings tab, they can't be filtered by severity across multiple migrations, they don't carry reviewer lifecycle (`accepted` / `ignored` / `needs_review` / `resolved`).

The existing `discovery_findings` table (shipped 2026-05-16) is exactly the right shape for this — durable, reviewable, severity-graded, polymorphically linked. It even **pre-declared `api_behaviour_baseline` as a future-but-unused link `target_type`** when it shipped, anticipating this spec. The only blockers are: (a) findings today are scoped to a `run_id NOT NULL` (FK to `discovery_run`), so diff-sourced findings have nowhere to anchor, and (b) the link table's `target_type` vocabulary needs to add `api_behaviour_diff_item` so individual diff items can be referenced.

This spec is the bridge: emit `discovery_findings` rows automatically when a diff completes, link each finding to the diff item that produced it (and through it to the source/target baseline items), surface them in the existing Findings tab AND inline-annotate them on the existing Drift report tab.

This is the **smallest** of the three-spec arc (#4 capture, #5 diff engine, #6 findings integration) because the heavy lifting is done — the diff classifications already exist, the findings infrastructure already exists, the UI surfaces already exist. The work is: a schema unlock, an emission rule set, a typed-client wrapper, and two small UI threadings.

## What this spec is (and isn't)

**This spec is:**

- A schema unlock on `discovery_findings`: make `run_id` nullable, add a nullable `api_behaviour_diff_id` FK to `api_behaviour_diffs`, add a CHECK constraint that exactly one of `run_id` / `api_behaviour_diff_id` is non-null. (Existing findings rows all have `run_id` set; the change is fully backward-compatible.)
- An extension to `discovery_finding_links.target_type` vocabulary: add `api_behaviour_diff_item` (and explicitly remove the "documented-but-unused" caveat from `api_behaviour_baseline`).
- An emission rule set in the diff runner (Spec #5's `diffRunner.ts`): at the end of a successful diff compute, for each diff item, decide whether to emit a finding and which severity to assign, then POST to the AMS findings API. **One finding per drift-classified diff item**; matched items emit nothing.
- A small extension to the existing AMS `discovery_findings` controller / service to accept the new origin shape (either `run_id` or `api_behaviour_diff_id`, with the FK invariant enforced at service layer).
- A new typed-client wrapper exposed by `gateway/src/services/apiBehaviourClient.ts` (or extending the existing `findingsClient` if it exists) for the diff-sourced creation path.
- Frontend: extend the existing `FindingsTab.tsx` to also load diff-sourced findings (filterable by origin: discovery vs api-behaviour-diff). Plus: on the Drift report tab from Spec #5, surface a "findings raised" badge per diff item that opens the same `FindingDetailDrawer` used by the existing Findings tab.
- Reviewer lifecycle (`accepted` / `ignored` / `needs_review` / `resolved`) is **inherited unchanged from the existing findings infrastructure** — same drawer, same `findingsApi.ts`, same status transitions. This spec adds nothing to the reviewer side.

**This spec is not:**

- A new findings table or a parallel findings system. The existing `discovery_findings` table is reused with the smallest possible schema unlock.
- A new Findings page or top-level UI surface. The existing `FindingsTab.tsx` on the Discovery Run Detail View is the main consumer; the Drift report tab is the secondary inline surface.
- A change to severity vocabulary. v1 uses the existing `info` / `low` / `medium` / `high` / `critical` ladder.
- A change to status vocabulary. v1 uses the existing `new` / `accepted` / `ignored` / `needs_review` / `resolved`.
- A change to the existing `FindingsTab.tsx`'s reviewer drawer or status-transition logic.
- A re-emission policy for diff recomputation. v1 deletes the previous diff's findings on recompute and emits fresh ones (matches the diff_items CASCADE pattern Spec #5 already uses).
- LLM-assisted severity classification, finding deduplication across diffs, or "expected drift" overrides. All deferred to a v2 / a future "findings hardening" spec.
- A backfill of findings for diffs that already exist before this spec ships. The auto-emit hook fires on new diff completions; existing diffs would need a manual recompute to surface findings.
- A change to Spec #5's diff_item schema or classifications. The emission rules read the existing fields verbatim.

## Decisions already made (don't re-litigate in shape-spec)

These were settled while drafting this raw idea:

1. **Schema unlock: drop `run_id NOT NULL` + add nullable `api_behaviour_diff_id` + CHECK constraint exactly-one-of.** Cleanest path. Existing rows unaffected. Backward-compatible.
2. **Reuse `discovery_findings`, not a new table.** The shape is already exactly right (severity / status / title / detail_json / reviewer fields). A parallel table would duplicate ~80% of the schema, the JPA layer, the controller, and the frontend.
3. **One finding per drift-classified diff item.** Not one-per-shape-drift-leaf, not one-per-baseline-pair. Each diff item that's non-matching emits at most one finding. Matched items emit nothing.
4. **Emission rules are deterministic, not LLM-assisted.** Maps classifications to severities directly: `status_drift` (2xx→5xx) → critical, `status_drift` (other) → high or medium, `body_shape_drift` → medium, `body_value_drift` → info, `source_only` (mutating_skipped) → info, `source_only` (other) → low, `target_only` → info. Final mapping to be settled in shape-spec.
5. **Auto-emit on diff complete; auto-delete on recompute.** Diff runner appends a finding-emission step at the end of its happy-path; diff recompute CASCADE-deletes the existing findings via the new FK (mirrors how diff_items CASCADE on `diff_id`).
6. **Inline annotation on the Drift report tab + inclusion in the existing Findings tab.** Two surfaces, both reuse the same `FindingDetailDrawer` component for review.
7. **`api_behaviour_diff_item` added to `discovery_finding_links.target_type`.** The link from finding → diff_item is what gives the UI the ability to navigate from a Findings-tab row back to the originating drift item.
8. **No backfill of findings for pre-existing diffs.** Recompute is the user's path to get findings on an existing diff.
9. **Origin filter on the existing Findings tab.** Users can filter to "discovery findings" / "api-behaviour-diff findings" / "all". Add as a new filter dropdown; doesn't disturb existing filters.
10. **One commit per layer** (the established cadence for this arc): AMS DB + Java; validation-service emission; gateway; frontend.

## Specific requirements (rough — let shape-spec refine)

### AMS persistence — schema unlock

**One Liquibase changeset** at the next free slot (Spec #5 landed at 158-159; predicted **160**, verify empirically per the now-standard "ls | sort -V | tail -5" check):

`<N>-discovery-findings-api-behaviour-diff-origin.sql`:

```sql
ALTER TABLE discovery_findings ALTER COLUMN run_id DROP NOT NULL;

ALTER TABLE discovery_findings
  ADD COLUMN api_behaviour_diff_id UUID NULL
  REFERENCES api_behaviour_diffs(id) ON DELETE CASCADE;

CREATE INDEX idx_discovery_finding_api_behaviour_diff_id
  ON discovery_findings (api_behaviour_diff_id)
  WHERE api_behaviour_diff_id IS NOT NULL;

ALTER TABLE discovery_findings
  ADD CONSTRAINT discovery_finding_exactly_one_origin
  CHECK ((run_id IS NOT NULL)::int + (api_behaviour_diff_id IS NOT NULL)::int = 1);

COMMENT ON COLUMN discovery_findings.api_behaviour_diff_id IS
  'Origin: the api_behaviour_diff that produced this finding (alternative to run_id). Exactly one of run_id / api_behaviour_diff_id MUST be non-null. CASCADE deletes findings when the source diff is deleted (mirrors discovery_run cascade for discovery-sourced findings).';

COMMENT ON COLUMN discovery_findings.run_id IS
  'Origin: the discovery_run that produced this finding. Now nullable per 2026-05-25 api-test-harness-findings-integration spec. Exactly one of run_id / api_behaviour_diff_id MUST be non-null. CASCADE intact via fk_discovery_finding_run.';
```

**No changeset needed for the link table vocabulary** — `target_type` is `TEXT` and the existing comment already lists `api_behaviour_baseline` as a future value. New emissions can use `api_behaviour_diff_item` immediately; the controller validates against a service-layer allowlist that we extend, not a DB enum. (If the comment text matters for documentation hygiene, a tiny `COMMENT ON COLUMN` update is fine — but it's not a behaviour change.)

### AMS Java layer

- `DiscoveryFindingEntity` gains `UUID apiBehaviourDiffId` (nullable). Existing `runId` field becomes nullable.
- `DiscoveryFindingDto` (record) gains an optional `apiBehaviourDiffId` field. Backward-compatible delegating constructor for existing callers (same pattern as Spec #4's apibehaviour DTOs).
- `DiscoveryFindingService.createFinding(...)` accepts either origin shape and validates: exactly one of `runId` / `apiBehaviourDiffId` is non-null. Throw `IllegalArgumentException` on violation.
- New service helper: `deleteFindingsByApiBehaviourDiffId(UUID diffId)` — used during diff recompute (and as a defensive measure; the CASCADE FK does the work, but the helper is useful for explicit flows).
- New finder: `DiscoveryFindingRepository#findByApiBehaviourDiffIdOrderByCreatedAtAsc(UUID)`.
- New finder: `DiscoveryFindingRepository#findByLinkTargetTypeAndTargetId(String targetType, String targetId)` — for "show me all findings linked to this specific diff_item" lookups. (May already exist; check first.)
- `DiscoveryFindingLinkService.createLink(...)` extends its target_type allowlist to include `api_behaviour_diff_item` (and remove the "future-but-unused" caveat from `api_behaviour_baseline` if it's still rejected).
- No new controller. Existing `DiscoveryFindingController` endpoints already handle CRUD; the new origin shape and target_type values flow through unchanged.

### `api-migration-validation-service` — emission step

**Extension to `diffRunner.ts`** (~80-120 LOC added):

- At the end of the existing successful-completion path (after the PATCH to `status='completed'`):
  - For each `diff_item` just persisted, classify it via a new `findingEmissionRules.ts` helper.
  - The helper returns `{ shouldEmit: boolean, severity: string, findingType: string, title: string, summary: string }`.
  - For each item where `shouldEmit=true`, call `archModelClient.createFinding(...)` with:
    - `apiBehaviourDiffId` = the current diff's id
    - `projectId`, `architectureId` from the diff
    - `findingType` = one of a small new set (see below)
    - `category` = `'api_behaviour_drift'` (new category value; documented per the existing TEXT-extensibility convention)
    - `severity` = per the rules table below
    - `title` = short human-readable summary (e.g. `"Status drift: GET /orders/{id} (200 → 404)"`)
    - `summary` = longer description
    - `detailJson` = `{ method, path, scenarioName, sourceStatus, targetStatus, classification, bodyDiffJson (truncated if huge) }`
    - `source` = `'api_behaviour_diff'`
    - `createdByStage` = `'diffRunner.findingEmission'`
  - Then call `archModelClient.createFindingLink(...)` once per finding with `targetType='api_behaviour_diff_item'`, `targetId=<diffItem.id>`, `linkType='derived_from'`.
- On recompute: the existing diff_item CASCADE-delete will also cascade-delete findings via the new FK. Defensive belt-and-braces: call `archModelClient.deleteFindingsByApiBehaviourDiffId(diffId)` explicitly before re-emit.
- **Fail-soft**: any finding-emission error is logged and skipped; the diff itself stays `status='completed'`.

**Finding emission rules (v1 deterministic mapping):**

| Diff item classification                              | findingType (new)               | severity         | shouldEmit |
| ----------------------------------------------------- | ------------------------------- | ---------------- | ---------- |
| `status_match` + `body_match`                         | —                               | —                | no         |
| `status_match` + `body_value_drift` only              | `api_behaviour_value_drift`     | `info`           | yes        |
| `status_match` + `body_shape_drift`                   | `api_behaviour_shape_drift`     | `medium`         | yes        |
| `status_drift` (2xx → 5xx OR 2xx → 4xx)              | `api_behaviour_status_drift`    | `critical`       | yes        |
| `status_drift` (2xx → 2xx differing OR other)        | `api_behaviour_status_drift`    | `high`           | yes        |
| `source_only` with notes=`mutating_skipped`           | `api_behaviour_unreplayed`      | `info`           | yes        |
| `source_only` with notes=`transport_failure`          | `api_behaviour_unreplayed`      | `low`            | yes        |
| `source_only` with notes=`no_paired_target`           | `api_behaviour_missing_target`  | `high`           | yes        |
| `target_only`                                         | `api_behaviour_extra_target`    | `info`           | yes        |

Final mapping table is a real product call — flagged as an open question.

### Gateway proxy

- The existing `discovery_findings` proxy routes already work — they don't care about the new origin column.
- No new proxy routes needed unless the spec adds a new dedicated endpoint (which it doesn't — emission goes through the existing `POST /api/projects/{projectId}/findings`).
- Add typed-client wrapper to `gateway/src/services/findingsClient.ts` (or extend the existing client if any) to support the new optional `apiBehaviourDiffId` field on the create payload.

### Frontend

**Extend `frontend/src/api/findingsApi.ts`** — add `apiBehaviourDiffId` to the `DiscoveryFindingDto` type; add an optional `origin` filter param (`'discovery' | 'api_behaviour_diff'`) to `listFindings`.

**Extend `frontend/src/components/Discovery/FindingsTab.tsx`** — add an "Origin" filter dropdown (`All | Discovery | API behaviour drift`). When showing a diff-sourced finding, the row's "Run" column instead shows the source diff's target baseline name with a link to the Drift report tab.

**Extend the Drift report tab from Spec #5** (`frontend/src/components/DashboardView/DriftReportTab.tsx`):

- For each diff_item row, add a "Findings" badge column showing the count of findings linked to that diff_item (looked up via the new `findByLinkTargetTypeAndTargetId` finder, or via a single batch query at tab load).
- Clicking the badge opens the existing `FindingDetailDrawer` component (imported from the Discovery feature) with the linked findings.

**No new components, no new routes.** Pure threading of the existing Findings infrastructure into the API drift surface.

### Tests

- AMS: 4-5 tests (schema CHECK constraint enforcement, FK CASCADE on diff delete, service-layer exactly-one-origin validation, new finder, target_type allowlist extension).
- Validation service: 6-8 tests (each emission rule branch — one per row in the table above; fail-soft on emission error; CASCADE-delete behaviour on recompute).
- Gateway: 1-2 tests (typed-client wrapper accepts new field).
- Frontend: 3-4 tests (origin filter in Findings tab, findings badge on Drift report tab, drawer opens with linked findings).
- Total: ~15-20 tests. Lean — this is a small spec.

### Verification

- After this spec: a fresh target replay → completes → spawns diff → diff completes → findings appear in two places: the existing Findings tab (filterable by origin) AND inline on the Drift report tab as a badge per item.
- Reviewer can transition a diff-sourced finding through `accepted` / `ignored` / `needs_review` / `resolved` via the existing drawer with no new code.
- Diff recompute → old findings deleted via CASCADE → fresh emission.
- `cd architecture-model-service && mvn test-compile` exits 0.

## Out of Scope

- LLM-assisted severity classification or "this drift is expected" overrides.
- Cross-diff finding deduplication.
- A "Findings" top-level page (the FindingsTab is already on the Discovery Run Detail View; this spec adds it to no new locations).
- Backfill of findings for diffs that completed before this spec ships.
- Reviewer workflow changes (status transitions, drawer UI, bulk actions).
- A change to Spec #5's classifications or schema.
- A change to the existing `discovery_findings` reviewer drawer or status-transition logic.
- Findings analytics / dashboards.
- Notification / webhook / email surfaces on finding creation.
- `@JsonNaming` audit for the new field (follows existing snake_case convention; `apiBehaviourDiffId` on the wire becomes `api_behaviour_diff_id` via the existing global Jackson config).

## Dependencies

- `2026-05-25-api-test-harness-diff-engine` (Spec #5, just shipped) — provides `api_behaviour_diffs` + `api_behaviour_diff_items` tables and the `diffRunner.ts` insertion point.
- `2026-05-25-api-test-harness-target-side-capture` (Spec #4, shipped).
- `2026-05-16-discovery-findings-first-class` (shipped) — provides `discovery_findings` + `discovery_finding_links` tables, the AMS Java + DTO surface, the controller, and the frontend `FindingsTab.tsx` + `FindingDetailDrawer` + `findingsApi.ts`.
- No new external dependencies.

## Open questions for shape-spec to clarify

1. **Severity mapping table — is the v1 ladder correct?** The proposed mapping (status_drift 2xx→5xx = critical, status_drift other = high, body_shape_drift = medium, body_value_drift = info, source_only mutating_skipped = info, source_only transport_failure = low, source_only no_paired_target = high, target_only = info) is one reasonable take. Alternative: collapse `body_value_drift` to no-emit (it's noisy by nature). My instinct: **emit `body_value_drift` as `info` so the user can see them but they don't pollute high-severity dashboards**. Confirm or adjust per row.

2. **Origin filter UI placement.** The existing Findings tab has filters in a strip across the top. Add a new "Origin" dropdown to that strip vs. add a tab-pair switcher above it. My instinct: **dropdown in the existing strip** — minimal disruption.

3. **`FindingsTab.tsx` hosting context for diff-sourced findings.** Today the tab is rendered inside the Discovery Run Detail View — implying a single-run scope. Diff-sourced findings have no run. Two options:
   - (a) The existing tab on the Discovery Run Detail View only lists run-sourced findings; diff-sourced findings live exclusively on the Drift report tab.
   - (b) Hoist the FindingsTab to a project-level surface so it can show all findings regardless of origin.
   
   My instinct: **(a) for v1** — keeps the spec tight. The Drift report tab is the canonical surface for diff-sourced findings, and the existing Findings tab keeps showing discovery-sourced findings only. A "unified findings" view is a v2.

4. **`api_behaviour_value_drift` as `info`-only.** If we go with my instinct in Q1, the user might be flooded with low-signal findings for any value-only drift (timestamps, ids, sequence numbers). Confirm we don't want to suppress emission entirely for `body_value_drift`. My instinct: **emit but mark as `info` severity** — that's what the severity ladder is for; users can filter out `info` if they're noisy.

5. **CASCADE-delete on recompute — defensive belt-and-braces?** The FK cascade should handle it automatically; the explicit `deleteFindingsByApiBehaviourDiffId` call is defense in depth. Keep it or skip it? My instinct: **skip it** — trust the FK. If anyone questions whether the delete actually happens, add an integration test rather than redundant code.

6. **Detail-drawer linking from diff-sourced findings.** When a user clicks a diff-sourced finding in the existing Findings tab, the "Source" column today links to the discovery run. For diff-sourced findings the "Source" should link to the target baseline's Drift report tab. My instinct: **yes** — surface a clickable "Open in Drift report" link in the drawer header.

7. **Title and summary content for each emission rule.** The proposed titles are sketches. Should the spec include a final wording table, or leave it to the implementer? My instinct: **spec includes final wording table** — wording is product copy and worth pinning. Implementer follows the table verbatim.

8. **New finding-type values.** Adding 6 new values: `api_behaviour_value_drift`, `api_behaviour_shape_drift`, `api_behaviour_status_drift`, `api_behaviour_unreplayed`, `api_behaviour_missing_target`, `api_behaviour_extra_target`. Confirm the naming convention (snake_case, `api_behaviour_*` prefix to group). My instinct: **yes — the prefix groups them in any future categorisation/filtering**.

9. **New category value `api_behaviour_drift`.** Existing categories: `ambiguity`, `runtime_usage`, `evidence_gap`. The new category is distinct from all three. Confirm. My instinct: **yes — clean separation**.

10. **Commit boundary.** 4-commit per layer (no separate validation-service vs gateway commit needed since gateway changes are trivial and could be bundled), or 5 to match the arc? My instinct: **4 commits**:
    1. AMS DB + Java (schema unlock + service-layer validation + finder + entity/DTO field)
    2. Validation service emission rules + diff runner extension + tests
    3. Gateway typed-client wrapper (small enough that it could be bundled into #4 if you prefer)
    4. Frontend (Findings tab origin filter + Drift report tab findings badge)
    
    Or **3 commits** with gateway folded into validation-service if the diff is genuinely trivial. Shape-spec to decide based on what the gateway diff actually looks like.

11. **No new tests on `discovery_findings` reviewer drawer.** Reviewer status transitions, `accepted` / `ignored` / `needs_review` / `resolved`, drawer UI — all already covered by Spec 2026-05-16. Confirm we add no new tests on those paths even though we're now firing diff-sourced findings into them. My instinct: **yes — they're covered**.

## Verification

After this spec:
- A target replay completes → diff completes → findings appear in the existing Findings tab (filtered to origin=`api_behaviour_diff`) AND as a badge per diff item on the Drift report tab.
- Reviewer actions on diff-sourced findings work via the existing drawer (no new code).
- Diff recompute → CASCADE-deletes old findings → fresh emission with current rules.
- Schema CHECK constraint rejects findings with both or neither origin set.
- All previously-passing tests stay green.

## Commit boundary

Default: 4 commits per layer (AMS DB+Java / validation service emission / gateway typed client / frontend threading). Shape-spec may merge or split.
