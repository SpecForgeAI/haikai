/**
 * Dependency-aware foundation layers (2026-09-07).
 *
 * A live foundations run lost three specs in sequence to one defect: the
 * planner asserted "build (topological) order" but partitioned each layer
 * alphabetically and classified the constants layer by NAME, so a shape was
 * placed before a shape it referenced and each implementer hit an absent type.
 * These pins cover the three fixes: reference edges (incl. an unresolved
 * opaque leaf resolved by UNIQUE simple class name), constants-layer eviction
 * to a fixed point, and topological partition with cycle reporting + a
 * forward-reference validator.
 */

import {
  buildContractDependencies,
  deriveCorpusPlan,
  foundationForwardReferences,
  SclContractDto,
  SclPlannedStory,
  topologicalContractOrder,
} from '../sclCorpusPlanner';

function shape(args: {
  key: string;
  symbol: string;
  representation?: string;
  references?: string[];
  fields?: Array<{ name: string; kind: string; sourceCarrier?: string | null }>;
}): SclContractDto {
  return {
    contract_key: args.key,
    kind: 'shape',
    source_path: `src/${args.symbol.replace(/\./g, '/')}.java`,
    source_symbol: args.symbol,
    fan_in: 0,
    roots_json: { roots: [] },
    body_json: {
      symbol: args.symbol,
      fields: args.fields ?? [{ name: 'x', kind: 'string' }],
      flags: [],
      references: args.references ?? [],
      ...(args.representation ? { representation: args.representation } : {}),
    },
  };
}

function table(args: { key: string; symbol: string; fanIn?: number; rows?: number; references?: string[] }): SclContractDto {
  return {
    contract_key: args.key,
    kind: 'behaviour_table',
    source_path: `src/${args.symbol.split('#')[0].replace(/\./g, '/')}.java`,
    source_symbol: args.symbol,
    fan_in: args.fanIn ?? 0,
    roots_json: { roots: [], total: 1, reachable: 1 },
    body_json: {
      symbol: args.symbol,
      annotations: [],
      rows: Array.from({ length: args.rows ?? 1 }, (_, i) => ({ index: i, condition: `c${i}` })),
      references: args.references ?? [],
    },
  };
}

const layerOf = (plan: ReturnType<typeof deriveCorpusPlan>, layer: string): SclPlannedStory | undefined =>
  plan.foundationStories.find((s) => s.layer === layer);

describe('constants-layer eviction', () => {
  it('EVICTS a name-matched *Exception that references a DTO shape (the live halt)', () => {
    const contracts = [
      shape({ key: 'S-FILTER', symbol: 'com.app.domain.RangeFilter' }),
      shape({ key: 'S-VLE', symbol: 'com.app.ValueLengthException', references: ['S-FILTER'] }),
      shape({ key: 'S-STATUS', symbol: 'com.app.Status', representation: 'enum' }),
    ];
    const plan = deriveCorpusPlan(contracts);
    expect(layerOf(plan, 'constants-exceptions')!.contractKeys).toEqual(['S-STATUS']);
    expect(layerOf(plan, 'dto-shapes')!.contractKeys).toEqual(['S-FILTER', 'S-VLE']);
    expect(plan.stats.constantsEvicted).toEqual(['com.app.ValueLengthException']);
    expect(layerOf(plan, 'constants-exceptions')!.description).toContain('1 name-matched type(s) were moved');
    expect(plan.stats.forwardReferences).toEqual([]);
  });

  it('leaves the constants layer intact when nothing escapes, and says so', () => {
    const contracts = [
      shape({ key: 'S-NFE', symbol: 'com.app.NotFoundException' }),
      shape({ key: 'S-STATUS', symbol: 'com.app.Status', representation: 'enum' }),
      shape({ key: 'S-ORDER', symbol: 'com.app.Order' }),
    ];
    const plan = deriveCorpusPlan(contracts);
    expect(layerOf(plan, 'constants-exceptions')!.contractKeys).toEqual(['S-NFE', 'S-STATUS']);
    expect(plan.stats.constantsEvicted).toEqual([]);
    expect(layerOf(plan, 'constants-exceptions')!.description).toContain('a genuinely zero-dependency layer');
  });

  it('iterates to a fixed point: evicting one shape strands the exception that referenced it', () => {
    const contracts = [
      shape({ key: 'S-DTO', symbol: 'com.app.Payload' }),
      // Name-matched, but references the DTO -> evicted first.
      shape({ key: 'S-INNER', symbol: 'com.app.InnerException', references: ['S-DTO'] }),
      // Name-matched, references only INNER (a constants member at first sight) -> stranded once INNER leaves.
      shape({ key: 'S-OUTER', symbol: 'com.app.OuterException', references: ['S-INNER'] }),
    ];
    const plan = deriveCorpusPlan(contracts);
    expect(layerOf(plan, 'constants-exceptions')).toBeUndefined(); // layer emptied -> omitted
    expect(plan.stats.constantsEvicted).toEqual(['com.app.InnerException', 'com.app.OuterException']);
    expect(layerOf(plan, 'dto-shapes')!.contractKeys).toEqual(['S-DTO', 'S-INNER', 'S-OUTER']);
  });
});

describe('build order within a layer', () => {
  it('orders parts so a shape never precedes one it references (Aaa refs Zzz -> Zzz first despite alphabet)', () => {
    const contracts = [
      shape({ key: 'S-AAA', symbol: 'com.app.Aaa', references: ['S-ZZZ'] }),
      shape({ key: 'S-MMM', symbol: 'com.app.Mmm' }),
      shape({ key: 'S-ZZZ', symbol: 'com.app.Zzz' }),
    ];
    const plan = deriveCorpusPlan(contracts, { rowBudget: 1 }); // one shape per part
    const dto = plan.foundationStories.filter((s) => s.layer === 'dto-shapes');
    expect(dto.map((s) => s.contractKeys[0])).toEqual(['S-MMM', 'S-ZZZ', 'S-AAA']);
    expect(dto[0].description).toContain('BUILD (dependency) order');
    expect(plan.stats.forwardReferences).toEqual([]);
  });

  it('with NO dependencies the partition is exactly alphabetical (old behaviour preserved)', () => {
    const contracts = [
      shape({ key: 'S-C', symbol: 'com.app.Ccc' }),
      shape({ key: 'S-A', symbol: 'com.app.Aaa' }),
      shape({ key: 'S-B', symbol: 'com.app.Bbb' }),
    ];
    const ordered = topologicalContractOrder(contracts, buildContractDependencies(contracts));
    expect(ordered.map((c) => c.contract_key)).toEqual(['S-A', 'S-B', 'S-C']);
  });

  it('a dependency CYCLE is reported, not thrown, and still yields a plan', () => {
    const contracts = [
      shape({ key: 'S-A', symbol: 'com.app.Aaa', references: ['S-B'] }),
      shape({ key: 'S-B', symbol: 'com.app.Bbb', references: ['S-A'] }),
    ];
    const plan = deriveCorpusPlan(contracts);
    expect(plan.foundationStories.length).toBeGreaterThan(0);
    expect(plan.stats.dependencyCycles).toEqual([['S-A', 'S-B']]);
    const cycles: string[][] = [];
    const ordered = topologicalContractOrder(contracts, buildContractDependencies(contracts), (m) => cycles.push(m));
    expect(ordered.map((c) => c.contract_key)).toEqual(['S-A', 'S-B']); // force-broken on the alphabetically-first member
    expect(cycles).toEqual([['S-A', 'S-B']]);
  });

  it('topologicalContractOrder ignores edges outside the slice (earlier layers satisfy them)', () => {
    const all = [
      shape({ key: 'S-ENUM', symbol: 'com.app.Status', representation: 'enum' }),
      shape({ key: 'S-A', symbol: 'com.app.Aaa', references: ['S-ENUM'] }),
    ];
    const deps = buildContractDependencies(all);
    const ordered = topologicalContractOrder([all[1]], deps);
    expect(ordered.map((c) => c.contract_key)).toEqual(['S-A']);
  });
});

describe('reference edges', () => {
  it('resolves an UNRESOLVED opaque leaf to a corpus shape by unique simple class name (the extractor miss)', () => {
    const contracts = [
      shape({ key: 'S-FILTER', symbol: 'com.app.domain.RangeFilter' }),
      // No `references` at all -- the extractor missed it -- but the field kind names the type.
      shape({
        key: 'S-VLE',
        symbol: 'com.app.ValueLengthException',
        fields: [{ name: 'filter', kind: 'opaque:com.app.domain.RangeFilter' }],
      }),
    ];
    const deps = buildContractDependencies(contracts);
    expect([...deps.get('S-VLE')!]).toEqual(['S-FILTER']);
    const plan = deriveCorpusPlan(contracts);
    expect(plan.stats.constantsEvicted).toEqual(['com.app.ValueLengthException']);
  });

  it('does NOT invent an edge for an AMBIGUOUS leaf (two shapes share the simple name)', () => {
    const contracts = [
      shape({ key: 'S-INFO-A', symbol: 'com.app.a.SsoInfo' }),
      shape({ key: 'S-INFO-B', symbol: 'com.app.b.SsoInfo' }),
      shape({ key: 'S-USER', symbol: 'com.app.User', fields: [{ name: 'sso', kind: 'opaque:com.other.SsoInfo' }] }),
      // Behaviour tables whose class reduces to the same leaf must not make a shape edge ambiguous either.
      table({ key: 'T-INFO', symbol: 'com.app.a.SsoInfo#refresh()', fanIn: 2 }),
    ];
    const deps = buildContractDependencies(contracts);
    expect([...deps.get('S-USER')!]).toEqual([]);
  });

  it('foundationForwardReferences NAMES a violation with both stories', () => {
    const stories: SclPlannedStory[] = [
      { layer: 'a', title: 'First', description: '', contractKeys: ['S-A'], rowCount: 0, tags: [] },
      { layer: 'b', title: 'Second', description: '', contractKeys: ['S-B'], rowCount: 0, tags: [] },
    ];
    const deps = new Map<string, Set<string>>([['S-A', new Set(['S-B'])], ['S-B', new Set()]]);
    expect(foundationForwardReferences(stories, deps)).toEqual([
      "'First' carries S-A which references S-B, carried by the later story 'Second'",
    ]);
    // Reverse order: no violation.
    expect(foundationForwardReferences([stories[1], stories[0]], deps)).toEqual([]);
  });
});
