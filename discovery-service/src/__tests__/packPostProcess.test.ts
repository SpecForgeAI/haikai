/**
 * Tests for `packPostProcess` — the Stage 2 post-processor that filters
 * non-external interface candidates and deduplicates pack output before the
 * Stage 3 LLM gap-fill stage.
 */
import {
  filterNonExternalInterfaces,
  dedupPackCandidates,
  __testing,
} from '../services/packPostProcess';
import type { DiscoveryCandidate, CandidateType } from '../types/candidate';

function makeCandidate(
  overrides: Partial<DiscoveryCandidate>,
): DiscoveryCandidate {
  return {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2, 8)}`,
    runId: overrides.runId ?? 'run-1',
    candidateType: (overrides.candidateType ?? 'interfaces') as CandidateType,
    name: overrides.name ?? 'X',
    confidence: overrides.confidence ?? 0.8,
    status: overrides.status ?? 'proposed',
    sourceClusterIds: overrides.sourceClusterIds ?? ['src/X.java'],
    parentCandidateId: overrides.parentCandidateId,
    data: overrides.data ?? {},
    synthesizedAt: overrides.synthesizedAt ?? new Date().toISOString(),
  };
}

describe('filterNonExternalInterfaces', () => {
  it('drops springConfigKind=configuration', () => {
    const cands = [
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'AppConfig',
        data: { springConfigKind: 'configuration' },
      }),
    ];
    const out = filterNonExternalInterfaces(cands);
    expect(out.kept).toHaveLength(0);
    expect(out.droppedCount).toBe(1);
    expect(out.droppedByMarker['springConfigKind:configuration']).toBe(1);
  });

  it('drops all 5 internal springConfigKind values', () => {
    const kinds = [
      'configuration',
      'xml-context',
      'xml-bean',
      'service-api',
      'aop-aspect',
    ];
    const cands = kinds.map((k) =>
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: `X-${k}`,
        data: { springConfigKind: k },
      }),
    );
    const out = filterNonExternalInterfaces(cands);
    expect(out.kept).toHaveLength(0);
    expect(out.droppedCount).toBe(5);
  });

  it('drops interfaceSubtype=spring-bean-definition', () => {
    const cands = [
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'AppConfig#dataSource',
        data: { interfaceSubtype: 'spring-bean-definition' },
      }),
    ];
    const out = filterNonExternalInterfaces(cands);
    expect(out.kept).toHaveLength(0);
    expect(out.droppedCount).toBe(1);
    expect(out.droppedByMarker['interfaceSubtype:spring-bean-definition']).toBe(1);
  });

  it('KEEPS interfaces with feign-client marker (external)', () => {
    const cands = [
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'CustomerServiceClient',
        data: { springConfigKind: 'feign-client' },
      }),
    ];
    const out = filterNonExternalInterfaces(cands);
    expect(out.kept).toHaveLength(1);
    expect(out.droppedCount).toBe(0);
  });

  it('KEEPS interfaces with no internal marker (default-keep — @Controller / WADL)', () => {
    const cands = [
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'PatientController',
        data: { controllerClassName: 'PatientController' },
      }),
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'OrdersApi',
        data: { interface_type: 'REST_API', _addedBy: 'rest-wadl-pack' },
      }),
    ];
    const out = filterNonExternalInterfaces(cands);
    expect(out.kept).toHaveLength(2);
    expect(out.droppedCount).toBe(0);
  });

  it('passes through non-interfaces candidates unchanged', () => {
    const cands = [
      makeCandidate({
        candidateType: 'endpoints' as CandidateType,
        name: 'GET /orders',
        data: { springConfigKind: 'configuration' }, // would drop on interfaces, but type is endpoints
      }),
      makeCandidate({
        candidateType: 'business_logics' as CandidateType,
        name: 'OrderService',
      }),
    ];
    const out = filterNonExternalInterfaces(cands);
    expect(out.kept).toHaveLength(2);
    expect(out.droppedCount).toBe(0);
  });
});

describe('dedupPackCandidates', () => {
  it('collapses two interfaces with same (type, name) from different file paths', () => {
    const cands = [
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'PatientController',
        sourceClusterIds: ['src/a/PatientController.java'],
      }),
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'PatientController',
        sourceClusterIds: ['src/b/PatientController.java'],
      }),
    ];
    const out = dedupPackCandidates(cands);
    expect(out.kept).toHaveLength(1);
    expect(out.droppedCount).toBe(1);
    expect(out.droppedByType.interfaces).toBe(1);
  });

  it('keeps interfaces with same name but different type (e.g. interface + endpoint)', () => {
    const cands = [
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'orders',
      }),
      makeCandidate({
        candidateType: 'endpoints' as CandidateType,
        name: 'orders',
        data: { httpMethod: 'GET', fullPath: '/orders' },
      }),
    ];
    const out = dedupPackCandidates(cands);
    expect(out.kept).toHaveLength(2);
    expect(out.droppedCount).toBe(0);
  });

  it('collapses endpoints with same (verb, path, parentInterface) emitted from springBoot + WADL', () => {
    const cands = [
      // springBoot/springClassic shape: data.httpMethod + data.fullPath + controllerClassName
      makeCandidate({
        candidateType: 'endpoints' as CandidateType,
        name: 'GET /orders/{id}',
        data: {
          httpMethod: 'GET',
          fullPath: '/orders/{id}',
          controllerClassName: 'OrderController',
        },
      }),
      // WADL shape: data.operation_verb + data.path_or_address; parentCandidateId carries parent
      makeCandidate({
        candidateType: 'endpoints' as CandidateType,
        name: 'GET /orders/{id}',
        parentCandidateId: 'OrderController',
        data: {
          operation_verb: 'GET',
          path_or_address: '/orders/{id}',
        },
      }),
    ];
    const out = dedupPackCandidates(cands);
    expect(out.kept).toHaveLength(1);
    expect(out.droppedCount).toBe(1);
    expect(out.droppedByType.endpoints).toBe(1);
  });

  it('keeps endpoints with same verb/path on different parent interfaces', () => {
    const cands = [
      makeCandidate({
        candidateType: 'endpoints' as CandidateType,
        name: 'GET /healthcheck',
        data: {
          httpMethod: 'GET',
          fullPath: '/healthcheck',
          controllerClassName: 'OrdersHealthController',
        },
      }),
      makeCandidate({
        candidateType: 'endpoints' as CandidateType,
        name: 'GET /healthcheck',
        data: {
          httpMethod: 'GET',
          fullPath: '/healthcheck',
          controllerClassName: 'CatalogHealthController',
        },
      }),
    ];
    const out = dedupPackCandidates(cands);
    expect(out.kept).toHaveLength(2);
    expect(out.droppedCount).toBe(0);
  });

  it('normalizes name for dedup (underscores / hyphens / case)', () => {
    const cands = [
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'PatientController',
      }),
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'patient_controller',
      }),
      // Note: camelCase isn't split (matches dedup.normalizeName semantics).
      // 'patientcontroller' (lower) and 'patient controller' (with underscore→space) are different keys.
      makeCandidate({
        candidateType: 'interfaces' as CandidateType,
        name: 'PATIENT-Controller',
      }),
    ];
    const out = dedupPackCandidates(cands);
    // 'PatientController' → 'patientcontroller'
    // 'patient_controller' → 'patient controller'
    // 'PATIENT-Controller' → 'patient controller' (collapses with the underscore one)
    // So 2 keys total: 'patientcontroller' and 'patient controller'
    expect(out.kept).toHaveLength(2);
    expect(out.droppedCount).toBe(1);
  });

  it('collapses 4x duplicates from a heavy multi-pack scan into 1', () => {
    const cands = Array.from({ length: 4 }, () =>
      makeCandidate({
        candidateType: 'endpoints' as CandidateType,
        name: 'POST /orders',
        data: {
          httpMethod: 'POST',
          fullPath: '/orders',
          controllerClassName: 'OrderController',
        },
      }),
    );
    const out = dedupPackCandidates(cands);
    expect(out.kept).toHaveLength(1);
    expect(out.droppedCount).toBe(3);
  });

  it('first occurrence wins (deterministic order)', () => {
    const first = makeCandidate({
      id: 'first',
      candidateType: 'interfaces' as CandidateType,
      name: 'OrderController',
      confidence: 0.95,
    });
    const second = makeCandidate({
      id: 'second',
      candidateType: 'interfaces' as CandidateType,
      name: 'OrderController',
      confidence: 0.7,
    });
    const out = dedupPackCandidates([first, second]);
    expect(out.kept).toHaveLength(1);
    expect(out.kept[0].id).toBe('first');
  });
});

describe('buildEntityAwareDedupKey (visible for testing)', () => {
  it('endpoint key uses verb+path+parent shape', () => {
    const k = __testing.buildEntityAwareDedupKey(
      makeCandidate({
        candidateType: 'endpoints' as CandidateType,
        name: 'GET /x',
        data: {
          httpMethod: 'get',
          fullPath: '/x',
          controllerClassName: 'XController',
        },
      }),
    );
    expect(k).toBe('endpoints\u0000GET\u0000/x\u0000XController');
  });

  it('non-endpoint key uses (type, normalizedName)', () => {
    const k = __testing.buildEntityAwareDedupKey(
      makeCandidate({
        candidateType: 'business_logics' as CandidateType,
        name: 'OrderService',
      }),
    );
    expect(k).toBe('business_logics\u0000orderservice');
  });
});
