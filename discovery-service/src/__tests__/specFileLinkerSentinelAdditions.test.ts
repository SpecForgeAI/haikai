/**
 * Tests for the two new `evidence_gap` sentinels introduced by Spec
 * 2026-05-17 Spec File Auto-Linking Phase 3, Task Group 1 (P-4 / P-5 / P-14):
 *   - `oas_spec_ambiguous_match`
 *   - `oas_spec_orphan`
 *
 * Coverage (per tasks.md 1.1):
 *  1. The centralised `EvidenceGapType` union now includes both new
 *     literals alongside Phase 1's `'soap_endpoint_url_unknown'` /
 *     `'wsdl_parse_failed'` and Phase 2's
 *     `'llm_endpoint_extract_malformed'`. Compile-time assertion via
 *     union-typed locals; runtime equality checks on the literals.
 *  2. `buildOasSpecAmbiguousGap` produces a well-formed
 *     `FindingEmitInput` with `gapType='oas_spec_ambiguous_match'`,
 *     the candidate-id array intact in `detailJson` AND mirrored as
 *     `supports` links, and the spec file path recorded.
 *  3. `buildOasSpecOrphanGap` produces the same envelope shape with
 *     `gapType='oas_spec_orphan'`, the file path recorded, and NO
 *     `supports` links (by definition no candidate to link to).
 *
 * NOTE: this test does not exercise the scanner pipeline -- it only
 * asserts the builder shapes and union membership. The scanner
 * pipeline tests live in `specFileLinker.test.ts` (Task Group 3).
 */

import {
  buildOasSpecAmbiguousGap,
  buildOasSpecOrphanGap,
  type EvidenceGapType,
} from '../services/findings/emissionSources';

describe('OAS spec-file evidence-gap sentinels (Phase 3 / Group 1)', () => {
  // =========================================================================
  // Test 1: both new sentinels are members of the centralised
  //         EvidenceGapType union alongside the prior sentinels.
  // =========================================================================
  it('Test 1: `oas_spec_ambiguous_match` and `oas_spec_orphan` are members of EvidenceGapType alongside Phase 1 / Phase 2 sentinels', () => {
    // Compile-time check: assigning the literals to union-typed locals
    // fails to typecheck if the union members are removed.
    const ambiguous: EvidenceGapType = 'oas_spec_ambiguous_match';
    const orphan: EvidenceGapType = 'oas_spec_orphan';
    expect(ambiguous).toBe('oas_spec_ambiguous_match');
    expect(orphan).toBe('oas_spec_orphan');

    // Phase 1 SOAP sentinels still members of the union (we expanded
    // the type, never replaced it).
    const urlUnknown: EvidenceGapType = 'soap_endpoint_url_unknown';
    const wsdlFailed: EvidenceGapType = 'wsdl_parse_failed';
    expect(urlUnknown).toBe('soap_endpoint_url_unknown');
    expect(wsdlFailed).toBe('wsdl_parse_failed');

    // Phase 2 LLM-extract sentinel still a member of the union.
    const llmMalformed: EvidenceGapType = 'llm_endpoint_extract_malformed';
    expect(llmMalformed).toBe('llm_endpoint_extract_malformed');

    // Original four post-merge scanner sentinels still members.
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
  // Test 2: buildOasSpecAmbiguousGap produces a well-formed envelope.
  // =========================================================================
  it('Test 2: `buildOasSpecAmbiguousGap` produces a well-formed evidence_gap envelope with the correct gapType, candidate-id array, spec file path, and supports links to every involved candidate', () => {
    const finding = buildOasSpecAmbiguousGap({
      specFilePath: 'src/main/resources/openapi.yaml',
      candidateInterfaceIds: ['IF-pet-svc', 'IF-store-svc'],
      reason: "two interfaces matched on `paths` base-prefix `/petstore`",
    });

    // Top-level envelope shape audit.
    expect(finding.findingType).toBe('evidence_gap');
    expect(finding.category).toBe('evidence_gap');
    expect(finding.severity).toBe('medium');
    expect(finding.source).toBe('pipeline_evidence_gap');
    expect(finding.createdByStage).toBe('discovery.specFileLinker');

    // detailJson carries the sentinel + the spec file path + the
    // candidate-id array intact + the optional reason.
    const detail = finding.detailJson as Record<string, unknown>;
    expect(detail.gapType).toBe('oas_spec_ambiguous_match');
    expect(detail.specFilePath).toBe('src/main/resources/openapi.yaml');
    expect(detail.candidateInterfaceIds).toEqual(['IF-pet-svc', 'IF-store-svc']);
    expect(detail.reason).toBe(
      "two interfaces matched on `paths` base-prefix `/petstore`",
    );

    // Title carries the spec file path + the gapType for Findings-tab
    // display.
    expect(finding.title).toContain('src/main/resources/openapi.yaml');
    expect(finding.title).toContain('oas_spec_ambiguous_match');

    // Summary echoes the reason verbatim when supplied.
    expect(finding.summary).toBe(
      "two interfaces matched on `paths` base-prefix `/petstore`",
    );

    // Links: one `supports` link per involved candidate id, in input
    // order, so the Findings tab can group the conflict report
    // alongside every candidate it affected.
    expect(finding.links).toHaveLength(2);
    expect(finding.links?.[0].linkType).toBe('supports');
    expect(finding.links?.[0].targetType).toBe('discovery_candidate');
    expect(finding.links?.[0].targetId).toBe('IF-pet-svc');
    expect(finding.links?.[1].linkType).toBe('supports');
    expect(finding.links?.[1].targetType).toBe('discovery_candidate');
    expect(finding.links?.[1].targetId).toBe('IF-store-svc');
  });

  // =========================================================================
  // Test 3: buildOasSpecOrphanGap produces the same envelope shape
  //         with gapType='oas_spec_orphan' and no supports links.
  // =========================================================================
  it('Test 3: `buildOasSpecOrphanGap` produces a well-formed evidence_gap envelope with gapType=`oas_spec_orphan`, the file path recorded, and no supports links', () => {
    const finding = buildOasSpecOrphanGap({
      specFilePath: 'src/main/resources/orphan-openapi.yaml',
      reason:
        "no interface candidate's name / basePath / openApiTag matched the spec's info.title / paths / tags[].name",
    });

    // Top-level envelope shape audit.
    expect(finding.findingType).toBe('evidence_gap');
    expect(finding.category).toBe('evidence_gap');
    expect(finding.severity).toBe('medium');
    expect(finding.source).toBe('pipeline_evidence_gap');
    expect(finding.createdByStage).toBe('discovery.specFileLinker');

    // detailJson carries the sentinel + the spec file path + the
    // optional reason. NO candidate-id array (by definition there is
    // no candidate to link to for an orphan spec).
    const detail = finding.detailJson as Record<string, unknown>;
    expect(detail.gapType).toBe('oas_spec_orphan');
    expect(detail.specFilePath).toBe(
      'src/main/resources/orphan-openapi.yaml',
    );
    expect(detail.reason).toBe(
      "no interface candidate's name / basePath / openApiTag matched the spec's info.title / paths / tags[].name",
    );
    expect(detail).not.toHaveProperty('candidateInterfaceIds');

    // Title carries the spec file path + the gapType.
    expect(finding.title).toContain(
      'src/main/resources/orphan-openapi.yaml',
    );
    expect(finding.title).toContain('oas_spec_orphan');

    // Summary echoes the reason verbatim when supplied.
    expect(finding.summary).toBe(
      "no interface candidate's name / basePath / openApiTag matched the spec's info.title / paths / tags[].name",
    );

    // Links: empty array -- orphan specs have no candidate to link to.
    expect(finding.links).toEqual([]);
  });

  // =========================================================================
  // Test 3b: buildOasSpecOrphanGap works without the optional `reason`.
  //          Falls back to a synthesised summary; no `reason` field in
  //          detailJson. Guards against a regression where the optional
  //          parameter handling drifts.
  // =========================================================================
  it("Test 3b: `buildOasSpecOrphanGap` synthesises a summary when no `reason` is supplied and omits `reason` from detailJson", () => {
    const finding = buildOasSpecOrphanGap({
      specFilePath: 'src/main/resources/orphan-openapi.yaml',
    });

    expect(finding.summary).toContain(
      'src/main/resources/orphan-openapi.yaml',
    );
    expect(finding.summary).toContain('no in-scope interface candidate');

    const detail = finding.detailJson as Record<string, unknown>;
    expect(detail.gapType).toBe('oas_spec_orphan');
    expect(detail.specFilePath).toBe(
      'src/main/resources/orphan-openapi.yaml',
    );
    expect(detail).not.toHaveProperty('reason');

    expect(finding.links).toEqual([]);
  });
});
