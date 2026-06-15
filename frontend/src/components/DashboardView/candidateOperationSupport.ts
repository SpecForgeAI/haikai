/**
 * candidateOperationSupport
 *
 * Spec 2026-05-30 (Model-Aware Discovery -- dedup against existing entities +
 * enrichment/link candidates) -- Task Group 5.
 *
 * Tiny, dependency-free (no React) helpers that read the candidate OPERATION
 * dimension and its resolved target NAME(s) off a `DiscoveryCandidateDto`.
 * Kept in lock-step with the WIRE CONTRACT defined by the earlier layers of
 * this build:
 *
 *   - The AMS + frontend wire field is snake_case `operation`
 *     (`'create' | 'enrich' | 'link'`, default `'create'`).
 *   - For `enrich` candidates the single target entity NAME rides on the
 *     candidate `data` payload (carried from discovery, resolved LATE at
 *     save-back). The save-back reader is
 *     `mcp-server/src/services/candidateSaveBackService.ts`
 *     `readEnrichTargetName`, which reads (in order):
 *       data.targetEntityName -> data.target_entity_name ->
 *       data.logicalEntityName -> data.entityName -> data.target
 *   - For `link` candidates BOTH endpoint NAMES ride on `data`. The save-back
 *     link pass reads:
 *       logical:  data.logicalEntityName  -> data.logical_entity_name
 *       physical: data.physicalEntityName -> data.physical_entity_name
 *   - "What is added" by an enrich candidate also rides on `data`:
 *       attribute name: data.attributeName -> data.name
 *       attribute type: data.dataType -> data.data_type
 *       related entity (add-relationship enrich):
 *                       data.relatedEntityName -> data.targetEntity ->
 *                       data.sourceEntity
 *       relationship metadata: data.relationshipType, data.cardinality
 *
 * Every read is DEFENSIVE: a missing key falls back gracefully so the row /
 * details panel still renders (NO silent failure). The discovery emitter in
 * `discovery-service/src/services/llmGapFillStep.ts` defaults the operation to
 * `'create'` and never resolves an id here, so an absent `operation` MUST be
 * treated as `'create'` for older rows.
 */

import type { DiscoveryCandidateDto } from '../../api/discoveryApi';

/**
 * The three valid candidate operations.
 */
export type CandidateOperation = 'create' | 'enrich' | 'link';

/**
 * Read the candidate's `operation`, tolerating absence / unknown values by
 * defaulting to `'create'` (older rows persisted before the
 * `166-discovery-candidate-operation` changeset have no wire field).
 */
export function readCandidateOperation(candidate: DiscoveryCandidateDto): CandidateOperation {
  const raw = candidate.operation;
  if (raw === 'enrich' || raw === 'link') {
    return raw;
  }
  return 'create';
}

/**
 * Read the FIRST present string value among a list of candidate `data` keys.
 * Returns `undefined` when none are present / non-empty so callers can fall
 * back gracefully.
 */
function readFirstString(
  data: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === 'string' && v.length > 0) {
      return v;
    }
  }
  return undefined;
}

/**
 * Resolve the single `enrich` target entity NAME off the candidate `data`,
 * mirroring `candidateSaveBackService.readEnrichTargetName` exactly.
 */
export function readEnrichTargetName(candidate: DiscoveryCandidateDto): string | undefined {
  const data = (candidate.data || {}) as Record<string, unknown>;
  return readFirstString(data, [
    'targetEntityName',
    'target_entity_name',
    'logicalEntityName',
    'entityName',
    'target',
  ]);
}

/**
 * Resolve BOTH endpoint NAMES of a logical<->physical `link` candidate off the
 * candidate `data`, mirroring the save-back link pass key order.
 */
export function readLinkEndpointNames(candidate: DiscoveryCandidateDto): {
  logicalName: string | undefined;
  physicalName: string | undefined;
} {
  const data = (candidate.data || {}) as Record<string, unknown>;
  return {
    logicalName: readFirstString(data, ['logicalEntityName', 'logical_entity_name']),
    physicalName: readFirstString(data, ['physicalEntityName', 'physical_entity_name']),
  };
}

/**
 * What an `enrich` candidate is ADDING to the resolved target: the attribute
 * being added (name + optional data type) and/or the related entity +
 * relationship metadata for an add-relationship enrich. Every field is
 * optional -- absence means that aspect was not emitted on `data`.
 */
export interface EnrichAddition {
  /** Name of the attribute being added (add-attribute enrich). */
  attributeName?: string;
  /** Declared data type of the attribute, if emitted. */
  attributeDataType?: string;
  /** The second pre-existing entity for an add-relationship enrich. */
  relatedEntityName?: string;
  /** Relationship type (e.g. `association`), if emitted. */
  relationshipType?: string;
  /** Cardinality (e.g. `ONE_TO_MANY`), if emitted. */
  cardinality?: string;
}

/**
 * Read the "what is added" payload for an `enrich` candidate off its `data`,
 * mirroring `applyEnrichAttribute` (attribute name + data type) and the
 * relationship-bearing enrich pass (related entity + relationship metadata) in
 * `candidateSaveBackService`. Defensive: every field falls back to absent.
 */
export function readEnrichAddition(candidate: DiscoveryCandidateDto): EnrichAddition {
  const data = (candidate.data || {}) as Record<string, unknown>;

  // Attribute name: explicit `attributeName` / `name`, else the `field`
  // portion of a `Parent.field` candidate name, else the whole candidate name
  // (matches applyEnrichAttribute's derivation).
  let attributeName = readFirstString(data, ['attributeName', 'name']);
  if (!attributeName && typeof candidate.name === 'string') {
    const dotIdx = candidate.name.indexOf('.');
    attributeName = dotIdx > 0 ? candidate.name.slice(dotIdx + 1) : candidate.name;
  }

  const attributeDataType = readFirstString(data, ['dataType', 'data_type']);
  const relatedEntityName = readFirstString(data, [
    'relatedEntityName',
    'targetEntity',
    'sourceEntity',
  ]);
  const relationshipType = readFirstString(data, ['relationshipType']);
  const cardinality = readFirstString(data, ['cardinality']);

  return {
    attributeName: attributeName && attributeName.length > 0 ? attributeName : undefined,
    attributeDataType,
    relatedEntityName,
    relationshipType,
    cardinality,
  };
}

/**
 * Compose the short per-row BADGE LABEL for a candidate's operation, used
 * alongside `TierBadge` / `DiscoveryMethodChip` in the Candidates stream:
 *   - enrich -> "Enrich existing <target>" (or "Enrich existing" if target
 *     name is absent)
 *   - link   -> "Link <logical><->><physical>" (or "Link" when both absent)
 *   - create -> "Create new"
 *
 * The `<->` glyph is the U+2194 LEFT RIGHT ARROW to match the spec's
 * "Link `Owner`<->`owners`" wording.
 */
export function getOperationBadgeLabel(candidate: DiscoveryCandidateDto): string {
  const operation = readCandidateOperation(candidate);
  if (operation === 'enrich') {
    const target = readEnrichTargetName(candidate);
    return target ? `Enrich existing ${target}` : 'Enrich existing';
  }
  if (operation === 'link') {
    const { logicalName, physicalName } = readLinkEndpointNames(candidate);
    if (logicalName && physicalName) {
      return `Link ${logicalName}↔${physicalName}`;
    }
    if (logicalName || physicalName) {
      return `Link ${logicalName ?? physicalName}`;
    }
    return 'Link';
  }
  return 'Create new';
}
