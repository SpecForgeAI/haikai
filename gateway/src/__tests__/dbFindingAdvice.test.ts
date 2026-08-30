/**
 * Per-finding disposition advisor (2026-08-30). Pins the deterministic-first
 * design: composite/temporal referenced keys constrain the recommendation
 * set IN CODE (Fix-with-AI declared unapplicable) before the LLM narrates;
 * out-of-set LLM answers fall back with a warning; an unreachable LLM under
 * a proven constraint returns deterministic advice with an honest caveat,
 * never a silent failure.
 */
import {
  detectInexpressibleFkParents,
  runFindingAdvice,
} from '../services/dbFindingAdvice';
import type { CommittedPhysicalModel } from '../services/dbMigrationPack/inputs';

/** A screen_filter parent keyed by a composite TEMPORAL unique index —
 *  the validity-window idiom a plain FK cannot reference. */
function temporalModel(): CommittedPhysicalModel {
  return {
    physicalDataEntities: [
      { id: 'e-tag', name: 'filter_tag' },
      {
        id: 'e-filter',
        name: 'screen_filter',
        constraints_metadata: {
          indexes: [
            {
              name: 'ux_sf',
              columns: ['FilterId', 'ValidFrom', 'ValidTo'],
              is_unique: true,
              is_clustered: true,
            },
          ],
        },
      },
    ],
    physicalDataAttributes: [
      { id: 'a1', name: 'TagId', physical_entity_id: 'e-tag', data_type: 'int', is_identity: true },
      { id: 'a2', name: 'FilterId', physical_entity_id: 'e-tag', data_type: 'int' },
      { id: 'a3', name: 'FilterId', physical_entity_id: 'e-filter', data_type: 'int' },
      { id: 'a4', name: 'ValidFrom', physical_entity_id: 'e-filter', data_type: 'datetime' },
      { id: 'a5', name: 'ValidTo', physical_entity_id: 'e-filter', data_type: 'datetime' },
    ],
    dataEntityPoints: [
      { id: 'p-tag', physical_entity_id: 'e-tag' },
      { id: 'p-filter', physical_entity_id: 'e-filter' },
    ],
    dataEntityRelationships: [
      {
        id: 'rel-1',
        fromDataEntityPointId: 'p-tag',
        toDataEntityPointId: 'p-filter',
        fk_columns: null,
      },
    ],
  };
}

/** Same shape but the parent has a simple single-column identity key. */
function simpleModel(): CommittedPhysicalModel {
  const m = temporalModel();
  m.physicalDataEntities[1] = { id: 'e-filter', name: 'screen_filter' };
  m.physicalDataAttributes = m.physicalDataAttributes.filter(
    (a) => !['a4', 'a5'].includes(a.id)
  );
  m.physicalDataAttributes.push({
    id: 'a6',
    name: 'FilterId',
    physical_entity_id: 'e-filter',
    data_type: 'int',
    is_identity: true,
    is_primary_key: true,
  } as never);
  return m;
}

const FINDING = {
  projectId: 'proj-1',
  findingKind: 'relationships_without_fk_columns',
  findingKey: 'relationships_without_fk_columns:all_relationships',
  message: '3 relationships carry no fk_columns join metadata',
};

describe('detectInexpressibleFkParents', () => {
  it('flags a composite temporal unique-index key on a referenced parent', () => {
    const parents = detectInexpressibleFkParents(temporalModel());
    expect(parents).toHaveLength(1);
    expect(parents[0]).toMatchObject({
      table: 'screen_filter',
      keyColumns: ['FilterId', 'ValidFrom', 'ValidTo'],
      temporal: true,
    });
  });

  it('a single-column key parent is expressible — nothing flagged', () => {
    expect(detectInexpressibleFkParents(simpleModel())).toEqual([]);
  });
});

describe('runFindingAdvice', () => {
  it('constrains the choices in CODE, disables Fix-with-AI, and lets the LLM narrate', async () => {
    const seenPrompts: string[] = [];
    const result = await runFindingAdvice({
      ...FINDING,
      model: temporalModel(),
      callLlm: async ({ userPrompt }) => {
        seenPrompts.push(userPrompt);
        return {
          content: JSON.stringify({
            recommended_disposition: 'known_gap',
            rationale: 'The referenced key is temporal; record the debt.',
            confidence: 'high',
            caveats: ['Revisit if the parent gains a surrogate key.'],
            suggested_note: 'Known gap: temporal composite parent key.',
          }),
        };
      },
    });
    expect(result.advice.fix_with_ai_applicable).toBe(false);
    expect(result.advice.deterministic_constraint).toContain('screen_filter');
    expect(result.advice.deterministic_constraint).toContain('UNAPPLICABLE');
    expect(result.advice.recommended_disposition).toBe('known_gap');
    // The constraint reached the LLM as a hard, non-contradictable fact.
    expect(seenPrompts[0]).toContain('HARD CONSTRAINT');
    expect(seenPrompts[0]).toContain('accepted | known_gap');
    expect(result.warnings).toEqual([]);
  });

  it('an out-of-set LLM recommendation falls back with an honest warning', async () => {
    const result = await runFindingAdvice({
      ...FINDING,
      model: temporalModel(),
      callLlm: async () => ({
        content: JSON.stringify({
          recommended_disposition: 'fix_upstream', // not allowed under the constraint
          rationale: 'x',
          confidence: 'high',
          caveats: [],
          suggested_note: null,
        }),
      }),
    });
    expect(result.advice.recommended_disposition).toBe('known_gap');
    expect(result.warnings.some((w) => w.includes('outside the allowed set'))).toBe(true);
  });

  it('an unconstrained finding offers all three dispositions', async () => {
    const seenPrompts: string[] = [];
    const result = await runFindingAdvice({
      ...FINDING,
      model: simpleModel(),
      callLlm: async ({ userPrompt }) => {
        seenPrompts.push(userPrompt);
        return {
          content: JSON.stringify({
            recommended_disposition: 'fix_upstream',
            rationale: 'The join is derivable — fix at source and regenerate.',
            confidence: 'medium',
            caveats: [],
            suggested_note: null,
          }),
        };
      },
    });
    expect(result.advice.fix_with_ai_applicable).toBe(true);
    expect(result.advice.deterministic_constraint).toBeNull();
    expect(result.advice.recommended_disposition).toBe('fix_upstream');
    expect(seenPrompts[0]).toContain('accepted | fix_upstream | known_gap');
  });

  it('LLM unreachable under a proven constraint -> deterministic advice with an honest caveat', async () => {
    const result = await runFindingAdvice({
      ...FINDING,
      model: temporalModel(),
      callLlm: async () => {
        throw new Error('relay down');
      },
    });
    expect(result.advice.recommended_disposition).toBe('known_gap');
    expect(result.advice.fix_with_ai_applicable).toBe(false);
    expect(result.advice.caveats.join(' ')).toContain('LLM unavailable');
    expect(result.warnings.some((w) => w.includes('relay down'))).toBe(true);
  });

  it('LLM unreachable with NO constraint -> the error surfaces (no invented advice)', async () => {
    await expect(
      runFindingAdvice({
        ...FINDING,
        model: simpleModel(),
        callLlm: async () => {
          throw new Error('relay down');
        },
      })
    ).rejects.toThrow('relay down');
  });
});
