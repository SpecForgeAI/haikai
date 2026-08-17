/**
 * Target database NAME resolution (2026-08-17): the `db.databaseName`
 * captured decision becomes the pack manifest's declared `target_db.database`
 * — one source of truth for the schema-apply seed, the Start-dialog prefill,
 * parity/load/drift and the seed-story spec. Values must be safe PostgreSQL
 * identifiers; anything else falls back to the historical default.
 */

import { resolveTargetDbNameDecision } from '../services/dbMigrationPackHandler';

describe('resolveTargetDbNameDecision', () => {
  it('returns undefined when the decision is absent (fallback = haikai_target)', () => {
    expect(resolveTargetDbNameDecision([])).toBeUndefined();
    expect(
      resolveTargetDbNameDecision([{ decisionCode: 'db.engine', answerValue: 'Postgres' }])
    ).toBeUndefined();
  });

  it('lowercases and accepts a safe identifier from answerValue', () => {
    expect(
      resolveTargetDbNameDecision([
        { decisionCode: 'db.databaseName', answerValue: 'Acme_Core' },
      ])
    ).toBe('acme_core');
  });

  it('prefers the parsed answerValue over prose answerSummary and unwraps the JSON envelope', () => {
    expect(
      resolveTargetDbNameDecision([
        {
          decisionCode: 'db.databaseName',
          answerValue: '{"value":"acme_core"}',
          answerSummary: 'Use the acme core database',
        },
      ])
    ).toBe('acme_core');
  });

  it('rejects unsafe identifiers (falls back via undefined)', () => {
    for (const bad of ['my db!', '1abc', 'name-with-dash', 'DROP TABLE x;', '']) {
      expect(
        resolveTargetDbNameDecision([
          { decisionCode: 'db.databaseName', answerValue: bad },
        ])
      ).toBeUndefined();
    }
  });
});
