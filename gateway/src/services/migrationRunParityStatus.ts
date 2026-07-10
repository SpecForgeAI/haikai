/**
 * Run-level parity status (Spec 2026-07-06-i, Tier-1 batch 2026-07-10): the
 * on-demand read surfacing the completion/closure/drift evaluators for a
 * migration execution run — per code story, plus the stream-closure and
 * baseline-drift posture. This is the "minimal UI" surface: gate codes on an
 * existing run view, no new frontend build-out.
 *
 * FAIL-CLOSED semantics ride the evaluators themselves; THIS module only
 * assembles inputs (book stories + endpoint keys + the pinned baseline's
 * diffs + waivers) and reports.
 */

import { logger } from './logger';
import type { MigrationExecutionRun } from './migrationExecutionRunClient';
import {
  CodeGateReads,
  GateDiffRow,
  defaultCodeGateReads,
  evaluateBaselineDrift,
  evaluateClosureReadiness,
  evaluateCodeStoryCompletion,
} from './migrationCodeExecutionGate';
import {
  BreakFingerprintWaiver,
  fetchBreakFingerprintWaivers,
} from './migrationParityVerifier';
import { defaultConsumerResolverReads } from './dbChangeConsumerResolver';
import type { ReconcileBookOfWorkItem } from './migrationReconciliationNetNewMatch';

export interface StoryParityStatus {
  workItemId: string;
  title: string;
  completable: boolean;
  reasons: Array<{ code: string; message: string }>;
}

export interface RunParityStatus {
  runId: string;
  pinnedBaselineId: string | null;
  stories: StoryParityStatus[];
  closure: { ok: boolean; reasons: Array<{ code: string; message: string }> };
  drift: { ok: boolean; reasons: Array<{ code: string; message: string }> };
  /** Non-fatal input problems (e.g. model read failed → no endpoint keys). */
  warnings: string[];
}

export interface RunParityStatusDeps {
  loadReconcileBookOfWork(
    projectId: string,
    bookOfWorkId: string,
  ): Promise<ReconcileBookOfWorkItem[]>;
  fetchEndpointKeyIndex(
    projectId: string,
    architectureId: string,
  ): Promise<Map<string, string | null>>;
  resolveArchitectureForBaseline(
    projectId: string,
    baselineId: string,
  ): Promise<string | null>;
  fetchWaivers(projectId: string): Promise<BreakFingerprintWaiver[]>;
  gateReads: CodeGateReads;
}

const API_PARITY_STREAM_TAGS = new Set([
  'stream:target_service_api_implementation',
  'stream:api_soap_integration_compatibility',
]);
const MANUAL_GATE_TAG = 'execution:manual-gate';

function isApiParityCodeStory(item: ReconcileBookOfWorkItem): boolean {
  const tags = item.tags ?? [];
  return (
    !!item.workItemId &&
    !tags.includes(MANUAL_GATE_TAG) &&
    tags.some((t) => API_PARITY_STREAM_TAGS.has(t)) &&
    (item.apiEndpointIds?.length ?? 0) > 0
  );
}

export async function computeRunParityStatus(
  args: {
    projectId: string;
    run: MigrationExecutionRun;
  },
  deps: RunParityStatusDeps,
): Promise<RunParityStatus> {
  const runId = args.run.id ?? '';
  const pinnedBaselineId = args.run.pinned_current_baseline_id ?? null;
  const warnings: string[] = [];
  const empty = { ok: false, reasons: [] as Array<{ code: string; message: string }> };

  if (!pinnedBaselineId) {
    return {
      runId,
      pinnedBaselineId: null,
      stories: [],
      closure: {
        ok: false,
        reasons: [
          {
            code: 'code_baseline_unpinned',
            message: 'The run has no pinned current baseline — parity has no oracle.',
          },
        ],
      },
      drift: empty,
      warnings,
    };
  }

  // --- Inputs (each fail-soft into warnings; the evaluators fail closed). ---
  let stories: ReconcileBookOfWorkItem[] = [];
  try {
    stories = (
      await deps.loadReconcileBookOfWork(args.projectId, args.run.book_of_work_id ?? '')
    ).filter(isApiParityCodeStory);
  } catch (error) {
    warnings.push(
      `Book of work could not be read (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  let keyIndex = new Map<string, string | null>();
  try {
    const architectureId = await deps.resolveArchitectureForBaseline(
      args.projectId,
      pinnedBaselineId,
    );
    if (architectureId) {
      keyIndex = await deps.fetchEndpointKeyIndex(args.projectId, architectureId);
    } else {
      warnings.push('Architecture for the pinned baseline could not be resolved.');
    }
  } catch (error) {
    warnings.push(
      `Endpoint key index could not be read (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  let diffs: GateDiffRow[] = [];
  try {
    diffs = await deps.gateReads.listDiffsForBaseline(args.projectId, pinnedBaselineId);
  } catch (error) {
    warnings.push(
      `Diff history could not be read (${error instanceof Error ? error.message : String(error)}) — every verdict below fails closed.`,
    );
  }
  const waivers = await deps.fetchWaivers(args.projectId);

  const storyStatuses: StoryParityStatus[] = [];
  for (const story of stories) {
    const storyKeys = (story.apiEndpointIds ?? [])
      .map((id) => keyIndex.get(id) ?? null)
      .filter((key): key is string => key !== null);
    if (storyKeys.length === 0) {
      storyStatuses.push({
        workItemId: story.workItemId as string,
        title: story.title,
        completable: false,
        reasons: [
          {
            code: 'code_parity_unverified',
            message:
              'The story\'s endpoints could not be resolved to METHOD/path keys — nothing ' +
              'can be verified against them (FAIL CLOSED).',
          },
        ],
      });
      continue;
    }
    const completion = await evaluateCodeStoryCompletion({
      projectId: args.projectId,
      storyEndpointKeys: storyKeys,
      diffs,
      waivers,
      reads: deps.gateReads,
    });
    storyStatuses.push({
      workItemId: story.workItemId as string,
      title: story.title,
      completable: completion.ok,
      reasons: completion.reasons,
    });
  }

  const closure = await evaluateClosureReadiness({
    projectId: args.projectId,
    diffs,
    waivers,
    reads: deps.gateReads,
  });
  const drift = await evaluateBaselineDrift({
    projectId: args.projectId,
    diffs,
    reads: deps.gateReads,
  });

  logger.info('[diag-gateway] migration_parity run_status', {
    projectId: args.projectId,
    runId,
    stories: storyStatuses.length,
    completable: storyStatuses.filter((s) => s.completable).length,
    closureOk: closure.ok,
    driftOk: drift.ok,
  });
  return {
    runId,
    pinnedBaselineId,
    stories: storyStatuses,
    closure: { ok: closure.ok, reasons: closure.reasons },
    drift: { ok: drift.ok, reasons: drift.reasons },
    warnings,
  };
}

export function defaultRunParityStatusDeps(
  loadReconcileBookOfWork: RunParityStatusDeps['loadReconcileBookOfWork'],
  resolveArchitectureForBaseline: RunParityStatusDeps['resolveArchitectureForBaseline'],
): RunParityStatusDeps {
  return {
    loadReconcileBookOfWork,
    resolveArchitectureForBaseline,
    async fetchEndpointKeyIndex(projectId, architectureId) {
      const index = await defaultConsumerResolverReads().fetchModelIndex(
        projectId,
        architectureId,
      );
      return index?.endpointKeyById ?? new Map<string, string | null>();
    },
    fetchWaivers: fetchBreakFingerprintWaivers,
    gateReads: defaultCodeGateReads(),
  };
}
