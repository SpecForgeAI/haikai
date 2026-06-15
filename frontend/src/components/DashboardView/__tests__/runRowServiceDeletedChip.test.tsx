/**
 * Run-row "Service deleted" chip tests.
 *
 * Spec: 2026-05-11 Discovery Run Robustness -- Section 2 (Task Group 5).
 *
 * Surface under test: DiscoveryRunsList (the standalone list component used
 * by DiscoveryListPage). The component renders an amber "Service deleted"
 * chip on orphan rows, optionally accompanied by a snapshot-derived service
 * name when the run carries a `config_snapshot.serviceIdentitySnapshot`.
 *
 * Render predicate (centralised in `serviceDeletedHelpers.ts`):
 *   - `service_id == null && snapshot?.serviceName != null` -> name + chip
 *   - `service_id == null && no snapshot/name`             -> chip alone
 *   - `service_id` resolves                                -> nothing extra
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { DiscoveryRunDto } from '../../../api/discoveryApi';

// CSS-module identity mock -- match the codebase Vitest convention.
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

const mockGetDiscoveryRuns = vi.fn();
vi.mock('../../../api/discoveryApi', () => ({
  getDiscoveryRuns: (...args: unknown[]) => mockGetDiscoveryRuns(...args),
}));

import { DiscoveryRunsList } from '../DiscoveryRunsList';

function makeRun(overrides: Partial<DiscoveryRunDto> = {}): DiscoveryRunDto {
  return {
    id: 'run-default',
    project_id: 'proj-1',
    architecture_id: 'arch-1',
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-05-11T10:00:00Z',
    updated_at: '2026-05-11T10:30:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDiscoveryRuns.mockReset();
});

describe('Run-row Service deleted chip (Spec 2026-05-11 Task Group 5)', () => {
  it('renders the snapshot service name + "Service deleted" chip when service_id is null AND snapshot present', async () => {
    // AC2.5: orphan + snapshot -> name + amber chip.
    const runs: DiscoveryRunDto[] = [
      makeRun({
        id: 'run-orphan-with-snapshot',
        service_id: null,
        config_snapshot: {
          serviceIdentitySnapshot: {
            service_id: 'svc-old',
            service_name: 'OldService',
            service_type: 'INTERNAL_BUSINESS',
            application_id: 'app-1',
            repo_location: 'r',
            repo_subfolder: 's',
          },
        },
      }),
    ];
    mockGetDiscoveryRuns.mockResolvedValueOnce(runs);

    render(
      <DiscoveryRunsList
        projectId="proj-1"
        architectureId="arch-1"
        onSelectRun={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('run-list-item')).toBeInTheDocument();
    });

    const row = screen.getByTestId('run-list-item');
    const nameLabel = within(row).getByTestId('run-list-service-name-label');
    expect(nameLabel).toHaveTextContent('OldService');
    const chip = within(row).getByTestId('run-list-service-deleted-chip');
    expect(chip).toHaveTextContent(/Service deleted/i);
  });

  it('renders ONLY the "Service deleted" chip when service_id is null AND no snapshot (legacy orphan)', async () => {
    // AC2.7: orphan without snapshot -> chip alone, no name suffix, no crash.
    const runs: DiscoveryRunDto[] = [
      makeRun({
        id: 'run-legacy-orphan',
        service_id: null,
        config_snapshot: null,
      }),
    ];
    mockGetDiscoveryRuns.mockResolvedValueOnce(runs);

    render(
      <DiscoveryRunsList
        projectId="proj-1"
        architectureId="arch-1"
        onSelectRun={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('run-list-item')).toBeInTheDocument();
    });

    const row = screen.getByTestId('run-list-item');
    const chip = within(row).getByTestId('run-list-service-deleted-chip');
    expect(chip).toHaveTextContent(/Service deleted/i);
    // No service-name label rendered when snapshot is absent.
    expect(
      within(row).queryByTestId('run-list-service-name-label'),
    ).not.toBeInTheDocument();
  });

  it('renders NO chip when service_id resolves (non-orphaned run)', async () => {
    // AC2.8: not orphaned -> no chip.
    const runs: DiscoveryRunDto[] = [
      makeRun({
        id: 'run-bound',
        service_id: 'svc-still-here',
        config_snapshot: {
          // Snapshot may be present (it was captured at run-create) but the
          // service_id still resolves, so we DO NOT show the chip.
          serviceIdentitySnapshot: {
            service_id: 'svc-still-here',
            service_name: 'StillBoundSvc',
          },
        },
      }),
    ];
    mockGetDiscoveryRuns.mockResolvedValueOnce(runs);

    render(
      <DiscoveryRunsList
        projectId="proj-1"
        architectureId="arch-1"
        onSelectRun={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('run-list-item')).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId('run-list-service-deleted-chip'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('run-list-service-name-label'),
    ).not.toBeInTheDocument();
  });

  it('mixed list: snapshot orphan + legacy orphan + bound -> exactly two chips rendered', async () => {
    // Defence-in-depth: ensure the predicate fires per-row and doesn't leak
    // state between rows (e.g. a stale ref to the previous run).
    const runs: DiscoveryRunDto[] = [
      makeRun({
        id: 'row-1-orphan-snap',
        service_id: null,
        config_snapshot: {
          serviceIdentitySnapshot: {
            service_name: 'NamedOrphan',
          },
        },
      }),
      makeRun({
        id: 'row-2-orphan-legacy',
        service_id: null,
        config_snapshot: null,
      }),
      makeRun({
        id: 'row-3-bound',
        service_id: 'svc-bound',
        config_snapshot: null,
      }),
    ];
    mockGetDiscoveryRuns.mockResolvedValueOnce(runs);

    render(
      <DiscoveryRunsList
        projectId="proj-1"
        architectureId="arch-1"
        onSelectRun={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId('run-list-item')).toHaveLength(3);
    });

    // Two chips total: one per orphan row.
    expect(
      screen.getAllByTestId('run-list-service-deleted-chip'),
    ).toHaveLength(2);
    // One name label total: only the snapshot-bearing orphan row.
    const nameLabels = screen.getAllByTestId('run-list-service-name-label');
    expect(nameLabels).toHaveLength(1);
    expect(nameLabels[0]).toHaveTextContent('NamedOrphan');
  });

  // Bug fix (2026-05-17): database-discovery runs are project-scoped and
  // always have `service_id === null`. The previous predicate treated that
  // as an orphaned-service signal and rendered a misleading "Service
  // deleted" chip. The predicate now short-circuits on
  // `discovery_kind === 'database'`.
  it('does NOT render the chip on a database-kind run with service_id=null', async () => {
    const runs: DiscoveryRunDto[] = [
      makeRun({
        id: 'run-db-no-service',
        service_id: null,
        discovery_kind: 'database',
        config_snapshot: null,
      }),
    ];
    mockGetDiscoveryRuns.mockResolvedValueOnce(runs);

    render(
      <DiscoveryRunsList
        projectId="proj-1"
        architectureId="arch-1"
        onSelectRun={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('run-list-item')).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId('run-list-service-deleted-chip'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('run-list-service-name-label'),
    ).not.toBeInTheDocument();
  });

  it('still renders the chip on a code-kind run with service_id=null (regression net for the original behaviour)', async () => {
    const runs: DiscoveryRunDto[] = [
      makeRun({
        id: 'run-code-orphan',
        service_id: null,
        discovery_kind: 'code',
        config_snapshot: null,
      }),
    ];
    mockGetDiscoveryRuns.mockResolvedValueOnce(runs);

    render(
      <DiscoveryRunsList
        projectId="proj-1"
        architectureId="arch-1"
        onSelectRun={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('run-list-item')).toBeInTheDocument();
    });

    expect(
      screen.getByTestId('run-list-service-deleted-chip'),
    ).toBeInTheDocument();
  });
});
