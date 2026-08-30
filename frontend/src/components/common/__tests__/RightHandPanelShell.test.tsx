/**
 * Tests for RightHandPanelShell -- the shared right-hand panel chrome (persona +
 * room header, collapse-to-tab, drag-resize, persistence) that styles the
 * Architect Conversation like the tool's standard chat panel.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';

import { RightHandPanelShell } from '../RightHandPanelShell';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderShell(overrides: Record<string, unknown> = {}) {
  const onClose = vi.fn();
  render(
    <RightHandPanelShell
      storageKey="t1"
      personaId="architect"
      roomName="Target State v2"
      collapsedLabel="Architect"
      onClose={onClose}
      {...overrides}
    >
      <div data-testid="shell-content">content</div>
    </RightHandPanelShell>,
  );
  return { onClose };
}

describe('RightHandPanelShell', () => {
  it('renders the Architect persona + room header and the hosted content when expanded', () => {
    renderShell();
    expect(screen.getByTestId('rhs-panel')).toBeInTheDocument();
    // Persona indicator carries the Architect initials.
    expect(screen.getByTestId('rhs-panel-persona-indicator')).toHaveTextContent('AR');
    // Room name + persona display name are shown.
    expect(screen.getByText('Target State v2')).toBeInTheDocument();
    expect(screen.getByText('Architect')).toBeInTheDocument();
    expect(screen.getByTestId('shell-content')).toBeInTheDocument();
  });

  it('collapses to the right-edge tab and re-expands', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('rhs-panel-collapse-button'));
    // Collapsed: the 32px tab is shown, the full panel is gone.
    expect(screen.getByTestId('rhs-panel-collapsed')).toBeInTheDocument();
    expect(screen.queryByTestId('rhs-panel')).toBeNull();
    // Clicking the tab re-expands.
    fireEvent.click(screen.getByTestId('rhs-panel-collapsed'));
    expect(screen.getByTestId('rhs-panel')).toBeInTheDocument();
  });

  it('persists the collapsed state per storageKey in localStorage', () => {
    renderShell();
    fireEvent.click(screen.getByTestId('rhs-panel-collapse-button'));
    expect(localStorage.getItem('rhs-panel-collapsed:t1')).toBe('true');
  });

  it('opens at ~50% of the viewport width by default', () => {
    renderShell();
    // jsdom window.innerWidth defaults to 1024 -> 50% = 512px.
    expect(screen.getByTestId('rhs-panel').style.width).toBe('512px');
  });

  it('drag-resizes the panel width (clamped to <= 80vw) and persists it', () => {
    renderShell();
    const panel = screen.getByTestId('rhs-panel');
    fireEvent.mouseDown(screen.getByTestId('rhs-panel-resize-handle'));
    // window.innerWidth defaults to 1024 in jsdom; clientX=500 -> width 524,
    // within [320, 819 (80vw)].
    fireEvent.mouseMove(document, { clientX: 500 });
    fireEvent.mouseUp(document);
    expect(panel.style.width).toBe('524px');
    expect(localStorage.getItem('rhs-panel-width-2:t1')).toBe('524');
  });

  it('calls onClose when the header close button is clicked', () => {
    const { onClose } = renderShell();
    fireEvent.click(screen.getByTestId('rhs-panel-close-button'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders extraHeaderActions icon-only BEFORE the collapse/close pair (2026-08-30)', () => {
    const onExport = vi.fn();
    renderShell({
      extraHeaderActions: [
        {
          key: 'export-transcript',
          icon: <span data-testid="export-icon" />,
          label: 'Export transcript',
          onClick: onExport,
          testId: 'rhs-panel-export-transcript-button',
        },
      ],
    });

    const exportButton = screen.getByTestId('rhs-panel-export-transcript-button');
    expect(exportButton).toHaveAttribute('aria-label', 'Export transcript');
    expect(within(exportButton).getByTestId('export-icon')).toBeInTheDocument();

    // Order: [export][collapse][close].
    const collapse = screen.getByTestId('rhs-panel-collapse-button');
    const close = screen.getByTestId('rhs-panel-close-button');
    expect(
      exportButton.compareDocumentPosition(collapse) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      collapse.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(exportButton);
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('renders a disabled extra header action inert', () => {
    const onExport = vi.fn();
    renderShell({
      extraHeaderActions: [
        {
          key: 'export-transcript',
          icon: <span />,
          label: 'Export transcript',
          onClick: onExport,
          disabled: true,
          testId: 'rhs-panel-export-transcript-button',
        },
      ],
    });
    const exportButton = screen.getByTestId('rhs-panel-export-transcript-button');
    expect(exportButton).toBeDisabled();
    fireEvent.click(exportButton);
    expect(onExport).not.toHaveBeenCalled();
  });
});
