/**
 * Dashboard findings-coverage tests (Spec 2026-06-11 Deterministic
 * Findings-Coverage Verification + Gap Wayfinding — Task Group 4.1/4.5).
 *
 * Coverage:
 *   1. `MigrationDeliverySummaryCards` Evidence coverage card gains the
 *      computed "Findings addressed: A / T" line when coverage is supplied,
 *      and omits it entirely when it is not (D8 — hide, don't approximate;
 *      the broken LLM-asserted numbers never render).
 *   2. `MigrationDeliveryDashboard` fetches the draft via the
 *      `fetchBookOfWorkDraft` seam and passes computed coverage to the
 *      cards; a draft fetch FAILURE degrades to the reference-count-only
 *      card without blocking the dashboard load.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';

// Mock the CSS module so class-name access does not blow up under jsdom.
vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import MigrationDeliverySummaryCards from '../MigrationDeliverySummaryCards';
import { MigrationDeliveryDashboard } from '../MigrationDeliveryDashboard';
import type {
  MigrationDeliveryDashboardDto,
  MigrationDeliverySummaryDto,
  MigrationDeliverySpecGenerationSummaryDto,
  MigrationDeliveryBacklogSaveSummaryDto,
  MigrationDeliveryImplementationSummaryDto,
  MigrationDeliveryEvidenceSummaryDto,
} from '../../../../api/migrationDeliveryDashboardApi';
import type { MigrationBookOfWorkDraft } from '../../../../api/migrationBookOfWorkApi';
import type { FindingsCoverageResult } from '../../../../utils/findingsCoverage';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Fixtures
// ============================================================================

const PROJECT_ID = 'proj-fc';
const BOOK_ID = 'book-fc';

const SUMMARY: MigrationDeliverySummaryDto = {
  totalInitiativeCount: 1,
  totalEpicCount: 2,
  totalFeatureCount: 3,
  totalStoryCount: 10,
  needsAttentionCount: 4,
};

const SPEC_GEN: MigrationDeliverySpecGenerationSummaryDto = {
  notAttemptedCount: 1,
  generatedCount: 5,
  generatedWithWarningsCount: 2,
  insufficientContextCount: 1,
  failedCount: 1,
  skippedBlockedCount: 0,
};

const BACKLOG: MigrationDeliveryBacklogSaveSummaryDto = {
  savedCount: 8,
  notSavedToBacklogCount: 2,
};

const IMPLEMENTATION: MigrationDeliveryImplementationSummaryDto = {
  notStartedCount: 4,
  inProgressCount: 3,
  blockedCount: 1,
  completedCount: 2,
  activeCount: 5,
};

const EVIDENCE: MigrationDeliveryEvidenceSummaryDto = {
  evidenceReferenceCount: 7,
  discoveryFindingReferenceCount: 3,
  apiBaselineReferenceCount: 2,
  mappingReferenceCount: 4,
  architectureReferenceCount: 1,
  anyCoverageCount: 6,
};

const COVERAGE: FindingsCoverageResult = {
  total: 4,
  addressedCount: 3,
  notAddressedCount: 1,
  unaddressed: [
    { id: 'f-9', title: 'Trigger drift', severity: 'high', runId: 'run-9' },
  ],
};

function buildDashboardFixture(): MigrationDeliveryDashboardDto {
  return {
    bookOfWorkId: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    title: 'Migration Book of Work',
    status: 'generated',
    generatedAt: '2026-06-11T00:00:00Z',
    summary: SUMMARY,
    hierarchy: [],
    workstreamSummaries: [],
    specGenerationSummary: SPEC_GEN,
    backlogSaveSummary: BACKLOG,
    implementationSummary: IMPLEMENTATION,
    evidenceSummary: EVIDENCE,
    needsAttention: [],
    warnings: [],
  };
}

function buildDraftFixture(): MigrationBookOfWorkDraft {
  return {
    id: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-current',
    targetArchitectureId: 'arch-target',
    status: 'draft',
    title: 'Coverage plan',
    summary: 'Summary',
    generationInputs: null,
    generationSummary: {
      findingsCoverage: {
        findings: [
          { id: 'f-1', title: 'Proc usage', severity: 'critical', runId: 'r-1' },
          { id: 'f-2', title: 'Trigger drift', severity: 'high', runId: 'r-1' },
          { id: 'f-3', title: 'View SQL', severity: 'high', runId: 'r-2' },
        ],
      },
    },
    qualityAssessment: null,
    bookOfWork: {
      items: [
        {
          id: 's-1',
          type: 'story',
          parentId: null,
          title: 'Story',
          description: '',
          acceptanceCriteria: [],
          workstream: 'other',
          sequenceOrder: 0,
          tags: [],
          confidence: 'high',
          readiness: 'ready_for_spec',
          readinessReasons: [],
          missingInputs: [],
          recommendedNextAction: '',
          traceabilitySummary: '',
          evidenceReferences: [],
          architectureReferences: [],
          apiBaselineReferences: [],
          discoveryFindingReferences: ['F-1'],
          mappingReferences: [],
          sourceContextRefs: [],
        },
      ],
    },
    createdByTask: 'product-manager--migration-delivery-plan',
    savedToBacklogAt: null,
    errorMessage: null,
    createdAt: '2026-06-11T00:00:00Z',
    updatedAt: '2026-06-11T00:00:00Z',
  };
}

function renderDashboard(fetchBookOfWorkDraft: ReturnType<typeof vi.fn>) {
  return render(
    <MigrationDeliveryDashboard
      projectId={PROJECT_ID}
      bookId={BOOK_ID}
      fetchDashboard={vi.fn().mockResolvedValue(buildDashboardFixture()) as never}
      fetchStaleSpecSummary={
        vi.fn().mockResolvedValue({ staleCount: 0, staleWorkItemIds: [] }) as never
      }
      fetchReadyToRetry={
        vi
          .fn()
          .mockResolvedValue({ count: 0, specGenerationIds: [], specs: [] }) as never
      }
      fetchBookOfWorkDraft={fetchBookOfWorkDraft as never}
    />,
  );
}

// ============================================================================
// 1 — Cards-level rendering
// ============================================================================

describe('MigrationDeliverySummaryCards — computed findings coverage line (4.5)', () => {
  it('renders "Findings addressed: A / T" on the Evidence coverage card when coverage is supplied, and omits the line without it', () => {
    const first = render(
      <MigrationDeliverySummaryCards
        summary={SUMMARY}
        specGenerationSummary={SPEC_GEN}
        backlogSaveSummary={BACKLOG}
        implementationSummary={IMPLEMENTATION}
        evidenceSummary={EVIDENCE}
        findingsCoverage={COVERAGE}
      />,
    );
    const evidenceCard = screen.getByTestId('mdd-summary-card-evidence');
    expect(
      within(evidenceCard).getByTestId(
        'mdd-summary-card-evidence-findings-addressed',
      ),
    ).toHaveTextContent('Findings addressed: 3 / 4');
    // The existing reference-count line is untouched.
    expect(evidenceCard).toHaveTextContent(/Findings:\s*3/);
    first.unmount();

    // No coverage (legacy draft / fetch failure) → line omitted entirely.
    render(
      <MigrationDeliverySummaryCards
        summary={SUMMARY}
        specGenerationSummary={SPEC_GEN}
        backlogSaveSummary={BACKLOG}
        implementationSummary={IMPLEMENTATION}
        evidenceSummary={EVIDENCE}
      />,
    );
    expect(
      screen.queryByTestId('mdd-summary-card-evidence-findings-addressed'),
    ).not.toBeInTheDocument();
  });
});

// ============================================================================
// 2 — Dashboard-level fetch + graceful degradation
// ============================================================================

describe('MigrationDeliveryDashboard — draft fetch for coverage (4.5)', () => {
  it('computes coverage from the fetched draft and degrades to the reference-count-only card when the draft fetch fails', async () => {
    // (a) Successful draft fetch → computed line appears (1 of 3 addressed).
    const fetchOk = vi.fn().mockResolvedValue(buildDraftFixture());
    const first = renderDashboard(fetchOk);
    await waitFor(() => {
      expect(
        screen.getByTestId('mdd-summary-card-evidence-findings-addressed'),
      ).toHaveTextContent('Findings addressed: 1 / 3');
    });
    expect(fetchOk).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID);
    first.unmount();

    // (b) Draft fetch failure → dashboard still loads; Evidence card
    // renders WITHOUT the coverage line — never a wrong number, never a
    // blocked dashboard.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchFail = vi.fn().mockRejectedValue(new Error('AMS unavailable'));
    renderDashboard(fetchFail);
    await waitFor(() => {
      expect(screen.getByTestId('mdd-summary-card-evidence')).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(fetchFail).toHaveBeenCalled();
    });
    expect(
      screen.queryByTestId('mdd-summary-card-evidence-findings-addressed'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('mdd-dashboard-error')).not.toBeInTheDocument();
    warnSpy.mockRestore();
  });
});
