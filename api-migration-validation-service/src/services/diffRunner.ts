import { archModelClient as defaultArchModelClient } from './archModelClient';
import type {
  ApiBehaviourDiffDto,
  ApiBehaviourDiffItemDto,
  ApiBehaviourDiffStatusClassification,
  ApiBehaviourDiffBodyClassification,
  BaselineItemDto,
  CreateApiBehaviourDiffItemRequest,
} from './archModelClient';
import { runManager as defaultRunManager, RunManager } from './runManager';
import { compareJsonShapes } from './jsonShapeComparator';
import { classifyDiffItem as defaultClassifyDiffItem } from './findingEmissionRules';

/**
 * Deterministic diff runner. Walks a paired source / target API behaviour
 * baseline, classifies each scenario, and persists the structured drift
 * into AMS.
 *
 * Spec: 2026-05-25 API Test Harness -- Diff Engine -- Task Group 3.
 * Spec: 2026-05-25 API Test Harness -- Findings Integration -- Task Group 2
 *   adds the finding-emission tail block after the PATCH to
 *   `status='completed'`. Fail-soft: any per-finding emission error is
 *   logged and skipped; the diff stays `status='completed'`. The block
 *   begins with a MANDATORY (NOT defensive) call to
 *   `archModelClient.deleteFindingsByApiBehaviourDiffId(diffId)` so
 *   recompute does not accumulate duplicate findings (the
 *   `api_behaviour_diff_id ON DELETE CASCADE` only fires on diff-row
 *   deletion; recompute keeps the diff row alive while replacing
 *   diff_items). See accepted Q6 + the regression test in
 *   `diffRunner.test.ts`.
 *
 * Lifecycle:
 *   1. Load the diff row via `archModelClient.getDiff`. Verify
 *      `status='computing'` -- defense in depth against re-entrant calls.
 *   2. Load source baseline items via `listBaselineItems` (the source
 *      baseline is `kind='current'`).
 *   3. Load target baseline items via `listBaselineItems`.
 *   4. Verify the target baseline is finalised (`status='active'`); if it's
 *      still `draft`, PATCH the diff to `failed` with the canonical error
 *      code and exit. The route handler also rejects this case upfront with
 *      HTTP 400 -- the runner is belt-and-braces.
 *   5. Build maps keyed by `${method}|${path}|${scenarioName}` for both
 *      sides.
 *   6. For each source item: find paired target by composite key; classify
 *      (`status_match` / `status_drift`, body via `compareJsonShapes`); if
 *      no target match, classify `source_only` with notes carrying the
 *      reason (`mutating_skipped` / `transport_failure` / `no_paired_target`).
 *   7. For target items with no source match: classify `target_only`
 *      (forward-compat; should not appear in v1 since replay is
 *      source-driven).
 *   8. Persist all diff_items via `createDiffItem` and KEEP the returned
 *      DTOs in scope (their ids are needed for the finding-emission link
 *      step).
 *   9. PATCH the diff to `status='completed'` with the count summary +
 *      `computed_at` + both baselines' `updated_at` snapshots.
 *  10. **Finding emission (Spec #6 tail block).** First, MANDATORY call to
 *      `deleteFindingsByApiBehaviourDiffId(diffId)` to clear any prior
 *      diff-sourced findings (load-bearing for recompute). Then, for each
 *      persisted diff_item, call `classifyDiffItem(item)` and -- when
 *      `shouldEmit=true` -- POST a discovery_finding row to AMS with an
 *      inline link to the originating diff_item. Fail-soft.
 *  11. On any unrecoverable error in steps 1-9, PATCH the diff to
 *      `status='failed'` with `error_message` and exit cleanly. (Errors in
 *      step 10 do NOT fail the diff -- they are logged and skipped.)
 *
 * Reuses `runManager` with `diffId` in the `sessionId` slot -- see the
 * inline comment at the `start(...)` call. Accepted Q5 / requirements F5.
 *
 * `compareJsonShapes` performs the critical Step 1 wrapper-unwrap
 * normalisation so the source-raw vs target-wrapped `response_json` shapes
 * pair correctly. See `jsonShapeComparator.ts` for details.
 */

export interface DiffRunnerDeps {
  archModelClient?: typeof defaultArchModelClient;
  runManager?: RunManager;
  now?: () => number;
  /** Pure classifier; injectable for tests. */
  classifyDiffItem?: typeof defaultClassifyDiffItem;
}

/**
 * Build the composite key used to pair source and target baseline items.
 * Components are joined with `|` -- not a character that legitimately
 * appears in HTTP method names or scenario names; `path` may contain
 * slashes which are fine in this context.
 */
function pairKey(item: BaselineItemDto): string {
  const method = (item.method ?? 'GET').toUpperCase();
  const path = item.path ?? '/';
  const scenario = item.scenario_name ?? '';
  return `${method}|${path}|${scenario}`;
}

/**
 * Heuristic for deriving the `notes` reason on a `source_only` diff_item.
 *
 * The runner inspects the source item's persisted `business_notes` for
 * hints emitted by Spec #4's replay runner (`mutating_skipped` and
 * `transport_failure` are surfaced via captures + diagnostics, not the
 * baseline item itself). Since target items are only PROMOTED for
 * scenarios that produced captures, the absence of a target item is the
 * primary signal: by default it's `no_paired_target`. The heuristic is
 * deliberately conservative -- if we can't tell, we default rather than
 * misclassify.
 */
function deriveSourceOnlyNotes(sourceItem: BaselineItemDto): string {
  const notes = sourceItem.business_notes ?? '';
  if (typeof notes === 'string') {
    const lower = notes.toLowerCase();
    if (lower.includes('mutating_skipped') || lower.includes('mutating skipped')) {
      return 'mutating_skipped';
    }
    if (
      lower.includes('transport_failure') ||
      lower.includes('transport failure')
    ) {
      return 'transport_failure';
    }
  }
  return 'no_paired_target';
}

interface ClassificationCounts {
  matched: number;
  status_drift: number;
  body_shape_drift: number;
  body_value_drift: number;
  source_only: number;
  target_only: number;
}

function freshCounts(): ClassificationCounts {
  return {
    matched: 0,
    status_drift: 0,
    body_shape_drift: 0,
    body_value_drift: 0,
    source_only: 0,
    target_only: 0,
  };
}

/**
 * Drive a single diff run end-to-end. Throws only when `runManager.start`
 * rejects the diffId as already-running (the route handler catches and
 * returns HTTP 409); every other failure path is captured into the diff
 * row via PATCH `status='failed'` + `error_message`.
 */
export async function runDiff(
  diffId: string,
  deps: DiffRunnerDeps = {},
): Promise<void> {
  const archModelClient = deps.archModelClient ?? defaultArchModelClient;
  const runManager = deps.runManager ?? defaultRunManager;
  const now = deps.now ?? (() => Date.now());
  const classifyDiffItem = deps.classifyDiffItem ?? defaultClassifyDiffItem;

  // We need projectId for ALL subsequent AMS calls. The diff row carries
  // it, but we cannot fetch the diff until we have projectId. The AMS
  // endpoint for `getDiff` is per-project, so the caller (route handler /
  // auto-trigger) must already have projectId in scope. We retrieve it by
  // delegating to the caller indirectly: this function trusts the caller
  // has passed a valid diffId pointing at an existing diff row whose
  // projectId we re-resolve via the `listDiffsBySourceBaselineId` path
  // would also require knowledge -- instead, we accept that the diff
  // runner needs the projectId via the diff row itself. The route handler
  // creates the diff row first (yielding projectId in the returned DTO),
  // then invokes `runDiff(diffId)`. The runner re-loads the diff row to
  // get a fresh snapshot; for that load we need projectId -- which we
  // cannot have without the diff row. Resolve via a per-project cross-
  // listing isn't realistic.
  //
  // The pragmatic contract: callers MUST pass `projectId` alongside via
  // the runManager registration (the route handler calls `runManager.start
  // ({ sessionId: diffId, projectId, architectureId })` BEFORE invoking
  // runDiff). We read projectId off the runManager state. The auto-trigger
  // in targetReplayRunner.ts does the same.
  //
  // NOTE: We reuse runManager (Spec #4) for diff runs. The `sessionId`
  // field also holds diffIds here -- diff runs have no session of their
  // own. The per-scenario counters on the run object stay unpopulated
  // (harmless). See requirements F5 / accepted Q5 for the decision
  // rationale.
  const runState = runManager.get(diffId);
  if (!runState) {
    // Defense in depth: if the caller forgot to register the run, register
    // it now so the cancel hook still works. We need projectId from the
    // diff row -- but we can't fetch it without projectId. Bail out with a
    // descriptive error; this is a programmer-error path.
    throw new Error(
      `diffRunner: no runManager entry for diffId=${diffId} -- ` +
        `caller MUST register via runManager.start({ sessionId: diffId, projectId, architectureId }) ` +
        `before invoking runDiff`,
    );
  }
  const projectId = runState.projectId;

  let diff: ApiBehaviourDiffDto | undefined;
  // Persisted diff_items kept in scope so the post-completion finding
  // emission tail block can iterate them without a round-trip to AMS.
  const persistedDiffItems: ApiBehaviourDiffItemDto[] = [];
  let architectureId: string | undefined;
  let completedSuccessfully = false;

  try {
    // ------------------------------------------------------------------
    // 1) Load diff + validate status
    // ------------------------------------------------------------------
    diff = await archModelClient.getDiff(projectId, diffId);
    architectureId = diff.architecture_id;
    if (diff.status !== 'computing') {
      // Either already completed or failed. Don't double-run; surface a
      // diagnostic and return.
      console.warn(
        `[diffRunner] op=skip diffId=${diffId.slice(0, 8)} reason=status=${diff.status}`,
      );
      return;
    }

    // ------------------------------------------------------------------
    // 2) Verify target baseline is finalised
    // ------------------------------------------------------------------
    const targetBaseline = await archModelClient.getBaseline(
      projectId,
      diff.target_baseline_id,
    );
    if (targetBaseline.status === 'draft') {
      await archModelClient.updateDiff(projectId, diffId, {
        status: 'failed',
        error_message: 'target_baseline_not_finalised',
      });
      console.warn(
        `[diffRunner] op=fail diffId=${diffId.slice(0, 8)} reason=target_baseline_not_finalised`,
      );
      return;
    }
    const sourceBaseline = await archModelClient.getBaseline(
      projectId,
      diff.source_baseline_id,
    );

    // ------------------------------------------------------------------
    // 3) Load both sides' baseline items
    // ------------------------------------------------------------------
    const sourceItems = await archModelClient.listBaselineItems(
      projectId,
      diff.source_baseline_id,
    );
    const targetItems = await archModelClient.listBaselineItems(
      projectId,
      diff.target_baseline_id,
    );

    console.log(
      `[diffRunner] op=start diffId=${diffId.slice(0, 8)} ` +
        `source=${diff.source_baseline_id.slice(0, 8)}(${sourceItems.length} items) ` +
        `target=${diff.target_baseline_id.slice(0, 8)}(${targetItems.length} items)`,
    );

    // ------------------------------------------------------------------
    // 4) Build composite-key maps for both sides
    // ------------------------------------------------------------------
    const sourceByKey = new Map<string, BaselineItemDto>();
    for (const it of sourceItems) sourceByKey.set(pairKey(it), it);
    const targetByKey = new Map<string, BaselineItemDto>();
    for (const it of targetItems) targetByKey.set(pairKey(it), it);

    // ------------------------------------------------------------------
    // 5) Classify each source item; persist diff_items
    // ------------------------------------------------------------------
    const counts = freshCounts();

    for (const sourceItem of sourceItems) {
      const key = pairKey(sourceItem);
      const targetItem = targetByKey.get(key);
      // baseRequest carries everything EXCEPT the classification fields,
      // which are filled in per-branch below before persistence.
      const baseRequest: Omit<
        CreateApiBehaviourDiffItemRequest,
        'status_classification' | 'body_classification' | 'body_diff_json' | 'notes'
      > = {
        diff_id: diffId,
        method: (sourceItem.method ?? 'GET').toUpperCase(),
        path: sourceItem.path ?? '/',
        scenario_name: sourceItem.scenario_name ?? '',
        source_baseline_item_id: sourceItem.id,
        target_baseline_item_id: targetItem?.id ?? null,
        source_response_status: sourceItem.response_status ?? null,
        target_response_status: targetItem?.response_status ?? null,
      };

      let statusClassification: ApiBehaviourDiffStatusClassification;
      let bodyClassification: ApiBehaviourDiffBodyClassification | null = null;
      let bodyDiffJson: Record<string, unknown> | null = null;
      let notes: string | null = null;

      if (!targetItem) {
        statusClassification = 'source_only';
        notes = deriveSourceOnlyNotes(sourceItem);
        counts.source_only += 1;
      } else {
        // Status classification -- single bucket per accepted Q6. Raw codes
        // are persisted via base.source_response_status / target_response_status.
        const sStatus = sourceItem.response_status ?? null;
        const tStatus = targetItem.response_status ?? null;
        statusClassification = sStatus === tStatus ? 'status_match' : 'status_drift';

        // Body classification via the comparator (which performs the Step 1
        // wrapper unwrap to normalise the source-raw vs target-wrapped
        // `response_json` shapes).
        const cmp = compareJsonShapes(
          sourceItem.response_json,
          targetItem.response_json,
        );
        bodyClassification = cmp.bodyClassification;
        bodyDiffJson =
          cmp.bodyDiffJson.length > 0
            ? { entries: cmp.bodyDiffJson as unknown[] }
            : null;

        // Aggregate counts. Status drift is counted whenever statuses
        // differ, regardless of body classification. Body shape/value drift
        // counted by body classification.
        if (statusClassification === 'status_drift') {
          counts.status_drift += 1;
        }
        if (bodyClassification === 'body_shape_drift') {
          counts.body_shape_drift += 1;
        } else if (bodyClassification === 'body_value_drift') {
          counts.body_value_drift += 1;
        }
        // Matched-bucket only when both status and body match (and no shape
        // drift). The header strip / UI will show non-overlapping buckets.
        if (
          statusClassification === 'status_match' &&
          bodyClassification === 'body_match'
        ) {
          counts.matched += 1;
        }
      }

      try {
        const persisted = await archModelClient.createDiffItem(projectId, diffId, {
          ...baseRequest,
          status_classification: statusClassification,
          body_classification: bodyClassification,
          body_diff_json: bodyDiffJson,
          notes,
        });
        persistedDiffItems.push(persisted);
      } catch (err) {
        // Per-item persistence failure shouldn't kill the whole run --
        // log and continue. The PATCH-summary tail will reflect whatever
        // we managed to persist.
        console.warn(
          `[diffRunner] failed to persist diff_item for ${baseRequest.method} ${baseRequest.path}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // ------------------------------------------------------------------
    // 6) Target_only items -- forward-compat. Should not appear in v1.
    // ------------------------------------------------------------------
    for (const targetItem of targetItems) {
      const key = pairKey(targetItem);
      if (sourceByKey.has(key)) continue;
      counts.target_only += 1;
      try {
        const persisted = await archModelClient.createDiffItem(projectId, diffId, {
          diff_id: diffId,
          method: (targetItem.method ?? 'GET').toUpperCase(),
          path: targetItem.path ?? '/',
          scenario_name: targetItem.scenario_name ?? '',
          source_baseline_item_id: null,
          target_baseline_item_id: targetItem.id,
          status_classification: 'target_only',
          body_classification: null,
          source_response_status: null,
          target_response_status: targetItem.response_status ?? null,
          body_diff_json: null,
          notes: 'target_only',
        });
        persistedDiffItems.push(persisted);
      } catch (err) {
        console.warn(
          `[diffRunner] failed to persist target_only diff_item: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // ------------------------------------------------------------------
    // 7) PATCH the diff to completed with the count summary + snapshots
    // ------------------------------------------------------------------
    await archModelClient.updateDiff(projectId, diffId, {
      status: 'completed',
      matched_count: counts.matched,
      status_drift_count: counts.status_drift,
      body_shape_drift_count: counts.body_shape_drift,
      body_value_drift_count: counts.body_value_drift,
      source_only_count: counts.source_only,
      target_only_count: counts.target_only,
      source_baseline_updated_at: sourceBaseline.updated_at,
      target_baseline_updated_at: targetBaseline.updated_at,
      computed_at: new Date(now()).toISOString(),
    });
    completedSuccessfully = true;

    console.log(
      `[diffRunner] op=complete diffId=${diffId.slice(0, 8)} ` +
        `matched=${counts.matched} status_drift=${counts.status_drift} ` +
        `body_shape_drift=${counts.body_shape_drift} body_value_drift=${counts.body_value_drift} ` +
        `source_only=${counts.source_only} target_only=${counts.target_only}`,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[diffRunner] op=fail diffId=${diffId.slice(0, 8)} reason=${errorMessage}`,
    );
    try {
      await archModelClient.updateDiff(projectId, diffId, {
        status: 'failed',
        error_message: errorMessage,
      });
    } catch (patchErr) {
      console.error(
        `[diffRunner] fail-state PATCH failed: ${
          patchErr instanceof Error ? patchErr.message : String(patchErr)
        }`,
      );
    }
  } finally {
    if (runManager.has(diffId)) {
      runManager.end(diffId);
    }
  }

  // ---------------------------------------------------------------------
  // Finding emission (Spec #6 tail block). Runs ONLY on successful
  // completion. Fail-soft: per-finding errors are logged + skipped; the
  // diff itself stays `status='completed'`.
  // ---------------------------------------------------------------------
  if (!completedSuccessfully || !architectureId) {
    return;
  }

  // STEP 1 (MANDATORY -- load-bearing, NOT defensive): wipe any prior
  // diff-sourced findings for this diff. The `api_behaviour_diff_id ON
  // DELETE CASCADE` only fires when the diff ROW itself is deleted;
  // recompute keeps the diff row alive while replacing diff_items, so
  // without this explicit call findings accumulate across recomputes
  // (2x, 3x, ...). See accepted Q6 + the regression test in
  // `diffRunner.test.ts`.
  try {
    await archModelClient.deleteFindingsByApiBehaviourDiffId(projectId, diffId);
  } catch (err) {
    console.error(
      `[diffRunner] op=finding_recompute_cleanup_failed diffId=${diffId.slice(0, 8)} ` +
        `err=${err instanceof Error ? err.message : String(err)}`,
    );
    // Continue to emission -- better to risk a small duplication than skip
    // the spec entirely. The reviewer can always re-recompute.
  }

  // STEP 2 + 3 + 4: classify, create, link per item. Fail-soft per item.
  let emittedCount = 0;
  let skippedNoEmit = 0;
  for (const item of persistedDiffItems) {
    try {
      const classification = classifyDiffItem(item);
      if (!classification.shouldEmit) {
        skippedNoEmit += 1;
        continue;
      }
      await archModelClient.createDiffFinding(projectId, diffId, {
        finding_type: classification.findingType,
        category: classification.category,
        severity: classification.severity,
        status: 'new',
        title: classification.title,
        summary: classification.summary,
        detail_json: classification.detailJson as unknown as Record<string, unknown>,
        source: 'api_behaviour_diff',
        created_by_stage: 'diffRunner.findingEmission',
        // Inline link to the originating diff_item -- avoids a separate
        // POST /links round-trip. The new AMS controller's createForDiff
        // honours `links` and delegates to persistLinksForDiff which
        // accepts `api_behaviour_diff_item` as a target_type (added to
        // the allowlist in Group 1).
        links: [
          {
            link_type: 'derived_from',
            target_type: 'api_behaviour_diff_item',
            target_id: item.id,
          },
        ],
      });
      emittedCount += 1;
    } catch (err) {
      // Per-finding emission failure: log + skip. Models
      // `discovery-service/.../findings/FindingEmitter.ts` soft-fail.
      console.error(
        `[diffRunner] op=finding_emission_failed diffId=${diffId.slice(0, 8)} ` +
          `diffItemId=${item.id.slice(0, 8)} ` +
          `err=${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  console.log(
    `[diffRunner] op=finding_emission_complete diffId=${diffId.slice(0, 8)} ` +
      `emitted=${emittedCount} skipped_no_emit=${skippedNoEmit} ` +
      `total_items=${persistedDiffItems.length}`,
  );
}
