/**
 * PostmanImportArchMatchStep tests
 *
 * Spec 2026-06-23 Import a Postman Collection into Capture -- Task Group 4.1.
 *
 * Focused coverage of the architecture-match warning step's critical behaviours:
 *
 *   (a) a flagged item (unmatched to a committed endpoint, OR mapping to no
 *       operation) is routed to the warning step with the three actions;
 *   (b) "Add to architecture" calls the discovery-candidate STAGING seam
 *       (`onStageDiscoveryCandidate`) -- NOT a direct architecture write -- and
 *       records the `staged` resolution;
 *   (c) "Delete the item" drops it from the staged set (`onDeleteItem`) and
 *       records the `deleted` resolution;
 *   (d) "Keep & run" creates the operation row FIRST via `addOperation`
 *       (included=true) and surfaces it via `onOperationAdded` before any send;
 *   (e) an `addOperation` failure surfaces an inline error and leaves the item
 *       UNRESOLVED (so it cannot silently run).
 *
 * Test strategy: Vitest + `vi.mock()` with the `vi.importActual` spread pattern
 * (per project conventions) so the REAL `ApiBehaviourApiError` is used while
 * `addOperation` is a spy. The CSS module is proxied so class names equal their
 * keys, keeping selectors testid-based.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

vi.mock('../../api/apiBehaviourClient', async () => {
  const actual = await vi.importActual<typeof import('../../api/apiBehaviourClient')>(
    '../../api/apiBehaviourClient',
  );
  return { ...actual, addOperation: vi.fn() };
});

vi.mock('./PostmanImportArchMatchStep.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import {
  addOperation,
  ApiBehaviourApiError,
  type ApiBehaviourOperationDto,
} from '../../api/apiBehaviourClient';
import { PostmanImportArchMatchStep } from './PostmanImportArchMatchStep';
import type { StagedImportItem } from './postmanImportStagingSupport';
import type { ArchMatchResolution } from './postmanImportArchMatchSupport';
import type { ImportedRequest } from '../../utils/postmanImport';

const PROJECT_ID = 'proj-1';
const ARCH_ID = 'arch-1';
const SESSION_ID = 'session-1';

const mockedAddOperation = vi.mocked(addOperation);

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

function flaggedItem(
  index: number,
  archStatus: StagedImportItem['archStatus'],
  request: ImportedRequest,
): StagedImportItem {
  return { index, request, operation: null, archStatus, runnable: false };
}

function operationRow(
  partial: Partial<ApiBehaviourOperationDto> &
    Pick<ApiBehaviourOperationDto, 'id'>,
): ApiBehaviourOperationDto {
  return {
    session_id: SESSION_ID,
    operation_id: 'op-new',
    method: 'POST',
    path: '/widgets',
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

/** A tiny stateful host so resolution changes flow back into the component. */
function Harness({
  flagged,
  onStageDiscoveryCandidate,
  onDeleteItem,
  onOperationAdded,
}: {
  flagged: StagedImportItem[];
  onStageDiscoveryCandidate: (item: StagedImportItem) => void | Promise<void>;
  onDeleteItem: (item: StagedImportItem) => void;
  onOperationAdded?: (op: ApiBehaviourOperationDto) => void;
}): React.ReactElement {
  const [resolutions, setResolutions] = React.useState<
    Record<number, ArchMatchResolution>
  >({});
  return (
    <PostmanImportArchMatchStep
      projectId={PROJECT_ID}
      architectureId={ARCH_ID}
      sessionId={SESSION_ID}
      flagged={flagged}
      resolutions={resolutions}
      onResolutionChange={(index, resolution) =>
        setResolutions((prev) => ({ ...prev, [index]: resolution }))
      }
      onStageDiscoveryCandidate={onStageDiscoveryCandidate}
      onDeleteItem={onDeleteItem}
      onOperationAdded={onOperationAdded}
    />
  );
}


beforeEach(() => {
  mockedAddOperation.mockReset();
});

describe('PostmanImportArchMatchStep', () => {
  it('routes both unmatched and no-operation flagged items to the warning step with three actions', () => {
    const flagged = [
      flaggedItem(0, 'unmatched', imported({ method: 'GET', path: '/orders' })),
      flaggedItem(1, 'no-operation', imported({ method: 'DELETE', path: '/ghost' })),
    ];

    render(
      <Harness
        flagged={flagged}
        onStageDiscoveryCandidate={vi.fn()}
        onDeleteItem={vi.fn()}
      />,
    );

    expect(screen.getByTestId('postman-import-arch-warning').textContent).toContain(
      '2 imported requests',
    );
    for (const i of [0, 1]) {
      expect(
        screen.getByTestId(`postman-import-arch-item-${i}-add-to-architecture`),
      ).toBeTruthy();
      expect(
        screen.getByTestId(`postman-import-arch-item-${i}-keep-and-run`),
      ).toBeTruthy();
      expect(
        screen.getByTestId(`postman-import-arch-item-${i}-delete`),
      ).toBeTruthy();
    }
  });

  it('"Add to architecture" calls the discovery-candidate staging seam (not a direct architecture write)', async () => {
    const onStage = vi.fn().mockResolvedValue(undefined);
    const flagged = [
      flaggedItem(0, 'no-operation', imported({ method: 'POST', path: '/widgets' })),
    ];

    render(
      <Harness flagged={flagged} onStageDiscoveryCandidate={onStage} onDeleteItem={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('postman-import-arch-item-0-add-to-architecture'),
      );
    });

    expect(onStage).toHaveBeenCalledTimes(1);
    expect(onStage.mock.calls[0][0].index).toBe(0);
    // NO add-operation / architecture write happened on this path.
    expect(mockedAddOperation).not.toHaveBeenCalled();

    await waitFor(() =>
      expect(
        screen.getByTestId('postman-import-arch-item-0').getAttribute('data-resolution'),
      ).toBe('staged'),
    );
    expect(
      screen.getByTestId('postman-import-arch-item-0-resolution').textContent,
    ).toContain('discovery candidate');
  });

  it('"Delete the item" drops it from the staged set', () => {
    const onDelete = vi.fn();
    const flagged = [
      flaggedItem(0, 'unmatched', imported({ method: 'GET', path: '/orders' })),
    ];

    render(
      <Harness flagged={flagged} onStageDiscoveryCandidate={vi.fn()} onDeleteItem={onDelete} />,
    );

    fireEvent.click(screen.getByTestId('postman-import-arch-item-0-delete'));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete.mock.calls[0][0].index).toBe(0);
    expect(
      screen.getByTestId('postman-import-arch-item-0').getAttribute('data-resolution'),
    ).toBe('deleted');
  });

  it('"Keep & run" creates the operation row first via addOperation and surfaces it', async () => {
    const createdOp = operationRow({ id: 'op-row-1', included: true });
    mockedAddOperation.mockResolvedValue({
      sessionId: SESSION_ID,
      operation: createdOp,
      created: true,
    });
    const onOperationAdded = vi.fn();
    const flagged = [
      flaggedItem(0, 'no-operation', imported({ method: 'POST', path: '/widgets', sourceItemName: 'Create widget' })),
    ];

    render(
      <Harness
        flagged={flagged}
        onStageDiscoveryCandidate={vi.fn()}
        onDeleteItem={vi.fn()}
        onOperationAdded={onOperationAdded}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('postman-import-arch-item-0-keep-and-run'));
    });

    // add-operation is called BEFORE the resolution flips to 'kept'.
    expect(mockedAddOperation).toHaveBeenCalledTimes(1);
    expect(mockedAddOperation).toHaveBeenCalledWith(
      PROJECT_ID,
      ARCH_ID,
      SESSION_ID,
      expect.objectContaining({ method: 'POST', path: '/widgets' }),
    );
    expect(onOperationAdded).toHaveBeenCalledWith(createdOp);

    await waitFor(() =>
      expect(
        screen.getByTestId('postman-import-arch-item-0').getAttribute('data-resolution'),
      ).toBe('kept'),
    );
  });

  it('an add-operation failure shows an inline error and leaves the item UNRESOLVED', async () => {
    mockedAddOperation.mockRejectedValue(
      new ApiBehaviourApiError(500, { message: 'boom' }),
    );
    const flagged = [
      flaggedItem(0, 'no-operation', imported({ method: 'POST', path: '/widgets' })),
    ];

    render(
      <Harness flagged={flagged} onStageDiscoveryCandidate={vi.fn()} onDeleteItem={vi.fn()} />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('postman-import-arch-item-0-keep-and-run'));
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('postman-import-arch-item-0-error').textContent,
      ).toContain('boom'),
    );
    // Still pending -> never silently runnable.
    expect(
      screen.getByTestId('postman-import-arch-item-0').getAttribute('data-resolution'),
    ).toBe('pending');
    // The action buttons remain available for a retry / alternative resolution.
    expect(
      screen.getByTestId('postman-import-arch-item-0-keep-and-run'),
    ).toBeTruthy();
  });
});
