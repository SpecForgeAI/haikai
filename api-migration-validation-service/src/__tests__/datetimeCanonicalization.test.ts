/**
 * Datetime canonicalization under the naive-is-UTC policy (2026-08-07).
 *
 * The live parity artifact: node-postgres parsed `timestamp` columns into
 * LOCAL-time JS Dates, so the same stored instant read on a BST machine sat
 * one hour off the Sybase sidecar's ISO-UTC form and SYBPG.DT.001 "failed"
 * on every ValidFrom/ValidTo cell. The adapter now returns raw strings and
 * the rule library interprets NAIVE datetime strings as UTC by explicit
 * policy — same instant, any wire form, equal; genuinely different instants
 * stay divergent.
 */
import { compareWithRules, MigrationPairRule } from '../migrationPairRules';

const DT_RULE: MigrationPairRule = {
  id: 'SYBPG.DT.001',
  divergence_class: 'datetime_precision',
  title: 'ASE datetime tick grid',
  applies_to: { column_types: ['datetime'] },
  comparison: { strategy: 'timestamp-truncate', params: { ticks_per_second: 300 } },
} as MigrationPairRule;

function equal(a: unknown, b: unknown): boolean {
  return compareWithRules(a, b, [DT_RULE]).equal;
}

describe('datetime canonicalization (SYBPG.DT.001 inputs)', () => {
  it('ISO-UTC source vs NAIVE raw target — the live shape — is EQUAL', () => {
    expect(equal('2014-05-15T23:00:00.000+00:00', '2014-05-15 23:00:00')).toBe(true);
    expect(equal('2025-01-06T06:52:22.000+00:00', '2025-01-06 06:52:22')).toBe(true);
  });

  it('raw Postgres timestamptz SHORT offset (+00 / +01, space separator) parses correctly', () => {
    expect(equal('2014-05-15T23:00:00.000+00:00', '2014-05-15 23:00:00+00')).toBe(true);
    // +01 offset = the SAME instant as 22:00 UTC.
    expect(equal('2014-05-15T22:00:00.000+00:00', '2014-05-15 23:00:00+01')).toBe(true);
  });

  it('a GENUINE one-hour difference stays divergent (the policy never papers over real drift)', () => {
    expect(equal('2014-05-15T23:00:00.000+00:00', '2014-05-16 00:00:00')).toBe(false);
    expect(equal('2025-01-06T06:52:22.000+00:00', '2025-01-06 07:52:22')).toBe(false);
  });

  it('date-only values anchor at UTC midnight on both sides', () => {
    expect(equal('2014-05-15', '2014-05-15T00:00:00.000+00:00')).toBe(true);
    expect(equal('2014-05-15', '2014-05-16')).toBe(false);
  });

  it('JS Date inputs still compare by instant (back-compat)', () => {
    expect(equal(new Date('2014-05-15T23:00:00Z'), '2014-05-15 23:00:00')).toBe(true);
  });

  it('tick-grid recovery equates renderings of one stored tick only (2026-08-11: round, never floor)', () => {
    // Tick 137 is 456.67ms — one side renders .457, an earlier load stored
    // .456: SAME tick, equal (floor split these into 136/137, the live
    // false key-mismatch class).
    expect(equal('2014-05-15 23:00:00.456', '2014-05-15 23:00:00.457')).toBe(true);
    // Distinct ticks stay unequal (.003 = tick 1, .007 = tick 2)...
    expect(equal('2014-05-15 23:00:00.003', '2014-05-15 23:00:00.007')).toBe(false);
    // ...and a full second certainly cannot match.
    expect(equal('2014-05-15 23:00:00', '2014-05-15 23:00:01')).toBe(false);
  });
});
