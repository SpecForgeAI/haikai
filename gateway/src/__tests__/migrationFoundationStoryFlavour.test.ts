/**
 * Foundation-story prompt flavour (2026-07-31).
 *
 * Code FOUNDATION stories ("Scheduler & queue infrastructure rehoming",
 * "Security & auth parity foundations", ...) are planner-authored,
 * cross-cutting, and endpoint-less BY DEFINITION (isCodeFoundationStory
 * requires zero endpoint ids) — yet resolveManualAddFlavour funnelled every
 * non-`operational` item into the `api` flavour, whose "produce an endpoint
 * spec" instruction contradicts the manual-add "description is
 * authoritative" block for an endpoint-less description. The LLM resolved
 * that tension non-deterministically: one batch generated, the next refused
 * with insufficient_context (the live `de6b7f2d` story, blocker count 2 then
 * 4 across re-runs). Foundation stories now get their own `foundation`
 * flavour that never demands endpoint details.
 */
import {
  buildDescriptionGroundedContext,
  buildStoryUserPrompt,
  resolveManualAddFlavour,
} from '../services/migrationShapeSpecGenerationHandler';

type AnyStory = Parameters<typeof resolveManualAddFlavour>[0];
type AnyBow = Parameters<typeof buildDescriptionGroundedContext>[1];

function foundationStory(overrides: Partial<AnyStory> = {}): AnyStory {
  return {
    id: 'b-int-f-1-s-1',
    workItemId: 'wi-found-1',
    title: 'Scheduler & queue infrastructure rehoming',
    description:
      'Scheduler & queue infrastructure rehoming for the Internal processing ' +
      'implementation (jobs, listeners, batch) stream (cross-cutting; applies ' +
      'to every interface story).',
    parentId: 'f-int-1',
    sequenceOrder: 3,
    tags: ['provenance:code_discovery', 'stream:internal'],
    ...overrides,
  } as unknown as AnyStory;
}

const bow = {
  projectId: 'p1',
  bookOfWorkId: 'bow-1',
  currentArchitectureId: 'arch-1',
  targetArchitectureId: null,
} as unknown as AnyBow;

describe('resolveManualAddFlavour', () => {
  it('routes a foundation story to the foundation flavour (not api)', () => {
    expect(resolveManualAddFlavour(foundationStory(), true)).toBe('foundation');
  });

  it('an explicit kind=operational still wins over foundation routing', () => {
    const story = foundationStory({ kind: 'operational' } as Partial<AnyStory>);
    expect(resolveManualAddFlavour(story, true)).toBe('operational');
  });

  it('non-foundation items keep the api default (back-compat)', () => {
    expect(resolveManualAddFlavour(foundationStory(), false)).toBe('api');
    expect(resolveManualAddFlavour(foundationStory())).toBe('api');
  });
});

describe('buildDescriptionGroundedContext', () => {
  it('threads the foundation flavour into description_grounded.kind', () => {
    const ctx = buildDescriptionGroundedContext(foundationStory(), bow, true) as unknown as {
      description_grounded: { kind: string };
    };
    expect(ctx.description_grounded.kind).toBe('foundation');
  });

  it('keeps the api default when the story is not a foundation', () => {
    const ctx = buildDescriptionGroundedContext(foundationStory(), bow) as unknown as {
      description_grounded: { kind: string };
    };
    expect(ctx.description_grounded.kind).toBe('api');
  });
});

describe('buildStoryUserPrompt framing', () => {
  it('the foundation flavour never demands endpoint details and forbids the refusal', () => {
    const story = foundationStory();
    const ctx = buildDescriptionGroundedContext(story, bow, true);
    const prompt = buildStoryUserPrompt(ctx, story, 1, 'foundation');

    expect(prompt).toContain('KIND = foundation (cross-cutting, non-API)');
    expect(prompt).toContain('Do NOT invent an endpoint path');
    expect(prompt).toContain('Leave coveredEndpointIds empty');
    // The API-orientation block must be absent — it is the instruction that
    // contradicted the manual-add block and made the LLM refuse.
    expect(prompt).not.toContain('KIND = api');
    expect(prompt).not.toContain('Orient the spec around the new endpoint contract');
  });

  it('the api flavour framing is unchanged for genuine API manual adds', () => {
    const story = foundationStory();
    const ctx = buildDescriptionGroundedContext(story, bow);
    const prompt = buildStoryUserPrompt(ctx, story, 1, 'api');
    expect(prompt).toContain('KIND = api');
    expect(prompt).not.toContain('KIND = foundation');
  });
});
