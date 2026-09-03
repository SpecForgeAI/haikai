/**
 * Re-land COMMITTED `endpoint_data_effects` candidates (2026-09-03).
 *
 * Why this exists: the save-back lands effect rows in a SECOND model PUT
 * (they FK to entities the first PUT creates). Pre-fix a phase-2 failure was
 * swallowed and every candidate was still stamped `committed` with its
 * pre-allocated `ede-` id — while AMS's replace-all PUT had already deleted
 * the prior rows. The candidates are intact (endpoint side, table side,
 * access mode, path metadata, the row id itself), so recovery is a straight
 * re-insert: no re-scan, no LLM, no re-approval.
 *
 * Idempotent and ADDITIVE: rows already present (by id, or by the
 * (endpoint, data-entity point, access_mode) identity the save-back itself
 * uses) are reported as `alreadyPresent`; nothing is deleted or rewritten.
 * The model is re-read after the PUT and every re-landed id must be present,
 * otherwise the call fails loudly — the exact assertion the original bug
 * lacked.
 */

import { createHttpError } from '../middleware/errorHandler';
import type { DiscoveryCandidateDto } from './archModelClient';
import { convertEndpointDataEffectToRow } from './candidateSaveBackService';

export interface RelandModelClient {
  getProjectById(projectId: string): Promise<{ id: string; name: string }>;
  getModel(projectId: string, architectureId: string, filename: string): Promise<any | null>;
  putModel(projectId: string, architectureId: string, filename: string, dto: any): Promise<any>;
  getCandidatesByRun(
    projectId: string,
    architectureId: string,
    runId: string,
    type?: string,
    status?: string
  ): Promise<DiscoveryCandidateDto[]>;
}

function resolveDefaultClient(): RelandModelClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { archModelClient } = require('./archModelClient');
  return archModelClient as RelandModelClient;
}

export interface RelandCommittedEffectsArgs {
  projectId: string;
  architectureId: string;
  /** Discovery runs whose committed effect candidates should be re-landed. */
  runIds: string[];
}

export interface RelandSkip {
  runId: string;
  candidateId: string;
  reason: string;
}

export interface RelandCommittedEffectsResult {
  runsScanned: number;
  candidatesSeen: number;
  relanded: number;
  alreadyPresent: number;
  skipped: RelandSkip[];
}

function isCommitted(c: DiscoveryCandidateDto): boolean {
  const s = String(c.status ?? '').toLowerCase();
  const r = String(c.review_status ?? '').toLowerCase();
  return s === 'committed' || s === 'committed_excluded' || r === 'committed';
}

function identityKey(row: any): string {
  return `${row?.endpoint_id ?? ''}|${row?.data_entity_point_id ?? ''}|${String(
    row?.access_mode ?? ''
  ).toLowerCase()}`;
}

export async function relandCommittedEffects(
  args: RelandCommittedEffectsArgs,
  client: RelandModelClient = resolveDefaultClient()
): Promise<RelandCommittedEffectsResult> {
  const { projectId, architectureId, runIds } = args;
  const project = await client.getProjectById(projectId);
  const filename = project.name;
  const model = await client.getModel(projectId, architectureId, filename);
  if (!model) {
    throw createHttpError(
      404,
      `No committed model found for project "${projectId}" / architecture "${architectureId}" — ` +
        'effect rows can only be re-landed onto an existing model'
    );
  }
  if (!model.metaModel) model.metaModel = {};
  if (!model.metaModel.relationships) model.metaModel.relationships = {};
  if (!Array.isArray(model.metaModel.relationships.endpoint_data_effects)) {
    model.metaModel.relationships.endpoint_data_effects = [];
  }
  const edges: any[] = model.metaModel.relationships.endpoint_data_effects;
  const presentIds = new Set<string>(edges.map((e) => String(e?.id ?? '')).filter(Boolean));
  const presentKeys = new Set<string>(edges.map(identityKey));

  const result: RelandCommittedEffectsResult = {
    runsScanned: 0,
    candidatesSeen: 0,
    relanded: 0,
    alreadyPresent: 0,
    skipped: [],
  };
  const relandedIds: string[] = [];

  for (const runId of runIds) {
    const candidates = await client.getCandidatesByRun(
      projectId,
      architectureId,
      runId,
      'endpoint_data_effects'
    );
    result.runsScanned += 1;
    for (const candidate of candidates) {
      if (String(candidate.candidate_type) !== 'endpoint_data_effects') continue;
      if (!isCommitted(candidate)) continue;
      result.candidatesSeen += 1;
      const conversion = convertEndpointDataEffectToRow(candidate, model, filename);
      if (!conversion.resolved || !conversion.row) {
        result.skipped.push({
          runId,
          candidateId: candidate.id,
          reason: `could not resolve the ${conversion.unresolvedSide ?? 'endpoint'} side to a model id`,
        });
        continue;
      }
      const row = { ...conversion.row };
      // Keep the id the save-back stamped on the candidate so provenance
      // mappings and the candidate's committedEntityId stay truthful.
      const stamped = (candidate.data as Record<string, unknown> | undefined)?.committedEntityId;
      if (typeof stamped === 'string' && /^ede-/.test(stamped)) row.id = stamped;
      if (presentIds.has(String(row.id)) || presentKeys.has(identityKey(row))) {
        result.alreadyPresent += 1;
        continue;
      }
      edges.push(row);
      presentIds.add(String(row.id));
      presentKeys.add(identityKey(row));
      relandedIds.push(String(row.id));
      result.relanded += 1;
    }
  }

  if (result.relanded === 0) return result;

  await client.putModel(projectId, architectureId, filename, model);

  // Post-PUT assertion — the check the original two-phase save lacked.
  const after = await client.getModel(projectId, architectureId, filename);
  const afterIds = new Set<string>(
    ((after?.metaModel?.relationships?.endpoint_data_effects ?? []) as any[])
      .map((e) => String(e?.id ?? ''))
      .filter(Boolean)
  );
  const missing = relandedIds.filter((id) => !afterIds.has(id));
  if (missing.length > 0) {
    throw createHttpError(
      502,
      `Re-land PUT returned success but ${missing.length} of ${relandedIds.length} effect rows ` +
        `are absent from the model afterwards (first missing id: ${missing[0]}). ` +
        'The store dropped rows silently — nothing was stamped; investigate the model PUT.'
    );
  }
  return result;
}
