/**
 * Task Group 8 (Spec 0 — Unique, Aggregate Discovery Candidates):
 * the CRUX cross-stack merge-correctness scenario at SCALE — a faithful
 * reproduction of the user's real reported bug ("45 endpoints found 3x").
 *
 * The Group 1-5 suites prove the merge/reconcile transformation for ONE
 * endpoint with 2-3 sources. THIS suite proves the EXACT survivor count and the
 * full per-survivor attribute aggregation across the whole 135-candidate input
 * the field produced:
 *
 *   - 45 WADL endpoint candidates under a generic WADL parent interface,
 *   - 45 WADL endpoint candidates with NO parent (the "duplicate" 3rd view),
 *   - 45 JAX-RS endpoint candidates under the SPECIFIC controller interface,
 *
 * all for the SAME 45 (method + path) pairs. Before this spec those landed under
 * THREE different dedup keys each (parent-in-key, root cause #1) and never
 * collapsed, so the reviewer saw each real endpoint 3x. The universal merge must
 * collapse them to EXACTLY 45, each survivor carrying:
 *   - verb + path (from WADL / normalized to the canonical save-back slots),
 *   - the SPECIFIC controller interface as parent (re-parented away from the
 *     generic WADL interface),
 *   - request + response logical_data_entities (consolidated by identity),
 *   - UNIONed media types (from the JAX-RS media-type variants).
 *
 * Pure / no-I/O. The fixture is the headline acceptance criterion, so the count
 * assertion is EXACT (`toBe(45)`, never `>=`). Kept to a focused set (well under
 * the Group 8 10-test cap) — every test asserts one facet of the SAME fixture.
 */

import { mergeCandidates } from '../candidateMerge';
import { reconcileMergedCandidates } from '../candidateReconcile';
import { sortCandidatesParentsFirst } from '../llmFileAnalysisStep';
import type { DiscoveryCandidate, CandidateType } from '../../types/candidate';

const ENDPOINT_COUNT = 45;

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

/**
 * The 45 real endpoints, each a distinct (verb, path) pair. A spread of HTTP
 * verbs and a mix of static + templated path segments so the canonical-path key
 * is genuinely exercised (templated `{id}`/`{xId}` segments collapse; static
 * segments stay distinct).
 */
const VERBS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const;
interface EndpointSpec {
  verb: string;
  /** The path as the WADL pack emits it (canonical OAS template). */
  wadlPath: string;
  /** The path as JAX-RS emits it (author-named placeholders + literal IDs). */
  jaxrsPath: string;
  resource: string;
}

function buildEndpointSpecs(): EndpointSpec[] {
  const specs: EndpointSpec[] = [];
  for (let i = 0; i < ENDPOINT_COUNT; i++) {
    const verb = VERBS[i % VERBS.length];
    const resource = `resource${i}`;
    // Every 3rd endpoint is templated, so ~1/3 exercise the placeholder-name +
    // literal-ID canonicalization (WADL `{id}` ≡ JAX-RS `{thingId}` ≡ `123`).
    const templated = i % 3 === 0;
    const wadlPath = templated ? `/api/${resource}/{id}` : `/api/${resource}`;
    const jaxrsPath = templated
      ? `/api/${resource}/{${resource}Id}` // author-named placeholder, same shape
      : `/api/${resource}`;
    specs.push({ verb, wadlPath, jaxrsPath, resource });
  }
  return specs;
}

/**
 * Build the full 135-endpoint + interfaces + LDE fixture: for each of the 45
 * specs, a generic-parented WADL endpoint, a no-parent WADL endpoint, and a
 * specific-controller JAX-RS endpoint (carrying media types + request/response
 * DTO refs). Plus the generic WADL interface, the 45 specific controllers, and
 * the request/response DTO candidates (emitted twice — once per source — so DTO
 * consolidation is exercised too).
 */
function buildScaleFixture(): {
  all: DiscoveryCandidate[];
  specs: EndpointSpec[];
  genericWadlIfaceId: string;
} {
  const specs = buildEndpointSpecs();
  const all: DiscoveryCandidate[] = [];

  // One generic WADL interface every WADL endpoint hangs off of.
  const genericWadlIfaceId = 'iface-wadl-generic';
  all.push(
    makeCandidate({
      id: genericWadlIfaceId,
      candidateType: 'interfaces',
      name: 'PetStore WADL',
      data: {
        interface_type: 'REST_API',
        spec_link: 'src/api/petstore.wadl',
        _addedBy: 'rest-wadl-pack',
      },
    }),
  );

  for (let i = 0; i < specs.length; i++) {
    const spec = specs[i];
    const controllerFqn = `com.example.web.${spec.resource}Controller`;
    const controllerIfaceId = `iface-ctrl-${i}`;
    const reqDto = `${spec.resource}Request`;
    const resDto = `${spec.resource}Response`;

    // The specific JAX-RS controller interface.
    all.push(
      makeCandidate({
        id: controllerIfaceId,
        candidateType: 'interfaces',
        name: `${spec.resource}Controller`,
        data: {
          className: controllerFqn,
          interfaceSubtype: 'jaxrs-resource',
          _addedBy: 'spring-classic-jaxrs',
        },
      }),
    );

    // (1) WADL endpoint under the generic WADL interface — verb+path+doc only.
    all.push(
      makeCandidate({
        id: `ep-wadl-generic-${i}`,
        candidateType: 'endpoints',
        name: `${spec.resource}_op`,
        parentCandidateId: genericWadlIfaceId,
        data: {
          operation_verb: spec.verb,
          path_or_address: spec.wadlPath,
          doc: `WADL doc for ${spec.resource}`,
          _addedBy: 'rest-wadl-pack',
        },
      }),
    );

    // (2) WADL endpoint with NO parent — the 3rd duplicate view.
    all.push(
      makeCandidate({
        id: `ep-wadl-noparent-${i}`,
        candidateType: 'endpoints',
        name: `${spec.resource}_op_alt`,
        data: {
          operation_verb: spec.verb,
          path_or_address: spec.wadlPath,
          _addedBy: 'rest-wadl-pack',
        },
      }),
    );

    // (3) JAX-RS endpoint under the SPECIFIC controller — the rich source:
    // specific interface, request/response DTO refs, media types. Every 5th
    // endpoint splits into TWO media-type variants (json + xml) so the
    // media-type UNION is exercised at scale.
    const baseJaxrsData: Record<string, unknown> = {
      httpMethod: spec.verb,
      fullPath: spec.jaxrsPath,
      controllerClassName: controllerFqn,
      requestEntityName: reqDto,
      responseEntityName: resDto,
      _addedBy: 'spring-classic-jaxrs',
    };
    if (i % 5 === 0) {
      all.push(
        makeCandidate({
          id: `ep-jaxrs-${i}-json`,
          candidateType: 'endpoints',
          name: `${spec.verb} ${spec.jaxrsPath} [produces=application/json]`,
          parentCandidateId: controllerIfaceId,
          data: {
            ...baseJaxrsData,
            consumes: ['application/json'],
            produces: ['application/json'],
          },
        }),
      );
      all.push(
        makeCandidate({
          id: `ep-jaxrs-${i}-xml`,
          candidateType: 'endpoints',
          name: `${spec.verb} ${spec.jaxrsPath} [produces=application/xml]`,
          parentCandidateId: controllerIfaceId,
          data: {
            ...baseJaxrsData,
            consumes: ['application/xml'],
            produces: ['application/xml'],
          },
        }),
      );
    } else {
      all.push(
        makeCandidate({
          id: `ep-jaxrs-${i}`,
          candidateType: 'endpoints',
          name: `${spec.verb} ${spec.jaxrsPath}`,
          parentCandidateId: controllerIfaceId,
          data: {
            ...baseJaxrsData,
            consumes: ['application/json'],
            produces: ['application/json'],
          },
        }),
      );
    }

    // Request/response DTO candidates — emitted by BOTH the JAX-RS source AND
    // the WADL/XSD source (different casing) so DTO consolidation collapses the
    // duplicate to one survivor per identity.
    for (const dtoName of [reqDto, resDto]) {
      all.push(
        makeCandidate({
          id: `dto-jaxrs-${dtoName}`,
          candidateType: 'logical_data_entities',
          name: dtoName,
          data: { _addedBy: 'spring-classic-jaxrs' },
        }),
      );
      all.push(
        makeCandidate({
          id: `dto-xsd-${dtoName}`,
          candidateType: 'logical_data_entities',
          // Lower-cased — same identity key, different surface name.
          name: dtoName.toLowerCase(),
          data: { _addedBy: 'xsd-schema-pack' },
        }),
      );
    }
  }

  return { all, specs, genericWadlIfaceId };
}

describe('Spec 0 Group 8 — 45-endpoint 3x->1x scale scenario (the crux)', () => {
  it('collapses 135 endpoint candidates (90 WADL + 45 JAX-RS) into EXACTLY 45 survivors', () => {
    const { all } = buildScaleFixture();

    // Sanity: the fixture really did emit 135 endpoint candidates (45*3),
    // accounting for the media-type-split JAX-RS variants (every 5th -> +1).
    const inputEndpoints = all.filter((c) => c.candidateType === 'endpoints');
    const mediaSplitExtras = Math.ceil(ENDPOINT_COUNT / 5); // every 5th adds a 2nd variant
    expect(inputEndpoints).toHaveLength(ENDPOINT_COUNT * 3 + mediaSplitExtras);

    const { merged, mergeGroups } = mergeCandidates(all);
    const reconciled = reconcileMergedCandidates(merged);

    const survivors = reconciled.filter((c) => c.candidateType === 'endpoints');
    // THE headline assertion — exactly 45, never 135, never 90, never 46.
    expect(survivors).toHaveLength(ENDPOINT_COUNT);

    // Every endpoint identity collapsed >= 2 sources, so there is one merge
    // group per real endpoint (exactly 45 endpoint groups).
    const endpointGroups = mergeGroups.filter(
      (g) => g.candidateType === 'endpoints',
    );
    expect(endpointGroups).toHaveLength(ENDPOINT_COUNT);
  });

  it('every survivor carries verb+path (WADL) + specific interface + request/response LDEs + UNIONed media (JAX-RS)', () => {
    const { all, specs } = buildScaleFixture();
    const { merged } = mergeCandidates(all);
    const reconciled = reconcileMergedCandidates(merged);

    const survivors = reconciled.filter((c) => c.candidateType === 'endpoints');
    expect(survivors).toHaveLength(ENDPOINT_COUNT);

    // Index the surviving specific-controller interfaces by id so we can assert
    // each endpoint re-parented to a REAL surviving controller.
    const interfaceById = new Map(
      reconciled
        .filter((c) => c.candidateType === 'interfaces')
        .map((c) => [c.id, c]),
    );

    // Every (verb, canonical-path) pair appears exactly once among survivors.
    const seenKeys = new Set<string>();

    for (const survivor of survivors) {
      const d = survivor.data as Record<string, unknown>;

      // (a) verb + path normalized to the canonical save-back slots; the
      // camelCase JAX-RS originals are gone (root cause #2, merge side).
      expect(typeof d.operation_verb).toBe('string');
      expect(typeof d.path_or_address).toBe('string');
      expect(d.httpMethod).toBeUndefined();
      expect(d.fullPath).toBeUndefined();

      // (b) WADL-only attribute (doc) survived the union — verb+path provenance
      // is genuinely WADL+JAX-RS aggregated, not JAX-RS-only.
      expect(d.doc).toBeDefined();

      // (c) the JAX-RS request/response DTO refs survived the union.
      expect(typeof d.requestEntityName).toBe('string');
      expect(typeof d.responseEntityName).toBe('string');

      // (d) media types present + UNIONed (the split variants merged to one).
      expect(Array.isArray(d.produces)).toBe(true);
      expect((d.produces as unknown[]).length).toBeGreaterThanOrEqual(1);

      // (e) re-parented to a SPECIFIC controller interface that still exists.
      expect(survivor.parentCandidateId).toBeDefined();
      const parent = interfaceById.get(survivor.parentCandidateId as string);
      expect(parent).toBeDefined();
      const parentData = (parent!.data || {}) as Record<string, unknown>;
      // Specific controller => has a className FQN (NOT the generic WADL iface).
      expect(typeof parentData.className).toBe('string');
      expect(parentData.spec_link).toBeUndefined();

      // (f) provenance shows BOTH sources folded in.
      const addedBy = d._addedBy as string[];
      expect(addedBy).toEqual(
        expect.arrayContaining(['rest-wadl-pack', 'spring-classic-jaxrs']),
      );

      const key = `${d.operation_verb} ${d.path_or_address}`;
      expect(seenKeys.has(key)).toBe(false);
      seenKeys.add(key);
    }

    // Exactly the 45 distinct real endpoints (verb dimension makes templated
    // paths under one resource distinct across verbs).
    expect(seenKeys.size).toBe(specs.length);

    // The media-type-split endpoints (every 5th) UNIONed json + xml into ONE.
    const splitSurvivor = survivors.find((s) => {
      const d = s.data as Record<string, unknown>;
      const produces = (d.produces as string[]) ?? [];
      return produces.includes('application/xml');
    });
    expect(splitSurvivor).toBeDefined();
    const splitProduces = (
      (splitSurvivor!.data as Record<string, unknown>).produces as string[]
    )
      .slice()
      .sort();
    expect(splitProduces).toEqual(['application/json', 'application/xml']);
  });

  it('drops the emptied generic WADL interface and keeps the 45 specific controllers', () => {
    const { all, genericWadlIfaceId } = buildScaleFixture();
    const { merged } = mergeCandidates(all);
    const reconciled = reconcileMergedCandidates(merged);

    const interfaces = reconciled.filter((c) => c.candidateType === 'interfaces');
    // The generic WADL interface emptied to zero endpoints after re-parenting
    // is dropped; the 45 specific controllers remain.
    expect(interfaces.find((i) => i.id === genericWadlIfaceId)).toBeUndefined();
    expect(interfaces).toHaveLength(ENDPOINT_COUNT);
    interfaces.forEach((iface) => {
      const data = (iface.data || {}) as Record<string, unknown>;
      expect(typeof data.className).toBe('string');
    });
  });

  it('consolidates the duplicate request/response DTOs to one survivor per identity', () => {
    const { all } = buildScaleFixture();
    const { merged } = mergeCandidates(all);
    const reconciled = reconcileMergedCandidates(merged);

    const dtos = reconciled.filter(
      (c) => c.candidateType === 'logical_data_entities',
    );
    // 45 request + 45 response DTOs were each emitted twice (JAX-RS + XSD).
    // Identity is the normalized DTO name, so each collapses to ONE survivor:
    // 45 request + 45 response = 90 survivors, NOT 180.
    expect(dtos).toHaveLength(ENDPOINT_COUNT * 2);

    // Each surviving DTO folded both sources (provenance proves consolidation).
    const multiSourceDtos = dtos.filter((c) => {
      const addedBy = (c.data as Record<string, unknown>)._addedBy as
        | string[]
        | undefined;
      return (
        Array.isArray(addedBy) &&
        addedBy.includes('spring-classic-jaxrs') &&
        addedBy.includes('xsd-schema-pack')
      );
    });
    expect(multiSourceDtos).toHaveLength(ENDPOINT_COUNT * 2);
  });

  it('holds a true cross-source attribute conflict at scale as _conflicts for the grid + a per-conflict Finding-ready record, never auto-resolving', () => {
    // Inject ONE genuine cross-source disagreement on a NON-identity attribute
    // (the endpoint `doc`): for endpoint 1 the WADL source documents it one way
    // and the JAX-RS source documents it differently. (The verb/path ARE the
    // identity key, so a verb disagreement would correctly route to a DIFFERENT
    // endpoint rather than conflict — the conflict path is for the rich
    // attributes that hang off ONE identity.) The merge must HOLD both values as
    // `_conflicts.doc` — the exact `_conflicts[attr]` shape the grid consumes —
    // NEVER silently pick one by precedence.
    const { all } = buildScaleFixture();
    // Endpoint 1 is non-templated with a SINGLE JAX-RS candidate (`ep-jaxrs-1`);
    // its WADL-generic view already writes `doc: "WADL doc for resource1"`.
    const wadlDocSource = all.find((c) => c.id === 'ep-wadl-generic-1');
    const jaxrsTarget = all.find((c) => c.id === 'ep-jaxrs-1');
    expect(wadlDocSource).toBeDefined();
    expect(jaxrsTarget).toBeDefined();
    const wadlDoc = (wadlDocSource!.data as Record<string, unknown>).doc as string;
    // Give the JAX-RS source a DIFFERENT doc value -> a true value conflict.
    (jaxrsTarget!.data as Record<string, unknown>).doc =
      'JAX-RS Javadoc for resource1';

    const { merged, conflicts } = mergeCandidates(all);
    const reconciled = reconcileMergedCandidates(merged);

    // Still exactly 45 survivors — a conflict does NOT split the endpoint.
    const survivors = reconciled.filter((c) => c.candidateType === 'endpoints');
    expect(survivors).toHaveLength(ENDPOINT_COUNT);

    // Exactly ONE survivor carries the `doc` conflict (only endpoint 1's JAX-RS
    // source got a divergent doc; every other endpoint's doc is WADL-only).
    const conflictedSurvivors = survivors.filter((s) => {
      const d = s.data as Record<string, unknown>;
      const c = (d._conflicts ?? {}) as Record<string, unknown>;
      return c.doc !== undefined;
    });
    expect(conflictedSurvivors).toHaveLength(1);

    // The conflicted survivor carries `_conflicts.doc` with each distinct
    // present value tagged by its source (grid-consumable shape).
    const cdata = conflictedSurvivors[0].data as Record<string, unknown>;
    const docConflict = (cdata._conflicts as Record<
      string,
      Array<{ value: unknown; source: string }>
    >).doc;
    const byValue = new Map(docConflict.map((c) => [c.value, c.source]));
    expect(byValue.get('JAX-RS Javadoc for resource1')).toBe(
      'spring-classic-jaxrs',
    );
    expect(byValue.get(wadlDoc)).toBe('rest-wadl-pack');
    // NEVER auto-resolved: no resolution stamp written by the engine.
    expect(cdata._conflictResolutions ?? {}).toEqual({});

    // The engine surfaced exactly this conflict in its per-conflict metadata
    // (what Group 4 turns into one candidate_conflict Finding).
    const docConflictMeta = conflicts.filter((c) => c.attr === 'doc');
    expect(docConflictMeta).toHaveLength(1);
    expect(docConflictMeta[0].competingValues).toHaveLength(2);
  });

  it('keeps parents-first persist holding across the full 45-set after re-parent + drop', () => {
    const { all } = buildScaleFixture();
    const { merged } = mergeCandidates(all);
    const reconciled = reconcileMergedCandidates(merged);
    const sorted = sortCandidatesParentsFirst(reconciled);

    // Every endpoint's parent interface must appear BEFORE it in the persist
    // order, for all 45 — the bulkSaveCandidates contract at scale.
    const indexById = new Map(sorted.map((c, idx) => [c.id, idx]));
    const endpoints = sorted.filter((c) => c.candidateType === 'endpoints');
    expect(endpoints).toHaveLength(ENDPOINT_COUNT);
    for (const ep of endpoints) {
      expect(ep.parentCandidateId).toBeDefined();
      const parentIdx = indexById.get(ep.parentCandidateId as string);
      const childIdx = indexById.get(ep.id);
      expect(parentIdx).toBeDefined();
      expect(childIdx!).toBeGreaterThan(parentIdx!);
    }
  });
});
