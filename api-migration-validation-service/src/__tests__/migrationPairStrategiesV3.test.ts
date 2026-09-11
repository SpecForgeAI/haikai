/**
 * Strategy library additions for the second pair (Spec 3, 2026-09-11):
 *   granularity_us on timestamp-truncate (string-based, truncation not
 *   rounding), `instant` (offset-normalised), `uuid-canonical`, `xml-canonical`.
 */
import { canonicalize, compareWithRules, type MigrationPairRule } from '../migrationPairRules';

function rule(partial: Partial<MigrationPairRule> & { id: string }): MigrationPairRule {
  return { divergence_class: 'value_divergence', title: partial.id, ...partial };
}

describe('timestamp-truncate with granularity_us', () => {
  const r = rule({ id: 'X.DT.002', comparison: { strategy: 'timestamp-truncate', params: { granularity_us: 1 } } });

  test('cuts a 7-digit fraction to microseconds textually (never rounds)', () => {
    expect(canonicalize('2026-01-31 13:05:09.1234567', r.comparison!)).toBe('2026-01-31 13:05:09.123456');
    expect(canonicalize('2026-01-31 13:05:09.1234569', r.comparison!)).toBe('2026-01-31 13:05:09.123456');
    expect(canonicalize('2026-01-31T13:05:09.123456', r.comparison!)).toBe('2026-01-31 13:05:09.123456');
    expect(canonicalize('13:05:09.1234567', r.comparison!)).toBe('13:05:09.123456');
  });

  test('pads shorter fractions so both wires compare equal', () => {
    expect(compareWithRules('2026-01-31 13:05:09.1234567', '2026-01-31 13:05:09.123456', [r]).equal).toBe(true);
    expect(compareWithRules('2026-01-31 13:05:09.5', '2026-01-31 13:05:09.500000', [r]).equal).toBe(true);
    expect(compareWithRules('2026-01-31 13:05:09.1234567', '2026-01-31 13:05:09.123457', [r]).equal).toBe(false);
  });

  test('a coarser granularity floors the microseconds', () => {
    const r100 = rule({ id: 'X', comparison: { strategy: 'timestamp-truncate', params: { granularity_us: 100 } } });
    expect(canonicalize('2026-01-31 13:05:09.123456', r100.comparison!)).toBe('2026-01-31 13:05:09.123400');
  });
});

describe('instant', () => {
  const r = rule({ id: 'X.DT.004', comparison: { strategy: 'instant', params: { granularity_us: 1 } } });

  test('equates the same instant expressed with different offsets and naive-as-UTC', () => {
    expect(compareWithRules('2026-01-31T13:05:09.1234567+02:00', '2026-01-31 11:05:09.123456+00', [r]).equal).toBe(true);
    expect(compareWithRules('2026-01-31T13:05:09.1234567+02:00', '2026-01-31 11:05:09.123456', [r]).equal).toBe(true);
    expect(compareWithRules('2026-01-31T13:05:09Z', '2026-01-31 13:05:09.000000+00:00', [r]).equal).toBe(true);
  });

  test('a different instant diverges', () => {
    expect(compareWithRules('2026-01-31T13:05:09+02:00', '2026-01-31 13:05:09+00:00', [r]).equal).toBe(false);
  });
});

describe('uuid-canonical', () => {
  const r = rule({ id: 'X.UUID.001', comparison: { strategy: 'uuid-canonical' } });
  test('lower-cases and strips braces; non-uuids pass through', () => {
    expect(canonicalize('{A1B2C3D4-0000-0000-0000-000000000000}', r.comparison!)).toBe('a1b2c3d4-0000-0000-0000-000000000000');
    expect(compareWithRules('A1B2C3D4-0000-0000-0000-000000000000', 'a1b2c3d4-0000-0000-0000-000000000000', [r]).equal).toBe(true);
    expect(canonicalize('not a uuid', r.comparison!)).toBe('not a uuid');
  });
});

describe('xml-canonical', () => {
  const r = rule({ id: 'X.XML.001', comparison: { strategy: 'xml-canonical' } });
  test('strips the declaration and inter-element whitespace, keeps attribute order', () => {
    const a = '<?xml version="1.0"?>\n<root>\n  <a x="1" y="2">t</a>\n</root>\n';
    const b = '<root><a x="1" y="2">t</a></root>';
    expect(compareWithRules(a, b, [r]).equal).toBe(true);
    expect(compareWithRules('<root><a y="2" x="1">t</a></root>', b, [r]).equal).toBe(false);
  });
});
