/**
 * DB-change → affected-consumer computation + scoped revalidation
 * (Spec 2026-07-06-f — T-SQL Affinity & Consumer Revalidation, Code-Tier
 * Oracle Program).
 *
 * Answers "which ENDPOINTS does this database migration touch?" so the plan
 * can flag them (`dialect_affected` individual stories) and a scoped
 * revalidation run can prove exactly those endpoints still behave
 * identically. An endpoint is AFFECTED iff it:
 *
 *   1. touches a TRANSLATED proc/view (a DB-pack translation draft with
 *      disposition `translate`) — via the AMS reverse query;
 *   2. carries T-SQL dialect SQL on any of its data-effect edges (the
 *      discovery classifier's `sql_dialect: 'tsql'` stamp); or
 *   3. touches a TABLE whose pack changeset alters shape (caller-supplied
 *      altered-table names) — via the AMS reverse query.
 *
 * Every hit carries its reason(s) — the plan and the revalidation report
 * both say WHY an endpoint is in the set, never just that it is.
 */

import { logger } from './logger';
import { getConfig } from '../config';
import {
  fetchEffectsByDataEntityPointIds,
  type EndpointDataEffectRow,
} from './endpointDataEffectsClient';
import type { PackTranslationRow } from './migrationDbPackPlanner';
import {
  runScopedParityVerify,
  type ParityVerdict,
  type ParityVerifyDeps,
} from './migrationParityVerifier';
import type { TargetApiAuthSecret } from './migrationTargetCredentialsStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AffectedReason =
  | 'translated_proc'
  | 'tsql_dialect_sql'
  | 'altered_table';

export interface AffectedConsumerSet {
  /** Endpoint element ids, deduplicated. */
  affectedEndpointIds: string[];
  /** Normalised `"METHOD /path"` keys (endpoints with a resolvable verb+path). */
  affectedEndpointKeys: string[];
  /** Why each endpoint is in the set (id → reasons). */
  reasonsByEndpointId: Map<string, AffectedReason[]>;
}

/** The DB pack's object set, reduced to what the computation needs. */
export interface PackObjectSet {
  /** Proc/view names with a `translate`-disposition draft (schema-tolerant). */
  translatedObjectNames: string[];
  /** Table names whose pack changesets alter shape. */
  alteredTableNames: string[];
}

export interface ConsumerResolverReads {
  /**
   * ONE full-model read: endpoints (id → verb/path) + physical entities
   * (name → `dep_phy_` id) + data-effect edges w/ metadata (for the tsql
   * dimension — the model relationships carry `path_metadata_json`).
   */
  fetchModelIndex(projectId: string, architectureId: string): Promise<ModelIndex | null>;
  fetchEffectsByDataEntityPointIds: typeof fetchEffectsByDataEntityPointIds;
}

export interface ModelIndex {
  /** endpoint id → normalised `"METHOD /path"` key (null when unresolvable). */
  endpointKeyById: Map<string, string | null>;
  /** lowercase bare physical-entity name → `dep_phy_<id>` point id. */
  depIdByPhysicalName: Map<string, string>;
  /** data-effect edges from the model read (metadata carried verbatim). */
  effects: EndpointDataEffectRow[];
}

// ---------------------------------------------------------------------------
// Default reads
// ---------------------------------------------------------------------------

/** Strip schema + brackets, lowercase — the classifier's matching posture. */
export function normalizeObjectName(raw: string): string {
  const cleaned = raw.replace(/[[\]"'`]/g, '').trim();
  const parts = cleaned.split('.');
  return (parts[parts.length - 1] ?? cleaned).toLowerCase();
}

export function defaultConsumerResolverReads(): ConsumerResolverReads {
  return {
    async fetchModelIndex(projectId, architectureId) {
      try {
        const baseUrl = getConfig().architectureModelServiceBaseUrl;
        const url =
          `${baseUrl}/api/model/projects/${encodeURIComponent(projectId)}` +
          `/architectures/${encodeURIComponent(architectureId)}`;
        const response = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!response.ok) return null;
        const model = (await response.json()) as {
          metaModel?: {
            entities?: {
              endpoints?: Array<{
                id?: string;
                operation_verb?: string;
                path_or_address?: string;
              }>;
              physical_data_entities?: Array<{ id?: string; name?: string }>;
            };
            relationships?: {
              endpoint_data_effects?: Array<{
                id?: string;
                endpoint_id?: string;
                data_entity_point_id?: string;
                access_mode?: string;
                path_metadata_json?: Record<string, unknown> | null;
              }>;
            };
          };
        };
        const endpointKeyById = new Map<string, string | null>();
        for (const ep of model.metaModel?.entities?.endpoints ?? []) {
          if (!ep.id) continue;
          const verb = (ep.operation_verb ?? '').toUpperCase();
          const path = ep.path_or_address ?? '';
          endpointKeyById.set(ep.id, verb && path ? `${verb} ${path}` : null);
        }
        const depIdByPhysicalName = new Map<string, string>();
        for (const entity of model.metaModel?.entities?.physical_data_entities ?? []) {
          if (entity.id && entity.name) {
            depIdByPhysicalName.set(normalizeObjectName(entity.name), `dep_phy_${entity.id}`);
          }
        }
        const effects: EndpointDataEffectRow[] = (
          model.metaModel?.relationships?.endpoint_data_effects ?? []
        )
          .filter((e) => e.endpoint_id && e.data_entity_point_id)
          .map((e) => ({
            id: e.id ?? '',
            endpoint_id: e.endpoint_id as string,
            data_entity_point_id: e.data_entity_point_id as string,
            access_mode: e.access_mode ?? null,
            path_metadata_json: e.path_metadata_json ?? null,
          }));
        return { endpointKeyById, depIdByPhysicalName, effects };
      } catch (error) {
        logger.warn('[diag-gateway] db_consumer_resolver model_read_failed', {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    fetchEffectsByDataEntityPointIds,
  };
}

// ---------------------------------------------------------------------------
// Pack object-set adapter (pure)
// ---------------------------------------------------------------------------

/**
 * Reduce the DB pack's translation rows to the object set the computation
 * needs: `translate`-disposition drafts are the procs/views being rewritten.
 * `object_ref` tolerates `kind:name` / `schema.name` forms.
 */
export function packObjectSetFromTranslations(
  translations: PackTranslationRow[],
  alteredTableNames: string[] = [],
): PackObjectSet {
  const translated: string[] = [];
  for (const row of translations) {
    if (row.disposition !== 'translate') continue;
    const ref = row.object_ref ?? '';
    const name = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
    if (name.trim().length > 0) translated.push(name.trim());
  }
  return { translatedObjectNames: translated, alteredTableNames };
}

// ---------------------------------------------------------------------------
// The affected-consumer computation
// ---------------------------------------------------------------------------

export async function resolveAffectedConsumers(params: {
  projectId: string;
  currentArchitectureId: string;
  packObjects: PackObjectSet;
  reads?: ConsumerResolverReads;
}): Promise<AffectedConsumerSet> {
  const reads = params.reads ?? defaultConsumerResolverReads();
  const reasonsByEndpointId = new Map<string, AffectedReason[]>();
  const addReason = (endpointId: string, reason: AffectedReason): void => {
    const existing = reasonsByEndpointId.get(endpointId) ?? [];
    if (!existing.includes(reason)) existing.push(reason);
    reasonsByEndpointId.set(endpointId, existing);
  };

  const index = await reads.fetchModelIndex(
    params.projectId,
    params.currentArchitectureId,
  );
  if (!index) {
    // Unreadable model: EMPTY set with a log — the callers (planner flag,
    // revalidation route) treat empty as "nothing to flag/verify", and the
    // pre-dispatch gate's own reads fail closed independently.
    logger.warn('[diag-gateway] db_consumer_resolver empty_set_model_unreadable', {
      projectId: params.projectId,
    });
    return { affectedEndpointIds: [], affectedEndpointKeys: [], reasonsByEndpointId };
  }

  // (2) T-SQL dialect SQL on any edge — from the model read's metadata.
  for (const effect of index.effects) {
    const dialect = (effect.path_metadata_json as { sql_dialect?: string } | null)?.sql_dialect;
    if (dialect === 'tsql') addReason(effect.endpoint_id, 'tsql_dialect_sql');
  }

  // (1) + (3) — reverse queries by the pack objects' dep ids.
  const translatedDepIds: string[] = [];
  for (const name of params.packObjects.translatedObjectNames) {
    const dep = index.depIdByPhysicalName.get(normalizeObjectName(name));
    if (dep) translatedDepIds.push(dep);
  }
  const alteredDepIds: string[] = [];
  for (const name of params.packObjects.alteredTableNames) {
    const dep = index.depIdByPhysicalName.get(normalizeObjectName(name));
    if (dep) alteredDepIds.push(dep);
  }
  if (translatedDepIds.length > 0) {
    const rows = await reads.fetchEffectsByDataEntityPointIds(
      params.projectId,
      params.currentArchitectureId,
      translatedDepIds,
    );
    for (const row of rows) addReason(row.endpoint_id, 'translated_proc');
  }
  if (alteredDepIds.length > 0) {
    const rows = await reads.fetchEffectsByDataEntityPointIds(
      params.projectId,
      params.currentArchitectureId,
      alteredDepIds,
    );
    for (const row of rows) addReason(row.endpoint_id, 'altered_table');
  }

  const affectedEndpointIds = [...reasonsByEndpointId.keys()].sort();
  const affectedEndpointKeys = affectedEndpointIds
    .map((id) => index.endpointKeyById.get(id) ?? null)
    .filter((key): key is string => key !== null);

  logger.info('[diag-gateway] db_consumer_resolver affected_set', {
    projectId: params.projectId,
    affected: affectedEndpointIds.length,
    keys: affectedEndpointKeys.length,
  });
  return { affectedEndpointIds, affectedEndpointKeys, reasonsByEndpointId };
}

// ---------------------------------------------------------------------------
// Scoped revalidation convenience (§5 — consumes Spec I's scoped verify)
// ---------------------------------------------------------------------------

export interface RevalidateDbConsumersResult {
  affected: AffectedConsumerSet;
  /** Null when the affected set is empty — nothing to revalidate. */
  verdict: ParityVerdict | null;
}

/**
 * Compute the affected set and run ONE scoped replay+diff over exactly those
 * endpoints against the pinned current baseline. Target auth is
 * per-invocation and in-memory only (the Spec E credentials pattern).
 */
export async function revalidateDbConsumers(
  args: {
    projectId: string;
    currentArchitectureId: string;
    sourceBaselineId: string;
    targetBaseUrl: string;
    api: TargetApiAuthSecret;
    packObjects: PackObjectSet;
  },
  deps: {
    reads?: ConsumerResolverReads;
    verify?: typeof runScopedParityVerify;
    verifyDeps?: ParityVerifyDeps;
  } = {},
): Promise<RevalidateDbConsumersResult> {
  const verify = deps.verify ?? runScopedParityVerify;
  const affected = await resolveAffectedConsumers({
    projectId: args.projectId,
    currentArchitectureId: args.currentArchitectureId,
    packObjects: args.packObjects,
    reads: deps.reads,
  });
  if (affected.affectedEndpointKeys.length === 0) {
    return { affected, verdict: null };
  }
  const verdict = await verify(
    {
      projectId: args.projectId,
      architectureId: args.currentArchitectureId,
      sourceBaselineId: args.sourceBaselineId,
      targetBaseUrl: args.targetBaseUrl,
      api: args.api,
      endpointScope: affected.affectedEndpointKeys,
    },
    deps.verifyDeps ?? {},
  );
  return { affected, verdict };
}
