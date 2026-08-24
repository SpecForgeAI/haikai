/**
 * DiscoveryRunDetailPage — phase-payload JSON collapse (2026-08-24).
 * The database/code step payloads have grown large enough to dominate the
 * page's vertical scroll: each phase renders a one-line preview + Expand
 * by default; expanding shows the full pretty-printed JSON; short payloads
 * render inline with no toggle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockGetDiscoveryRuns = vi.fn();
const mockGetDiscoveryRun = vi.fn();
const mockGetDiscoveryCandidateCount = vi.fn();
const mockGetDiscoveryCandidates = vi.fn();

vi.mock('../../api/discoveryApi', () => ({
  getDiscoveryRuns: (...a: unknown[]) => mockGetDiscoveryRuns(...a),
  getDiscoveryRun: (...a: unknown[]) => mockGetDiscoveryRun(...a),
  getDiscoveryCandidateCount: (...a: unknown[]) => mockGetDiscoveryCandidateCount(...a),
  getDiscoveryCandidates: (...a: unknown[]) => mockGetDiscoveryCandidates(...a),
  saveApprovedCandidates: vi.fn(),
  deleteDiscoveryRun: vi.fn(),
  getReviewModel: vi.fn().mockResolvedValue(null),
  updateDiscoveryCandidate: vi.fn(),
  getDiscoveryFindings: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../api/modelApi', () => ({
  loadModelByProjectId: vi.fn().mockResolvedValue(null),
}));

vi.mock('./DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

vi.mock('../../contexts/ArchitectureContext', () => ({
  useActiveArchitectureId: () => 'arch-1',
  useArchitectureContext: () => ({
    architectures: [],
    invalidateArchitectureModelCache: vi.fn(),
  }),
  useArchitectureDispatch: () => vi.fn(),
}));

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: () => ({ id: 'proj-1', name: 'Project 1' }),
}));

import { DiscoveryRunDetailPage } from './DiscoveryRunDetailPage';

function run(stepsPayload: Record<string, unknown> | null) {
  return {
    id: 'run-current',
    project_id: 'proj-1',
    architecture_id: 'arch-1',
    service_id: 'svc-1',
    discovery_kind: 'database',
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: stepsPayload,
    error_message: null,
    warnings: [],
    created_at: '2026-08-24T10:00:00Z',
    updated_at: '2026-08-24T10:00:00Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDiscoveryCandidateCount.mockResolvedValue({ count: 0 });
  mockGetDiscoveryCandidates.mockResolvedValue([]);
});

function renderPage() {
  return render(
    <MemoryRouter
      initialEntries={[
        '/projects/proj-1/architectures/arch-1/discovery/runs/run-current',
      ]}
    >
      <DiscoveryRunDetailPage />
    </MemoryRouter>,
  );
}

describe('DiscoveryRunDetailPage — phase payload collapse', () => {
  it('collapses a large phase payload to a preview, expands to full pretty JSON on click', async () => {
    const bigPayload = {
      status: 'completed',
      tableCount: 45,
      procSourceCount: 30,
      proc_sources: Array.from({ length: 40 }, (_, i) => ({
        name: `proc_${i}`,
        text: 'create proc body text that pads the payload well past the preview threshold',
      })),
    };
    const r = run({ database: bigPayload });
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);

    renderPage();
    const toggle = await screen.findByTestId('phase-json-toggle-database');
    expect(toggle.textContent).toContain('Expand');
    // Collapsed: preview visible, full JSON absent.
    expect(screen.getByTestId('phase-json-preview-database').textContent!.length).toBeLessThan(
      200,
    );
    expect(screen.queryByTestId('phase-json-full-database')).toBeNull();

    fireEvent.click(toggle);
    // Expanded: pretty JSON (indented) visible, preview gone, toggle flips.
    const full = screen.getByTestId('phase-json-full-database');
    expect(full.textContent).toContain('"procSourceCount": 30');
    expect(screen.queryByTestId('phase-json-preview-database')).toBeNull();
    expect(screen.getByTestId('phase-json-toggle-database').textContent).toContain('Collapse');

    fireEvent.click(screen.getByTestId('phase-json-toggle-database'));
    expect(screen.queryByTestId('phase-json-full-database')).toBeNull();
  });

  it('Refresh refetches the active Candidates tab contents (2026-08-24 bug)', async () => {
    const r = run({ database: { status: 'completed' } });
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);
    mockGetDiscoveryCandidates.mockResolvedValue([
      {
        id: 'c1',
        candidate_type: 'endpoints',
        name: 'GET /api/x',
        status: 'proposed',
        confidence: 0.9,
        data: {},
      },
    ]);

    renderPage();
    await screen.findByTestId('phase-list');
    const callsAfterLoad = mockGetDiscoveryCandidates.mock.calls.length;

    fireEvent.click(screen.getByTestId('refresh-runs-button'));
    await vi.waitFor(() => {
      expect(mockGetDiscoveryCandidates.mock.calls.length).toBeGreaterThan(callsAfterLoad);
    });
  });

  it('renders short phase payloads inline with no toggle', async () => {
    const r = run({ connect: 'ok', database: { status: 'completed' } });
    mockGetDiscoveryRuns.mockResolvedValue([r]);
    mockGetDiscoveryRun.mockResolvedValue(r);

    renderPage();
    await screen.findByTestId('phase-list');
    expect(screen.queryByTestId('phase-json-toggle-connect')).toBeNull();
    expect(screen.queryByTestId('phase-json-toggle-database')).toBeNull();
    expect(screen.getByTestId('phase-list').textContent).toContain('ok');
  });
});
