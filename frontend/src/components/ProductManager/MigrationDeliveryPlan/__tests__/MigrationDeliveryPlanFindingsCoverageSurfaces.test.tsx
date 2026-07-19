/**
 * Findings-coverage surfaces tests (Spec 2026-06-11 Deterministic
 * Findings-Coverage Verification + Gap Wayfinding — Task Group 4.1).
 *
 * Covers the MigrationDeliveryPlan-side consumer surfaces of the shared
 * Group-2 modules (`utils/findingsCoverage.ts`,
 * `config/gapWayfindingRegistry.ts`):
 *   1. Wizard readiness gaps render explanation CARDS (registry title +
 *      explanation + "Go to ..." Link with the expected href; plain action
 *      text for unknown codes whose `buildDestination` is null).
 *   2. Wizard `contextWarnings` get the same card treatment.
 *   3. Review workspace "Unaddressed findings" panel: per-finding rows with
 *      title + severity badge + drawer deep link.
 *   4. Review workspace positive / empty / hidden panel states (D8:
 *      legacy snapshot-less drafts hide every coverage element).
 *   5. Progress summary renders COMPUTED addressed/unaddressed values (the
 *      broken legacy `gen.findingsAddressed` reads are gone) and hides
 *      both lines for snapshot-less drafts.
 *   6. Draft list rows show computed counts for snapshot-bearing drafts
 *      and nothing for legacy rows.
 *
 * The dashboard-card consumer is covered by the sibling
 * `MigrationDeliveryDashboard/__tests__/MigrationDeliverySummaryCardsFindingsCoverage.test.tsx`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// --- CSS module mocks (class-name access safety under jsdom) --------------
vi.mock('../MigrationDeliveryPlanWizard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// --- API mocks --------------------------------------------------------------
const mockListMigrationBookOfWorks = vi.fn();

vi.mock('../../../../api/migrationBookOfWorkApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationBookOfWorkApi')
  >('../../../../api/migrationBookOfWorkApi');
  return {
    ...actual,
    listMigrationBookOfWorks: (...args: unknown[]) =>
      mockListMigrationBookOfWorks(...args),
  };
});

// The review workspace soft-fetches DB migration packs on mount.
vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return {
    ...actual,
    listDbMigrationPacks: vi.fn().mockResolvedValue([]),
  };
});

import { MigrationDeliveryPlanWizard, ArchitectureOption } from '../MigrationDeliveryPlanWizard';
import MigrationBookOfWorkReviewWorkspace from '../MigrationBookOfWorkReviewWorkspace';
import MigrationBookOfWorkDraftListView from '../MigrationBookOfWorkDraftListView';
import { DraftSummary } from '../MigrationDeliveryPlanProgressSummary';
import type {
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkItem,
} from '../../../../api/migrationBookOfWorkApi';
import type { MigrationBookOfWorkDraft as PlanDraft } from '../../../../api/migrationDeliveryPlanApi';
import type { MigrationDiscoveryContext } from '../../../../api/migrationDiscoveryContextApi';

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-fc';
const BOOK_ID = 'book-fc';
const CURRENT_ARCH_ID = 'arch-current-fc';
const TARGET_ARCH_ID = 'arch-target-fc';
const ARCH_BASE = `/projects/${PROJECT_ID}/architectures/${CURRENT_ARCH_ID}`;

/** Create-time snapshot: 3 accepted critical/high findings across 2 runs. */
const SNAPSHOT = {
  findings: [
    {
      id: 'f-1',
      title: 'Stored procedure side effects in order flow',
      severity: 'critical',
      runId: 'run-1',
    },
    {
      id: 'f-2',
      title: 'Trigger cascade on customer delete',
      severity: 'high',
      runId: 'run-1',
    },
    {
      id: 'f-3',
      title: 'Sequence drift between audit tables',
      severity: 'high',
      runId: 'run-2',
    },
  ],
};

function makeItem(
  overrides: Partial<MigrationBookOfWorkItem> = {},
): MigrationBookOfWorkItem {
  return {
    id: 'i-default',
    type: 'story',
    parentId: null,
    title: 'Default item',
    description: 'desc',
    acceptanceCriteria: [],
    workstream: 'other',
    sequenceOrder: 0,
    tags: [],
    confidence: 'medium',
    readiness: 'ready_for_spec',
    readinessReasons: [],
    missingInputs: [],
    recommendedNextAction: '',
    traceabilitySummary: '',
    evidenceReferences: [],
    architectureReferences: [],
    apiBaselineReferences: [],
    discoveryFindingReferences: [],
    mappingReferences: [],
    sourceContextRefs: [],
    ...overrides,
  };
}

function makeDraft(
  overrides: Partial<MigrationBookOfWorkDraft> = {},
): MigrationBookOfWorkDraft {
  return {
    id: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: CURRENT_ARCH_ID,
    targetArchitectureId: TARGET_ARCH_ID,
    status: 'draft',
    title: 'Coverage test plan',
    summary: 'Summary',
    generationInputs: null,
    generationSummary: { findingsCoverage: SNAPSHOT },
    qualityAssessment: null,
    bookOfWork: {
      items: [
        // ' F-1 ' exercises the trimmed, case-insensitive id matching.
        makeItem({ id: 's-1', discoveryFindingReferences: [' F-1 '] }),
      ],
    },
    createdByTask: 'product-manager--migration-delivery-plan',
    savedToBacklogAt: null,
    errorMessage: null,
    createdAt: '2026-06-11T10:00:00Z',
    updatedAt: '2026-06-11T10:00:00Z',
    ...overrides,
  };
}

const ARCHITECTURES: ArchitectureOption[] = [
  { id: CURRENT_ARCH_ID, name: 'Current' },
  { id: TARGET_ARCH_ID, name: 'Target' },
];

function buildWizardContext(
  overrides: Partial<MigrationDiscoveryContext> = {},
): MigrationDiscoveryContext {
  return {
    projectId: PROJECT_ID,
    currentArchitectureId: CURRENT_ARCH_ID,
    targetArchitectureId: TARGET_ARCH_ID,
    generatedAt: '2026-06-11T09:00:00Z',
    findingsSummary: { totalFindings: 3 },
    discoveryRunsSummary: {
      totalRuns: 1,
      completedRuns: 1,
      runs: [
        {
          runId: 'run-1',
          architectureId: CURRENT_ARCH_ID,
          status: 'completed',
          discoveryKind: 'java-spring',
          createdAt: '2026-06-10T10:00:00Z',
          updatedAt: '2026-06-10T11:00:00Z',
        },
      ],
    },
    readinessAssessment: { overallStatus: 'partial', gaps: [] },
    ...overrides,
  };
}

async function renderWizardWithContext(context: MigrationDiscoveryContext) {
  const fetchContext = vi.fn().mockResolvedValue(context);
  const generate = vi.fn();
  render(
    <MemoryRouter>
      <MigrationDeliveryPlanWizard
        open
        projectId={PROJECT_ID}
        architectures={ARCHITECTURES}
        onClose={vi.fn() as never}
        onGenerationComplete={vi.fn() as never}
        fetchContext={fetchContext as never}
        generate={generate as never}
      />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByTestId('mdp-wizard-current-arch'), {
    target: { value: CURRENT_ARCH_ID },
  });
  fireEvent.change(screen.getByTestId('mdp-wizard-target-arch'), {
    target: { value: TARGET_ARCH_ID },
  });
  await waitFor(() => {
    expect(screen.getByTestId('mdp-wizard-readiness-card')).toBeInTheDocument();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// 1 + 2 — Wizard explanation cards
// ============================================================================

describe('MigrationDeliveryPlanWizard — gap wayfinding cards (4.2)', () => {
  it('renders explanation cards for gap codes: registry title + explanation + "Go to ..." link; plain action text for unknown codes', async () => {
    await renderWizardWithContext(
      buildWizardContext({
        readinessAssessment: {
          overallStatus: 'partial',
          gaps: ['high_severity_unreviewed_findings', 'made_up_future_code'],
        },
      }),
    );

    const gapsArea = await screen.findByTestId('mdp-wizard-readiness-gaps');

    // Known code: registry title + explanation + run-scoped deep link
    // (run-1 is the wizard's pre-selected discovery run).
    const knownCard = within(gapsArea).getByTestId(
      'mdp-wizard-gap-card-high_severity_unreviewed_findings',
    );
    expect(knownCard).toHaveTextContent('Unreviewed critical/high findings');
    expect(knownCard).toHaveTextContent(/still awaiting review/i);
    const link = within(knownCard).getByTestId(
      'mdp-wizard-gap-link-high_severity_unreviewed_findings',
    );
    expect(link.getAttribute('href')).toBe(
      `${ARCH_BASE}/discovery/runs/run-1?tab=findings`,
    );

    // Unknown code: humanized fallback title, action label as plain text,
    // NO link (buildDestination is null) — and nothing throws.
    const unknownCard = within(gapsArea).getByTestId(
      'mdp-wizard-gap-card-made_up_future_code',
    );
    expect(unknownCard).toHaveTextContent('Made up future code');
    expect(
      within(unknownCard).getByTestId('mdp-wizard-gap-action-made_up_future_code'),
    ).toHaveTextContent(/review this gap with your architect/i);
    expect(
      within(unknownCard).queryByTestId('mdp-wizard-gap-link-made_up_future_code'),
    ).not.toBeInTheDocument();
  });

  it('renders contextWarnings with the same card treatment', async () => {
    await renderWizardWithContext(
      buildWizardContext({
        discoveryRunsSummary: { totalRuns: 0, completedRuns: 0, runs: [] },
        contextWarnings: ['no_discovery_runs_selected'],
      }),
    );

    const warningsArea = await screen.findByTestId('mdp-wizard-context-warnings');
    const card = within(warningsArea).getByTestId(
      'mdp-wizard-gap-card-no_discovery_runs_selected',
    );
    expect(card).toHaveTextContent('No discovery runs selected');
    expect(card).toHaveTextContent(/committed model alone/i);
    const link = within(card).getByTestId(
      'mdp-wizard-gap-link-no_discovery_runs_selected',
    );
    expect(link.getAttribute('href')).toBe(`${ARCH_BASE}/discovery`);
  });
});

// ============================================================================
// 3 + 4 — Review workspace unaddressed findings panel
// ============================================================================

describe('MigrationBookOfWorkReviewWorkspace — unaddressed findings panel (4.3)', () => {
  function renderWorkspace(draft: MigrationBookOfWorkDraft) {
    return render(
      <MemoryRouter>
        <MigrationBookOfWorkReviewWorkspace
          projectId={PROJECT_ID}
          bookId={BOOK_ID}
          initialDraft={draft}
        />
      </MemoryRouter>,
    );
  }

  it('collapses to a one-line advisory summary + View button; the modal lists each unaddressed finding with title + severity + deep link', () => {
    renderWorkspace(makeDraft());

    // s-1 references ' F-1 ' → f-1 addressed (trim + case-insensitive);
    // f-2 and f-3 remain unaddressed.
    expect(screen.getByTestId('review-coverage-summary')).toHaveTextContent(
      'Findings addressed: 1 / 3',
    );

    // The panel is a COMPACT advisory summary — the full list is NOT inline.
    const panel = screen.getByTestId('unaddressed-findings-panel');
    expect(panel).toBeInTheDocument();
    expect(
      within(panel).getByTestId('unaddressed-findings-summary'),
    ).toHaveTextContent(
      /2 of 3 accepted critical\/high findings aren.t linked to a work item/i,
    );
    // No rows and no modal before the user opens it.
    expect(
      screen.queryByTestId('unaddressed-finding-row-f-2'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('unaddressed-findings-dialog'),
    ).not.toBeInTheDocument();

    // Open the detail modal.
    fireEvent.click(
      within(panel).getByTestId('unaddressed-findings-view-button'),
    );
    const dialog = screen.getByTestId('unaddressed-findings-dialog');

    // f-1 is addressed → never listed; f-2 + f-3 are, with their deep links.
    expect(
      within(dialog).queryByTestId('unaddressed-finding-row-f-1'),
    ).not.toBeInTheDocument();
    const row2 = within(dialog).getByTestId('unaddressed-finding-row-f-2');
    expect(row2).toHaveTextContent('Trigger cascade on customer delete');
    expect(
      within(row2).getByTestId('unaddressed-finding-severity-f-2'),
    ).toHaveTextContent('high');
    expect(
      within(row2)
        .getByTestId('unaddressed-finding-link-f-2')
        .getAttribute('href'),
    ).toBe(`${ARCH_BASE}/discovery/runs/run-1?tab=findings&findingId=f-2`);
    // f-3 deep-links to ITS OWN run (run-2), not the sibling's.
    expect(
      within(dialog)
        .getByTestId('unaddressed-finding-link-f-3')
        .getAttribute('href'),
    ).toBe(`${ARCH_BASE}/discovery/runs/run-2?tab=findings&findingId=f-3`);

    // Close returns to the collapsed summary.
    fireEvent.click(
      within(dialog).getByTestId('unaddressed-findings-dialog-close'),
    );
    expect(
      screen.queryByTestId('unaddressed-findings-dialog'),
    ).not.toBeInTheDocument();
  });

  it('shows the positive all-addressed state, the empty-snapshot state, and hides the panel entirely for legacy drafts (D8)', () => {
    // (a) All addressed → positive confirmation.
    const allAddressed = makeDraft({
      bookOfWork: {
        items: [
          makeItem({
            id: 's-all',
            discoveryFindingReferences: ['f-1', 'F-2', ' f-3 '],
          }),
        ],
      },
    });
    const first = renderWorkspace(allAddressed);
    expect(
      screen.getByTestId('unaddressed-findings-all-addressed'),
    ).toHaveTextContent(
      'All 3 accepted critical/high findings are linked to a work item in this plan.',
    );
    first.unmount();

    // (b) Empty snapshot (runs selected, zero accepted findings).
    const emptySnapshot = makeDraft({
      generationSummary: { findingsCoverage: { findings: [] } },
    });
    const second = renderWorkspace(emptySnapshot);
    expect(screen.getByTestId('unaddressed-findings-empty')).toHaveTextContent(
      'No accepted critical/high findings to cover.',
    );
    second.unmount();

    // (c) Legacy draft (no snapshot) → panel AND summary line hidden;
    // legacy LLM-asserted keys never render.
    const legacy = makeDraft({
      generationSummary: { findingsAddressed: 5, findingsNotAddressed: 2 },
    });
    renderWorkspace(legacy);
    expect(
      screen.queryByTestId('unaddressed-findings-panel'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('review-coverage-summary'),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// 5 — Progress summary computed values
// ============================================================================

describe('DraftSummary — computed findings coverage (4.4)', () => {
  it('renders computed addressed/unaddressed values (ignoring legacy LLM-asserted keys) and hides both lines for snapshot-less drafts', () => {
    // Legacy keys deliberately contradict the computed values: the
    // computed 1 / 2 must win (the broken safeNumber reads are gone).
    const draft = makeDraft({
      generationSummary: {
        findingsCoverage: SNAPSHOT,
        findingsAddressed: 99,
        findingsNotAddressed: 99,
      },
    });
    const first = render(
      <DraftSummary
        draft={draft as unknown as PlanDraft}
        onOpenHierarchy={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId('mdp-summary-findings-addressed'),
    ).toHaveTextContent('Findings addressed: 1');
    expect(
      screen.getByTestId('mdp-summary-findings-unaddressed'),
    ).toHaveTextContent('Findings unaddressed: 2');
    first.unmount();

    // Snapshot-less draft: BOTH lines disappear (no more always-0).
    const legacy = makeDraft({
      generationSummary: { findingsAddressed: 5, findingsNotAddressed: 2 },
    });
    render(
      <DraftSummary
        draft={legacy as unknown as PlanDraft}
        onOpenHierarchy={vi.fn()}
      />,
    );
    expect(
      screen.queryByTestId('mdp-summary-findings-addressed'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('mdp-summary-findings-unaddressed'),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// 6 — Draft list computed counts
// ============================================================================

describe('MigrationBookOfWorkDraftListView — computed coverage chips (4.4)', () => {
  it('shows computed counts on snapshot-bearing rows and nothing on legacy rows', async () => {
    const snapshotDraft = makeDraft({ id: 'd-snap' });
    const legacyDraft = makeDraft({
      id: 'd-legacy',
      generationSummary: { findingsAddressed: 5, findingsNotAddressed: 2 },
    });
    mockListMigrationBookOfWorks.mockResolvedValue([snapshotDraft, legacyDraft]);

    render(
      <MigrationBookOfWorkDraftListView
        projectId={PROJECT_ID}
        onOpenDraft={vi.fn()}
      />,
    );

    const chip = await screen.findByTestId('draft-findings-coverage-d-snap');
    expect(chip).toHaveTextContent('1/3 findings');
    expect(
      screen.queryByTestId('draft-findings-coverage-d-legacy'),
    ).not.toBeInTheDocument();
  });
});
