/**
 * Tests for Surface 5 -- Per-question "Set exception" sub-dialog.
 *
 * Spec: 2026-05-24 Target State Architect-Persona Conversation -- Commit 5 (5.5)
 *
 * Covers (4 tests):
 *   1. The sub-dialog opens with an entity picker.
 *   2. The picker is filtered per Q11 by the decision code's
 *      `allowedExceptionScopes` (e.g. `service.framework` shows service-only,
 *      `db.engine` shows physical_data_entity-only).
 *   3. Submitting writes an `exception-pinned` payload with
 *      `scope = { kind: 'element', refType, refId }` and an `answerValue`.
 *   4. The picker rejects any `scope_ref_type` value outside the Q12 closed
 *      set (filtered out at the data-flattening layer).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

vi.mock('../../../../api/architecturesApi', async () => {
  const actual = await vi.importActual<
    typeof import('../../../../api/architecturesApi')
  >('../../../../api/architecturesApi');
  return {
    ...actual,
    getElementsInventory: vi.fn(),
  };
});

import { ExceptionSubDialog } from '../ExceptionSubDialog';
import { getElementsInventory } from '../../../../api/architecturesApi';

const PROJECT_ID = 'proj-exc-1';
const TARGET_ARCH_ID = 'target-exc-1';

const INVENTORY = {
  domains: [
    {
      name: 'Applications',
      types: [
        {
          name: 'Services',
          entityType: 'service',
          instances: [
            { id: 'svc-1', name: 'Payments Service' },
            { id: 'svc-2', name: 'Auth Service' },
          ],
        },
        {
          name: 'Interfaces',
          entityType: 'interface',
          instances: [{ id: 'iface-1', name: 'Payment REST API' }],
        },
      ],
    },
    {
      name: 'Data',
      types: [
        {
          name: 'Physical Data Entities',
          entityType: 'physical_data_entity',
          instances: [
            { id: 'pde-1', name: 'orders_table' },
            { id: 'pde-2', name: 'users_table' },
          ],
        },
        {
          name: 'WhateverInvalidType',
          // entityType that is NOT in the Q12 closed set -- defence-in-depth.
          entityType: 'some_unknown_type',
          instances: [{ id: 'unknown-1', name: 'Should not appear' }],
        },
      ],
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getElementsInventory).mockResolvedValue(INVENTORY as never);
});

afterEach(() => {
  cleanup();
});

describe('ExceptionSubDialog (Spec 3, Commit 5, Surface 5)', () => {
  it('opens with an entity picker after the inventory loads', async () => {
    render(
      <ExceptionSubDialog
        projectId={PROJECT_ID}
        targetArchitectureId={TARGET_ARCH_ID}
        decisionCode="service.framework"
        allowedExceptionScopes={['service']}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      await screen.findByTestId('architect-conversation-exception-sub-dialog'),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByTestId('architect-conversation-exception-entity-list'),
      ).toBeInTheDocument();
    });
  });

  it('filters the picker per allowedExceptionScopes (service-only)', async () => {
    render(
      <ExceptionSubDialog
        projectId={PROJECT_ID}
        targetArchitectureId={TARGET_ARCH_ID}
        decisionCode="service.framework"
        allowedExceptionScopes={['service']}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Only the two services show up.
    await waitFor(() => {
      expect(
        screen.getByTestId('architect-conversation-exception-entity-row-svc-1'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByTestId('architect-conversation-exception-entity-row-svc-2'),
    ).toBeInTheDocument();
    // Interface + data-entity rows are filtered out.
    expect(
      screen.queryByTestId('architect-conversation-exception-entity-row-iface-1'),
    ).toBeNull();
    expect(
      screen.queryByTestId('architect-conversation-exception-entity-row-pde-1'),
    ).toBeNull();
  });

  it('submitting writes an exception-pinned payload with element scope', async () => {
    const onSubmit = vi.fn();
    render(
      <ExceptionSubDialog
        projectId={PROJECT_ID}
        targetArchitectureId={TARGET_ARCH_ID}
        decisionCode="db.engine"
        allowedExceptionScopes={['physical_data_entity']}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    // Only physical_data_entity rows visible.
    await waitFor(() => {
      expect(
        screen.getByTestId('architect-conversation-exception-entity-row-pde-1'),
      ).toBeInTheDocument();
    });
    expect(
      screen.queryByTestId('architect-conversation-exception-entity-row-svc-1'),
    ).toBeNull();

    fireEvent.click(
      screen.getByTestId('architect-conversation-exception-entity-row-pde-1'),
    );
    const valueInput = screen.getByTestId(
      'architect-conversation-exception-answer-input',
    ) as HTMLInputElement;
    fireEvent.change(valueInput, { target: { value: 'Oracle 23ai' } });

    fireEvent.click(
      screen.getByTestId('architect-conversation-exception-submit'),
    );

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const [args] = onSubmit.mock.calls[0];
    expect(args.scope).toEqual({
      kind: 'element',
      refType: 'physical_data_entity',
      refId: 'pde-1',
    });
    expect(args.answerValue).toBe('Oracle 23ai');
  });

  it('rejects any scope_ref_type value outside the Q12 closed set (defence-in-depth)', async () => {
    // The mocked inventory deliberately includes a row with entityType
    // 'some_unknown_type' -- the picker drops it before render.
    render(
      <ExceptionSubDialog
        projectId={PROJECT_ID}
        targetArchitectureId={TARGET_ARCH_ID}
        decisionCode="service.framework"
        // Caller passes an out-of-set scope as well; the dialog filters it out
        // before flattening the inventory.
        allowedExceptionScopes={['service', 'some_unknown_type' as never]}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('architect-conversation-exception-entity-row-svc-1'),
      ).toBeInTheDocument();
    });
    // The unknown row never appears.
    expect(
      screen.queryByTestId('architect-conversation-exception-entity-row-unknown-1'),
    ).toBeNull();
  });
});
