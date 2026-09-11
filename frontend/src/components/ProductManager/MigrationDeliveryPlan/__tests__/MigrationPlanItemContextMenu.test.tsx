/**
 * MigrationPlanItemContextMenu (2026-09-11, start-from-work-item).
 *
 * The next item in plan order gets live Start entries; an item further ahead
 * gets them greyed with the server's reason; Resume entries light up only on
 * a halted run with a failed spec beneath the item.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../MigrationBookOfWork.module.css', () => ({
  default: new Proxy({}, { get: (_t, p) => String(p) }),
}));

import { MigrationPlanItemContextMenu } from '../MigrationPlanItemContextMenu';
import type { PlanOrderNodeDto } from '../../../../api/migrationDeliveryDashboardApi';

function node(over: Partial<PlanOrderNodeDto>): PlanOrderNodeDto {
  return {
    bookItemId: 'F1',
    workItemId: 'wi-F1',
    leafCount: 3,
    doneCount: 1,
    failedCount: 0,
    inFlightCount: 0,
    remainingPlanes: ['service'],
    remainingWorkItemIds: ['wi-2', 'wi-3'],
    remainingBookItemIds: ['s2', 's3'],
    startable: true,
    reason: 'ok',
    reasonText: 'Next in plan order: 2 specs.',
    blockedBy: null,
    ...over,
  };
}

function renderMenu(props: Partial<React.ComponentProps<typeof MigrationPlanItemContextMenu>> = {}) {
  const onStart = vi.fn();
  const onResume = vi.fn();
  const onClose = vi.fn();
  render(
    <MigrationPlanItemContextMenu
      x={10}
      y={10}
      title="Orders feature"
      node={node({})}
      frontierLoaded
      runStatus={null}
      busy={false}
      onClose={onClose}
      onStart={onStart}
      onResumeFailed={onResume}
      {...props}
    />,
  );
  return { onStart, onResume, onClose };
}

describe('MigrationPlanItemContextMenu', () => {
  it('the NEXT item: both Start entries are live and report the chosen completion; resume is greyed without a halted run', () => {
    const { onStart } = renderMenu();
    expect(screen.getByTestId('plan-item-context-menu-header').textContent).toContain('Orders feature');
    expect(screen.getByTestId('plan-item-context-menu-header').textContent).toContain('1/3 implemented, 2 to run');
    const start = screen.getByTestId('plan-item-menu-start') as HTMLButtonElement;
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith('implement_mr');
    fireEvent.click(screen.getByTestId('plan-item-menu-start-deploy'));
    expect(onStart).toHaveBeenCalledWith('deploy');
    expect((screen.getByTestId('plan-item-menu-resume') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('plan-item-menu-resume').getAttribute('title')).toBe('Resume needs a halted run.');
  });

  it('an item AHEAD of the frontier: Start entries greyed with the server reason, clicks do nothing', () => {
    const { onStart } = renderMenu({
      node: node({
        startable: false,
        reason: 'blocked_by_preceding',
        reasonText: '4 specs before this must be implemented first — next is "Create order".',
        doneCount: 0,
      }),
    });
    const start = screen.getByTestId('plan-item-menu-start') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.getAttribute('title')).toContain('next is "Create order"');
    expect((screen.getByTestId('plan-item-menu-start-deploy') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(start);
    expect(onStart).not.toHaveBeenCalled();
  });

  it('a halted run with a failed spec beneath the item enables both Resume entries', () => {
    const { onResume } = renderMenu({
      node: node({ failedCount: 1, startable: true }),
      runStatus: 'halted',
    });
    fireEvent.click(screen.getByTestId('plan-item-menu-resume'));
    expect(onResume).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByTestId('plan-item-menu-resume-salvage'));
    expect(onResume).toHaveBeenCalledWith(true);
  });

  it('everything is greyed while the frontier is still loading or the screen is busy; Escape closes', () => {
    const { onClose } = renderMenu({ node: null, frontierLoaded: false });
    expect((screen.getByTestId('plan-item-menu-start') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('plan-item-menu-start').getAttribute('title')).toBe('Loading plan order…');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
