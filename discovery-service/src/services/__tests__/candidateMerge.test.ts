/**
 * Task Group 2 (Spec 0 — Unique, Aggregate Discovery Candidates):
 * focused tests for the core, pure `mergeCandidates()` engine — attribute
 * union, source precedence (gap-fill + equal-value canonical slot), conflict
 * detection, media-type variant collapse, confidence = max(), single-source
 * preservation, and the root-cause-#2 field-name normalization.
 *
 * Pure / no-I/O — merge correctness is the crux of this spec.
 * Kept to a tight focused set (2-8 tests).
 */

import { mergeCandidates } from '../candidateMerge';
import type { DiscoveryCandidate, CandidateType } from '../../types/candidate';

function makeCandidate(
  overrides: Partial<DiscoveryCandidate>,
): DiscoveryCandidate {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 10)}`,
    runId: overrides.runId ?? 'run-1',
    candidateType: (overrides.candidateType ?? 'endpoints') as CandidateType,
    name: overrides.name ?? 'X',
    confidence: overrides.confidence ?? 0.9,
    status: overrides.status ?? 'proposed',
    sourceClusterIds: overrides.sourceClusterIds ?? ['src/X.java'],
    parentCandidateId: overrides.parentCandidateId,
    data: overrides.data ?? {},
    synthesizedAt: overrides.synthesizedAt ?? new Date().toISOString(),
  };
}

describe('mergeCandidates — attribute union + source precedence', () => {
  it('collapses a MALFORMED-brace endpoint twin into ONE survivor with its well-formed twin (duplicate-endpoint fix)', () => {
    // The HAIKAI duplicate the whole fix targets: the WADL pack emits the
    // well-formed `POST /hierarchy/{businessDate}/{grdOrgId}` and a non-WADL
    // pack emitted the SAME logical endpoint with a MALFORMED path
    // `POST /hierarchy/businessDate}/{grdOrgId}` (opening `{` lost upstream).
    // Pre-fix the identity keys differed and the merge kept BOTH. They must now
    // merge to exactly one survivor.
    const wadlTwin = makeCandidate({
      id: 'wadl-twin',
      candidateType: 'endpoints',
      name: 'getHierarchy_op',
      parentCandidateId: 'samplesvc-service-version',
      data: {
        operation_verb: 'POST',
        path_or_address: '/hierarchy/{businessDate}/{grdOrgId}',
        doc: 'Look up hierarchy',
        _addedBy: 'rest-wadl-pack',
      },
    });
    const malformedTwin = makeCandidate({
      id: 'malformed-twin',
      candidateType: 'endpoints',
      name: 'POST /hierarchy/businessDate}/{grdOrgId}',
      parentCandidateId: 'hierarchy-lookup-service',
      data: {
        httpMethod: 'POST',
        fullPath: '/hierarchy/businessDate}/{grdOrgId}',
        controllerClassName: 'HierarchyLookupService',
        _addedBy: 'spring-classic-jaxrs',
      },
    });

    const { merged, mergeGroups } = mergeCandidates([wadlTwin, malformedTwin]);
    // The crux: ONE endpoint, not two.
    expect(merged).toHaveLength(1);
    // Both source rows folded into the single survivor.
    const grp = mergeGroups.find((g) => g.survivorId === merged[0].id);
    expect(grp).toBeDefined();
    expect(grp!.mergedFromIds.sort()).toEqual(['malformed-twin', 'wadl-twin']);
    // Cross-source union still holds on the survivor.
    const d = merged[0].data;
    expect(d.doc).toBe('Look up hierarchy');
    expect(d.controllerClassName).toBe('HierarchyLookupService');
  });
  it('unions attributes and gap-fills an absent slot from the contributing source', () => {
    // WADL endpoint: has verb/path/description, NO request/response bodies.
    const wadl = makeCandidate({
      id: 'wadl-1',
      candidateType: 'endpoints',
      name: 'getUser_op',
      confidence: 0.9,
      data: {
        operation_verb: 'GET',
        path_or_address: '/users/{id}',
        doc: 'Get a user',
        _addedBy: 'rest-wadl-pack',
      },
    });
    // JAX-RS endpoint: has the specific interface + request/response + media.
    const jaxrs = makeCandidate({
      id: 'jaxrs-1',
      candidateType: 'endpoints',
      name: 'GET /users/{userId}',
      confidence: 0.9,
      parentCandidateId: 'user-controller',
      data: {
        httpMethod: 'GET',
        fullPath: '/users/{userId}',
        controllerClassName: 'UserController',
        produces: ['application/json'],
        _addedBy: 'spring-classic-jaxrs',
      },
    });

    const { merged } = mergeCandidates([wadl, jaxrs]);
    expect(merged).toHaveLength(1);
    const survivor = merged[0];
    const d = survivor.data as Record<string, unknown>;
    // Union: doc (WADL-only) + controllerClassName/produces (JAX-RS-only) all present.
    expect(d.doc).toBe('Get a user');
    expect(d.controllerClassName).toBe('UserController');
    expect(d.produces).toEqual(['application/json']);
    // Root-cause #2: canonical slots populated from JAX-RS camelCase fields.
    expect(d.operation_verb).toBe('GET');
    expect(d.path_or_address).toBe('/users/{userId}');
  });

  it('picks the canonical slot for EQUAL values by precedence and records _attributeProvenance', () => {
    // Both sources agree on description, but the structural framework pack wins
    // the canonical slot's provenance over the contract pack.
    const framework = makeCandidate({
      id: 'fw-1',
      candidateType: 'service',
      name: 'OrderService',
      data: { description: 'Handles orders', _addedBy: 'spring-classic-adapter' },
    });
    const contract = makeCandidate({
      id: 'ct-1',
      candidateType: 'service',
      name: 'OrderService',
      data: { description: 'Handles orders', _addedBy: 'xsd-schema-pack' },
    });

    const { merged } = mergeCandidates([contract, framework]);
    expect(merged).toHaveLength(1);
    const d = merged[0].data as Record<string, unknown>;
    expect(d.description).toBe('Handles orders');
    const prov = d._attributeProvenance as Record<string, string>;
    // Framework pack (higher precedence) owns the canonical slot.
    expect(prov.description).toBe('spring-classic-adapter');
    expect(d._conflicts ?? {}).toEqual({});
  });
});

describe('mergeCandidates — conflict detection (never auto-resolved)', () => {
  it('records differing present values as _conflicts with each {value, source}', () => {
    const a = makeCandidate({
      id: 'a-1',
      candidateType: 'service',
      name: 'PaymentService',
      data: { owner: 'team-alpha', _addedBy: 'spring-classic-adapter' },
    });
    const b = makeCandidate({
      id: 'b-1',
      candidateType: 'service',
      name: 'PaymentService',
      data: { owner: 'team-beta', _addedBy: 'rest-wadl-pack' },
    });

    const { merged, conflicts } = mergeCandidates([a, b]);
    expect(merged).toHaveLength(1);
    const d = merged[0].data as Record<string, unknown>;
    const conf = d._conflicts as Record<string, Array<{ value: unknown; source: string }>>;
    expect(conf.owner).toBeDefined();
    // One entry per distinct present value, each tagged with its source.
    const byValue = new Map(conf.owner.map((c) => [c.value, c.source]));
    expect(byValue.get('team-alpha')).toBe('spring-classic-adapter');
    expect(byValue.get('team-beta')).toBe('rest-wadl-pack');
    // NOT auto-resolved: no resolution stamp.
    expect(d._conflictResolutions ?? {}).toEqual({});
    // Surfaced in the engine's conflict metadata for Group 4 Findings.
    expect(conflicts.some((c) => c.attr === 'owner')).toBe(true);
  });
});

describe('mergeCandidates — media-type variant collapse', () => {
  it('collapses JAX-RS media-type variants into one endpoint with UNIONed consumes/produces', () => {
    const jsonVariant = makeCandidate({
      id: 'mt-json',
      candidateType: 'endpoints',
      name: 'POST /things [consumes=application/json;produces=application/json]',
      data: {
        httpMethod: 'POST',
        fullPath: '/things',
        consumes: ['application/json'],
        produces: ['application/json'],
        _addedBy: 'spring-classic-jaxrs',
      },
    });
    const xmlVariant = makeCandidate({
      id: 'mt-xml',
      candidateType: 'endpoints',
      name: 'POST /things [consumes=application/xml;produces=application/xml]',
      data: {
        httpMethod: 'POST',
        fullPath: '/things',
        consumes: ['application/xml'],
        produces: ['application/xml'],
        _addedBy: 'spring-classic-jaxrs',
      },
    });

    const { merged } = mergeCandidates([jsonVariant, xmlVariant]);
    expect(merged).toHaveLength(1);
    const d = merged[0].data as Record<string, unknown>;
    expect((d.consumes as string[]).sort()).toEqual([
      'application/json',
      'application/xml',
    ]);
    expect((d.produces as string[]).sort()).toEqual([
      'application/json',
      'application/xml',
    ]);
    // UNION is not a conflict — media types are attributes, not identity.
    expect(d._conflicts ?? {}).toEqual({});
    // Name re-derived from the union so per-format expansion can still split.
    expect(merged[0].name).toBe(
      'POST /things [consumes=application/json,application/xml;produces=application/json,application/xml]',
    );
  });

  it('re-derives the survivor NAME from the union when a suffix-LESS WADL twin outranks its JAX-RS twin (90→75 regression fix)', () => {
    // The regression shape: the WADL-derived survivor wins precedence but its
    // NAME carries NO discriminator suffix; the JAX-RS twin contributes the
    // media types. Pre-fix the union landed in `data` but the survivor NAME
    // stayed suffix-less, so per-format expansion (which keys off the NAME)
    // skipped the endpoint and the capture universe shrank.
    // Same source label so precedence ties → the id tiebreak makes the
    // suffix-LESS candidate ('a-wadl') the survivor; the twin ('b-jaxrs')
    // contributes the media types.
    const wadlSurvivor = makeCandidate({
      id: 'a-wadl',
      candidateType: 'endpoints',
      name: 'getViews_op', // no discriminator suffix
      data: {
        operation_verb: 'POST',
        path_or_address: '/views',
        _addedBy: 'rest-wadl-pack',
      },
    });
    const jaxRsTwin = makeCandidate({
      id: 'b-jaxrs',
      candidateType: 'endpoints',
      name: 'POST /views [consumes=application/json,application/xml;produces=application/json,application/xml]',
      data: {
        httpMethod: 'POST',
        fullPath: '/views',
        consumes: ['application/json', 'application/xml'],
        produces: ['application/json', 'application/xml'],
        _addedBy: 'rest-wadl-pack',
      },
    });

    const { merged } = mergeCandidates([wadlSurvivor, jaxRsTwin]);
    expect(merged).toHaveLength(1);
    // The survivor NAME now carries the unioned discriminator suffix, even
    // though the higher-precedence WADL source's name had none.
    expect(merged[0].name).toBe(
      'getViews_op [consumes=application/json,application/xml;produces=application/json,application/xml]',
    );
  });

  it('a survivor with NO discriminator lists loses any stale suffix (bare verb+path name)', () => {
    const a = makeCandidate({
      id: 'a',
      candidateType: 'endpoints',
      name: 'POST /plain [consumes=application/json]', // stale suffix, no data lists
      data: { operation_verb: 'POST', path_or_address: '/plain', _addedBy: 'rest-wadl-pack' },
    });
    const b = makeCandidate({
      id: 'b',
      candidateType: 'endpoints',
      name: 'POST /plain',
      data: { httpMethod: 'POST', fullPath: '/plain', _addedBy: 'spring-classic-jaxrs' },
    });
    const { merged } = mergeCandidates([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].name).toBe('POST /plain');
  });
});

describe('mergeCandidates — confidence + single-source preservation', () => {
  it('sets confidence = max() of contributing sources and flags a conflicted survivor', () => {
    const lowConf = makeCandidate({
      id: 'lc-1',
      candidateType: 'service',
      name: 'InventoryService',
      confidence: 0.6,
      data: { tier: 'gold', _addedBy: 'rest-wadl-pack' },
    });
    const highConf = makeCandidate({
      id: 'hc-1',
      candidateType: 'service',
      name: 'InventoryService',
      confidence: 0.95,
      data: { tier: 'silver', _addedBy: 'spring-classic-adapter' },
    });

    const { merged, mergeGroups } = mergeCandidates([lowConf, highConf]);
    expect(merged).toHaveLength(1);
    expect(merged[0].confidence).toBe(0.95);
    // A conflict exists (gold vs silver) regardless of the high confidence.
    const d = merged[0].data as Record<string, unknown>;
    expect((d._conflicts as Record<string, unknown>).tier).toBeDefined();
    // The merge group records both source ids in _mergedFrom.
    const grp = mergeGroups.find((g) => g.survivorId === merged[0].id);
    expect(grp).toBeDefined();
    expect(grp!.mergedFromIds.sort()).toEqual(['hc-1', 'lc-1']);
  });

  it('preserves a single-source candidate with _addedBy as string[] + _mergedFrom and no conflicts', () => {
    const solo = makeCandidate({
      id: 'solo-1',
      candidateType: 'interfaces',
      name: 'ReportController',
      parentCandidateId: 'svc-1',
      data: { className: 'com.example.ReportController', _addedBy: 'spring-classic-jaxrs' },
    });
    // A non-merged type that must pass through UNTOUCHED.
    const passthrough = makeCandidate({
      id: 'pass-1',
      candidateType: 'class',
      name: 'TaxComputer',
      data: { _addedBy: 'spring-classic-adapter' },
    });

    const { merged } = mergeCandidates([solo, passthrough]);
    expect(merged).toHaveLength(2);
    const survivor = merged.find((c) => c.id === 'solo-1')!;
    const d = survivor.data as Record<string, unknown>;
    expect(d._addedBy).toEqual(['spring-classic-jaxrs']);
    expect(d._mergedFrom).toEqual(['solo-1']);
    expect(d._conflicts ?? {}).toEqual({});
    // Single-source interface keeps its parent untouched.
    expect(survivor.parentCandidateId).toBe('svc-1');
    // Non-merged passthrough is unchanged (same object identity preserved).
    expect(merged.find((c) => c.id === 'pass-1')).toBe(passthrough);
  });

  it('collapses the SAME class+method business_logics from two sources, but KEEPS same-named methods in DIFFERENT classes', () => {
    // True cross-pass duplicate: the framework adapter AND the LLM gap-fill both
    // emit OrderService.createView. They are the SAME method → ONE survivor.
    const packMethod = makeCandidate({
      id: 'pack-createView',
      candidateType: 'business_logics',
      name: 'createView',
      data: { className: 'OrderService', _addedBy: 'spring-classic-adapter', methodId: 'm-1' },
    });
    const llmMethod = makeCandidate({
      id: 'llm-createView',
      candidateType: 'business_logics',
      name: 'createView',
      data: { className: 'OrderService', _addedBy: 'llm-gap-fill' },
    });
    // A DISTINCT method: same name, DIFFERENT class — must NOT be fused.
    const otherClassMethod = makeCandidate({
      id: 'pack-createView-other',
      candidateType: 'business_logics',
      name: 'createView',
      data: { className: 'FavouriteService', _addedBy: 'spring-classic-adapter' },
    });

    const { merged } = mergeCandidates([packMethod, llmMethod, otherClassMethod]);
    // OrderService.createView collapses to one; FavouriteService.createView stays.
    expect(merged).toHaveLength(2);
    // The pack source (highest precedence) is the surviving id for the merged pair.
    const ordering = merged.find(
      (c) => (c.data as Record<string, unknown>).className === 'OrderService',
    )!;
    expect(ordering.id).toBe('pack-createView');
    expect((ordering.data as Record<string, unknown>)._mergedFrom).toEqual(
      expect.arrayContaining(['pack-createView', 'llm-createView']),
    );
    // The different-class method is untouched and still present.
    expect(merged.some((c) => c.id === 'pack-createView-other')).toBe(true);
  });

  it('does NOT fuse className-less business_logics by bare name (keys on unique id)', () => {
    // Without a className we cannot safely group — two same-named, class-less
    // methods must remain distinct rather than risk fusing unrelated logic.
    const a = makeCandidate({
      id: 'a',
      candidateType: 'business_logics',
      name: 'process',
      data: { _addedBy: 'spring-classic-adapter' },
    });
    const b = makeCandidate({
      id: 'b',
      candidateType: 'business_logics',
      name: 'process',
      data: { _addedBy: 'spring-classic-adapter' },
    });
    const { merged } = mergeCandidates([a, b]);
    expect(merged).toHaveLength(2);
  });
});
