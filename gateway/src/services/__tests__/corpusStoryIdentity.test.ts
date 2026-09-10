/**
 * Corpus story identity follows content, not position (2026-09-10).
 *
 * A planner reorder plus identity carry-over turned positional ids into
 * "43 of 49 specs attached to the wrong stories" on the work machine: the
 * specs were right for their blob stories, the ids had changed meaning.
 */

import { buildCorpusFoundationItems, corpusStoryId } from '../migrationBookOfWorkExpansionHandler';
import type { SclCorpusPlan, SclPlannedStory } from '../sclCorpusPlanner';

function planned(layer: string, title: string): SclPlannedStory {
  return { layer, title, description: 'd', contractKeys: ['K-' + title], rowCount: 0, tags: ['scl'] };
}

function plan(stories: SclPlannedStory[]): SclCorpusPlan {
  return {
    foundationStories: stories,
    externalEndpointGroups: [],
    internalEndpointGroups: [],
    stats: { sharedContractCount: 0, controllerCount: 0, splitCount: 0, foundationSplitCount: 0, rowBudget: 40 },
  } as unknown as SclCorpusPlan;
}

const EPIC = { id: 'api:E1', type: 'epic', title: 'Foundations', workstream: 'api_migration', tags: [] } as never;

describe('corpusStoryId', () => {
  it('derives the id from the layer and the part, never the position', () => {
    expect(corpusStoryId('f', planned('cross-cutting-fragments', 'Cross-cutting shared fragments (part 3)'))).toBe('f-s-cross-cutting-fragments-p3');
    expect(corpusStoryId('f', planned('utilities', 'Utility functions package'))).toBe('f-s-utilities-p1');
    expect(corpusStoryId('f', { layer: 'endpoints', title: 'Implement OrdersController (2 endpoints) (part 2)' })).toBe('f-s-endpoints-p2');
  });
});

describe('buildCorpusFoundationItems identity', () => {
  it('a reorder moves stories but keeps their ids; a new part gets a new id', () => {
    const before = buildCorpusFoundationItems({
      epic: EPIC, stream: 'api_migration', startSequence: 10,
      plan: plan([
        planned('constants-exceptions', 'Constants, enums & exception types'),
        planned('cross-cutting-fragments', 'Cross-cutting shared fragments (part 1)'),
        planned('utilities', 'Utility functions package'),
      ]),
    });
    const after = buildCorpusFoundationItems({
      epic: EPIC, stream: 'api_migration', startSequence: 10,
      plan: plan([
        planned('constants-exceptions', 'Constants, enums & exception types'),
        planned('utilities', 'Utility functions package'),
        planned('cross-cutting-fragments', 'Cross-cutting shared fragments (part 1)'),
        planned('cross-cutting-fragments', 'Cross-cutting shared fragments (part 2)'),
      ]),
    });
    const idsByTitle = (items: ReturnType<typeof buildCorpusFoundationItems>) =>
      new Map(items.filter((i) => i.type === 'story').map((i) => [i.title, i.id]));
    const b = idsByTitle(before);
    const a = idsByTitle(after);
    expect(a.get('Utility functions package')).toBe(b.get('Utility functions package'));
    expect(a.get('Cross-cutting shared fragments (part 1)')).toBe(b.get('Cross-cutting shared fragments (part 1)'));
    expect(a.get('Cross-cutting shared fragments (part 2)')).toBe('api:E1-corpus-foundations-s-cross-cutting-fragments-p2');
    // No id is reused for a different story.
    expect(new Set(after.map((i) => i.id)).size).toBe(after.length);
  });
});
