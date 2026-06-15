/**
 * JourneyChooser Tests
 *
 * Spec 2026-04-03: User Journey Temporary Diagram Selection and Review Flow
 * Task Group 4, Task 4.1: 5 focused tests for the journey chooser component
 *
 * Test 1: Renders a card/list entry for each journey in the provided array
 * Test 2: Each entry displays journey name, user role name, business process name, step count
 * Test 3: Clicking a journey entry calls onSelectJourney with the correct index
 * Test 4: Handles empty journeys array gracefully (shows empty state)
 * Test 5: Renders without errors when journeys have minimal fields
 */

import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { JourneyChooser } from '../JourneyChooser';
import type { UserJourneyDiagramDto } from '../../../types/userJourneyDiagram';

// ============================================================================
// Test Helpers
// ============================================================================

function createTestDiagram(name: string, stepCount: number = 3): UserJourneyDiagramDto {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i}`,
    journey_id: 'j-1',
    order: i,
    lane_id: 'lane-1',
    process_activity_id: `pa-${i}`,
    process_activity_name: `Activity ${i}`,
    name: `Step ${i}`,
    description: '',
    business_user_id: 'bu-1',
    business_user_name: 'Customer',
  }));

  return {
    diagram_type: 'USER_JOURNEY',
    version: '1',
    journey: {
      id: `j-${name}`,
      name,
      description: '',
      user_role_id: 'ur-1',
      user_role_name: 'End User',
      parent_business_process_id: 'bp-1',
      parent_business_process_name: 'Order Management',
    },
    lanes: [{ id: 'lane-1', name: 'Web App', order: 0 }],
    steps,
    edges: [],
    render_hints: { lane_axis: 'HORIZONTAL', flow_direction: 'LEFT_TO_RIGHT', show_title: true },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('JourneyChooser', () => {
  it('renders a card entry for each journey in the provided array', () => {
    const journeys = [
      createTestDiagram('Journey A'),
      createTestDiagram('Journey B'),
      createTestDiagram('Journey C'),
    ];
    const onSelect = vi.fn();

    const { getByTestId } = render(
      <JourneyChooser journeys={journeys} onSelectJourney={onSelect} />
    );

    expect(getByTestId('journey-card-0')).toBeDefined();
    expect(getByTestId('journey-card-1')).toBeDefined();
    expect(getByTestId('journey-card-2')).toBeDefined();
  });

  it('each entry displays journey name, user role, business process, and step count', () => {
    const journeys = [createTestDiagram('Order Placement', 5)];
    const onSelect = vi.fn();

    const { getByTestId } = render(
      <JourneyChooser journeys={journeys} onSelectJourney={onSelect} />
    );

    expect(getByTestId('journey-card-name-0').textContent).toBe('Order Placement');
    expect(getByTestId('journey-card-role-0').textContent).toContain('End User');
    expect(getByTestId('journey-card-process-0').textContent).toContain('Order Management');
    expect(getByTestId('journey-card-steps-0').textContent).toContain('5 steps');
  });

  it('clicking a journey entry calls onSelectJourney with the correct index', () => {
    const journeys = [
      createTestDiagram('Journey A'),
      createTestDiagram('Journey B'),
    ];
    const onSelect = vi.fn();

    const { getByTestId } = render(
      <JourneyChooser journeys={journeys} onSelectJourney={onSelect} />
    );

    fireEvent.click(getByTestId('journey-card-1'));
    expect(onSelect).toHaveBeenCalledWith(1);

    fireEvent.click(getByTestId('journey-card-0'));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('handles empty journeys array gracefully', () => {
    const onSelect = vi.fn();

    const { getByTestId } = render(
      <JourneyChooser journeys={[]} onSelectJourney={onSelect} />
    );

    const empty = getByTestId('journey-chooser-empty');
    expect(empty.textContent).toContain('No user journey diagrams available');
  });

  it('renders correctly with singular step count', () => {
    const journeys = [createTestDiagram('Solo Step Journey', 1)];
    const onSelect = vi.fn();

    const { getByTestId } = render(
      <JourneyChooser journeys={journeys} onSelectJourney={onSelect} />
    );

    expect(getByTestId('journey-card-steps-0').textContent).toBe('1 step');
  });
});
