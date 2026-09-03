/**
 * Fully-qualified signature types from explicit imports (2026-09-03,
 * spec-quality review DETAIL-03 / DETAIL-04).
 *
 * A contract signature that reads `getHierarchy(LocalDate)` gives an
 * implementer no way to know the source type was Joda rather than java.time —
 * precisely where the dates conversion decision bites — and the modernization
 * relevance matcher, which looks for the ruleset's FQN `from` text in the
 * contract body, never matched. Explicit single-type imports now qualify the
 * parameter and return types; java.lang / same-package / wildcard stay as
 * written.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { indexJavaProject, typeQualifierFor } from '../javaProjectIndex';

const DATES = `package com.x;
import org.joda.time.LocalDate;
import java.util.List;
import java.util.*;
import static com.x.Feeds.HIERARCHY;
public class DateService {
    public List<LocalDate> loadDatesFor(LocalDate from, String feed, Map<String, LocalDate> byName, LocalDate[] extra, Helper h) {
        return null;
    }
}
`;
const HELPER = `package com.x;
public class Helper { }
`;

describe('typeQualifierFor', () => {
  it('qualifies imported simple names inside generics and arrays; leaves java.lang, wildcard and static imports alone', () => {
    const q = typeQualifierFor(['org.joda.time.LocalDate', 'java.util.List', 'java.util.*']);
    expect(q('LocalDate')).toBe('org.joda.time.LocalDate');
    expect(q('List<LocalDate>')).toBe('java.util.List<org.joda.time.LocalDate>');
    expect(q('LocalDate[]')).toBe('org.joda.time.LocalDate[]');
    expect(q('String')).toBe('String');
    expect(q('Map<String, LocalDate>')).toBe('Map<String, org.joda.time.LocalDate>');
    // An already-qualified name is not re-qualified.
    expect(q('org.joda.time.LocalDate')).toBe('org.joda.time.LocalDate');
    // A token no type import names stays as written.
    expect(q('HIERARCHY')).toBe('HIERARCHY');
  });
});

describe('indexJavaProject qualifies method signatures', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scl-fqtypes-'));
    fs.mkdirSync(path.join(dir, 'com', 'x'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'com', 'x', 'DateService.java'), DATES);
    fs.writeFileSync(path.join(dir, 'com', 'x', 'Helper.java'), HELPER);
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records FQ parameter and return types where an explicit import names them', async () => {
    const index = await indexJavaProject(dir);
    const cls = index.classesByFqn.get('com.x.DateService')!;
    const m = cls.methods.find((x) => x.name === 'loadDatesFor')!;
    expect(m.paramTypes).toEqual([
      'org.joda.time.LocalDate',
      'String',
      'Map<String, org.joda.time.LocalDate>', // java.util.* wildcard: Map stays as written
      'org.joda.time.LocalDate[]',
      'Helper', // same package, no import: stays as written
    ]);
    expect(m.returnType).toBe('java.util.List<org.joda.time.LocalDate>');
  });
});
