/**
 * Task Group 4: Tests for Note in InspectorPanel decoration palette
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { InspectorPanel } from '../components/DiagramsView/InspectorPanel';

const defaultProps = {
  isCollapsed: false,
  onToggleCollapse: vi.fn(),
  selectedDecorationIds: new Set<string>(),
  decorations: [] as any[],
  addMode: null as any,
  onAddModeChange: vi.fn(),
  onUpdateDecorationText: vi.fn(),
};

describe('Task Group 4: Note palette entry in InspectorPanel', () => {
  it('DECORATION_PALETTE (shapeButtons) contains an entry with type NOTE', () => {
    render(<InspectorPanel {...defaultProps} />);
    const noteButton = screen.getByTestId('add-note-button');
    expect(noteButton).toBeInTheDocument();
  });

  it('Note palette entry has label "Note" and title "Add a note decoration"', () => {
    render(<InspectorPanel {...defaultProps} />);
    const noteButton = screen.getByTestId('add-note-button');
    expect(noteButton.getAttribute('title')).toBe('Add a note decoration');
    expect(noteButton.textContent).toContain('Note');
  });

  it('ShapeIcons.NOTE renders an SVG icon (folded-corner rectangle)', () => {
    render(<InspectorPanel {...defaultProps} />);
    const noteButton = screen.getByTestId('add-note-button');
    const svg = noteButton.querySelector('svg');
    expect(svg).toBeTruthy();
    const path = svg!.querySelector('path');
    expect(path).toBeTruthy();
  });
});
