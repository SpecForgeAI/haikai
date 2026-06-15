/**
 * Tests for the invocation-linkage resolver (D2, Task Group 4 / Decision D8).
 *
 * The resolver reconstructs the JIL -> shell -> Java -> DB chain as typed
 * `invocations[]` edges that live INSIDE capability `detail_json`. Coverage is
 * focused (D12):
 *  - structural JIL DAG edges (box-member / condition) carry HIGH confidence;
 *  - an inferred edge resolves a command / `invokes` string to a discovered Java
 *    candidate by FQCN AND by simple name, at a LOWER confidence;
 *  - an unresolved `invokes` string is still recorded (lowest band) and tagged
 *    by node kind (database / shell / external);
 *  - the resolver mints NO candidates and returns `[]` on empty input (D9).
 */

import {
  resolveInvocationLinkage,
  STRUCTURAL_EDGE_CONFIDENCE,
  INFERRED_EDGE_CONFIDENCE,
  UNRESOLVED_EDGE_CONFIDENCE,
} from '../invocationLinkage';
import { parseJil } from '../jilParser';
import type { DiscoveryCandidate } from '../../../types/candidate';

function classCandidate(
  id: string,
  simpleName: string,
  fqcn: string,
): DiscoveryCandidate {
  return {
    id,
    runId: 'run-1',
    candidateType: 'class',
    name: simpleName,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: { className: simpleName, fullyQualifiedClass: fqcn, batch_entrypoint: true },
    synthesizedAt: new Date().toISOString(),
  } as DiscoveryCandidate;
}

const JIL = `
insert_job: risk_box   job_type: b
start_times: "06:00"

insert_job: risk_extract   job_type: c
box_name: risk_box
command: /opt/risk/bin/run.sh com.example.risk.RiskExtractJob -o UPDATE

insert_job: risk_load   job_type: c
box_name: risk_box
command: /opt/risk/bin/load.sh
condition: success(risk_extract)
`;

describe('resolveInvocationLinkage (D2, Task Group 4, D8)', () => {
  it('emits structural JIL DAG edges (box-member + condition) at HIGH confidence', () => {
    const topology = parseJil(JIL);
    const edges = resolveInvocationLinkage({ topology });

    const boxMember = edges.find(
      (e) => e.mechanism === 'jil_box_member' && e.from === 'risk_box' && e.to === 'risk_extract',
    );
    expect(boxMember).toBeDefined();
    expect(boxMember!.fromKind).toBe('jil_box');
    expect(boxMember!.confidence).toBe(STRUCTURAL_EDGE_CONFIDENCE);

    const condition = edges.find(
      (e) => e.mechanism === 'jil_condition' && e.from === 'risk_extract' && e.to === 'risk_load',
    );
    expect(condition).toBeDefined();
    expect(condition!.confidence).toBe(STRUCTURAL_EDGE_CONFIDENCE);
    // Structural edges must out-rank inferred ones.
    expect(STRUCTURAL_EDGE_CONFIDENCE).toBeGreaterThan(INFERRED_EDGE_CONFIDENCE);
  });

  it('resolves a JIL command to a discovered Java candidate by FQCN at LOWER confidence', () => {
    const topology = parseJil(JIL);
    const java = [classCandidate('cand-extract', 'RiskExtractJob', 'com.example.risk.RiskExtractJob')];
    const edges = resolveInvocationLinkage({ topology, javaCandidates: java });

    const javaEdge = edges.find(
      (e) => e.mechanism === 'jil_command' && e.toKind === 'java_class',
    );
    expect(javaEdge).toBeDefined();
    // FQCN target preferred when known.
    expect(javaEdge!.to).toBe('com.example.risk.RiskExtractJob');
    expect(javaEdge!.from).toBe('risk_extract');
    expect(javaEdge!.confidence).toBe(INFERRED_EDGE_CONFIDENCE);
    expect(javaEdge!.confidence).toBeLessThan(STRUCTURAL_EDGE_CONFIDENCE);
  });

  it('resolves an operational-artifact `invokes` string to a Java candidate by SIMPLE name', () => {
    const java = [classCandidate('cand-load', 'RiskLoaderJob', 'com.example.risk.RiskLoaderJob')];
    const edges = resolveInvocationLinkage({
      javaCandidates: java,
      operationalArtifacts: [
        {
          filePath: 'bin/load.sh',
          // Bare simple name (no package) — must still resolve.
          invokes: ['java RiskLoaderJob -o ARCHIVE'],
          artifactKind: 'shell_script',
        },
      ],
    });

    const inferred = edges.find((e) => e.mechanism === 'shell_invokes' && e.toKind === 'java_class');
    expect(inferred).toBeDefined();
    expect(inferred!.to).toBe('com.example.risk.RiskLoaderJob');
    expect(inferred!.from).toBe('bin/load.sh');
    expect(inferred!.confidence).toBe(INFERRED_EDGE_CONFIDENCE);
  });

  it('records an UNRESOLVED `invokes` string at the lowest band, tagged by node kind', () => {
    const edges = resolveInvocationLinkage({
      operationalArtifacts: [
        {
          filePath: 'bin/reconcile.sh',
          invokes: ['INSERT INTO risk_db.positions', 'downstream_publish.sh', 'TIBCO.RISK.TOPIC'],
          artifactKind: 'shell_script',
        },
      ],
    });

    const db = edges.find((e) => e.to === 'INSERT INTO risk_db.positions');
    expect(db).toBeDefined();
    expect(db!.toKind).toBe('database');
    expect(db!.mechanism).toBe('invokes');
    expect(db!.confidence).toBe(UNRESOLVED_EDGE_CONFIDENCE);

    const shell = edges.find((e) => e.to === 'downstream_publish.sh');
    expect(shell!.toKind).toBe('shell');

    const ext = edges.find((e) => e.to === 'TIBCO.RISK.TOPIC');
    expect(ext!.toKind).toBe('external');

    // Inferred / unresolved edges must never out-rank structural ones.
    expect(UNRESOLVED_EDGE_CONFIDENCE).toBeLessThan(INFERRED_EDGE_CONFIDENCE);
  });

  it('returns [] on empty input (D9 — no signals, no edges, no candidates minted)', () => {
    expect(resolveInvocationLinkage({})).toEqual([]);
  });
});
