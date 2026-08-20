/**
 * StructuralModelTab tests (SCL pipeline spec 6, 2026-08-18 — "UI placement"
 * ruling: corpus browser + reachability report + explain-this).
 *
 * Self-contained: the whole `sclCorpusApi` module is mocked (vi.importActual
 * spread keeps the REAL `normalizeSignals` + error class). Pins:
 *
 *   (a) never-scanned (latest scan null) → the quiet banner;
 *   (b) the scan status card renders the key stats + annotation summary;
 *   (c) the browser lists contracts (bodiless fetch) and opens a
 *       behaviour-table detail with rows; a call-link navigates to the target
 *       contract (second getContract call with the target key);
 *   (d) the reachability disposition select fires the PATCH and updates
 *       optimistically (plus rollback on PATCH failure);
 *   (e) the Explain button renders the returned prose;
 *   (f) parseErrors > 0 renders the LOUD amber completeness warning.
 */

import { it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../api/sclCorpusApi', async () => {
  const actual = await vi.importActual<typeof import('../../../api/sclCorpusApi')>(
    '../../../api/sclCorpusApi',
  );
  return {
    ...actual,
    getLatestScan: vi.fn(),
    listContracts: vi.fn(),
    getContract: vi.fn(),
    listReachability: vi.fn(),
    patchReachabilityDisposition: vi.fn(),
    explainContract: vi.fn(),
  };
});

import {
  explainContract,
  getContract,
  getLatestScan,
  listContracts,
  listReachability,
  patchReachabilityDisposition,
  type SclContract,
  type SclReachabilityItem,
  type SclScan,
} from '../../../api/sclCorpusApi';
import { StructuralModelTab } from './StructuralModelTab';

const getLatestScanMock = vi.mocked(getLatestScan);
const listContractsMock = vi.mocked(listContracts);
const getContractMock = vi.mocked(getContract);
const listReachabilityMock = vi.mocked(listReachability);
const patchDispositionMock = vi.mocked(patchReachabilityDisposition);
const explainContractMock = vi.mocked(explainContract);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SCAN: SclScan = {
  id: 'scan-1',
  status: 'completed',
  created_at: '2026-08-18T10:00:00Z',
  stats_json: {
    rootCount: 5,
    externalRootCount: 3,
    internalRootCount: 2,
    contractCount: 40,
    reachableContractCount: 38,
    unreachableClassCount: 4,
    unresolvedCallCount: 0,
    findingCounts: { dispatch_ambiguity: 1 },
    findings: [
      { kind: 'dispatch_ambiguity', symbol: 'Foo#bar', detail: '2 DI implementations' },
    ],
    parseErrors: [],
    inlined: 3,
    scl_annotation: {
      annotated: 10,
      skipped_already_glossed: 1,
      rejected: 0,
      guard_rejections: 2,
      baseline_available: true,
      contradictions: [
        {
          kind: 'capture_contradiction',
          detail: 'capture shows 5xx but mined behaviour has no failure outcome',
          contract_key: 'T-aaa111222333',
          symbol: 'LegacyResource#getView',
        },
      ],
      findings: [],
      completed_at: '2026-08-18T11:00:00Z',
    },
  },
};

const LIST_ROW_TABLE: SclContract = {
  contract_key: 'T-aaa111222333',
  kind: 'behaviour_table',
  source_path: 'src/main/java/LegacyResource.java',
  source_symbol: 'LegacyResource#getView',
  fan_in: 2,
  roots_json: { roots: ['LegacyResource#getView'], total: 2, reachable: true },
  body_json: null,
  gloss_json: null,
};

const LIST_ROW_SHAPE: SclContract = {
  contract_key: 'S-bbb111222333',
  kind: 'shape',
  source_path: 'src/main/java/ViewDto.java',
  source_symbol: 'ViewDto',
  fan_in: 5,
  roots_json: { roots: [], total: 0, reachable: false },
  body_json: null,
  gloss_json: null,
};

const DETAIL_TABLE: SclContract = {
  ...LIST_ROW_TABLE,
  body_json: {
    symbol: 'LegacyResource#getView',
    sourcePath: 'src/main/java/LegacyResource.java',
    startLine: 40,
    signatureInputs: [{ name: 'viewId', typeRef: 'String' }],
    outcomeSignature: [
      { label: 'not-found', kind: 'throws' },
      { label: 'view', kind: 'value' },
    ],
    rows: [
      {
        index: 0,
        kind: 'branch',
        conditionVerbatim: 'view == null',
        conditionRef: { path: 'src/main/java/LegacyResource.java', line: 42 },
        outcome: {
          type: 'terminal',
          verbatim: 'throw new NotFoundException()',
          ref: { path: 'src/main/java/LegacyResource.java', line: 43 },
          outcomeLabel: 'not-found',
        },
      },
      {
        index: 1,
        kind: 'terminal',
        conditionVerbatim: null,
        conditionRef: null,
        outcome: {
          type: 'call',
          targetKey: 'T-ccc111222333',
          targetSymbol: 'ViewMapper#toDto',
        },
      },
    ],
    annotations: ['@GET', '@Path("/views/{viewId}")'],
    references: ['T-ccc111222333'],
  },
  gloss_json: {
    intent: 'Returns the requested view.',
    row_glosses: { '0': '404 when the view is missing' },
  },
};

const DETAIL_CALL_TARGET: SclContract = {
  contract_key: 'T-ccc111222333',
  kind: 'behaviour_table',
  source_path: 'src/main/java/ViewMapper.java',
  source_symbol: 'ViewMapper#toDto',
  fan_in: 3,
  roots_json: { roots: [], total: 3, reachable: true },
  body_json: {
    symbol: 'ViewMapper#toDto',
    sourcePath: 'src/main/java/ViewMapper.java',
    startLine: 10,
    signatureInputs: [],
    outcomeSignature: [{ label: 'dto', kind: 'value' }],
    rows: [
      {
        index: 0,
        kind: 'terminal',
        conditionVerbatim: null,
        conditionRef: null,
        outcome: {
          type: 'terminal',
          verbatim: 'return dto',
          ref: { path: 'src/main/java/ViewMapper.java', line: 12 },
          outcomeLabel: 'dto',
        },
      },
    ],
    annotations: [],
    references: [],
  },
  gloss_json: null,
};

const REACHABILITY_ITEM: SclReachabilityItem = {
  id: 'item-1',
  source_path: 'src/main/java/Orphan.java',
  symbol: 'com.example.Orphan',
  signals_json: ['has_main', 'annotation:@Scheduled'],
  disposition: null,
};

function primeHappyMocks() {
  getLatestScanMock.mockResolvedValue(SCAN);
  listContractsMock.mockResolvedValue([LIST_ROW_TABLE, LIST_ROW_SHAPE]);
  getContractMock.mockImplementation(async (_p, _a, _s, contractKey) => {
    if (contractKey === 'T-aaa111222333') return DETAIL_TABLE;
    if (contractKey === 'T-ccc111222333') return DETAIL_CALL_TARGET;
    throw new Error(`unexpected contract ${contractKey}`);
  });
  listReachabilityMock.mockResolvedValue([REACHABILITY_ITEM]);
  patchDispositionMock.mockResolvedValue({ ...REACHABILITY_ITEM, disposition: 'dead_code' });
  explainContractMock.mockResolvedValue('This endpoint returns a view or throws not-found.');
}

function renderTab() {
  return render(<StructuralModelTab projectId="p1" architectureId="a1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  primeHappyMocks();
});

// ---------------------------------------------------------------------------
// (a) never scanned
// ---------------------------------------------------------------------------

it('renders the quiet "No structural scan yet" banner when the latest scan is null', async () => {
  getLatestScanMock.mockResolvedValue(null);

  renderTab();

  expect(await screen.findByTestId('structural-model-no-scan')).toHaveTextContent(
    'No structural scan yet',
  );
  expect(listContractsMock).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// (b) status card stats
// ---------------------------------------------------------------------------

it('renders the scan status card with key stats + the annotation summary', async () => {
  renderTab();

  expect(await screen.findByTestId('structural-model-status-badge')).toHaveTextContent(
    'completed',
  );
  expect(screen.getByTestId('stat-roots')).toHaveTextContent('3 external / 2 internal');
  expect(screen.getByTestId('stat-contracts')).toHaveTextContent('38 / 40 reachable');
  expect(screen.getByTestId('stat-unreachable-classes')).toHaveTextContent('4');
  expect(screen.getByTestId('stat-unresolved-calls')).toHaveTextContent('0');
  expect(screen.getByTestId('structural-model-annotation-summary')).toHaveTextContent(
    '10 annotated',
  );
  expect(screen.getByTestId('structural-model-annotation-summary')).toHaveTextContent(
    '1 contradictions',
  );
  // Clean scan (no parse errors, no unresolved calls) → NO amber warnings.
  expect(screen.queryByTestId('warning-parse-errors')).toBeNull();
  expect(screen.queryByTestId('warning-unresolved-calls')).toBeNull();
  // Annotation summary present → the pending line must NOT render.
  expect(screen.queryByTestId('structural-model-annotation-pending')).toBeNull();
});

it('renders an explicit annotation-pending line when a completed scan has no merged summary (2026-08-20)', async () => {
  const { scl_annotation: _dropped, ...statsWithoutAnnotation } =
    SCAN.stats_json as Record<string, unknown> & { scl_annotation: unknown };
  getLatestScanMock.mockResolvedValue({
    ...SCAN,
    stats_json: statsWithoutAnnotation,
  } as SclScan);

  renderTab();

  expect(
    await screen.findByTestId('structural-model-annotation-pending'),
  ).toHaveTextContent('Annotation: not yet merged');
  expect(screen.queryByTestId('structural-model-annotation-summary')).toBeNull();
});

// ---------------------------------------------------------------------------
// (c) browser + detail + call-link navigation
// ---------------------------------------------------------------------------

it('lists contracts (bodiless), opens a behaviour-table detail, and navigates via a call-link', async () => {
  renderTab();

  // The listing is fetched WITHOUT bodies.
  const row = await screen.findByTestId('contract-row-T-aaa111222333');
  expect(listContractsMock).toHaveBeenCalledWith(
    'p1',
    'a1',
    'scan-1',
    expect.objectContaining({ includeBody: false }),
  );
  // The unreachable shape row renders dimmed with its tag.
  expect(screen.getByTestId('contract-row-S-bbb111222333')).toHaveTextContent('unreachable');

  // Open the detail.
  fireEvent.click(row);
  expect(await screen.findByTestId('contract-detail')).toBeInTheDocument();
  expect(getContractMock).toHaveBeenCalledTimes(1);
  expect(getContractMock).toHaveBeenCalledWith('p1', 'a1', 'scan-1', 'T-aaa111222333');

  // Intent + rows render with verbatim condition, cite, and the row gloss.
  expect(screen.getByTestId('contract-detail-intent')).toHaveTextContent(
    'Returns the requested view.',
  );
  const row0 = screen.getByTestId('behaviour-row-0');
  expect(row0).toHaveTextContent('view == null');
  expect(row0).toHaveTextContent('src/main/java/LegacyResource.java:42');
  expect(row0).toHaveTextContent('throw new NotFoundException()');
  expect(row0).toHaveTextContent('not-found');
  expect(row0).toHaveTextContent('404 when the view is missing');

  // The call row links to the target contract; clicking navigates the browser
  // to it — the SECOND getContract call carries the target key.
  const callLink = screen.getByTestId('call-link-T-ccc111222333');
  expect(callLink).toHaveTextContent('ViewMapper#toDto');
  fireEvent.click(callLink);

  await waitFor(() => expect(getContractMock).toHaveBeenCalledTimes(2));
  expect(getContractMock).toHaveBeenLastCalledWith('p1', 'a1', 'scan-1', 'T-ccc111222333');
  await waitFor(() =>
    expect(screen.getByTestId('behaviour-row-0')).toHaveTextContent('return dto'),
  );
});

// ---------------------------------------------------------------------------
// (d) reachability disposition PATCH + optimistic update (+ rollback)
// ---------------------------------------------------------------------------

it('fires the disposition PATCH and updates the select optimistically', async () => {
  renderTab();

  expect(await screen.findByTestId('reachability-count')).toHaveTextContent('1 item');
  fireEvent.click(screen.getByTestId('reachability-toggle'));

  const select = await screen.findByTestId('disposition-select-item-1');
  // The generic signal chips render from the raw-array signals_json.
  expect(screen.getByTestId('reachability-row-item-1')).toHaveTextContent('has_main');

  fireEvent.change(select, { target: { value: 'dead_code' } });

  // Optimistic: the select reflects the verdict immediately.
  expect((select as HTMLSelectElement).value).toBe('dead_code');
  await waitFor(() =>
    expect(patchDispositionMock).toHaveBeenCalledWith('p1', 'a1', 'item-1', 'dead_code'),
  );
});

it('rolls the optimistic update back and surfaces the error when the PATCH fails', async () => {
  patchDispositionMock.mockRejectedValue(new Error('AMS unavailable'));

  renderTab();
  fireEvent.click(await screen.findByTestId('reachability-toggle'));
  const select = await screen.findByTestId('disposition-select-item-1');

  fireEvent.change(select, { target: { value: 'missed_entrypoint' } });
  expect((select as HTMLSelectElement).value).toBe('missed_entrypoint');

  // Rollback to open + inline error once the PATCH rejects.
  await waitFor(() => expect((select as HTMLSelectElement).value).toBe(''));
  expect(screen.getByTestId('disposition-error-item-1')).toHaveTextContent('AMS unavailable');
});

// ---------------------------------------------------------------------------
// (e) explain
// ---------------------------------------------------------------------------

it('renders the explain prose after clicking the Explain button', async () => {
  renderTab();

  fireEvent.click(await screen.findByTestId('contract-row-T-aaa111222333'));
  const explainButton = await screen.findByTestId('explain-button');
  fireEvent.click(explainButton);

  expect(await screen.findByTestId('explain-output')).toHaveTextContent(
    'This endpoint returns a view or throws not-found.',
  );
  expect(explainContractMock).toHaveBeenCalledWith('p1', 'a1', 'scan-1', 'T-aaa111222333');
});

// ---------------------------------------------------------------------------
// (f) loud completeness warning
// ---------------------------------------------------------------------------

it('renders the LOUD amber parse-error warning when parseErrors > 0', async () => {
  getLatestScanMock.mockResolvedValue({
    ...SCAN,
    stats_json: {
      ...SCAN.stats_json,
      parseErrors: [{ path: 'A.java' }, { path: 'B.java' }],
      unresolvedCallCount: 7,
    },
  });

  renderTab();

  const warning = await screen.findByTestId('warning-parse-errors');
  expect(warning).toHaveTextContent('2 files failed to parse');
  expect(warning).toHaveTextContent('INCOMPLETE');
  expect(warning).toHaveAttribute('role', 'alert');
  // The unresolved-calls warning is independent and ALSO loud.
  expect(screen.getByTestId('warning-unresolved-calls')).toHaveTextContent(
    '7 unresolved calls',
  );
});

// ---------------------------------------------------------------------------
// Findings section (flat list: slice findings + annotation contradictions)
// ---------------------------------------------------------------------------

it('renders slice findings + annotation contradictions as one flat list', async () => {
  renderTab();

  expect(await screen.findByTestId('findings-count')).toHaveTextContent('2');
  fireEvent.click(screen.getByTestId('findings-toggle'));

  const items = await screen.findAllByTestId('finding-item');
  expect(items).toHaveLength(2);
  expect(items[0]).toHaveTextContent('dispatch_ambiguity');
  expect(items[0]).toHaveTextContent('2 DI implementations');
  expect(items[0]).toHaveTextContent('Foo#bar');
  expect(items[1]).toHaveTextContent('capture_contradiction');
  expect(items[1]).toHaveTextContent('LegacyResource#getView');
});
