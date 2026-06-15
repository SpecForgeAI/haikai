/**
 * Outbound Integration candidate + finding builder (Spring Classic).
 *
 * Spec: 2026-05-30 Outbound Integration Graph for Discovery
 * (Java / Spring Classic + Spring Boot), Task Group 3.
 *
 * Turns the resolved {@link ResolvedOutboundEdge}s from
 * {@link resolveOutboundIntegrations} into:
 *   - `data_movements` DiscoveryCandidates (ONE per resolved outbound edge),
 *     surfaced in the NORMAL candidate-review stream, AND
 *   - `external_integration_dependency` Findings (ONE per PURELY-EXTERNAL
 *     resolved edge), surfaced in the Findings tab.
 *
 * The two are produced by SEPARATE entry points over the SAME resolver output,
 * exactly mirroring `endpointDataEffectCandidates` / `springClassicFindingScanner`'s
 * "run the resolver, emit candidates here, emit findings there" split (the
 * established "run it twice, cheap, keeps candidate vs finding emission separate"
 * pattern). The adapter calls {@link buildOutboundIntegrationCandidates}; the
 * finding scanner calls {@link buildOutboundIntegrationFindings}.
 *
 * The candidate's `data` is shaped to align EXACTLY with what the MCP Group-5
 * save-back producer reads BY NAME (so it can resolve the `application_point`s
 * LATE):
 *   - `sourceServiceName` -> the OWNING service/interface class NAME; save-back
 *                            resolves it to `source_application_point_id`
 *                            (`ap_{serviceId}`) via the normalized-name primitive.
 *   - `targetName` / `target` -> the verbatim resolved target; save-back resolves
 *                            it to `target_application_point_id` WHEN it maps to an
 *                            in-model service/interface, else leaves it NULL.
 *   - `targetLooksExternal` -> a shape hint: when true, the producer leaves the
 *                            target side NULL (the external-only edge) -- the
 *                            architecture records the outbound dependency WITHOUT
 *                            minting a fake counterpart.
 *   - `movementType` -> the `integration_kind`; maps to the AMS row's
 *                            `movement_type`.
 *   - `sourceEndpointName` / `sourceKind` / `payloadHint` / `httpVerb` /
 *     `messagingOperation` / `confidence` / `callSiteFqn` / `callSiteLine` ->
 *     traceability context.
 *
 * NEVER emits or creates `application_points` / `data_entity_points` (or any
 * `*_points` wrapper) -- they are auto-managed by AMS; save-back resolves the
 * point references LATE. NEVER mints a speculative external service/interface
 * entity (external targets -> the external-dependency Finding). NEVER synthesizes
 * a 1:1 mapping.
 */

import { v4 as uuidv4 } from 'uuid';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR } from '../../languageIR';
import type { FindingEmitInput } from '../../../findings/FindingEmitter';
import { buildExternalIntegrationDependencyFinding } from '../../../findings/emissionSources';
import {
  resolveOutboundIntegrations,
  type ResolvedOutboundEdge,
} from './outboundIntegrationResolver';

/** A short human-readable display name for the integration kind. */
function kindLabel(kind: string): string {
  switch (kind) {
    case 'outbound-rest':
      return 'HTTP';
    case 'messaging-producer':
      return 'publishes';
    case 'cache-store':
      return 'cache';
    case 'secondary-store':
      return 'store';
    case 'file-store':
      return 'file';
    case 'object-store':
      return 'object';
    case 'email':
      return 'email';
    case 'sms':
      return 'sms';
    case 'third-party-sdk':
      return 'sdk';
    default:
      return kind;
  }
}

/**
 * Build `data_movements` candidates for every resolved outbound edge across the
 * scanned IR. ONE candidate per (source owner, resolved target) pair (the
 * resolver already deduped).
 *
 * The SOURCE is the owning service/interface NAME (resolved to its
 * `application_point` LATE at save-back). The TARGET NAME is carried verbatim;
 * save-back resolves it to an in-model `application_point` when it matches a
 * discovered service/interface, else leaves it NULL (external-only edge). The
 * candidate NEVER carries a point id and NEVER references a `*_points` wrapper.
 */
export function buildOutboundIntegrationCandidates(
  files: SourceFileIR[],
  runId: string,
): DiscoveryCandidate[] {
  const { resolved } = resolveOutboundIntegrations(files);
  const candidates: DiscoveryCandidate[] = [];

  // Defensive dedup on (source service, kind, target) -- the resolver already
  // collapses per (source owner, target) pair, but a malformed IR could double up.
  const seen = new Set<string>();

  for (const edge of resolved) {
    const key = `${edge.ownerClassName}=>${edge.integrationKind}=>${edge.target}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const data: Record<string, unknown> = {
      // --- save-back resolution keys (read BY NAME by the MCP Group-5 producer) ---
      // The OWNING service/interface NAME -> resolves the source application_point
      // (`ap_{serviceId}`) LATE at save-back. NEVER a point id here.
      sourceServiceName: edge.ownerClassName,
      // The verbatim resolved target NAME -> resolves the target application_point
      // when in-model; else the producer leaves target_application_point_id NULL.
      targetName: edge.target,
      target: edge.target,
      // `movement_type` on the AMS row carries the integration kind.
      movementType: edge.integrationKind,
      // Shape hint so the producer leaves the target side NULL for a purely
      // external target (the external-only edge) -- never an invented counterpart.
      targetLooksExternal: edge.targetLooksExternal,
      // --- traceability context for the candidate-review UI ---
      sourceKind: edge.sourceKind,
      // The calling endpoint identity when reached from a controller mapping
      // (context only -- the SOURCE application_point still resolves off
      // `sourceServiceName`).
      sourceEndpointName: edge.sourceKind === 'endpoint' ? edge.sourceName : undefined,
      httpVerb: edge.httpVerb,
      messagingOperation: edge.messagingOperation,
      payloadHint: edge.payloadHint,
      confidence: edge.confidence,
      ownerClassName: edge.ownerClassName,
      ownerMethodName: edge.ownerMethodName,
      callSiteFqn: edge.callSiteFqn,
      callSiteLine: edge.callSiteLine,
      _addedBy: 'spring-classic-adapter',
    };

    const sourceDisplay =
      edge.sourceKind === 'endpoint' ? edge.sourceName : edge.ownerClassName;

    const candidate: DiscoveryCandidate = {
      id: uuidv4(),
      runId,
      candidateType: 'data_movements',
      // Human-readable name mirrors the relationship candidates' `Source → Target`
      // arrow convention.
      name: `${sourceDisplay} → ${edge.target} (${kindLabel(edge.integrationKind)})`,
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
      `[spring-classic] data_movements: emitted ${candidates.length} outbound-edge candidate(s).`,
    );
  }
  return candidates;
}

/**
 * Build `external_integration_dependency` Findings for every PURELY-EXTERNAL
 * resolved outbound edge across the scanned IR (the `targetLooksExternal` ones).
 * A modellable target does NOT produce a Finding (the Finding is external-only --
 * the `data_movements` candidate is its model surface).
 *
 * Mirrors `springClassicFindingScanner`'s `scanEndpointDataEffects` shape: run
 * the SAME resolver over the SAME IR, emit a Finding per external edge. The
 * caller (the finding scanner) passes the result to `findingEmitter`.
 */
export function buildOutboundIntegrationFindings(
  files: SourceFileIR[],
): FindingEmitInput[] {
  const { resolved } = resolveOutboundIntegrations(files);
  const out: FindingEmitInput[] = [];
  for (const edge of resolved) {
    if (!edge.targetLooksExternal) continue;
    out.push(
      buildExternalIntegrationDependencyFinding({
        integrationKind: edge.integrationKind,
        target: edge.target,
        payloadHint: edge.payloadHint,
        sourceKind: edge.sourceKind,
        sourceName: edge.sourceName,
        callSiteFqn: edge.callSiteFqn,
        callSiteLine: edge.callSiteLine,
        sourceFilePath: edge.sourceFilePath,
      }),
    );
  }
  return out;
}

// Re-export the edge shape so consumers can introspect (unused import guard).
export type { ResolvedOutboundEdge };
