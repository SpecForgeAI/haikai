/**
 * Ensure-fresh step for the DB migration pack (Spec 2026-07-02-a — Target
 * Inputs & Pack Wiring, part of the Persistence-Tier Oracle Program).
 *
 * Create Migration Plan auto-generates/refreshes the deterministic Sybase→PG
 * migration pack so the plan's DB streams are generated FROM the pack instead
 * of blind to it (the pack was previously a dead-end side tab). Semantics:
 *
 *   - pack MISSING            → generate                     → 'generated'
 *   - pack bound to a DIFFERENT target than this plan's      → regenerate
 *   - pack STALE (input-hash drift / decision resolved)      → regenerate
 *   - pack fresh + same target                               → 'fresh' (no write)
 *   - engine gate rejects (no db.engine decision, non-PG
 *     target, non-Sybase source)                             → 'skipped'
 *   - anything else throws                                   → 'failed'
 *
 * NEVER throws — plan generation must proceed fail-soft; 'skipped'/'failed'
 * surface as plan warnings and (Spec B) prerequisite stories.
 *
 * Relationship to the 2026-06-11 "staleness never auto-regenerates" spec
 * constraint: that constraint governs the pack GET/staleness REPORT, which
 * still never mutates. THIS step runs inside an explicit user generation
 * action (the wizard's Generate click), which is a deliberate write path —
 * the program decision record (agent-os/planning/2026-07-02-…decisions.md)
 * supersedes the old "explicit tab click only" trigger.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  generateDbMigrationPack,
  GenerateDbMigrationPackRequest,
  GenerateDbMigrationPackResult,
} from './dbMigrationPackHandler';
import { evaluatePackStaleness, PackStalenessResult } from './dbMigrationPack/staleness';
import { UnsupportedEnginePairError } from './dbMigrationPack/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnsurePackStatus =
  | 'generated'
  | 'refreshed'
  | 'fresh'
  | 'skipped'
  | 'failed';

export interface EnsurePackOutcome {
  status: EnsurePackStatus;
  packId: string | null;
  inputSnapshotHash: string | null;
  /** Human-readable reason for 'refreshed' / 'skipped' / 'failed'. */
  reason: string | null;
}

/** The slice of the AMS pack row this step needs. */
export interface ExistingPackRow {
  id: string;
  status?: string | null;
  stale_reason?: string | null;
  input_snapshot_hash?: string | null;
  manifest_json?: Record<string, unknown> | null;
}

export interface EnsurePackDeps {
  listPacks?: (projectId: string, architectureId: string) => Promise<ExistingPackRow[]>;
  evaluateStaleness?: typeof evaluatePackStaleness;
  generatePack?: (
    request: GenerateDbMigrationPackRequest
  ) => Promise<GenerateDbMigrationPackResult>;
}

export type EnsurePackFn = (args: {
  projectId: string;
  currentArchitectureId: string;
  targetArchitectureId: string;
}) => Promise<EnsurePackOutcome>;

// ---------------------------------------------------------------------------
// Default AMS reads
// ---------------------------------------------------------------------------

const defaultListPacks: NonNullable<EnsurePackDeps['listPacks']> = async (
  projectId,
  architectureId
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/db-migration-packs?architecture_id=${encodeURIComponent(architectureId)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`AMS pack list fetch failed: HTTP ${response.status} ${text}`);
  }
  const rows = (await response.json()) as ExistingPackRow[];
  return Array.isArray(rows) ? rows : [];
};

// ---------------------------------------------------------------------------
// The step
// ---------------------------------------------------------------------------

function boundTargetOf(pack: ExistingPackRow): string | null {
  const manifest = pack.manifest_json ?? {};
  const bound = (manifest as Record<string, unknown>).target_architecture_id;
  return typeof bound === 'string' && bound.length > 0 ? bound : null;
}

export const ensureFreshDbMigrationPack: EnsurePackFn = async (args) => {
  return ensureFreshDbMigrationPackWithDeps(args, {});
};

/** Deps-injectable variant (unit tests). */
export async function ensureFreshDbMigrationPackWithDeps(
  args: {
    projectId: string;
    currentArchitectureId: string;
    targetArchitectureId: string;
  },
  deps: EnsurePackDeps
): Promise<EnsurePackOutcome> {
  const { projectId, currentArchitectureId, targetArchitectureId } = args;
  const listPacks = deps.listPacks ?? defaultListPacks;
  const evaluateStaleness = deps.evaluateStaleness ?? evaluatePackStaleness;
  const generatePack =
    deps.generatePack ?? ((request) => generateDbMigrationPack(request));

  const generate = async (
    status: Extract<EnsurePackStatus, 'generated' | 'refreshed'>,
    reason: string | null
  ): Promise<EnsurePackOutcome> => {
    const result = await generatePack({
      projectId,
      architectureId: currentArchitectureId,
      targetArchitectureId,
    });
    console.log(
      `[diag-gateway] db_migration_pack_ensure status=${status} projectId=${projectId} ` +
        `packId=${result.pack.id}${reason ? ` reason=${JSON.stringify(reason)}` : ''}`
    );
    return {
      status,
      packId: result.pack.id,
      inputSnapshotHash: result.inputSnapshotHash,
      reason,
    };
  };

  try {
    const packs = await listPacks(projectId, currentArchitectureId);
    const existing = packs.length > 0 ? packs[0] : null;

    if (!existing) {
      return await generate('generated', null);
    }

    // Different decision-binding target than THIS plan's → the pack's
    // db.* decisions may disagree with the plan's; regenerate against the
    // plan's target. (Legacy packs with no binding count as different.)
    const bound = boundTargetOf(existing);
    if (bound !== targetArchitectureId) {
      return await generate(
        'refreshed',
        `pack was bound to target ${bound ?? '<none/legacy>'}; plan targets ${targetArchitectureId}`
      );
    }

    const staleness: PackStalenessResult = await evaluateStaleness({
      projectId,
      architectureId: currentArchitectureId,
      targetArchitectureId,
      storedHash: existing.input_snapshot_hash ?? null,
      storedStatus: existing.status ?? null,
      storedStaleReason: existing.stale_reason ?? null,
    });
    if (staleness.is_stale) {
      return await generate('refreshed', staleness.staleness_reason ?? 'stale');
    }

    console.log(
      `[diag-gateway] db_migration_pack_ensure status=fresh projectId=${projectId} packId=${existing.id}`
    );
    return {
      status: 'fresh',
      packId: existing.id,
      inputSnapshotHash: existing.input_snapshot_hash ?? null,
      reason: null,
    };
  } catch (error) {
    if (error instanceof UnsupportedEnginePairError) {
      // Legitimate non-generatable state (no db.engine captured yet, or a
      // pair the deterministic pack does not support) — the plan proceeds
      // and Spec B emits the prerequisite story.
      logger.info('DB migration pack ensure skipped (engine gate)', {
        projectId,
        reason: error.message,
      });
      return { status: 'skipped', packId: null, inputSnapshotHash: null, reason: error.message };
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.warn('DB migration pack ensure failed; plan generation proceeds without it', {
      projectId,
      error: message,
    });
    return { status: 'failed', packId: null, inputSnapshotHash: null, reason: message };
  }
}
