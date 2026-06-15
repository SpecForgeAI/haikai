/**
 * Tests for the new `llm_endpoint_extract_malformed` evidence-gap sentinel
 * (Spec 2026-05-17 SOAP LLM Extraction and Payload Enrichment Phase 2,
 * Task Group 4 / W-9).
 *
 * Coverage (per tasks.md 4.1):
 *  1. The centralised `EvidenceGapType` union now includes
 *     `'llm_endpoint_extract_malformed'` alongside Phase 1's
 *     `'soap_endpoint_url_unknown'` and `'wsdl_parse_failed'` (and the
 *     four original post-merge scanner sentinels). Compile-time assertion
 *     via union-typed local; runtime equality check on the literal.
 *  2. Emitting an `evidence_gap` finding with
 *     `gapType='llm_endpoint_extract_malformed'` through the new
 *     `buildLlmEndpointExtractMalformedFinding` builder produces a
 *     well-formed `FindingEmitInput` that the existing `FindingEmitter`
 *     surface would accept (we assert the shape, not the network call --
 *     the emitter's `emitFinding` accepts any `FindingEmitInput` shape so
 *     the assertion is on the constructed envelope).
 *
 * NOTE: discovery-service itself never emits this sentinel; the actual
 * emission site lives in AMVS's `propose_endpoints_from_code` tool (Task
 * Group 5). The union member and the builder live here because
 * discovery-service is the single source of truth for the
 * `EvidenceGapType` vocabulary across services.
 */

import {
  buildLlmEndpointExtractMalformedFinding,
  type EvidenceGapType,
} from '../services/findings/emissionSources';

describe('llm_endpoint_extract_malformed evidence-gap sentinel', () => {
  // =========================================================================
  // Test 1: sentinel is a member of the centralised EvidenceGapType union
  // =========================================================================
  it('Test 1: `llm_endpoint_extract_malformed` is a member of the centralised EvidenceGapType union alongside the Phase 1 SOAP sentinels', () => {
    // Compile-time check: assigning the literal to a union-typed local
    // fails to typecheck if the union member is removed. The runtime
    // equality check below makes the assertion meaningful at runtime too.
    const llmMalformed: EvidenceGapType = 'llm_endpoint_extract_malformed';
    expect(llmMalformed).toBe('llm_endpoint_extract_malformed');

    // Phase 1 SOAP sentinels still members of the union (we expanded the
    // type, never replaced it).
    const urlUnknown: EvidenceGapType = 'soap_endpoint_url_unknown';
    const wsdlFailed: EvidenceGapType = 'wsdl_parse_failed';
    expect(urlUnknown).toBe('soap_endpoint_url_unknown');
    expect(wsdlFailed).toBe('wsdl_parse_failed');

    // Original four post-merge scanner sentinels still members of the union.
    const original1: EvidenceGapType = 'endpoint_missing_response_schema';
    const original2: EvidenceGapType = 'interface_missing_contract_detail';
    const original3: EvidenceGapType = 'service_missing_owner';
    const original4: EvidenceGapType = 'data_entity_missing_attributes';
    expect([original1, original2, original3, original4]).toEqual([
      'endpoint_missing_response_schema',
      'interface_missing_contract_detail',
      'service_missing_owner',
      'data_entity_missing_attributes',
    ]);
  });

  // =========================================================================
  // Test 2: builder produces a well-formed FindingEmitInput envelope
  // =========================================================================
  it('Test 2: `buildLlmEndpointExtractMalformedFinding` produces a well-formed evidence_gap envelope with the correct gapType, reason, and parent-interface link', () => {
    const finding = buildLlmEndpointExtractMalformedFinding({
      interfaceShortId: 'IF-soap-customer-svc',
      reason: 'LLM returned invalid JSON twice; schema_violation on retry',
    });

    // Top-level envelope shape audit.
    expect(finding.findingType).toBe('evidence_gap');
    expect(finding.category).toBe('evidence_gap');
    expect(finding.severity).toBe('medium');
    expect(finding.source).toBe('pipeline_evidence_gap');
    expect(finding.createdByStage).toBe('amvs.llmEndpointExtract');

    // detailJson carries the sentinel + the reason + the interface short-id.
    const detail = finding.detailJson as Record<string, unknown>;
    expect(detail.gapType).toBe('llm_endpoint_extract_malformed');
    expect(detail.reason).toBe(
      'LLM returned invalid JSON twice; schema_violation on retry',
    );
    expect(detail.interfaceShortId).toBe('IF-soap-customer-svc');

    // Title carries the interface short-id + the gapType for the
    // Findings-tab display.
    expect(finding.title).toContain('IF-soap-customer-svc');
    expect(finding.title).toContain('llm_endpoint_extract_malformed');

    // Summary echoes the reason verbatim (one-line human-readable).
    expect(finding.summary).toBe(
      'LLM returned invalid JSON twice; schema_violation on retry',
    );

    // Single link: `supports` -> the parent SOAP interface candidate's
    // short-id (groups the malformed-output report alongside the
    // interface it was scoped to).
    expect(finding.links).toHaveLength(1);
    expect(finding.links?.[0].linkType).toBe('supports');
    expect(finding.links?.[0].targetType).toBe('discovery_candidate');
    expect(finding.links?.[0].targetId).toBe('IF-soap-customer-svc');
  });
});
