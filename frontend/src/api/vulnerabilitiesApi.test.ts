/**
 * Tests for the Vulnerabilities API Client.
 *
 * Spec: 2026-06-24 Vulnerability store + manual capture + current-state view
 *       (Spec 1 of 6) -- Task Group 4 (4.1). Focused on the critical behaviors:
 *   - the client parses a snake_case AMS list payload into the typed shape
 *     (the locked Spec-4 field names round-trip);
 *   - the list filters serialize onto the gateway querystring with the
 *     snake_case keys the AMS controller declares (`match_status`,
 *     `affected_coordinate`);
 *   - the upload posts a multipart body with the `file` field (and no
 *     hand-set Content-Type) and returns the report summary;
 *   - a roll-up computed over the parsed `items` matches the server-reported
 *     `severity_counts` (the client + util agree on the same wire).
 *
 * Spec 2 (Automated Vulnerability Enrichment) -- Task Group 6 adds two focused
 * `scanVulnerabilities` tests: the trigger POSTs to the gateway proxy
 * `.../vulnerabilities/scan` route with the refresh body and returns the
 * availability signal; and the STRICTLY NON-BLOCKING degradation -- a transport
 * failure resolves to the quiet "automated enrichment unavailable" signal rather
 * than throwing.
 *
 * The fetch-stubbing harness mirrors `discoveryApi.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  listVulnerabilities,
  listVulnerabilityReports,
  getVulnerabilityRollup,
  uploadVulnerabilityReport,
  scanVulnerabilities,
  VulnerabilitiesApiError,
  type VulnerabilitySearchResponse,
  type VulnerabilityReportSummaryDto,
  type VulnerabilityRollupDto,
} from './vulnerabilitiesApi';
import { computeVulnerabilityRollup } from '../utils/vulnerabilityRollup';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-9';

function okJson(body: unknown) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: () => Promise.resolve(body),
  };
}

describe('vulnerabilitiesApi', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.resetAllMocks();
  });

  it('parses a snake_case list payload into the typed shape (locked Spec-4 fields intact)', async () => {
    const payload: VulnerabilitySearchResponse = {
      items: [
        {
          id: 'v1',
          project_id: PROJECT_ID,
          architecture_id: ARCH_ID,
          report_id: 'r1',
          ingested_at: '2026-06-24T10:00:00Z',
          cve_id: 'CVE-2024-0001',
          cwe: 'CWE-79',
          title: 'XSS',
          details: 'detail',
          cvss: 9.1,
          severity: 'critical',
          severity_raw: 'Critical',
          affected_coordinate: 'org.example:alpha',
          ecosystem: 'MAVEN',
          affected_version: '1.2.3',
          affected_version_range: '<1.3.0',
          fixed_in_versions: ['1.3.0'],
          source: 'internal_report',
          raw_row: { Package: 'alpha', Severity: 'Critical' },
          match_status: 'matched',
          matched_library_id: 'lib-alpha',
          matched_declared_version: '1.2.3',
        },
      ],
      total: 1,
      page: 0,
      size: 50,
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(okJson(payload));

    const result = await listVulnerabilities(PROJECT_ID, ARCH_ID);

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/vulnerabilities`,
    );
    expect(options.method).toBe('GET');
    expect(result.total).toBe(1);
    const row = result.items[0];
    // The locked cross-spec fields survive parsing with their snake_case names.
    expect(row.affected_version).toBe('1.2.3');
    expect(row.affected_version_range).toBe('<1.3.0');
    expect(row.fixed_in_versions).toEqual(['1.3.0']);
    expect(row.matched_declared_version).toBe('1.2.3');
    expect(row.severity_raw).toBe('Critical');
    expect(row.raw_row).toEqual({ Package: 'alpha', Severity: 'Critical' });
  });

  it('serializes list filters onto the querystring with the AMS snake_case keys', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      okJson({ items: [], total: 0, page: 1, size: 25 }),
    );

    await listVulnerabilities(PROJECT_ID, ARCH_ID, {
      severity: 'high',
      match_status: 'unmatched',
      source: 'internal_report',
      affected_coordinate: 'org.example:alpha',
      text: 'xss',
      page: 1,
      size: 25,
    });

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    const qs = new URL(url, 'http://x').searchParams;
    expect(qs.get('severity')).toBe('high');
    expect(qs.get('match_status')).toBe('unmatched');
    expect(qs.get('source')).toBe('internal_report');
    expect(qs.get('affected_coordinate')).toBe('org.example:alpha');
    expect(qs.get('text')).toBe('xss');
    expect(qs.get('page')).toBe('1');
    expect(qs.get('size')).toBe('25');
  });

  it('omits empty filters from the querystring', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      okJson({ items: [], total: 0, page: 0, size: 50 }),
    );

    await listVulnerabilities(PROJECT_ID, ARCH_ID, { severity: '', text: '   ' });

    const [url] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/vulnerabilities`,
    );
    expect(url.includes('?')).toBe(false);
  });

  it('uploads a multipart report (field "file", no hand-set Content-Type) and returns the summary', async () => {
    const summary: VulnerabilityReportSummaryDto = {
      report: {
        id: 'r1',
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        source: 'internal_report',
        original_filename: 'scan.csv',
        format: 'csv',
        uploaded_at: '2026-06-24T10:00:00Z',
        is_latest: true,
        row_count_ingested: 12,
        row_count_dropped: 3,
        parse_strategy: 'column_mapping',
        notes: 'collapsed 2 dupes; 1 unparseable',
      },
      rows_received: 15,
      ingested_count: 12,
      dropped_duplicates: 2,
      dropped_unparseable: 1,
      matched_count: 9,
      unmatched_count: 3,
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 201,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(summary),
    });

    const file = new File(['Package,Severity\nalpha,Critical\n'], 'scan.csv', {
      type: 'text/csv',
    });
    const result = await uploadVulnerabilityReport(PROJECT_ID, ARCH_ID, file, {
      source: 'internal_report',
    });

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/vulnerabilities/reports`,
    );
    expect(options.method).toBe('POST');
    // Multipart body -> FormData carrying the `file` (+ rider `source`) field.
    expect(options.body).toBeInstanceOf(FormData);
    const fd = options.body as FormData;
    expect(fd.get('file')).toBeInstanceOf(File);
    expect((fd.get('file') as File).name).toBe('scan.csv');
    expect(fd.get('source')).toBe('internal_report');
    // The browser sets the multipart boundary -- the client must NOT.
    expect(options.headers).toBeUndefined();
    // No-silent-drop visibility surfaces in the summary.
    expect(result.dropped_duplicates).toBe(2);
    expect(result.dropped_unparseable).toBe(1);
    expect(result.matched_count).toBe(9);
  });

  it('throws a typed VulnerabilitiesApiError on a non-2xx upload (e.g. 422 unparseable)', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 422,
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ error: { code: 422, message: 'Empty report' } }),
    });

    const file = new File([''], 'empty.csv', { type: 'text/csv' });
    let caught: unknown;
    try {
      await uploadVulnerabilityReport(PROJECT_ID, ARCH_ID, file);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(VulnerabilitiesApiError);
    expect((caught as VulnerabilitiesApiError).status).toBe(422);
    // The gateway { error: {...} } envelope is unwrapped onto the typed body.
    expect((caught as VulnerabilitiesApiError).body.message).toBe('Empty report');
  });

  it('fetches report history and the rollup; a roll-up over list items agrees with the server severity_counts', async () => {
    // -- history --
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      okJson([
        {
          id: 'r2',
          project_id: PROJECT_ID,
          architecture_id: ARCH_ID,
          source: 'internal_report',
          original_filename: 'newer.csv',
          format: 'csv',
          uploaded_at: '2026-06-24T12:00:00Z',
          is_latest: true,
          row_count_ingested: 2,
          row_count_dropped: 0,
          parse_strategy: 'whole_doc',
          notes: null,
        },
      ]),
    );
    const history = await listVulnerabilityReports(PROJECT_ID, ARCH_ID);
    const [histUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(histUrl).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/vulnerabilities/reports`,
    );
    expect(history[0].is_latest).toBe(true);

    // -- rollup --
    const rollup: VulnerabilityRollupDto = {
      report_id: 'r2',
      total: 2,
      severity_counts: { info: 0, low: 0, medium: 0, high: 1, critical: 1 },
      by_library: [
        {
          coordinate: 'org.example:alpha',
          library_id: 'lib-alpha',
          total: 1,
          severity_counts: { info: 0, low: 0, medium: 0, high: 0, critical: 1 },
        },
      ],
      unmatched: {
        coordinate: '__unmatched__',
        library_id: null,
        total: 1,
        severity_counts: { info: 0, low: 0, medium: 0, high: 1, critical: 0 },
      },
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(okJson(rollup));
    const serverRollup = await getVulnerabilityRollup(PROJECT_ID, ARCH_ID);
    const [rollupUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [string];
    expect(rollupUrl).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/vulnerabilities/rollup`,
    );
    expect(serverRollup.unmatched?.coordinate).toBe('__unmatched__');

    // The client-side util over the equivalent rows agrees with the server.
    const clientRollup = computeVulnerabilityRollup([
      {
        severity: 'critical',
        match_status: 'matched',
        affected_coordinate: 'org.example:alpha',
        matched_library_id: 'lib-alpha',
      },
      { severity: 'high', match_status: 'unmatched', affected_coordinate: 'ghost:x' },
    ]);
    expect(clientRollup.severityCounts).toEqual(serverRollup.severity_counts);
    expect(clientRollup.unmatchedCount).toBe(serverRollup.unmatched?.total);
    expect(clientRollup.byLibrary[0].coordinate).toBe(serverRollup.by_library[0].coordinate);
  });

  // --------------------------------------------------------------------------
  // Spec 2 (Automated Vulnerability Enrichment) -- Task Group 6: the
  // "Scan for vulnerabilities" trigger + its strictly-non-blocking degradation.
  // --------------------------------------------------------------------------

  it('scanVulnerabilities POSTs to the gateway proxy /scan route with the refresh body and returns the availability signal', async () => {
    const body = {
      status: 'ok',
      availability: {
        available: true,
        note: 'Automated vulnerability enrichment ran: 2 automated finding(s) from 3 OSV advisory/advisories across 5 queried coordinate(s).',
        queriesBuilt: 5,
        excluded: 1,
        advisoriesFound: 3,
        rowsMinted: 2,
        internalRowsEnriched: 1,
        unknownFixRows: 1,
      },
      outcome: { status: 'ok', rowsMinted: 2 },
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(okJson(body));

    const result = await scanVulnerabilities(PROJECT_ID, ARCH_ID, { refresh: true });

    const [url, options] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // Posts to the gateway proxy trigger route (mirrors the discovery proxy).
    expect(url).toBe(
      `/api/v1/projects/${PROJECT_ID}/architectures/${ARCH_ID}/vulnerabilities/scan`,
    );
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body as string)).toEqual({ refresh: true });

    // The informational availability signal is surfaced for the UI roll-up.
    expect(result.availability.available).toBe(true);
    expect(result.availability.rowsMinted).toBe(2);
    expect(result.availability.unknownFixRows).toBe(1);
    expect(result.status).toBe('ok');
  });

  it('scanVulnerabilities is STRICTLY NON-BLOCKING: a transport failure resolves to the quiet "unavailable" signal instead of throwing', async () => {
    // Simulate the gateway / discovery-service being unreachable.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );

    // MUST resolve (never reject) -- the scan trigger can never error the view.
    const result = await scanVulnerabilities(PROJECT_ID, ARCH_ID);

    expect(result.availability.available).toBe(false);
    expect(result.status).toBe('unavailable');
    // The note is the calm, reassuring "continues on the internal report" copy.
    expect(result.availability.note).toMatch(/automated enrichment unavailable/i);
    expect(result.availability.note).toMatch(/continues on the internal report alone/i);
    // The transport detail is folded into the note (no silent swallow).
    expect(result.availability.note).toMatch(/ECONNREFUSED/);
  });
});
