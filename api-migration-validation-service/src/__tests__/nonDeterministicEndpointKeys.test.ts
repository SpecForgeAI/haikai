/**
 * nonDeterministicEndpointKeys bridge tests.
 *
 * Spec: 2026-06-16 Reconcile-Time Determinism & Volatile-Value Handling --
 * FU-1.
 *
 * Asserts the finding -> `${METHOD}|${path}` bridge that populates the diff
 * runner's `nonDeterministicEndpointKeys` seam:
 *
 *   1. A `non_deterministic_endpoint` finding (evidence_gap +
 *      detail.gapType) that `supports`-links to an endpoints candidate with a
 *      concrete route -> the matching source item's concrete operation key is
 *      in the set, keyed EXACTLY as the diff runner keys it.
 *   2. A templated candidate route (`/widgets/{id}`) matches the concrete
 *      captured path (`/widgets/42`) and emits the CONCRETE key.
 *   3. An UNRESOLVED finding (no candidate link / candidate missing / no
 *      route / no matching source item) -> DROPPED, no key, strict.
 *   4. No `non_deterministic_endpoint` findings -> empty set (strict, today's
 *      behaviour).
 *   5. Fail-soft: an AMS read error -> empty set (degrade to strict, never a
 *      wrong tolerance).
 */

import { resolveNonDeterministicEndpointKeys } from '../services/nonDeterministicEndpointKeys';
import type {
  BaselineItemDto,
  DiscoveryCandidateDto,
  DiscoveryFindingDto,
  DiscoveryRunSummaryDto,
} from '../services/archModelClient';

const PROJECT_ID = '00000000-0000-0000-0000-0000000000aa';
const ARCH_ID = '00000000-0000-0000-0000-0000000000bb';
const RUN_ID = '00000000-0000-0000-0000-0000000000cc';

function sourceItem(opts: {
  id: string;
  method: string;
  path: string;
}): BaselineItemDto {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    baseline_id: 'b1',
    capture_id: `cap-${opts.id}`,
    operation_id: `op-${opts.id}`,
    scenario_id: `scen-${opts.id}`,
    method: opts.method,
    path: opts.path,
    scenario_name: 'happy_path',
    request_json: null,
    response_status: 200,
    response_json: {},
    business_notes: null,
    volatile_paths_json: null,
    created_at: now,
    updated_at: now,
  };
}

function ndFinding(opts: {
  id: string;
  candidateId?: string | null;
}): DiscoveryFindingDto {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    run_id: RUN_ID,
    api_behaviour_diff_id: null,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    finding_type: 'evidence_gap',
    category: 'migration_risk',
    severity: 'medium',
    confidence: null,
    status: 'new',
    title: 'Non-deterministic endpoint',
    summary: null,
    detail_json: { gapType: 'non_deterministic_endpoint', endpoint: 'X#y' },
    source: 'pipeline_evidence_gap',
    created_by_stage: 'findings.nonDeterministicEndpointScanner',
    created_at: now,
    updated_at: now,
    reviewed_at: null,
    reviewer_notes: null,
    links:
      opts.candidateId === null
        ? []
        : [
            {
              id: `link-${opts.id}`,
              finding_id: opts.id,
              link_type: 'supports',
              target_type: 'discovery_candidate',
              target_id: opts.candidateId ?? 'cand-1',
              label: null,
              created_at: now,
            },
          ],
  };
}

function endpointCandidate(opts: {
  id: string;
  httpMethod?: string;
  fullPath?: string;
  name?: string;
}): DiscoveryCandidateDto {
  return {
    id: opts.id,
    run_id: RUN_ID,
    candidate_type: 'endpoints',
    name: opts.name ?? `${opts.httpMethod ?? 'GET'} ${opts.fullPath ?? '/'}`,
    data: {
      ...(opts.httpMethod ? { httpMethod: opts.httpMethod } : {}),
      ...(opts.fullPath ? { fullPath: opts.fullPath } : {}),
    },
  };
}

const RUN: DiscoveryRunSummaryDto = {
  id: RUN_ID,
  project_id: PROJECT_ID,
  architecture_id: ARCH_ID,
  status: 'COMPLETED',
  discovery_kind: 'code',
};

function buildClient(opts: {
  runs?: DiscoveryRunSummaryDto[];
  findings?: DiscoveryFindingDto[];
  candidates?: DiscoveryCandidateDto[];
  runsThrows?: boolean;
}) {
  return {
    listDiscoveryRuns: jest.fn(async () => {
      if (opts.runsThrows) throw new Error('AMS down');
      return opts.runs ?? [RUN];
    }),
    listFindingsForRun: jest.fn(async () => opts.findings ?? []),
    listCandidatesForRun: jest.fn(async () => opts.candidates ?? []),
  };
}

test('1. finding -> candidate concrete route -> matching source key is in the set', async () => {
  const items = [
    sourceItem({ id: 's1', method: 'GET', path: '/widget' }),
    sourceItem({ id: 's2', method: 'GET', path: '/other' }),
  ];
  const client = buildClient({
    findings: [ndFinding({ id: 'f1', candidateId: 'cand-1' })],
    candidates: [
      endpointCandidate({ id: 'cand-1', httpMethod: 'GET', fullPath: '/widget' }),
    ],
  });

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: client as any },
  );

  // Keyed EXACTLY as diffRunner.operationKey -> `${METHOD}|${path}`.
  expect([...keys]).toEqual(['GET|/widget']);
});

test('2. templated candidate route matches the concrete captured path -> concrete key', async () => {
  const items = [sourceItem({ id: 's1', method: 'GET', path: '/widgets/42' })];
  const client = buildClient({
    findings: [ndFinding({ id: 'f1', candidateId: 'cand-1' })],
    candidates: [
      endpointCandidate({
        id: 'cand-1',
        httpMethod: 'GET',
        fullPath: '/widgets/{id}',
      }),
    ],
  });

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: client as any },
  );

  // The CONCRETE captured path is emitted (not the template).
  expect([...keys]).toEqual(['GET|/widgets/42']);
});

test('3a. unresolved finding (no candidate link) -> dropped, no key', async () => {
  const items = [sourceItem({ id: 's1', method: 'GET', path: '/widget' })];
  const client = buildClient({
    findings: [ndFinding({ id: 'f1', candidateId: null })],
    candidates: [
      endpointCandidate({ id: 'cand-1', httpMethod: 'GET', fullPath: '/widget' }),
    ],
  });

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: client as any },
  );

  expect(keys.size).toBe(0);
});

test('3b. unresolved finding (candidate missing in run) -> dropped, no key', async () => {
  const items = [sourceItem({ id: 's1', method: 'GET', path: '/widget' })];
  const client = buildClient({
    findings: [ndFinding({ id: 'f1', candidateId: 'cand-MISSING' })],
    candidates: [], // candidate not found
  });

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: client as any },
  );

  expect(keys.size).toBe(0);
});

test('3c. unresolved finding (no route on candidate) -> dropped, no key', async () => {
  const items = [sourceItem({ id: 's1', method: 'GET', path: '/widget' })];
  const client = buildClient({
    findings: [ndFinding({ id: 'f1', candidateId: 'cand-1' })],
    // candidate with neither route slots nor a usable name
    candidates: [{ id: 'cand-1', run_id: RUN_ID, candidate_type: 'endpoints', name: 'noisy name', data: {} }],
  });

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: client as any },
  );

  expect(keys.size).toBe(0);
});

test('3d. resolved route that matches NO source item -> dropped, no key', async () => {
  const items = [sourceItem({ id: 's1', method: 'GET', path: '/widget' })];
  const client = buildClient({
    findings: [ndFinding({ id: 'f1', candidateId: 'cand-1' })],
    candidates: [
      endpointCandidate({ id: 'cand-1', httpMethod: 'POST', fullPath: '/unrelated' }),
    ],
  });

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: client as any },
  );

  expect(keys.size).toBe(0);
});

test('4. no non_deterministic findings -> empty set (strict, today)', async () => {
  const items = [sourceItem({ id: 's1', method: 'GET', path: '/widget' })];
  const otherFinding: DiscoveryFindingDto = {
    ...ndFinding({ id: 'f1', candidateId: 'cand-1' }),
    detail_json: { gapType: 'something_else' },
  };
  const client = buildClient({
    findings: [otherFinding],
    candidates: [
      endpointCandidate({ id: 'cand-1', httpMethod: 'GET', fullPath: '/widget' }),
    ],
  });

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: client as any },
  );

  expect(keys.size).toBe(0);
  // Candidate fetch is skipped entirely when no nd finding exists.
  expect(client.listCandidatesForRun).not.toHaveBeenCalled();
});

test('5. fail-soft: a discovery-read error degrades to strict (empty set)', async () => {
  const items = [sourceItem({ id: 's1', method: 'GET', path: '/widget' })];
  const client = buildClient({ runsThrows: true });

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: client as any },
  );

  expect(keys.size).toBe(0);
});

test('candidate name fallback (`"VERB /path"`) resolves when data slots absent', async () => {
  const items = [sourceItem({ id: 's1', method: 'DELETE', path: '/widget/7' })];
  const client = buildClient({
    findings: [ndFinding({ id: 'f1', candidateId: 'cand-1' })],
    candidates: [
      // No data route slots; name carries the route.
      { id: 'cand-1', run_id: RUN_ID, candidate_type: 'endpoints', name: 'DELETE /widget/{id}', data: {} },
    ],
  });

  const keys = await resolveNonDeterministicEndpointKeys(
    PROJECT_ID,
    ARCH_ID,
    items,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { archModelClient: client as any },
  );

  expect([...keys]).toEqual(['DELETE|/widget/7']);
});
