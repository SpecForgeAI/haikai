/**
 * MigrationDeliveryPlanProgressSummary tests
 *
 * Spec: 2026-05-17 PM Migration Delivery Plan + Draft Book-of-Work Generation
 * Task Group 10.1 — focused coverage of the scripted progress overlay (Q-15)
 * and the post-generation draft summary surface.
 *
 * Coverage:
 *   1. Each scripted stage marker flips as the gateway phase advances:
 *        - loading_context
 *        - calling_generator
 *        - validating_schema
 *        - saving_draft
 *        - complete
 *   2. Summary surface renders item counts (initiatives / epics / features /
 *      stories) and the confidence + readiness breakdowns.
 *   3. Major gaps callout renders the top items.
 *   4. "Open hierarchy" button invokes the onOpenHierarchy callback with the
 *      current draft id (the Group 11 route entry point).
 *
 * No fetch is exercised: we pass `draft` prop directly to skip the fetch
 * effect and keep the test pure.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import {
  MigrationDeliveryPlanProgressSummary,
  ProgressOverlay,
  DraftSummary,
  aggregateItemMetrics,
  deriveCurrentPhase,
} from '../MigrationDeliveryPlanProgressSummary';
import type {
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkItem,
} from '../../../../api/migrationDeliveryPlanApi';

// ============================================================================
// Fixtures
// ============================================================================

function makeItem(overrides: Partial<MigrationBookOfWorkItem>): MigrationBookOfWorkItem {
  return {
    id: 'i-1',
    type: 'story',
    parentId: null,
    title: 'Item',
    description: '',
    acceptanceCriteria: [],
    workstream: 'other',
    sequenceOrder: 0,
    tags: [],
    confidence: 'medium',
    readiness: 'needs_focused_context',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: '',
    traceabilitySummary: '',
    ...overrides,
  };
}

const ITEMS: MigrationBookOfWorkItem[] = [
  makeItem({
    id: 'init-1',
    type: 'initiative',
    confidence: 'high',
    readiness: 'ready_for_spec',
  }),
  makeItem({
    id: 'epic-1',
    type: 'epic',
    parentId: 'init-1',
    confidence: 'high',
    readiness: 'ready_for_spec',
  }),
  makeItem({
    id: 'feat-1',
    type: 'feature',
    parentId: 'epic-1',
    confidence: 'medium',
    readiness: 'needs_focused_context',
  }),
  makeItem({
    id: 'feat-2',
    type: 'feature',
    parentId: 'epic-1',
    confidence: 'low',
    readiness: 'blocked',
  }),
  makeItem({
    id: 'story-1',
    type: 'story',
    parentId: 'feat-1',
    confidence: 'medium',
    readiness: 'needs_user_decision',
  }),
  makeItem({
    id: 'story-2',
    type: 'story',
    parentId: 'feat-2',
    confidence: 'low',
    readiness: 'blocked',
  }),
];

const DRAFT: MigrationBookOfWorkDraft = {
  id: 'draft-99',
  projectId: 'proj-1',
  currentArchitectureId: 'arch-current',
  targetArchitectureId: 'arch-target',
  status: 'draft',
  title: 'Migration Delivery Plan — sample draft',
  summary: 'Generated from a small fixture for tests.',
  generationInputs: null,
  generationSummary: {
    initiativeCount: 1,
    epicCount: 1,
    featureCount: 2,
    storyCount: 2,
    totalItemCount: 6,
    confidenceBreakdown: { high: 2, medium: 2, low: 2 },
    readinessBreakdown: {
      ready_for_spec: 2,
      needs_focused_context: 1,
      needs_user_decision: 1,
      blocked: 2,
    },
    findingsAddressed: 5,
    findingsNotAddressed: 2,
    contractsCovered: 3,
    baselinesCovered: 1,
    dataEntitiesCovered: 4,
    infrastructureCovered: 1,
    mappingsUsed: 4,
    majorGaps: [
      'Mappings missing for OrderItem',
      'No baseline for /v1/payments',
      'Database discovery skipped for legacy_audit table',
    ],
    blockingIssues: ['Target architecture has no infrastructure mapping'],
  },
  qualityAssessment: {
    overall: { score: 'B+', rationale: 'Solid coverage with two gaps' },
    storyLevel: { score: 'A-', rationale: 'Stories well-bounded' },
  },
  bookOfWork: { items: ITEMS },
  createdByTask: 'product-manager--migration-delivery-plan',
  savedToBacklogAt: null,
  errorMessage: null,
  createdAt: '2026-05-17T11:00:00Z',
  updatedAt: '2026-05-17T11:00:00Z',
};

// ============================================================================
// Tests — Progress overlay (Task 10.1 #1)
// ============================================================================

describe('ProgressOverlay — scripted stage markers (Task 10.1 #1)', () => {
  it('loading_context phase shows the first marker as active', () => {
    render(<ProgressOverlay phase="loading_context" />);
    const overlay = screen.getByTestId('mdp-progress-overlay');
    expect(overlay).toHaveAttribute('data-current-phase', 'loading_context');
    expect(screen.getByTestId('mdp-progress-stage-loading_context')).toHaveAttribute(
      'data-state',
      'active'
    );
  });

  it('calling_generator phase marks loading_context done and itself active', () => {
    render(<ProgressOverlay phase="calling_generator" />);
    expect(
      screen.getByTestId('mdp-progress-stage-loading_context')
    ).toHaveAttribute('data-state', 'done');
    expect(
      screen.getByTestId('mdp-progress-stage-calling_generator')
    ).toHaveAttribute('data-state', 'active');
  });

  it('validating_schema phase advances markers further', () => {
    render(<ProgressOverlay phase="validating_schema" />);
    expect(
      screen.getByTestId('mdp-progress-stage-calling_generator')
    ).toHaveAttribute('data-state', 'done');
    expect(
      screen.getByTestId('mdp-progress-stage-validating_schema')
    ).toHaveAttribute('data-state', 'active');
  });

  it('saving_draft phase marks all prior phases done', () => {
    render(<ProgressOverlay phase="saving_draft" />);
    expect(
      screen.getByTestId('mdp-progress-stage-loading_context')
    ).toHaveAttribute('data-state', 'done');
    expect(
      screen.getByTestId('mdp-progress-stage-validating_schema')
    ).toHaveAttribute('data-state', 'done');
    expect(
      screen.getByTestId('mdp-progress-stage-saving_draft')
    ).toHaveAttribute('data-state', 'active');
  });

  it('complete phase marks every prior phase done and the last marker active', () => {
    render(<ProgressOverlay phase="complete" />);
    expect(
      screen.getByTestId('mdp-progress-stage-loading_context')
    ).toHaveAttribute('data-state', 'done');
    expect(
      screen.getByTestId('mdp-progress-stage-saving_draft')
    ).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('mdp-progress-stage-complete')).toHaveAttribute(
      'data-state',
      'active'
    );
  });

  it('error phase surfaces the error banner', () => {
    render(<ProgressOverlay phase="error" error="Schema validation failed" />);
    expect(screen.getByTestId('mdp-progress-error')).toHaveTextContent(
      /schema validation failed/i
    );
  });

  it('time-bucket fallback drives phase progression when explicit phase is omitted', () => {
    // Fake clock at known elapsed time: 13s after start lands in
    // `validating_schema` bucket.
    const startedAt = 1_000_000;
    const now = () => startedAt + 13_000;
    expect(deriveCurrentPhase({ startedAt, now })).toBe('validating_schema');
  });
});

// ============================================================================
// Tests — DraftSummary (Task 10.1 #2 + #3)
// ============================================================================

describe('DraftSummary — counts + breakdowns (Task 10.1 #2)', () => {
  it('renders item counts per type from the generationSummary blob', () => {
    render(
      <DraftSummary draft={DRAFT} onOpenHierarchy={vi.fn()} />
    );
    expect(screen.getByTestId('mdp-summary-count-initiative')).toHaveTextContent('1');
    expect(screen.getByTestId('mdp-summary-count-epic')).toHaveTextContent('1');
    expect(screen.getByTestId('mdp-summary-count-feature')).toHaveTextContent('2');
    expect(screen.getByTestId('mdp-summary-count-story')).toHaveTextContent('2');
    expect(screen.getByTestId('mdp-summary-count-total')).toHaveTextContent('6');
  });

  it('renders confidence breakdown chips', () => {
    render(<DraftSummary draft={DRAFT} onOpenHierarchy={vi.fn()} />);
    expect(screen.getByTestId('mdp-summary-confidence-high')).toHaveTextContent(/2/);
    expect(screen.getByTestId('mdp-summary-confidence-medium')).toHaveTextContent(
      /2/
    );
    expect(screen.getByTestId('mdp-summary-confidence-low')).toHaveTextContent(/2/);
  });

  it('renders readiness breakdown chips with the four readiness values', () => {
    render(<DraftSummary draft={DRAFT} onOpenHierarchy={vi.fn()} />);
    expect(
      screen.getByTestId('mdp-summary-readiness-ready_for_spec')
    ).toHaveTextContent(/2/);
    expect(
      screen.getByTestId('mdp-summary-readiness-needs_focused_context')
    ).toHaveTextContent(/1/);
    expect(
      screen.getByTestId('mdp-summary-readiness-needs_user_decision')
    ).toHaveTextContent(/1/);
    expect(
      screen.getByTestId('mdp-summary-readiness-blocked')
    ).toHaveTextContent(/2/);
  });

  it('falls back to item aggregation when generationSummary is null', () => {
    const minimalDraft: MigrationBookOfWorkDraft = {
      ...DRAFT,
      generationSummary: null,
    };
    render(<DraftSummary draft={minimalDraft} onOpenHierarchy={vi.fn()} />);
    // Aggregation pulls the same totals from the items array.
    expect(screen.getByTestId('mdp-summary-count-total')).toHaveTextContent('6');
    expect(screen.getByTestId('mdp-summary-confidence-high')).toHaveTextContent(/2/);
  });
});

describe('DraftSummary — major gaps callout (Task 10.1 #3)', () => {
  it('renders the top major gaps from the summary', () => {
    render(<DraftSummary draft={DRAFT} onOpenHierarchy={vi.fn()} />);
    const section = screen.getByTestId('mdp-draft-summary-major-gaps');
    const list = within(section);
    expect(list.getByTestId('mdp-summary-major-gap-0')).toHaveTextContent(
      /mappings missing for orderitem/i
    );
    expect(list.getByTestId('mdp-summary-major-gap-1')).toHaveTextContent(
      /no baseline for/i
    );
    expect(list.getByTestId('mdp-summary-major-gap-2')).toHaveTextContent(
      /database discovery skipped/i
    );
  });

  it('surfaces blocking issues in a dedicated callout', () => {
    render(<DraftSummary draft={DRAFT} onOpenHierarchy={vi.fn()} />);
    const callout = screen.getByTestId('mdp-draft-summary-blocking-issues');
    expect(callout).toHaveTextContent(/no infrastructure mapping/i);
  });
});

// ============================================================================
// Tests — Open hierarchy navigation (Task 10.1 #4)
// ============================================================================

describe('DraftSummary — Open hierarchy navigation (Task 10.1 #4)', () => {
  it('invokes onOpenHierarchy with the draft id when the button is clicked', () => {
    const onOpen = vi.fn();
    render(<DraftSummary draft={DRAFT} onOpenHierarchy={onOpen} />);
    fireEvent.click(screen.getByTestId('mdp-summary-open-hierarchy'));
    expect(onOpen).toHaveBeenCalledWith('draft-99');
  });
});

// ============================================================================
// Combined-surface integration (parent component)
// ============================================================================

describe('MigrationDeliveryPlanProgressSummary — parent surface integration', () => {
  it('shows the progress overlay while phase !== complete', () => {
    render(
      <MigrationDeliveryPlanProgressSummary
        projectId="proj-1"
        phase="calling_generator"
        startedAt={Date.now()}
        onOpenHierarchy={vi.fn()}
      />
    );
    expect(screen.getByTestId('mdp-progress-overlay')).toBeInTheDocument();
    expect(
      screen.queryByTestId('mdp-draft-summary')
    ).not.toBeInTheDocument();
  });

  it('shows the draft summary once phase === complete and a draft is supplied', () => {
    render(
      <MigrationDeliveryPlanProgressSummary
        projectId="proj-1"
        phase="complete"
        draftId="draft-99"
        draft={DRAFT}
        onOpenHierarchy={vi.fn()}
      />
    );
    expect(screen.getByTestId('mdp-draft-summary')).toBeInTheDocument();
    expect(
      screen.queryByTestId('mdp-progress-overlay')
    ).not.toBeInTheDocument();
  });

  it('fetches the draft when phase === complete and only a draftId is supplied', async () => {
    const fetchDraft = vi.fn().mockResolvedValue(DRAFT);
    render(
      <MigrationDeliveryPlanProgressSummary
        projectId="proj-1"
        phase="complete"
        draftId="draft-99"
        fetchDraft={fetchDraft as never}
        onOpenHierarchy={vi.fn()}
      />
    );
    // Initially the progress overlay shows because the fetch is pending.
    expect(screen.getByTestId('mdp-progress-overlay')).toBeInTheDocument();
    // Once the fetch resolves the summary appears.
    expect(await screen.findByTestId('mdp-draft-summary')).toBeInTheDocument();
    expect(fetchDraft).toHaveBeenCalledWith('proj-1', 'draft-99');
  });
});

// ============================================================================
// aggregateItemMetrics utility coverage
// ============================================================================

describe('aggregateItemMetrics — pure aggregation helper', () => {
  it('counts items per type and breaks down confidence + readiness', () => {
    const out = aggregateItemMetrics(ITEMS);
    expect(out.initiativeCount).toBe(1);
    expect(out.epicCount).toBe(1);
    expect(out.featureCount).toBe(2);
    expect(out.storyCount).toBe(2);
    expect(out.totalItemCount).toBe(6);
    expect(out.confidenceBreakdown).toEqual({ high: 2, medium: 2, low: 2 });
    expect(out.readinessBreakdown).toEqual({
      ready_for_spec: 2,
      needs_focused_context: 1,
      needs_user_decision: 1,
      blocked: 2,
    });
  });

  it('returns zeros for an empty list', () => {
    const out = aggregateItemMetrics([]);
    expect(out.totalItemCount).toBe(0);
    expect(out.confidenceBreakdown).toEqual({ high: 0, medium: 0, low: 0 });
  });
});

// ============================================================================
// Tests — DraftSummary expansion progress (Spec 2026-06-11, Group 5.7)
// ============================================================================

describe('DraftSummary — "X of Y epics expanded" line (Spec 2026-06-11, Group 5.7)', () => {
  it('derives the line from per-epic expansionState and omits it for legacy drafts', () => {
    const skeletonDraft: MigrationBookOfWorkDraft = {
      ...DRAFT,
      generationSummary: null,
      bookOfWork: {
        items: [
          makeItem({ id: 'e1', type: 'epic', expansionState: 'expanded' }),
          makeItem({ id: 'e2', type: 'epic', expansionState: 'expanded' }),
          makeItem({ id: 'e3', type: 'epic', expansionState: 'not_expanded' }),
          makeItem({ id: 'e4', type: 'epic', expansionState: 'failed' }),
        ],
      },
    };
    const { unmount } = render(
      <DraftSummary draft={skeletonDraft} onOpenHierarchy={vi.fn()} />
    );
    expect(screen.getByTestId('mdp-summary-epics-expanded')).toHaveTextContent(
      '2 of 4 epics expanded'
    );
    unmount();

    // Legacy full-plan draft: no epic carries expansionState -> no line.
    render(<DraftSummary draft={DRAFT} onOpenHierarchy={vi.fn()} />);
    expect(screen.queryByTestId('mdp-summary-epics-expanded')).toBeNull();
  });
});
