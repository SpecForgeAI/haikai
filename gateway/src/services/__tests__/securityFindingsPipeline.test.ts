/**
 * Tests for the Security Findings pipeline (Security health dashboard,
 * 2026-07-19, Spec 2 of 3): deterministic per-file parsing of the GitLab
 * vulnerability-report export, the column-mapping proposal, multi-value cell
 * splitting, GitLab timestamp + Ruby-hash Location normalization, and the
 * append + resolution application into the AMS ingest wire shape.
 *
 * The fixture columns mirror the user's real GitLab export (2026-07-19
 * screenshot): both a dependency-scanning row (CVE + CWE) and a SAST row
 * (CWE only, no CVE).
 */

import {
  distinctLinkingValues,
  normalizeDetectedAt,
  normalizeLocation,
  normalizeSecurityRows,
  parseSecurityFile,
  proposeColumnMapping,
  splitMultiValue,
  unionHeaders,
} from '../securityFindingsPipeline';

const GITLAB_HEADERS =
  'Group Name,Project Name,Tool,Scanner Name,Status,Vulnerability,Details,Severity,CVE,CWE,Other Identifiers,Detected At,Location,Full Path,CVSS Vectors,Vulnerability ID';

const DEP_ROW =
  'GRH,HiFi,dependency_scanning,GitLab SBoM Vulnerability Scanner,detected,' +
  'Spring Framework vulnerable to Denial of Service,In Spring Framework versions...,' +
  'medium,CVE-2024-38808,CWE-770,"GHSA-9cmq-m9j5-mvww; Gemnasium-f80ff2b5",' +
  '2026-03-19 06:51:18 UTC,' +
  '"{""file""=>""batch/pom.xml"", ""dependency""=>{""package""=>{""name""=>""org.springframework/spring-expression""}, ""version""=>""5.3.30""}}",' +
  'natwestgroup/GRH/hifi/4131704,NVD=CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L,4131704';

const SAST_ROW =
  'GRH,MRX (Risk),sast,Semgrep,detected,' +
  "Improper neutralization of special elements used in an SQL command,SQL Injection...,high,,CWE-89," +
  '"A1:2017 - Injection; A03:2021 - Injection",2025-07-29 19:38:27 UTC,' +
  '"{""file""=>""batch/src/main/java/COBDatePrevSQLPrinter.java"", ""start_line""=>32}",' +
  'natwestgroup/GRH/hifi/1949555,,1949555';

const gitlabCsv = (rows: string[]) => Buffer.from([GITLAB_HEADERS, ...rows].join('\n'), 'utf-8');

describe('parseSecurityFile + proposal', () => {
  it('parses the GitLab CSV into header-keyed records and proposes the v1 mapping', () => {
    const parsed = parseSecurityFile(gitlabCsv([DEP_ROW, SAST_ROW]), 'export.csv');
    expect(parsed.name).toBe('export.csv');
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]['Project Name']).toBe('HiFi');
    expect(parsed.rows[1]['CWE']).toBe('CWE-89');

    const mapping = proposeColumnMapping(parsed.headers);
    expect(mapping).toMatchObject({
      'Project Name': 'linking_value',
      Severity: 'severity',
      CVE: 'cve_ids',
      CWE: 'cwe_ids',
      Vulnerability: 'title',
      Details: 'description',
      'Detected At': 'detected_at',
      Location: 'location',
      'Full Path': 'source_path',
      'CVSS Vectors': 'cvss_vector_reported',
      'Vulnerability ID': 'source_finding_id',
      'Other Identifiers': 'other_identifiers',
    });
    // Deliberately-excluded v1 columns propose as unmapped.
    expect(mapping).not.toHaveProperty('Tool');
    expect(mapping).not.toHaveProperty('Scanner Name');
    expect(mapping).not.toHaveProperty('Group Name');
  });

  it('unions headers across files in first-seen order and counts distinct linking values across ALL files', () => {
    const a = parseSecurityFile(gitlabCsv([DEP_ROW]), 'a.csv');
    const b = parseSecurityFile(gitlabCsv([SAST_ROW, SAST_ROW]), 'b.csv');
    expect(unionHeaders([a, b])[1]).toBe('Project Name');
    const values = distinctLinkingValues([a, b], 'Project Name');
    expect(values).toEqual([
      { value: 'HiFi', count: 1 },
      { value: 'MRX (Risk)', count: 2 },
    ]);
  });
});

describe('cell normalizers', () => {
  it('splits multi-value cells on , ; | with order-preserving dedupe', () => {
    expect(splitMultiValue('CVE-2024-1; CVE-2024-2,CVE-2024-1|CVE-2024-3')).toEqual([
      'CVE-2024-1',
      'CVE-2024-2',
      'CVE-2024-3',
    ]);
    expect(splitMultiValue(null)).toEqual([]);
  });

  it('normalizes the GitLab "UTC" timestamp shape and plain ISO to an instant', () => {
    expect(normalizeDetectedAt('2026-03-19 06:51:18 UTC')).toBe('2026-03-19T06:51:18.000Z');
    expect(normalizeDetectedAt('2026-03-19T06:51:18Z')).toBe('2026-03-19T06:51:18.000Z');
    expect(normalizeDetectedAt('not a date')).toBeNull();
  });

  it('normalizes the Ruby-hash Location blob: dependency -> file, SAST -> file:start_line, non-blob passes through', () => {
    expect(
      normalizeLocation(
        '{"file"=>"batch/pom.xml", "dependency"=>{"package"=>{"name"=>"org.springframework/spring-expression"}, "version"=>"5.3.30"}}',
      ),
    ).toBe('batch/pom.xml');
    expect(
      normalizeLocation('{"file"=>"batch/src/main/java/COBDatePrevSQLPrinter.java", "start_line"=>32}'),
    ).toBe('batch/src/main/java/COBDatePrevSQLPrinter.java:32');
    expect(normalizeLocation('core/pom.xml')).toBe('core/pom.xml');
  });
});

describe('normalizeSecurityRows (the append + wizard resolutions)', () => {
  const files = [
    parseSecurityFile(gitlabCsv([DEP_ROW]), 'a.csv'),
    parseSecurityFile(gitlabCsv([SAST_ROW]), 'b.csv'),
  ];
  const mapping = proposeColumnMapping(unionHeaders(files));

  it('appends all files into one row list, applies resolutions (entity_id with application_id fallback), and defaults unresolved values to unmatched', () => {
    const result = normalizeSecurityRows(files, mapping, [
      { linking_value: 'HiFi', entity_id: 'svc-hifi-web', match_status: 'auto' },
      // Pre-213 caller shape: application_id still accepted as the fallback.
      { linking_value: 'MRX (Risk)', application_id: 'app-mrx', match_status: 'manual' },
    ]);
    expect(result.rows).toHaveLength(2);
    expect(result.droppedCount).toBe(0);

    const dep = result.rows[0];
    expect(dep.linking_value).toBe('HiFi');
    expect(dep.entity_id).toBe('svc-hifi-web');
    expect(dep.match_status).toBe('auto');
    expect(dep.severity_raw).toBe('medium');
    expect(dep.cve_ids).toEqual(['CVE-2024-38808']);
    expect(dep.cwe_ids).toEqual(['CWE-770']);
    expect(dep.other_identifiers).toEqual(['GHSA-9cmq-m9j5-mvww', 'Gemnasium-f80ff2b5']);
    expect(dep.location).toBe('batch/pom.xml');
    expect(dep.detected_at).toBe('2026-03-19T06:51:18.000Z');
    expect(dep.source_finding_id).toBe('4131704');
    expect(dep.cvss_vector_reported).toContain('NVD=CVSS:3.1');

    const sast = result.rows[1];
    expect(sast.entity_id).toBe('app-mrx');
    expect(sast.match_status).toBe('manual');
    expect(sast.cve_ids).toEqual([]);
    expect(sast.cwe_ids).toEqual(['CWE-89']);
    expect(sast.location).toBe('batch/src/main/java/COBDatePrevSQLPrinter.java:32');

    // No resolution entry -> kept as unmatched (the Not-matched bucket).
    const unresolved = normalizeSecurityRows(files, mapping, []);
    expect(unresolved.rows.every((r) => r.match_status === 'unmatched')).toBe(true);
    expect(unresolved.rows.every((r) => r.entity_id === null)).toBe(true);
  });

  it('requires linking_value + severity mappings and counts empty-linking rows as dropped', () => {
    expect(() => normalizeSecurityRows(files, { Severity: 'severity' }, [])).toThrow(
      /linking_value/,
    );
    expect(() =>
      normalizeSecurityRows(files, { 'Project Name': 'linking_value' }, []),
    ).toThrow(/severity/);

    const blankRow = DEP_ROW.replace('GRH,HiFi,', 'GRH,,');
    const withBlank = [parseSecurityFile(gitlabCsv([blankRow, SAST_ROW]), 'c.csv')];
    const result = normalizeSecurityRows(withBlank, mapping, []);
    expect(result.rows).toHaveLength(1);
    expect(result.droppedCount).toBe(1);
    expect(result.notes).toContain('empty linking value');
  });
});
