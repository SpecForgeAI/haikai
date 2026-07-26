/**
 * Phase 1b — tier-flexible execution rail (2026-07-20).
 *
 * Pins:
 *   1. Plane derivation is tier-flexible: cards derive from the plan's
 *      stories (a DB-only plan renders ONE card; planes never hardcoded).
 *   2. The ABSOLUTE spec gate: Start disabled while any story lacks a
 *      satisfied spec; blocker click-through selects the story in the tree.
 *   3. Start / pause-approve / break-glass wiring to the migrate machinery.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy({}, { get: (_t, p) => String(p) }),
}));

const mockRunSpecPreflight = vi.fn();
const mockFetchRows = vi.fn();
vi.mock('../../../../api/specGenerationApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/specGenerationApi')
  >('../../../../api/specGenerationApi');
  return {
    ...actual,
    runSpecPreflight: (...a: unknown[]) => mockRunSpecPreflight(...a),
    fetchSpecGenerationsForBook: (...a: unknown[]) => mockFetchRows(...a),
  };
});
const mockTriggerMigrate = vi.fn();
const mockGetRun = vi.fn();
const mockResume = vi.fn();
const mockCredsStatus = vi.fn();
const mockRegisterTargetDb = vi.fn();
vi.mock('../../../../api/migrationDeliveryDashboardApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryDashboardApi')
  >('../../../../api/migrationDeliveryDashboardApi');
  return {
    ...actual,
    triggerMigrate: (...a: unknown[]) => mockTriggerMigrate(...a),
    getLatestMigrationExecutionRun: (...a: unknown[]) => mockGetRun(...a),
    resumeMigrationRun: (...a: unknown[]) => mockResume(...a),
    fetchMigrationCredentialsStatus: (...a: unknown[]) => mockCredsStatus(...a),
    registerRunTargetDbCredentials: (...a: unknown[]) =>
      mockRegisterTargetDb(...a),
  };
});
vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return { ...actual, listDbMigrationPacks: vi.fn().mockResolvedValue([]) };
});

import MigrationBookOfWorkReviewWorkspace from '../MigrationBookOfWorkReviewWorkspace';
import { planeForStory } from '../MigrationExecutionRail';
import type {
  MigrationBookOfWorkDraft,
  MigrationBookOfWorkItem,
} from '../../../../api/migrationBookOfWorkApi';

const PROJECT_ID = 'proj-rail';
const BOOK_ID = 'book-rail';

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
    workstream: 'target_database_schema_implementation',
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

function draftWith(items: MigrationBookOfWorkItem[]): MigrationBookOfWorkDraft {
  return {
    id: BOOK_ID,
    projectId: PROJECT_ID,
    currentArchitectureId: 'arch-cur',
    targetArchitectureId: 'arch-tgt',
    status: 'draft',
    title: 'Rail plan',
    summary: 'Summary',
    generationInputs: null,
    generationSummary: null,
    qualityAssessment: null,
    bookOfWork: { items },
    createdByTask: 'product-manager--migration-delivery-plan',
    savedToBacklogAt: null,
    errorMessage: null,
    createdAt: '2026-07-20T10:00:00Z',
    updatedAt: '2026-07-20T10:00:00Z',
  };
}

function generatedRow(workItemId: string, bookItemId: string) {
  return {
    id: `sg-${workItemId}`,
    projectId: PROJECT_ID,
    workItemId,
    bookOfWorkId: BOOK_ID,
    bookItemId,
    status: 'generated',
    confidence: 'high',
    predictedReadiness: 'ready_for_spec',
    generatedSpecText: 'spec',
    warnings: [],
    missingInputs: [],
    focusedContextRefs: null,
    evidenceRefs: [],
    generatedAt: null,
    errorMessage: null,
    generationAttemptNumber: 1,
    createdByTask: null,
    createdAt: null,
    updatedAt: null,
    manuallyEdited: null,
    lastManuallyEditedAt: null,
    lastManuallyEditedBy: null,
    previousSpecText: null,
    structuredTestsJson: null,
    coveredEndpointIds: null,
    manualReady: false,
    manualReadyBy: null,
  };
}

function renderWorkspace(draft: MigrationBookOfWorkDraft) {
  return render(
    <MemoryRouter>
      <MigrationBookOfWorkReviewWorkspace
        projectId={PROJECT_ID}
        bookId={BOOK_ID}
        initialDraft={draft}
        companyName="acme"
        projectName="hifi"
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockRunSpecPreflight.mockReset().mockResolvedValue([]);
  mockFetchRows.mockReset().mockResolvedValue([]);
  mockTriggerMigrate
    .mockReset()
    .mockResolvedValue({ status: 'started', runId: 'run-1', itemCount: 2 });
  mockGetRun.mockReset().mockResolvedValue(null);
  mockResume.mockReset().mockResolvedValue({ status: 'resumed', nextPlane: 'service' });
  mockCredsStatus.mockReset().mockResolvedValue({
    targetBinding: {
      engine: 'postgresql',
      host: 'localhost',
      port: 5432,
      database: 'haikai_target',
      schema: 'public',
      username: 'postgres',
    },
    source: { registered: true, host: 'sh', port: 5000, database: 'sd' },
    targetRegistered: false,
  });
  mockRegisterTargetDb.mockReset().mockResolvedValue(undefined);
});

describe('planeForStory — the display mirror of the gateway plane vocabulary', () => {
  it('maps workstreams (and the stream: tag fallback) to db/service/ui', () => {
    expect(planeForStory({ workstream: 'target_database_schema_implementation' })).toBe('db');
    expect(planeForStory({ workstream: 'data_migration' })).toBe('db');
    expect(planeForStory({ workstream: 'api_migration' })).toBe('service');
    expect(planeForStory({ workstream: 'target_frontend_implementation' })).toBe('ui');
    expect(planeForStory({ workstream: 'cutover_rollback_decommission' })).toBe('ui');
    expect(planeForStory({ workstream: null, tags: ['stream:data_migration'] })).toBe('db');
    expect(planeForStory({ workstream: null })).toBe('service');
  });
});

describe('execution rail (Phase 1b)', () => {
  it('TIER-FLEXIBLE: a DB-only plan renders exactly ONE card', async () => {
    mockFetchRows.mockResolvedValue([generatedRow('wi-1', 's-1')]);
    renderWorkspace(
      draftWith([makeItem({ id: 's-1', title: 'Schema story', workItemId: 'wi-1' } as never)]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('execution-rail-card-db')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('execution-rail-card-service')).toBeNull();
    expect(screen.queryByTestId('execution-rail-card-ui')).toBeNull();
  });

  it('ABSOLUTE gate: Start disabled while a story lacks a spec; blocker click selects it; satisfied gate enables Start', async () => {
    // Two DB stories: one satisfied, one without a spec row.
    mockFetchRows.mockResolvedValue([generatedRow('wi-ok', 's-ok')]);
    renderWorkspace(
      draftWith([
        makeItem({ id: 's-ok', title: 'Specced story', workItemId: 'wi-ok' } as never),
        makeItem({ id: 's-no', title: 'Unspecced story', workItemId: 'wi-no' } as never),
      ]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('execution-rail-gate-db')).toHaveTextContent('specs 1/2'),
    );
    expect(screen.getByTestId('execution-rail-start')).toBeDisabled();

    // Blocker click-through selects the story (drawer opens on it).
    fireEvent.click(screen.getByTestId('execution-rail-blocker-s-no'));
    expect(await screen.findByTestId('item-drawer-s-no')).toBeInTheDocument();
  });

  it('Start opens the binding-prefilled dialog; confirm triggers the run AND registers target creds against the new runId', async () => {
    mockFetchRows.mockResolvedValue([generatedRow('wi-1', 's-1')]);
    renderWorkspace(
      draftWith([makeItem({ id: 's-1', title: 'Schema story', workItemId: 'wi-1' } as never)]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('execution-rail-start')).toBeEnabled(),
    );
    fireEvent.click(screen.getByTestId('execution-rail-start'));

    // The dialog prefills the plan-DECLARED binding — the operator confirms
    // coordinates and supplies only the secret.
    const dialog = await screen.findByTestId('start-stage-dialog');
    expect(
      (within(dialog).getByTestId('start-stage-database') as HTMLInputElement)
        .value,
    ).toBe('haikai_target');
    expect(
      (within(dialog).getByTestId('start-stage-host') as HTMLInputElement)
        .value,
    ).toBe('localhost');
    expect(dialog).toHaveTextContent(/Source DB:\s*registered ✓/);

    fireEvent.change(within(dialog).getByTestId('start-stage-password'), {
      target: { value: 's3cret' },
    });
    fireEvent.click(within(dialog).getByTestId('start-stage-confirm'));

    await waitFor(() =>
      // Per-plane runs (2026-07-26): the DB card's Start scopes the run to
      // the db plane — "Start stage 1" starts stage 1 ONLY.
      expect(mockTriggerMigrate).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
        company: 'acme',
        project: 'hifi',
        plane: 'db',
        parityOverride: false,
      }),
    );
    await waitFor(() =>
      expect(mockRegisterTargetDb).toHaveBeenCalledWith(PROJECT_ID, 'run-1', {
        host: 'localhost',
        port: 5432,
        database: 'haikai_target',
        schema: 'public',
        username: 'postgres',
        password: 's3cret',
      }),
    );
  });

  it('PER-PLANE starts (2026-07-26): stage 2 is locked until the latest run is deployed, then gets its OWN Start scoped to its plane', async () => {
    const twoPlane = [
      makeItem({ id: 's-db', title: 'Schema', workItemId: 'wi-db' } as never),
      makeItem({
        id: 's-svc',
        title: 'API',
        workItemId: 'wi-svc',
        workstream: 'api_migration',
      } as never),
    ];
    mockFetchRows.mockResolvedValue([
      generatedRow('wi-db', 's-db'),
      generatedRow('wi-svc', 's-svc'),
    ]);

    // No run yet -> stage 2 locked, stage 1 startable.
    const first = renderWorkspace(draftWith(twoPlane));
    await waitFor(() =>
      expect(screen.getByTestId('execution-rail-start')).toBeEnabled(),
    );
    expect(screen.getByTestId('execution-rail-locked-service')).toHaveTextContent(
      'starts after stage 1 completes',
    );
    expect(screen.queryByTestId('execution-rail-start-service')).toBeNull();
    first.unmount();

    // Latest run deployed (stage 1 done) -> stage 2 has its own Start.
    mockGetRun.mockResolvedValue({
      id: 'run-db',
      status: 'deployed',
      items: [{ work_item_id: 'wi-db', status: 'deployed' }],
    });
    renderWorkspace(draftWith(twoPlane));
    const stage2 = await screen.findByTestId('execution-rail-start-service');
    expect(stage2).toBeEnabled();
    fireEvent.click(stage2);
    const dialog = await screen.findByTestId('start-stage-dialog');
    expect(dialog).toHaveTextContent('Start stage 2');
    fireEvent.click(within(dialog).getByTestId('start-stage-confirm'));
    await waitFor(() =>
      expect(mockTriggerMigrate).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
        company: 'acme',
        project: 'hifi',
        plane: 'service',
        parityOverride: false,
      }),
    );
  });

  it('a parity-only refusal of a stage-2 start surfaces the recorded break-glass in the dialog', async () => {
    const twoPlane = [
      makeItem({ id: 's-db', title: 'Schema', workItemId: 'wi-db' } as never),
      makeItem({
        id: 's-svc',
        title: 'API',
        workItemId: 'wi-svc',
        workstream: 'api_migration',
      } as never),
    ];
    mockFetchRows.mockResolvedValue([
      generatedRow('wi-db', 's-db'),
      generatedRow('wi-svc', 's-svc'),
    ]);
    mockGetRun.mockResolvedValue({ id: 'run-db', status: 'deployed', items: [] });
    mockTriggerMigrate.mockResolvedValueOnce({
      status: 'blocked',
      reasons: [
        { code: 'data_parity_unverified', message: 'no parity report exists yet' },
      ],
    });
    renderWorkspace(draftWith(twoPlane));

    fireEvent.click(await screen.findByTestId('execution-rail-start-service'));
    const dialog = await screen.findByTestId('start-stage-dialog');
    fireEvent.click(within(dialog).getByTestId('start-stage-confirm'));

    const breakGlass = await screen.findByTestId('start-stage-break-glass');
    mockTriggerMigrate.mockResolvedValueOnce({
      status: 'started',
      runId: 'run-svc',
      itemCount: 1,
    });
    fireEvent.click(breakGlass);
    await waitFor(() =>
      expect(mockTriggerMigrate).toHaveBeenLastCalledWith(PROJECT_ID, BOOK_ID, {
        company: 'acme',
        project: 'hifi',
        plane: 'service',
        parityOverride: true,
      }),
    );
  });

  it('awaiting_approval: Approve resumes; a blocked resume surfaces break-glass which resumes with override', async () => {
    mockFetchRows.mockResolvedValue([generatedRow('wi-1', 's-1')]);
    mockGetRun.mockResolvedValue({
      id: 'run-1',
      status: 'awaiting_approval',
      items: [{ work_item_id: 'wi-1', status: 'deployed' }],
    });
    mockResume.mockResolvedValueOnce({
      status: 'blocked',
      reasons: [{ reason: 'dbo.orders row counts diverge' }],
    });
    renderWorkspace(
      draftWith([makeItem({ id: 's-1', title: 'Schema story', workItemId: 'wi-1' } as never)]),
    );

    fireEvent.click(await screen.findByTestId('execution-rail-approve'));
    // Blocked → break-glass panel with the parity reasons.
    const panel = await screen.findByTestId('execution-rail-break-glass');
    expect(panel).toHaveTextContent('dbo.orders row counts diverge');
    expect(mockResume).toHaveBeenCalledWith(PROJECT_ID, 'run-1', {
      company: 'acme',
      project: 'hifi',
    });

    mockResume.mockResolvedValueOnce({ status: 'resumed', nextPlane: 'service' });
    fireEvent.click(
      within(panel).getByTestId('execution-rail-break-glass-button'),
    );
    await waitFor(() =>
      expect(mockResume).toHaveBeenLastCalledWith(PROJECT_ID, 'run-1', {
        company: 'acme',
        project: 'hifi',
        override: true,
      }),
    );
  });
});
