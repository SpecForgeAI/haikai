/**
 * Discovery Review Room tests.
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect (Spec 3 — capstone)
 *       + 2026-06-05-review-room-agenda-redesign (family chunks)
 *       + 2026-06-06-discovery-review-room-agenda-redesign-2 (Task Group 5: the
 *         four-button rich-cascade FAMILY chunk, immediate-apply + auto-advance +
 *         scroll, conflicts-applied-in-place, and the single terminal Save Yes/No).
 *
 * After the 2026-06-06 confirm-box-removal redesign the per-chunk + per-conflict
 * confirm gate is GONE: chunk dispositions and conflict resolutions apply
 * IMMEDIATELY (the click IS the confirmation) and return an `'applied'` outcome.
 * A DISPOSITION auto-advances (appends the `nextChunk` carried in the outcome and
 * scrolls the user's last blue action message to the top); a CONFLICT re-renders
 * the SAME chunk IN PLACE (no advance — Q4). The ONLY surviving confirm gate is the
 * terminal "Save all approved candidates back to the architecture?" Yes/No,
 * auto-appended on agenda exhaustion.
 *
 * The room is mounted DIRECTLY (it does not render the grid) so the known
 * `DiscoveryCandidateTable` on-mount `getReviewModel` fetch gotcha does not
 * apply here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

import type { DiscoveryRunDto } from '../../api/discoveryApi';
import type {
  ChunkSummaryTurnWire,
  PendingConfirmationTurnWire,
  ReviewTurnOutcomeWire,
  StartReviewResponse,
} from '../../api/discoveryReviewApi';

// ----------------------------------------------------------------------------
// Mock the Discovery Review API client. The room tests verify WIRING (the
// optimistic echo + the immediate apply + the auto-advance + the terminal Save),
// not URL shape (that is the gateway's contract). The deterministic counts the
// surfaces show come straight from the SERVER outcome the mock returns.
// ----------------------------------------------------------------------------

const mockLoadReviewConversation = vi.fn();
const mockStartReview = vi.fn();
const mockAnswerReviewTurn = vi.fn();
const mockCaptureReviewTurn = vi.fn();
const mockConfirmReviewTurn = vi.fn();
const mockGetReviewModelCounts = vi.fn();

vi.mock('../../api/discoveryReviewApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/discoveryReviewApi')
  >('../../api/discoveryReviewApi');
  return {
    ...actual,
    loadReviewConversation: (...a: unknown[]) => mockLoadReviewConversation(...a),
    startReview: (...a: unknown[]) => mockStartReview(...a),
    answerReviewTurn: (...a: unknown[]) => mockAnswerReviewTurn(...a),
    captureReviewTurn: (...a: unknown[]) => mockCaptureReviewTurn(...a),
    confirmReviewTurn: (...a: unknown[]) => mockConfirmReviewTurn(...a),
    getReviewModelCounts: (...a: unknown[]) => mockGetReviewModelCounts(...a),
  };
});

// The room lists the project/architecture runs for the per-service scan-selection
// opener via discoveryApi.getDiscoveryRuns. `readSnapshotServiceName` stays the
// real implementation (via `...actual`) so the display-name fallback is exercised.
const mockGetDiscoveryRuns = vi.fn();
const mockGetReviewModel = vi.fn();
vi.mock('../../api/discoveryApi', async () => {
  const actual = await vi.importActual<typeof import('../../api/discoveryApi')>(
    '../../api/discoveryApi',
  );
  return {
    ...actual,
    getDiscoveryRuns: (...a: unknown[]) => mockGetDiscoveryRuns(...a),
    // GOTCHA (spec Task Group 4): a `getReviewModel` export must exist on the
    // mocked discoveryApi for any test rendering DiscoveryReviewRoom /
    // DiscoveryCandidateTable (the on-mount fetch). The room here mounts directly
    // and never reads it, but we keep the export defined + resolving to be safe.
    getReviewModel: (...a: unknown[]) => mockGetReviewModel(...a),
  };
});

// CSS module identity mocks.
vi.mock('./DiscoveryReviewRoom.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));
vi.mock('../targetState/architectConversation/ArchitectConversation.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

// The per-service picker reads `services` + `app_components` from the AppShell's
// cached model via useArchitecture(). Mock it to a minimal AppState-shaped model:
// two code-tier services (a UI tier + a Service tier) + one persistence service.
const mockUseArchitecture = vi.fn();
vi.mock('../../contexts/ArchitectureContext', () => ({
  useArchitecture: () => mockUseArchitecture(),
}));

const UI_SERVICE_ID = 'svc-ui';
const API_SERVICE_ID = 'svc-api';
const DB_SERVICE_ID = 'svc-db';

function modelWithServices() {
  return {
    metaModel: {
      entities: {
        services: [
          { id: UI_SERVICE_ID, name: 'MyApp UI', app_component_id: 'ac-ui' },
          { id: API_SERVICE_ID, name: 'MyApp API', app_component_id: 'ac-api' },
          { id: DB_SERVICE_ID, name: 'MyApp Sybase Database', app_component_id: 'ac-db' },
        ],
        app_components: [
          { id: 'ac-ui', name: 'Web', tech_type: 'UI Tier' },
          { id: 'ac-api', name: 'Api', tech_type: 'Service Tier' },
          { id: 'ac-db', name: 'Db', tech_type: 'Persistence Tier' },
        ],
      },
    },
  };
}

import { DiscoveryReviewRoom } from './DiscoveryReviewRoom';

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const CODE_RUN_ID = 'run-code-1';
const DB_RUN_ID = 'run-db-1';

function run(overrides: Partial<DiscoveryRunDto>): DiscoveryRunDto {
  return {
    id: 'r',
    project_id: PROJECT_ID,
    status: 'COMPLETED',
    current_step: null,
    config_snapshot: null,
    steps_payload: null,
    error_message: null,
    created_at: '2026-06-02T00:00:00Z',
    updated_at: '2026-06-02T00:00:00Z',
    architecture_id: ARCH_ID,
    ...overrides,
  };
}

const codeRun = run({ id: CODE_RUN_ID, discovery_kind: 'code', service_id: API_SERVICE_ID });
const dbRun = run({ id: DB_RUN_ID, discovery_kind: 'database', service_id: DB_SERVICE_ID });

const firstChunk: ChunkSummaryTurnWire = {
  kind: 'chunk-summary',
  section: 'interfaces-endpoints',
  scanScope: 'code',
  items: [
    { id: 'c1', itemType: 'candidate', name: 'OrderService', detail: 'service' },
    { id: 'c2', itemType: 'candidate', name: 'OrderRepo', detail: 'class' },
  ],
  cursor: 0,
  nextCursor: 1,
  agendaTotal: 12,
};

// A chunk whose first item carries LIVE-CONFLICT facts (the defect-fix surface):
// a `framework` conflict competing between two sources, similarity class size 3
// (so the "resolve all" offer is shown).
const conflictChunk: ChunkSummaryTurnWire = {
  kind: 'chunk-summary',
  section: 'interfaces-endpoints',
  scanScope: 'code',
  items: [
    {
      id: 'cf1',
      itemType: 'candidate',
      name: 'PaymentService',
      detail: 'service',
      conflicts: [
        {
          attr: 'framework',
          competing: [
            { value: 'JAX-RS', source: 'src-jaxrs' },
            { value: 'Spring MVC', source: 'src-spring' },
          ],
          similarCount: 3,
        },
      ],
    },
  ],
  cursor: 0,
  nextCursor: null,
  agendaTotal: 1,
};

const startResponse: StartReviewResponse = {
  sessionId: 'sess-1',
  openTurn: {
    kind: 'open',
    sessionId: 'sess-1',
    openedBy: 'tester',
    scanPair: {
      runs: [{ runId: CODE_RUN_ID, scanKind: 'code', serviceId: API_SERVICE_ID }],
      primaryRunId: CODE_RUN_ID,
    },
  },
  firstChunk,
};

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom does not implement scrollIntoView; the auto-advance scroll calls it on
  // the user's last blue action message. Stub it so the call is observable.
  Element.prototype.scrollIntoView = vi.fn();
  mockUseArchitecture.mockReturnValue({ model: modelWithServices() });
  mockGetReviewModel.mockResolvedValue({});
  mockGetDiscoveryRuns.mockResolvedValue([codeRun, dbRun]);
  mockLoadReviewConversation.mockResolvedValue({ threadId: 't-1', turns: [] });
  mockStartReview.mockResolvedValue(startResponse);
  mockGetReviewModelCounts.mockResolvedValue({
    actionableCount: 33,
    committedCount: 7,
    liveConflictCount: 0,
    totalCandidates: 40,
    totalFindings: 9,
  });
});

async function openRoomAndStart() {
  render(
    <DiscoveryReviewRoom
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      runId={CODE_RUN_ID}
      runDiscoveryKind="code"
      openedBy="tester"
    />,
  );
  // The scan-selection opening turn lists the runs.
  await screen.findByTestId('review-room-scan-selection');
  // Begin the review (defaults to the current run as the primary code scan).
  fireEvent.click(screen.getByTestId('review-room-begin'));
  await screen.findByTestId('review-room-transcript');
}

describe('DiscoveryReviewRoom — per-service scan-selection opener', () => {
  it('groups runs by service_id, rendering ONE picker per service with the model display name + a "None" option (the current run seated in its group)', async () => {
    render(
      <DiscoveryReviewRoom
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={CODE_RUN_ID}
        runDiscoveryKind="code"
        openedBy="tester"
      />,
    );

    const selector = await screen.findByTestId('review-room-scan-selection');
    expect(selector).toBeInTheDocument();
    expect(mockGetDiscoveryRuns).toHaveBeenCalledWith(PROJECT_ID, ARCH_ID);

    // One picker group per scanned service, labelled with the model service name.
    const apiGroup = screen.getByTestId(`review-room-service-group-${API_SERVICE_ID}`);
    const dbGroup = screen.getByTestId(`review-room-service-group-${DB_SERVICE_ID}`);
    expect(within(apiGroup).getByText('MyApp API')).toBeInTheDocument();
    expect(within(dbGroup).getByText('MyApp Sybase Database')).toBeInTheDocument();

    // Each group offers its run plus a "None" option (0-or-1 per service).
    expect(
      within(apiGroup).getByTestId(`review-room-service-run-${API_SERVICE_ID}-${CODE_RUN_ID}`),
    ).toBeInTheDocument();
    expect(
      within(apiGroup).getByTestId(`review-room-service-run-${API_SERVICE_ID}-none`),
    ).toBeInTheDocument();
    expect(
      within(dbGroup).getByTestId(`review-room-service-run-${DB_SERVICE_ID}-none`),
    ).toBeInTheDocument();

    // The current run (CODE_RUN_ID) is the default selection within ITS service
    // group; the OTHER service starts at "None". Seeding runs in an effect once
    // the async runs have loaded, so await the post-seed render.
    await waitFor(() =>
      expect(
        within(apiGroup).getByTestId(`review-room-service-run-${API_SERVICE_ID}-${CODE_RUN_ID}`),
      ).toBeChecked(),
    );
    expect(
      within(dbGroup).getByTestId(`review-room-service-run-${DB_SERVICE_ID}-none`),
    ).toBeChecked();

    // The optional technology-tier label surfaces for resolvable services
    // (API => Service Tier => "Service") and NEVER blocks selection.
    expect(
      within(apiGroup).getByTestId(`review-room-service-tier-${API_SERVICE_ID}`),
    ).toHaveTextContent('Service');
  });

  it('collects an orphan (NULL service_id) run under the synthetic "Unassigned scans" bucket', async () => {
    const orphanRun = run({ id: 'run-orphan', discovery_kind: 'code', service_id: null });
    mockGetDiscoveryRuns.mockResolvedValue([codeRun, orphanRun]);

    render(
      <DiscoveryReviewRoom
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={CODE_RUN_ID}
        runDiscoveryKind="code"
        openedBy="tester"
      />,
    );
    await screen.findByTestId('review-room-scan-selection');

    const unassigned = screen.getByTestId('review-room-service-group-__unassigned__');
    expect(within(unassigned).getByText('Unassigned scans')).toBeInTheDocument();
    expect(
      within(unassigned).getByTestId('review-room-service-run-__unassigned__-run-orphan'),
    ).toBeInTheDocument();
  });

  it('falls back to the snapshot service name when the service_id does not resolve in the model (regression for the snapshot fix)', async () => {
    // A run whose service_id is NOT in the cached model, but whose snapshot
    // carries the (camelCase, as actually persisted) serviceName.
    const snapshotRun = run({
      id: 'run-snap',
      discovery_kind: 'code',
      service_id: 'svc-missing',
      config_snapshot: { serviceIdentitySnapshot: { serviceName: 'Legacy Billing Service' } },
    });
    mockGetDiscoveryRuns.mockResolvedValue([snapshotRun]);

    render(
      <DiscoveryReviewRoom
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId="run-snap"
        runDiscoveryKind="code"
        openedBy="tester"
      />,
    );
    await screen.findByTestId('review-room-scan-selection');

    const group = screen.getByTestId('review-room-service-group-svc-missing');
    expect(within(group).getByText('Legacy Billing Service')).toBeInTheDocument();
  });

  it('keeps Begin disabled until >=1 run is selected, and enabled once a pick is made', async () => {
    // No run is the current run here, so every group starts at "None".
    mockGetDiscoveryRuns.mockResolvedValue([codeRun, dbRun]);
    render(
      <DiscoveryReviewRoom
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId="not-in-list"
        runDiscoveryKind="code"
        openedBy="tester"
      />,
    );
    await screen.findByTestId('review-room-scan-selection');

    // Nothing selected across any group -> Begin is disabled.
    expect(screen.getByTestId('review-room-begin')).toBeDisabled();

    // Pick one run in one group -> Begin enables.
    fireEvent.click(
      screen.getByTestId(`review-room-service-run-${API_SERVICE_ID}-${CODE_RUN_ID}`),
    );
    expect(screen.getByTestId('review-room-begin')).toBeEnabled();
  });

  it('assembles a 3-run SelectedScanSet across 2 code + 1 DB services with a deterministic primaryRunId (= the current run)', async () => {
    // Two code services + one DB service; each scanned once.
    const uiRun = run({ id: 'run-ui', discovery_kind: 'code', service_id: UI_SERVICE_ID });
    mockGetDiscoveryRuns.mockResolvedValue([uiRun, codeRun, dbRun]);

    render(
      <DiscoveryReviewRoom
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        runId={CODE_RUN_ID}
        runDiscoveryKind="code"
        openedBy="tester"
      />,
    );
    await screen.findByTestId('review-room-scan-selection');

    // Pick the UI service's run + the DB service's run (the API service's run is
    // already seated as the current run).
    fireEvent.click(screen.getByTestId(`review-room-service-run-${UI_SERVICE_ID}-run-ui`));
    fireEvent.click(screen.getByTestId(`review-room-service-run-${DB_SERVICE_ID}-${DB_RUN_ID}`));
    fireEvent.click(screen.getByTestId('review-room-begin'));

    await waitFor(() => expect(mockStartReview).toHaveBeenCalledTimes(1));
    const call = mockStartReview.mock.calls[0][0];
    // primaryRunId (thread anchor) is the current run, which is among the picks.
    expect(call.runId).toBe(CODE_RUN_ID);
    expect(call.scanPair.primaryRunId).toBe(CODE_RUN_ID);
    // The full 3-run set rides in runs[] with each run's scanKind + serviceId.
    const setRuns = call.scanPair.runs as Array<{ runId: string; scanKind: string; serviceId: string | null }>;
    expect(setRuns).toHaveLength(3);
    const byRunId = new Map(setRuns.map((r) => [r.runId, r]));
    expect(byRunId.get('run-ui')).toEqual({ runId: 'run-ui', scanKind: 'code', serviceId: UI_SERVICE_ID });
    expect(byRunId.get(CODE_RUN_ID)).toEqual({ runId: CODE_RUN_ID, scanKind: 'code', serviceId: API_SERVICE_ID });
    expect(byRunId.get(DB_RUN_ID)).toEqual({ runId: DB_RUN_ID, scanKind: 'database', serviceId: DB_SERVICE_ID });
    // primaryRunId MUST be one of runs[].runId (the thread anchor invariant).
    expect(setRuns.map((r) => r.runId)).toContain(call.scanPair.primaryRunId);

    // The full additional-run-id set is forwarded to the counts read (TG 4.8):
    // primaryRunId in the positional arg, the 2 extras as the additional set.
    await waitFor(() => expect(mockGetReviewModelCounts).toHaveBeenCalled());
    const countsArgs = mockGetReviewModelCounts.mock.calls[0];
    expect(countsArgs[2]).toBe(CODE_RUN_ID); // primary
    expect(countsArgs[3]).toEqual(expect.arrayContaining(['run-ui', DB_RUN_ID]));
    expect(countsArgs[3]).not.toContain(CODE_RUN_ID); // primary is never in the extras
  });

  it('re-derives the open-turn summary from the run set (reads correctly for a multi-run selection)', async () => {
    // A 3-run open turn (2 code + 1 DB) summarises as "3 scans (2 code, 1 database)".
    mockStartReview.mockResolvedValue({
      ...startResponse,
      openTurn: {
        kind: 'open',
        sessionId: 'sess-1',
        openedBy: 'tester',
        scanPair: {
          runs: [
            { runId: 'run-ui', scanKind: 'code', serviceId: UI_SERVICE_ID },
            { runId: CODE_RUN_ID, scanKind: 'code', serviceId: API_SERVICE_ID },
            { runId: DB_RUN_ID, scanKind: 'database', serviceId: DB_SERVICE_ID },
          ],
          primaryRunId: CODE_RUN_ID,
        },
      },
    });
    await openRoomAndStart();

    const open = await screen.findByTestId('review-room-turn-open');
    expect(open).toHaveTextContent('3 scans (2 code, 1 database)');
  });
});

// ===========================================================================
// 2026-06-06 redesign-2: chunk dispositions + conflicts apply IMMEDIATELY (no
// off-screen confirm gate). A disposition returns the next chunk in the
// `'applied'` outcome; a conflict returns the SAME chunk refreshed.
// ===========================================================================

describe('DiscoveryReviewRoom — immediate-apply (no per-chunk confirm gate)', () => {
  it('an LLM-proposed apply-decision applies IMMEDIATELY (no pending-confirmation box) and surfaces the applied turn', async () => {
    mockAnswerReviewTurn.mockResolvedValue({
      kind: 'applied',
      userMessageTurn: { kind: 'user-message', text: 'approve all of those' },
      previewTurn: {
        kind: 'preview',
        action: 'approved',
        totalCandidates: 7,
        seedCandidates: 1,
        cascadedCandidates: 6,
        totalFindings: 3,
        runTotalCandidates: 40,
        runTotalFindings: 9,
      },
      appliedTurn: {
        kind: 'decision-applied',
        action: 'approved',
        candidateIds: ['c1'],
        findingIds: [],
        appliedCandidateCount: 7,
        appliedFindingCount: 3,
      },
      nextChunk: null,
      advanced: true,
      terminalSaveTurn: null,
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    fireEvent.change(screen.getByTestId('review-room-input'), {
      target: { value: 'approve all of those' },
    });
    fireEvent.click(screen.getByTestId('review-room-send'));

    // The applied turn lands directly — NO confirm gate, NO /confirm round-trip.
    expect(await screen.findByTestId('review-room-turn-decision-applied')).toBeInTheDocument();
    expect(screen.queryByTestId('review-room-pending-confirmation')).not.toBeInTheDocument();
    expect(mockConfirmReviewTurn).not.toHaveBeenCalled();
  });

  it('an LLM-proposed resolve-conflicts-by-pattern applies IMMEDIATELY (no pending box) and records the bulk-pattern-resolved turn', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: conflictChunk });
    mockAnswerReviewTurn.mockResolvedValue({
      kind: 'applied',
      userMessageTurn: { kind: 'user-message', text: 'use src-jaxrs for all of those' },
      previewTurn: null,
      appliedTurn: {
        kind: 'bulk-pattern-resolved',
        attr: 'framework',
        chosenSource: 'src-jaxrs',
        candidateIds: ['cf1', 'cf2', 'cf3'],
        resolvedCount: 3,
      },
      nextChunk: { ...conflictChunk, items: [{ ...conflictChunk.items[0], conflicts: [] }] },
      advanced: false,
      terminalSaveTurn: null,
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    fireEvent.change(screen.getByTestId('review-room-input'), {
      target: { value: 'use src-jaxrs for all of those' },
    });
    fireEvent.click(screen.getByTestId('review-room-send'));

    expect(await screen.findByTestId('review-room-turn-bulk-pattern-resolved')).toBeInTheDocument();
    expect(screen.queryByTestId('review-room-pending-confirmation')).not.toBeInTheDocument();
    expect(mockConfirmReviewTurn).not.toHaveBeenCalled();
  });
});

describe('DiscoveryReviewRoom — degrade-in-place', () => {
  it('on an LLM-failure signal shows the deterministic click-to-answer agenda over the SAME chunk (not bounced to the grid)', async () => {
    // The LLM path returns an error outcome (timeout / round-budget / relay down).
    mockAnswerReviewTurn.mockResolvedValue({
      kind: 'error',
      userMessageTurn: { kind: 'user-message', text: 'approve all' },
      errorTurn: {
        kind: 'error',
        errorKind: 'llm-call-timeout',
        errorMessage: 'The Architect timed out.',
        recoverableHint: 'Continue with the deterministic agenda.',
      },
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    fireEvent.change(screen.getByTestId('review-room-input'), {
      target: { value: 'approve all' },
    });
    fireEvent.click(screen.getByTestId('review-room-send'));

    // The room stays IN PLACE: the transcript + the deterministic agenda are
    // shown — we did NOT bounce out to the grid.
    const agenda = await screen.findByTestId('review-room-degraded-agenda');
    expect(screen.getByTestId('review-room-transcript')).toBeInTheDocument();
    // The SAME chunk's items drive the deterministic agenda (in place).
    expect(within(agenda).getByText('OrderService')).toBeInTheDocument();
    // The deterministic agenda offers click-to-answer actions over the chunk
    // items (which drive the /capture route, NOT the LLM).
    expect(
      within(agenda).getByTestId('review-room-degraded-approve-c1'),
    ).toBeInTheDocument();
  });

  it('the deterministic degraded-agenda Approve applies IMMEDIATELY via /capture (no confirm gate, no direct /confirm write)', async () => {
    mockCaptureReviewTurn.mockResolvedValue({
      kind: 'applied',
      userMessageTurn: { kind: 'user-message', text: 'Approve OrderService' },
      previewTurn: null,
      appliedTurn: {
        kind: 'decision-applied',
        action: 'approved',
        candidateIds: ['c1'],
        findingIds: [],
        appliedCandidateCount: 1,
        appliedFindingCount: 0,
      },
      nextChunk: null,
      advanced: true,
      terminalSaveTurn: null,
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    // Force the degraded agenda open via an LLM error first.
    mockAnswerReviewTurn.mockResolvedValue({
      kind: 'error',
      userMessageTurn: null,
      errorTurn: {
        kind: 'error',
        errorKind: 'relay-down',
        errorMessage: 'relay down',
      },
    } as unknown as ReviewTurnOutcomeWire);
    fireEvent.change(screen.getByTestId('review-room-input'), {
      target: { value: 'go' },
    });
    fireEvent.click(screen.getByTestId('review-room-send'));
    const agenda = await screen.findByTestId('review-room-degraded-agenda');

    // A deterministic click applies immediately through /capture (no confirm gate).
    fireEvent.click(within(agenda).getByTestId('review-room-degraded-approve-c1'));

    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    expect(mockConfirmReviewTurn).not.toHaveBeenCalled();
    expect(screen.queryByTestId('review-room-pending-confirmation')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// The in-transcript chunk is ALWAYS-ACTIONABLE in the NORMAL flow (no LLM
// required); every action applies immediately through /capture.
// ===========================================================================

describe('DiscoveryReviewRoom — always-actionable chunk (normal flow)', () => {
  it('renders per-item Approve/Reject/Defer on a chunk-summary turn; clicking Approve applies an apply-decision via /capture immediately (no confirm gate)', async () => {
    mockCaptureReviewTurn.mockResolvedValue({
      kind: 'applied',
      userMessageTurn: { kind: 'user-message', text: 'Approve OrderService' },
      previewTurn: null,
      appliedTurn: {
        kind: 'decision-applied',
        action: 'approved',
        candidateIds: ['c1'],
        findingIds: [],
        appliedCandidateCount: 1,
        appliedFindingCount: 0,
      },
      nextChunk: null,
      advanced: true,
      terminalSaveTurn: null,
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    // The first chunk is in the transcript; its items expose the always-on
    // deterministic controls (NOT only in the degraded agenda).
    const chunk = await screen.findByTestId('review-room-chunk');
    expect(within(chunk).getByTestId('review-room-chunk-approved-c1')).toBeInTheDocument();
    expect(within(chunk).getByTestId('review-room-chunk-rejected-c1')).toBeInTheDocument();
    expect(within(chunk).getByTestId('review-room-chunk-deferred-c1')).toBeInTheDocument();
    // The degraded agenda is NOT shown — the LLM never failed.
    expect(screen.queryByTestId('review-room-degraded-agenda')).not.toBeInTheDocument();

    // Click Approve on the first item → a /capture propose-intent apply-decision.
    fireEvent.click(within(chunk).getByTestId('review-room-chunk-approved-c1'));

    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    const arg = mockCaptureReviewTurn.mock.calls[0][0];
    expect(arg.capture.action).toBe('propose-intent');
    expect(arg.capture.intent).toEqual({
      kind: 'apply-decision',
      seedCandidateIds: ['c1'],
      findingIds: [],
      action: 'approved',
    });
    // The action applied immediately — NO confirm gate, NO /confirm round-trip.
    expect(mockConfirmReviewTurn).not.toHaveBeenCalled();
    expect(screen.queryByTestId('review-room-pending-confirmation')).not.toBeInTheDocument();
  });

  it('Reject on a finding item proposes an apply-decision scoped to findingIds (not seedCandidateIds)', async () => {
    const findingChunk: ChunkSummaryTurnWire = {
      ...firstChunk,
      section: 'findings-by-severity',
      items: [{ id: 'f1', itemType: 'finding', name: 'stored_proc', detail: 'high' }],
      nextCursor: null,
      agendaTotal: 1,
    };
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: findingChunk });
    mockCaptureReviewTurn.mockResolvedValue({
      kind: 'applied',
      userMessageTurn: { kind: 'user-message', text: 'Reject stored_proc' },
      previewTurn: null,
      appliedTurn: {
        kind: 'decision-applied',
        action: 'rejected',
        candidateIds: [],
        findingIds: ['f1'],
        appliedCandidateCount: 0,
        appliedFindingCount: 1,
      },
      nextChunk: null,
      advanced: true,
      terminalSaveTurn: null,
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    fireEvent.click(within(chunk).getByTestId('review-room-chunk-rejected-f1'));

    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    expect(mockCaptureReviewTurn.mock.calls[0][0].capture.intent).toEqual({
      kind: 'apply-decision',
      seedCandidateIds: [],
      findingIds: ['f1'],
      action: 'rejected',
    });
  });

  it('a live-conflict item renders its competing sources; clicking "Use {source}" proposes a resolve-conflict via /capture and applies it immediately', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: conflictChunk });
    mockCaptureReviewTurn.mockResolvedValue({
      kind: 'applied',
      userMessageTurn: { kind: 'user-message', text: 'Resolve framework → src-jaxrs' },
      previewTurn: null,
      appliedTurn: {
        kind: 'conflict-resolved',
        candidateId: 'cf1',
        attr: 'framework',
        chosenValue: 'JAX-RS',
        chosenSource: 'src-jaxrs',
      },
      // The SAME chunk refreshed with the conflict cleared (Q4 — no advance).
      nextChunk: { ...conflictChunk, items: [{ ...conflictChunk.items[0], conflicts: [] }] },
      advanced: false,
      terminalSaveTurn: null,
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    // The competing sources are rendered as deterministic pick controls.
    expect(
      within(chunk).getByTestId('review-room-chunk-resolve-cf1-framework-src-jaxrs'),
    ).toBeInTheDocument();
    expect(
      within(chunk).getByTestId('review-room-chunk-resolve-cf1-framework-src-spring'),
    ).toBeInTheDocument();

    // Pick the JAX-RS source → a /capture propose-intent resolve-conflict
    // carrying the SERVER-SUPPLIED competing value for that source (cf1/src-jaxrs).
    fireEvent.click(within(chunk).getByTestId('review-room-chunk-resolve-cf1-framework-src-jaxrs'));

    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    expect(mockCaptureReviewTurn.mock.calls[0][0].capture.intent).toEqual({
      kind: 'resolve-conflict',
      candidateId: 'cf1',
      attr: 'framework',
      chosenValue: 'JAX-RS',
      chosenSource: 'src-jaxrs',
    });
    // Applied immediately — NO confirm gate.
    expect(mockConfirmReviewTurn).not.toHaveBeenCalled();
    expect(await screen.findByTestId('review-room-turn-conflict-resolved')).toBeInTheDocument();
    expect(screen.queryByTestId('review-room-pending-confirmation')).not.toBeInTheDocument();
  });

  it('a similarCount>=2 live-conflict item offers and fires a resolve-conflicts-by-pattern intent (the server fills the class)', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: conflictChunk });
    mockCaptureReviewTurn.mockResolvedValue({
      kind: 'applied',
      userMessageTurn: { kind: 'user-message', text: 'Use src-jaxrs for all 3 framework conflicts' },
      previewTurn: null,
      appliedTurn: {
        kind: 'bulk-pattern-resolved',
        attr: 'framework',
        chosenSource: 'src-jaxrs',
        candidateIds: ['cf1', 'cf2', 'cf3'],
        resolvedCount: 3,
      },
      nextChunk: { ...conflictChunk, items: [{ ...conflictChunk.items[0], conflicts: [] }] },
      advanced: false,
      terminalSaveTurn: null,
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    // The resolve-all control is offered (similarCount = 3 >= 2).
    const resolveAll = within(chunk).getByTestId(
      'review-room-chunk-resolve-all-cf1-framework-src-jaxrs',
    );
    expect(resolveAll).toHaveTextContent('Use src-jaxrs for all 3');

    fireEvent.click(resolveAll);

    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    // The proposed intent leaves classCandidateIds EMPTY — the server fills the
    // class deterministically via getSimilarConflicts (the LLM/client never
    // supplies the membership).
    expect(mockCaptureReviewTurn.mock.calls[0][0].capture.intent).toEqual({
      kind: 'resolve-conflicts-by-pattern',
      candidateId: 'cf1',
      attr: 'framework',
      chosenSource: 'src-jaxrs',
      classCandidateIds: [],
    });
    expect(mockConfirmReviewTurn).not.toHaveBeenCalled();
  });

  it('no in-chunk "Show next chunk" advance button is rendered (the disposition auto-advance replaced it)', async () => {
    await openRoomAndStart();
    const chunk = await screen.findByTestId('review-room-chunk');
    // firstChunk.nextCursor === 1, but the manual advance control is retired.
    expect(within(chunk).queryByTestId('review-room-chunk-advance')).not.toBeInTheDocument();
  });
});

// ===========================================================================
// 2026-06-06 redesign-2 (Task Group 5): the four-button rich-cascade FAMILY
// chunk, immediate-apply + auto-advance + scroll, conflicts-applied-in-place,
// and the single terminal Save Yes/No.
// ===========================================================================

// A FAMILY chunk: a parent entity (`fam-parent`) + two indented `parent_child`
// children, carrying the four family actions (the three full-cascade dispositions
// PLUS the dedicated "Approve visible chunk") + the rich cascade preview with all
// three already-* sub-counts populated on the associated logical-attribute type.
const familyChunk: ChunkSummaryTurnWire = {
  kind: 'chunk-summary',
  section: 'interfaces-endpoints',
  scanScope: 'code',
  items: [
    { id: 'fam-parent', itemType: 'candidate', name: 'OrderEntity', detail: 'logical_data_entity' },
    { id: 'fam-child-a', itemType: 'candidate', name: 'orderId', detail: 'logical_data_attribute' },
    { id: 'fam-child-b', itemType: 'candidate', name: 'orderTotal', detail: 'logical_data_attribute' },
  ],
  cursor: 0,
  nextCursor: null,
  agendaTotal: 3,
  family: { parentId: 'fam-parent', childIds: ['fam-child-a', 'fam-child-b'] },
  familyBulkActions: ['approved', 'rejected', 'deferred'],
  familyVisibleChunkAction: 'approve-visible-chunk',
  cascadePreview: {
    total: 123,
    byType: [
      {
        type: 'logical_data_entity',
        count: 8,
        alreadyApproved: 3,
        alreadyRejected: 1,
        alreadyDeferred: 2,
      },
      {
        type: 'logical_data_attribute',
        count: 104,
        alreadyApproved: 45,
        alreadyRejected: 0,
        alreadyDeferred: 0,
      },
    ],
  },
};

// The NEXT chunk a disposition auto-advances to (a different family).
const nextFamilyChunk: ChunkSummaryTurnWire = {
  kind: 'chunk-summary',
  section: 'business-logic',
  scanScope: 'code',
  items: [
    { id: 'fam2-parent', itemType: 'candidate', name: 'CustomerEntity', detail: 'logical_data_entity' },
  ],
  cursor: 1,
  nextCursor: null,
  agendaTotal: 3,
  family: { parentId: 'fam2-parent', childIds: [] },
  familyBulkActions: ['approved', 'rejected', 'deferred'],
  familyVisibleChunkAction: 'approve-visible-chunk',
  cascadePreview: { total: 1, byType: [{ type: 'logical_data_entity', count: 1, alreadyApproved: 0, alreadyRejected: 0, alreadyDeferred: 0 }] },
};

// A disposition that auto-advances to the next family.
const dispositionAdvancesOutcome: ReviewTurnOutcomeWire = {
  kind: 'applied',
  userMessageTurn: { kind: 'user-message', text: 'Approve All in this family (full cascade)' },
  previewTurn: {
    kind: 'preview',
    action: 'approved',
    totalCandidates: 123,
    seedCandidates: 3,
    cascadedCandidates: 120,
    totalFindings: 0,
    runTotalCandidates: 200,
    runTotalFindings: 9,
  },
  appliedTurn: {
    kind: 'decision-applied',
    action: 'approved',
    candidateIds: ['fam-parent', 'fam-child-a', 'fam-child-b'],
    findingIds: [],
    appliedCandidateCount: 123,
    appliedFindingCount: 0,
  },
  nextChunk: nextFamilyChunk,
  advanced: true,
  terminalSaveTurn: null,
};

// The terminal Save turn auto-appended when an apply exhausts the agenda.
const terminalSaveTurn: PendingConfirmationTurnWire = {
  kind: 'pending-confirmation',
  pendingId: 'pending-save',
  intent: { kind: 'save' },
  previewCounts: null,
  patternFacts: null,
  overage: null,
  summary: 'Save all approved candidates back to the architecture. Confirm to save.',
};

// A disposition that EXHAUSTS the agenda → carries the terminal Save.
const dispositionExhaustsOutcome: ReviewTurnOutcomeWire = {
  kind: 'applied',
  userMessageTurn: { kind: 'user-message', text: 'Approve All in this family (full cascade)' },
  previewTurn: {
    kind: 'preview',
    action: 'approved',
    totalCandidates: 123,
    seedCandidates: 3,
    cascadedCandidates: 120,
    totalFindings: 0,
    runTotalCandidates: 200,
    runTotalFindings: 9,
  },
  appliedTurn: {
    kind: 'decision-applied',
    action: 'approved',
    candidateIds: ['fam-parent', 'fam-child-a', 'fam-child-b'],
    findingIds: [],
    appliedCandidateCount: 123,
    appliedFindingCount: 0,
  },
  nextChunk: null,
  advanced: true,
  terminalSaveTurn,
};

describe('DiscoveryReviewRoom — family chunk: four buttons + rich cascade summary', () => {
  it('renders the FOUR family buttons (Approve All / Approve visible chunk / Reject All / Defer All) with the correct intent + scope per button', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    mockCaptureReviewTurn.mockResolvedValue(dispositionAdvancesOutcome);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    const familyBulk = within(chunk).getByTestId('review-room-chunk-family-bulk');
    expect(within(familyBulk).getByTestId('review-room-chunk-family-approved')).toBeInTheDocument();
    expect(
      within(familyBulk).getByTestId('review-room-chunk-family-approve-visible-chunk'),
    ).toBeInTheDocument();
    expect(within(familyBulk).getByTestId('review-room-chunk-family-rejected')).toBeInTheDocument();
    expect(within(familyBulk).getByTestId('review-room-chunk-family-deferred')).toBeInTheDocument();

    // Approve All → apply-decision scope:'cascade' (the resolver's full touched set).
    fireEvent.click(within(familyBulk).getByTestId('review-room-chunk-family-approved'));
    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    expect(mockCaptureReviewTurn.mock.calls[0][0].capture.intent).toEqual({
      kind: 'apply-decision',
      seedCandidateIds: ['fam-parent'],
      findingIds: [],
      action: 'approved',
      scope: 'cascade',
    });
  });

  it('the "Approve visible chunk" button proposes apply-decision with scope:"family" (the family-only reach)', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    mockCaptureReviewTurn.mockResolvedValue(dispositionAdvancesOutcome);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    fireEvent.click(
      within(chunk).getByTestId('review-room-chunk-family-approve-visible-chunk'),
    );

    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    expect(mockCaptureReviewTurn.mock.calls[0][0].capture.intent).toEqual({
      kind: 'apply-decision',
      seedCandidateIds: ['fam-parent'],
      findingIds: [],
      action: 'approved',
      scope: 'family',
    });
  });

  it('the "Reject All" and "Defer All" buttons propose a full-cascade reject/defer (scope:"cascade")', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    mockCaptureReviewTurn.mockResolvedValue(dispositionAdvancesOutcome);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    fireEvent.click(within(chunk).getByTestId('review-room-chunk-family-rejected'));
    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    expect(mockCaptureReviewTurn.mock.calls[0][0].capture.intent).toEqual({
      kind: 'apply-decision',
      seedCandidateIds: ['fam-parent'],
      findingIds: [],
      action: 'rejected',
      scope: 'cascade',
    });
  });

  it('renders the multi-line cascade summary from cascadePreview INCLUDING the three "(N already approved/rejected/deferred)" annotations', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    const summary = within(chunk).getByTestId('review-room-chunk-cascade-summary');

    // The full-cascade total line.
    expect(within(summary).getByTestId('review-room-cascade-header')).toHaveTextContent(
      'Review the current 123 candidates',
    );

    // The entity type line carries ALL THREE already-* annotations (each non-zero).
    const entityLine = within(summary).getByTestId(
      'review-room-cascade-type-logical_data_entity',
    );
    expect(entityLine).toHaveTextContent('8 logical data entities');
    expect(entityLine).toHaveTextContent('3 already approved');
    expect(entityLine).toHaveTextContent('1 already rejected');
    expect(entityLine).toHaveTextContent('2 already deferred');

    // The attribute type line carries only the non-zero approved annotation.
    const attrLine = within(summary).getByTestId(
      'review-room-cascade-type-logical_data_attribute',
    );
    expect(attrLine).toHaveTextContent('104 logical data attributes');
    expect(attrLine).toHaveTextContent('45 already approved');
    expect(attrLine).not.toHaveTextContent('already rejected');
    expect(attrLine).not.toHaveTextContent('already deferred');
  });

  it('humanises PLURAL candidate_type values (the production wire) WITHOUT double-pluralising — the "attributess" regression', async () => {
    // The REAL discovery-service wire uses PLURAL collection names for
    // candidate_type (`logical_data_attributes`, not `logical_data_attribute`);
    // the breakdown must read naturally for both the count===1 and count>1 cases.
    const pluralFamilyChunk: ChunkSummaryTurnWire = {
      ...familyChunk,
      cascadePreview: {
        total: 141,
        byType: [
          { type: 'logical_data_entities', count: 1, alreadyApproved: 0, alreadyRejected: 0, alreadyDeferred: 0 },
          { type: 'logical_data_attributes', count: 10, alreadyApproved: 0, alreadyRejected: 0, alreadyDeferred: 0 },
          { type: 'physical_data_attributes', count: 130, alreadyApproved: 0, alreadyRejected: 0, alreadyDeferred: 0 },
        ],
      },
    };
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: pluralFamilyChunk });
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    const summary = within(chunk).getByTestId('review-room-chunk-cascade-summary');

    // count === 1 → SINGULAR "logical data entity" (NOT the bogus "1 logical data entities").
    const entityLine = within(summary).getByTestId('review-room-cascade-type-logical_data_entities');
    expect(entityLine).toHaveTextContent('1 logical data entity');
    expect(entityLine).not.toHaveTextContent('entities');

    // Plural attribute types render WITHOUT a doubled trailing "s" ("attributess").
    const logAttrLine = within(summary).getByTestId('review-room-cascade-type-logical_data_attributes');
    expect(logAttrLine).toHaveTextContent('10 logical data attributes');
    expect(logAttrLine).not.toHaveTextContent('attributess');

    const physAttrLine = within(summary).getByTestId('review-room-cascade-type-physical_data_attributes');
    expect(physAttrLine).toHaveTextContent('130 physical data attributes');
    expect(physAttrLine).not.toHaveTextContent('attributess');
  });

  it('renders the cross-layer note on a PHYSICAL family — the mapped logical entities + their already-reviewed tally', async () => {
    const physicalFamilyChunk: ChunkSummaryTurnWire = {
      ...familyChunk,
      crossLayerMapping: {
        parentLayer: 'physical',
        counterpartNames: ['Order', 'OrderView'],
        mappedDecisions: { approved: 2, rejected: 1, deferred: 0, pending: 1 },
      },
    };
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: physicalFamilyChunk });
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    const note = within(chunk).getByTestId('review-room-chunk-cross-layer-note');
    expect(note).toHaveTextContent('already reviewed');
    expect(note).toHaveTextContent('2 approved');
    expect(note).toHaveTextContent('1 rejected');
    expect(note).toHaveTextContent('1 still pending');
    expect(note).toHaveTextContent('Order');
    expect(note).toHaveTextContent('OrderView');
  });

  it('renders the cross-layer note on a LOGICAL family — the mapped physical entities, no disposition tally', async () => {
    const logicalFamilyChunk: ChunkSummaryTurnWire = {
      ...familyChunk,
      crossLayerMapping: { parentLayer: 'logical', counterpartNames: ['ORDERS'] },
    };
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: logicalFamilyChunk });
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    const note = within(chunk).getByTestId('review-room-chunk-cross-layer-note');
    expect(note).toHaveTextContent('reviewed separately in the database scan');
    expect(note).toHaveTextContent('ORDERS');
  });

  it('omits the cross-layer note when the chunk carries no crossLayerMapping', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    await openRoomAndStart();
    const chunk = await screen.findByTestId('review-room-chunk');
    expect(within(chunk).queryByTestId('review-room-chunk-cross-layer-note')).toBeNull();
  });
});

describe('DiscoveryReviewRoom — type-level bulk on an orphan-by-type chunk (2026-06-09)', () => {
  // An orphan-by-type chunk (no family) carrying the type-level bulk control: 3,117
  // actionable business_logics in the code scan, only 2 shown in this slice.
  const typeBulkChunk: ChunkSummaryTurnWire = {
    kind: 'chunk-summary',
    section: 'business-logic',
    scanScope: 'code',
    items: [
      { id: 'bl-1', itemType: 'candidate', name: 'OrderService.createView', detail: 'business_logics' },
      { id: 'bl-2', itemType: 'candidate', name: 'FilterService.deleteFilter', detail: 'business_logics' },
    ],
    cursor: 0,
    nextCursor: 1,
    agendaTotal: 3117,
    typeBulk: { candidateType: 'business_logics', scanScope: 'code', actionableCount: 3117 },
    typeBulkActions: ['approved', 'rejected', 'deferred'],
  };

  it('renders Approve all N / Reject all / Defer all and proposes an apply-decision-by-type targeting the whole (type, scan)', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: typeBulkChunk });
    mockCaptureReviewTurn.mockResolvedValue(dispositionAdvancesOutcome);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    const bulk = within(chunk).getByTestId('review-room-chunk-type-bulk');
    // The Approve button carries the whole-model count, not the visible 2.
    expect(within(bulk).getByTestId('review-room-chunk-type-approved')).toHaveTextContent(
      'Approve all 3117',
    );
    expect(within(bulk).getByTestId('review-room-chunk-type-rejected')).toBeInTheDocument();
    expect(within(bulk).getByTestId('review-room-chunk-type-deferred')).toBeInTheDocument();

    fireEvent.click(within(bulk).getByTestId('review-room-chunk-type-approved'));
    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    expect(mockCaptureReviewTurn.mock.calls[0][0].capture.intent).toEqual({
      kind: 'apply-decision-by-type',
      candidateType: 'business_logics',
      scanScope: 'code',
      action: 'approved',
    });
  });

  it('does NOT render the type-level bulk on a chunk without typeBulk (the family / first chunk)', async () => {
    mockStartReview.mockResolvedValue(startResponse);
    await openRoomAndStart();
    const chunk = await screen.findByTestId('review-room-chunk');
    expect(within(chunk).queryByTestId('review-room-chunk-type-bulk')).toBeNull();
  });
});

describe('DiscoveryReviewRoom — findings bulk on a findings-by-severity chunk (2026-06-09)', () => {
  const findingsChunk: ChunkSummaryTurnWire = {
    kind: 'chunk-summary',
    section: 'findings-by-severity',
    scanScope: 'code',
    items: [
      { id: 'f-1', itemType: 'finding', name: 'risky_dependency', detail: 'high' },
      { id: 'f-2', itemType: 'finding', name: 'spring_version_detected', detail: 'high' },
    ],
    cursor: 0,
    nextCursor: 1,
    agendaTotal: 2640,
    findingsBulk: { scanScope: 'code', actionableCount: 2640 },
    findingsBulkActions: ['approved', 'rejected', 'deferred'],
  };

  it('renders Approve all N / Reject all / Defer all and proposes an apply-decision-findings intent', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: findingsChunk });
    mockCaptureReviewTurn.mockResolvedValue(dispositionAdvancesOutcome);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    const bulk = within(chunk).getByTestId('review-room-chunk-findings-bulk');
    expect(within(bulk).getByTestId('review-room-chunk-findings-approved')).toHaveTextContent(
      'Approve all 2640',
    );
    expect(within(bulk).getByTestId('review-room-chunk-findings-rejected')).toBeInTheDocument();
    expect(within(bulk).getByTestId('review-room-chunk-findings-deferred')).toBeInTheDocument();

    fireEvent.click(within(bulk).getByTestId('review-room-chunk-findings-approved'));
    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    expect(mockCaptureReviewTurn.mock.calls[0][0].capture.intent).toEqual({
      kind: 'apply-decision-findings',
      scanScope: 'code',
      action: 'approved',
    });
  });
});

describe('DiscoveryReviewRoom — disposition auto-advance + scroll; conflicts in place; terminal Save', () => {
  it('a disposition click auto-advances by appending the next chunk from the outcome AND scrolls the user message to the top', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    mockCaptureReviewTurn.mockResolvedValue(dispositionAdvancesOutcome);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    fireEvent.click(within(chunk).getByTestId('review-room-chunk-family-approved'));

    // The applied turn lands AND the next chunk auto-advances into the transcript.
    expect(await screen.findByTestId('review-room-turn-decision-applied')).toBeInTheDocument();
    await screen.findByText('CustomerEntity');
    // No off-screen confirm gate for the disposition itself.
    expect(mockConfirmReviewTurn).not.toHaveBeenCalled();
    // scrollIntoView was called on the user's last blue action message (TOP-aligned).
    const scrollSpy = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(scrollSpy).toHaveBeenCalled());
    expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ block: 'start' }));
  });

  it('a conflict resolution applies immediately and re-renders the SAME chunk in place WITHOUT advancing or scrolling', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: conflictChunk });
    mockCaptureReviewTurn.mockResolvedValue({
      kind: 'applied',
      userMessageTurn: { kind: 'user-message', text: 'Resolve framework → src-jaxrs' },
      previewTurn: null,
      appliedTurn: {
        kind: 'conflict-resolved',
        candidateId: 'cf1',
        attr: 'framework',
        chosenValue: 'JAX-RS',
        chosenSource: 'src-jaxrs',
      },
      // The SAME chunk refreshed with the conflict cleared (no pick control).
      nextChunk: { ...conflictChunk, items: [{ ...conflictChunk.items[0], conflicts: [] }] },
      advanced: false,
      terminalSaveTurn: null,
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    // The conflict pick control is present BEFORE the resolution.
    expect(
      within(chunk).getByTestId('review-room-chunk-resolve-cf1-framework-src-jaxrs'),
    ).toBeInTheDocument();

    fireEvent.click(within(chunk).getByTestId('review-room-chunk-resolve-cf1-framework-src-jaxrs'));

    // The resolution is recorded and the chunk refreshes IN PLACE: the pick control
    // is gone (the conflict cleared) and there is exactly ONE chunk (no advance).
    expect(await screen.findByTestId('review-room-turn-conflict-resolved')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByTestId('review-room-chunk-resolve-cf1-framework-src-jaxrs'),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getAllByTestId('review-room-chunk')).toHaveLength(1);
    // No scroll-advance for a conflict (only dispositions scroll).
    const scrollSpy = Element.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('a disposition that exhausts the agenda appends the terminal Save; clicking "Yes, save" triggers the save-all effect via /confirm', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    mockCaptureReviewTurn.mockResolvedValue(dispositionExhaustsOutcome);
    mockConfirmReviewTurn.mockResolvedValue({
      kind: 'applied',
      appliedTurn: { kind: 'saved', savedCount: 123 },
    });
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    fireEvent.click(within(chunk).getByTestId('review-room-chunk-family-approved'));

    // The terminal Save Yes/No surfaces (the ONLY surviving confirm gate).
    const save = await screen.findByTestId('review-room-pending-confirmation');
    const yes = within(save).getByTestId('review-room-confirm-apply');
    expect(yes).toHaveTextContent('Yes, save');
    expect(within(save).getByTestId('review-room-confirm-dismiss')).toBeInTheDocument();

    // The model is read on open + after the disposition; clear to assert the
    // post-save re-read distinctly.
    mockGetReviewModelCounts.mockClear();

    fireEvent.click(yes);

    await waitFor(() => expect(mockConfirmReviewTurn).toHaveBeenCalledTimes(1));
    const confirmArg = mockConfirmReviewTurn.mock.calls[0][0];
    expect(confirmArg.pendingId).toBe('pending-save');
    expect(confirmArg.intent.kind).toBe('save');
    expect(confirmArg.confirmation).toEqual({ kind: 'click' });
    // The saved turn lands + the counts are re-read.
    expect(await screen.findByTestId('review-room-turn-saved')).toBeInTheDocument();
    await waitFor(() => expect(mockGetReviewModelCounts).toHaveBeenCalledTimes(1));
  });

  it('the terminal Save "No" is a no-op: it dismisses the gate and fires NO /confirm write', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    mockCaptureReviewTurn.mockResolvedValue(dispositionExhaustsOutcome);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');
    fireEvent.click(within(chunk).getByTestId('review-room-chunk-family-approved'));

    const save = await screen.findByTestId('review-room-pending-confirmation');
    fireEvent.click(within(save).getByTestId('review-room-confirm-dismiss'));

    // "No" dismissed the gate — no save fired, and the confirm button is gone.
    await waitFor(() =>
      expect(screen.queryByTestId('review-room-confirm-apply')).not.toBeInTheDocument(),
    );
    expect(mockConfirmReviewTurn).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Family chunk rendering (parent + indented children + the per-row controls).
// ===========================================================================

describe('DiscoveryReviewRoom — family chunk rendering', () => {
  it('renders a family chunk as parent + indented children with the family-level bulk control PLUS the per-row controls', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');

    // The family-level bulk control offers all four family buttons.
    const familyBulk = within(chunk).getByTestId('review-room-chunk-family-bulk');
    expect(within(familyBulk).getByTestId('review-room-chunk-family-approved')).toBeInTheDocument();
    expect(within(familyBulk).getByTestId('review-room-chunk-family-rejected')).toBeInTheDocument();
    expect(within(familyBulk).getByTestId('review-room-chunk-family-deferred')).toBeInTheDocument();

    // The parent is NOT indented; both children ARE (data-family-child marks them).
    expect(within(chunk).getByTestId('review-room-chunk-item-fam-parent')).not.toHaveAttribute(
      'data-family-child',
    );
    expect(within(chunk).getByTestId('review-room-chunk-item-fam-child-a')).toHaveAttribute(
      'data-family-child',
      'true',
    );
    expect(within(chunk).getByTestId('review-room-chunk-item-fam-child-b')).toHaveAttribute(
      'data-family-child',
      'true',
    );

    // Every row STILL carries the always-on per-row Approve/Reject/Defer controls.
    expect(within(chunk).getByTestId('review-room-chunk-approved-fam-parent')).toBeInTheDocument();
    expect(within(chunk).getByTestId('review-room-chunk-approved-fam-child-a')).toBeInTheDocument();
    expect(within(chunk).getByTestId('review-room-chunk-rejected-fam-child-b')).toBeInTheDocument();
  });

  it('a per-row Approve on a family member applies IMMEDIATELY (kind:"applied") with NO confirm box and re-reads the counts', async () => {
    mockStartReview.mockResolvedValue({ ...startResponse, firstChunk: familyChunk });
    mockCaptureReviewTurn.mockResolvedValue({
      kind: 'applied',
      userMessageTurn: { kind: 'user-message', text: 'Approve OrderEntity' },
      previewTurn: {
        kind: 'preview',
        action: 'approved',
        totalCandidates: 1,
        seedCandidates: 1,
        cascadedCandidates: 0,
        totalFindings: 0,
        runTotalCandidates: 40,
        runTotalFindings: 9,
      },
      appliedTurn: {
        kind: 'decision-applied',
        action: 'approved',
        candidateIds: ['fam-parent'],
        findingIds: [],
        appliedCandidateCount: 1,
        appliedFindingCount: 0,
      },
      nextChunk: null,
      advanced: true,
      terminalSaveTurn: null,
    } satisfies ReviewTurnOutcomeWire);
    await openRoomAndStart();

    const chunk = await screen.findByTestId('review-room-chunk');

    // The model is read ONCE on open; clear so we can assert the post-write re-read.
    mockGetReviewModelCounts.mockClear();

    fireEvent.click(within(chunk).getByTestId('review-room-chunk-approved-fam-parent'));

    await waitFor(() => expect(mockCaptureReviewTurn).toHaveBeenCalledTimes(1));
    // The applied turn lands in the transcript WITHOUT a confirm gate.
    expect(await screen.findByTestId('review-room-turn-decision-applied')).toBeInTheDocument();
    expect(screen.queryByTestId('review-room-pending-confirmation')).not.toBeInTheDocument();
    expect(screen.queryByTestId('review-room-confirm-apply')).not.toBeInTheDocument();
    // No SECOND write -- the click WAS the confirmation (no /confirm round-trip).
    expect(mockConfirmReviewTurn).not.toHaveBeenCalled();
    // Re-read-after-write keeps the authoritative counts current.
    await waitFor(() => expect(mockGetReviewModelCounts).toHaveBeenCalledTimes(1));
  });
});
