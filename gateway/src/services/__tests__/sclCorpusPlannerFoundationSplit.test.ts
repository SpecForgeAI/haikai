/**
 * Foundation-layer budget split (2026-08-30).
 *
 * `buildEndpointGroups` has always enforced the row budget, but foundation
 * layers bypassed it entirely — every contract in a layer landed in ONE story
 * no matter how large, which grew the shape layers without bound on a live
 * corpus. Pins:
 *
 *   - a layer under budget stays ONE story (no "(part N)" suffix);
 *   - an over-budget layer partitions into parts in symbol order with NO
 *     overlap and NO omission, each titled "(part N)" and described
 *     "PART n of m";
 *   - shape contracts cost a floor of 1 (a pure-shape layer can split even
 *     with zero behaviour rows — without the floor its cost summed to zero);
 *   - a single contract over the whole budget still yields exactly one part;
 *   - `stats.foundationSplitCount` counts the LAYERS that split.
 */

import { SclContractDto, deriveCorpusPlan } from '../sclCorpusPlanner';

function shape(key: string, symbol: string): SclContractDto {
  return {
    contract_key: key,
    kind: 'shape',
    source_path: `src/${symbol.replace(/\./g, '/')}.java`,
    source_symbol: symbol,
    fan_in: 0,
    roots_json: { roots: [] },
    body_json: { symbol, fields: [{ name: 'x', kind: 'string' }] },
  };
}

function sharedTable(key: string, symbol: string, rows: number): SclContractDto {
  return {
    contract_key: key,
    kind: 'behaviour_table',
    source_path: `src/${symbol.split('#')[0].replace(/\./g, '/')}.java`,
    source_symbol: symbol,
    fan_in: 3, // shared -> hoisted into cross-cutting-fragments
    roots_json: { roots: [] },
    body_json: {
      symbol,
      annotations: [],
      rows: Array.from({ length: rows }, (_, i) => ({ index: i })),
      references: [],
    },
  };
}

/** N DTO shapes named deterministically (dto-shapes + test-kit layers). */
function dtoShapes(n: number): SclContractDto[] {
  return Array.from({ length: n }, (_, i) =>
    shape(`S-dto-${String(i).padStart(2, '0')}`, `com.app.Dto${String(i).padStart(2, '0')}`),
  );
}

describe('deriveCorpusPlan — foundation-layer budget split', () => {
  it('a layer under budget stays ONE story with the original title/description', () => {
    const plan = deriveCorpusPlan(dtoShapes(3), { rowBudget: 40 });
    const dtoStories = plan.foundationStories.filter((s) => s.layer === 'dto-shapes');
    expect(dtoStories).toHaveLength(1);
    expect(dtoStories[0].title).toBe('DTO & domain shapes');
    expect(dtoStories[0].title).not.toContain('(part');
    expect(dtoStories[0].description).not.toContain('PART');
    expect(plan.stats.foundationSplitCount).toBe(0);
  });

  it('an over-budget SHAPE layer splits (the floor-of-1 cost — zero rows can still exceed a budget)', () => {
    // 10 shapes at cost 1 each against a budget of 4 -> 3 parts.
    const plan = deriveCorpusPlan(dtoShapes(10), { rowBudget: 4 });
    const dtoStories = plan.foundationStories.filter((s) => s.layer === 'dto-shapes');
    expect(dtoStories).toHaveLength(3);
    expect(dtoStories.map((s) => s.title)).toEqual([
      'DTO & domain shapes (part 1)',
      'DTO & domain shapes (part 2)',
      'DTO & domain shapes (part 3)',
    ]);
    expect(dtoStories[0].description).toContain('PART 1 of 3');
    expect(dtoStories[0].description).toContain('4 of 10 contract(s)');
    expect(dtoStories[0].description).toContain('NO overlap and NO omission');
  });

  it('parts PARTITION the layer: symbol order, no overlap, no omission', () => {
    const contracts = dtoShapes(10);
    const plan = deriveCorpusPlan(contracts, { rowBudget: 4 });
    const dtoStories = plan.foundationStories.filter((s) => s.layer === 'dto-shapes');
    const allKeys = dtoStories.flatMap((s) => s.contractKeys);
    // No omission, no duplication.
    expect(allKeys).toHaveLength(10);
    expect(new Set(allKeys).size).toBe(10);
    // Symbol order across the concatenated parts.
    expect(allKeys).toEqual([...allKeys].sort());
  });

  it('behaviour-row costs drive the split for row-carrying layers, and rowCount stays per-part', () => {
    // Three shared fragments of 30 rows each against a 40 budget -> 3 parts
    // (30+30 > 40, so each lands alone).
    const contracts = [
      sharedTable('T-a', 'com.app.AlphaBuilder#a()', 30),
      sharedTable('T-b', 'com.app.BravoBuilder#b()', 30),
      sharedTable('T-c', 'com.app.CharlieBuilder#c()', 30),
    ];
    const plan = deriveCorpusPlan(contracts, { rowBudget: 40 });
    const fragStories = plan.foundationStories.filter(
      (s) => s.layer === 'cross-cutting-fragments',
    );
    expect(fragStories).toHaveLength(3);
    expect(fragStories.map((s) => s.rowCount)).toEqual([30, 30, 30]);
    expect(fragStories.map((s) => s.contractKeys)).toEqual([['T-a'], ['T-b'], ['T-c']]);
  });

  it('a single contract over the whole budget yields exactly ONE part (never torn apart)', () => {
    const contracts = [sharedTable('T-big', 'com.app.BigBuilder#build()', 100)];
    const plan = deriveCorpusPlan(contracts, { rowBudget: 40 });
    const fragStories = plan.foundationStories.filter(
      (s) => s.layer === 'cross-cutting-fragments',
    );
    expect(fragStories).toHaveLength(1);
    expect(fragStories[0].title).toContain('(part 1)');
    expect(fragStories[0].contractKeys).toEqual(['T-big']);
  });

  it('foundationSplitCount counts LAYERS that split (dto-shapes + test-kit here), not parts', () => {
    // 10 shapes over a 4 budget split BOTH shape-driven layers (dto-shapes
    // and test-kit read the same population).
    const plan = deriveCorpusPlan(dtoShapes(10), { rowBudget: 4 });
    expect(plan.stats.foundationSplitCount).toBe(2);
    const testKit = plan.foundationStories.filter((s) => s.layer === 'test-kit');
    expect(testKit.length).toBeGreaterThan(1);
  });
});
