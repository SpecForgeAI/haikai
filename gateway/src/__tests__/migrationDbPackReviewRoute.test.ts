/**
 * DB-pack review-story readiness route (Spec 2026-07-23).
 *
 * Pins the fix for the false "Blocked — 3 missing inputs" on pack
 * human-procedure stories: classification (pack-provenance, no file payload),
 * per-kind queue readiness with the PLANNER'S OWN outstanding predicate, and
 * honest failure modes.
 */
import {
  isDbPackReviewStory,
  reviewKindFromStoryId,
  packIdFromTags,
  countOutstandingTranslations,
  runDbPackReviewPreflight,
  buildDbPackReviewSpecText,
  plannerDeclaredMissing,
} from '../services/migrationDbPackReviewRoute';
import type { PackTranslationRow } from '../services/migrationDbPackPlanner';

function row(partial: Partial<PackTranslationRow>): PackTranslationRow {
  return {
    translation_key: partial.translation_key ?? 'k',
    object_ref: partial.object_ref ?? 'dbo.p1',
    kind: partial.kind ?? 'stored_procedure',
    disposition: partial.disposition ?? 'translate',
    review_status: partial.review_status ?? 'unreviewed',
  };
}

describe('isDbPackReviewStory', () => {
  it('pack-provenance without the seed tag → review story', () => {
    expect(
      isDbPackReviewStory({
        id: 'e-s-stored_procedure-review',
        tags: ['provenance:pack', 'pack:p-1', 'stream:db'],
      }),
    ).toBe(true);
  });

  it('carriage (seed-tagged) and non-pack stories are NOT review stories', () => {
    expect(
      isDbPackReviewStory({
        id: 'e-s-stored_procedure-apply',
        tags: ['provenance:pack', 'pack:p-1', 'seed_db_pack_files'],
      }),
    ).toBe(false);
    expect(isDbPackReviewStory({ id: 's', tags: ['provenance:code'] })).toBe(false);
    expect(isDbPackReviewStory({ id: 's', tags: [] })).toBe(false);
  });
});

describe('id/tag parsing', () => {
  it('parses the review kind from the planner story id', () => {
    expect(reviewKindFromStoryId('epic-1-s-stored_procedure-review')).toBe('stored_procedure');
    expect(reviewKindFromStoryId('epic-1-s-view-review')).toBe('view');
    expect(reviewKindFromStoryId('epic-1-s-jobs-rehome')).toBeNull();
  });

  it('parses the packId from the pack:<id> tag', () => {
    expect(packIdFromTags(['provenance:pack', 'pack:075bdc95-e8e0', 'stream:db'])).toBe(
      '075bdc95-e8e0',
    );
    expect(packIdFromTags(['provenance:pack'])).toBeNull();
    expect(packIdFromTags(null)).toBeNull();
  });
});

describe('countOutstandingTranslations — the planner predicate verbatim', () => {
  it('counts translate-dispositioned unreviewed/needs_rework of THIS kind only', () => {
    const rows = [
      row({ kind: 'stored_procedure', review_status: 'unreviewed' }),
      row({ kind: 'stored_procedure', review_status: 'needs_rework' }),
      row({ kind: 'stored_procedure', review_status: 'approved' }),
      row({ kind: 'stored_procedure', disposition: 'manual_recreation', review_status: 'unreviewed' }),
      row({ kind: 'view', review_status: 'unreviewed' }),
    ];
    expect(countOutstandingTranslations(rows, 'stored_procedure')).toBe(2);
    expect(countOutstandingTranslations(rows, 'view')).toBe(1);
  });
});

describe('runDbPackReviewPreflight', () => {
  const reviewStory = {
    id: 'epic-1-s-stored_procedure-review',
    tags: ['provenance:pack', 'pack:p-1', 'stream:db'],
  };

  it('THE BUG CASE: fully-approved queue → ready (no SOAP/IaC/capability demands)', async () => {
    const verdict = await runDbPackReviewPreflight({
      projectId: 'proj-1',
      story: reviewStory,
      fetchPackTranslations: async () => [
        row({ review_status: 'approved' }),
        row({ review_status: 'approved' }),
      ],
    });
    expect(verdict.ready).toBe(true);
    expect(verdict.missing).toEqual([]);
    expect(verdict.note).toMatch(/translation queue clear/);
  });

  it('outstanding drafts → blocked with the honest count + wayfinding', async () => {
    const verdict = await runDbPackReviewPreflight({
      projectId: 'proj-1',
      story: reviewStory,
      fetchPackTranslations: async () => [
        row({ review_status: 'unreviewed' }),
        row({ review_status: 'needs_rework' }),
        row({ review_status: 'approved' }),
      ],
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.missing).toEqual([
      expect.objectContaining({
        input: 'translation_approvals',
        reason: expect.stringContaining('2 unapproved translation draft(s)'),
      }),
    ]);
  });

  it('non-review pack story (jobs re-homing) → ready, description-grounded note', async () => {
    const verdict = await runDbPackReviewPreflight({
      projectId: 'proj-1',
      story: { id: 'epic-1-s-jobs-rehome', tags: ['provenance:pack', 'pack:p-1'] },
      fetchPackTranslations: async () => {
        throw new Error('must not be called for a non-review story');
      },
    });
    expect(verdict.ready).toBe(true);
    expect(verdict.note).toMatch(/description-grounded/);
  });

  it('queue read failure → blocked with the fetch error (re-runnable), never a guess', async () => {
    const verdict = await runDbPackReviewPreflight({
      projectId: 'proj-1',
      story: reviewStory,
      fetchPackTranslations: async () => {
        throw new Error('AMS down');
      },
    });
    expect(verdict.ready).toBe(false);
    expect(verdict.missing[0]).toEqual(
      expect.objectContaining({
        input: 'pack_translations',
        reason: expect.stringContaining('AMS down'),
      }),
    );
  });
});

describe('buildDbPackReviewSpecText (deterministic, no LLM)', () => {
  it('carries the required prefix, the planner description, and the acceptance criteria as the gate', () => {
    const text = buildDbPackReviewSpecText({
      title: 'Review & approve stored procedures translation drafts (0 of 29 outstanding)',
      description: 'Work the pack translation queue for stored procedures.',
      acceptanceCriteria: ['Every stored procedure translation is approved.'],
    });
    expect(text.startsWith('/agent-os:shape-spec Review & approve stored procedures')).toBe(true);
    expect(text).toContain('Work the pack translation queue for stored procedures.');
    expect(text).toContain('## Gate condition');
    expect(text).toContain('- Every stored procedure translation is approved.');
    expect(text).toContain('never dispatches it to the implement-verify service');
  });

  it('falls back to a generic gate when no acceptance criteria carried', () => {
    const text = buildDbPackReviewSpecText({ title: 'T', description: null });
    expect(text).toContain('approved, rejected with a disposition, or re-dispositioned');
  });
});

describe('plannerDeclaredMissing (prerequisite own-reasons)', () => {
  it('maps planner string reasons to missing-input rows', () => {
    expect(
      plannerDeclaredMissing({ plannerMissingInputs: ['Code discovery has not run for this stream.'] }),
    ).toEqual([
      { input: 'prerequisite', reason: 'Code discovery has not run for this stream.' },
    ]);
  });

  it('passes object entries through with the prerequisite input tag', () => {
    expect(
      plannerDeclaredMissing({ plannerMissingInputs: [{ reason: 'r', gap: 'code_discovery' }] }),
    ).toEqual([{ input: 'prerequisite', reason: 'r', gap: 'code_discovery' }]);
  });

  it('honest generic fallback when the blob carries no reasons', () => {
    const out = plannerDeclaredMissing({ plannerMissingInputs: null });
    expect(out).toHaveLength(1);
    expect(out[0].reason).toMatch(/Planner-declared prerequisite gap/);
  });
});
