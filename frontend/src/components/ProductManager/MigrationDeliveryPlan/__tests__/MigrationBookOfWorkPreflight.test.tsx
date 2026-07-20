/**
 * Spec preflight consumption on the plan screen (Phase 0, 2026-07-20).
 *
 * Pins the ONE-readiness-function contract on the UI:
 *   1. On load the workspace runs the preflight; story chips render the LIVE
 *      verdict (ready ✓ / blocked (n)) instead of the baked readiness.
 *   2. The drawer shows the "Readiness check (live)" section with the
 *      generator-vocabulary missing inputs.
 *   3. "Re-check readiness" re-runs the preflight on demand.
 *   4. Preflight failure fail-softs: chips fall back to the baked readiness.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy({}, { get: (_t, p) => String(p) }),
}));

const mockRunSpecPreflight = vi.fn();
vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    runSpecPreflight: (...args: unknown[]) => mockRunSpecPreflight(...args),
  };
});
vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return { ...actual, listDbMigrationPacks: vi.fn().mockResolvedValue([]) };
});

import MigrationBookOfWorkReviewWorkspace from '../MigrationBookOfWorkReviewWorkspace';
import type {
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkItem,
} from '../../../../api/migrationBookOfWorkApi';

const PROJECT_ID = 'proj-pf';
const BOOK_ID = 'book-pf';

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

function makeDraft(): MigrationBookOfWorkDraft {
  return {
    id: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-cur',
    targetArchitectureId: 'arch-tgt',
    status: 'draft',
    title: 'Preflight test plan',
    summary: 'Summary',
    generationInputs: null,
    generationSummary: null,
    qualityAssessment: null,
    bookOfWork: {
      items: [
        makeItem({ id: 's-ready', title: 'Ready story', workItemId: 'wi-r' } as never),
        makeItem({ id: 's-blocked', title: 'Blocked story', workItemId: 'wi-b' } as never),
      ],
    },
    createdByTask: 'product-manager--migration-delivery-plan',
    savedToBacklogAt: null,
    errorMessage: null,
    createdAt: '2026-07-20T10:00:00Z',
    updatedAt: '2026-07-20T10:00:00Z',
  };
}

function preflightRows() {
  return [
    {
      bookItemId: 's-ready',
      workItemId: 'wi-r',
      title: 'Ready story',
      route: 'db_pack' as const,
      ready: true,
      missingInputs: [],
      note: null,
    },
    {
      bookItemId: 's-blocked',
      workItemId: 'wi-b',
      title: 'Blocked story',
      route: 'resolver' as const,
      ready: false,
      missingInputs: [
        { kind: 'mapping', reason: 'No current->target data mapping for this story' },
        { kind: 'baseline', reason: 'No API behaviour baseline' },
      ],
      note: null,
    },
  ];
}

function renderWorkspace() {
  return render(
    <MemoryRouter>
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        initialDraft={makeDraft()}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockRunSpecPreflight.mockReset();
});

describe('plan screen — preflight readiness (the one readiness function)', () => {
  it('chips render the LIVE preflight verdict (ready ✓ / blocked (n)), overriding the baked readiness', async () => {
    mockRunSpecPreflight.mockResolvedValue(preflightRows());
    renderWorkspace();

    await waitFor(() =>
      expect(screen.getByTestId('badge-readiness-s-ready')).toHaveTextContent(
        'ready ✓',
      ),
    );
    // Baked value said ready_for_spec — the live check says blocked (2).
    expect(screen.getByTestId('badge-readiness-s-blocked')).toHaveTextContent(
      'blocked (2)',
    );
    expect(mockRunSpecPreflight).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID);
  });

  it('drawer shows the "Readiness check (live)" section with generator-vocabulary missing inputs', async () => {
    mockRunSpecPreflight.mockResolvedValue(preflightRows());
    renderWorkspace();
    await waitFor(() =>
      expect(screen.getByTestId('badge-readiness-s-blocked')).toHaveTextContent(
        'blocked (2)',
      ),
    );

    fireEvent.click(screen.getByText('Blocked story'));
    const section = await screen.findByTestId('item-drawer-preflight');
    expect(
      within(section).getByTestId('item-drawer-preflight-blocked'),
    ).toHaveTextContent(/2 missing inputs/);
    expect(section).toHaveTextContent(
      'No current->target data mapping for this story',
    );
    expect(section).toHaveTextContent('No API behaviour baseline');
  });

  it('"Re-check readiness" re-runs the preflight on demand', async () => {
    mockRunSpecPreflight.mockResolvedValue(preflightRows());
    renderWorkspace();
    await waitFor(() => expect(mockRunSpecPreflight).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId('recheck-readiness-button'));
    await waitFor(() => expect(mockRunSpecPreflight).toHaveBeenCalledTimes(2));
  });

  it('FAIL-SOFT: preflight failure leaves the baked readiness chips in place', async () => {
    mockRunSpecPreflight.mockRejectedValue(new Error('gateway down'));
    renderWorkspace();
    await waitFor(() => expect(mockRunSpecPreflight).toHaveBeenCalled());

    // Chips fall back to the baked expansion-time value.
    expect(screen.getByTestId('badge-readiness-s-ready')).toHaveTextContent(
      'ready_for_spec',
    );
    expect(screen.getByTestId('badge-readiness-s-blocked')).toHaveTextContent(
      'ready_for_spec',
    );
  });
});
