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
const mockHaltRun = vi.fn();
const mockCredsStatus = vi.fn();
const mockRegisterStageCreds = vi.fn();
const mockResumeFailed = vi.fn();
vi.mock('../../../../api/migrationDeliveryDashboardApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/migrationDeliveryDashboardApi')
  >('../../../../api/migrationDeliveryDashboardApi');
  return {
    ...actual,
    triggerMigrate: (...a: unknown[]) => mockTriggerMigrate(...a),
    getLatestMigrationExecutionRun: (...a: unknown[]) => mockGetRun(...a),
    resumeMigrationRun: (...a: unknown[]) => mockResume(...a),
    haltMigrationRun: (...a: unknown[]) => mockHaltRun(...a),
    fetchMigrationCredentialsStatus: (...a: unknown[]) => mockCredsStatus(...a),
    registerRunStageCredentials: (...a: unknown[]) =>
      mockRegisterStageCreds(...a),
    retryRunDbCompletion: (...a: unknown[]) => mockRetryDbCompletion(...a),
    resumeFailedMigrationRun: (...a: unknown[]) => mockResumeFailed(...a),
  };
});
const mockRetryDbCompletion = vi.fn();
vi.mock('../../../../api/dbMigrationPackApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/dbMigrationPackApi')
  >('../../../../api/dbMigrationPackApi');
  return { ...actual, listDbMigrationPacks: vi.fn().mockResolvedValue([]) };
});
// Carry-over accounting (2026-07-26): the workspace mounts the coverage read.
const mockGetCarryOverCoverage = vi.fn();
vi.mock('../../../../api/carryOverCoverageApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/carryOverCoverageApi')
  >('../../../../api/carryOverCoverageApi');
  return {
    ...actual,
    getCarryOverCoverage: (...a: unknown[]) => mockGetCarryOverCoverage(...a),
  };
});

/** A coverage read with the given accounted/total (blocking when short). */
function coverageOf(accounted: number, total: number) {
  const unaccounted = Array.from({ length: total - accounted }, (_v, i) => ({
    kind: 'finding' as const,
    id: `f-${i}`,
    status: 'un-actioned' as const,
    behaviourBearing: true,
    label: `f-${i}`,
  }));
  return {
    items: [],
    mustAccount: [],
    unaccounted,
    accountedCount: accounted,
    totalMustAccount: total,
    ok: accounted >= total,
    architectureId: 'arch-cur',
    itemDetails: {},
  };
}

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
        projectName="demo"
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockRunSpecPreflight.mockReset().mockResolvedValue({ rows: [], warnings: [] });
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
    serviceBinding: null,
    source: {
      registered: true,
      host: 'src-host',
      port: 5000,
      database: 'legacy',
      username: 'reader',
    },
    sourceApi: { registered: false },
    targetRegistered: false,
    targetServiceRegistered: false,
  });
  mockRegisterStageCreds.mockReset().mockResolvedValue(undefined);
  mockRetryDbCompletion.mockReset().mockResolvedValue({ status: 'retrying' });
  mockResumeFailed
    .mockReset()
    .mockResolvedValue({ resumed: true, itemsReset: 1 });
  // Benign default: nothing to account for (the carry-over gate stays clear).
  mockGetCarryOverCoverage.mockReset().mockResolvedValue(coverageOf(0, 0));
});

describe('planeForStory — the display mirror of the gateway plane vocabulary', () => {
  it('maps workstreams (and the stream: tag fallback) to db/service/ui', () => {
    expect(planeForStory({ workstream: 'target_database_schema_implementation' })).toBe('db');
    expect(planeForStory({ workstream: 'data_migration' })).toBe('db');
    expect(planeForStory({ workstream: 'target_infrastructure_environment_implementation' })).toBe('db');
    // 2026-07-27: the gateway's planeForWorkstream now carries this token too
    // (it was FE-only, so the same story sat on the DB card but ran/gated in
    // the service phase server-side). Both sides pin all four DB tokens.
    expect(planeForStory({ workstream: 'data_parity_reconciliation_reporting' })).toBe('db');
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
    // 2026-07-31: the old "Source DB: registered" note became a full
    // editable SOURCE DATABASE section, prefilled from the store.
    expect(
      (within(dialog).getByTestId('start-stage-source-host') as HTMLInputElement)
        .value,
    ).toBe('src-host');

    fireEvent.change(within(dialog).getByTestId('start-stage-password'), {
      target: { value: 's3cret' },
    });
    fireEvent.click(within(dialog).getByTestId('start-stage-confirm'));

    await waitFor(() =>
      // Per-plane runs (2026-07-26): the DB card's Start scopes the run to
      // the db plane — "Start stage 1" starts stage 1 ONLY.
      expect(mockTriggerMigrate).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
        company: 'acme',
        project: 'demo',
        plane: 'db',
        parityOverride: false,
        baseMode: 'chain', // run-branch chaining default (2026-08-06)
      }),
    );
    await waitFor(() =>
      expect(mockRegisterStageCreds).toHaveBeenCalledWith(PROJECT_ID, 'run-1', {
        targetDb: {
          dbType: 'postgres',
          host: 'localhost',
          port: 5432,
          database: 'haikai_target',
          schema: 'public',
          username: 'postgres',
          password: 's3cret',
        },
      }),
    );
  });

  it('halted run: "Retry DB build..." opens the stage-1 dialog in retry mode (2026-07-31)', async () => {
    // The live shape: 14 specs implemented + MRs opened, then the DB chain
    // halted at its inputs guard (source DB creds unregistered). Retry must
    // NOT force a full stage re-run.
    mockFetchRows.mockResolvedValue([generatedRow('wi-1', 's-1')]);
    mockGetRun.mockResolvedValue({
      id: 'run-halted',
      status: 'halted',
      items: [
        {
          work_item_id: 'wi-1', status: 'failed', outcome: 'failed',
          deploy_on_complete: true,
          error_detail:
            'DB execution chain failed at inputs: source DB credentials are not registered',
        },
      ],
    });
    renderWorkspace(
      draftWith([makeItem({ id: 's-1', title: 'Schema story', workItemId: 'wi-1' } as never)]),
    );

    const retryButton = await screen.findByTestId('execution-rail-retry-db-button');
    fireEvent.click(retryButton);

    // The stage-1 credentials dialog opens in retry mode: BOTH database
    // sections + the retry confirm label.
    const dialog = await screen.findByTestId('start-stage-dialog');
    expect(dialog).toHaveTextContent('Retry DB build');
    expect(within(dialog).getByTestId('start-stage-source-host')).toBeInTheDocument();
    expect(within(dialog).getByTestId('start-stage-host')).toBeInTheDocument();
    expect(within(dialog).getByTestId('start-stage-confirm')).toHaveTextContent(
      'Retry DB build',
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
        project: 'demo',
        plane: 'service',
        parityOverride: false,
        baseMode: 'chain', // run-branch chaining default (2026-08-06)
      }),
    );
  });

  it('run-branch chaining (2026-08-06): the stage-2 dialog offers "start from main"; ticking it sends baseMode=fresh, and stage 1 never shows the checkbox', async () => {
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
    mockGetRun.mockResolvedValue({
      id: 'run-db',
      status: 'deployed',
      items: [{ work_item_id: 'wi-db', status: 'deployed' }],
    });
    renderWorkspace(draftWith(twoPlane));

    // Stage 1's dialog has NO base-mode checkbox (there is no previous stage).
    fireEvent.click(await screen.findByTestId('execution-rail-start'));
    let dialog = await screen.findByTestId('start-stage-dialog');
    expect(within(dialog).queryByTestId('start-stage-base-mode')).toBeNull();
    fireEvent.click(within(dialog).getByTestId('start-stage-cancel'));

    // Stage 2's dialog HAS it; ticked -> the migrate POST carries 'fresh'.
    fireEvent.click(await screen.findByTestId('execution-rail-start-service'));
    dialog = await screen.findByTestId('start-stage-dialog');
    fireEvent.click(
      within(dialog).getByTestId('start-stage-base-mode-checkbox'),
    );
    fireEvent.click(within(dialog).getByTestId('start-stage-confirm'));
    await waitFor(() =>
      expect(mockTriggerMigrate).toHaveBeenCalledWith(PROJECT_ID, BOOK_ID, {
        company: 'acme',
        project: 'demo',
        plane: 'service',
        parityOverride: false,
        baseMode: 'fresh',
      }),
    );
  });

  it('CARRY-OVER gate (2026-07-26): the service card shows `carry-over accounted M/N` and its Start disables while items are un-accounted', async () => {
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
    // Stage 1 deployed, so stage 2 WOULD be startable — but 2 of 5 carry-over
    // items are still un-accounted, and the server refuses service starts on
    // that, so the button must not promise one.
    mockGetRun.mockResolvedValue({
      id: 'run-db',
      status: 'deployed',
      items: [{ work_item_id: 'wi-db', status: 'deployed' }],
    });
    mockGetCarryOverCoverage.mockResolvedValue(coverageOf(3, 5));

    renderWorkspace(draftWith(twoPlane));
    await waitFor(() =>
      expect(
        screen.getByTestId('execution-rail-carry-over-service'),
      ).toHaveTextContent('carry-over accounted 3/5'),
    );
    // The DB card never carries the line (the gate is service-only).
    expect(screen.queryByTestId('execution-rail-carry-over-db')).toBeNull();
    const stage2 = screen.getByTestId('execution-rail-start-service');
    expect(stage2).toBeDisabled();
    expect(stage2).toHaveAttribute(
      'title',
      expect.stringContaining('cited or dismissed'),
    );
  });

  it('CARRY-OVER gate: full accounting flips the line to ✓ and re-enables the service Start', async () => {
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
    mockGetRun.mockResolvedValue({
      id: 'run-db',
      status: 'deployed',
      items: [{ work_item_id: 'wi-db', status: 'deployed' }],
    });
    mockGetCarryOverCoverage.mockResolvedValue(coverageOf(5, 5));

    renderWorkspace(draftWith(twoPlane));
    await waitFor(() =>
      expect(
        screen.getByTestId('execution-rail-carry-over-service'),
      ).toHaveTextContent('carry-over accounted 5/5 ✓'),
    );
    expect(screen.getByTestId('execution-rail-start-service')).toBeEnabled();
  });

  it('STALE parity (2026-07-27): a row stale by REASON ONLY (no boolean) is not satisfied — the card matches the server gate', async () => {
    // The target-architecture mark-stale stamps `stale` without a reason and
    // the amend path stamps both — but a row can also arrive with only
    // stale_reason set. EITHER flag must count on BOTH surfaces.
    mockFetchRows.mockResolvedValue([
      { ...generatedRow('wi-1', 's-1'), staleReason: 'resolution_reset' },
    ]);
    renderWorkspace(
      draftWith([makeItem({ id: 's-1', title: 'Schema story', workItemId: 'wi-1' } as never)]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('execution-rail-gate-db')).toHaveTextContent('specs 0/1'),
    );
    expect(screen.getByTestId('execution-rail-start')).toBeDisabled();
  });

  it('LATEST-ROW parity (2026-07-27): the card judges the HIGHEST-attempt row, exactly like the server gate', async () => {
    // Attempt 2 failed AFTER attempt 1 generated — the server gates on the
    // latest attempt, so the card must too (the old "later list rows win"
    // shortcut depended on list order).
    mockFetchRows.mockResolvedValue([
      { ...generatedRow('wi-1', 's-1'), id: 'sg-2', status: 'failed', generationAttemptNumber: 2 },
      { ...generatedRow('wi-1', 's-1'), id: 'sg-1', status: 'generated', generationAttemptNumber: 1 },
    ]);
    renderWorkspace(
      draftWith([makeItem({ id: 's-1', title: 'Schema story', workItemId: 'wi-1' } as never)]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('execution-rail-gate-db')).toHaveTextContent('specs 0/1'),
    );
    expect(screen.getByTestId('execution-rail-start')).toBeDisabled();
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
        project: 'demo',
        plane: 'service',
        parityOverride: true,
        baseMode: 'chain', // run-branch chaining default (2026-08-06)
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
      project: 'demo',
    });

    mockResume.mockResolvedValueOnce({ status: 'resumed', nextPlane: 'service' });
    fireEvent.click(
      within(panel).getByTestId('execution-rail-break-glass-button'),
    );
    await waitFor(() =>
      expect(mockResume).toHaveBeenLastCalledWith(PROJECT_ID, 'run-1', {
        company: 'acme',
        project: 'demo',
        override: true,
      }),
    );
  });

  it('wedged run: the active-run status line offers "Halt run…" which halts + refreshes (2026-07-28)', async () => {
    // The live shape: the IVS job died pre-pipeline and no failure callback
    // ever arrived — the run sits 'dispatching' forever and every Start is
    // locked. The halt affordance is the operator's way out.
    mockFetchRows.mockResolvedValue([generatedRow('wi-1', 's-1')]);
    mockGetRun.mockResolvedValue({
      id: 'run-stuck',
      status: 'dispatching',
      items: [{ work_item_id: 'wi-1', status: 'submitted' }],
    });
    mockHaltRun.mockResolvedValue({ status: 'halted', itemsFailed: 1 });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderWorkspace(
        draftWith([makeItem({ id: 's-1', title: 'Schema story', workItemId: 'wi-1' } as never)]),
      );

      const statusLine = await screen.findByTestId('execution-rail-run-status');
      expect(statusLine).toHaveTextContent('run status: dispatching');
      // No Start while the run looks active.
      expect(screen.queryByTestId('execution-rail-start-db')).toBeNull();

      fireEvent.click(screen.getByTestId('execution-rail-halt-button'));
      await waitFor(() =>
        expect(mockHaltRun).toHaveBeenCalledWith(
          PROJECT_ID,
          'run-stuck',
          expect.any(String),
        ),
      );
      // The run was re-read so the rail can re-enable Start.
      await waitFor(() => expect(mockGetRun).toHaveBeenCalledTimes(2));
    } finally {
      confirmSpy.mockRestore();
    }
  });
});

describe('resume-from-failure (Robustness R2, 2026-08-05)', () => {
  /** Two DB stories, both spec-satisfied (the gate is not under test here). */
  const twoDbStories = () => [
    makeItem({ id: 's-1', title: 'Schema A', workItemId: 'wi-1' } as never),
    makeItem({ id: 's-2', title: 'Schema B', workItemId: 'wi-2' } as never),
  ];
  const twoDbRows = () => [
    generatedRow('wi-1', 's-1'),
    generatedRow('wi-2', 's-2'),
  ];
  /** The halted-mid-stage shape: one item done, one failed. */
  const haltedMidStageRun = () => ({
    id: 'run-halted',
    status: 'halted',
    items: [
      { work_item_id: 'wi-1', status: 'implemented' },
      {
        work_item_id: 'wi-2',
        status: 'failed',
        failure_class: 'real',
        error_detail: 'build failed',
      },
    ],
  });

  it('halted MID-STAGE: renders BOTH "Re-start stage 1" and "Resume stage 1"; Resume calls the api with runId + company/project and refetches the run', async () => {
    mockFetchRows.mockResolvedValue(twoDbRows());
    mockGetRun.mockResolvedValue(haltedMidStageRun());
    renderWorkspace(draftWith(twoDbStories()));

    // Both buttons, correctly labelled — never a bare "Start stage 1".
    const resume = await screen.findByTestId('execution-rail-resume-failed-db');
    expect(resume).toHaveTextContent('▶ Resume stage 1');
    const restart = screen.getByTestId('execution-rail-start');
    expect(restart).toHaveTextContent('↻ Re-start stage 1');

    const runReadsBefore = mockGetRun.mock.calls.length;
    fireEvent.click(resume);
    await waitFor(() =>
      expect(mockResumeFailed).toHaveBeenCalledWith(PROJECT_ID, 'run-halted', {
        company: 'acme',
        project: 'demo',
        bookId: BOOK_ID,
      }),
    );
    // On 200 the rail refetches the run state it already polls.
    await waitFor(() =>
      expect(mockGetRun.mock.calls.length).toBeGreaterThan(runReadsBefore),
    );
    expect(screen.queryByTestId('execution-rail-error')).toBeNull();
  });

  it('a 409 refusal surfaces the driver reason via the rail error affordance', async () => {
    mockFetchRows.mockResolvedValue(twoDbRows());
    mockGetRun.mockResolvedValue(haltedMidStageRun());
    mockResumeFailed.mockResolvedValue({
      resumed: false,
      reason: 'only a halted run can resume from failure',
    });
    renderWorkspace(draftWith(twoDbStories()));

    fireEvent.click(await screen.findByTestId('execution-rail-resume-failed-db'));
    const err = await screen.findByTestId('execution-rail-error');
    expect(err).toHaveTextContent('only a halted run can resume from failure');
  });

  it('armed auto-retry: retry_attempt_count=1 + a scheduled next attempt renders the "retrying (attempt 2/3)" chip', async () => {
    mockFetchRows.mockResolvedValue(twoDbRows());
    // The backoff shape: pending item with one attempt consumed and the next
    // re-dispatch scheduled — N consumed means the NEXT try is attempt N+1.
    mockGetRun.mockResolvedValue({
      id: 'run-retrying',
      status: 'dispatching',
      items: [
        { work_item_id: 'wi-1', status: 'implemented' },
        {
          work_item_id: 'wi-2',
          status: 'pending',
          retry_attempt_count: 1,
          retry_next_attempt_at: '2026-08-05T10:00:00Z',
          failure_class: 'transient_upstream',
        },
      ],
    });
    renderWorkspace(draftWith(twoDbStories()));

    const chip = await screen.findByTestId('execution-rail-retry-chip-db');
    expect(chip).toHaveTextContent('retrying (attempt 2/3)');
  });

  it('REGRESSION pin: a pristine stage (no prior halted run) keeps the plain "Start stage 1" and no Resume button', async () => {
    mockFetchRows.mockResolvedValue(twoDbRows());
    mockGetRun.mockResolvedValue(null);
    renderWorkspace(draftWith(twoDbStories()));

    await waitFor(() =>
      expect(screen.getByTestId('execution-rail-start')).toBeEnabled(),
    );
    expect(screen.getByTestId('execution-rail-start')).toHaveTextContent(
      '▶ Start stage 1',
    );
    expect(screen.queryByTestId('execution-rail-resume-failed-db')).toBeNull();
  });
  it('a FINISHED (deployed) run shows "Re-run DB build…" opening the retry dialog (2026-08-11 — data reload without a stage re-run)', async () => {
    // The live case: stage 1 completed, then the loaded data was found
    // defective — re-running assemble → schema → load → parity must not
    // require re-running the 21 specs.
    mockFetchRows.mockResolvedValue([generatedRow('wi-1', 's-1')]);
    mockGetRun.mockResolvedValue({
      id: 'run-done',
      status: 'deployed',
      items: [
        {
          work_item_id: 'wi-1', status: 'deployed', outcome: 'deployed',
          deploy_on_complete: true, error_detail: null,
        },
      ],
    });
    renderWorkspace(
      draftWith([makeItem({ id: 's-1', title: 'Schema story', workItemId: 'wi-1' } as never)]),
    );

    const button = await screen.findByTestId('execution-rail-rerun-db-button');
    fireEvent.click(button);
    const dialog = await screen.findByTestId('start-stage-dialog');
    expect(dialog).toHaveTextContent('Retry DB build');
  });
});

