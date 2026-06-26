/**
 * MigrationDeliveryPlanWizard — saved-conversation binding + pre-flight readiness
 *
 * Spec: 2026-06-26-target-conversation-save-resume-plan-sourcing
 *   Task Group 5 (FR5 plan-target binding + FR7 pre-flight readiness).
 *
 * Focused coverage of Task 5.1:
 *   1. The target `<select>` lists ONLY saved targets (conversationSavedAt != null),
 *      labelled "name + saved date".
 *   2. The selection defaults to the most-recent-saved target.
 *   3. The single selection drives `targetArchitectureId` for the context fetch
 *      (decisions + tech-stack + mappings unified on one target).
 *   4. The pre-flight readiness panel renders saved date, answered/total,
 *      foundational DB decisions, tech-stack y/n, and named gaps.
 *   5. answered/total EXCLUDES not_applicable/deferred from BOTH numerator and
 *      denominator (auto-skipped, not gaps).
 *
 * Test strategy: pure-component testing with every external dependency supplied
 * via the wizard's test seams (no fetch, no providers).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  MigrationDeliveryPlanWizard,
  computePreflightReadiness,
  type ArchitectureOption,
  type PreflightDecisionRow,
} from '../MigrationDeliveryPlanWizard';

const PROJECT_ID = 'proj-aaa';
const CURRENT_ARCH_ID = 'arch-current-1';

const ARCHITECTURES: ArchitectureOption[] = [
  { id: CURRENT_ARCH_ID, name: 'Monolith (current)' },
];

// Two saved conversations + one unsaved target (must be filtered out of the
// saved-conversation selector). `tgt-new` is the most-recent-saved.
const SAVED_TARGETS = [
  {
    id: 'tgt-new',
    name: 'New Target',
    conversationSavedAt: '2026-06-26T10:00:00Z',
  },
  {
    id: 'tgt-old',
    name: 'Old Target',
    conversationSavedAt: '2026-06-20T09:00:00Z',
  },
  {
    id: 'tgt-unsaved',
    name: 'Unsaved Target',
    conversationSavedAt: null,
  },
];

// 3 real answers + 1 not_applicable + 1 deferred. db.engine answered,
// db.migrations absent (a named gap). service.language carries a versioned
// {framework,version} envelope (tech-stack written = yes).
const DECISIONS: PreflightDecisionRow[] = [
  {
    decisionCode: 'service.language',
    answerValue: '{"value":{"framework":"Java","version":"21"}}',
    answerSummary: 'Java 21',
  },
  { decisionCode: 'api.protocol', answerValue: 'rest', answerSummary: null },
  { decisionCode: 'db.engine', answerValue: 'postgres', answerSummary: null },
  {
    decisionCode: 'ui.framework',
    answerValue: 'not_applicable',
    answerSummary: null,
  },
  { decisionCode: 'cache.layer', answerValue: 'deferred', answerSummary: null },
];

beforeEach(() => {
  vi.clearAllMocks();
});

function renderWizard(
  opts: {
    savedTargets?: unknown[];
    decisions?: PreflightDecisionRow[];
    fetchContext?: ReturnType<typeof vi.fn>;
  } = {},
) {
  const fetchSavedTargets = vi
    .fn()
    .mockResolvedValue(opts.savedTargets ?? SAVED_TARGETS);
  const fetchCapturedDecisions = vi
    .fn()
    .mockResolvedValue(opts.decisions ?? DECISIONS);
  const fetchContext =
    opts.fetchContext ?? vi.fn().mockResolvedValue(null);
  const fetchManifests = vi.fn().mockResolvedValue([]);
  const utils = render(
    <MigrationDeliveryPlanWizard
      open
      projectId={PROJECT_ID}
      architectures={ARCHITECTURES}
      onClose={vi.fn() as never}
      onGenerationComplete={vi.fn() as never}
      fetchContext={fetchContext as never}
      generate={vi.fn() as never}
      fetchManifests={fetchManifests as never}
      fetchSavedTargets={fetchSavedTargets as never}
      fetchCapturedDecisions={fetchCapturedDecisions as never}
    />,
  );
  return { ...utils, fetchSavedTargets, fetchCapturedDecisions, fetchContext };
}

// ============================================================================
// Pure helper — readiness counting + exclusion rule
// ============================================================================

describe('computePreflightReadiness (Task 5.1 — exclusion rule)', () => {
  it('excludes not_applicable/deferred from BOTH the numerator and denominator', () => {
    const r = computePreflightReadiness('2026-06-26T10:00:00Z', DECISIONS);
    // 3 real answers; the not_applicable + deferred rows are auto-skipped from
    // BOTH counts (so 3/3, never 3/5 or 5/5).
    expect(r.answeredCount).toBe(3);
    expect(r.totalCount).toBe(3);
  });

  it('reports foundational DB presence, tech-stack written, and names the gaps', () => {
    const r = computePreflightReadiness('2026-06-26T10:00:00Z', DECISIONS);
    expect(r.dbEnginePresent).toBe(true);
    expect(r.dbMigrationsPresent).toBe(false);
    expect(r.techStackWritten).toBe(true);
    // db.migrations is absent -> a named gap; the answered foundational codes
    // (service.language / api.protocol / db.engine) are not gaps.
    expect(r.namedGaps).toEqual(['db.migrations']);
  });
});

// ============================================================================
// Target selector — saved conversations only, most-recent-saved default
// ============================================================================

describe('MigrationDeliveryPlanWizard — saved-conversation target selector (Task 5.1)', () => {
  it('lists ONLY saved targets, labelled name + saved date', async () => {
    renderWizard();
    const select = screen.getByTestId('mdp-wizard-target-arch');
    await waitFor(() => {
      // Placeholder + exactly the two SAVED targets (unsaved filtered out).
      expect(within(select).getAllByRole('option')).toHaveLength(3);
    });
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Select...',
      'New Target (saved 2026-06-26)',
      'Old Target (saved 2026-06-20)',
    ]);
    expect(within(select).queryByText(/Unsaved Target/)).toBeNull();
  });

  it('defaults the target to the most-recent-saved conversation', async () => {
    renderWizard();
    const select = screen.getByTestId('mdp-wizard-target-arch') as HTMLSelectElement;
    await waitFor(() => {
      expect(select.value).toBe('tgt-new');
    });
  });

  it('the single selection drives the context fetch (decisions + tech-stack + mappings)', async () => {
    const fetchContext = vi.fn().mockResolvedValue(null);
    renderWizard({ fetchContext });
    // Pick a current architecture so the context fetch fires.
    fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
      target: { value: CURRENT_ARCH_ID },
    });
    // The default target (most-recent-saved) flows into the context fetch.
    await waitFor(() => {
      expect(fetchContext).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ targetArchitectureId: 'tgt-new' }),
      );
    });
    // Choosing another saved conversation re-binds the SAME id downstream.
    fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
      target: { value: 'tgt-old' },
    });
    await waitFor(() => {
      expect(fetchContext).toHaveBeenCalledWith(
        PROJECT_ID,
        expect.objectContaining({ targetArchitectureId: 'tgt-old' }),
      );
    });
  });
});

// ============================================================================
// Pre-flight readiness panel
// ============================================================================

describe('MigrationDeliveryPlanWizard — pre-flight readiness panel (Task 5.1)', () => {
  it('renders saved date, answered/total, foundational DB, tech-stack, and named gaps', async () => {
    renderWizard();
    // The panel binds to the most-recent-saved default once data resolves.
    await screen.findByTestId('mdp-wizard-preflight-readiness');

    expect(
      screen.getByTestId('mdp-wizard-preflight-saved-date'),
    ).toHaveTextContent('2026-06-26');
    // 3 answered / 3 total — not_applicable + deferred excluded from BOTH.
    expect(
      screen.getByTestId('mdp-wizard-preflight-answered'),
    ).toHaveTextContent('3/3');
    expect(
      screen.getByTestId('mdp-wizard-preflight-db-engine'),
    ).toHaveTextContent('present');
    expect(
      screen.getByTestId('mdp-wizard-preflight-db-migrations'),
    ).toHaveTextContent('missing');
    expect(
      screen.getByTestId('mdp-wizard-preflight-tech-stack'),
    ).toHaveTextContent('Yes');
    expect(screen.getByTestId('mdp-wizard-preflight-gaps')).toHaveTextContent(
      'db.migrations',
    );
  });
});
