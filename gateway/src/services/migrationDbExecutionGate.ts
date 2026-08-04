/**
 * DB-pack readiness gate for the Migration Execution Driver
 * (Spec 2026-07-02-e — Persistence-Tier Oracle Program).
 *
 * The driver already hard-gates on the API oracle (CD-7: every in-scope story
 * spec-ready + an active current baseline). This module adds the
 * PERSISTENCE-TIER analogue: when the run's dispatch scope contains DB-pack
 * stories, Migrate refuses to start unless
 *
 *   1. the DB migration pack EXISTS for the book's current architecture,
 *   2. it is FRESH (input-snapshot hash matches; decision-resolution
 *      staleness honoured) and bound to the book's target,
 *   3. it has ZERO open needs-decision entries, and
 *   4. every translate-disposition DB-object translation is APPROVED
 *      (unreviewed / needs_rework block; rejected is a terminal human
 *      disposition and does not block).
 *
 * FAIL-CLOSED: an unreadable pack state blocks the run with
 * `db_pack_read_failed` — kicking off an automated build against unknown
 * persistence inputs is exactly what this gate exists to prevent (contrast
 * the carry-over coverage dimension, which fail-softs because it is advisory
 * bookkeeping over already-gated work).
 *
 * Post-deploy verification note: the pack's schema-diff verify loop already
 * exists (`POST /db-migration-packs/:packId/verify` — credentialed scan →
 * deterministic diff → persisted drift history). The driver can NOT run it
 * automatically because DB credentials are per-invocation and never persisted
 * (hard pack-spec constraint); the swap-over runbook (Spec -d) makes it the
 * explicit human step 7 instead.
 */

import { DB_PACK_DELIVERY_STREAMS } from './migrationBookOfWorkHandler';
import {
  FetchPackViewFn,
  PackView,
  defaultFetchPackView,
} from './migrationDbPackPlanner';
import { evaluatePackStaleness } from './dbMigrationPack/staleness';
import {
  describeOpenFindings,
  openStructuralFindings,
} from './migrationStructuralFindings';
import type { BookOfWorkItem } from './migrationDriverAmsReads';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DbPackGateReason {
  code:
    | 'db_pack_missing'
    | 'db_pack_stale'
    | 'db_pack_decisions_unresolved'
    | 'db_translations_unapproved'
    | 'db_structural_findings_open'
    | 'db_pack_read_failed';
  message: string;
}

export interface DbPackGateResult {
  ok: boolean;
  reasons: DbPackGateReason[];
}

export interface DbPackGateReads {
  fetchPackView: FetchPackViewFn;
  evaluateStaleness: typeof evaluatePackStaleness;
}

export const defaultDbPackGateReads: DbPackGateReads = {
  fetchPackView: defaultFetchPackView,
  evaluateStaleness: evaluatePackStaleness,
};

// ---------------------------------------------------------------------------
// Scope detection (pure)
// ---------------------------------------------------------------------------

/**
 * True when the run's dispatch scope contains at least one DB-pack story:
 * a story node (has a workItemId), not deferred, inside the selection when a
 * subset migrate is active, tagged either `provenance:pack` or with a DB
 * delivery-stream tag.
 */
export function dbStoriesInScope(params: {
  items: BookOfWorkItem[];
  deferredWorkItemIds: Set<string>;
  selectedWorkItemIds?: Set<string> | null;
}): boolean {
  const hasSelection =
    !!params.selectedWorkItemIds && params.selectedWorkItemIds.size > 0;
  for (const item of params.items) {
    if (!item.workItemId) continue;
    if (params.deferredWorkItemIds.has(item.workItemId)) continue;
    if (hasSelection && !params.selectedWorkItemIds!.has(item.workItemId)) continue;
    const tags: string[] = Array.isArray((item as { tags?: unknown }).tags)
      ? ((item as { tags?: unknown }).tags as unknown[]).map((t) => String(t))
      : [];
    if (
      tags.includes('provenance:pack') ||
      DB_PACK_DELIVERY_STREAMS.some((s) => tags.includes(`stream:${s}`))
    ) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

function boundTargetOf(packView: PackView): string | null {
  const bound = (packView.manifest as unknown as Record<string, unknown>)
    .target_architecture_id;
  return typeof bound === 'string' && bound.length > 0 ? bound : null;
}

export async function evaluateDbPackReadiness(params: {
  projectId: string;
  currentArchitectureId: string | null;
  targetArchitectureId: string | null;
  reads?: DbPackGateReads;
}): Promise<DbPackGateResult> {
  const reads = params.reads ?? defaultDbPackGateReads;
  const reasons: DbPackGateReason[] = [];
  const currentArchitectureId = params.currentArchitectureId ?? '';

  let packView: PackView | null;
  try {
    packView = await reads.fetchPackView(params.projectId, currentArchitectureId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reasons: [
        {
          code: 'db_pack_read_failed',
          message:
            `The DB migration pack state could not be read (${message}). ` +
            'Migrate fails CLOSED on unknown persistence inputs — retry once AMS is reachable.',
        },
      ],
    };
  }

  if (!packView) {
    return {
      ok: false,
      reasons: [
        {
          code: 'db_pack_missing',
          message:
            'This run dispatches DB-pack stories but no DB migration pack exists for the ' +
            "book's current architecture. Re-run Create Migration Plan (it generates the pack) " +
            'or generate it on the Schema migration tab.',
        },
      ],
    };
  }

  // Binding: the pack's db.* decisions must come from THIS book's target.
  const bound = boundTargetOf(packView);
  if (
    params.targetArchitectureId &&
    bound !== null &&
    bound !== params.targetArchitectureId
  ) {
    reasons.push({
      code: 'db_pack_stale',
      message:
        `The DB migration pack is bound to target ${bound} but this book targets ` +
        `${params.targetArchitectureId}. Regenerate the migration plan (it refreshes the pack ` +
        'against the correct target).',
    });
  }

  try {
    const staleness = await reads.evaluateStaleness({
      projectId: params.projectId,
      architectureId: currentArchitectureId,
      targetArchitectureId: bound ?? params.targetArchitectureId ?? null,
      storedHash: packView.inputSnapshotHash,
      storedStatus: packView.status,
      storedStaleReason: null,
    });
    if (staleness.is_stale) {
      reasons.push({
        code: 'db_pack_stale',
        message:
          `The DB migration pack is STALE (${staleness.staleness_reason ?? 'inputs changed'}). ` +
          'The specs carry pack files verbatim, so a stale pack means the specs no longer match ' +
          'reality — regenerate the migration plan before Migrate.',
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    reasons.push({
      code: 'db_pack_read_failed',
      message:
        `The DB pack staleness check could not run (${message}). Migrate fails CLOSED on ` +
        'unknown persistence inputs — retry once the inputs are readable.',
    });
  }

  const openDecisions = packView.decisions.filter((d) => d.status === 'open');
  if (openDecisions.length > 0) {
    const sample = openDecisions
      .slice(0, 5)
      .map((d) => d.decision_key)
      .join(', ');
    reasons.push({
      code: 'db_pack_decisions_unresolved',
      message:
        `${openDecisions.length} DB pack decision(s) are still open (${sample}` +
        `${openDecisions.length > 5 ? ', …' : ''}). Every needs-decision object is deliberately ` +
        'excluded from deterministic translation — resolve the queue and regenerate before Migrate.',
    });
  }

  const unapproved = packView.translations.filter(
    (t) =>
      t.disposition === 'translate' &&
      (t.review_status === 'unreviewed' || t.review_status === 'needs_rework')
  );
  if (unapproved.length > 0) {
    const kinds = [...new Set(unapproved.map((t) => t.kind))].join(', ');
    reasons.push({
      code: 'db_translations_unapproved',
      message:
        `${unapproved.length} DB-object translation draft(s) (${kinds}) are not yet approved. ` +
        'Only APPROVED translations are ever applied — review them on the Schema migration tab ' +
        'before Migrate.',
    });
  }

  // Structural findings (Spec 2026-08-04-2): every finding the CURRENT pack
  // emits must be dispositioned `accepted` or `known_gap` before Migrate;
  // undispositioned and fix_upstream findings block (fix + regenerate first).
  const openFindings = openStructuralFindings(
    packView.manifest,
    packView.structuralDispositions ?? []
  );
  if (openFindings.length > 0) {
    reasons.push({
      code: 'db_structural_findings_open',
      message:
        `${describeOpenFindings(openFindings)}. Disposition each on the Schema migration ` +
        'tab → Structural findings (accept with a reason / fix upstream + regenerate / ' +
        'known gap) before Migrate.',
    });
  }

  return { ok: reasons.length === 0, reasons };
}
