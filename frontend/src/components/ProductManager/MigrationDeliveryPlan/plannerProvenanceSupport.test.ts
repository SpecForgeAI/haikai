/**
 * Planner-provenance derivation (2026-08-20). Pins: no stories = no claim;
 * any `provenance:scl_corpus`-tagged story = corpus planner with the count;
 * stories without the tag = the honest legacy-fallback wording.
 */

import { describe, it, expect } from 'vitest';
import {
  SCL_CORPUS_STORY_TAG,
  derivePlannerProvenance,
} from './plannerProvenanceSupport';

describe('derivePlannerProvenance', () => {
  it('returns null when the plan has no stories (nothing to claim)', () => {
    expect(derivePlannerProvenance([])).toBeNull();
    expect(derivePlannerProvenance(null)).toBeNull();
    expect(derivePlannerProvenance([{ type: 'epic', tags: [] }])).toBeNull();
  });

  it('names the corpus planner with the corpus-story count', () => {
    const line = derivePlannerProvenance([
      { type: 'epic', tags: [] },
      { type: 'story', tags: [SCL_CORPUS_STORY_TAG] },
      { type: 'story', tags: ['execution:manual'] },
      { type: 'story', tags: [SCL_CORPUS_STORY_TAG, 'other'] },
    ]);
    expect(line).toBe('Planner: structural corpus (2 corpus stories)');
  });

  it('uses singular wording for exactly one corpus story', () => {
    expect(
      derivePlannerProvenance([{ type: 'story', tags: [SCL_CORPUS_STORY_TAG] }]),
    ).toBe('Planner: structural corpus (1 corpus story)');
  });

  it('discloses the legacy fallback when stories exist but none carry the tag', () => {
    expect(
      derivePlannerProvenance([
        { type: 'story', tags: [] },
        { type: 'story', tags: null },
      ]),
    ).toBe('Planner: legacy (no structural corpus at expansion time)');
  });
});
