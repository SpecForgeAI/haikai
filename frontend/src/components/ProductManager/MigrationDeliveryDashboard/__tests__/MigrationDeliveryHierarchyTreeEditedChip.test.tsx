/**
 * MigrationDeliveryHierarchyTree -- "Edited" chip tests
 *
 * Spec: 2026-05-20 In-Product Spec Editor + Confirm-Overwrite -- Task Group 8.1.
 *
 * Verifies the new "Edited" pill on story nodes:
 *   1. Renders when `node.manuallyEdited === true`.
 *   2. Absent when the flag is false / null / undefined.
 *   3. Clicking the chip bubbles up to the row's onClick handler (drawer
 *      open path).
 */

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../MigrationDeliveryDashboard.module.css', () => ({
  default: new Proxy(
    {},
    { get: (_t: object, prop: string | symbol) => String(prop) },
  ),
}));

import MigrationDeliveryHierarchyTree from '../MigrationDeliveryHierarchyTree';
import type { MigrationDeliveryHierarchyNodeDto } from '../../../../api/migrationDeliveryDashboardApi';

function makeNode(
  partial: Partial<MigrationDeliveryHierarchyNodeDto> &
    Pick<MigrationDeliveryHierarchyNodeDto, 'id' | 'type' | 'title'>,
): MigrationDeliveryHierarchyNodeDto {
  return {
    parentId: null,
    workstream: null,
    sequenceOrder: null,
    workItemId: null,
    backlogStatus: 'not_saved_to_backlog',
    specGenerationStatus: null,
    specGenerationConfidence: null,
    implementationStatus: null,
    evidenceStatus: 'none',
    needsAttentionCount: 0,
    missingInputsCount: null,
    children: [],
    ...partial,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('MigrationDeliveryHierarchyTree -- Edited chip (Group 8)', () => {
  it('renders the Edited chip when manuallyEdited is true', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeNode({
        id: 'story-edited',
        type: 'story',
        title: 'Hand-edited story',
        workItemId: 'wi-edited',
        backlogStatus: 'saved',
        specGenerationStatus: 'generated',
        manuallyEdited: true,
      }),
    ];

    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );

    const chip = screen.getByTestId('mdd-badge-manually-edited-story-edited');
    expect(chip).toBeInTheDocument();
    expect(chip.textContent).toBe('Edited');
  });

  it('does NOT render the chip when manuallyEdited is false / undefined', () => {
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeNode({
        id: 'story-fresh',
        type: 'story',
        title: 'LLM-generated story',
        workItemId: 'wi-fresh',
        backlogStatus: 'saved',
        specGenerationStatus: 'generated',
        manuallyEdited: false,
      }),
      makeNode({
        id: 'story-unset',
        type: 'story',
        title: 'Legacy row',
        workItemId: 'wi-unset',
        backlogStatus: 'saved',
        specGenerationStatus: 'generated',
        // manuallyEdited omitted entirely.
      }),
    ];

    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={() => {}}
      />,
    );

    expect(
      screen.queryByTestId('mdd-badge-manually-edited-story-fresh'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('mdd-badge-manually-edited-story-unset'),
    ).not.toBeInTheDocument();
  });

  it('clicking the chip opens the drawer (event bubbles to row onClick)', () => {
    const onStorySelected = vi.fn();
    const hierarchy: MigrationDeliveryHierarchyNodeDto[] = [
      makeNode({
        id: 'story-click',
        type: 'story',
        title: 'Click target',
        workItemId: 'wi-click',
        backlogStatus: 'saved',
        specGenerationStatus: 'generated',
        manuallyEdited: true,
      }),
    ];

    render(
      <MigrationDeliveryHierarchyTree
        hierarchy={hierarchy}
        onStorySelected={onStorySelected}
      />,
    );

    const chip = screen.getByTestId('mdd-badge-manually-edited-story-click');
    fireEvent.click(chip);
    expect(onStorySelected).toHaveBeenCalledWith('wi-click', 'story-click');
  });
});
