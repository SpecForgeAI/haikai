/**
 * SecurityView "target status" column tests
 * (Spec 4 — 2026-06-24-vulnerability-reduction-and-steering, Task Group 7.1 case (c)).
 *
 * The Spec 1 Security-tab report table gains a single "target status" column,
 * shown ONLY once a target exists, reading the per-CVE status from the ONE shared
 * delta (no re-derivation). Two focused assertions:
 *   (c-1) NO active target => the column is ABSENT (the Spec 1 table is unchanged).
 *   (c-2) An active target with a computed delta => the column renders, each cell
 *         labelled an ESTIMATE, with the eliminated / remaining status from the
 *         shared service.
 *
 * The shared reduction compute + the target-architecture resolution are mocked so
 * the test asserts the column's wiring, not the network/compute plumbing (covered
 * by the gateway delta-service tests).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../contexts/ProjectContext', () => ({ useProject: vi.fn() }));
vi.mock('../../contexts/ArchitectureContext', () => ({ useActiveArchitectureId: vi.fn() }));

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

vi.mock('../../api/targetArchitecturesApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/targetArchitecturesApi')>(
    '../../api/targetArchitecturesApi',
  );
  return {
    ...actual,
    listTargetArchitectures: vi.fn(),
    listDecommissionedInTargetAnnotations: vi.fn(),
  };
});

vi.mock('../../api/vulnerabilityReductionApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/vulnerabilityReductionApi')>(
    '../../api/vulnerabilityReductionApi',
  );
  return {
    ...actual, // keep the real pure helpers (buildTargetCveStatusMap / targetStatusForCve)
    computeVulnerabilityReduction: vi.fn(),
  };
});

import { useProject } from '../../contexts/ProjectContext';
import { useActiveArchitectureId } from '../../contexts/ArchitectureContext';
import {
  listVulnerabilities,
  listVulnerabilityReports,
  type VulnerabilityDto,
  type VulnerabilitySearchResponse,
} from '../../api/vulnerabilitiesApi';
import {
  listTargetArchitectures,
  listDecommissionedInTargetAnnotations,
} from '../../api/targetArchitecturesApi';
import {
  computeVulnerabilityReduction,
  type VulnerabilityReductionResponse,
} from '../../api/vulnerabilityReductionApi';
import { SecurityView } from './SecurityView';

const PROJECT_ID = 'proj-sec-ts';
const ARCH_ID = 'arch-sec-ts';
const TARGET_ID = 'target-sec-ts';

function makeRow(over: Partial<VulnerabilityDto>): VulnerabilityDto {
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
    match_status: 'matched',
    matched_library_id: null,
    matched_declared_version: null,
    ...over,
  };
}

const ROWS: VulnerabilityDto[] = [
  makeRow({ id: 'v1', cve_id: 'CVE-2024-1111', affected_coordinate: 'org.example:libfoo' }),
  makeRow({ id: 'v2', cve_id: 'CVE-2024-2222', affected_coordinate: 'org.example:libbar' }),
];

function searchResponse(rows: VulnerabilityDto[]): VulnerabilitySearchResponse {
  return { items: rows, total: rows.length, page: 0, size: 50 };
}

describe('SecurityView target-status column (Task 7.1 case (c))', () => {
  beforeEach(() => {
    (useProject as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ id: PROJECT_ID, name: 'P' });
    (useActiveArchitectureId as unknown as ReturnType<typeof vi.fn>).mockReturnValue(ARCH_ID);
    (listVulnerabilities as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(searchResponse(ROWS));
    (listVulnerabilityReports as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (listDecommissionedInTargetAnnotations as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('(c-1) hides the target-status column when there is NO active target', async () => {
    // No target architectures at all => no delta => the column must be absent.
    (listTargetArchitectures as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (computeVulnerabilityReduction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      hasTarget: false,
      delta: null,
    } as VulnerabilityReductionResponse);

    render(
      <MemoryRouter>
        <SecurityView />
      </MemoryRouter>,
    );

    // The report table renders.
    await waitFor(() => expect(screen.getByTestId('vuln-report-table')).toBeInTheDocument());
    // The Spec 1 table is unchanged: NO target-status header, NO status cells.
    expect(screen.queryByTestId('vuln-target-status-header')).toBeNull();
    expect(screen.queryAllByTestId('vuln-target-status')).toHaveLength(0);
  });

  it('(c-2) shows the target-status column once a target exists, each cell labelled an estimate', async () => {
    (listTargetArchitectures as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: TARGET_ID, name: 'Target', draftState: 'active' },
    ]);
    (listDecommissionedInTargetAnnotations as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { elementId: 'e1', elementType: 'library', name: 'org.example:libfoo', reason: 'no_target_mapping' },
    ]);
    // The ONE shared delta: CVE-2024-1111 eliminated, CVE-2024-2222 remaining.
    const delta: VulnerabilityReductionResponse = {
      hasTarget: true,
      delta: {
        estimate: true,
        totals: { total: 2, eliminated: 1, remaining: 1, newlyIntroduced: 0 },
        eliminated: [
          {
            cveId: 'CVE-2024-1111',
            severity: 'critical',
            bucket: 'eliminated',
            totalCoordinates: 1,
            addressedCoordinates: 1,
            coordinates: [],
            recommendedMinimumFixedVersion: null,
          },
        ],
        remaining: [
          {
            cveId: 'CVE-2024-2222',
            severity: 'high',
            bucket: 'remaining',
            remainingReason: 'still vulnerable',
            totalCoordinates: 1,
            addressedCoordinates: 0,
            coordinates: [],
            recommendedMinimumFixedVersion: '2.0.0',
          },
        ],
        droppedRows: 0,
      },
    };
    (computeVulnerabilityReduction as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(delta);

    render(
      <MemoryRouter>
        <SecurityView />
      </MemoryRouter>,
    );

    // Column header appears once the delta resolves.
    await waitFor(() =>
      expect(screen.getByTestId('vuln-target-status-header')).toBeInTheDocument(),
    );
    const statusCells = screen.getAllByTestId('vuln-target-status');
    expect(statusCells).toHaveLength(2);
    // The statuses are read straight from the shared delta.
    const statuses = statusCells.map((c) => c.getAttribute('data-status')).sort();
    expect(statuses).toEqual(['eliminated', 'remaining']);
    // Every graded cell carries the ESTIMATE label.
    expect(screen.getAllByTestId('vuln-target-status-estimate').length).toBeGreaterThan(0);
  });
});
