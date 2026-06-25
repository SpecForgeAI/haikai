/**
 * Tests — Spec 4 steering surfaces (inline nudge + critical hard-gate).
 * Spec: 2026-06-24-vulnerability-reduction-and-steering, Task Group 6 (sub-task 6.1).
 *
 * Focused tests covering ONLY the load-bearing behaviour (per tasks.md §6.1):
 *   (a) the inline nudge shows the recommended minimum fixed version and NEVER
 *       blocks (it is advisory; absent when there is no known-fix steer);
 *   (b) one-click "use this version" fires the write+recompute callback;
 *   (c) the "proceed" step BLOCKS on a remaining CRITICAL CVE — the override
 *       button stays DISABLED until a justification is entered, then persists the
 *       trio (justification + count + timestamp) and the later read-only banner;
 *   (d) NON-critical severities do NOT gate (proceed is immediate).
 *
 * The proceed-critical override persist (`upsertProceedCriticalOverride`) is
 * mocked at the API-module boundary so no real gateway/AMS call is made; the
 * delta is a hand-built shared-delta shape (the single source both surfaces read).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { VulnerabilityNudge } from '../VulnerabilityNudge';
import { ProceedCriticalGate } from '../ProceedCriticalGate';
import type {
  ClassifiedVulnerability,
  ProceedCriticalOverrideDto,
  VulnerabilityDeltaResult,
} from '../../../../api/vulnerabilityReductionApi';

// Mock the persist call (the only network touch in these surfaces).
const mockUpsert = vi.fn();
vi.mock('../../../../api/vulnerabilityReductionApi', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../../api/vulnerabilityReductionApi')
  >();
  return {
    ...actual,
    upsertProceedCriticalOverride: (...args: unknown[]) => mockUpsert(...args),
  };
});

afterEach(() => {
  cleanup();
});
beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Shared-delta fixtures (the ONE delta both surfaces read).
// ---------------------------------------------------------------------------

function criticalCve(cveId: string, coordinate: string): ClassifiedVulnerability {
  return {
    cveId,
    severity: 'critical',
    bucket: 'remaining',
    remainingReason: 'still vulnerable',
    totalCoordinates: 1,
    addressedCoordinates: 0,
    coordinates: [
      { coordinate, ecosystem: 'maven', addressed: false, detail: 'still vulnerable' },
    ],
    recommendedMinimumFixedVersion: '2.0.0',
  };
}

function deltaWithRemaining(remaining: ClassifiedVulnerability[]): VulnerabilityDeltaResult {
  return {
    estimate: true,
    totals: {
      total: remaining.length,
      eliminated: 0,
      remaining: remaining.length,
      newlyIntroduced: 0,
    },
    eliminated: [],
    remaining,
    droppedRows: 0,
  };
}

// ---------------------------------------------------------------------------
// (a) + (b) the inline nudge
// ---------------------------------------------------------------------------
describe('VulnerabilityNudge (TG6)', () => {
  it('(a) shows the recommended minimum fixed version, labelled an estimate, and renders an enabled action (never blocks)', () => {
    render(
      <VulnerabilityNudge
        recommendedVersion="2.16.0"
        subjectLabel="jackson-databind"
        onUseThisVersion={vi.fn()}
      />,
    );
    expect(screen.getByTestId('vulnerability-nudge')).toBeTruthy();
    expect(screen.getByTestId('vulnerability-nudge-recommended-version').textContent).toBe('2.16.0');
    // Always labelled an ESTIMATE.
    expect(screen.getByTestId('vulnerability-nudge-estimate').textContent?.toLowerCase()).toContain(
      'estimate',
    );
    // The action is present + enabled — the nudge is advisory, never blocking.
    const btn = screen.getByTestId('vulnerability-nudge-use-button') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('(a2) renders NOTHING when there is no known-fix steer (no recommendation => replace/remove, not a bump)', () => {
    const { container } = render(
      <VulnerabilityNudge recommendedVersion={null} onUseThisVersion={vi.fn()} />,
    );
    expect(container.querySelector('[data-testid="vulnerability-nudge"]')).toBeNull();
  });

  it('(b) one-click "use this version" fires the write+recompute callback with the recommended version', async () => {
    const onUse = vi.fn().mockResolvedValue(undefined);
    render(
      <VulnerabilityNudge recommendedVersion="2.16.0" onUseThisVersion={onUse} />,
    );
    fireEvent.click(screen.getByTestId('vulnerability-nudge-use-button'));
    await waitFor(() => expect(onUse).toHaveBeenCalledTimes(1));
    expect(onUse).toHaveBeenCalledWith('2.16.0');
  });
});

// ---------------------------------------------------------------------------
// (c) + (d) the critical hard-gate at "proceed"
// ---------------------------------------------------------------------------
describe('ProceedCriticalGate (TG6)', () => {
  it('(c) BLOCKS proceed on a remaining critical: opens the override dialog, the override button is DISABLED until a justification is entered, then persists the trio + proceeds', async () => {
    const onProceed = vi.fn().mockResolvedValue(undefined);
    const onPersisted = vi.fn();
    mockUpsert.mockResolvedValueOnce({
      proceed_critical_override_justification: 'accepted residual risk',
      remaining_critical_count: 1,
      proceed_critical_override_at: '2026-06-25T00:00:00Z',
      overridden: true,
    } satisfies ProceedCriticalOverrideDto);

    render(
      <ProceedCriticalGate
        projectId="p1"
        architectureId="t1"
        delta={deltaWithRemaining([criticalCve('CVE-2024-1', 'com.acme:lib')])}
        persistedOverride={null}
        proceedEnabled
        onProceed={onProceed}
        onOverridePersisted={onPersisted}
        proceedLabel="Close conversation"
      />,
    );

    // The gate is blocked (a remaining critical exists) — the hint is shown.
    expect(screen.getByTestId('proceed-critical-gate').getAttribute('data-gate-blocked')).toBe('true');
    expect(screen.getByTestId('proceed-critical-gate-hint')).toBeTruthy();

    // Pressing proceed OPENS the override dialog (does NOT proceed yet).
    fireEvent.click(screen.getByTestId('proceed-critical-gate-button'));
    expect(screen.getByTestId('proceed-critical-override-dialog')).toBeTruthy();
    expect(onProceed).not.toHaveBeenCalled();

    // The override confirm is DISABLED until a justification is entered.
    const confirm = screen.getByTestId('proceed-critical-override-confirm') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    fireEvent.change(screen.getByTestId('proceed-critical-override-justification'), {
      target: { value: 'accepted residual risk' },
    });
    expect(confirm.disabled).toBe(false);

    // Confirm => persist the trio (justification + count) THEN proceed.
    fireEvent.click(confirm);
    await waitFor(() => expect(mockUpsert).toHaveBeenCalledTimes(1));
    const [pid, aid, body] = mockUpsert.mock.calls[0];
    expect(pid).toBe('p1');
    expect(aid).toBe('t1');
    expect(body.proceed_critical_override_justification).toBe('accepted residual risk');
    expect(body.remaining_critical_count).toBe(1); // count at override time
    await waitFor(() => expect(onProceed).toHaveBeenCalledTimes(1));
    expect(onPersisted).toHaveBeenCalledTimes(1);
  });

  it('(c2) renders the later read-only override banner from a persisted trio (justification + count + timestamp)', () => {
    render(
      <ProceedCriticalGate
        projectId="p1"
        architectureId="t1"
        delta={deltaWithRemaining([criticalCve('CVE-2024-1', 'com.acme:lib')])}
        persistedOverride={{
          proceed_critical_override_justification: 'risk accepted by approver',
          remaining_critical_count: 2,
          proceed_critical_override_at: '2026-06-25T10:00:00Z',
          overridden: true,
        }}
        proceedEnabled
        onProceed={vi.fn()}
      />,
    );
    const banner = screen.getByTestId('proceed-critical-override-banner');
    expect(banner.textContent).toContain('risk accepted by approver');
    expect(banner.textContent).toContain('2');
    expect(banner.textContent).toContain('2026-06-25T10:00:00Z');
  });

  it('(d) NON-critical severities do NOT gate: proceed is immediate (no override dialog)', async () => {
    const onProceed = vi.fn().mockResolvedValue(undefined);
    const highOnly: ClassifiedVulnerability = {
      ...criticalCve('CVE-2024-9', 'com.acme:lib'),
      severity: 'high', // NOT critical
    };
    render(
      <ProceedCriticalGate
        projectId="p1"
        architectureId="t1"
        delta={deltaWithRemaining([highOnly])}
        persistedOverride={null}
        proceedEnabled
        onProceed={onProceed}
      />,
    );
    // Not blocked — no gate hint, no dialog on proceed.
    expect(screen.getByTestId('proceed-critical-gate').getAttribute('data-gate-blocked')).toBe('false');
    expect(screen.queryByTestId('proceed-critical-gate-hint')).toBeNull();

    fireEvent.click(screen.getByTestId('proceed-critical-gate-button'));
    await waitFor(() => expect(onProceed).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('proceed-critical-override-dialog')).toBeNull();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
