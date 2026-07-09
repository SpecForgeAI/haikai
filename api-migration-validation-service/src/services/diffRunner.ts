import { archModelClient as defaultArchModelClient } from './archModelClient';
import type {
  ApiBehaviourDiffDto,
  ApiBehaviourDiffItemDto,
  ApiBehaviourDiffStatusClassification,
  ApiBehaviourDiffBodyClassification,
  ApiBehaviourDiffHeaderClassification,
  BaselineIntegrityDto,
  BaselineItemDto,
  CreateApiBehaviourDiffItemRequest,
} from './archModelClient';
import { runManager as defaultRunManager, RunManager } from './runManager';
import {
  compareJsonShapes,
  type VolatilityContext,
  type VolatilityEnvelope,
} from './jsonShapeComparator';
// Spec 2026-07-06-j: the AMS comparison-waiver set (replaces the in-code
// header allowlist when fetched; null => legacy fallback).
import { fetchWaiverSet } from './comparisonWaivers';
// Spec 2026-07-06-n: state parity for mutating scenarios — compares the
// pre/post effect-table deltas frozen on both sides' baseline items.
import { compareStateDeltas, type StateDeltaJson } from './stateDelta';
import {
  classifyDiffItem as defaultClassifyDiffItem,
  API_BEHAVIOUR_DRIFT_CATEGORY,
} from './findingEmissionRules';
import { createTracer } from '../trace';

// Haikai workflow trace logger (OFF by default; no-op unless HAIKAI_TRACE is
// set). See docs/trace-logging.md. The reconcile/diff flow writes a SUMMARY
// start + terminal line and a per-break DETAIL line. project + arch group the
// whole migration; the diffId is the reconcile sub-thread (corr `run`).
const trace = createTracer('capture-svc');

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
  /**
   * Operation keys (`${METHOD}|${path}`) that carry a
   * `non_deterministic_endpoint` discovery signal (Spring-only, built by
   * `2026-05-30-oracle-integrity-determinism`, emitted by the
   * discovery-service `emissionSources.ts`). When a source item's operation
   * key is in this set, the WHOLE response is treated as VALUE-tolerant
   * (presence / shape still compared) even if the volatility probe recorded
   * nothing -- tagged `endpoint_signal`.
   *
   * Optional + defaults to an empty set, so a reconcile with no signal behaves
   * EXACTLY as the strict path (the backward-compat guard, G1). Tests inject a
   * populated set; the production wiring (or a future fetch) supplies it.
   *
   * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
   * Task Group 3 (sub-tasks 3.2 + 3.4).
   */
  nonDeterministicEndpointKeys?: Set<string>;
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
 * Operation key (`${METHOD}|${path}`) -- the granularity at which the
 * `non_deterministic_endpoint` discovery signal applies. Distinct from
 * {@link pairKey} (which also pins the scenario): the endpoint signal is
 * endpoint-coarse, so it omits the scenario component.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling.
 */
function operationKey(item: BaselineItemDto): string {
  const method = (item.method ?? 'GET').toUpperCase();
  const path = item.path ?? '/';
  return `${method}|${path}`;
}

/**
 * Parse the source baseline item's `volatile_paths_json` into a typed
 * {@link VolatilityEnvelope}, or null when absent / malformed. A `null`
 * envelope yields EXACTLY today's strict comparison (the backward-compat
 * guard, G1) -- so anything we cannot confidently parse degrades to strict.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 3 (sub-tasks 3.2 + 3.6).
 */
function parseVolatilityEnvelope(raw: unknown): VolatilityEnvelope | null {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const source = obj.volatility_source;
  const paths = obj.paths;
  if (typeof source !== 'string') return null;
  const env: VolatilityEnvelope = {
    paths: Array.isArray(paths) ? (paths.filter((p) => typeof p === 'string') as string[]) : [],
    volatility_source: source as VolatilityEnvelope['volatility_source'],
    k: typeof obj.k === 'number' ? obj.k : 0,
  };
  if (Array.isArray(obj.array_paths)) {
    env.array_paths = (obj.array_paths as unknown[]).filter(
      (p) => typeof p === 'string',
    ) as string[];
  }
  return env;
}

/**
 * Build the per-operation {@link VolatilityContext} for a source item.
 * Returns `undefined` when there is no envelope AND no endpoint signal -- in
 * which case the comparator runs the STRICT v1 path unchanged.
 *
 * Heuristics are enabled whenever the path was NOT fully measured by a probe
 * (no envelope, OR a `non_json` / `not_probed` envelope, OR an endpoint
 * signal carries the response). A full / partial `probed` envelope already
 * measured the operation, so the heuristic fallback is suppressed there to
 * avoid a guess shadowing the measurement.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * Task Group 3 (sub-tasks 3.2, 3.4, 3.5).
 */
function buildVolatilityContext(
  envelope: VolatilityEnvelope | null,
  endpointSignal: boolean,
): VolatilityContext | undefined {
  if (!envelope && !endpointSignal) return undefined;
  const probed =
    !!envelope &&
    (envelope.volatility_source === 'probed' ||
      envelope.volatility_source === 'probed_partial');
  return {
    envelope,
    endpointSignal,
    // Heuristic fallback only on paths a probe did NOT measure.
    applyHeuristics: !probed,
  };
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
  // NON-volatile array reorder dimension (Spec 2026-06-17). AMS has NO
  // dedicated ordering count column, so this stays a LOCAL tally only -- it
  // feeds the reconcile trace's "breaks" sum so an ordering-only divergence is
  // counted as a break, without changing the persisted AMS count summary.
  body_ordering_drift: number;
  // Header dimension (Spec 2026-06-17). Same local-only treatment -- counts a
  // diff_item whose header_classification is a real (untolerated) break.
  header_drift: number;
  // Strict-profile byte dimension (Spec 2026-07-06-j). Local-only tallies --
  // the verdicts ride each item's persisted diff_json (`byte_classification`);
  // these feed the reconcile trace + the failure log line.
  byte_drift: number;
  raw_unavailable: number;
  // State-parity dimension (Spec 2026-07-06-n). Local-only tallies, same
  // posture as the byte dimension -- the verdicts ride each item's persisted
  // diff_json (`state_classification`) and the parity gate (Spec I) consumes
  // them; the AMS count summary is unchanged.
  state_drift: number;
  state_unverified: number;
  source_only: number;
  target_only: number;
}

function freshCounts(): ClassificationCounts {
  return {
    matched: 0,
    status_drift: 0,
    body_shape_drift: 0,
    body_value_drift: 0,
    body_ordering_drift: 0,
    header_drift: 0,
    byte_drift: 0,
    raw_unavailable: 0,
    state_drift: 0,
    state_unverified: 0,
    source_only: 0,
    target_only: 0,
  };
}

/**
 * Read the DISTINCT `volatility_sources` tags persisted onto a diff_item's
 * `body_diff_json` (set by the comparator when a tolerated entry was
 * touched). Returns the first tag for the DETAIL line, or undefined when the
 * break carries no volatility tolerance.
 */
function readVolatilitySource(item: ApiBehaviourDiffItemDto): string | undefined {
  const blob = item.body_diff_json as { volatility_sources?: unknown } | null | undefined;
  const sources = blob?.volatility_sources;
  if (Array.isArray(sources) && typeof sources[0] === 'string') {
    return sources[0];
  }
  return undefined;
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
  const nonDeterministicEndpointKeys =
    deps.nonDeterministicEndpointKeys ?? new Set<string>();

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
  // SOURCE/oracle integrity verdict captured at the source baseline load
  // (consumed in the finding-emission tail block, AFTER the mandatory
  // delete-findings cleanup so a recompute does not accumulate the advisory
  // integrity finding). `undefined` => verification was not run / failed soft.
  // `sourceBaselineIdForIntegrity` is captured alongside so the tail block can
  // reference it without re-narrowing the possibly-undefined `diff`.
  // Spec: 2026-06-17 Baseline Integrity & Provenance -- Task Group 2.
  let sourceIntegrity: BaselineIntegrityDto | undefined;
  let sourceBaselineIdForIntegrity: string | undefined;
  // Reconcile trace corr -- project + arch group the migration, the diffId is
  // the reconcile sub-thread (corr `run`). architectureId fills in once the
  // diff row loads; the start line below uses what we know at that point.
  let traceCorr: { run: string; project: string; arch?: string } = {
    run: diffId,
    project: projectId,
  };

  try {
    // ------------------------------------------------------------------
    // 1) Load diff + validate status
    // ------------------------------------------------------------------
    diff = await archModelClient.getDiff(projectId, diffId);
    architectureId = diff.architecture_id;
    traceCorr = { run: diffId, project: projectId, arch: architectureId };

    // Spec 2026-07-06-j: the diff row's comparison profile (null reads
    // 'standard' — today's semantics) + the project's effective waiver set
    // from AMS. A waiver fetch failure yields null and the comparator falls
    // back to the legacy in-code header allowlist (logged inside the fetch).
    const comparisonProfile: 'standard' | 'strict' =
      (diff as { comparison_profile?: string | null }).comparison_profile === 'strict'
        ? 'strict'
        : 'standard';
    const waiverSet = await fetchWaiverSet(projectId);
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
      trace.fail('reconcile FAILED — target_baseline_not_finalised', traceCorr);
      return;
    }
    const sourceBaseline = await archModelClient.getBaseline(
      projectId,
      diff.source_baseline_id,
    );

    // ------------------------------------------------------------------
    // 2b) Verify the SOURCE / oracle baseline integrity (advisory, R4 + R7)
    // ------------------------------------------------------------------
    // Ask AMS to recompute the canonical content hash over the oracle's
    // CURRENT stored items and compare it to the hash stamped at activation.
    // The TS path CONSUMES the verdict -- it never recomputes the hash itself
    // (one Java hashing implementation eliminates cross-language drift). This
    // is ALWAYS fail-soft and ALWAYS advisory: a verify-call error must never
    // break an otherwise-working reconcile, and a real mismatch surfaces a
    // VISIBLE warning finding (emitted in the tail block) without blocking.
    // Scoped to the SOURCE/oracle baseline only -- target baselines are out of
    // scope (R8). The finding emission is deferred to the tail block so it runs
    // AFTER deleteFindingsByApiBehaviourDiffId (recompute-safe, no duplication).
    sourceBaselineIdForIntegrity = diff.source_baseline_id;
    try {
      sourceIntegrity = await archModelClient.getBaselineIntegrity(
        projectId,
        diff.source_baseline_id,
      );
    } catch (err) {
      // Fail-soft: verification unavailable (AMS error / endpoint missing).
      // Proceed with the reconcile; do NOT crash and do NOT emit a mismatch.
      sourceIntegrity = undefined;
      console.warn(
        `[diffRunner] op=integrity_verify_unavailable diffId=${diffId.slice(0, 8)} ` +
          `source=${diff.source_baseline_id.slice(0, 8)} ` +
          `err=${err instanceof Error ? err.message : String(err)}`,
      );
      trace.detail(
        'reconcile.integrity',
        { source: diff.source_baseline_id, verdict: 'verify_unavailable' },
        traceCorr,
      );
    }

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

    // SUMMARY: reconcile started -- the source/target item counts frame the
    // run before any classification.
    trace.step(
      `reconcile started — ${sourceItems.length} source items vs ${targetItems.length} target items`,
      traceCorr,
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
        | 'status_classification'
        | 'body_classification'
        | 'header_classification'
        | 'body_diff_json'
        | 'notes'
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
      // Header dimension (Spec 2026-06-17). NULL when there is no header pair
      // to compare -- either no target match (source_only) or a side lacked the
      // { headers, body } wrapper (the comparator returns null then; graceful
      // degrade, no false break).
      let headerClassification: ApiBehaviourDiffHeaderClassification | null = null;
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
        //
        // Volatility tolerance (Spec 2026-06-16, Task Group 3): consult the
        // source item's `volatile_paths_json` envelope + the operation's
        // `non_deterministic_endpoint` signal. A `null` envelope + no signal
        // => `ctx` undefined => EXACTLY today's strict comparison (G1). The
        // tolerated value/order entries are persisted in `body_diff_json` with
        // their `volatilitySource` tag so the gateway auto-disposition pass
        // (Group 4) can classify the break; the comparator itself drops
        // nothing.
        const envelope = parseVolatilityEnvelope(sourceItem.volatile_paths_json);
        const endpointSignal = nonDeterministicEndpointKeys.has(
          operationKey(sourceItem),
        );
        const volatilityCtx = buildVolatilityContext(envelope, endpointSignal);
        const cmp = compareJsonShapes(
          sourceItem.response_json,
          targetItem.response_json,
          volatilityCtx,
          // Spec 2026-07-06-j: the diff's comparison profile + the AMS waiver
          // set (replacing the in-code allowlist when fetched) + the raw wire
          // bodies for the strict byte verdict. `waivers: null` (fetch
          // failure) falls back to the legacy allowlist inside the comparator.
          {
            profile: comparisonProfile,
            waivers: waiverSet,
            sourceRaw: sourceItem.response_body_raw ?? null,
            targetRaw: targetItem.response_body_raw ?? null,
          },
        );
        bodyClassification = cmp.bodyClassification;
        // Header classification (null = dimension skipped: a side lacked the
        // { headers, body } wrapper). The comparator returns one of
        // header_match / header_value_drift / header_presence_drift, which the
        // AMS column accepts verbatim (snake_case).
        headerClassification =
          (cmp.headerClassification as ApiBehaviourDiffHeaderClassification | null) ??
          null;
        // Persist the body + header diff entries (and the distinct volatility
        // sources that touched a tolerated entry -- now including allowlisted
        // header values tagged `declared`) so the gateway post-diff pass can
        // read them off the persisted diff_item without re-walking the
        // responses. header_entries lets the gateway / frontend list the
        // affected (incl. tolerated) header names.
        {
          const blob: Record<string, unknown> = {};
          if (cmp.bodyDiffJson.length > 0) {
            blob.entries = cmp.bodyDiffJson as unknown[];
          }
          if (cmp.headerDiffJson.length > 0) {
            blob.header_entries = cmp.headerDiffJson as unknown[];
          }
          if (cmp.volatilitySourcesTouched.length > 0) {
            blob.volatility_sources = cmp.volatilitySourcesTouched as unknown[];
          }
          // Spec 2026-07-06-j: the strict-profile byte verdict rides the
          // persisted diff item (additive key; absent on standard runs).
          if (cmp.byteClassification) {
            blob.byte_classification = cmp.byteClassification;
            if (cmp.byteClassification === 'byte_drift') {
              counts.byte_drift += 1;
            } else if (cmp.byteClassification === 'raw_unavailable') {
              counts.raw_unavailable += 1;
            }
          }
          // Spec 2026-07-06-n: state parity. Stamped ONLY when at least one
          // side carries an effect-table delta (read-only items and pre-N
          // baselines skip the dimension entirely — zero regression). Either
          // side missing while the other measured => `state_unverified`
          // (FAIL-CLOSED: a write whose state cannot be verified is surfaced
          // VISIBLY, never silently passed). The parity gate (Spec I)
          // consumes the verdict off the persisted diff_json.
          {
            const sourceDelta =
              (sourceItem.state_delta_json as unknown as StateDeltaJson | null) ?? null;
            const targetDelta =
              (targetItem.state_delta_json as unknown as StateDeltaJson | null) ?? null;
            if (sourceDelta || targetDelta) {
              const stateCmp = compareStateDeltas(sourceDelta, targetDelta);
              blob.state_classification = stateCmp.classification;
              if (stateCmp.detail.length > 0) {
                blob.state_detail = stateCmp.detail as unknown[];
              }
              if (stateCmp.classification === 'state_drift') {
                counts.state_drift += 1;
              } else if (stateCmp.classification === 'state_unverified') {
                counts.state_unverified += 1;
              }
            }
          }
          bodyDiffJson = Object.keys(blob).length > 0 ? blob : null;
        }

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
        } else if (bodyClassification === 'body_ordering_drift') {
          // Local-only ordering tally (no AMS count column); feeds the breaks
          // sum so an ordering-only divergence is counted as a break.
          counts.body_ordering_drift += 1;
        }
        // Header break (local-only tally): a real, untolerated header
        // divergence. header_match (incl. allowlisted-value-only, which the
        // comparator still surfaces as header_value_drift but tags `declared`)
        // is NOT counted here as a hard break -- the gateway auto-dispose pass
        // decides volatility. A header_presence_drift or a non-allowlisted
        // header_value_drift is the hard-break signal; the gateway's
        // isDiffItemABreak (Task Group 3) registers it. We count any non-match
        // header classification so the breaks sum reflects the dimension.
        if (
          headerClassification === 'header_presence_drift' ||
          headerClassification === 'header_value_drift'
        ) {
          counts.header_drift += 1;
        }
        // Matched-bucket only when status + body + header all match (or header
        // skipped). Header drift keeps the item out of the matched bucket.
        if (
          statusClassification === 'status_match' &&
          bodyClassification === 'body_match' &&
          (headerClassification === null || headerClassification === 'header_match')
        ) {
          counts.matched += 1;
        }
      }

      try {
        const persisted = await archModelClient.createDiffItem(projectId, diffId, {
          ...baseRequest,
          status_classification: statusClassification,
          body_classification: bodyClassification,
          header_classification: headerClassification,
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
          header_classification: null,
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
        `source_only=${counts.source_only} target_only=${counts.target_only} ` +
        `state_drift=${counts.state_drift} state_unverified=${counts.state_unverified}`,
    );

    // SUMMARY: reconcile terminal -- "breaks" = every non-matched item
    // (status / shape / value drift + source_only + target_only). A clean
    // reconcile (0 breaks) is an ok line; any break is still ok (reconcile
    // RAN successfully -- the breaks themselves are the data), so we use the
    // ok glyph and let the count carry the signal.
    const breaks =
      counts.status_drift +
      counts.body_shape_drift +
      counts.body_value_drift +
      counts.body_ordering_drift +
      counts.header_drift +
      counts.source_only +
      counts.target_only;
    trace.ok(
      `reconcile COMPLETED — ${breaks} breaks ` +
        `(status_drift=${counts.status_drift} shape=${counts.body_shape_drift} ` +
        `value=${counts.body_value_drift} source_only=${counts.source_only} ` +
        `target_only=${counts.target_only}; matched=${counts.matched})`,
      traceCorr,
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(
      `[diffRunner] op=fail diffId=${diffId.slice(0, 8)} reason=${errorMessage}`,
    );
    trace.fail(`reconcile FAILED — ${errorMessage}`, traceCorr);
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

  // STEP 1b: SOURCE/oracle integrity advisory finding (Spec 2026-06-17,
  // R4 + R7). Emitted AFTER the mandatory delete-findings cleanup so a
  // recompute replaces (not accumulates) this finding -- same recompute-safe
  // ordering as the per-item findings below.
  //
  // Decision logic on the verdict captured at the source baseline load:
  //   - integrity_verified === false AND content_hash != null => REAL mismatch
  //     (the stored hash exists but no longer matches the recompute): emit a
  //     VISIBLE advisory WARNING finding and PROCEED. Never blocks; never
  //     silent.
  //   - content_hash === null => "no integrity hash recorded" (pre-existing /
  //     never-activated baseline): NEUTRAL -- SKIP verification, do NOT emit a
  //     mismatch warning (an info-level trace breadcrumb only).
  //   - integrity_verified === true => trusted oracle: no finding.
  //   - sourceIntegrity undefined (verify call failed soft at load): no finding.
  // Fail-soft: any emission error here is logged + skipped; the diff stays
  // completed (mirrors the per-item emission tail).
  if (sourceIntegrity) {
    const hasRecordedHash = sourceIntegrity.content_hash != null;
    if (!hasRecordedHash) {
      // NEUTRAL null-hash case -- NOT a mismatch. No finding; breadcrumb only.
      trace.detail(
        'reconcile.integrity',
        { source: sourceBaselineIdForIntegrity, verdict: 'no_hash_recorded' },
        traceCorr,
      );
    } else if (sourceIntegrity.integrity_verified === false) {
      // REAL mismatch: stored hash exists but does not match the recompute.
      // Visible advisory warning; reconcile already completed (advisory only).
      trace.detail(
        'reconcile.integrity',
        {
          source: sourceBaselineIdForIntegrity,
          verdict: 'mismatch',
          contentHash: sourceIntegrity.content_hash,
          recomputedHash: sourceIntegrity.recomputed_hash,
        },
        traceCorr,
      );
      try {
        await archModelClient.createDiffFinding(projectId, diffId, {
          finding_type: 'api_behaviour_oracle_integrity_mismatch',
          category: API_BEHAVIOUR_DRIFT_CATEGORY,
          severity: 'medium',
          status: 'new',
          title: 'Oracle baseline integrity mismatch',
          summary:
            'The source (current-state oracle) baseline failed server-side ' +
            'integrity verification: its stored content hash no longer matches ' +
            'a recompute over the current stored items. The pinned oracle may ' +
            'have been tampered with or drifted. This reconcile result was ' +
            'computed against a possibly-compromised oracle (advisory only -- ' +
            'the reconcile still completed).',
          detail_json: {
            source_baseline_id: sourceBaselineIdForIntegrity,
            content_hash: sourceIntegrity.content_hash,
            recomputed_hash: sourceIntegrity.recomputed_hash,
            integrity_verified: sourceIntegrity.integrity_verified,
          },
          source: 'api_behaviour_diff',
          created_by_stage: 'diffRunner.integrityVerify',
        });
        console.warn(
          `[diffRunner] op=integrity_mismatch diffId=${diffId.slice(0, 8)} ` +
            `source=${(sourceBaselineIdForIntegrity ?? '').slice(0, 8)} ` +
            `(advisory warning emitted; reconcile proceeded)`,
        );
      } catch (err) {
        // Fail-soft: emission failure must not fail the (already-completed)
        // reconcile. Log + skip, mirroring the per-item emission tail.
        console.error(
          `[diffRunner] op=integrity_finding_emission_failed diffId=${diffId.slice(0, 8)} ` +
            `err=${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      // integrity_verified === true -- trusted oracle. No finding.
      trace.detail(
        'reconcile.integrity',
        { source: sourceBaselineIdForIntegrity, verdict: 'verified' },
        traceCorr,
      );
    }
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
      // DETAIL: per-break -- the operation, its classification + severity, and
      // the volatility-source tag (when a tolerated entry was touched). This
      // is the row-level breadcrumb behind the SUMMARY break count.
      trace.detail(
        'reconcile.break',
        {
          op: `${item.method} ${item.path}`,
          classification:
            item.body_classification ?? item.status_classification,
          severity: classification.severity,
          ...(readVolatilitySource(item)
            ? { volatilitySource: readVolatilitySource(item) }
            : {}),
        },
        traceCorr,
      );
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
