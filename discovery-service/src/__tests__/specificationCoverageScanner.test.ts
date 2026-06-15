/**
 * Tests for the dimension-B specification-coverage scanner + its builder.
 *
 * Spec: 2026-05-30 Capture Coverage Gates (Spec 5) -- Task Group 2.
 *
 * These verify, on the DISCOVERY side, the SAME per-protocol "fully specified"
 * bar AMS Group 1 computes in `computeSpecificationCoverage`:
 *   - REST endpoint is "fully specified" iff it has a resolved
 *     `endpoint_data_effects` edge (matched BY NAME, the save-back key);
 *     otherwise -> `endpoint_missing_data_effect` evidence_gap.
 *   - SOAP operation is "fully specified" iff its parent interface has bound
 *     request/response message entities (an `interface_logical_entities`
 *     candidate matched BY interface name); otherwise ->
 *     `soap_operation_missing_message_binding` evidence_gap.
 *   - `business_logics.behavior` (Spec 2) is BONUS only, never required.
 *
 * Plus: the canonical evidence-gap builder shape, and that the per-endpoint
 * "fully specified?" count rolls into the existing run aggregate
 * (`FindingEmitter.getRunAggregate`) -- no new aggregate shape.
 */

import { buildUnderSpecifiedEndpointFinding } from '../services/findings/emissionSources';
import { scanForSpecificationCoverage } from '../services/findings/specificationCoverageScanner';
import {
  FindingEmitter,
  type FindingEmitterArchClient,
  type FindingEmitRunContext,
} from '../services/findings/FindingEmitter';
import type {
  DiscoveryCandidate,
  CandidateType,
} from '../types/candidate';

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

let idSeq = 0;
function cand(
  candidateType: CandidateType,
  name: string,
  data: Record<string, unknown>,
  extra: Partial<DiscoveryCandidate> = {},
): DiscoveryCandidate {
  idSeq += 1;
  return {
    id: `C-${idSeq}`,
    runId: 'run-1',
    candidateType,
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data,
    synthesizedAt: '2026-05-30T00:00:00Z',
    ...extra,
  };
}

/** A REST endpoint candidate (carries `httpMethod` like the Spring Classic adapter). */
function restEndpoint(name: string): DiscoveryCandidate {
  return cand('endpoints', name, { httpMethod: name.split(' ')[0], fullPath: name.split(' ')[1] });
}

/** A `endpoint_data_effects` edge candidate referencing its endpoint BY NAME. */
function dataEffect(endpointName: string, dataEntityName: string): DiscoveryCandidate {
  return cand('endpoint_data_effects', `${endpointName} -> ${dataEntityName} (read)`, {
    endpointName,
    dataEntityName,
    access_mode: 'read',
    _addedBy: 'spring-classic-adapter',
  });
}

/** A SOAP interface candidate (carries the canonical `interface_type='SOAP_API'`). */
function soapInterface(name: string): DiscoveryCandidate {
  return cand('interfaces', name, {
    interface_type: 'SOAP_API',
    _addedBy: 'spring-classic-soap',
  });
}

/** A SOAP endpoint candidate (parent = SOAP interface; carries SOAP markers). */
function soapEndpoint(name: string, parentId: string): DiscoveryCandidate {
  return cand(
    'endpoints',
    name,
    {
      operation_verb: 'POST',
      soap_action: `urn:${name}`,
      request_root_element: `${name}Request`,
      _addedBy: 'spring-classic-soap',
    },
    { parentCandidateId: parentId },
  );
}

/** An `interface_logical_entities` binding candidate referencing its interface BY NAME. */
function interfaceBinding(interfaceName: string, messageTypeName: string): DiscoveryCandidate {
  return cand('interface_logical_entities', `${interfaceName} <-> ${messageTypeName}`, {
    interfaceClassName: interfaceName,
    logicalEntityName: messageTypeName,
    direction: 'exposes',
    _addedBy: 'spring-classic-soap-message',
  });
}

// -----------------------------------------------------------------------------
// Builder shape
// -----------------------------------------------------------------------------

describe('buildUnderSpecifiedEndpointFinding (canonical evidence-gap shape)', () => {
  it('REST sentinel -> evidence_gap / evidence_gap / medium / supports link / gapType', () => {
    const f = buildUnderSpecifiedEndpointFinding({
      candidateId: 'C-ep',
      candidateName: 'GET /api/users',
      gapType: 'endpoint_missing_data_effect',
    });
    expect(f.findingType).toBe('evidence_gap');
    expect(f.category).toBe('evidence_gap');
    expect(f.severity).toBe('medium');
    expect(f.source).toBe('pipeline_evidence_gap');
    expect(f.detailJson).toEqual({ gapType: 'endpoint_missing_data_effect' });
    expect(f.links).toEqual([
      { linkType: 'supports', targetType: 'discovery_candidate', targetId: 'C-ep' },
    ]);
  });

  it('SOAP sentinel -> gapType=soap_operation_missing_message_binding', () => {
    const f = buildUnderSpecifiedEndpointFinding({
      candidateId: 'C-op',
      candidateName: 'GetEmployee',
      gapType: 'soap_operation_missing_message_binding',
    });
    expect(f.findingType).toBe('evidence_gap');
    expect(f.category).toBe('evidence_gap');
    expect(f.severity).toBe('medium');
    expect(f.detailJson).toEqual({ gapType: 'soap_operation_missing_message_binding' });
    expect(f.links?.[0]).toMatchObject({ targetType: 'discovery_candidate', targetId: 'C-op' });
  });
});

// -----------------------------------------------------------------------------
// Scanner -- REST bar (resolved endpoint_data_effects edge)
// -----------------------------------------------------------------------------

describe('scanForSpecificationCoverage -- REST', () => {
  it('under-specified REST endpoint (no data effect) yields ONE finding', () => {
    const ep = restEndpoint('GET /api/orders');
    const res = scanForSpecificationCoverage([ep]);
    expect(res.inputs).toHaveLength(1);
    expect(res.inputs[0].detailJson).toEqual({ gapType: 'endpoint_missing_data_effect' });
    expect(res.inputs[0].links?.[0].targetId).toBe(ep.id);
    expect(res.totalEndpoints).toBe(1);
    expect(res.fullySpecifiedCount).toBe(0);
    expect(res.underSpecifiedCount).toBe(1);
  });

  it('fully-specified REST endpoint (has resolved data effect) yields NONE', () => {
    const ep = restEndpoint('GET /api/orders');
    const eff = dataEffect('GET /api/orders', 'orders');
    const res = scanForSpecificationCoverage([ep, eff]);
    expect(res.inputs).toHaveLength(0);
    expect(res.totalEndpoints).toBe(1);
    expect(res.fullySpecifiedCount).toBe(1);
    expect(res.underSpecifiedCount).toBe(0);
  });
});

// -----------------------------------------------------------------------------
// Scanner -- SOAP bar (parent interface has bound message entities)
// -----------------------------------------------------------------------------

describe('scanForSpecificationCoverage -- SOAP', () => {
  it('under-specified SOAP op (no bound message entities) yields ONE finding', () => {
    const iface = soapInterface('EmployeeService');
    const op = soapEndpoint('GetEmployee', iface.id);
    const res = scanForSpecificationCoverage([iface, op]);
    expect(res.inputs).toHaveLength(1);
    expect(res.inputs[0].detailJson).toEqual({
      gapType: 'soap_operation_missing_message_binding',
    });
    expect(res.inputs[0].links?.[0].targetId).toBe(op.id);
    expect(res.fullySpecifiedCount).toBe(0);
  });

  it('fully-specified SOAP op (interface has interface_logical_entities binding) yields NONE', () => {
    const iface = soapInterface('EmployeeService');
    const op = soapEndpoint('GetEmployee', iface.id);
    const binding = interfaceBinding('EmployeeService', 'GetEmployeeRequest');
    const res = scanForSpecificationCoverage([iface, op, binding]);
    expect(res.inputs).toHaveLength(0);
    expect(res.totalEndpoints).toBe(1);
    expect(res.fullySpecifiedCount).toBe(1);
  });

  it('behaviour is BONUS only -- a REST endpoint with business_logics.behavior but no data effect is STILL under-specified', () => {
    const ep = restEndpoint('POST /api/pay');
    // A business_logics candidate carrying behaviour does NOT satisfy the bar.
    const bl = cand('business_logics', 'PaymentRule', {
      behavior: { inputs: ['amount'], outputs: ['receipt'] },
    });
    const res = scanForSpecificationCoverage([ep, bl]);
    expect(res.inputs).toHaveLength(1);
    expect(res.inputs[0].detailJson).toEqual({ gapType: 'endpoint_missing_data_effect' });
  });
});

// -----------------------------------------------------------------------------
// Run-aggregate rollup -- the per-endpoint count flows through getRunAggregate
// -----------------------------------------------------------------------------

describe('per-endpoint completeness rolls into the run aggregate', () => {
  function makeStubClient(): FindingEmitterArchClient {
    return {
      async createDiscoveryFinding(projectId, runId, payload) {
        return {
          id: 'f-' + Math.random().toString(36).slice(2, 8),
          runId,
          projectId,
          architectureId: 'arch-1',
          findingType: payload.findingType,
          category: payload.category,
          severity: payload.severity,
          confidence: payload.confidence ?? null,
          reviewStatus: payload.reviewStatus ?? 'pending_review',
          previousReviewStatus: null,
          title: payload.title,
          summary: payload.summary ?? null,
          detailJson: payload.detailJson ?? null,
          source: payload.source ?? null,
          createdByStage: payload.createdByStage ?? null,
          createdAt: '2026-05-30T00:00:00Z',
          updatedAt: '2026-05-30T00:00:00Z',
          reviewedAt: null,
          reviewerNotes: null,
          links: [],
        };
      },
      async bulkCreateDiscoveryFindings(projectId, runId, payloads) {
        const out = [];
        for (const payload of payloads) {
          out.push(await this.createDiscoveryFinding(projectId, runId, payload));
        }
        return out;
      },
    };
  }

  it('emitting the under-specified findings surfaces a totalEmitted count on getRunAggregate', async () => {
    // Mixed set: one under-specified REST (no effect), one fully-specified REST
    // (effect present), one under-specified SOAP (no binding). Expect 2 gap
    // findings -> 2 emitted on the aggregate.
    const restBad = restEndpoint('GET /api/a');
    const restGood = restEndpoint('GET /api/b');
    const effGood = dataEffect('GET /api/b', 'b');
    const iface = soapInterface('SvcX');
    const soapBad = soapEndpoint('OpY', iface.id);

    const res = scanForSpecificationCoverage([restBad, restGood, effGood, iface, soapBad]);
    expect(res.totalEndpoints).toBe(3);
    expect(res.fullySpecifiedCount).toBe(1);
    expect(res.underSpecifiedCount).toBe(2);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const emitter = new FindingEmitter(makeStubClient());
      const runContext: FindingEmitRunContext = {
        runId: 'run-spec-1',
        projectId: 'proj-1',
        architectureId: 'arch-1',
      };
      await emitter.emitFindings(runContext, res.inputs);
      const agg = emitter.getRunAggregate('run-spec-1');
      expect(agg).toBeDefined();
      expect(agg?.totalEmitted).toBe(2);
      expect(agg?.totalPersisted).toBe(2);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});
