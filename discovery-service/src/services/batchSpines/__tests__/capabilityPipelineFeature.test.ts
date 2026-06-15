/**
 * Feature-level (cross-component) tests for the D2 batch-spine -> capability
 * pipeline (D2 -- Capability Synthesis + Batch Spines, Task Group 6 gap-fill).
 *
 * Task Groups 2-4 ship focused UNIT tests:
 *   - the JIL parser over an in-memory string (Group 2),
 *   - the `main()` emission over the springClassic adapter (Group 3),
 *   - `runCapabilitySynthesis` over a PRE-PARSED topology map (Group 4).
 *
 * This file fills the two cross-component seams those unit tests do NOT touch:
 *
 *   1. The FEATURE-LEVEL JIL pipeline: `collectJilTopologies` reads a REAL
 *      fixture `.jil` from disk, the synthesis step parses + closes the JIL
 *      DAG, and emits ONE capability whose `detail_json` carries the topology
 *      snapshot AND the typed cross-language `invocations[]` edges, with the
 *      Java candidates resolved into members. (Group 4 hands the step an
 *      already-built `parseJil()` map -- the disk-collect -> parse -> synthesise
 *      seam is otherwise unexercised.) The LLM is MOCKED (no live LLM).
 *
 *   2. The co-location heuristic over the un-orchestrated MULTI-KIND long tail
 *      (Monitoring + Deployment + FTP, NO JIL): each artifactKind bucket seeds
 *      its OWN capability. (Group 4 covers a single monitoring artifact only.)
 *
 * Seams deliberately NOT re-tested here (already covered):
 *   - graceful no-op on zero signals -> Group 4
 *     (`capabilitySynthesisStep.test.ts` "ZERO signals -> no-op");
 *   - `main()`-entrypoint emission end-to-end (run adapter -> `class` + child
 *     `method` candidates) -> Group 3 (`springClassicBatchEntrypoint.test.ts`);
 *   - the AMS capability + member round-trip -> Group 1
 *     (`DiscoveryCapabilityPersistenceTest`);
 *   - the read-only Capabilities UI render -> Group 5
 *     (`CapabilitiesSection.test.tsx`).
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

import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { collectJilTopologies } from '../jilCollector';
import {
  runCapabilitySynthesis,
  type CapabilitySynthesisInput,
} from '../capabilitySynthesisStep';
import type { DiscoveryCandidate } from '../../../types/candidate';

// A real Autosys orchestration: a box that schedules an extract job (which runs
// the RiskExtractJob Java class via a shell command with an -o UPDATE flag) and
// a load job gated on the extract's success.
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

function classCandidate(id: string, simpleName: string, fqcn: string): DiscoveryCandidate {
  return {
    id,
    runId: 'run-feat',
    candidateType: 'class',
    name: simpleName,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: { className: simpleName, fullyQualifiedClass: fqcn, batch_entrypoint: true },
    synthesizedAt: new Date().toISOString(),
  } as DiscoveryCandidate;
}

function methodCandidate(id: string, name: string, parentId: string): DiscoveryCandidate {
  return {
    id,
    runId: 'run-feat',
    candidateType: 'method',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    parentCandidateId: parentId,
    data: {},
    synthesizedAt: new Date().toISOString(),
  } as DiscoveryCandidate;
}

function namingResponse(name: string, kind = 'batch_pipeline', summary = 'A pipeline.') {
  return { content: JSON.stringify({ name, kind, summary }) };
}

describe('D2 batch-spine -> capability feature pipeline (Task Group 6)', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    mockNameCapability.mockReset();
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'd2-jil-feature-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it('feature-level: a real .jil on disk -> collect -> synthesise -> ONE capability with members + topology + invocation edges in detail_json', async () => {
    mockNameCapability.mockResolvedValue(
      namingResponse('Daily Risk Hierarchy Load Pipeline'),
    );

    // Land a REAL .jil file under a nested jobs/ folder so the collector's
    // recursive walk has to find it.
    const jobsDir = path.join(tmpRoot, 'batch', 'jobs');
    await fs.mkdir(jobsDir, { recursive: true });
    await fs.writeFile(path.join(jobsDir, 'risk_hier.jil'), PIPELINE_JIL, 'utf-8');

    // Collect + parse from disk (the seam Group 4 skips).
    const jilTopologies = await collectJilTopologies(tmpRoot);
    expect(jilTopologies.size).toBe(1);
    const [collectedKey] = [...jilTopologies.keys()];
    expect(collectedKey).toContain('risk_hier.jil');

    // The discovered Java candidate (the batch entrypoint) + its main() method.
    const extractClass = classCandidate(
      'cand-extract',
      'RiskExtractJob',
      'com.example.risk.RiskExtractJob',
    );
    const extractMain = methodCandidate('cand-extract-main', 'main', 'cand-extract');

    const input: CapabilitySynthesisInput = {
      runId: 'run-feat',
      candidates: [extractClass, extractMain],
      jilTopologies,
    };

    const out = await runCapabilitySynthesis(input);

    // Exactly one capability for the single box's transitive closure.
    expect(out.seedCount).toBe(1);
    expect(out.payloads).toHaveLength(1);
    const cap = out.payloads[0];

    // The LLM named it (naming-only consumed the mocked response).
    expect(cap.name).toBe('Daily Risk Hierarchy Load Pipeline');
    expect(mockNameCapability).toHaveBeenCalledTimes(1);

    // Members: the class candidate the JIL command resolved to + its child method.
    const memberIds = (cap.members ?? []).map((m) => m.memberId).sort();
    expect(memberIds).toEqual(['cand-extract', 'cand-extract-main'].sort());
    for (const m of cap.members ?? []) {
      expect(m.memberType).toBe('discovery_candidate');
    }

    const detail = cap.detailJson as Record<string, any>;

    // The JIL topology snapshot landed AUTHORITATIVELY in detail_json: the box
    // plus its two child jobs, with the box-member + success-condition edges.
    expect(detail.jilTopology).toBeTruthy();
    expect(detail.jilTopology.boxes).toContain('risk_hier_box');
    expect((detail.jilTopology.jobs as unknown[]).length).toBe(3);
    expect((detail.jilTopology.edges as unknown[]).length).toBeGreaterThanOrEqual(3);

    // The schedule was hoisted off the box.
    expect(detail.schedule).toBeTruthy();
    expect(String(detail.schedule.startTimes)).toContain('06:00');

    // The typed cross-language invocation chain: a STRUCTURAL box-member edge
    // (high confidence) AND an INFERRED java_class edge (lower confidence).
    const edges = detail.invocations as Array<Record<string, any>>;
    const boxEdge = edges.find((e) => e.mechanism === 'jil_box_member');
    const javaEdge = edges.find((e) => e.toKind === 'java_class');
    expect(boxEdge).toBeTruthy();
    expect(javaEdge).toBeTruthy();
    expect(javaEdge!.to).toBe('com.example.risk.RiskExtractJob');
    expect(javaEdge!.confidence).toBeLessThan(boxEdge!.confidence);

    // A condition edge (risk_extract -> risk_load) is present in the DAG.
    expect(
      edges.some(
        (e) => e.mechanism === 'jil_condition' || e.from === 'risk_extract',
      ),
    ).toBe(true);

    // JIL-DAG seeds are the strong, structural band.
    expect(cap.confidence).toBe(0.85);
    expect(detail.behaviourBearing).toBe(true);
  });

  it('co-location: the un-orchestrated MULTI-KIND long tail (monitoring + deployment + ftp, no JIL) -> one capability per kind bucket', async () => {
    // Distinct mocked names per seed, branched on the UNIQUE artifact file path
    // the prompt lists (the kind-options line is identical across prompts, so we
    // must key off the per-seed artifact path, not the kind word). The naming
    // response intentionally omits `kind` so the assertion proves the
    // DETERMINISTIC kindHint (the co-location bucket) is what classifies the
    // capability -- the LLM does not pick the bucket.
    mockNameCapability.mockImplementation(async (prompt: string) => {
      if (prompt.includes('monitoring/geneos.xml')) {
        return { content: JSON.stringify({ name: 'Geneos Monitoring', summary: 'Monitoring.' }) };
      }
      if (prompt.includes('deploy/arm-deploy.sh')) {
        return { content: JSON.stringify({ name: 'ARM Deployment', summary: 'Deploy.' }) };
      }
      return { content: JSON.stringify({ name: 'FTP Ingestion', summary: 'Feed.' }) };
    });

    const out = await runCapabilitySynthesis({
      runId: 'run-feat',
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
        {
          filePath: 'deploy/arm-deploy.sh',
          artifactKind: 'deployment_script',
          behaviourBearing: true,
          invokes: [],
          externalSystems: [],
          purpose: 'ARM deployment script.',
        },
        {
          filePath: 'feeds/ftp-ingest.cfg',
          artifactKind: 'integration_config',
          behaviourBearing: true,
          invokes: [],
          externalSystems: ['TIBCO'],
          purpose: 'TIBCO FTP ingestion feed.',
        },
      ],
    });

    // Three distinct artifactKind buckets -> three capabilities (co-location).
    expect(out.seedCount).toBe(3);
    expect(out.payloads).toHaveLength(3);

    const kinds = out.payloads.map((p) => p.kind).sort();
    expect(kinds).toEqual(['deployment', 'ftp_ingestion', 'monitoring']);

    // Every co-location seed is the heuristic band (lower confidence than JIL).
    for (const p of out.payloads) {
      expect(p.confidence).toBe(0.6);
      const detail = p.detailJson as Record<string, any>;
      expect(detail.seedMode).toBe('colocation');
      // No JIL topology for the un-orchestrated tail.
      expect(detail.jilTopology).toBeNull();
      // The artifact substance rides in detail_json (no AMS finding id yet).
      expect((detail.artifacts as unknown[]).length).toBe(1);
    }

    // Each bucket's external systems are carried on its own capability.
    const monitoring = out.payloads.find((p) => p.kind === 'monitoring')!;
    expect((monitoring.detailJson as Record<string, any>).externalSystems).toContain('Geneos');
    const ftp = out.payloads.find((p) => p.kind === 'ftp_ingestion')!;
    expect((ftp.detailJson as Record<string, any>).externalSystems).toContain('TIBCO');
  });
});
