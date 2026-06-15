/**
 * TransitiveDependencyWalker tests.
 *
 * Spec 2026-05-06 Library Discovery Integration — Task Group 3.
 *
 * Walker uses a mocked WalkerArchClient so tests don't depend on the
 * real architecture-model-service. The mocked client materializes
 * sequential ids deterministically and records every call.
 */

import * as path from 'path';
import {
  planLibraryScan,
  WalkerArchClient,
  WalkerLibraryPayload,
  WalkerLibraryResult,
  WalkerEdgePayload,
  WalkerRootEntity,
} from '../../services/transitiveDependencyWalker';
import { buildRepoLookupTable } from '../../services/repoLookupTableBuilder';
import { clearRegistry, registerDependencyResolver } from '../../services/dependencyResolverRegistry';
import { mavenDependencyResolver } from '../../services/dependencyResolvers/maven/MavenDependencyResolver';
import { npmDependencyResolver } from '../../services/dependencyResolvers/npm/NpmDependencyResolver';

const FIX_ROOT = path.join(__dirname, '..', 'fixtures', 'dependencyResolvers');

/** Builds a deterministic in-memory mock client. */
function buildMockClient(opts: {
  preExistingLibraryIdsByName?: Map<string, string>;
}): {
  client: WalkerArchClient;
  libraryCalls: WalkerLibraryPayload[];
  edgeCalls: WalkerEdgePayload[];
} {
  const libraryCalls: WalkerLibraryPayload[] = [];
  const edgeCalls: WalkerEdgePayload[] = [];
  const preExisting = opts.preExistingLibraryIdsByName ?? new Map();

  const seenLibraries = new Map<string, string>();
  let nextLibSeq = 1;
  let nextApSeq = 1;
  let nextEdgeSeq = 1;

  const client: WalkerArchClient = {
    async findOrCreateLibrary(payload: WalkerLibraryPayload): Promise<WalkerLibraryResult> {
      libraryCalls.push(payload);
      const key = `${payload.ecosystem}::${payload.name}`;
      const existing = seenLibraries.get(key) ?? preExisting.get(payload.name);
      if (existing) {
        return {
          library_id: existing,
          application_point_id: `ap-${existing}`,
          is_new: false,
        };
      }
      const newId = `lib-${nextLibSeq++}`;
      seenLibraries.set(key, newId);
      return {
        library_id: newId,
        application_point_id: `ap-${nextApSeq++}`,
        is_new: true,
      };
    },
    async findOrCreateCodeUnitDependency(payload: WalkerEdgePayload) {
      edgeCalls.push(payload);
      return { id: `edge-${nextEdgeSeq++}`, is_new: true };
    },
  };

  return { client, libraryCalls, edgeCalls };
}

describe('planLibraryScan (transitiveDependencyWalker)', () => {
  beforeEach(() => {
    clearRegistry();
    registerDependencyResolver(mavenDependencyResolver);
    registerDependencyResolver(npmDependencyResolver);
  });

  afterAll(() => {
    clearRegistry();
  });

  it('detects cycles: edge recorded with skipped-cycle status; target not re-walked', async () => {
    const repoRoot = path.join(FIX_ROOT, 'walker-cycle');
    const lookup = await buildRepoLookupTable(repoRoot);

    const root: WalkerRootEntity = {
      kind: 'library',
      id: 'root-id',
      libraryId: 'root-lib-id',
      applicationPointId: 'root-ap-id',
      name: 'com.example:lib-root',
      ecosystem: 'MAVEN',
      repo_location: 'local',
      repo_subfolder: 'lib-root',
    };

    const { client, libraryCalls, edgeCalls } = buildMockClient({});
    const plan = await planLibraryScan(root, repoRoot, lookup, false, client);

    // Internal deps walked: lib-a (depth 1, new), lib-b (depth 2, new),
    // and the cycle edge lib-b -> lib-a (depth 3, skipped-cycle).
    const statuses = plan.internalLibrariesToScan.map((e) => `${e.name}#${e.depth}=${e.status}`);
    expect(statuses).toContain('com.example:lib-a#1=new');
    expect(statuses).toContain('com.example:lib-b#2=new');
    expect(statuses).toContain('com.example:lib-a#3=skipped-cycle');

    // A cycle warning must be emitted.
    expect(plan.warnings.some((w) => w.type === 'cycle')).toBe(true);

    // Edge for the cycle is recorded — find-or-create on the edge happens
    // for every internal classification (including the cycle).
    expect(edgeCalls.length).toBeGreaterThanOrEqual(3);
    // Library find-or-create called for lib-a TWICE (once for the new entry,
    // once when re-encountered via cycle) and for lib-b ONCE.
    const libACalls = libraryCalls.filter((p) => p.name === 'com.example:lib-a');
    expect(libACalls.length).toBe(2);
  });

  it('honours depth cap = 5: depth-5 outgoing edge marked skipped-depth-cap, depth-6 NOT walked', async () => {
    const repoRoot = path.join(FIX_ROOT, 'walker-depth');
    const lookup = await buildRepoLookupTable(repoRoot);

    const root: WalkerRootEntity = {
      kind: 'library',
      id: 'root-id',
      libraryId: 'root-lib-id',
      applicationPointId: 'root-ap-id',
      name: 'com.example:lib-0',
      ecosystem: 'MAVEN',
      repo_location: 'local',
      repo_subfolder: 'lib-0',
    };

    const { client } = buildMockClient({});
    const plan = await planLibraryScan(root, repoRoot, lookup, false, client);

    // Depths 1..5 should be walked normally; depth 6 should be skipped-depth-cap.
    const lib6Entry = plan.internalLibrariesToScan.find((e) => e.name === 'com.example:lib-6');
    expect(lib6Entry).toBeDefined();
    expect(lib6Entry!.depth).toBe(6);
    expect(lib6Entry!.status).toBe('skipped-depth-cap');

    // No internal entry should have a depth > 6 (we only ever record the
    // boundary edge, never the next level out).
    const maxDepth = Math.max(...plan.internalLibrariesToScan.map((e) => e.depth));
    expect(maxDepth).toBe(6);

    // Depth-cap warning must be emitted.
    expect(plan.warnings.some((w) => w.type === 'depth-cap')).toBe(true);
  });

  it('scope filter: test/provided edges recorded but never enqueued', async () => {
    const repoRoot = path.join(FIX_ROOT, 'walker-scopes');
    const lookup = await buildRepoLookupTable(repoRoot);

    const root: WalkerRootEntity = {
      kind: 'library',
      id: 'root-id',
      libraryId: 'root-lib-id',
      applicationPointId: 'root-ap-id',
      name: 'com.example:lib-root',
      ecosystem: 'MAVEN',
      repo_location: 'local',
      repo_subfolder: 'lib-root',
    };

    const { client } = buildMockClient({});
    const plan = await planLibraryScan(root, repoRoot, lookup, false, client);

    // 3 entries — one per declared internal dep; depth = 1 for all.
    expect(plan.internalLibrariesToScan).toHaveLength(3);
    for (const e of plan.internalLibrariesToScan) {
      expect(e.depth).toBe(1);
    }

    // Status: lib-compile is 'new', lib-test/lib-provided are 'new' (their
    // edges are recorded as new — they're not re-walked but they ARE
    // materialized).
    const names = plan.internalLibrariesToScan.map((e) => e.name).sort();
    expect(names).toEqual([
      'com.example:lib-compile',
      'com.example:lib-provided',
      'com.example:lib-test',
    ]);
  });

  it('classifies internal vs external vs unresolvable-internal correctly', async () => {
    const repoRoot = path.join(FIX_ROOT, 'walker-mixed');
    const lookup = await buildRepoLookupTable(repoRoot);

    const root: WalkerRootEntity = {
      kind: 'library',
      id: 'root-id',
      libraryId: 'root-lib-id',
      applicationPointId: 'root-ap-id',
      name: 'com.example:lib-root',
      ecosystem: 'MAVEN',
      repo_location: 'local',
      repo_subfolder: 'lib-root',
    };

    // includeExternal=true: external + unresolvable-internal both recorded.
    const { client } = buildMockClient({});
    const plan = await planLibraryScan(root, repoRoot, lookup, true, client);

    // Internal scannable: internal-lib (com.example:internal-lib).
    const internalNames = plan.internalLibrariesToScan.map((e) => e.name);
    expect(internalNames).toContain('com.example:internal-lib');

    // External: org.springframework:spring-core AND com.example:missing-internal
    // (treated as external because not in lookup).
    const externalNames = plan.externalLibrariesToRecord.map((e) => e.name);
    expect(externalNames).toContain('org.springframework:spring-core');
    expect(externalNames).toContain('com.example:missing-internal');

    // Warning emitted for the unresolvable-internal.
    expect(plan.warnings.some((w) => w.type === 'unresolvable-internal')).toBe(true);
  });

  it('includeExternal=false: external libs entirely skipped (no library / edge calls)', async () => {
    const repoRoot = path.join(FIX_ROOT, 'walker-mixed');
    const lookup = await buildRepoLookupTable(repoRoot);

    const root: WalkerRootEntity = {
      kind: 'library',
      id: 'root-id',
      libraryId: 'root-lib-id',
      applicationPointId: 'root-ap-id',
      name: 'com.example:lib-root',
      ecosystem: 'MAVEN',
      repo_location: 'local',
      repo_subfolder: 'lib-root',
    };

    const { client, libraryCalls, edgeCalls } = buildMockClient({});
    const plan = await planLibraryScan(root, repoRoot, lookup, false, client);

    // No external entries recorded.
    expect(plan.externalLibrariesToRecord).toHaveLength(0);

    // Spring-core should NEVER be passed to findOrCreateLibrary because
    // includeExternal=false skips externals entirely (no Library row, no edge).
    const springCalls = libraryCalls.filter((p) => p.name === 'org.springframework:spring-core');
    expect(springCalls).toHaveLength(0);
    const missingCalls = libraryCalls.filter((p) => p.name === 'com.example:missing-internal');
    expect(missingCalls).toHaveLength(0);

    // Warning still emitted for the unresolvable-internal even when external is off.
    expect(plan.warnings.some((w) => w.type === 'unresolvable-internal')).toBe(true);

    // Internal classification still works.
    expect(plan.internalLibrariesToScan.some((e) => e.name === 'com.example:internal-lib')).toBe(true);

    // No external edges either.
    const springEdges = edgeCalls.filter((e) => e.declared_name === 'org.springframework:spring-core');
    expect(springEdges).toHaveLength(0);
  });
});
