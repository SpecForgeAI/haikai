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
  useArchitectureContext: vi.fn(),
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
    getVulnerabilityRollup: vi.fn(),
  };
});

import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId, useArchitectureContext } from '../../contexts/ArchitectureContext';
import {
  listVulnerabilities,
  listVulnerabilityReports,
  uploadVulnerabilityReport,
  scanVulnerabilities,
  getVulnerabilityRollup,
  type VulnerabilityDto,
  type VulnerabilitySearchResponse,
  type VulnerabilityReportSummaryDto,
  type VulnerabilityRollupDto,
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
    source_finding_id: null,
    location: null,
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

// A server roll-up DTO that mirrors the three default ROWS exactly (one
// critical matched libfoo, one medium matched libbar, one high unmatched) so
// the GRAND-TOTAL strip (FIX 1) renders the same counts the page would -- the
// existing roll-up assertions stay valid while the strip is now server-fed.
const DEFAULT_ROLLUP_DTO: VulnerabilityRollupDto = {
  report_id: 'rep-1',
  total: 3,
  // Keep-all-rows model: total_findings (all kept rows) + distinct_cves ride
  // ALONGSIDE the unique-unit severity_counts. Here each row is a distinct CVE
  // under a distinct coordinate, so all three figures coincide at 3.
  total_findings: 3,
  distinct_cves: 3,
  severity_counts: { info: 0, low: 0, medium: 1, high: 1, critical: 1 },
  by_library: [
    {
      coordinate: 'org.example:libbar',
      library_id: 'lib-bar',
      total: 1,
      severity_counts: { info: 0, low: 0, medium: 1, high: 0, critical: 0 },
    },
    {
      coordinate: 'org.example:libfoo',
      library_id: 'lib-foo',
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useProject).mockReturnValue({
    id: PROJECT_ID,
    name: 'Sec project',
  } as unknown as ReturnType<typeof useProject>);
  vi.mocked(useActiveArchitectureId).mockReturnValue(ARCH_ID);
  vi.mocked(useArchitectureContext).mockReturnValue({
    architectures: [{ id: ARCH_ID, name: 'Current State', archived: false }],
    setActiveArchitecture: vi.fn(),
  } as unknown as ReturnType<typeof useArchitectureContext>);
  vi.mocked(listVulnerabilities).mockResolvedValue(listResponse(ROWS));
  vi.mocked(listVulnerabilityReports).mockResolvedValue([]);
  vi.mocked(getVulnerabilityRollup).mockResolvedValue(DEFAULT_ROLLUP_DTO);
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
  it('exposes an explicit architecture selector that defaults to the active architecture and re-scopes on change', async () => {
    const setActiveArchitecture = vi.fn();
    vi.mocked(useArchitectureContext).mockReturnValue({
      architectures: [
        { id: ARCH_ID, name: 'Current State', archived: false },
        { id: 'arch-target', name: 'Target X', archived: false },
      ],
      setActiveArchitecture,
    } as unknown as ReturnType<typeof useArchitectureContext>);

    renderView();

    const select = (await screen.findByTestId(
      'security-architecture-select',
    )) as HTMLSelectElement;
    // Defaults to the active architecture — the binding is visible, not hidden.
    expect(select.value).toBe(ARCH_ID);
    expect(within(select).getByText('Current State')).toBeInTheDocument();
    expect(within(select).getByText('Target X')).toBeInTheDocument();

    // Changing it re-scopes via setActiveArchitecture (which navigates).
    fireEvent.change(select, { target: { value: 'arch-target' } });
    expect(setActiveArchitecture).toHaveBeenCalledWith('arch-target');
  });

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

    // The GRAND-TOTAL roll-up (FIX 1) is server-fed + re-fetched on upload, so it
    // follows the same replace-latest progression: the stale rollup first, the
    // corrected rollup after the re-upload bumps the reload token.
    const STALE_ROLLUP: VulnerabilityRollupDto = {
      report_id: 'rep-stale',
      total: 1,
      total_findings: 1,
      distinct_cves: 1,
      severity_counts: { info: 0, low: 1, medium: 0, high: 0, critical: 0 },
      by_library: [
        { coordinate: 'org.example:stale', library_id: 'lib-stale', total: 1, severity_counts: { info: 0, low: 1, medium: 0, high: 0, critical: 0 } },
      ],
      unmatched: null,
    };
    const CORRECTED_ROLLUP: VulnerabilityRollupDto = {
      report_id: 'rep-corrected',
      total: 3,
      total_findings: 3,
      distinct_cves: 3,
      severity_counts: { info: 0, low: 0, medium: 1, high: 1, critical: 1 },
      by_library: [
        { coordinate: 'org.example:alpha', library_id: 'lib-alpha', total: 1, severity_counts: { info: 0, low: 0, medium: 0, high: 0, critical: 1 } },
        { coordinate: 'org.example:beta', library_id: 'lib-beta', total: 1, severity_counts: { info: 0, low: 0, medium: 0, high: 1, critical: 0 } },
      ],
      unmatched: { coordinate: '__unmatched__', library_id: null, total: 1, severity_counts: { info: 0, low: 0, medium: 1, high: 0, critical: 0 } },
    };
    vi.mocked(getVulnerabilityRollup)
      .mockResolvedValueOnce(STALE_ROLLUP)
      .mockResolvedValue(CORRECTED_ROLLUP);

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

// ============================================================================
// Frontend-only Security-tab fixes (grand-total roll-up, page-size selector,
// drop-reason split/relabel, scan "run discovery first" message).
// ============================================================================
describe('SecurityView frontend fixes (grand-total / page size / drop reasons / scan prerequisite)', () => {
  // -- FIX 1: the roll-up + group-by-library reflect the SERVER GRAND TOTAL
  //    (whole latest report), NOT the paged rows. --
  it('FIX 1: feeds the severity roll-up + group-by-library from the server GRAND-TOTAL rollup, not the visible page', async () => {
    // The table is paged to 2 visible rows, but the server rollup is the full
    // 88-row report. The strip MUST show 88 (grand total), never 2 (the page).
    const PAGE: VulnerabilityDto[] = [
      makeRow({ id: 'p1', cve_id: 'CVE-PAGE-1', severity: 'critical', match_status: 'matched', affected_coordinate: 'org.example:alpha' }),
      makeRow({ id: 'p2', cve_id: 'CVE-PAGE-2', severity: 'low', match_status: 'matched', affected_coordinate: 'org.example:beta' }),
    ];
    vi.mocked(listVulnerabilities).mockResolvedValue({ items: PAGE, total: 88, page: 0, size: 50 });

    const grandTotal: VulnerabilityRollupDto = {
      report_id: 'rep-latest',
      total: 88,
      // 88 kept rows; the unique-unit severity tiles also sum to 88 here. The
      // distinct-CVE count is LOWER (a CVE can span several module rows) -- the
      // two headlines are independent of the severity tiles.
      total_findings: 88,
      distinct_cves: 61,
      severity_counts: { info: 4, low: 10, medium: 20, high: 30, critical: 24 },
      by_library: [
        { coordinate: 'org.example:zeta', library_id: 'lib-zeta', total: 50, severity_counts: { info: 0, low: 5, medium: 15, high: 20, critical: 10 } },
        { coordinate: 'org.example:alpha', library_id: 'lib-alpha', total: 20, severity_counts: { info: 0, low: 0, medium: 5, high: 5, critical: 10 } },
      ],
      unmatched: { coordinate: '__unmatched__', library_id: null, total: 18, severity_counts: { info: 4, low: 5, medium: 0, high: 5, critical: 4 } },
    };
    vi.mocked(getVulnerabilityRollup).mockResolvedValue(grandTotal);

    renderView();
    await screen.findAllByTestId('vuln-row');

    // The strip shows the grand total (88), not the page (2).
    await waitFor(() =>
      expect(screen.getByTestId('vuln-rollup-total').getAttribute('data-count')).toBe('88'),
    );
    expect(screen.getByTestId('vuln-rollup-critical').getAttribute('data-count')).toBe('24');
    expect(screen.getByTestId('vuln-rollup-high').getAttribute('data-count')).toBe('30');
    expect(screen.getByTestId('vuln-rollup-medium').getAttribute('data-count')).toBe('20');
    expect(screen.getByTestId('vuln-rollup-low').getAttribute('data-count')).toBe('10');
    expect(screen.getByTestId('vuln-rollup-info').getAttribute('data-count')).toBe('4');

    // Group-by-library is the server grouping (sorted), with the distinct orphan.
    const libGroups = screen.getAllByTestId('vuln-group-library');
    expect(libGroups.map((g) => g.getAttribute('data-coordinate'))).toEqual([
      'org.example:alpha',
      'org.example:zeta',
    ]);
    const orphan = screen.getByTestId('vuln-group-unmatched');
    expect(orphan).toHaveTextContent(/unmatched \/ orphan/i);

    // The server rollup is fetched once for the scope (not per page/filter).
    expect(vi.mocked(getVulnerabilityRollup)).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID);
  });

  it('FIX 1 (fail-soft): falls back to the client page roll-up when the server rollup fetch fails', async () => {
    // Server rollup unavailable -> the strip still renders, from the page rows.
    vi.mocked(getVulnerabilityRollup).mockRejectedValue(new Error('rollup 503'));

    renderView();
    await screen.findAllByTestId('vuln-row');

    // The fallback page roll-up over the 3 default ROWS (critical/high/medium).
    await waitFor(() =>
      expect(screen.getByTestId('vuln-rollup-total').getAttribute('data-count')).toBe('3'),
    );
    expect(screen.getByTestId('vuln-rollup-critical').getAttribute('data-count')).toBe('1');
    // The panel rendered despite the failed server rollup (no blank, no throw).
    expect(screen.getByTestId('vuln-severity-rollup')).toBeInTheDocument();
  });

  // -- FIX 2: page-size selector. --
  it('FIX 2: the page-size selector changes the requested size (incl. "All (max 500)") and resets to page 1', async () => {
    // A 200-row report so paging is active at size 50 (totalPages = 4).
    vi.mocked(listVulnerabilities).mockResolvedValue({ items: ROWS, total: 200, page: 0, size: 50 });

    renderView();
    await screen.findAllByTestId('vuln-row');

    // Default size 50 was requested.
    await waitFor(() =>
      expect(vi.mocked(listVulnerabilities).mock.calls.some(([, , f]) => f?.size === 50)).toBe(true),
    );

    // Advance to page 2 so we can prove the size change resets to page 1.
    fireEvent.click(screen.getByTestId('vuln-pager-next'));
    await waitFor(() =>
      expect(vi.mocked(listVulnerabilities).mock.calls.some(([, , f]) => f?.page === 1)).toBe(true),
    );

    // The "All (max 500)" choice maps to size 500 (the AMS cap), never more.
    const select = screen.getByTestId('vuln-page-size-select') as HTMLSelectElement;
    const allOption = within(select).getByText(/all \(max 500\)/i) as HTMLOptionElement;
    expect(allOption.value).toBe('500');
    fireEvent.change(select, { target: { value: '500' } });

    // The next list call requests size 500 AND page 0 (reset).
    await waitFor(() =>
      expect(
        vi.mocked(listVulnerabilities).mock.calls.some(([, , f]) => f?.size === 500 && f?.page === 0),
      ).toBe(true),
    );
  });

  // -- FIX 3: drop-reason split + relabel + the compact drop notes. --
  it('FIX 3: splits Dropped into collapsed (relabelled) + unparseable and surfaces the report drop notes', async () => {
    const summary: VulnerabilityReportSummaryDto = {
      report: {
        id: 'rep-drop',
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        source: 'internal_report',
        original_filename: 'big.csv',
        format: 'csv',
        uploaded_at: '2026-06-24T13:00:00Z',
        is_latest: true,
        row_count_ingested: 100,
        row_count_dropped: 205,
        parse_strategy: 'column_mapping',
        notes: 'row 12: missing severity; row 40: unrecognised coordinate',
      },
      rows_received: 305,
      ingested_count: 100,
      dropped_duplicates: 197,
      dropped_unparseable: 8,
      matched_count: 60,
      unmatched_count: 40,
    };
    vi.mocked(uploadVulnerabilityReport).mockResolvedValue(summary);

    renderView();
    await screen.findAllByTestId('vuln-row');

    const fileInput = screen.getByTestId('vuln-upload-file-input') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'big.csv', { type: 'text/csv' })] } });

    const dropped = await screen.findByTestId('vuln-upload-dropped');
    // The total + the split (197 collapsed + 8 unparseable).
    expect(dropped).toHaveTextContent('205');
    const collapsed = within(dropped).getByTestId('vuln-upload-dropped-collapsed');
    expect(collapsed).toHaveTextContent('197');
    // RELABELLED: collapsed (same CVE+coordinate) -- NOT "duplicates"/"lost".
    expect(collapsed).toHaveTextContent(/collapsed \(same cve\+coordinate\)/i);
    expect(collapsed).not.toHaveTextContent(/lost/i);
    expect(within(dropped).getByTestId('vuln-upload-dropped-unparseable')).toHaveTextContent('8');
    // The de-dup hint clarifies collapsed rows are not data loss.
    expect(within(dropped).getByTestId('vuln-upload-dropped-hint')).toHaveTextContent(/not lost/i);

    // The report's drop notes are surfaced (expandable) so the WHY is visible.
    const notes = within(dropped).getByTestId('vuln-upload-dropped-notes');
    expect(notes).toHaveTextContent(/missing severity/i);
    expect(notes).toHaveTextContent(/unrecognised coordinate/i);
  });

  // -- FIX 4: the scan "nothing to scan" prerequisite message. --
  it('FIX 4: a scan with zero queried coordinates shows the "run discovery first" prerequisite, distinct from an outage', async () => {
    // A SUCCESSFUL scan (available:true) that queried NOTHING => the empty-SBOM
    // prerequisite case: no current-state dependencies were discovered to scan.
    // (An outage is available:false; this is a successful-but-empty scan.)
    const nothing: ScanVulnerabilitiesResponse = {
      status: 'ok',
      availability: {
        available: true,
        reason: undefined,
        note: 'Automated vulnerability enrichment ran: 0 findings from 0 advisories across 0 queried coordinates.',
        queriesBuilt: 0,
        excluded: 0,
        advisoriesFound: 0,
        rowsMinted: 0,
        internalRowsEnriched: 0,
        unknownFixRows: 0,
      },
    };
    vi.mocked(scanVulnerabilities).mockResolvedValue(nothing);

    renderView();
    await screen.findAllByTestId('vuln-row');
    fireEvent.click(screen.getByTestId('vuln-scan-button'));

    const note = await screen.findByTestId('vuln-scan-nothing-to-scan');
    // Actionable prerequisite, NOT the generic outage note.
    expect(note).toHaveTextContent(/no current-state dependencies have been discovered/i);
    expect(note).toHaveTextContent(/run a code\/dependency discovery first/i);
    // Still informational (role="status"), never a blocking alert. The scan
    // itself succeeded (available:true) -- it just had nothing to query.
    expect(note.getAttribute('role')).toBe('status');
    expect(note.getAttribute('data-available')).toBe('true');
    expect(note.getAttribute('data-variant')).toBe('nothing-to-scan');
    // It is NOT mislabelled as the advisory-source outage note.
    expect(screen.queryByTestId('vuln-enrichment-unavailable')).toBeNull();
  });

  it('FIX 4: a genuine advisory-source outage (coordinates queried) KEEPS the existing unavailable note', async () => {
    // available:false but queriesBuilt>0 => OSV/proxy outage, not "nothing to scan".
    const outage: ScanVulnerabilitiesResponse = {
      status: 'unavailable',
      availability: {
        available: false,
        reason: 'proxy',
        note: 'Automated enrichment unavailable (proxy). The Security view continues on the internal report alone; only the automated badged set is absent.',
        queriesBuilt: 12,
        excluded: 0,
        advisoriesFound: 0,
        rowsMinted: 0,
        internalRowsEnriched: 0,
        unknownFixRows: 0,
      },
    };
    vi.mocked(scanVulnerabilities).mockResolvedValue(outage);

    renderView();
    await screen.findAllByTestId('vuln-row');
    fireEvent.click(screen.getByTestId('vuln-scan-button'));

    // The outage path keeps the existing unavailable note + testid.
    const note = await screen.findByTestId('vuln-enrichment-unavailable');
    expect(note).toHaveTextContent(/automated enrichment unavailable/i);
    expect(note.getAttribute('data-variant')).toBe('unavailable');
    // NOT misrouted to the prerequisite message.
    expect(screen.queryByTestId('vuln-scan-nothing-to-scan')).toBeNull();
  });
});

// ============================================================================
// Keep-all-rows model: the two all-rows headlines, the self-consistent severity
// TOTAL (== sum-of-tiles, NOT total_findings), the column-mapping transparency,
// and a row surfacing a populated coordinate + module/location.
// ============================================================================
describe('SecurityView keep-all-rows model (headlines / self-consistent total / column mapping / location)', () => {
  it('renders the two all-rows HEADLINE figures ("{n} findings" + "{n} distinct CVEs") from the server rollup, separate from the severity tiles', async () => {
    // 90 kept rows, 61 distinct CVEs, but the unique-unit severity tiles sum to
    // 30 -- the headlines are DISTINCT from the severity roll-up.
    const dto: VulnerabilityRollupDto = {
      report_id: 'rep-hl',
      total: 90,
      total_findings: 90,
      distinct_cves: 61,
      severity_counts: { info: 2, low: 3, medium: 10, high: 10, critical: 5 },
      by_library: [],
      unmatched: null,
    };
    vi.mocked(getVulnerabilityRollup).mockResolvedValue(dto);

    renderView();
    await screen.findAllByTestId('vuln-row');

    const headlines = await screen.findByTestId('vuln-rollup-headlines');
    expect(within(headlines).getByTestId('vuln-headline-findings')).toHaveTextContent('90');
    expect(within(headlines).getByTestId('vuln-headline-findings')).toHaveTextContent(/findings/i);
    expect(within(headlines).getByTestId('vuln-headline-distinct-cves')).toHaveTextContent('61');
    expect(within(headlines).getByTestId('vuln-headline-distinct-cves')).toHaveTextContent(
      /distinct CVEs/i,
    );
  });

  it('keeps the severity roll-up internally consistent: the TOTAL tile == the SUM of the (unique-unit) tiles, NOT total_findings', async () => {
    // total_findings (90) deliberately DIVERGES from the severity-tile sum (30).
    // The roll-up TOTAL must equal the SUM of the tiles (30), never 90.
    const dto: VulnerabilityRollupDto = {
      report_id: 'rep-consistent',
      total: 90,
      total_findings: 90,
      distinct_cves: 61,
      severity_counts: { info: 2, low: 3, medium: 10, high: 10, critical: 5 },
      by_library: [],
      unmatched: null,
    };
    vi.mocked(getVulnerabilityRollup).mockResolvedValue(dto);

    renderView();
    await screen.findAllByTestId('vuln-row');

    await waitFor(() =>
      expect(screen.getByTestId('vuln-rollup-total').getAttribute('data-count')).toBe('30'),
    );
    // The TOTAL tile is the SUM of the (unique-unit) severity tiles (2+3+10+10+5
    // = 30), and is DELIBERATELY NOT the all-rows total_findings (90).
    const tileSum = (['info', 'low', 'medium', 'high', 'critical'] as const).reduce(
      (acc, bucket) =>
        acc + Number(screen.getByTestId(`vuln-rollup-${bucket}`).getAttribute('data-count')),
      0,
    );
    expect(tileSum).toBe(30);
    expect(screen.getByTestId('vuln-rollup-total').getAttribute('data-count')).not.toBe('90');
    // The all-rows count surfaces ONLY via the separate headline.
    expect(screen.getByTestId('vuln-headline-findings')).toHaveTextContent('90');
  });

  it('renders the upload column-mapping transparency (location_blob -> friendly "package coordinate (from Location)")', async () => {
    const summary: VulnerabilityReportSummaryDto = {
      report: {
        id: 'rep-map',
        project_id: PROJECT_ID,
        architecture_id: ARCH_ID,
        source: 'internal_report',
        original_filename: 'sca.xlsx',
        format: 'xlsx',
        uploaded_at: '2026-06-24T14:00:00Z',
        is_latest: true,
        row_count_ingested: 4,
        row_count_dropped: 0,
        parse_strategy: 'column_mapping',
        notes: null,
      },
      rows_received: 4,
      ingested_count: 4,
      dropped_duplicates: 0,
      dropped_unparseable: 0,
      matched_count: 4,
      unmatched_count: 0,
      parse_strategy: 'column_mapping',
      column_mapping: {
        CVE: 'cve_id',
        Vulnerability: 'title',
        Location: 'location_blob',
        'Vulnerability ID': 'source_finding_id',
      },
    };
    vi.mocked(uploadVulnerabilityReport).mockResolvedValue(summary);

    renderView();
    await screen.findAllByTestId('vuln-row');

    const fileInput = screen.getByTestId('vuln-upload-file-input') as HTMLInputElement;
    fireEvent.change(fileInput, { target: { files: [new File(['x'], 'sca.xlsx')] } });

    const mapping = await screen.findByTestId('vuln-upload-column-mapping');
    // Each source header -> canonical field is shown.
    const rows = within(mapping).getAllByTestId('vuln-upload-column-mapping-row');
    const pairs = rows.map((r) => [r.getAttribute('data-source-header'), r.getAttribute('data-target-field')]);
    expect(pairs).toContainEqual(['CVE', 'cve_id']);
    expect(pairs).toContainEqual(['Vulnerability', 'title']);
    expect(pairs).toContainEqual(['Vulnerability ID', 'source_finding_id']);
    // The Location -> location_blob sentinel is relabelled to a friendly phrase.
    expect(mapping).toHaveTextContent(/package coordinate \(from Location\)/i);
    expect(mapping).not.toHaveTextContent(/location_blob/i);
  });

  it('a finding row surfaces its populated coordinate AND its module/location secondary line', async () => {
    // A dependency finding with a real coordinate AND a module/location.
    const located = makeRow({
      id: 'loc1',
      cve_id: 'CVE-2024-9999',
      title: 'Located finding',
      severity: 'high',
      affected_coordinate: 'org.example:libwidget',
      location: 'services/checkout/pom.xml',
      match_status: 'matched',
      matched_library_id: 'lib-widget',
    });
    vi.mocked(listVulnerabilities).mockResolvedValue(listResponse([located]));

    renderView();
    const rows = await screen.findAllByTestId('vuln-row');
    const row = rows.find((r) => r.getAttribute('data-vuln-id') === 'loc1')!;

    // The real coordinate populates (not an em-dash placeholder).
    expect(row).toHaveTextContent('org.example:libwidget');
    // The module/location rides as a compact secondary line in the same row.
    const location = within(row).getByTestId('vuln-row-location');
    expect(location).toHaveTextContent('services/checkout/pom.xml');
  });
});
