/**
 * SOAP operation -> DB data-effect emitter (Spec 4, Task Group 5).
 *
 * Spec: agent-os/specs/2026-05-30-soap-wsdl-message-field-depth/spec.md
 *
 * ===========================================================================
 * Purpose
 * ===========================================================================
 *
 * Give SOAP operations the SAME operation->DB data-effect chain Spec 1 built
 * for REST endpoints. The downstream controller(handler)->service->repository->
 * entity walk is REUSED VERBATIM from Spec 1's
 * `endpointDataEffectResolver.ts`; the ONLY new part is detecting the SOAP
 * entry-point (a `@Endpoint`/`@PayloadRoot` Spring-WS handler or a `@WebMethod`
 * JAX-WS handler) and feeding it into that same walk.
 *
 * This module is the SOAP analogue of
 * `extensionPacks/frameworkAdapters/springClassic/endpointDataEffectCandidates.ts`:
 * it turns the resolver's `ResolvedDataEffect[]` into `endpoint_data_effects`
 * DiscoveryCandidates with the IDENTICAL Spec 1 shape (`access_mode`,
 * `path_metadata_json` ordered call chain, operation hint, `transactional`,
 * and -- Data-Layer Fidelity 2, Task Group A -- the verbatim `query_text` /
 * `query_kind` of the SQL behind the edge), and turns the resolver's
 * `UnresolvedDataEffect[]` into Findings (Spec 1's existing unresolved-chain
 * behaviour, now carrying the verbatim SQL of a native/dynamic chain in the
 * Finding `detail` rather than discarding it) -- NEVER a fabricated edge.
 *
 * `endpointName` binding: a SOAP `endpoints` candidate resolves at save-back by
 * its OPERATION name. We build the exact operation-name map from the SOAP
 * signals (Spring-WS / JAX-WS) -- `${HandlerClass}#${javaMethod}` -> the
 * emitted operation name -- and hand it to the resolver so each edge's
 * `endpointName` matches the right SOAP endpoint candidate.
 *
 * DETERMINISTIC: no LLM, no gateway relay, no I/O. Pure transformation over the
 * scanned IR + the SOAP signals.
 */

import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate, CandidateType } from '../../../../types/candidate';
import type { SourceFileIR } from '../../../extensionPacks';
import type {
  RelationshipType,
  UsesDataRelationshipData,
} from '../../../../types/relationship';
import type { FindingEmitInput } from '../../FindingEmitter';
import {
  resolveSoapOperationDataEffects,
  type ResolvedDataEffect,
  type UnresolvedDataEffect,
  type PathHop,
  type QueryKind,
} from '../../../extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver';
import type { SpringWsSignal } from './springWsScanner';
import type { JaxWsSignal } from './jaxWsScanner';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface SoapDataEffectEmitInput {
  /** The scanned IR (the SOAP handler classes + their service/repo collaborators). */
  files: SourceFileIR[];
  /** Spring-WS signals (Signal A) -- carry per-op handler method + operation name. */
  springWs: SpringWsSignal[];
  /** JAX-WS signals (Signal B) -- carry per-op handler method + operation name. */
  jaxWs: JaxWsSignal[];
  /** Run id stamped onto every emitted candidate. */
  runId: string;
}

export interface SoapDataEffectEmitOutput {
  /** `endpoint_data_effects` candidates (identical Spec 1 shape). */
  candidates: DiscoveryCandidate[];
  /** Unresolved-chain Findings (Spec 1's existing behaviour; never fabricated edges). */
  findings: FindingEmitInput[];
}

/**
 * The structured, ordered hop list persisted in `path_metadata_json` -- the
 * SAME shape Spec 1's REST builder emits (see
 * `endpointDataEffectCandidates.ts#EndpointDataEffectPathMetadata`).
 */
interface EndpointDataEffectPathMetadata {
  hops: Array<{
    method_id: string;
    class_name: string;
    method_name: string;
    role: 'controller' | 'service' | 'repository';
  }>;
  operation_hint: string;
  transactional: boolean;
  /**
   * The VERBATIM SQL/JPQL text behind this edge, when one was statically
   * captured from the resolved repository method (Data-Layer Fidelity 2,
   * Task Group A). Mirrors the REST builder's additive key; present ONLY when an
   * explicit SQL/JPQL string was found. No normalization.
   */
  query_text?: string;
  /** The dialect/source of {@link query_text}; present only when `query_text` is. */
  query_kind?: QueryKind;
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const ADDED_BY = 'spring-classic-soap-data-effect';
const FINDING_SOURCE = 'framework_scanner';
const CREATED_BY_STAGE = 'pack_finding_scanner';

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Build the `${HandlerClassSimpleName}#${javaMethodName}` -> emitted SOAP
 * operation name map from the raw SOAP signals so each resolved data-effect
 * edge's `endpointName` matches its `endpoints` candidate name exactly.
 *
 * Spring-WS: the endpoint candidate name is `wsdl_operationName ?? methodName`;
 * with no WSDL it is the Java method name (and the resolver defaults to that
 * too), so this map is the override path for the WSDL-named case. We key on the
 * Java method name (the handler the resolver walks) and value the operation
 * name the emitter would display. JAX-WS mirrors this with `operationName`.
 */
function buildOperationNameMap(
  springWs: SpringWsSignal[],
  jaxWs: JaxWsSignal[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const sig of springWs) {
    for (const op of sig.operations) {
      if (!op.methodName) continue;
      // Spring-WS endpoint candidate name = ann_methodName when no WSDL op name.
      // The op localPart is the WSDL-style operation; prefer the method name for
      // the no-WSDL default (which is what `detectSoapEntryPoints` returns), but
      // record the localPart so a WSDL-named candidate still matches.
      map.set(`${sig.simpleClassName}#${op.methodName}`, op.methodName);
    }
  }
  for (const sig of jaxWs) {
    for (const op of sig.operations) {
      if (!op.methodName) continue;
      // JAX-WS endpoint candidate name = operationName (defaults to methodName).
      map.set(`${sig.simpleClassName}#${op.methodName}`, op.operationName ?? op.methodName);
    }
  }
  return map;
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
  // Additive SQL-text keys (Data-Layer Fidelity 2, Task Group A) -- emitted only
  // when an explicit query string was captured, kept byte-for-byte aligned with
  // the REST builder. Verbatim -- no normalization.
  if (edge.queryText !== undefined) {
    meta.query_text = edge.queryText;
    if (edge.queryKind !== undefined) meta.query_kind = edge.queryKind;
  }
  return meta;
}

/**
 * Build ONE `endpoint_data_effects` candidate for a resolved SOAP edge. Shape
 * is BYTE-FOR-BYTE the Spec 1 REST builder's `data` (so MCP save-back's
 * `convertEndpointDataEffectToRow` reads it identically) -- the ONLY difference
 * is `endpointName` being a SOAP operation name and `_addedBy`.
 */
function buildDataEffectCandidate(
  edge: ResolvedDataEffect,
  runId: string,
): DiscoveryCandidate {
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
    // `path_metadata_json` column. Also carries the verbatim `query_text`/
    // `query_kind` (Data-Layer Fidelity 2, Task Group A) when an explicit
    // SQL/JPQL string was captured.
    path_metadata_json: pathMetadata,
    // Context for the candidate-review UI.
    controllerClassName: edge.controllerClassName,
    endpointMethodName: edge.endpointMethodName,
    // `uses_data` is the relationship type this edge realises.
    relationshipType: 'uses_data' as RelationshipType,
    usesData,
    _addedBy: ADDED_BY,
  };

  return {
    id: uuidv4(),
    runId,
    candidateType: 'endpoint_data_effects' as CandidateType,
    name: `${edge.endpointName} → ${edge.dataEntityName} (${edge.accessMode})`,
    confidence: edge.confidence,
    status: 'proposed',
    sourceClusterIds: [edge.sourceFilePath],
    data,
    synthesizedAt: new Date().toISOString(),
  };
}

/**
 * Build an actionable Finding for a SOAP operation whose data access could NOT
 * be statically resolved to a single data entity. Mirrors the REST
 * `buildEndpointDataEffectUnresolvedFinding` shape (findingType
 * `endpoint_data_effect_unresolved`) -- NEVER a fabricated edge.
 *
 * Data-Layer Fidelity 2 (Task Group A): when the unresolved chain carried a
 * verbatim SQL string (JdbcTemplate / native / EntityManager), the resolver has
 * already appended it to `u.detail`, so it flows into this Finding's `summary`
 * and `detailJson.detail` automatically -- the actual query is captured, not
 * discarded.
 */
function buildUnresolvedFinding(u: UnresolvedDataEffect): FindingEmitInput {
  return {
    findingType: 'endpoint_data_effect_unresolved',
    category: 'migration_risk',
    severity: 'medium',
    title: `Unresolved data effect: ${u.endpointName}`,
    summary:
      `SOAP operation '${u.endpointName}' (${u.controllerClassName}#${u.endpointMethodName}) ` +
      `touches data we could not statically resolve to a data entity (${u.reason}). ${u.detail}`,
    detailJson: {
      endpoint: u.endpointName,
      controllerClass: u.controllerClassName,
      methodName: u.endpointMethodName,
      reason: u.reason,
      detail: u.detail,
      stoppedAtPath: u.partialPath.map((h) => ({
        method_id: h.methodId,
        class_name: h.className,
        method_name: h.methodName,
        role: h.role,
      })),
      migrationConcern:
        'A data read/write exists on this SOAP operation but the touched entity/table could not ' +
        'be statically determined (multiple impls / dynamic dispatch / JdbcTemplate / native SQL / ' +
        'EntityManager / reflection / too-deep). Review the chain to capture the data effect manually.',
      filePath: u.sourceFilePath,
      protocol: 'SOAP',
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    // No discovery_candidate link: by construction NO edge candidate was emitted
    // for an unresolved chain (the resolver returns it as 'unresolved').
    links: [],
  };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Emit SOAP `endpoint_data_effects` candidates + unresolved-chain Findings.
 *
 * Pure + deterministic. Detects SOAP handler entry-points, feeds them into the
 * REUSED Spec 1 resolver walk, and shapes the output identically to the REST
 * data-effect builder. Resolved edges -> candidates; unresolved chains ->
 * Findings (never fabricated edges).
 */
export function emitSoapDataEffects(
  input: SoapDataEffectEmitInput,
): SoapDataEffectEmitOutput {
  const candidates: DiscoveryCandidate[] = [];
  const findings: FindingEmitInput[] = [];

  const operationNameByMethod = buildOperationNameMap(input.springWs, input.jaxWs);
  const { resolved, unresolved } = resolveSoapOperationDataEffects(
    input.files,
    operationNameByMethod,
  );

  // Resolved edges -> `endpoint_data_effects` candidates (identical Spec 1 shape).
  // Dedupe defensively on (endpoint, entity) -- the resolver already collapses
  // per entity, but a malformed IR could double up.
  const seen = new Set<string>();
  for (const edge of resolved) {
    const key = `${edge.endpointName}=>${edge.dataEntityName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(buildDataEffectCandidate(edge, input.runId));
  }

  // Unresolved chains -> Findings (never fabricated edges).
  for (const u of unresolved) {
    findings.push(buildUnresolvedFinding(u));
  }

  if (candidates.length > 0 || findings.length > 0) {
    console.log(
      `[diag-pack] scanner=spring_classic_soap soap_data_effect ` +
        `edges=${candidates.length} unresolved=${findings.length}`,
    );
  }

  return { candidates, findings };
}
