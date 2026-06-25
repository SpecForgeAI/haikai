/**
 * Tests for the Vulnerabilities gateway route
 *
 * Spec: 2026-06-24 Vulnerability store + manual capture + current-state view
 *       (Spec 1 of 6) -- Task Group 3, sub-task 3.1.
 *
 * Focus (critical plumbing only):
 *  - The upload route accepts a MULTIPART body, runs the (stubbed) parse, and
 *    forwards the parsed ROWS + parse_strategy + the no-silent-drop accounting
 *    (parser_dropped_count / parser_notes) as JSON to the AMS
 *    POST .../vulnerabilities/reports endpoint, piping the AMS summary back.
 *  - A read route (GET vulnerabilities) forwards JSON to the AMS architecture-
 *    scoped path WITH the incoming filter query string.
 *
 * The LLM client + the architecture-model-service are stubbed; the AMS call is
 * a stubbed global `fetch` so the test asserts the deterministic plumbing.
 *
 * Task Group 6 (gap-fill, sub-task 6.3) adds two end-to-end seam tests in the
 * "Task 6 end-to-end seams" describe block below:
 *  - the FULL forwarded-body contract (every AMS `IngestVulnerabilityRowDto`
 *    snake_case wire key, and no extra keys) -- the cross-runtime gateway->AMS
 *    contract no single-runtime test otherwise asserts; and
 *  - an XLSX upload driven THROUGH the real route + real SheetJS extraction +
 *    real deterministic column-mapping (the "incl. XLSX-to-rows" end-to-end
 *    clause), confirming the parser drop accounting propagates to the AMS body.
 */

import request from 'supertest';
import express from 'express';
import * as XLSX from 'xlsx';
import { vulnerabilitiesRouter } from '../vulnerabilities';

// Quiet logger.
jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// Config: the route only reads architectureModelServiceBaseUrl.
jest.mock('../../config', () => ({
  getConfig: () => ({ architectureModelServiceBaseUrl: 'http://ams.test' }),
}));

// LLM client: the upload path adapts this; we drive it to choose column-mapping
// so the deterministic extractor runs over the uploaded CSV.
const mockSendChatRequest = jest.fn();
jest.mock('../../services/llmClient', () => ({
  getLlmClient: () => ({
    sendChatRequest: (...args: unknown[]) => mockSendChatRequest(...args),
  }),
}));

describe('Vulnerabilities gateway route', () => {
  let app: express.Application;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    // Mount at root so the router-internal /projects/... paths match directly
    // (in server.ts the same router is mounted under /api/v1).
    app.use('/', vulnerabilitiesRouter);

    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  describe('POST .../vulnerabilities/reports (multipart upload + parse + forward)', () => {
    it('parses the uploaded CSV and forwards the parsed rows to AMS as JSON', async () => {
      // LLM chooses column-mapping for the clean CSV table.
      mockSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify({
          strategy: 'column_mapping',
          columnMapping: { cve_id: 'CVE', affected_coordinate: 'Package', severity_raw: 'Severity' },
        }),
      });

      // AMS ingest returns a 201 summary.
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => ({
          report: { id: 'rep-1', is_latest: true },
          rows_received: 2,
          ingested_count: 2,
          dropped_duplicates: 0,
          dropped_unparseable: 0,
          matched_count: 1,
          unmatched_count: 1,
        }),
      });

      const csv = ['CVE,Package,Severity', 'CVE-2024-1,com.acme:lib,High', 'CVE-2024-2,org.x:y,Low'].join('\n');

      const res = await request(app)
        .post('/projects/proj-1/architectures/arch-1/vulnerabilities/reports')
        .field('source', 'internal_report')
        .attach('file', Buffer.from(csv, 'utf-8'), 'scan.csv');

      // AMS summary piped back verbatim.
      expect(res.status).toBe(201);
      expect(res.body.report.id).toBe('rep-1');
      expect(res.body.matched_count).toBe(1);

      // Exactly one AMS call, to the architecture-scoped reports endpoint.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe(
        'http://ams.test/api/model/projects/proj-1/architectures/arch-1/vulnerabilities/reports',
      );
      expect(init.method).toBe('POST');

      // The forwarded body carries snake_case ingest fields + the parsed rows +
      // the no-silent-drop accounting.
      const forwarded = JSON.parse(init.body);
      expect(forwarded.source).toBe('internal_report');
      expect(forwarded.format).toBe('csv');
      expect(forwarded.parse_strategy).toBe('column_mapping');
      expect(typeof forwarded.parser_dropped_count).toBe('number');
      expect(typeof forwarded.parser_notes).toBe('string');
      expect(forwarded.rows).toHaveLength(2);
      expect(forwarded.rows[0].cve_id).toBe('CVE-2024-1');
      expect(forwarded.rows[0].affected_coordinate).toBe('com.acme:lib');
      // The LLM was consulted once for the whole document.
      expect(mockSendChatRequest).toHaveBeenCalledTimes(1);
    });

    it('returns 400 when no file part is supplied', async () => {
      const res = await request(app)
        .post('/projects/proj-1/architectures/arch-1/vulnerabilities/reports')
        .field('source', 'internal_report');

      expect(res.status).toBe(400);
      // No parse, no AMS call.
      expect(mockSendChatRequest).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('returns 400 for an unsupported file format', async () => {
      const res = await request(app)
        .post('/projects/proj-1/architectures/arch-1/vulnerabilities/reports')
        .attach('file', Buffer.from('whatever', 'utf-8'), 'report.txt');

      expect(res.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('GET reads (JSON pass-through to AMS)', () => {
    it('forwards GET vulnerabilities with the filter query string to AMS', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ content: [], total: 0 }),
      });

      const res = await request(app)
        .get('/projects/proj-1/architectures/arch-1/vulnerabilities')
        .query({ severity: 'high', match_status: 'unmatched', page: '0', size: '50' });

      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [calledUrl, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('GET');
      expect(calledUrl).toContain(
        'http://ams.test/api/model/projects/proj-1/architectures/arch-1/vulnerabilities',
      );
      // Incoming query string forwarded verbatim.
      expect(calledUrl).toContain('severity=high');
      expect(calledUrl).toContain('match_status=unmatched');
    });

    it('forwards GET reports to the AMS /reports sub-path', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => [],
      });

      const res = await request(app).get(
        '/projects/proj-1/architectures/arch-1/vulnerabilities/reports',
      );

      expect(res.status).toBe(200);
      const [calledUrl] = fetchMock.mock.calls[0];
      expect(calledUrl).toBe(
        'http://ams.test/api/model/projects/proj-1/architectures/arch-1/vulnerabilities/reports',
      );
    });

    it('returns 503 when AMS is unavailable', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const res = await request(app).get(
        '/projects/proj-1/architectures/arch-1/vulnerabilities/rollup',
      );

      expect(res.status).toBe(503);
    });
  });

  // ==========================================================================
  // Task Group 6 (gap-fill 6.3) -- end-to-end seam coverage
  //
  // These two tests close cross-runtime gaps that no per-layer test asserts:
  //   (A) the FULL gateway->AMS forwarded-row contract -- every key the AMS
  //       `IngestVulnerabilityRowDto` snake_case wire declares, and NO extra
  //       keys. A drift here type-checks green in both repos but breaks the
  //       real upload, so it is pinned explicitly.
  //   (B) an XLSX report driven THROUGH the real route: real multipart ->
  //       real SheetJS `flattenToText` (XLSX-to-rows) -> real deterministic
  //       column-mapping extraction -> forwarded AMS body, with the parser's
  //       no-silent-drop accounting (a note-only footer row) surfacing in
  //       `parser_dropped_count` / `parser_notes`.
  // ==========================================================================
  describe('Task 6 end-to-end seams', () => {
    /**
     * The EXACT snake_case wire key set the AMS `IngestVulnerabilityRowDto`
     * record deserializes (see
     * architecture-model-service/.../model/dto/vulnerability/IngestVulnerabilityRowDto.java
     * under the global SNAKE_CASE Jackson strategy). The gateway's
     * `ParsedVulnerabilityRow` must forward EXACTLY these keys.
     */
    const AMS_ROW_WIRE_KEYS = [
      'cve_id',
      'cwe',
      'title',
      'details',
      'cvss',
      'severity_raw',
      'affected_coordinate',
      'ecosystem',
      'affected_version',
      'affected_version_range',
      'fixed_in_versions',
      'native_advisory_id',
      'raw_row',
    ].sort();

    it('(A) forwards rows whose keys EXACTLY match the AMS IngestVulnerabilityRowDto snake_case wire (no drift, no extra keys)', async () => {
      // Map EVERY mappable field so the forwarded row is fully populated and a
      // missing/renamed key would be caught.
      mockSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify({
          strategy: 'column_mapping',
          columnMapping: {
            cve_id: 'CVE',
            cwe: 'CWE',
            title: 'Title',
            details: 'Details',
            cvss: 'CVSS',
            severity_raw: 'Severity',
            affected_coordinate: 'Package',
            ecosystem: 'Ecosystem',
            affected_version: 'Version',
            affected_version_range: 'Range',
            fixed_in_versions: 'Fixed',
            native_advisory_id: 'Advisory',
          },
        }),
      });

      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => ({ report: { id: 'rep-contract' }, ingested_count: 1 }),
      });

      // The Range cell carries an embedded comma, so it is double-quoted per CSV
      // rules; the parser's quote-aware CSV splitter keeps it as one field.
      const csv = [
        'CVE,CWE,Title,Details,CVSS,Severity,Package,Ecosystem,Version,Range,Fixed,Advisory',
        'CVE-2024-77,CWE-79,XSS,A detail,7.5,High,com.acme:lib,MAVEN,1.2.3,"[1.0.0,1.3.0)",1.3.0;2.0.0,GHSA-abcd',
      ].join('\n');

      const res = await request(app)
        .post('/projects/proj-1/architectures/arch-1/vulnerabilities/reports')
        .field('source', 'internal_report')
        .attach('file', Buffer.from(csv, 'utf-8'), 'scan.csv');

      expect(res.status).toBe(201);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [, init] = fetchMock.mock.calls[0];
      const forwarded = JSON.parse(init.body);

      // -- envelope-level contract the AMS IngestVulnerabilityReportRequest reads --
      expect(Object.keys(forwarded).sort()).toEqual(
        [
          'format',
          'original_filename',
          'parse_strategy',
          'parser_dropped_count',
          'parser_notes',
          'rows',
          'source',
        ].sort(),
      );

      // -- row-level contract: EXACTLY the AMS DTO snake_case keys, no drift --
      expect(forwarded.rows).toHaveLength(1);
      const row = forwarded.rows[0];
      expect(Object.keys(row).sort()).toEqual(AMS_ROW_WIRE_KEYS);

      // The locked Spec-4 / dedup-key fields carry their parsed values through.
      expect(row.cve_id).toBe('CVE-2024-77');
      expect(row.affected_coordinate).toBe('com.acme:lib');
      expect(row.affected_version).toBe('1.2.3');
      expect(row.affected_version_range).toBe('[1.0.0,1.3.0)');
      expect(row.native_advisory_id).toBe('GHSA-abcd');
      // fixed_in_versions splits the delimited cell into an array (AMS jsonb).
      expect(row.fixed_in_versions).toEqual(['1.3.0', '2.0.0']);
      // raw_row retains the verbatim source record for drill-down.
      expect(row.raw_row.CVE).toBe('CVE-2024-77');
      expect(row.raw_row.Advisory).toBe('GHSA-abcd');
    });

    it('(B) runs an XLSX upload through the REAL SheetJS extraction + column-mapping and forwards rows + propagated parser drops', async () => {
      // A real .xlsx workbook: a header row, two real data rows, and a note-only
      // footer row whose single populated cell is an UNMAPPED column -> it has
      // no coordinate and no id, so the deterministic extractor must COUNT it as
      // dropped (never silently discard it).
      const ws = XLSX.utils.aoa_to_sheet([
        ['CVE', 'Package', 'Severity', 'Note'],
        ['CVE-2024-100', 'com.acme:alpha', 'Critical', ''],
        ['CVE-2024-101', 'com.acme:beta', 'Low', ''],
        ['', '', '', 'scanner footer text -- not a vulnerability'],
      ]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Vulns');
      const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

      // The LLM (stubbed) chooses column-mapping over the SheetJS-flattened CSV.
      mockSendChatRequest.mockResolvedValueOnce({
        content: JSON.stringify({
          strategy: 'column_mapping',
          columnMapping: { cve_id: 'CVE', affected_coordinate: 'Package', severity_raw: 'Severity' },
        }),
      });

      // AMS echoes a summary; the body it RECEIVES is what this test asserts.
      fetchMock.mockResolvedValueOnce({
        ok: true,
        status: 201,
        headers: { get: () => 'application/json' },
        json: async () => ({
          report: { id: 'rep-xlsx', row_count_dropped: 1 },
          rows_received: 2,
          ingested_count: 2,
          dropped_unparseable: 1,
        }),
      });

      const res = await request(app)
        .post('/projects/proj-1/architectures/arch-1/vulnerabilities/reports')
        .attach('file', xlsxBuf, 'scan.xlsx');

      expect(res.status).toBe(201);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [, init] = fetchMock.mock.calls[0];
      const forwarded = JSON.parse(init.body);

      // The route detected XLSX (from the .xlsx extension) and recorded it.
      expect(forwarded.format).toBe('xlsx');
      expect(forwarded.parse_strategy).toBe('column_mapping');

      // The two real data rows were extracted via the SheetJS-> CSV-> mapping
      // path; the note-only footer row is NOT a forwarded row.
      expect(forwarded.rows).toHaveLength(2);
      expect(forwarded.rows.map((r: { cve_id: string }) => r.cve_id)).toEqual([
        'CVE-2024-100',
        'CVE-2024-101',
      ]);
      expect(forwarded.rows[0].affected_coordinate).toBe('com.acme:alpha');

      // No-silent-drop: the footer row is COUNTED + summarised, propagated so
      // AMS folds it into row_count_dropped + notes.
      expect(forwarded.parser_dropped_count).toBe(1);
      expect(forwarded.parser_notes).toContain('dropped_unparseable=1');
    });
  });
});
