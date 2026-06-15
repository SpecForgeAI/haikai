/**
 * Tests for the capability-synthesis step (D2, Task Group 4 / Decisions D2,
 * D7, D8, D9).
 *
 * Membership is DETERMINISTIC; the LLM is NAMING-ONLY. The gatewayClient is
 * MOCKED -- NO live LLM. Coverage is focused (D12):
 *  - a JIL-DAG transitive closure produces ONE seed -> ONE capability with its
 *    candidate members + the JIL topology snapshot + the invocation edges in
 *    `detail_json`;
 *  - the LLM names/summarises/classifies but NEVER changes membership (the same
 *    seed with a different mocked name keeps identical members);
 *  - a co-location heuristic seeds an un-orchestrated operational artifact;
 *  - ZERO signals -> a no-op (no capabilities, no error);
 *  - the source-hash cache skips the LLM on an unchanged seed.
 */

// --- Mock the gateway relay BEFORE importing the step (the LLM-guard). ------
const mockNameCapability = jest.fn();
jest.mock('../../gatewayClient', () => {
  const actual = jest.requireActual('../../gatewayClient');
  return {
    ...actual,
    gatewayClient: {
      nameCapability: (...args: unknown[]) => mockNameCapability(...args),
    },
  };
});

import {
  runCapabilitySynthesis,
  computeSeedHash,
  type CapabilitySynthesisInput,
  type CapabilityNamingCacheEntry,
} from '../capabilitySynthesisStep';
import { parseJil } from '../jilParser';
import type { DiscoveryCandidate } from '../../../types/candidate';

function classCandidate(id: string, simpleName: string, fqcn: string): DiscoveryCandidate {
  return {
    id,
    runId: 'run-1',
    candidateType: 'class',
    name: simpleName,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: { className: simpleName, fullyQualifiedClass: fqcn, batch_entrypoint: true, operations: ['UPDATE'] },
    synthesizedAt: new Date().toISOString(),
  } as DiscoveryCandidate;
}

function methodCandidate(id: string, name: string, parentId: string): DiscoveryCandidate {
  return {
    id,
    runId: 'run-1',
    candidateType: 'method',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    parentCandidateId: parentId,
    data: { isMain: name === 'main', batchEntrypointMethod: true },
    synthesizedAt: new Date().toISOString(),
  } as DiscoveryCandidate;
}

const PIPELINE_JIL = `
insert_job: risk_hier_box   job_type: b
machine: batchhost01
start_times: "06:00"
days_of_week: mo,tu,we,th,fr

insert_job: risk_extract   job_type: c
box_name: risk_hier_box
command: /opt/risk/bin/run.sh com.example.risk.RiskExtractJob -o UPDATE

insert_job: risk_load   job_type: c
box_name: risk_hier_box
command: /opt/risk/bin/load.sh
condition: success(risk_extract)
`;

function namingResponse(name: string, kind = 'batch_pipeline', summary = 'A pipeline.') {
  return { content: JSON.stringify({ name, kind, summary }) };
}

describe('runCapabilitySynthesis (D2, Task Group 4)', () => {
  beforeEach(() => {
    mockNameCapability.mockReset();
  });

  it('JIL-DAG transitive closure -> ONE capability with members + topology + edges in detail_json', async () => {
    mockNameCapability.mockResolvedValue(namingResponse('Daily Risk Hierarchy Load Pipeline'));

    const extractClass = classCandidate('cand-extract', 'RiskExtractJob', 'com.example.risk.RiskExtractJob');
    const extractMain = methodCandidate('cand-extract-main', 'main', 'cand-extract');

    const input: CapabilitySynthesisInput = {
      runId: 'run-1',
      candidates: [extractClass, extractMain],
      jilTopologies: new Map([['jobs/risk.jil', parseJil(PIPELINE_JIL)]]),
    };

    const out = await runCapabilitySynthesis(input);

    // Exactly one seed/capability for the single box's closure.
    expect(out.seedCount).toBe(1);
    expect(out.payloads).toHaveLength(1);
    const cap = out.payloads[0];

    // The LLM named it (naming-only).
    expect(cap.name).toBe('Daily Risk Hierarchy Load Pipeline');
    expect(cap.kind).toBe('batch_pipeline');

    // Members: the class candidate the JIL command resolved to + its child method.
    const memberIds = (cap.members ?? []).map((m) => m.memberId).sort();
    expect(memberIds).toEqual(['cand-extract', 'cand-extract-main'].sort());
    for (const m of cap.members ?? []) {
      expect(m.memberType).toBe('discovery_candidate');
    }

    // detail_json carries the JIL topology snapshot + the invocation edges.
    const detail = cap.detailJson as Record<string, any>;
    expect(detail.jilTopology).toBeTruthy();
    expect(detail.jilTopology.edges.length).toBeGreaterThan(0);
    expect(detail.schedule).toBeTruthy();
    expect(detail.schedule.startTimes).toContain('06:00');

    // A structural box-member edge AND an inferred java_class edge are present.
    const edges = detail.invocations as Array<Record<string, any>>;
    expect(edges.some((e) => e.mechanism === 'jil_box_member')).toBe(true);
    const javaEdge = edges.find((e) => e.toKind === 'java_class');
    expect(javaEdge).toBeTruthy();
    expect(javaEdge!.to).toBe('com.example.risk.RiskExtractJob');
    // Inferred java edge confidence is lower than the structural box-member edge.
    const boxEdge = edges.find((e) => e.mechanism === 'jil_box_member');
    expect(javaEdge!.confidence).toBeLessThan(boxEdge!.confidence);

    // behaviourBearing aggregate seam is present.
    expect(detail.behaviourBearing).toBe(true);
  });

  it('LLM is naming-only: a different mocked name does NOT change deterministic membership', async () => {
    const extractClass = classCandidate('cand-extract', 'RiskExtractJob', 'com.example.risk.RiskExtractJob');
    const input: CapabilitySynthesisInput = {
      runId: 'run-1',
      candidates: [extractClass],
      jilTopologies: new Map([['jobs/risk.jil', parseJil(PIPELINE_JIL)]]),
    };

    mockNameCapability.mockResolvedValueOnce(namingResponse('Name A'));
    const a = await runCapabilitySynthesis(input);

    mockNameCapability.mockResolvedValueOnce(namingResponse('Completely Different Name B', 'monitoring'));
    const b = await runCapabilitySynthesis(input);

    // Names differ (LLM-driven)...
    expect(a.payloads[0].name).toBe('Name A');
    expect(b.payloads[0].name).toBe('Completely Different Name B');
    // ...but membership is identical (deterministic), regardless of the LLM output.
    const aMembers = (a.payloads[0].members ?? []).map((m) => m.memberId).sort();
    const bMembers = (b.payloads[0].members ?? []).map((m) => m.memberId).sort();
    expect(aMembers).toEqual(bMembers);
    expect(aMembers).toEqual(['cand-extract']);
    // The mocked naming response was consumed (LLM was actually called).
    expect(mockNameCapability).toHaveBeenCalled();
  });

  it('co-location heuristic seeds an un-orchestrated operational artifact (no JIL)', async () => {
    mockNameCapability.mockResolvedValue(namingResponse('Geneos Monitoring', 'monitoring'));

    const input: CapabilitySynthesisInput = {
      runId: 'run-1',
      candidates: [],
      operationalArtifacts: [
        {
          filePath: 'monitoring/geneos.xml',
          artifactKind: 'monitoring_config',
          behaviourBearing: true,
          invokes: [],
          externalSystems: ['Geneos'],
          purpose: 'Geneos monitoring gateway config.',
        },
      ],
    };

    const out = await runCapabilitySynthesis(input);

    expect(out.seedCount).toBe(1);
    const cap = out.payloads[0];
    expect(cap.name).toBe('Geneos Monitoring');
    expect(cap.kind).toBe('monitoring');
    // co-location seeds are heuristic -> lower confidence than JIL-DAG seeds.
    expect(cap.confidence).toBe(0.6);
    // The artifact substance rides in detail_json (no AMS finding id yet).
    const detail = cap.detailJson as Record<string, any>;
    expect(detail.seedMode).toBe('colocation');
    expect(detail.artifacts).toHaveLength(1);
    expect(detail.artifacts[0].filePath).toBe('monitoring/geneos.xml');
    expect(detail.externalSystems).toContain('Geneos');
  });

  it('ZERO signals -> no-op (no capabilities emitted, no error, LLM never called) [D9]', async () => {
    const out = await runCapabilitySynthesis({ runId: 'run-1', candidates: [] });
    expect(out.seedCount).toBe(0);
    expect(out.payloads).toEqual([]);
    expect(mockNameCapability).not.toHaveBeenCalled();
  });

  it('source-hash cache: an unchanged seed skips the LLM and reuses the prior name', async () => {
    const extractClass = classCandidate('cand-extract', 'RiskExtractJob', 'com.example.risk.RiskExtractJob');
    const input: CapabilitySynthesisInput = {
      runId: 'run-1',
      candidates: [extractClass],
      jilTopologies: new Map([['jobs/risk.jil', parseJil(PIPELINE_JIL)]]),
    };

    // First run: LLM is called and the cache is populated in place.
    mockNameCapability.mockResolvedValueOnce(namingResponse('Cached Pipeline Name'));
    const cache = new Map<string, CapabilityNamingCacheEntry>();
    const first = await runCapabilitySynthesis(input, cache);
    expect(first.namedByLlm).toBe(1);
    expect(mockNameCapability).toHaveBeenCalledTimes(1);

    // The cache now holds the entry keyed by the seed's source hash.
    expect(cache.size).toBe(1);

    // Second run with the SAME cache + unchanged seed: the LLM is NOT called.
    mockNameCapability.mockClear();
    const second = await runCapabilitySynthesis(input, cache);
    expect(mockNameCapability).not.toHaveBeenCalled();
    expect(second.cacheHits).toBe(1);
    expect(second.payloads[0].name).toBe('Cached Pipeline Name');
  });

  it('naming-only LLM failure is non-fatal: falls back to a deterministic name', async () => {
    mockNameCapability.mockRejectedValue(new Error('gateway down'));

    const extractClass = classCandidate('cand-extract', 'RiskExtractJob', 'com.example.risk.RiskExtractJob');
    const out = await runCapabilitySynthesis({
      runId: 'run-1',
      candidates: [extractClass],
      jilTopologies: new Map([['jobs/risk.jil', parseJil(PIPELINE_JIL)]]),
    });

    expect(out.namingFailures).toBe(1);
    expect(out.payloads).toHaveLength(1);
    // Deterministic fallback name is used; membership is still present.
    expect(out.payloads[0].name.length).toBeGreaterThan(0);
    expect((out.payloads[0].members ?? []).length).toBeGreaterThan(0);
  });

  it('computeSeedHash is stable for an identical seed and busts on membership change', () => {
    const base = classCandidate('cand-extract', 'RiskExtractJob', 'com.example.risk.RiskExtractJob');
    const topo = new Map([['jobs/risk.jil', parseJil(PIPELINE_JIL)]]);

    // Build seeds indirectly by running synthesis twice and hashing nothing
    // directly — instead exercise determinism via the public output stability.
    // (computeSeedHash is unit-checked here for the member-change bust.)
    const seedA = {
      seedKey: 'jil:x',
      mode: 'jil_dag' as const,
      candidateMemberIds: ['a', 'b'],
      artifacts: [],
      invocations: [],
      externalSystems: [],
      behaviourBearing: true,
      fallbackName: 'X',
      kindHint: 'batch_pipeline',
    };
    const seedB = { ...seedA, candidateMemberIds: ['a', 'b', 'c'] };
    expect(computeSeedHash(seedA)).toBe(computeSeedHash(seedA));
    expect(computeSeedHash(seedA)).not.toBe(computeSeedHash(seedB));
    void base;
    void topo;
  });
});
