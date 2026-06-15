/**
 * Evidence Gap Scanner (Source H, Spec 2026-05-16 Discovery Findings, TG5).
 *
 * Pure post-merge pass that inspects the deduped candidate set and produces
 * one `FindingEmitInput` per detected gap. Gap classes detected in v1:
 *   - `endpoint_missing_response_schema`: endpoints candidate has no
 *     `responseSchema` (in `data.responseSchema`, `data.responses`, or
 *     `data.responseDtos`).
 *   - `interface_missing_contract_detail`: interfaces candidate has no
 *     contract detail in `data.contract`, `data.contractDetail`,
 *     `data.openApi`, `data.swagger`, or `data.protocol`.
 *   - `service_missing_owner`: service candidate has neither
 *     `data.owner`, `data.ownerTeam`, nor a `parentCandidateId` (no
 *     application/component parent).
 *   - `data_entity_missing_attributes`: physical/logical data entity
 *     candidate has no children of the matching `_attributes` type AND
 *     no attribute list in `data.attributes` / `data.columns` / `data.fields`.
 *
 * The scanner is intentionally generous about the "where could the
 * evidence live" question -- v3 candidates are produced by multiple
 * adapter / LLM paths and the convention for naming the response-schema /
 * contract / owner / attribute payload is not consistent across packs.
 * False negatives are preferred over false positives so the Findings tab
 * does not become noisy.
 *
 * Returns shaped inputs only. The caller passes them to
 * `findingEmitter.emitFindings`. The scanner is a SINGLE PASS over the
 * candidate set; it is O(n) in candidate count and does no I/O.
 */

import type { DiscoveryCandidate } from '../../types/candidate';
import type { FindingEmitInput } from './FindingEmitter';
import { buildEvidenceGapFinding } from './emissionSources';

/**
 * Inspect a candidate's `data` object for "the response schema is present"
 * signals. Returns true when SOMETHING resembling response schema info is
 * attached; false when the field is missing or empty.
 */
function hasResponseSchema(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const candidateKeys = [
    'responseSchema',
    'responseDtos',
    'responseBody',
    'responses',
    'response',
  ];
  for (const k of candidateKeys) {
    const v = data[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim().length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && v !== null && Object.keys(v).length === 0) continue;
    return true;
  }
  return false;
}

/**
 * Inspect a candidate's `data` for contract / protocol detail signals.
 */
function hasContractDetail(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const contractKeys = [
    'contract',
    'contractDetail',
    'openApi',
    'openapi',
    'swagger',
    'protocol',
    'mediaTypes',
    'consumes',
    'produces',
  ];
  for (const k of contractKeys) {
    const v = data[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim().length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && v !== null && Object.keys(v).length === 0) continue;
    return true;
  }
  return false;
}

/**
 * Inspect a candidate's `data` for owner / team signals.
 */
function hasOwnerSignal(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const ownerKeys = ['owner', 'ownerTeam', 'team', 'maintainer', 'maintainers'];
  for (const k of ownerKeys) {
    const v = data[k];
    if (v === null || v === undefined) continue;
    if (typeof v === 'string' && v.trim().length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    return true;
  }
  return false;
}

/**
 * Inspect a candidate's `data` for inline attribute lists.
 */
function hasInlineAttributes(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const attrKeys = ['attributes', 'columns', 'fields', 'properties'];
  for (const k of attrKeys) {
    const v = data[k];
    if (v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (Array.isArray(v) && v.length > 0) return true;
    if (typeof v === 'object' && v !== null && Object.keys(v).length > 0) return true;
  }
  return false;
}

/**
 * Scan the merged candidate set and return one FindingEmitInput per
 * detected evidence gap. The scanner is a single O(n) pass; the dedupe
 * cache in `FindingEmitter` collapses repeated emissions across runs of
 * this scanner (the cache is per-run anyway, but the same candidate set
 * fed twice should never produce duplicate findings).
 *
 * @param candidates  the merged candidate set after Stage 4 of the V3 pipeline
 * @returns           zero or more `FindingEmitInput`s for the emitter
 */
export function scanForEvidenceGaps(
  candidates: DiscoveryCandidate[],
): FindingEmitInput[] {
  const inputs: FindingEmitInput[] = [];

  // Pre-compute: which entity candidates have children of the matching
  // *_attributes type? `parentCandidateId` is the canonical link from a
  // *_attributes candidate up to its entity.
  const entityCandidateIdsWithAttributeChildren = new Set<string>();
  for (const c of candidates) {
    if (
      (c.candidateType === 'physical_data_attributes' ||
        c.candidateType === 'logical_data_attributes') &&
      typeof c.parentCandidateId === 'string' &&
      c.parentCandidateId.length > 0
    ) {
      entityCandidateIdsWithAttributeChildren.add(c.parentCandidateId);
    }
  }

  for (const cand of candidates) {
    const data = cand.data as Record<string, unknown> | undefined;

    // Endpoint without response schema.
    if (cand.candidateType === 'endpoints' && !hasResponseSchema(data)) {
      inputs.push(
        buildEvidenceGapFinding({
          candidateId: cand.id,
          candidateName: cand.name,
          gapType: 'endpoint_missing_response_schema',
          gapDescription:
            `Endpoint '${cand.name}' has no response schema attached. ` +
            `Downstream consumers (contract tests, migration baselines) cannot infer the response shape.`,
        }),
      );
      continue; // one finding per candidate is enough; avoid double-flagging
    }

    // Interface without contract detail.
    if (cand.candidateType === 'interfaces' && !hasContractDetail(data)) {
      inputs.push(
        buildEvidenceGapFinding({
          candidateId: cand.id,
          candidateName: cand.name,
          gapType: 'interface_missing_contract_detail',
          gapDescription:
            `Interface '${cand.name}' has no protocol / media-type / OpenAPI detail. ` +
            `Contract evolution and pact tests will be limited.`,
        }),
      );
      continue;
    }

    // Service without owner / parent.
    if (
      cand.candidateType === 'service' &&
      !hasOwnerSignal(data) &&
      (cand.parentCandidateId === undefined || cand.parentCandidateId === null)
    ) {
      inputs.push(
        buildEvidenceGapFinding({
          candidateId: cand.id,
          candidateName: cand.name,
          gapType: 'service_missing_owner',
          gapDescription:
            `Service '${cand.name}' has neither an explicit owner/team nor an application/component parent. ` +
            `Operational accountability cannot be derived from discovery.`,
        }),
      );
      continue;
    }

    // Data entity without attributes (either inline or as child candidates).
    if (
      (cand.candidateType === 'physical_data_entities' ||
        cand.candidateType === 'logical_data_entities') &&
      !hasInlineAttributes(data) &&
      !entityCandidateIdsWithAttributeChildren.has(cand.id)
    ) {
      inputs.push(
        buildEvidenceGapFinding({
          candidateId: cand.id,
          candidateName: cand.name,
          gapType: 'data_entity_missing_attributes',
          gapDescription:
            `Data entity '${cand.name}' has no attribute list. ` +
            `Schema-level analysis (column-level diff, migration mapping) will be limited.`,
        }),
      );
      continue;
    }
  }

  return inputs;
}
