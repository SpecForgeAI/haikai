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

// Carry-over accounting panel (2026-07-26): the workspace now mounts the
// server-driven coverage read — mocked per-test.
const mockGetCarryOverCoverage = vi.fn();
vi.mock('../../../../api/carryOverCoverageApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/carryOverCoverageApi')
  >('../../../../api/carryOverCoverageApi');
  return {
    ...actual,
    getCarryOverCoverage: (...args: unknown[]) =>
      mockGetCarryOverCoverage(...args),
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
// 3 + 4 — Review workspace carry-over accounting panel (2026-07-26: the old
// "advisory, doesn't block saving" findings banner is GONE — the server gate
// refused Stage-2 starts on the same items, and the banner said otherwise)
// ============================================================================

describe('MigrationBookOfWorkReviewWorkspace — carry-over accounting panel', () => {
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

  it('REPLACES the advisory banner: no doublespeak panel, and the accounting panel states the Stage-2 gate with item content', async () => {
    mockGetCarryOverCoverage.mockResolvedValue({
      items: [],
      mustAccount: [
        { kind: 'finding', id: 'f-2', status: 'un-actioned', behaviourBearing: true, label: 'f-2' },
        { kind: 'capability', id: 'cap-1', status: 'un-actioned', behaviourBearing: true, label: 'cap-1' },
      ],
      unaccounted: [
        { kind: 'finding', id: 'f-2', status: 'un-actioned', behaviourBearing: true, label: 'f-2' },
        { kind: 'capability', id: 'cap-1', status: 'un-actioned', behaviourBearing: true, label: 'cap-1' },
      ],
      accountedCount: 0,
      totalMustAccount: 2,
      ok: false,
      architectureId: CURRENT_ARCH_ID,
      itemDetails: {
        'f-2': {
          kind: 'finding',
          title: 'Trigger cascade on customer delete',
          summary: 'Deleting a customer cascades through triggers.',
          severity: 'high',
          category: 'operational_artifact',
          runId: 'run-1',
          reviewStatus: 'approved',
          memberFindingCount: null,
        },
        'cap-1': {
          kind: 'capability',
          title: 'Nightly batch spine',
          summary: 'The overnight close chain.',
          severity: null,
          category: 'batch',
          runId: 'run-1',
          reviewStatus: 'approved',
          memberFindingCount: 2,
        },
      },
    });

    renderWorkspace(makeDraft());

    // The header chip's create-time findings metric is unchanged.
    expect(screen.getByTestId('review-coverage-summary')).toHaveTextContent(
      'Findings addressed: 1 / 3',
    );

    // The doublespeak advisory panel is GONE — no "doesn't block saving".
    expect(
      screen.queryByTestId('unaddressed-findings-panel'),
    ).not.toBeInTheDocument();

    // The accounting panel states the SERVER gate's truth.
    const blocking = await screen.findByTestId('carry-over-accounting-blocking');
    expect(blocking).toHaveTextContent(
      '2 carry-over items need citing or dismissing before Stage 2 (Service) can start.',
    );
    expect(blocking).toHaveTextContent('0 of 2 accounted');

    // Expanding lists the items WITH CONTENT + the accounting actions.
    fireEvent.click(screen.getByTestId('carry-over-accounting-toggle'));
    const findingRow = screen.getByTestId('carry-over-item-row-f-2');
    expect(findingRow).toHaveTextContent('Trigger cascade on customer delete');
    expect(findingRow).toHaveTextContent('high');
    expect(
      within(findingRow).getByTestId('carry-over-cite-f-2'),
    ).toBeInTheDocument();
    expect(
      within(findingRow).getByTestId('carry-over-amend-f-2'),
    ).toBeInTheDocument();
    expect(
      within(findingRow).getByTestId('carry-over-new-story-f-2'),
    ).toBeInTheDocument();
    expect(
      within(findingRow).getByTestId('carry-over-dismiss-f-2'),
    ).toBeInTheDocument();

    // A capability offers New story + Dismiss but NOT cite/amend (its
    // citation is the source_capability_id story mint, not a finding ref).
    const capRow = screen.getByTestId('carry-over-item-row-cap-1');
    expect(capRow).toHaveTextContent('Nightly batch spine');
    expect(capRow).toHaveTextContent('absorbs 2 findings');
    expect(
      within(capRow).queryByTestId('carry-over-cite-cap-1'),
    ).not.toBeInTheDocument();
    expect(
      within(capRow).queryByTestId('carry-over-amend-cap-1'),
    ).not.toBeInTheDocument();
    expect(
      within(capRow).getByTestId('carry-over-new-story-cap-1'),
    ).toBeInTheDocument();
    expect(
      within(capRow).getByTestId('carry-over-dismiss-cap-1'),
    ).toBeInTheDocument();
  });

  it('shows the all-accounted clear state and renders even for legacy snapshot-less drafts (server-driven, not snapshot-driven)', async () => {
    mockGetCarryOverCoverage.mockResolvedValue({
      items: [],
      mustAccount: [
        { kind: 'capability', id: 'cap-1', status: 'cited-by-story', behaviourBearing: true, label: 'cap-1' },
      ],
      unaccounted: [],
      accountedCount: 1,
      totalMustAccount: 1,
      ok: true,
      architectureId: CURRENT_ARCH_ID,
      itemDetails: {},
    });

    // Legacy draft (no create-time snapshot): the header chip hides, but the
    // accounting panel STILL renders — the gate is server-computed.
    const legacy = makeDraft({
      generationSummary: { findingsAddressed: 5, findingsNotAddressed: 2 },
    });
    renderWorkspace(legacy);
    expect(
      screen.queryByTestId('review-coverage-summary'),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByTestId('carry-over-accounting-clear'),
    ).toHaveTextContent(
      'All 1 behaviour-bearing carry-over items are accounted for',
    );
    expect(
      screen.queryByTestId('unaddressed-findings-panel'),
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
