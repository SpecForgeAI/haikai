/**
 * BaselineDetailView — integrity, provenance & coverage surface tests.
 *
 * Spec: 2026-06-17 Baseline Integrity & Provenance — Task Group 3 + R4.
 *
 * These focused tests pin the baseline-view integrity surface:
 *
 * At-rest (TG3):
 *   - a current-state baseline WITH a content_hash + provenance renders the
 *     hash (truncated/monospace), the provenance rows (environment,
 *     activated_at) and the coverage score formatted as a percent
 *   - a current-state baseline with a NULL content_hash renders the neutral
 *     "No integrity hash recorded" badge (NOT an error) and does NOT call the
 *     verify endpoint
 *   - a null / absent provenance_json renders gracefully (no provenance block)
 *   - target baselines are out of scope (no integrity surface)
 *
 * Live verify verdict (R4) — consumes the AMS verify endpoint via
 * `getBaselineIntegrity`:
 *   - integrity_verified === true            -> "Integrity verified" (green)
 *   - integrity_verified === false + hash    -> "Integrity MISMATCH" (red,
 *                                               tamper-evident)
 *   - verify call errors                     -> fail-soft fallback to the
 *                                               at-rest "Hash recorded" badge
 *                                               (no crash, no false mismatch)
 *   - null content_hash                      -> endpoint NOT called, neutral badge
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const mockGetBaseline = vi.fn();
const mockListBaselineItems = vi.fn();
const mockGetBaselineIntegrity = vi.fn();

vi.mock('../../api/apiBehaviourClient', async () => {
  // Re-export the real defensive parser + formatter dependency surface so the
  // view's `parseBaselineProvenance` import is the genuine implementation,
  // while the network calls (`getBaseline` / `listBaselineItems` /
  // `getBaselineIntegrity`) are mocked.
  const actual = await vi.importActual<
    typeof import('../../api/apiBehaviourClient')
  >('../../api/apiBehaviourClient');
  return {
    ...actual,
    getBaseline: (...a: unknown[]) => mockGetBaseline(...a),
    listBaselineItems: (...a: unknown[]) => mockListBaselineItems(...a),
    getBaselineIntegrity: (...a: unknown[]) => mockGetBaselineIntegrity(...a),
  };
});

import { BaselineDetailView } from './BaselineDetailView';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const BASELINE_ID = 'b-1';

interface BaselineOverrides {
  content_hash?: string | null;
  provenance_json?: Record<string, unknown> | null;
  kind?: 'current' | 'target';
}

function baseline(overrides: BaselineOverrides = {}) {
  return {
    id: BASELINE_ID,
    project_id: PROJECT_ID,
    architecture_id: ARCH_ID,
    session_id: 'sess-9',
    name: 'Oracle baseline',
    status: 'active',
    accepted_capture_count: 3,
    operation_count: 3,
    notes: null,
    created_at: '2026-06-17T12:00:00Z',
    updated_at: '2026-06-17T12:00:00Z',
    kind: overrides.kind ?? 'current',
    paired_with_baseline_id: null,
    content_hash:
      overrides.content_hash === undefined ? null : overrides.content_hash,
    provenance_json:
      overrides.provenance_json === undefined ? null : overrides.provenance_json,
  };
}

const FULL_HASH =
  'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

function fullProvenance(): Record<string, unknown> {
  return {
    session_id: 'sess-9',
    environment_name: 'staging',
    activated_at: '2026-06-17T12:30:00Z',
    coverage_score: 0.6,
    coverage_summary: { overall_score: 0.6 },
    accepted_capture_count: 3,
    operation_count: 3,
    hash_algo: 'sha256',
    canonical_version: 1,
  };
}

function renderView() {
  return render(
    <MemoryRouter>
      <BaselineDetailView
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        baselineId={BASELINE_ID}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListBaselineItems.mockResolvedValue([]);
  // Default verify verdict: matches. Individual tests override as needed.
  mockGetBaselineIntegrity.mockResolvedValue({
    content_hash: FULL_HASH,
    recomputed_hash: FULL_HASH,
    integrity_verified: true,
  });
});

describe('BaselineDetailView — integrity & provenance surface', () => {
  it('renders the content hash, provenance rows and coverage % for a stamped current baseline', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({ content_hash: FULL_HASH, provenance_json: fullProvenance() }),
    );

    renderView();

    // The full hash is surfaced verbatim on the element (truncated on screen).
    const hashEl = await screen.findByTestId('baseline-detail-content-hash');
    expect(hashEl).toHaveAttribute('data-content-hash', FULL_HASH);

    // Provenance rows.
    const provenance = screen.getByTestId('baseline-detail-provenance');
    expect(provenance).toHaveTextContent('staging');
    expect(provenance).toHaveTextContent('2026-06-17T12:30:00Z');

    // Coverage score 0.6 -> 60%.
    expect(screen.getByTestId('baseline-detail-coverage-score')).toHaveTextContent(
      '60%',
    );
  });

  it('renders the neutral "No integrity hash recorded" badge (NOT an error) when content_hash is null', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({ content_hash: null, provenance_json: null }),
    );

    renderView();

    const badge = await screen.findByTestId('baseline-detail-integrity-badge');
    expect(badge).toHaveTextContent('No integrity hash recorded');
    expect(badge).toHaveAttribute('data-integrity-state', 'no-hash');

    // Neutral state: no error banner, no hash element, verify endpoint NOT called.
    expect(screen.queryByTestId('baseline-detail-content-hash')).toBeNull();
    expect(
      screen.getByTestId('baseline-detail-view').querySelector('[class*="errorBanner"]'),
    ).toBeNull();
    expect(mockGetBaselineIntegrity).not.toHaveBeenCalled();
  });

  it('formats the coverage score from provenance as a percent (0.42 -> 42%)', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({
        content_hash: FULL_HASH,
        provenance_json: { ...fullProvenance(), coverage_score: 0.42 },
      }),
    );

    renderView();

    expect(
      await screen.findByTestId('baseline-detail-coverage-score'),
    ).toHaveTextContent('42%');
  });

  it('renders an em-dash for the coverage score when provenance records a null coverage_score', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({
        content_hash: FULL_HASH,
        provenance_json: { ...fullProvenance(), coverage_score: null },
      }),
    );

    renderView();

    expect(
      await screen.findByTestId('baseline-detail-coverage-score'),
    ).toHaveTextContent('—');
  });

  it('renders gracefully (badge present, no provenance block) when provenance_json is absent', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({ content_hash: FULL_HASH, provenance_json: null }),
    );

    renderView();

    // The integrity badge still renders from content_hash alone.
    expect(
      await screen.findByTestId('baseline-detail-integrity-badge'),
    ).toBeInTheDocument();
    // No provenance block, and the view did not throw.
    expect(screen.queryByTestId('baseline-detail-provenance')).toBeNull();
  });

  it('does NOT surface the integrity badge on a target baseline (out of scope)', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({
        kind: 'target',
        content_hash: FULL_HASH,
        provenance_json: fullProvenance(),
      }),
    );

    renderView();

    // Wait for the (target) view to render its summary, then assert the
    // integrity surface is absent for target baselines.
    await waitFor(() =>
      expect(screen.getByTestId('baseline-detail-view')).toHaveAttribute(
        'data-kind',
        'target',
      ),
    );
    expect(screen.queryByTestId('baseline-detail-integrity-badge')).toBeNull();
    expect(screen.queryByTestId('baseline-detail-provenance')).toBeNull();
    // Target baselines never hit the verify endpoint.
    expect(mockGetBaselineIntegrity).not.toHaveBeenCalled();
  });
});

describe('BaselineDetailView — live integrity verdict (R4)', () => {
  it('renders the green "Integrity verified" badge when the verify endpoint confirms a match', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({ content_hash: FULL_HASH, provenance_json: fullProvenance() }),
    );
    mockGetBaselineIntegrity.mockResolvedValue({
      content_hash: FULL_HASH,
      recomputed_hash: FULL_HASH,
      integrity_verified: true,
    });

    renderView();

    const badge = await screen.findByTestId('baseline-detail-integrity-badge');
    await waitFor(() => expect(badge).toHaveTextContent('Integrity verified'));
    expect(badge).toHaveAttribute('data-integrity-state', 'verified');
    expect(badge.className).toMatch(/integrityVerified/);
    expect(mockGetBaselineIntegrity).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      BASELINE_ID,
    );
  });

  it('renders the red "Integrity MISMATCH" badge when integrity_verified is false with a recorded hash', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({ content_hash: FULL_HASH, provenance_json: fullProvenance() }),
    );
    mockGetBaselineIntegrity.mockResolvedValue({
      content_hash: FULL_HASH,
      recomputed_hash: 'deadbeef',
      integrity_verified: false,
    });

    renderView();

    const badge = await screen.findByTestId('baseline-detail-integrity-badge');
    await waitFor(() => expect(badge).toHaveTextContent('Integrity MISMATCH'));
    expect(badge).toHaveAttribute('data-integrity-state', 'mismatch');
    expect(badge.className).toMatch(/integrityMismatch/);
  });

  it('fails soft to the at-rest "Hash recorded" badge (no crash, no false mismatch) when the verify call errors', async () => {
    mockGetBaseline.mockResolvedValue(
      baseline({ content_hash: FULL_HASH, provenance_json: fullProvenance() }),
    );
    mockGetBaselineIntegrity.mockRejectedValue(new Error('verify 503'));

    renderView();

    const badge = await screen.findByTestId('baseline-detail-integrity-badge');
    await waitFor(() => expect(badge).toHaveTextContent('Hash recorded'));
    expect(badge).toHaveAttribute('data-integrity-state', 'hash-recorded');
    // Fail-soft must not render a false mismatch.
    expect(badge).not.toHaveTextContent('MISMATCH');
    // The hash is still surfaced; the view did not crash.
    expect(screen.getByTestId('baseline-detail-content-hash')).toHaveAttribute(
      'data-content-hash',
      FULL_HASH,
    );
  });
});
