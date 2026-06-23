/**
 * PostmanImportAppendModal end-to-end (Mode 2) tests
 *
 * Spec 2026-06-23 Import a Postman Collection into Capture -- Task Group 9.3,
 * gaps (ii) + (iii). These cover the two highest-value END-TO-END Mode 2 chains
 * that the per-group tests only exercised at the helper/hook level:
 *
 *   (ii) Mode 2 append on a FINISHED session through the re-enter-secrets step:
 *        upload -> append fires `manualCapture` -> the live send 409s
 *        SECRETS_NOT_LOADED (secrets purged on a finished run) -> the modal
 *        surfaces the re-enter-secrets prompt AND defers to the parent's
 *        `onRequestReenterSecrets`; a retry after re-entry succeeds and the
 *        capture lands.
 *
 *  (iii) an UNMATCHED item routed to the arch-match step -> "Add to architecture"
 *        invokes the REAL `stageImportedDiscoveryCandidate` discovery client
 *        (POST to the stage-imported-candidate path) -- a DISCOVERY CANDIDATE,
 *        never a direct committed-architecture write (no createEndpoint /
 *        addOperation on that path).
 *
 * Strategy: `vi.mock` with the `vi.importActual` spread so the REAL
 * `ApiBehaviourApiError` + `isSecretsNotLoadedError` are used while the network
 * clients are spies; `discoveryApi` is fully mocked (its only consumer here is
 * the staging seam). CSS modules proxied so class names equal their keys.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from '@testing-library/react';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return {
    ...actual,
    listOperations: vi.fn(),
    reconcileInventory: vi.fn(),
    manualCapture: vi.fn(),
    addOperation: vi.fn(),
  };
});

vi.mock('../../api/discoveryApi', () => ({
  stageImportedDiscoveryCandidate: vi.fn(),
}));

vi.mock('./PostmanImportAppendModal.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./PostmanImportStaging.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));
vi.mock('./PostmanImportArchMatchStep.module.css', () => ({
  default: new Proxy({}, { get: (_t: object, p: string | symbol) => String(p) }),
}));

import {
  listOperations,
  reconcileInventory,
  manualCapture,
  addOperation,
  ApiBehaviourApiError,
  type ApiBehaviourOperationDto,
  type InventoryReconciliationResponse,
} from '../../api/apiBehaviourClient';
import { stageImportedDiscoveryCandidate } from '../../api/discoveryApi';
import { PostmanImportAppendModal } from './PostmanImportAppendModal';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const SESSION_ID = 'session-1';

const mockedListOperations = vi.mocked(listOperations);
const mockedReconcile = vi.mocked(reconcileInventory);
const mockedManualCapture = vi.mocked(manualCapture);
const mockedAddOperation = vi.mocked(addOperation);
const mockedStageCandidate = vi.mocked(stageImportedDiscoveryCandidate);

function operationRow(
  partial: Partial<ApiBehaviourOperationDto> &
    Pick<ApiBehaviourOperationDto, 'id' | 'method' | 'path'>,
): ApiBehaviourOperationDto {
  return {
    session_id: SESSION_ID,
    operation_id: null,
    summary: null,
    description: null,
    included: true,
    safe_to_execute: true,
    request_schema_json: null,
    response_schema_json: null,
    oas_operation_json: null,
    created_at: '2026-06-23T00:00:00Z',
    updated_at: '2026-06-23T00:00:00Z',
    ...partial,
  };
}

function reconciliation(
  overrides: Partial<InventoryReconciliationResponse> = {},
): InventoryReconciliationResponse {
  return {
    operations_without_model_endpoint: [],
    ...(overrides as Record<string, unknown>),
  } as unknown as InventoryReconciliationResponse;
}

/** A Postman collection with one item that maps to the session's matched op. */
function matchedCollectionJson(): string {
  return JSON.stringify({
    info: { name: 'C', schema: 'v2.1' },
    item: [
      {
        name: 'Get widget',
        request: { method: 'get', url: { path: ['widgets', '42'] } },
      },
    ],
  });
}

/** A collection whose only item maps to NO session operation (unmatched). */
function unmatchedCollectionJson(): string {
  return JSON.stringify({
    info: { name: 'C', schema: 'v2.1' },
    item: [
      {
        name: 'List ghosts',
        request: { method: 'get', url: { path: ['ghosts'] } },
      },
    ],
  });
}

async function uploadCollection(json: string): Promise<void> {
  const input = screen.getByTestId('postman-import-append-file') as HTMLInputElement;
  // jsdom's File does not implement Blob.text() against the constructor parts,
  // so attach a working `.text()` for the modal's `await file.text()` read. The
  // rest of the chain (parse -> stage -> arch-match -> send) is the real code.
  const file = new File([json], 'collection.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => json });
  await act(async () => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

beforeEach(() => {
  mockedListOperations.mockReset();
  mockedReconcile.mockReset();
  mockedManualCapture.mockReset();
  mockedAddOperation.mockReset();
  mockedStageCandidate.mockReset();
});

describe('PostmanImportAppendModal -- Mode 2 re-enter-secrets (gap ii)', () => {
  it('on a finished session 409 SECRETS_NOT_LOADED prompts re-enter-secrets, then a retry captures', async () => {
    const matchedOp = operationRow({
      id: 'op-row-1',
      operation_id: 'getWidget',
      method: 'GET',
      path: '/widgets/42',
    });
    mockedListOperations.mockResolvedValue([matchedOp]);
    mockedReconcile.mockResolvedValue(reconciliation());

    // First send: secrets purged (finished session) -> 409 SECRETS_NOT_LOADED.
    // Retry: the real current response is captured.
    mockedManualCapture
      .mockRejectedValueOnce(
        new ApiBehaviourApiError(409, {
          code: 'SECRETS_NOT_LOADED',
          message: 'no secrets',
        }),
      )
      .mockResolvedValueOnce({
        sessionId: SESSION_ID,
        scenarioId: 'sc-1',
        capture: { response_status: 200 } as never,
      });

    const onRequestReenterSecrets = vi.fn();
    const onAppended = vi.fn();

    render(
      <PostmanImportAppendModal
        open
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        secretsLoaded={false}
        onRequestReenterSecrets={onRequestReenterSecrets}
        onAppended={onAppended}
        onClose={() => {}}
      />,
    );

    // Operations + reconciliation load on open.
    await waitFor(() => expect(mockedListOperations).toHaveBeenCalledTimes(1));

    await uploadCollection(matchedCollectionJson());
    await screen.findByTestId('postman-import-append-run');

    // First append: blocked on secrets.
    await act(async () => {
      fireEvent.click(screen.getByTestId('postman-import-append-run'));
    });

    // The re-enter-secrets prompt is surfaced AND the parent seam fired.
    await waitFor(() =>
      expect(
        screen.getByTestId('postman-import-append-secrets-required'),
      ).toBeTruthy(),
    );
    expect(onRequestReenterSecrets).toHaveBeenCalled();
    expect(mockedManualCapture).toHaveBeenCalledTimes(1);

    // User clicks "Re-enter secrets" -> clears the banner, re-defers to parent.
    await act(async () => {
      fireEvent.click(screen.getByTestId('postman-import-append-reenter-secrets'));
    });
    await waitFor(() =>
      expect(screen.queryByTestId('postman-import-append-secrets-required')).toBeNull(),
    );

    // Retry the append (secrets now re-entered): the capture lands.
    await act(async () => {
      fireEvent.click(screen.getByTestId('postman-import-append-run'));
    });

    await waitFor(() =>
      expect(screen.getByTestId('postman-import-append-success')).toBeTruthy(),
    );
    expect(mockedManualCapture).toHaveBeenCalledTimes(2);
    expect(onAppended).toHaveBeenCalled();
  });
});

describe('PostmanImportAppendModal -- Add to architecture stages a candidate (gap iii)', () => {
  it('an unmatched item routed to arch-match stages a DISCOVERY CANDIDATE, never a direct architecture write', async () => {
    // No session operation matches the imported item -> it is flagged
    // (no-operation) and routed to the arch-match step.
    mockedListOperations.mockResolvedValue([]);
    mockedReconcile.mockResolvedValue(reconciliation());
    mockedStageCandidate.mockResolvedValue({
      id: 'cand-1',
      run_id: 'imported-run-1',
      candidate_type: 'interface',
      name: 'GET /ghosts',
      confidence: 0,
      status: 'proposed',
      source_cluster_ids: [],
      data: { method: 'GET', path: '/ghosts', source: 'postman-import' },
      synthesized_at: '2026-06-23T00:00:00Z',
      parent_candidate_id: null,
      review_status: 'pending_review',
      reviewed_by: null,
      reviewed_at: null,
      previous_review_status: null,
    } as never);

    render(
      <PostmanImportAppendModal
        open
        projectId={PROJECT_ID}
        architectureId={ARCH_ID}
        sessionId={SESSION_ID}
        secretsLoaded
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(mockedListOperations).toHaveBeenCalledTimes(1));

    await uploadCollection(unmatchedCollectionJson());

    // The flagged item surfaces in the arch-match step with the three actions.
    const addBtn = await screen.findByTestId(
      'postman-import-arch-item-0-add-to-architecture',
    );

    await act(async () => {
      fireEvent.click(addBtn);
    });

    // "Add to architecture" calls the REAL discovery-candidate staging client
    // with the imported endpoint -- a discovery candidate, NOT a committed write.
    await waitFor(() => expect(mockedStageCandidate).toHaveBeenCalledTimes(1));
    expect(mockedStageCandidate).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      expect.objectContaining({ method: 'GET', path: '/ghosts' }),
    );

    // CRITICAL (A4): the "Add to architecture" path never creates an operation
    // row (add-operation) and never sends a capture -- it only stages.
    expect(mockedAddOperation).not.toHaveBeenCalled();
    expect(mockedManualCapture).not.toHaveBeenCalled();

    // The item is recorded as staged (un-runnable until a separate decision).
    await waitFor(() =>
      expect(
        screen
          .getByTestId('postman-import-arch-item-0')
          .getAttribute('data-resolution'),
      ).toBe('staged'),
    );
  });
});
