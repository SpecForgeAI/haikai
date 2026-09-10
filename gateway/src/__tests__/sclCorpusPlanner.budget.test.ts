/**
 * SCL corpus planner — one size budget, asserted (2026-09-03).
 *
 * Kiro review MECH-05: the data-access layer was the largest spec in the
 * book by 87% (85K chars) and never split, because every boundary cost 1 row
 * while each renders a verbatim SQL block per operation. IMPL-06: the
 * clustering rule was implicit; the plan now names it and lists anything
 * still over budget instead of accepting it silently.
 */

import { deriveCorpusPlan, SclContractDto } from '../services/sclCorpusPlanner';

function boundary(n: number, operations: number): SclContractDto {
  const symbol = `com.app.dao.Dao${n}`;
  return {
    contract_key: `Q-${n}`,
    kind: 'boundary',
    source_path: `src/com/app/dao/Dao${n}.java`,
    source_symbol: symbol,
    fan_in: 2,
    roots_json: { roots: [] },
    body_json: {
      symbol,
      operations: Array.from({ length: operations }, (_, i) => ({
        name: `op${i}`,
        ref: { path: `src/com/app/dao/impl/Dao${n}Impl.java`, line: 10 + i },
        sqlVerbatim: `select * from t${n} where c = ${i}`,
      })),
      references: [],
    },
  } as unknown as SclContractDto;
}

function rootTable(rows: number): SclContractDto {
  const symbol = 'com.app.BigController#big()';
  return {
    contract_key: 'T-BIG',
    kind: 'behaviour_table',
    source_path: 'src/com/app/BigController.java',
    source_symbol: symbol,
    fan_in: 0,
    roots_json: { roots: [symbol] },
    body_json: {
      symbol,
      annotations: ['@GET', '@Path("/big")'],
      rows: Array.from({ length: rows }, (_, i) => ({
        index: i,
        kind: 'branch',
        conditionVerbatim: `if (x == ${i})`,
        outcome: { type: 'terminal', verbatim: `return ${i};`, outcomeLabel: 'value:int' },
      })),
      references: [],
    },
  } as unknown as SclContractDto;
}

describe('deriveCorpusPlan budget discipline', () => {
  it('boundaries cost by operations, so a heavy data-access layer SPLITS under the same budget as everything else', () => {
    const plan = deriveCorpusPlan([boundary(1, 4), boundary(2, 4), boundary(3, 4)], { rowBudget: 5 });
    const dataAccess = plan.foundationStories.filter((s) => s.layer === 'data-access');
    expect(dataAccess.length).toBeGreaterThan(1);
    expect(dataAccess.every((s) => /\(part \d+\)/.test(s.title))).toBe(true);
    // Every boundary lands in exactly one part.
    const keys = dataAccess.flatMap((s) => s.contractKeys).sort();
    expect(keys).toEqual(['Q-1', 'Q-2', 'Q-3']);
    expect(plan.stats.foundationSplitCount).toBeGreaterThanOrEqual(1);
  });

  it('names the clustering rule and lists stories that remain over budget (an unsplittable single method)', () => {
    const plan = deriveCorpusPlan([rootTable(10)], { rowBudget: 5 });
    // BOTH budgets fire since 2026-09-10, so the reported rule names both.
    expect(plan.stats.clusteringRule).toBe('row_and_size_budget');
    expect(plan.externalEndpointGroups).toHaveLength(1);
    expect(plan.externalEndpointGroups[0].rowCount).toBe(10);
    expect(plan.stats.overBudgetStories).toEqual([plan.externalEndpointGroups[0].title]);
  });

  it('reports NO over-budget stories when everything fits', () => {
    const plan = deriveCorpusPlan([rootTable(3), boundary(1, 2)], { rowBudget: 5 });
    expect(plan.stats.clusteringRule).toBe('row_and_size_budget');
    expect(plan.stats.overBudgetStories).toEqual([]);
    // The size budget is reported alongside the row budget, so a plan cannot
    // look "within budget" while a story is over the size budget unseen.
    expect(plan.stats.sizeBudgetChars).toBeGreaterThan(0);
    expect(plan.stats.overSizeStories).toEqual([]);
  });
});
