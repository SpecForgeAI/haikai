/**
 * Run-row "logs partially attached / log attach failed" warning chip tests.
 *
 * Spec 2026-05-10: Runtime Log Input at Discovery Run Start
 * Task Group 5.1: 4 focused Vitest tests for the warning-chip rendering.
 *
 * Surface under test: DiscoveryRunsList (the standalone list component used
 * by DiscoveryListPage and as the canonical run-row renderer for the
 * candidate-review surface). The component reads
 * `config_snapshot.inputArtifacts.{logFiles, attemptedCount}` from each run
 * and decides whether to render a warning chip adjacent to the status badge.
 *
 * The predicate itself is unit-tested implicitly via the rendered output of
 * three crafted run rows that exercise every branch of
 * `computeLogAttachWarningState`:
 *
 *   - Test (a): no chip when `attemptedCount === successfulCount` (or both 0)
 *               -- verifies the silent-success path.
 *   - Test (b): "Logs partially attached" chip when
 *               `attemptedCount > logFiles.length > 0`.
 *   - Test (c): "Log attach failed" chip when
 *               `logFiles.length === 0 && attemptedCount > 0`.
 *   - Test (d): chip placement is adjacent to the existing status badge
 *               within the same run-list row.
 *
 * Mocks `getDiscoveryRuns` to return a fixture list of three runs (one per
 * state) so all four assertions can be made in two render() calls. Test (a)
 * also covers a fourth run with `attemptedCount === 2 && logFiles.length === 2`
 * to make the silent-success branch explicit.
 *
 * NOTE: This test does NOT touch Spec 1's `candidateDetailsExpansion.test.tsx`
 * or Spec 2's `codeDetectionMappers.test.ts` -- both must keep passing
 * unedited. We deliberately render only the minimal `DiscoveryRunsList`
 * component (no candidate panel surface), so there is no overlap.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import type { DiscoveryRunDto } from '../../../api/discoveryApi';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// CSS-module identity mock -- match the codebase Vitest convention so class
// names round-trip back as their literal property name.
vi.mock('../DiscoveryRunDetailView.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

// Mock the discoveryApi surface. We only need `getDiscoveryRuns` here;
// the standalone list component does not call any other API.
const mockGetDiscoveryRuns = vi.fn();
vi.mock('../../../api/discoveryApi', () => ({
  getDiscoveryRuns: (...args: unknown[]) => mockGetDiscoveryRuns(...args),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { DiscoveryRunsList } from '../DiscoveryRunsList';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Build a `DiscoveryRunDto` test fixture. Defaults to a clean COMPLETED run
 * with no `inputArtifacts` block (i.e. no upload attempted -- chip should
 * NOT render). Override `config_snapshot` to inject the various log-attach
 * states the test scenarios need.
 */
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
    created_at: '2026-05-10T10:00:00Z',
    updated_at: '2026-05-10T10:30:00Z',
    ...overrides,
  };
}

/**
 * Build a `LogFileMeta`-shaped object. The chip predicate only cares about
 * `logFiles.length` so the field contents are intentionally minimal.
 */
function makeLogFile(id: string): Record<string, unknown> {
  return {
    artifactId: id,
    originalFileName: `${id}.log`,
    sizeBytes: 1234,
    fileExtension: '.log',
    contentType: 'text/plain',
    uploadedAtIso: '2026-05-10T10:05:00Z',
    relativePath: `discovery-runs/run-x/logs/${id}.log`,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDiscoveryRuns.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Run-row log-attach warning chip (Spec 2026-05-10 Task Group 5)', () => {
  // -------------------------------------------------------------------------
  // Test (a): chip NOT rendered when attemptedCount === successfulCount.
  //
  // Two run rows exercise the silent-success branch:
  //   1. No `inputArtifacts` block at all (legacy / no upload attempted) ->
  //      attemptedCount = 0, logFiles.length = 0 -> 'none'.
  //   2. attemptedCount = 2 and logFiles.length = 2 -> all attempted files
  //      attached successfully -> 'none'.
  // The chip's data-testid is `run-list-logs-attach-warning-chip`. Asserting
  // it is NOT present anywhere in the document covers both rows.
  // -------------------------------------------------------------------------
  it('Test (a): does NOT render chip when attemptedCount === successfulCount or both 0', async () => {
    const runs: DiscoveryRunDto[] = [
      makeRun({ id: 'run-no-upload', config_snapshot: null }),
      makeRun({
        id: 'run-all-attached',
        config_snapshot: {
          inputArtifacts: {
            logFiles: [makeLogFile('a1'), makeLogFile('a2')],
            attemptedCount: 2,
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

    // Wait for runs to render.
    await waitFor(() => {
      expect(screen.getAllByTestId('run-list-item')).toHaveLength(2);
    });

    // Critical assertion: NO chip in either row.
    expect(
      screen.queryAllByTestId('run-list-logs-attach-warning-chip'),
    ).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Test (b): "Logs partially attached" chip when 0 < logFiles.length < attemptedCount.
  //
  // Crafts a run where the user picked 3 files, but only 1 was successfully
  // written to disk + acknowledged by the AMS PATCH. The chip label MUST
  // be the spec-locked string "Logs partially attached" and the
  // data-warning-state attribute MUST be 'partial' so downstream styling
  // can branch on it.
  // -------------------------------------------------------------------------
  it('Test (b): renders "Logs partially attached" when attemptedCount > logFiles.length > 0', async () => {
    const runs: DiscoveryRunDto[] = [
      makeRun({
        id: 'run-partial',
        config_snapshot: {
          inputArtifacts: {
            logFiles: [makeLogFile('p1')],
            attemptedCount: 3,
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

    const chip = screen.getByTestId('run-list-logs-attach-warning-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('Logs partially attached');
    expect(chip).toHaveAttribute('data-warning-state', 'partial');
  });

  // -------------------------------------------------------------------------
  // Test (c): "Log attach failed" chip when logFiles.length === 0 && attemptedCount > 0.
  //
  // The user picked 2 files but BOTH disk-writes failed (or the AMS PATCH
  // failed and the gateway returned no logFiles). The run is NOT rolled
  // back per spec failure-mode flow -- the chip must surface the failure
  // clearly with the red "Log attach failed" label.
  // -------------------------------------------------------------------------
  it('Test (c): renders "Log attach failed" when logFiles.length === 0 && attemptedCount > 0', async () => {
    const runs: DiscoveryRunDto[] = [
      makeRun({
        id: 'run-failed',
        config_snapshot: {
          inputArtifacts: {
            logFiles: [],
            attemptedCount: 2,
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

    const chip = screen.getByTestId('run-list-logs-attach-warning-chip');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent('Log attach failed');
    expect(chip).toHaveAttribute('data-warning-state', 'failed');
  });

  // -------------------------------------------------------------------------
  // Test (d): chip is rendered inside the same row as the status badge,
  // immediately after it (DOM-order adjacent).
  //
  // The spec locks placement: "pinned adjacent to the existing run-status
  // indicator". We assert by:
  //   1. Scoping to the row's <li> element (data-testid="run-list-item").
  //   2. Querying both the status badge text ("FAILED") and the chip
  //      within that scope -- both must be present in the same row.
  //   3. Verifying the chip is the immediately-following sibling of the
  //      status-badge <span> (no other element between them) so the visual
  //      pairing is preserved.
  // -------------------------------------------------------------------------
  it('Test (d): chip is positioned adjacent to the run-status indicator in the same row', async () => {
    const runs: DiscoveryRunDto[] = [
      makeRun({
        id: 'run-failed-adjacent',
        status: 'FAILED',
        // Spec 2026-05-11 Task Group 5 introduces a service-deleted chip
        // that renders when `service_id == null`. Set a non-null service_id
        // here so this adjacency assertion (log-attach chip is the immediate
        // next-sibling of the status badge) still holds; the service-deleted
        // chip is gated off for non-orphan runs.
        service_id: 'svc-non-orphan',
        config_snapshot: {
          inputArtifacts: {
            logFiles: [],
            attemptedCount: 1,
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

    // Status badge and chip are both in this row.
    const chip = within(row).getByTestId('run-list-logs-attach-warning-chip');
    expect(chip).toBeInTheDocument();

    // The status indicator is the row's first <span> child (the .statusBadge
    // span carrying the run.status text). The chip MUST be its immediate
    // next-sibling <span>, which is the contract for "adjacent placement".
    const spans = Array.from(row.querySelectorAll('span'));
    const statusBadgeIdx = spans.findIndex(
      (s) => s.textContent === 'FAILED',
    );
    expect(statusBadgeIdx).toBeGreaterThanOrEqual(0);

    const chipIdx = spans.indexOf(chip);
    expect(chipIdx).toBe(statusBadgeIdx + 1);
  });
});
