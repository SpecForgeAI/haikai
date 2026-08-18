/**
 * Postman import RUN orchestration tests (Spec 2026-06-23 Import a Postman
 * Collection into Capture -- Task Group 8.1).
 *
 * Focused coverage of the two entry points' critical behaviours:
 *
 *   (a) the wizard run-mode selector offers all three modes (LLM only /
 *       Postman + LLM delta / Postman only) and Mode 1a (LLM only) hides the
 *       Postman upload entirely (today's behaviour unchanged);
 *   (b) the send-selection rules: a matched+supported item sends; an unmatched
 *       item only sends once KEPT; a `staged`/`deleted`/`pending` item never
 *       sends; an unsupported-body item never sends;
 *   (c) `buildManualCaptureRequest` maps an item -> the camelCase
 *       `ManualCaptureRequest` body (operationId from the operation row, the
 *       resolved concrete path, query/headers/body passthrough);
 *   (d) the Mode 1b captured-by-op builder classifies the REAL response status
 *       and keys on operation_id;
 *   (e) the shared run hook fires `manualCapture` for sendable items and, on a
 *       409 `SECRETS_NOT_LOADED`, PAUSES the run + flags `secretsRequired` so
 *       the caller can prompt re-enter-secrets before the rest send.
 *
 * The CSS module is proxied so class names equal their keys (testid selectors).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return { ...actual, manualCapture: vi.fn() };
});

// The discovery client is imported by the wizard step (the "Add to architecture"
// seam); stub it so the selector render does not pull a real fetch.
vi.mock('../../api/discoveryApi', () => ({
  stageImportedDiscoveryCandidate: vi.fn(),
}));

vi.mock('./PostmanImportWizardStep.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./PostmanImportStaging.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./PostmanImportArchMatchStep.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

import {
  manualCapture,
  ApiBehaviourApiError,
  type ApiBehaviourOperationDto,
  type InventoryReconciliationResponse,
} from '../../api/apiBehaviourClient';
import type { ImportedRequest } from '../../utils/postmanImport';
import type { StagedImportItem } from './postmanImportStagingSupport';
import {
  modeUsesPostman,
  modeRunsLlm,
  isItemSendable,
  sendableItems,
  buildManualCaptureRequest,
  classifyStatus,
  addCaptured,
} from './postmanImportRunSupport';
import { usePostmanImportRun } from './usePostmanImportRun';
import { PostmanImportWizardStep } from './PostmanImportWizardStep';

const mockedManualCapture = vi.mocked(manualCapture);

function imported(
  partial: Partial<ImportedRequest> & Pick<ImportedRequest, 'method' | 'path'>,
): ImportedRequest {
  return {
    query: {},
    headers: {},
    body: null,
    sourceItemName: 'Imported request',
    ...partial,
  };
}

function operation(
  partial: Partial<ApiBehaviourOperationDto> &
    Pick<ApiBehaviourOperationDto, 'id' | 'method' | 'path'>,
): ApiBehaviourOperationDto {
  return {
    session_id: 'session-1',
    operation_id: null,
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: '',
    updated_at: '',
    ...partial,
  };
}

function staged(
  index: number,
  archStatus: StagedImportItem['archStatus'],
  request: ImportedRequest,
  op: ApiBehaviourOperationDto | null,
): StagedImportItem {
  return {
    index,
    request,
    operation: op,
    archStatus,
    runnable: archStatus === 'matched' && request.unsupportedReason === undefined,
  };
}

beforeEach(() => {
  mockedManualCapture.mockReset();
});

describe('postman import run mode helpers (8.1)', () => {
  it('classifies the three run modes for Postman usage + LLM loop', () => {
    expect(modeUsesPostman('llm')).toBe(false);
    expect(modeUsesPostman('postman-delta')).toBe(true);
    expect(modeUsesPostman('postman-only')).toBe(true);
    // Mode 1a + 1b run the LLM loop; 1c does not.
    expect(modeRunsLlm('llm')).toBe(true);
    expect(modeRunsLlm('postman-delta')).toBe(true);
    expect(modeRunsLlm('postman-only')).toBe(false);
  });
});

describe('send selection rules (8.1 b)', () => {
  const matchedOp = operation({ id: 'op-1', method: 'GET', path: '/widgets' });
  const matchedItem = staged(
    0,
    'matched',
    imported({ method: 'GET', path: '/widgets' }),
    matchedOp,
  );
  const unmatchedItem = staged(
    1,
    'unmatched',
    imported({ method: 'POST', path: '/legacy' }),
    operation({ id: 'op-2', method: 'POST', path: '/legacy' }),
  );
  const unsupportedItem = staged(
    2,
    'matched',
    imported({
      method: 'POST',
      path: '/widgets',
      unsupportedReason: 'non-json body',
    }),
    matchedOp,
  );

  it('sends a matched supported item but never an unsupported-body item', () => {
    expect(isItemSendable(matchedItem, {})).toBe(true);
    expect(isItemSendable(unsupportedItem, {})).toBe(false);
  });

  it('only sends an unmatched item once KEPT (not staged/deleted/pending)', () => {
    expect(isItemSendable(unmatchedItem, {})).toBe(false); // pending
    expect(isItemSendable(unmatchedItem, { 1: 'staged' })).toBe(false);
    expect(isItemSendable(unmatchedItem, { 1: 'deleted' })).toBe(false);
    expect(isItemSendable(unmatchedItem, { 1: 'kept' })).toBe(true);
  });

  it('sendableItems returns the ordered runnable subset', () => {
    const all = [matchedItem, unmatchedItem, unsupportedItem];
    expect(sendableItems(all, { 1: 'kept' }).map((s) => s.index)).toEqual([0, 1]);
    expect(sendableItems(all, {}).map((s) => s.index)).toEqual([0]);
  });
});

describe('manual-capture body mapping (8.1 c)', () => {
  it('maps an item -> the camelCase ManualCaptureRequest addressed by the operation ROW UUID', () => {
    const op = operation({
      id: 'row-1',
      operation_id: 'getWidget',
      method: 'GET',
      path: '/widgets/42',
    });
    const item = staged(
      0,
      'matched',
      imported({
        method: 'GET',
        path: '/widgets/42',
        query: { verbose: 'true' },
        headers: { 'X-Trace': 'abc' },
        body: { a: 1 },
      }),
      op,
    );
    const body = buildManualCaptureRequest(item, op, {
      mutatingCallsConfirmed: true,
    });
    expect(body).toEqual({
      // The ROW UUID — the manual-capture route's canonical identifier
      // (2026-07-26 fix: sending the OAS operation_id string 404'd every
      // live Postman replay with "Operation ... was not found").
      operationId: 'row-1',
      method: 'GET',
      path: '/widgets/42',
      query: { verbose: 'true' },
      headers: { 'X-Trace': 'abc' },
      body: { a: 1 },
      mutatingCallsConfirmed: true,
    });
  });
});

describe('Mode 1b captured-by-op builder (8.1 d)', () => {
  it('classifies the real status class and keys on operation_id', () => {
    expect(classifyStatus(200)).toBe('success');
    expect(classifyStatus(404)).toBe('not_found');
    expect(classifyStatus(422)).toBe('client_error');
    expect(classifyStatus(500)).toBeNull();

    let map: Record<string, { method: string; path: string; expectedStatus: string | null }[]> = {};
    map = addCaptured(map, 'getWidget', {
      method: 'GET',
      path: '/widgets/42',
      expectedStatus: 'success',
    });
    map = addCaptured(map, 'getWidget', {
      method: 'GET',
      path: '/widgets/none',
      expectedStatus: 'not_found',
    });
    expect(map.getWidget).toHaveLength(2);
    expect(map.getWidget[1].expectedStatus).toBe('not_found');
  });
});

describe('usePostmanImportRun send loop (8.1 e)', () => {
  const op = operation({
    id: 'row-1',
    operation_id: 'getWidget',
    method: 'GET',
    path: '/widgets',
  });
  const importedRequests = [imported({ method: 'GET', path: '/widgets' })];
  const reconciliation = {
    operations_without_model_endpoint: [],
  } as unknown as InventoryReconciliationResponse;

  it('fires manualCapture for a matched item and records the captured status', async () => {
    mockedManualCapture.mockResolvedValue({
      sessionId: 's',
      scenarioId: 'sc',
      capture: { response_status: 200 } as never,
    });
    const { result } = renderHook(() =>
      usePostmanImportRun({
        projectId: 'p',
        architectureId: 'a',
        sessionId: 's',
        importedRequests,
        operations: [op],
        reconciliation,
      }),
    );
    let outcome: { allSent: boolean; secretsRequired: boolean; capturedByOp: Record<string, unknown[]> } | undefined;
    await act(async () => {
      outcome = await result.current.runSends();
    });
    expect(mockedManualCapture).toHaveBeenCalledTimes(1);
    expect(outcome?.allSent).toBe(true);
    expect(outcome?.secretsRequired).toBe(false);
    expect(outcome?.capturedByOp.getWidget).toHaveLength(1);
  });

  it('pauses + flags secretsRequired on a 409 SECRETS_NOT_LOADED', async () => {
    mockedManualCapture.mockRejectedValue(
      new ApiBehaviourApiError(409, { code: 'SECRETS_NOT_LOADED', message: 'no secrets' }),
    );
    const { result } = renderHook(() =>
      usePostmanImportRun({
        projectId: 'p',
        architectureId: 'a',
        sessionId: 's',
        importedRequests,
        operations: [op],
        reconciliation,
      }),
    );
    let outcome: { secretsRequired: boolean } | undefined;
    await act(async () => {
      outcome = await result.current.runSends();
    });
    expect(outcome?.secretsRequired).toBe(true);
    await waitFor(() => expect(result.current.secretsRequired).toBe(true));
  });
});

describe('wizard capture-sources selector (8.1 a; CSD Spec 6 multi-select)', () => {
  function renderSelector(
    mode: 'llm' | 'postman-delta' | 'postman-only',
    opts?: { logSelected?: boolean; onModeChange?: (m: string) => void },
  ) {
    return render(
      <PostmanImportWizardStep
        projectId="p"
        architectureId="a"
        sessionId="s"
        mode={mode}
        onModeChange={(m) => opts?.onModeChange?.(m)}
        importedRequests={[]}
        onImportedRequestsChange={() => {}}
        operations={[]}
        reconciliation={null}
        flagged={[]}
        resolutions={{}}
        onResolutionChange={() => {}}
        onOperationAdded={() => {}}
        onDeleteItem={() => {}}
        logSelected={opts?.logSelected ?? false}
        onLogSelectedChange={() => {}}
        logSectionSlot={<div data-testid="log-section-slot" />}
      />,
    );
  }

  it('offers the three capture sources as checkboxes', () => {
    renderSelector('llm');
    expect(screen.getByTestId('capture-source-llm')).toBeTruthy();
    expect(screen.getByTestId('capture-source-postman')).toBeTruthy();
    expect(screen.getByTestId('capture-source-log')).toBeTruthy();
  });

  it('derives postman-delta when Postman is ticked alongside LLM', () => {
    const seen: string[] = [];
    renderSelector('llm', { onModeChange: (m) => seen.push(m) });
    const postmanBox = screen
      .getByTestId('capture-source-postman')
      .querySelector('input') as HTMLInputElement;
    postmanBox.click();
    expect(seen).toEqual(['postman-delta']);
  });

  it('LLM-only hides the Postman upload (today behaviour unchanged)', () => {
    renderSelector('llm');
    expect(screen.queryByTestId('postman-import-wizard-file')).toBeNull();
  });

  it('a Postman mode reveals the collection upload', () => {
    renderSelector('postman-delta');
    expect(screen.getByTestId('postman-import-wizard-file')).toBeTruthy();
  });

  it('selecting the Application log source reveals the log section slot', () => {
    renderSelector('llm', { logSelected: true });
    expect(screen.getByTestId('log-section-slot')).toBeTruthy();
  });
});
