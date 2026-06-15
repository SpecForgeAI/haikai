/**
 * Endpoint -> Data-Effect candidate builder (Spring Classic).
 *
 * Spec: 2026-05-29 Endpoint->Data-Effect Call Graph for Discovery, Task Group 3
 * (sub-tasks 3.4 + 3.6).
 *
 * Turns the structural {@link ResolvedDataEffect}s from
 * {@link resolveEndpointDataEffects} into `endpoint_data_effects`
 * DiscoveryCandidates: ONE per (endpoint, data-entity) pair, surfaced in the
 * NORMAL candidate-review stream (NOT a finding) under the three-outcome
 * confidence model.
 *
 * The candidate's `data` is shaped to align EXACTLY with what the MCP save-back
 * layer (Task Group 2, `convertEndpointDataEffectToRow`) reads BY NAME:
 *   - `endpointName`         -> resolves the `endpoints` side at save-back
 *   - `dataEntityName`       -> resolves the data-entity-point side (normalized name)
 *   - `access_mode`          -> the AMS row's headline access mode
 *   - `confidence`           -> the edge confidence (three-outcome model)
 *   - `path_metadata_json`   -> the STRUCTURED ordered hop list + operation hint
 *                               + `transactional` flag + (Data-Layer Fidelity 2)
 *                               the verbatim `query_text` / `query_kind` of the
 *                               SQL behind the edge (stored now so a future
 *                               call-tree / SQL-viewer UI needs no schema migration)
 *
 * Method identity (FQN + signature) is stamped onto every path hop
 * (sub-task 3.6) so a later spec (Gap C) can attach behaviour to methods
 * without persisting the whole call graph. No `class`/`method` candidate types
 * are introduced.
 *
 * `uses_data` wiring (sub-task 3.2): the edge IS the discovery surface of the
 * unwired `uses_data` relationship type (`discovery-service/src/types/
 * relationship.ts`). This builder is its first producer -- it stamps a
 * `relationshipType: 'uses_data'` discriminator plus the `accessType` /
 * `dataIdentifier` payload (`UsesDataRelationshipData`) onto the candidate
 * `data` so the edge self-documents which relationship type it realises.
 */

import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR } from '../../languageIR';
import type { RelationshipType, UsesDataRelationshipData } from '../../../../types/relationship';
import {
  resolveEndpointDataEffects,
  type ResolvedDataEffect,
  type PathHop,
  type QueryKind,
} from './endpointDataEffectResolver';

/**
 * The structured, ordered hop list persisted in `path_metadata_json`. Each hop
 * is an FQN + method signature so a future call-tree UI can render the path
 * without a schema migration.
 */
export interface EndpointDataEffectPathMetadata {
  /** Ordered controller -> service -> repository hops (FQN + signature each). */
  hops: Array<{
    method_id: string;
    class_name: string;
    method_name: string;
    role: 'controller' | 'service' | 'repository';
  }>;
  /** Finer operation hint (insert / update / delete / select / insert-or-update). */
  operation_hint: string;
  /** Whether any @Transactional was present on the resolved path. */
  transactional: boolean;
  /**
   * The VERBATIM SQL/JPQL text behind this edge, when one was statically
   * captured from the resolved repository method (Data-Layer Fidelity 2,
   * Task Group A). Present ONLY when an explicit SQL/JPQL string was found
   * (a `@Query` JPQL / native value or a MyBatis statement annotation);
   * Spring-Data derived queries carry no `query_text`. Captured EXACTLY as the
   * source carried it -- no normalization. Additive key into the free-form
   * `path_metadata_json` JSONB -- no schema change.
   */
  query_text?: string;
  /** The dialect/source of {@link query_text}; present only when `query_text` is. */
  query_kind?: QueryKind;
}

function toPathMetadata(edge: ResolvedDataEffect): EndpointDataEffectPathMetadata {
  const meta: EndpointDataEffectPathMetadata = {
    hops: edge.path.map((h: PathHop) => ({
      method_id: h.methodId,
      class_name: h.className,
      method_name: h.methodName,
      role: h.role,
    })),
    operation_hint: edge.operationHint,
    transactional: edge.transactional,
  };
  // Additive SQL-text keys (Data-Layer Fidelity 2, Task Group A). Emitted only
  // when an explicit query string was captured, so derived-query edges stay
  // unchanged. Verbatim -- no normalization.
  if (edge.queryText !== undefined) {
    meta.query_text = edge.queryText;
    if (edge.queryKind !== undefined) meta.query_kind = edge.queryKind;
  }
  return meta;
}

/**
 * Build `endpoint_data_effects` candidates for every resolved
 * endpoint->data-entity edge across the scanned IR.
 *
 * Confidence handling (three-outcome model, NO new candidate state):
 *   - The resolver's per-edge `confidence` is carried verbatim onto the
 *     candidate. Edges >= the auto-accept threshold flow through as normal
 *     high-confidence candidates; edges below it remain NORMAL candidates that
 *     simply carry a LOW confidence (surfaced in the standard review stream,
 *     not the Findings tab). Genuinely UNRESOLVED chains are NOT here at all --
 *     they come back from the resolver as `unresolved` and are emitted as
 *     findings by the finding scanner.
 */
export function buildEndpointDataEffectCandidates(
  files: SourceFileIR[],
  runId: string,
): DiscoveryCandidate[] {
  const { resolved } = resolveEndpointDataEffects(files);
  const candidates: DiscoveryCandidate[] = [];

  // Dedupe defensively on (endpoint, entity) -- the resolver already collapses
  // per entity, but a malformed IR with duplicate controller classes could
  // double up.
  const seen = new Set<string>();

  for (const edge of resolved) {
    const key = `${edge.endpointName}=>${edge.dataEntityName}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const pathMetadata = toPathMetadata(edge);
    const usesData: UsesDataRelationshipData = {
      accessType: edge.accessMode,
      dataIdentifier: edge.dataEntityName,
    };

    const data: Record<string, unknown> = {
      // --- save-back resolution keys (read BY NAME by the MCP layer) ---
      endpointName: edge.endpointName,
      dataEntityName: edge.dataEntityName,
      // AMS row headline fields (snake_case so they pass straight through).
      access_mode: edge.accessMode,
      operation_hint: edge.operationHint,
      transactional: edge.transactional,
      confidence: edge.confidence,
      // STRUCTURED ordered hop list (FQN + signature each) -- the AMS
      // `path_metadata_json` column. Stored now so a future call-tree UI needs
      // no schema migration. Also carries the verbatim `query_text`/`query_kind`
      // (Data-Layer Fidelity 2, Task Group A) when an explicit SQL/JPQL string
      // was captured.
      path_metadata_json: pathMetadata,
      // Context for the candidate-review UI.
      controllerClassName: edge.controllerClassName,
      endpointMethodName: edge.endpointMethodName,
      // `uses_data` is the relationship type this edge realises (first producer).
      relationshipType: 'uses_data' as RelationshipType,
      usesData,
      _addedBy: 'spring-classic-adapter',
    };

    const candidate: DiscoveryCandidate = {
      id: uuidv4(),
      runId,
      candidateType: 'endpoint_data_effects',
      // Human-readable name mirrors the other relationship candidates'
      // `Source → Target` arrow convention.
      name: `${edge.endpointName} → ${edge.dataEntityName} (${edge.accessMode})`,
      // Carry the resolver's confidence so the three-outcome model is honoured
      // WITHOUT a new candidate state (high -> normal; low-but-resolved ->
      // normal w/ low confidence).
      confidence: edge.confidence,
      status: 'proposed',
      sourceClusterIds: [edge.sourceFilePath],
      data,
      synthesizedAt: new Date().toISOString(),
    };
    candidates.push(candidate);
  }

  if (candidates.length > 0) {
    console.log(
      `[spring-classic] endpoint_data_effects: emitted ${candidates.length} edge candidate(s).`,
    );
  }
  return candidates;
}
