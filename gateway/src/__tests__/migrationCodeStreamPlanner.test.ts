/**
 * Unit pins — deterministic code-stream planner (Spec 2026-07-06-g,
 * Code-Tier Oracle Program).
 *
 * The load-bearing guarantees:
 *   - ANTI-EXPLOSION: one story per interface, never one per endpoint
 *     (40 interfaces × 10 endpoints -> 40 cluster stories, not 400)
 *   - VERB-SPLIT: oversized interfaces split GETs / POSTs+PUTs+PATCH / other,
 *     then path-sorted chunks, every story ≤ the cap
 *   - COVERAGE: unplanned / planned-but-gone / duplicated endpoints all THROW
 *     with the "regenerate the migration plan" message
 *   - PROTOCOL: REST + SOAP are ONE api_migration stream (Spec V) but still
 *     partition internally so SOAP clusters as ops and flags WSDL-metadata gaps
 *   - INTERNAL: no-HTTP-verb endpoints never enter the api_migration stream
 *   - FLAGS: missing-baseline endpoints leave their cluster, gain an
 *     individual story, and their interface gains a MANUAL-GATE capture story
 *     sequenced before implementation
 */

import {
  CODE_PREREQUISITE_TAG,
  CODE_PROVENANCE_TAG,
  CodeEndpointRow,
  CodeModelView,
  MANUAL_GATE_TAG,
  buildCodeEpicStories,
  buildCodeStreamSkeleton,
  clusterInterfaceEndpoints,
  groupByInterface,
  partitionEndpoints,
} from '../services/migrationCodeStreamPlanner';
import { MigrationBookOfWorkItem } from '../services/generatedMigrationBookOfWorkSchema';

// Spec V (2026-07-17): REST + SOAP are ONE generic api_migration stream.
const API_STREAM = 'api_migration';
const INTERNAL_STREAM = 'internal_processing_implementation';

function ep(
  id: string,
  interfaceId: string,
  verb: string | null,
  path: string | null,
  overrides: Partial<CodeEndpointRow> = {}
): CodeEndpointRow {
  return {
    id,
    name: verb ? `${verb} ${path ?? '/'} ` .trim() : id,
    interfaceId,
    interfaceName: `Iface ${interfaceId}`,
    interfaceType: 'REST_API',
    endpointType: 'REST',
    protocol: 'HTTP',
    verb,
    path,
    direction: 'inbound',
    hasProtocolMetadata: true,
    ...overrides,
  };
}

function view(
  endpoints: CodeEndpointRow[],
  opts: { baselines?: string[]; findings?: Record<string, string[]> } = {}
): CodeModelView {
  const baselineByEndpointId = new Map<string, string>();
  const covered = opts.baselines ?? endpoints.map((e) => e.id);
  for (const id of covered) baselineByEndpointId.set(id, `baseline-${id}`);
  const findingIdsByEndpointId = new Map<string, string[]>(
    Object.entries(opts.findings ?? {})
  );
  return { endpoints, baselineByEndpointId, findingIdsByEndpointId };
}

function featuresOf(
  skeleton: { items: MigrationBookOfWorkItem[] },
  epicId: string
): MigrationBookOfWorkItem[] {
  return skeleton.items.filter((i) => i.type === 'feature' && i.parentId === epicId);
}

function epicOf(
  skeleton: { items: MigrationBookOfWorkItem[] },
  epicId: string
): MigrationBookOfWorkItem {
  const epic = skeleton.items.find((i) => i.id === epicId);
  if (!epic) throw new Error(`epic ${epicId} not in skeleton`);
  return epic;
}

describe('ANTI-EXPLOSION PIN', () => {
  it('plans 400 endpoints across 40 interfaces as exactly 40 cluster stories', () => {
    const endpoints: CodeEndpointRow[] = [];
    for (let i = 0; i < 40; i++) {
      for (let j = 0; j < 10; j++) {
        endpoints.push(ep(`e-${i}-${j}`, `iface-${i}`, 'GET', `/api/r${i}/${j}`));
      }
    }
    const v = view(endpoints);
    const skeleton = buildCodeStreamSkeleton({ stream: API_STREAM, view: v, clusterCap: 15 });
    const epicId = `${API_STREAM}-epic-interfaces`;
    const features = featuresOf(skeleton, epicId);
    expect(features).toHaveLength(40);

    const stories = buildCodeEpicStories({
      epic: epicOf(skeleton, epicId),
      features,
      stream: API_STREAM,
      view: v,
      clusterCap: 15,
      maxSequence: 100,
    });
    expect(stories).toHaveLength(40); // one per interface — NEVER 400
    for (const story of stories) {
      const extras = story as unknown as { apiEndpointIds: string[] };
      expect(extras.apiEndpointIds).toHaveLength(10);
      expect(story.tags).toContain(CODE_PROVENANCE_TAG);
      expect(story.tags).toContain(`stream:${API_STREAM}`);
    }
    // No capture epic: everything is baselined (at floor).
    expect(skeleton.items.find((i) => i.id === `${API_STREAM}-epic-capture`)).toBeUndefined();
  });
});

describe('VERB-SPLIT PIN', () => {
  it('splits a 40-endpoint interface into verb groups then chunks, all ≤ cap, union exact', () => {
    const endpoints: CodeEndpointRow[] = [];
    for (let i = 0; i < 20; i++) endpoints.push(ep(`g-${i}`, 'iface-big', 'GET', `/r/${i}`));
    for (let i = 0; i < 12; i++) endpoints.push(ep(`m-${i}`, 'iface-big', i % 2 ? 'POST' : 'PUT', `/r/m${i}`));
    for (let i = 0; i < 8; i++) endpoints.push(ep(`d-${i}`, 'iface-big', 'DELETE', `/r/d${i}`));
    const group = groupByInterface(endpoints)[0];
    const clusters = clusterInterfaceEndpoints(group, 15, 'rest');

    const keys = clusters.map((c) => c.clusterKey).sort();
    expect(keys).toEqual(['get-1', 'get-2', 'mutate', 'other']);
    for (const c of clusters) expect(c.endpoints.length).toBeLessThanOrEqual(15);
    const union = clusters.flatMap((c) => c.endpoints.map((e) => e.id)).sort();
    expect(union).toEqual(endpoints.map((e) => e.id).sort());
  });

  it('chunks SOAP interfaces alphabetically (no verbs)', () => {
    const endpoints: CodeEndpointRow[] = [];
    for (let i = 0; i < 20; i++) {
      endpoints.push(
        ep(`s-${i}`, 'iface-soap', null, null, {
          name: `op${String(i).padStart(2, '0')}`,
          interfaceType: 'SOAP_API',
          protocol: 'SOAP',
        })
      );
    }
    const group = groupByInterface(endpoints)[0];
    const clusters = clusterInterfaceEndpoints(group, 15, 'soap');
    expect(clusters.map((c) => c.clusterKey)).toEqual(['ops-1', 'ops-2']);
    expect(clusters[0].endpoints).toHaveLength(15);
    expect(clusters[1].endpoints).toHaveLength(5);
  });
});

describe('COVERAGE PINS', () => {
  function skeletonAndEpic(v: CodeModelView) {
    const skeleton = buildCodeStreamSkeleton({ stream: API_STREAM, view: v, clusterCap: 15 });
    const epicId = `${API_STREAM}-epic-interfaces`;
    return {
      epic: epicOf(skeleton, epicId),
      features: featuresOf(skeleton, epicId),
    };
  }

  it('throws regenerate when the fresh model gained an unflagged endpoint (unplanned)', () => {
    const planned = [ep('e-1', 'iface-1', 'GET', '/a'), ep('e-2', 'iface-1', 'GET', '/b')];
    const { epic, features } = skeletonAndEpic(view(planned));
    const grown = view([...planned, ep('e-new', 'iface-1', 'GET', '/new')]);
    expect(() =>
      buildCodeEpicStories({ epic, features, stream: API_STREAM, view: grown, clusterCap: 15, maxSequence: 0 })
    ).toThrow(/regenerate the migration plan/);
  });

  it('throws regenerate when a planned endpoint no longer exists (planned-but-gone)', () => {
    const planned = [ep('e-1', 'iface-1', 'GET', '/a'), ep('e-2', 'iface-1', 'GET', '/b')];
    const { epic, features } = skeletonAndEpic(view(planned));
    const shrunk = view([planned[0]]);
    expect(() =>
      buildCodeEpicStories({ epic, features, stream: API_STREAM, view: shrunk, clusterCap: 15, maxSequence: 0 })
    ).toThrow(/regenerate the migration plan/);
  });

  it('throws regenerate when an endpoint id is stamped on two interface features (duplicate)', () => {
    const planned = [ep('e-1', 'iface-1', 'GET', '/a'), ep('e-2', 'iface-2', 'GET', '/b')];
    const v = view(planned);
    const { epic, features } = skeletonAndEpic(v);
    const tampered = features.map((f) => ({ ...f })) as Array<
      MigrationBookOfWorkItem & { apiEndpointIds?: string[] }
    >;
    tampered[1].apiEndpointIds = [...(tampered[1].apiEndpointIds ?? []), 'e-1'];
    expect(() =>
      buildCodeEpicStories({ epic, features: tampered, stream: API_STREAM, view: v, clusterCap: 15, maxSequence: 0 })
    ).toThrow(/regenerate the migration plan/);
  });
});

describe('PROTOCOL PIN', () => {
  const rest = ep('r-1', 'iface-r', 'GET', '/r');
  const soap = ep('s-1', 'iface-s', null, null, {
    name: 'greet',
    interfaceType: 'SOAP_API',
    protocol: 'SOAP',
    verb: null,
  });

  it('still partitions REST / SOAP / internal internally (for flagging + clustering)', () => {
    const v = view([rest, soap]);
    const p = partitionEndpoints(v);
    expect(p.rest.map((e) => e.id)).toEqual(['r-1']);
    expect(p.soap.map((e) => e.id)).toEqual(['s-1']);
    expect(p.internal).toHaveLength(0);
  });

  it('plans REST AND SOAP together under the one api_migration stream', () => {
    const v = view([rest, soap]);
    const skeleton = buildCodeStreamSkeleton({ stream: API_STREAM, view: v, clusterCap: 15 });
    const ids = JSON.stringify(skeleton.items);
    expect(ids).toContain('r-1');
    expect(ids).toContain('s-1'); // SOAP is no longer split into its own stream
  });

  it('plans a 100%-SOAP model under api_migration (no longer a prerequisite-only stream)', () => {
    const v = view([soap]);
    const skeleton = buildCodeStreamSkeleton({ stream: API_STREAM, view: v, clusterCap: 15 });
    expect(skeleton.items.some((i) => (i.tags ?? []).includes(CODE_PROVENANCE_TAG))).toBe(true);
    expect(JSON.stringify(skeleton.items)).toContain('s-1');
  });
});

describe('INTERNAL PIN', () => {
  const jms = ep('j-1', 'iface-jobs', null, null, {
    name: 'jms-listener orders-queue',
    endpointType: 'JMS',
    protocol: 'JMS',
  });
  const rest = ep('r-1', 'iface-r', 'GET', '/r');

  it('routes no-verb endpoints to the internal stream, never the API streams', () => {
    const v = view([jms, rest]);
    const restSkel = buildCodeStreamSkeleton({ stream: API_STREAM, view: v, clusterCap: 15 });
    expect(JSON.stringify(restSkel.items)).not.toContain('j-1');
    const internalSkel = buildCodeStreamSkeleton({ stream: INTERNAL_STREAM, view: v, clusterCap: 15 });
    expect(JSON.stringify(internalSkel.items)).toContain('j-1');
  });

  it('degrades to an explicit prerequisite when no internal entry points exist on the model', () => {
    const v = view([rest]);
    const skeleton = buildCodeStreamSkeleton({ stream: INTERNAL_STREAM, view: v, clusterCap: 15 });
    expect(skeleton.items[0].readiness).toBe('blocked');
    // Spec 2026-07-23: the wording no longer blames the (now-fixed)
    // endpoint_subtype commit drop — it gives the REAL remedy (commit the
    // internal candidates; they land under the synthesized interface).
    const text = JSON.stringify(skeleton.items);
    expect(text).toContain('COMMIT the internal endpoint candidates');
    expect(text).toContain('Internal Processing');
  });

  it('excludes outbound endpoints everywhere and counts them', () => {
    const outbound = ep('o-1', 'iface-r', 'GET', '/ext', { direction: 'outbound' });
    const v = view([rest, outbound]);
    const p = partitionEndpoints(v);
    expect(p.excludedOutbound.map((e) => e.id)).toEqual(['o-1']);
    const skeleton = buildCodeStreamSkeleton({ stream: API_STREAM, view: v, clusterCap: 15 });
    expect(JSON.stringify(skeleton.items)).not.toContain('o-1');
    const meta = skeleton.generationInputs.codePlanner as { excludedOutboundCount: number };
    expect(meta.excludedOutboundCount).toBe(1);
  });
});

describe('FLAG + CAPTURE-STORY + MANUAL-GATE PINS', () => {
  const covered = ep('c-1', 'iface-a', 'GET', '/covered');
  const uncovered = ep('u-1', 'iface-a', 'POST', '/uncovered');
  const otherIface = ep('c-2', 'iface-b', 'GET', '/other');

  function build() {
    const v = view([covered, uncovered, otherIface], { baselines: ['c-1', 'c-2'] });
    const skeleton = buildCodeStreamSkeleton({ stream: API_STREAM, view: v, clusterCap: 15 });
    return { v, skeleton };
  }

  it('extracts the missing-baseline endpoint from its cluster into an individual story', () => {
    const { v, skeleton } = build();
    const ifaceEpicId = `${API_STREAM}-epic-interfaces`;
    const ifaceFeatures = featuresOf(skeleton, ifaceEpicId) as Array<
      MigrationBookOfWorkItem & { apiEndpointIds?: string[] }
    >;
    const ifaceA = ifaceFeatures.find((f) => JSON.stringify(f).includes('iface-a'))!;
    expect(ifaceA.apiEndpointIds).toEqual(['c-1']); // u-1 extracted

    const excEpicId = `${API_STREAM}-epic-exceptional`;
    const excStories = buildCodeEpicStories({
      epic: epicOf(skeleton, excEpicId),
      features: featuresOf(skeleton, excEpicId),
      stream: API_STREAM,
      view: v,
      clusterCap: 15,
      maxSequence: 0,
    });
    expect(excStories).toHaveLength(1);
    const story = excStories[0] as MigrationBookOfWorkItem & { flagReason?: string };
    expect(story.flagReason).toBe('missing_baseline');
    expect(story.tags).not.toContain(MANUAL_GATE_TAG); // it IS implement work
  });

  it('plans one MANUAL-GATE capture story for the below-floor interface, before implementation', () => {
    const { v, skeleton } = build();
    const captureEpic = epicOf(skeleton, `${API_STREAM}-epic-capture`);
    const interfacesEpic = epicOf(skeleton, `${API_STREAM}-epic-interfaces`);
    // CAPTURE-STORY PIN: sequenced before implementation.
    expect(captureEpic.sequenceOrder).toBeLessThan(interfacesEpic.sequenceOrder);

    const stories = buildCodeEpicStories({
      epic: captureEpic,
      features: featuresOf(skeleton, captureEpic.id),
      stream: API_STREAM,
      view: v,
      clusterCap: 15,
      maxSequence: 0,
    });
    expect(stories).toHaveLength(1); // iface-a only; iface-b is at floor
    const story = stories[0] as MigrationBookOfWorkItem & {
      captureWork?: boolean;
      apiEndpointIds?: string[];
    };
    expect(story.tags).toContain(MANUAL_GATE_TAG);
    expect(story.captureWork).toBe(true);
    expect(story.apiEndpointIds).toEqual(['u-1']);
  });

  it('tags the closure story manual-gate', () => {
    const { v, skeleton } = build();
    const closureEpic = epicOf(skeleton, `${API_STREAM}-epic-closure`);
    const stories = buildCodeEpicStories({
      epic: closureEpic,
      features: featuresOf(skeleton, closureEpic.id),
      stream: API_STREAM,
      view: v,
      clusterCap: 15,
      maxSequence: 0,
    });
    expect(stories).toHaveLength(1);
    expect(stories[0].tags).toContain(MANUAL_GATE_TAG);
  });

  it('attached findings flag an endpoint into the exceptional epic', () => {
    const v = view([covered, otherIface], {
      baselines: ['c-1', 'c-2'],
      findings: { 'c-2': ['finding-9'] },
    });
    const skeleton = buildCodeStreamSkeleton({ stream: API_STREAM, view: v, clusterCap: 15 });
    const excEpicId = `${API_STREAM}-epic-exceptional`;
    const stories = buildCodeEpicStories({
      epic: epicOf(skeleton, excEpicId),
      features: featuresOf(skeleton, excEpicId),
      stream: API_STREAM,
      view: v,
      clusterCap: 15,
      maxSequence: 0,
    });
    expect(stories).toHaveLength(1);
    expect((stories[0] as MigrationBookOfWorkItem & { flagReason?: string }).flagReason).toBe(
      'attached_finding'
    );
    expect(
      (stories[0] as MigrationBookOfWorkItem & { findingIds?: string[] }).findingIds
    ).toEqual(['finding-9']);
  });
});

describe('PREREQUISITE PIN', () => {
  it('null view (AMS unreadable) yields the blocked prerequisite skeleton', () => {
    const skeleton = buildCodeStreamSkeleton({ stream: API_STREAM, view: null, clusterCap: 15 });
    expect(skeleton.items[0].readiness).toBe('blocked');
    expect(skeleton.items.every((i) => (i.tags ?? []).includes(CODE_PREREQUISITE_TAG))).toBe(true);
    const meta = skeleton.generationInputs.codePlanner as { generationMode: string };
    expect(meta.generationMode).toBe('deterministic-code-plan-prerequisite');
  });
});
