/**
 * SecurityView tests
 *
 * Spec: 2026-06-24 Vulnerability store + manual capture + current-state view
 *       (Spec 1 of 6) -- Task Group 5 (5.1). Focused on the critical
 *       behaviors only (2-8 tests max):
 *   - the report table renders one row per vulnerability with the normalized
 *     severity badge (raw value available on hover) and a matched vs
 *     unmatched/orphan match-status indicator;
 *   - the severity roll-up renders the per-bucket counts (from the util);
 *   - group-by-library renders the per-library grouping with a DISTINCT
 *     "Unmatched / orphan" section;
 *   - the upload control POSTs a picked CSV/XLSX/JSON file and surfaces the
 *     ingested / dropped / matched counts on success.
 *
 * The API client + contexts are mocked so the test asserts the view's wiring
 * and rendering, not the network/parse plumbing (covered by Task Groups 1-4).
 *
 * Task Group 6 (gap-fill, sub-task 6.3) adds one end-to-end view test in the
 * "Task 6 end-to-end" describe block: a re-upload must replace the latest view
 * (table + roll-up + group-by) with the NEW report's rows from the user's seat
 * -- the replace-latest-keep-history workflow as the Security tab surfaces it.
 *
 * Spec 2 (Automated Vulnerability Enrichment) -- Task Group 6 (6.1) adds the
 * "Spec 2 enrichment surfaces" describe block: the "Scan for vulnerabilities"
 * button posts to the gateway proxy trigger route; the quiet "automated
 * enrichment unavailable" signal renders as an INFORMATIONAL note (not a
 * blocking error); a row with empty/unknown fixed_in_versions renders
 * "remaining -- fix version unknown" and a row's source badge renders.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: vi.fn(),
}));

vi.mock('../../api/vulnerabilitiesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/vulnerabilitiesApi')>(
    '../../api/vulnerabilitiesApi',
  );
  return {
    ...actual,
    listVulnerabilities: vi.fn(),
    listVulnerabilityReports: vi.fn(),
    uploadVulnerabilityReport: vi.fn(),
    scanVulnerabilities: vi.fn(),
  };
});

import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import {
  listVulnerabilities,
  listVulnerabilityReports,
  uploadVulnerabilityReport,
  scanVulnerabilities,
  type VulnerabilityDto,
  type VulnerabilitySearchResponse,
  type VulnerabilityReportSummaryDto,
  type ScanVulnerabilitiesResponse,
} from '../../api/vulnerabilitiesApi';
import { SecurityView } from './SecurityView';

const PROJECT_ID = 'proj-sec-1';
const ARCH_ID = 'arch-sec-1';

function makeRow(overrides: Partial<VulnerabilityDto>): VulnerabilityDto {
  return {
    id: 'v-' + Math.random().toString(36).slice(2),
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    report_id: 'rep-1',
    ingested_at: '2026-06-24T10:00:00Z',
    cve_id: null,
    cwe: null,
    title: null,
    details: null,
    cvss: null,
    severity: 'info',
    severity_raw: null,
    affected_coordinate: null,
    ecosystem: null,
    affected_version: null,
    affected_version_range: null,
    fixed_in_versions: [],
    source: 'internal_report',
    raw_row: null,
    match_status: 'unmatched',
    matched_library_id: null,
    matched_declared_version: null,
    ...overrides,
  };
}

// Two matched rows under different coordinates + one unmatched/orphan row.
const ROWS: VulnerabilityDto[] = [
  makeRow({
    id: 'v1',
    cve_id: 'CVE-2024-1111',
    title: 'Critical RCE in libfoo',
    severity: 'critical',
    severity_raw: 'CRITICAL (9.8)',
    affected_coordinate: 'org.example:libfoo',
    affected_version: '1.2.3',
    fixed_in_versions: ['1.2.4'],
    source: 'internal_report',
    match_status: 'matched',
    matched_library_id: 'lib-foo',
    matched_declared_version: '1.2.3',
  }),
  makeRow({
    id: 'v2',
    cve_id: 'CVE-2024-2222',
    title: 'Medium XSS in libbar',
    severity: 'medium',
    severity_raw: 'moderate',
    affected_coordinate: 'org.example:libbar',
    source: 'internal_report',
    match_status: 'matched',
    matched_library_id: 'lib-bar',
    matched_declared_version: '2.0.0',
  }),
  makeRow({
    id: 'v3',
    cve_id: 'CVE-2024-3333',
    title: 'High issue in orphaned pkg',
    severity: 'high',
    severity_raw: 'High',
    affected_coordinate: 'org.example:orphan',
    source: 'automated',
    match_status: 'unmatched',
  }),
];

function listResponse(items: VulnerabilityDto[]): VulnerabilitySearchResponse {
  return { items, total: items.length, page: 0, size: 50 };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Sec project',
  } as unknown as ReturnType<typeof useProject>);
  vi.mocked(useActiveArchitectureId).mockReturnValue(ARCH_ID);
  vi.mocked(listVulnerabilities).mockResolvedValue(listResponse(ROWS));
  vi.mocked(listVulnerabilityReports).mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderView() {
  return render(
    <MemoryRouter
      initialEntries={[`/projects/${PROJECT_ID}/architectures/${ARCH_ID}/security`]}
    >
      <SecurityView />
    </MemoryRouter>,
  );
}

describe('SecurityView (Task 5.1)', () => {
  it('renders one report-table row per vulnerability with severity badge (raw on hover) and match-status indicator', async () => {
    renderView();

    // One data row per vulnerability.
    const rows = await screen.findAllByTestId('vuln-row');
    expect(rows).toHaveLength(3);

    // Severity badge shows the normalized bucket; the raw value is on hover
    // (native title) so it is never lost.
    const critRow = rows.find((r) => r.getAttribute('data-vuln-id') === 'v1')!;
    const critBadge = within(critRow).getByTestId('vuln-severity-badge');
    expect(critBadge).toHaveTextContent(/critical/i);
    expect(critBadge.getAttribute('data-severity')).toBe('critical');
    expect(critBadge.getAttribute('title')).toContain('CRITICAL (9.8)');

    // Match-status indicator: matched on v1, unmatched/orphan on v3.
    expect(within(critRow).getByTestId('vuln-match-badge').getAttribute('data-match-status')).toBe(
      'matched',
    );
    const orphanRow = rows.find((r) => r.getAttribute('data-vuln-id') === 'v3')!;
    const orphanBadge = within(orphanRow).getByTestId('vuln-match-badge');
    expect(orphanBadge.getAttribute('data-match-status')).toBe('unmatched');
    expect(orphanBadge).toHaveTextContent(/unmatched/i);
  });

  it('renders the severity roll-up with the correct per-bucket counts', async () => {
    renderView();
    await screen.findAllByTestId('vuln-row');

    // One critical + one medium + one high across the latest report.
    expect(screen.getByTestId('vuln-rollup-critical').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('vuln-rollup-high').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('vuln-rollup-medium').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('vuln-rollup-low').getAttribute('data-count')).toBe('0');
    expect(screen.getByTestId('vuln-rollup-info').getAttribute('data-count')).toBe('0');
    expect(screen.getByTestId('vuln-rollup-total').getAttribute('data-count')).toBe('3');
  });

  it('groups by library and renders a DISTINCT unmatched/orphan section', async () => {
    renderView();
    await screen.findAllByTestId('vuln-row');

    // Two matched coordinates -> two library groups (sorted by coordinate).
    const libGroups = screen.getAllByTestId('vuln-group-library');
    expect(libGroups).toHaveLength(2);
    const coords = libGroups.map((g) => g.getAttribute('data-coordinate'));
    expect(coords).toEqual(['org.example:libbar', 'org.example:libfoo']);

    // The unmatched/orphan group is rendered as its own distinct section,
    // NOT folded into the matched coordinates.
    const orphanGroup = screen.getByTestId('vuln-group-unmatched');
    expect(orphanGroup).toBeInTheDocument();
    expect(orphanGroup).toHaveTextContent(/unmatched \/ orphan/i);
  });

  it('upload control POSTs a picked file and surfaces ingested/dropped/matched counts on success', async () => {
    const summary: VulnerabilityReportSummaryDto = {
      report: {
        id: 'rep-2',
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        source: 'internal_report',
        original_filename: 'sca.csv',
        format: 'csv',
        uploaded_at: '2026-06-24T11:00:00Z',
        is_latest: true,
        row_count_ingested: 5,
        row_count_dropped: 2,
        parse_strategy: 'column_mapping',
        notes: 'collapsed 2 duplicate rows',
      },
      rows_received: 7,
      ingested_count: 5,
      dropped_duplicates: 2,
      dropped_unparseable: 0,
      matched_count: 3,
      unmatched_count: 2,
    };
    vi.mocked(uploadVulnerabilityReport).mockResolvedValue(summary);

    renderView();
    await screen.findAllByTestId('vuln-row');

    const fileInput = screen.getByTestId('vuln-upload-file-input') as HTMLInputElement;
    const file = new File(['cve_id,severity\nCVE-1,high\n'], 'sca.csv', { type: 'text/csv' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // The client was called with the picked file for this scope.
    await waitFor(() => expect(uploadVulnerabilityReport).toHaveBeenCalledTimes(1));
    expect(uploadVulnerabilityReport).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, file);

    // Ingested / dropped / matched counts surface (no-silent-drop is visible).
    const summaryEl = await screen.findByTestId('vuln-upload-summary');
    expect(within(summaryEl).getByTestId('vuln-upload-ingested')).toHaveTextContent('5');
    expect(within(summaryEl).getByTestId('vuln-upload-dropped')).toHaveTextContent('2');
    expect(within(summaryEl).getByTestId('vuln-upload-matched')).toHaveTextContent('3');
    expect(within(summaryEl).getByTestId('vuln-upload-unmatched')).toHaveTextContent('2');

    // A successful upload triggers a re-fetch of the latest list (replace-latest).
    await waitFor(() => expect(vi.mocked(listVulnerabilities).mock.calls.length).toBeGreaterThan(1));
  });
});

// ============================================================================
// Task Group 6 (gap-fill 6.3) -- end-to-end view: replace-latest-keep-history
// reflected in the Security tab from the user's seat.
// ============================================================================
describe('SecurityView Task 6 end-to-end (replace-latest reflected in the latest view)', () => {
  it('after a re-upload, the table + severity roll-up + group-by-library all reflect the NEW latest report (the stale rows are gone)', async () => {
    // The "stale" first report: a single low-severity matched row.
    const STALE: VulnerabilityDto[] = [
      makeRow({
        id: 'old1',
        cve_id: 'CVE-OLD-0001',
        title: 'Stale low finding',
        severity: 'low',
        severity_raw: 'low',
        affected_coordinate: 'org.example:stale',
        source: 'internal_report',
        match_status: 'matched',
        matched_library_id: 'lib-stale',
        matched_declared_version: '0.9.0',
      }),
    ];
    // The corrected report (the new latest): two matched + one orphan, no overlap.
    const CORRECTED: VulnerabilityDto[] = [
      makeRow({
        id: 'new1',
        cve_id: 'CVE-NEW-1111',
        title: 'Critical in alpha',
        severity: 'critical',
        severity_raw: 'critical',
        affected_coordinate: 'org.example:alpha',
        source: 'internal_report',
        match_status: 'matched',
        matched_library_id: 'lib-alpha',
        matched_declared_version: '1.0.0',
      }),
      makeRow({
        id: 'new2',
        cve_id: 'CVE-NEW-2222',
        title: 'High in beta',
        severity: 'high',
        severity_raw: 'high',
        affected_coordinate: 'org.example:beta',
        source: 'internal_report',
        match_status: 'matched',
        matched_library_id: 'lib-beta',
        matched_declared_version: '2.0.0',
      }),
      makeRow({
        id: 'new3',
        cve_id: 'CVE-NEW-3333',
        title: 'Medium orphan',
        severity: 'medium',
        severity_raw: 'medium',
        affected_coordinate: 'org.example:ghost',
        source: 'automated',
        match_status: 'unmatched',
      }),
    ];

    // First load returns the stale report; every load AFTER the upload returns
    // the corrected report (the server replaced the latest).
    vi.mocked(listVulnerabilities)
      .mockResolvedValueOnce(listResponse(STALE))
      .mockResolvedValue(listResponse(CORRECTED));

    const summary: VulnerabilityReportSummaryDto = {
      report: {
        id: 'rep-corrected',
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        source: 'internal_report',
        original_filename: 'corrected.csv',
        format: 'csv',
        uploaded_at: '2026-06-24T12:00:00Z',
        is_latest: true,
        row_count_ingested: 3,
        row_count_dropped: 0,
        parse_strategy: 'column_mapping',
        notes: null,
      },
      rows_received: 3,
      ingested_count: 3,
      dropped_duplicates: 0,
      dropped_unparseable: 0,
      matched_count: 2,
      unmatched_count: 1,
    };
    vi.mocked(uploadVulnerabilityReport).mockResolvedValue(summary);

    renderView();

    // -- Initial (stale) view: the one old row + a low-only roll-up. --
    await waitFor(() =>
      expect(screen.getByTestId('vuln-rollup-total').getAttribute('data-count')).toBe('1'),
    );
    expect(screen.getByTestId('vuln-rollup-low').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('vuln-rollup-critical').getAttribute('data-count')).toBe('0');
    let rows = screen.getAllByTestId('vuln-row');
    expect(rows.map((r) => r.getAttribute('data-vuln-id'))).toEqual(['old1']);

    // -- Re-upload a corrected report. --
    const fileInput = screen.getByTestId('vuln-upload-file-input') as HTMLInputElement;
    const file = new File(['cve_id,severity\nCVE-NEW-1111,critical\n'], 'corrected.csv', {
      type: 'text/csv',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => expect(uploadVulnerabilityReport).toHaveBeenCalledTimes(1));

    // -- The latest view now reflects ONLY the new report. --
    await waitFor(() =>
      expect(screen.getByTestId('vuln-rollup-total').getAttribute('data-count')).toBe('3'),
    );
    // Roll-up recomputed over the NEW rows (the stale "low" is gone).
    expect(screen.getByTestId('vuln-rollup-critical').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('vuln-rollup-high').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('vuln-rollup-medium').getAttribute('data-count')).toBe('1');
    expect(screen.getByTestId('vuln-rollup-low').getAttribute('data-count')).toBe('0');

    // The table shows the new rows; the stale row is no longer rendered.
    rows = screen.getAllByTestId('vuln-row');
    expect(rows.map((r) => r.getAttribute('data-vuln-id')).sort()).toEqual([
      'new1',
      'new2',
      'new3',
    ]);
    expect(screen.queryByText('CVE-OLD-0001')).not.toBeInTheDocument();

    // Group-by-library reflects the new matched coordinates + the distinct orphan.
    const libGroups = screen.getAllByTestId('vuln-group-library');
    expect(libGroups.map((g) => g.getAttribute('data-coordinate'))).toEqual([
      'org.example:alpha',
      'org.example:beta',
    ]);
    expect(screen.getByTestId('vuln-group-unmatched')).toBeInTheDocument();
  });
});

// ============================================================================
// Spec 2 (Automated Vulnerability Enrichment) -- Task Group 6 (6.1):
// the minimal enrichment surfaces layered onto the Spec 1 Security tab.
// ============================================================================
describe('SecurityView Spec 2 enrichment surfaces (Task 6.1)', () => {
  it('the "Scan for vulnerabilities" button posts to the gateway proxy trigger route, then re-pulls the rows', async () => {
    const available: ScanVulnerabilitiesResponse = {
      status: 'ok',
      availability: {
        available: true,
        note: 'Automated vulnerability enrichment ran: 4 automated finding(s) from 6 OSV advisory/advisories across 12 queried coordinate(s).',
        queriesBuilt: 12,
        excluded: 1,
        advisoriesFound: 6,
        rowsMinted: 4,
        internalRowsEnriched: 1,
        unknownFixRows: 1,
      },
    };
    vi.mocked(scanVulnerabilities).mockResolvedValue(available);

    renderView();
    await screen.findAllByTestId('vuln-row');
    const loadsBeforeScan = vi.mocked(listVulnerabilities).mock.calls.length;

    // The button triggers the on-demand scan via the gateway proxy route.
    const scanButton = screen.getByTestId('vuln-scan-button');
    expect(scanButton).toHaveTextContent(/scan for vulnerabilities/i);
    fireEvent.click(scanButton);

    await waitFor(() => expect(scanVulnerabilities).toHaveBeenCalledTimes(1));
    // Posts for THIS scope, with refresh (re-pull) requested.
    expect(scanVulnerabilities).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID, { refresh: true });

    // The available note renders informationally (success), and the rows are re-pulled.
    const note = await screen.findByTestId('vuln-scan-note-available');
    expect(note.getAttribute('data-available')).toBe('true');
    expect(note).toHaveTextContent(/automated vulnerability enrichment ran/i);
    await waitFor(() =>
      expect(vi.mocked(listVulnerabilities).mock.calls.length).toBeGreaterThan(loadsBeforeScan),
    );
  });

  it('renders the quiet "automated enrichment unavailable" signal as an INFORMATIONAL note, not a blocking error', async () => {
    const unavailable: ScanVulnerabilitiesResponse = {
      status: 'unavailable',
      availability: {
        available: false,
        reason: 'proxy',
        note: 'Automated enrichment unavailable (proxy). The Security view continues on the internal report alone; only the automated badged set is absent.',
        queriesBuilt: 0,
        excluded: 0,
        advisoriesFound: 0,
        rowsMinted: 0,
        internalRowsEnriched: 0,
        unknownFixRows: 0,
      },
    };
    vi.mocked(scanVulnerabilities).mockResolvedValue(unavailable);

    renderView();
    await screen.findAllByTestId('vuln-row');

    fireEvent.click(screen.getByTestId('vuln-scan-button'));

    const note = await screen.findByTestId('vuln-enrichment-unavailable');
    // Informational only: role="status" (NOT role="alert"); data-available=false.
    expect(note.getAttribute('data-available')).toBe('false');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.getAttribute('role')).not.toBe('alert');
    expect(note).toHaveTextContent(/automated enrichment unavailable/i);
    expect(note).toHaveTextContent(/continues on the internal report alone/i);

    // The Security view stays fully usable: the manual/internal rows still render
    // (the degraded scan never blanked the table).
    expect(screen.getAllByTestId('vuln-row')).toHaveLength(3);
  });

  it('renders "remaining — fix version unknown" for an empty fixed_in_versions row and renders the source badge (internal_report + automated)', async () => {
    // v1 has a known fix (1.2.4); v2 + v3 have empty fixed_in_versions.
    renderView();
    const rows = await screen.findAllByTestId('vuln-row');

    // The fixed row shows its version, NOT the unknown label.
    const fixedRow = rows.find((r) => r.getAttribute('data-vuln-id') === 'v1')!;
    expect(within(fixedRow).getByTestId('vuln-fixed-in')).toHaveTextContent('1.2.4');
    expect(within(fixedRow).queryByTestId('vuln-fix-unknown')).toBeNull();

    // The no-fix rows show "remaining — fix version unknown" (never blank).
    const noFixRow = rows.find((r) => r.getAttribute('data-vuln-id') === 'v2')!;
    const unknown = within(noFixRow).getByTestId('vuln-fix-unknown');
    expect(unknown).toHaveTextContent(/remaining\s+—\s+fix version unknown/i);

    // Source badges render per row (internal_report on v1, automated on v3).
    expect(within(fixedRow).getByTestId('vuln-source-badge').getAttribute('data-source')).toBe(
      'internal_report',
    );
    const automatedRow = rows.find((r) => r.getAttribute('data-vuln-id') === 'v3')!;
    expect(within(automatedRow).getByTestId('vuln-source-badge').getAttribute('data-source')).toBe(
      'automated',
    );
  });
});
