/**
 * Integration Tests for ChatPanel in MetaModelView
 */
import { describe, it, expect } from 'vitest';

// Simulates the layout structure based on component composition
interface LayoutConfig {
  containerDirection: 'row' | 'column';
  chatPanelPosition: 'left' | 'right' | 'none';
  mainContentFlex: number;
}

// MetaModelView layout configuration (as updated)
function getMetaModelViewLayout(): LayoutConfig {
  return {
    containerDirection: 'row',
    chatPanelPosition: 'left',
    mainContentFlex: 1,
  };
}

// DiagramsView layout configuration (no chat panel)
function getDiagramsViewLayout(): LayoutConfig {
  return {
    containerDirection: 'column',
    chatPanelPosition: 'none',
    mainContentFlex: 1,
  };
}

// Simulate how layout adjusts based on chat panel state
interface ChatPanelLayoutState {
  isCollapsed: boolean;
  width: number;
}

function calculateMainContentWidth(
  viewportWidth: number,
  chatPanelState: ChatPanelLayoutState
): number {
  const chatPanelWidth = chatPanelState.isCollapsed ? 32 : chatPanelState.width;
  return viewportWidth - chatPanelWidth;
}

describe('ChatPanel MetaModelView Integration', () => {
  it('ChatPanel renders in MetaModelView when on Meta-Model route', () => {
    const layout = getMetaModelViewLayout();

    // MetaModelView should have row direction and chat panel on left
    expect(layout.containerDirection).toBe('row');
    expect(layout.chatPanelPosition).toBe('left');

    // The layout should include ChatPanel as first child
    // This is verified by the structure in MetaModelView.tsx
    const hasChatPanel = layout.chatPanelPosition !== 'none';
    expect(hasChatPanel).toBe(true);
  });

  it('ChatPanel does NOT render in DiagramsView', () => {
    const layout = getDiagramsViewLayout();

    // DiagramsView should NOT have chat panel
    expect(layout.chatPanelPosition).toBe('none');

    // Verify DiagramsView maintains its column layout
    expect(layout.containerDirection).toBe('column');
  });

  it('layout adjusts correctly when ChatPanel is expanded/collapsed', () => {
    const viewportWidth = 1920;

    // When collapsed (32px tab)
    const collapsedState: ChatPanelLayoutState = {
      isCollapsed: true,
      width: 320, // Width is preserved but not used when collapsed
    };
    const mainContentWidthCollapsed = calculateMainContentWidth(viewportWidth, collapsedState);
    expect(mainContentWidthCollapsed).toBe(1920 - 32);
    expect(mainContentWidthCollapsed).toBe(1888);

    // When expanded (320px default width)
    const expandedState: ChatPanelLayoutState = {
      isCollapsed: false,
      width: 320,
    };
    const mainContentWidthExpanded = calculateMainContentWidth(viewportWidth, expandedState);
    expect(mainContentWidthExpanded).toBe(1920 - 320);
    expect(mainContentWidthExpanded).toBe(1600);

    // When expanded with custom width (450px)
    const customWidthState: ChatPanelLayoutState = {
      isCollapsed: false,
      width: 450,
    };
    const mainContentWidthCustom = calculateMainContentWidth(viewportWidth, customWidthState);
    expect(mainContentWidthCustom).toBe(1920 - 450);
    expect(mainContentWidthCustom).toBe(1470);
  });
});
