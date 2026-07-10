/**
 * Post-reconcile parity-verdict emission (Spec 2026-07-06-i §2–3, wired by
 * the Tier-1 batch 2026-07-10 — the verify loop's "last mile").
 *
 * After the deploy-time FULL reconcile completes, every in-scope API-parity
 * code story gets a machine verdict derived from the SAME diff items the
 * reconcile just produced (no re-read):
 *
 *   - story items = diff items whose `"METHOD /path"` falls inside the
 *     story's committed endpoint keys (template-tolerant, the completion
 *     gate's own rule);
 *   - verdict `pass` = ≥1 item compared AND zero unwaived breaks
 *     (`break_fingerprint` waivers consumed, ids visible);
 *   - verdict `fail` = ≥1 unwaived break → POSTed with the serialized
 *     break detail as the repair loop's defect input;
 *   - ZERO compared items → NO POST (logged + counted): the repair loop
 *     cannot fix "nothing was verified" — that story stays blocked by the
 *     completion gate's `code_parity_unverified` (fail-closed), and the
 *     run parity-status endpoint shows it.
 *
 * Verdicts POST to the IVS inbound `POST /api/v2/parity-verdict` (binding:
 * the run item's orchestrate job id + spec name). A FAIL verdict
 * auto-enqueues repair runs IVS-side, capped by the `PARITY_REPAIR_CAP` env
 * (default 5) — the user-approved auto-repair posture (2026-07-10). The
 * whole emission is FAIL-SOFT: any failure logs and never breaks the
 * reconcile that already completed.
 */

import { logger } from './logger';
import { createTracer } from '../trace';
import type { MigrationExecutionRun } from './migrationExecutionRunClient';
import type { ReconciliationDiffItem } from './migrationReconciliationValidationClient';
import { isDiffItemABreak } from './migrationReconciliationValidationClient';
import type { ReconcileBookOfWorkItem } from './migrationReconciliationNetNewMatch';
import { endpointKeyMatches } from './migrationCodeExecutionGate';
import {
  BreakFingerprintWaiver,
  breakFingerprint,
  fetchBreakFingerprintWaivers,
} from './migrationParityVerifier';
import { defaultConsumerResolverReads } from './dbChangeConsumerResolver';
import { request as defaultImplRequest } from './implementationLlmProxyClient';

// REC-stage predicate emission (predicate run-judging batch — see
// docs/trace-logging.md §Predicate self-scoring layer). Emission only.
const trace = createTracer('gateway');

// ---------------------------------------------------------------------------
// Types + deps
// ---------------------------------------------------------------------------

export interface ParityVerdictEmission {
  storiesEvaluated: number;
  verdictsPosted: number;
  /** Stories with ZERO compared diff items — no POST, gate keeps them blocked. */
  storiesUnverified: number;
  postFailures: number;
}

export interface ParityVerdictEmitterDeps {
  loadReconcileBookOfWork(
    projectId: string,
    bookOfWorkId: string,
  ): Promise<ReconcileBookOfWorkItem[]>;
  /** endpoint element id → `"METHOD /path"` key (null = unresolvable). */
  fetchEndpointKeyIndex(
    projectId: string,
    architectureId: string,
  ): Promise<Map<string, string | null>>;
  fetchWaivers: typeof fetchBreakFingerprintWaivers;
  implRequest: typeof defaultImplRequest;
}

export function defaultParityVerdictEmitterDeps(
  loadReconcileBookOfWork: ParityVerdictEmitterDeps['loadReconcileBookOfWork'],
  implRequest: typeof defaultImplRequest,
): ParityVerdictEmitterDeps {
  return {
    loadReconcileBookOfWork,
    async fetchEndpointKeyIndex(projectId, architectureId) {
      const index = await defaultConsumerResolverReads().fetchModelIndex(
        projectId,
        architectureId,
      );
      return index?.endpointKeyById ?? new Map<string, string | null>();
    },
    fetchWaivers: fetchBreakFingerprintWaivers,
    implRequest,
  };
}

/** The API-parity code streams (internal stream is exempt — Spec M's oracle). */
const API_PARITY_STREAM_TAGS = new Set([
  'stream:target_service_api_implementation',
  'stream:api_soap_integration_compatibility',
]);
const MANUAL_GATE_TAG = 'execution:manual-gate';

function isApiParityCodeStory(item: ReconcileBookOfWorkItem): boolean {
  const tags = item.tags ?? [];
  if (!item.workItemId) return false;
  if (tags.includes(MANUAL_GATE_TAG)) return false;
  if (!tags.some((t) => API_PARITY_STREAM_TAGS.has(t))) return false;
  return (item.apiEndpointIds?.length ?? 0) > 0;
}

function serializeBreak(item: ReconciliationDiffItem): Record<string, unknown> {
  return {
    fingerprint: breakFingerprint(item),
    method: (item.method ?? 'GET').toUpperCase(),
    path: item.path ?? '/',
    scenario_name: item.scenario_name ?? '',
    kind: item.status_classification ?? null,
    body_classification: item.body_classification ?? null,
    header_classification: item.header_classification ?? null,
    source_status: item.source_response_status ?? null,
    target_status: item.target_response_status ?? null,
    detail: item.body_diff_json ?? null,
  };
}

// ---------------------------------------------------------------------------
// The emission
// ---------------------------------------------------------------------------

export async function emitParityVerdictsAfterReconcile(args: {
  run: MigrationExecutionRun;
  architectureId: string;
  diffId: string | null;
  diffItems: ReconciliationDiffItem[];
  deps: ParityVerdictEmitterDeps;
}): Promise<ParityVerdictEmission> {
  const emission: ParityVerdictEmission = {
    storiesEvaluated: 0,
    verdictsPosted: 0,
    storiesUnverified: 0,
    postFailures: 0,
  };
  const projectId = args.run.project_id ?? '';
  const runId = args.run.id ?? '';
  const bookId = args.run.book_of_work_id ?? '';
  if (!projectId || !bookId) return emission;

  let stories: ReconcileBookOfWorkItem[];
  let keyIndex: Map<string, string | null>;
  let waivers: BreakFingerprintWaiver[];
  try {
    stories = (await args.deps.loadReconcileBookOfWork(projectId, bookId)).filter(
      isApiParityCodeStory,
    );
    if (stories.length === 0) return emission;
    keyIndex = await args.deps.fetchEndpointKeyIndex(projectId, args.architectureId);
    waivers = await args.deps.fetchWaivers(projectId);
  } catch (error) {
    logger.warn('[diag-gateway] migration_parity verdict_emission_inputs_failed', {
      projectId,
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return emission;
  }
  const waiverByFingerprint = new Map(waivers.map((w) => [w.target, w]));

  // Run-item lookup: story workItemId → (orchestrate job id, spec name).
  const runItemByWorkItemId = new Map(
    (args.run.items ?? [])
      .filter((i) => i.work_item_id)
      .map((i) => [i.work_item_id as string, i]),
  );

  for (const story of stories) {
    emission.storiesEvaluated += 1;
    const runItem = runItemByWorkItemId.get(story.workItemId as string);
    if (!runItem?.job_id) {
      // Never dispatched (deferred / manual) — nothing to bind a verdict to.
      continue;
    }
    const storyKeys = (story.apiEndpointIds ?? [])
      .map((id) => keyIndex.get(id) ?? null)
      .filter((key): key is string => key !== null);
    if (storyKeys.length === 0) {
      emission.storiesUnverified += 1;
      continue;
    }

    const storyItems = args.diffItems.filter((item) =>
      storyKeys.some((key) =>
        endpointKeyMatches(key, `${(item.method ?? 'GET').toUpperCase()} ${item.path ?? '/'}`),
      ),
    );
    if (storyItems.length === 0) {
      // Nothing compared for this story: the repair loop cannot fix "not
      // verified" — no POST; the completion gate keeps it blocked
      // (code_parity_unverified) and the parity-status endpoint shows it.
      emission.storiesUnverified += 1;
      logger.warn('[diag-gateway] migration_parity story_unverified_no_items', {
        projectId,
        runId,
        workItemId: story.workItemId,
      });
      continue;
    }

    const unwaived = storyItems
      .filter(isDiffItemABreak)
      .filter((item) => !waiverByFingerprint.has(breakFingerprint(item)));
    const verdict = unwaived.length === 0 ? 'pass' : 'fail';

    try {
      const response = await args.deps.implRequest('/api/v2/parity-verdict', {
        method: 'POST',
        body: {
          orchestrate_id: runItem.job_id,
          // The IVS cell key half 2: the spec folder name when the
          // auto-answer recorded one; the work-item id is the stable
          // fallback for older runs.
          task_group_id: runItem.spec_name ?? story.workItemId,
          repo: '',
          verdict,
          diff_id: args.diffId,
          breaks: unwaived.map(serializeBreak),
          // Idempotency across reconcile re-runs of the SAME diff.
          delivery_id: `${args.diffId ?? runId}:${story.workItemId}`,
        },
      });
      if (!response.ok) {
        emission.postFailures += 1;
        logger.warn('[diag-gateway] migration_parity verdict_post_rejected', {
          projectId,
          runId,
          workItemId: story.workItemId,
          status: response.status,
        });
        continue;
      }
      emission.verdictsPosted += 1;
      logger.info('[diag-gateway] migration_parity verdict_posted', {
        projectId,
        runId,
        workItemId: story.workItemId,
        verdict,
        breaks: unwaived.length,
      });
    } catch (error) {
      emission.postFailures += 1;
      logger.warn('[diag-gateway] migration_parity verdict_post_failed', {
        projectId,
        runId,
        workItemId: story.workItemId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info('[diag-gateway] migration_parity verdict_emission_complete', {
    projectId,
    runId,
    ...emission,
  });
  // REC verdict-emission summary (predicate run-judging batch). Unverified
  // stories are honest (the completion gate keeps them blocked as
  // code_parity_unverified); only failed POSTs fail the predicate.
  trace.predicate(
    'REC.EMIT.01', 'parity verdicts emitted for every verifiable code story',
    emission.postFailures === 0,
    'post_failures == 0 (unverified stories stay blocked, never silently passed)',
    `evaluated=${emission.storiesEvaluated} posted=${emission.verdictsPosted} ` +
      `unverified=${emission.storiesUnverified} post_failures=${emission.postFailures}`,
    { project: projectId, run: runId },
  );
  return emission;
}
