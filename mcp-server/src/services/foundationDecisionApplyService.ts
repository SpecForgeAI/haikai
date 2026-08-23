/**
 * Foundation-Decision Apply Service (Foundations & Scope program, Spec 1,
 * 2026-08-22).
 *
 * The MODEL-WRITE half of the Foundations Review: the review (Spec 2 UI, or
 * any caller) posts rule-level decisions; this service — the MCP server
 * being the model-write owner — applies them in TWO additive writes:
 *
 *   1. MODEL: for every decision carrying a `scope`, the named target
 *      entities get `migration_scope` + `scope_decision_ref` set (the
 *      GET-merge-PUT round trip candidateSaveBackService uses). Exclusion
 *      is a TAG, never a deletion; entities NOT named are never touched.
 *      Unknown entity names are skipped WHOLE with an honest reason —
 *      the name resolution doubles as the hallucination guard.
 *   2. DECISIONS: the adjudication facts are upserted to AMS
 *      (`PUT .../foundation-decisions`, keyed by decision_key) so every
 *      downstream screen can cite the receipt ('F-1').
 *
 * Key-policy decisions may also carry `payload_json.promote_pk_columns`:
 * the named entity's `constraints_metadata.primary_key` is materialized
 * additively (provenance-tagged) so the capture compensation reader works
 * UNCHANGED — the decision materializes the fact (Spec 3 consumes it).
 */

import { createHttpError } from '../middleware/errorHandler';

export interface FoundationDecisionInput {
  decision_key: string;
  rule_key: string;
  question_text?: string | null;
  answer: string;
  /** 'excluded' | 'volatile' | 'data_only' | 'in_scope' | null. */
  scope?: string | null;
  /** Target entity names (case-insensitive match against the model). */
  target_entity_names: string[];
  payload_json?: Record<string, unknown> | null;
  rationale?: string | null;
  evidence_hash?: string | null;
}

export interface SkippedTarget {
  decision_key: string;
  entity_name: string;
  reason: string;
}

export interface ApplyFoundationDecisionsResult {
  entities_updated: number;
  decisions_upserted: number;
  skipped: SkippedTarget[];
}

/** The archModelClient surface this service needs (injectable for tests). */
export interface FoundationApplyModelClient {
  getProjectById(projectId: string): Promise<{ id: string; name: string }>;
  getModel(projectId: string, architectureId: string, filename: string): Promise<any | null>;
  putModel(projectId: string, architectureId: string, filename: string, dto: any): Promise<any>;
}

export type DecisionsUpserter = (
  projectId: string,
  architectureId: string,
  decisions: FoundationDecisionInput[],
) => Promise<number>;

function resolveDefaultClient(): FoundationApplyModelClient {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { archModelClient } = require('./archModelClient');
  return archModelClient as FoundationApplyModelClient;
}

function resolveDefaultUpserter(): DecisionsUpserter {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { ARCH_MODEL_SERVICE_BASE_URL } = require('../config');
  return async (projectId, architectureId, decisions) => {
    const response = await fetch(
      `${ARCH_MODEL_SERVICE_BASE_URL}/api/projects/${encodeURIComponent(projectId)}` +
        `/architectures/${encodeURIComponent(architectureId)}/foundation-decisions`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          decisions: decisions.map((d) => ({
            decision_key: d.decision_key,
            rule_key: d.rule_key,
            question_text: d.question_text ?? null,
            answer: d.answer,
            scope: d.scope ?? null,
            targets_json: d.target_entity_names.map((name) => ({ entity_name: name })),
            payload_json: d.payload_json ?? null,
            rationale: d.rationale ?? null,
            evidence_hash: d.evidence_hash ?? null,
          })),
        }),
      },
    );
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `AMS foundation-decisions upsert failed: HTTP ${response.status} ${text.slice(0, 300)}`,
      );
    }
    const parsed = (await response.json().catch(() => [])) as unknown[];
    return Array.isArray(parsed) ? parsed.length : decisions.length;
  };
}

const VALID_SCOPES = new Set(['in_scope', 'excluded', 'volatile', 'data_only']);

/**
 * PURE core: apply decisions to a list of model physical entities (scope
 * tags + receipts + additive PK promotion). Shared by the MCP apply tool
 * (entities already exist) AND candidateSaveBackService (fresh-project
 * ordering: the review answers land BEFORE the first save, so save-back
 * reconciles stored decisions onto the entities it just created).
 */
export function applyDecisionsToEntities(
  entities: any[],
  decisions: FoundationDecisionInput[],
): { updated: number; skipped: SkippedTarget[] } {
  const byLowerName = new Map<string, any>(
    entities.filter((e: any) => e?.name).map((e: any) => [String(e.name).toLowerCase(), e]),
  );
  const skipped: SkippedTarget[] = [];
  let updated = 0;
  for (const decision of decisions) {
    for (const name of decision.target_entity_names ?? []) {
      const entity = byLowerName.get(String(name).toLowerCase());
      if (!entity) {
        skipped.push({
          decision_key: decision.decision_key,
          entity_name: name,
          reason: 'entity not found in the committed model',
        });
        continue;
      }
      let touched = false;
      if (decision.scope != null) {
        if (
          entity.migration_scope !== decision.scope ||
          entity.scope_decision_ref !== decision.decision_key
        ) {
          entity.migration_scope = decision.scope;
          entity.scope_decision_ref = decision.decision_key;
          touched = true;
        }
      }
      // Key policy materialization (Spec 3): keyless_multiset rides the
      // entity's constraints metadata so the capture compensation reader
      // resolves the DETECT-ONLY bracket policy per table.
      const keyPolicy = decision.payload_json?.key_policy;
      if (keyPolicy === 'keyless_multiset') {
        const constraints = (entity.constraints_metadata ??= {});
        if (constraints.key_policy !== 'keyless_multiset') {
          constraints.key_policy = 'keyless_multiset';
          constraints.key_policy_decision_ref = decision.decision_key;
          touched = true;
        }
      }
      const parityKey = decision.payload_json?.parity_key;
      if (Array.isArray(parityKey) && parityKey.length > 0) {
        const constraints = (entity.constraints_metadata ??= {});
        constraints.parity_key = {
          columns: parityKey.map((c) => String(c)),
          verified: decision.payload_json?.parity_key_verified === true,
          decision_ref: decision.decision_key,
        };
        touched = true;
      }
      const parityMode = decision.payload_json?.parity_mode;
      if (parityMode === 'count_checksum') {
        const constraints = (entity.constraints_metadata ??= {});
        constraints.parity_mode = 'count_checksum';
        touched = true;
      }
      const seqStrategy = decision.payload_json?.sequence_strategy;
      if (typeof seqStrategy === 'string' && seqStrategy.length > 0) {
        const constraints = (entity.constraints_metadata ??= {});
        constraints.sequence_generator = {
          strategy: seqStrategy,
          name_column: decision.payload_json?.name_column ?? null,
          number_column: decision.payload_json?.number_column ?? null,
          mappings: Array.isArray(decision.payload_json?.mappings)
            ? decision.payload_json?.mappings
            : [],
          decision_ref: decision.decision_key,
        };
        touched = true;
      }
      const promote = decision.payload_json?.promote_pk_columns;
      if (Array.isArray(promote) && promote.length > 0) {
        const constraints = (entity.constraints_metadata ??= {});
        const existing = constraints.primary_key;
        const existingColumns = Array.isArray(existing?.columns) ? existing.columns : [];
        if (existingColumns.length > 0) {
          skipped.push({
            decision_key: decision.decision_key,
            entity_name: name,
            reason: 'entity already has a declared primary key — promotion skipped (additive)',
          });
        } else {
          constraints.primary_key = {
            name: `${decision.decision_key.toLowerCase()}_promoted_pk`,
            columns: promote.map((c) => String(c)),
            provenance: 'foundation_promoted',
            decision_ref: decision.decision_key,
          };
          touched = true;
        }
      }
      if (touched) updated += 1;
    }
  }
  return { updated, skipped };
}

export interface ApplyFoundationDecisionsArgs {
  projectId: string;
  architectureId: string;
  decisions: FoundationDecisionInput[];
}

export async function applyFoundationDecisions(
  args: ApplyFoundationDecisionsArgs,
  client: FoundationApplyModelClient = resolveDefaultClient(),
  upsertDecisions: DecisionsUpserter = resolveDefaultUpserter(),
): Promise<ApplyFoundationDecisionsResult> {
  const { projectId, architectureId, decisions } = args;

  for (const d of decisions) {
    if (!d.decision_key || !d.rule_key || !d.answer) {
      throw createHttpError(
        400,
        'every decision requires decision_key, rule_key and answer',
      );
    }
    if (d.scope != null && !VALID_SCOPES.has(d.scope)) {
      throw createHttpError(
        400,
        `decision "${d.decision_key}" carries unknown scope "${d.scope}"`,
      );
    }
  }

  const project = await client.getProjectById(projectId);
  const filename = project.name;
  const model = await client.getModel(projectId, architectureId, filename);
  if (!model) {
    throw createHttpError(
      404,
      `No committed model found for project "${projectId}" / architecture "${architectureId}"`,
    );
  }

  const entities: any[] = model?.metaModel?.entities?.physical_data_entities ?? [];
  const applied = applyDecisionsToEntities(entities, decisions);
  const skipped = applied.skipped;
  const entitiesUpdated = applied.updated;

  if (entitiesUpdated > 0) {
    await client.putModel(projectId, architectureId, filename, model);
  }

  const decisionsUpserted = await upsertDecisions(projectId, architectureId, decisions);

  return { entities_updated: entitiesUpdated, decisions_upserted: decisionsUpserted, skipped };
}
