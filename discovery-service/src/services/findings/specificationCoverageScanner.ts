/**
 * Dimension-B specification-coverage scanner (Spec 5 -- Capture Coverage Gates,
 * Task Group 2).
 *
 * Spec: agent-os/specs/2026-05-30-capture-coverage-gates/spec.md
 *
 * ===========================================================================
 * Purpose
 * ===========================================================================
 *
 * Pure post-merge pass that inspects the deduped candidate set and produces
 * ONE `FindingEmitInput` per UNDER-SPECIFIED discovered endpoint, plus a
 * counted per-endpoint completeness rollup. This is the DISCOVERY-SIDE mirror
 * of AMS Group 1's dimension-B `computeSpecificationCoverage`
 * (`MigrationDiscoveryContextService`), using the SAME per-protocol
 * "fully specified" bar so the two sides agree:
 *
 *   - A REST endpoint is "fully specified" iff it has a resolved
 *     `endpoint_data_effects` edge (Spec 1). AMS reads
 *     `EndpointDataEffectRepository.findByEndpointId(ep.getId())` and requires
 *     it non-empty; on the discovery side the persisted endpoint id does not
 *     exist yet (it is resolved LATE at save-back), so we mirror the AMS check
 *     by matching `endpoint_data_effects` candidates to their `endpoints`
 *     candidate BY NAME -- exactly the `data.endpointName` resolution key the
 *     save-back layer uses (`convertEndpointDataEffectToRow`). The ABSENCE of
 *     any such edge candidate is the gap (`endpoint_missing_data_effect`).
 *
 *   - A SOAP operation is "fully specified" iff its parent interface has bound
 *     request/response message entities (Spec 4 `interface_logical_entities` +
 *     message `logical_data_entities`). AMS reads
 *     `InterfaceLogicalEntityRepository.findByInterfaceId(ep.getInterfaceId())`
 *     and requires it non-empty; on the discovery side we mirror this by
 *     checking whether the endpoint's parent SOAP interface candidate has an
 *     `interface_logical_entities` candidate bound to it -- matched BY NAME via
 *     `data.interfaceClassName` (the exact save-back resolution key in
 *     `messageEntityEmitter.buildInterfaceLink`). As a belt-and-braces signal
 *     we also accept the endpoint's own `data.requestEntity` /
 *     `data.responseEntity` (set in place by `messageEntityEmitter` when a
 *     message type resolves). The ABSENCE of a binding is the gap
 *     (`soap_operation_missing_message_binding`).
 *
 * `business_logics.behavior` (Spec 2) is a BONUS signal ONLY and is NEVER
 * consulted here -- requiring it would unfairly fail endpoints whose behaviour
 * was not confidently captured. This matches the AMS side exactly.
 *
 * SOAP-vs-REST detection mirrors AMS `isSoapEndpoint` (which reads the
 * persisted `EndpointEntity.protocol` / `endpoint_type`). On the discovery
 * side the endpoint id / protocol column do not exist yet, so we detect SOAP
 * from the SAME candidate signals that PRODUCE `protocol='SOAP'` at save-back:
 * a parent interface candidate carrying `data.interface_type === 'SOAP_API'`
 * (the canonical SOAP signal -- see `interfaceTypeSoapApiAudit.test.ts`), or
 * the endpoint candidate's own SOAP markers (`soap_action` /
 * `request_root_element` / `_addedBy === 'spring-classic-soap'`).
 *
 * The scanner is a SINGLE PASS over the candidate set (O(n) after building two
 * lookup indexes); it does NO I/O and uses NO LLM. Returns shaped inputs only.
 * The caller passes them to `findingEmitter.emitFindings`; the per-endpoint
 * "fully specified?" rollup then surfaces through the existing
 * `FindingEmitter.getRunAggregate` -- there is NO new aggregate shape.
 */

import type { DiscoveryCandidate } from '../../types/candidate';
import type { FindingEmitInput } from './FindingEmitter';
import { buildUnderSpecifiedEndpointFinding } from './emissionSources';

/**
 * Per-endpoint completeness rollup for dimension B. Returned alongside the
 * Findings so the caller can log the counts; the Findings themselves drive the
 * run-aggregate rollup via the emitter (no new aggregate shape is introduced).
 */
export interface SpecificationCoverageResult {
  /** Findings -- one per under-specified endpoint. */
  inputs: FindingEmitInput[];
  /** Total discovered `endpoints` candidates inspected (REST + SOAP). */
  totalEndpoints: number;
  /** Endpoints meeting the per-protocol "fully specified" bar. */
  fullySpecifiedCount: number;
  /** Endpoints that fell short (== `inputs.length`). */
  underSpecifiedCount: number;
}

/** Trim + lowercase a name so by-name matching is robust to incidental casing. */
function normName(s: unknown): string {
  if (typeof s !== 'string') return '';
  return s.trim().toLowerCase();
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Detect whether an `endpoints` candidate is SOAP, mirroring AMS
 * `isSoapEndpoint`. Reads the SAME candidate signals that produce
 * `protocol='SOAP'` at save-back: a parent interface candidate with
 * `interface_type === 'SOAP_API'`, or the endpoint candidate's own SOAP
 * markers.
 */
function isSoapEndpointCandidate(
  endpoint: DiscoveryCandidate,
  interfaceById: Map<string, DiscoveryCandidate>,
): boolean {
  const data = (endpoint.data ?? {}) as Record<string, unknown>;
  // Endpoint-local SOAP markers (set by soapEndpointEmitter.buildEndpointData).
  if (isNonEmptyString(data.soap_action)) return true;
  if (isNonEmptyString(data.request_root_element)) return true;
  if (normName(data._addedBy).includes('soap')) return true;
  // Parent interface carries the canonical SOAP signal.
  const parentId = endpoint.parentCandidateId;
  if (parentId) {
    const iface = interfaceById.get(parentId);
    const ifaceData = (iface?.data ?? {}) as Record<string, unknown>;
    if (normName(ifaceData.interface_type) === 'soap_api') return true;
  }
  return false;
}

/**
 * Scan the merged candidate set for dimension-B specification coverage.
 *
 * @param candidates the merged candidate set after Stage 4 of the V3 pipeline
 * @returns          per-endpoint Findings + the counted completeness rollup
 */
export function scanForSpecificationCoverage(
  candidates: DiscoveryCandidate[],
): SpecificationCoverageResult {
  // --- Index pass: build the lookups the per-protocol bars consult. ---

  // Interface candidates by id (to resolve a SOAP endpoint's parent + name).
  const interfaceById = new Map<string, DiscoveryCandidate>();

  // REST bar: set of normalized endpoint NAMES that have a resolved
  // `endpoint_data_effects` edge candidate (matched BY NAME, the save-back key).
  const endpointNamesWithDataEffect = new Set<string>();

  // SOAP bar: set of normalized interface NAMES that have at least one
  // `interface_logical_entities` binding candidate (matched BY NAME via
  // `interfaceClassName`, the save-back key).
  const interfaceNamesWithMessageBinding = new Set<string>();

  for (const c of candidates) {
    const data = (c.data ?? {}) as Record<string, unknown>;
    if (c.candidateType === 'interfaces') {
      interfaceById.set(c.id, c);
    } else if (c.candidateType === 'endpoint_data_effects') {
      // The data-effect candidate references its endpoint BY NAME.
      const epName = normName(data.endpointName);
      if (epName) endpointNamesWithDataEffect.add(epName);
    } else if (c.candidateType === 'interface_logical_entities') {
      // The interface-logical-entity binding references its interface BY NAME.
      const ifaceName = normName(data.interfaceClassName);
      if (ifaceName) interfaceNamesWithMessageBinding.add(ifaceName);
    }
  }

  // --- Scan pass: one inspection per endpoint candidate. ---
  const inputs: FindingEmitInput[] = [];
  let totalEndpoints = 0;
  let fullySpecifiedCount = 0;

  for (const cand of candidates) {
    if (cand.candidateType !== 'endpoints') continue;
    totalEndpoints += 1;

    const data = (cand.data ?? {}) as Record<string, unknown>;
    const soap = isSoapEndpointCandidate(cand, interfaceById);

    let specified: boolean;
    if (soap) {
      // SOAP: parent interface has bound request/response message entities.
      const parentId = cand.parentCandidateId;
      const iface = parentId ? interfaceById.get(parentId) : undefined;
      const ifaceName = normName(iface?.name);
      const interfaceHasBinding =
        ifaceName.length > 0 && interfaceNamesWithMessageBinding.has(ifaceName);
      // Belt-and-braces: the endpoint itself may carry a bound message entity
      // (set in place by messageEntityEmitter) even if the interface-link
      // candidate name-match is incidental.
      const endpointHasBoundMessage =
        isNonEmptyString(data.requestEntity) || isNonEmptyString(data.responseEntity);
      specified = interfaceHasBinding || endpointHasBoundMessage;
      if (!specified) {
        inputs.push(
          buildUnderSpecifiedEndpointFinding({
            candidateId: cand.id,
            candidateName: cand.name,
            gapType: 'soap_operation_missing_message_binding',
          }),
        );
      }
    } else {
      // REST: endpoint has a resolved `endpoint_data_effects` edge.
      specified = endpointNamesWithDataEffect.has(normName(cand.name));
      if (!specified) {
        inputs.push(
          buildUnderSpecifiedEndpointFinding({
            candidateId: cand.id,
            candidateName: cand.name,
            gapType: 'endpoint_missing_data_effect',
          }),
        );
      }
    }

    if (specified) fullySpecifiedCount += 1;
  }

  return {
    inputs,
    totalEndpoints,
    fullySpecifiedCount,
    underSpecifiedCount: inputs.length,
  };
}
