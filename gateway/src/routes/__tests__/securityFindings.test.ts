/**
 * Tests for the Security Findings gateway route (Security health dashboard,
 * 2026-07-19, Spec 2 of 3).
 *
 * Critical plumbing:
 *  - parse preview: multi-file multipart in -> header union + proposed mapping
 *    + distinct linking values out (stateless; no AMS call);
 *  - ingest: multi-file multipart + wizard answers -> ONE appended report
 *    forwarded to the AMS security store on the snake_case wire, AMS summary
 *    piped back, enrichment kicked fire-and-forget;
 *  - enrichment cycle: pending stubs drained from AMS -> OSV -> enrichment
 *    POSTs; kill-switch honoured; transport failures leave stubs pending.
 */

import request from 'supertest';
import express from 'express';
import { securityFindingsRouter } from '../securityFindings';
import { runSecurityCveEnrichment } from '../../services/securityCveEnrichment';

jest.mock('../../services/logger', () => ({
  logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const mockConfig: {
  architectureModelServiceBaseUrl: string;
  osvApiBaseUrl: string;
  securityCveEnrichmentEnabled: boolean;
} = {
  architectureModelServiceBaseUrl: 'http://ams.test',
  osvApiBaseUrl: 'http://osv.test',
  securityCveEnrichmentEnabled: true,
};
jest.mock('../../config', () => ({
  getConfig: () => mockConfig,
}));

const GITLAB_CSV = [
  'Project Name,Severity,Vulnerability,CVE,CWE,Vulnerability ID',
  'DemoApp,medium,Spring DoS,CVE-2024-38808,CWE-770,4131704',
  'MRX (Risk),high,SQL Injection,,CWE-89,1949555',
].join('\n');

describe('Security Findings gateway route', () => {
  let app: express.Application;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfig.securityCveEnrichmentEnabled = true;
    app = express();
    app.use(express.json());
    app.use('/', securityFindingsRouter);
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
  });

  describe('POST .../security/uploads/parse', () => {
    it('returns header union, proposed mapping, generic attributes and distinct linking values without calling AMS', async () => {
      const res = await request(app)
        .post('/projects/p1/architectures/a1/security/uploads/parse')
        .attach('files', Buffer.from(GITLAB_CSV, 'utf-8'), 'export-a.csv')
        .attach('files', Buffer.from(GITLAB_CSV, 'utf-8'), 'export-b.csv');

      expect(res.status).toBe(200);
      expect(res.body.files).toHaveLength(2);
      expect(res.body.total_rows).toBe(4);
      expect(res.body.proposed_mapping['Project Name']).toBe('linking_value');
      expect(res.body.linking_column).toBe('Project Name');
      expect(res.body.distinct_linking_values).toEqual([
        { value: 'DemoApp', count: 2 },
        { value: 'MRX (Risk)', count: 2 },
      ]);
      expect(
        res.body.generic_attributes.find(
          (a: { name: string }) => a.name === 'linking_value',
        ).required,
      ).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects an empty upload with 400', async () => {
      const res = await request(app).post(
        '/projects/p1/architectures/a1/security/uploads/parse',
      );
      expect(res.status).toBe(400);
    });
  });

  describe('POST .../security/uploads/ingest', () => {
    it('normalizes + appends all files into ONE AMS report on the snake_case wire and pipes the summary back', async () => {
      // First fetch: AMS ingest. Later fetches: the fire-and-forget enrichment
      // kick (pending-queue read) -- answered empty so it terminates quietly.
      fetchMock.mockImplementation((url: string) => {
        if (url.includes('/security/reports')) {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ report_id: 'rep-1', row_count_ingested: 4 }),
          });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => [] });
      });

      const res = await request(app)
        .post('/projects/p1/architectures/a1/security/uploads/ingest')
        .field(
          'column_mapping',
          JSON.stringify({
            'Project Name': 'linking_value',
            Severity: 'severity',
            CVE: 'cve_ids',
            CWE: 'cwe_ids',
            Vulnerability: 'title',
            'Vulnerability ID': 'source_finding_id',
          }),
        )
        .field('association_level', 'application')
        .field(
          'resolutions',
          JSON.stringify([
            { linking_value: 'DemoApp', entity_id: 'app-demo', match_status: 'auto' },
            { linking_value: 'MRX (Risk)', entity_id: null, match_status: 'unmatched' },
          ]),
        )
        .attach('files', Buffer.from(GITLAB_CSV, 'utf-8'), 'export-a.csv')
        .attach('files', Buffer.from(GITLAB_CSV, 'utf-8'), 'export-b.csv');

      expect(res.status).toBe(201);
      expect(res.body.report_id).toBe('rep-1');

      const ingestCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes('/security/reports'),
      );
      expect(ingestCall).toBeDefined();
      expect(String(ingestCall![0])).toBe(
        'http://ams.test/api/model/projects/p1/architectures/a1/security/reports',
      );
      const body = JSON.parse((ingestCall![1] as { body: string }).body);
      expect(body.source).toBe('gitlab_export');
      expect(body.association_level).toBe('application');
      expect(body.original_filenames).toEqual(['export-a.csv', 'export-b.csv']);
      expect(body.column_mapping.Severity).toBe('severity');
      // The append: 2 files x 2 rows = 4 normalized rows in ONE report.
      expect(body.rows).toHaveLength(4);
      expect(body.rows[0]).toMatchObject({
        linking_value: 'DemoApp',
        entity_id: 'app-demo',
        match_status: 'auto',
        severity_raw: 'medium',
        cve_ids: ['CVE-2024-38808'],
        cwe_ids: ['CWE-770'],
        source_finding_id: '4131704',
      });
      expect(body.rows[1]).toMatchObject({
        linking_value: 'MRX (Risk)',
        entity_id: null,
        match_status: 'unmatched',
        cve_ids: [],
      });
    });

    it('rejects a missing column_mapping with 400 and pipes an AMS rejection through verbatim', async () => {
      const noMapping = await request(app)
        .post('/projects/p1/architectures/a1/security/uploads/ingest')
        .attach('files', Buffer.from(GITLAB_CSV, 'utf-8'), 'export.csv');
      expect(noMapping.status).toBe(400);

      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 422,
        json: async () => ({ error: 'bad rows' }),
      });
      const amsRejected = await request(app)
        .post('/projects/p1/architectures/a1/security/uploads/ingest')
        .field(
          'column_mapping',
          JSON.stringify({ 'Project Name': 'linking_value', Severity: 'severity' }),
        )
        .attach('files', Buffer.from(GITLAB_CSV, 'utf-8'), 'export.csv');
      expect(amsRejected.status).toBe(422);
      expect(amsRejected.body.error).toBe('bad rows');
    });
  });

  describe('CVE enrichment cycle', () => {
    it('drains pending stubs: OSV hit -> enriched POST, OSV 404 -> not_found POST, transport error -> left pending', async () => {
      fetchMock.mockImplementation((url: string) => {
        const u = String(url);
        if (u.includes('/cves/pending')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => [
              { cve_id: 'CVE-2024-1' },
              { cve_id: 'CVE-2024-2' },
              { cve_id: 'CVE-2024-3' },
            ],
          });
        }
        if (u.includes('osv.test/v1/vulns/CVE-2024-1')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              id: 'CVE-2024-1',
              summary: 'Something bad',
              details: 'Long form',
              aliases: ['GHSA-xx'],
              severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N' }],
              references: [{ type: 'WEB', url: 'https://example.com/adv' }],
              database_specific: { severity: 'MODERATE', cwe_ids: ['CWE-770'] },
            }),
          });
        }
        if (u.includes('osv.test/v1/vulns/CVE-2024-2')) {
          return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
        }
        if (u.includes('osv.test/v1/vulns/CVE-2024-3')) {
          return Promise.reject(new Error('ECONNREFUSED'));
        }
        if (u.includes('/enrichment')) {
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }
        return Promise.reject(new Error(`unexpected fetch ${u}`));
      });

      const result = await runSecurityCveEnrichment(10);
      expect(result).toMatchObject({ processed: 3, enriched: 1, notFound: 1, failed: 1 });

      const enrichmentCalls = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes('/enrichment'),
      );
      expect(enrichmentCalls).toHaveLength(2);
      const enrichedBody = JSON.parse(
        (enrichmentCalls.find((c) => String(c[0]).includes('CVE-2024-1'))![1] as {
          body: string;
        }).body,
      );
      expect(enrichedBody).toMatchObject({
        summary: 'Something bad',
        cvss_vector: 'CVSS:3.1/AV:N',
        severity_official: 'medium',
        cwe_ids: ['CWE-770'],
        aliases: ['GHSA-xx'],
        reference_urls: ['https://example.com/adv'],
        source: 'osv',
        enrichment_status: 'enriched',
      });
      const notFoundBody = JSON.parse(
        (enrichmentCalls.find((c) => String(c[0]).includes('CVE-2024-2'))![1] as {
          body: string;
        }).body,
      );
      expect(notFoundBody.enrichment_status).toBe('not_found');
    });

    it('honours the kill-switch and answers via the manual route', async () => {
      mockConfig.securityCveEnrichmentEnabled = false;
      const res = await request(app).post('/security/enrichment/run').send({ limit: 5 });
      expect(res.status).toBe(200);
      expect(res.body.disabled).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
