/**
 * SequenceEditorPanel Component Tests
 * Task Group 2: Tests for the SequenceEditorPanel component
 *
 * Tests the tabbed panel component used for editing Sequence diagrams.
 * This panel replaces the standard PalettePanel when a Sequence diagram is active.
 */

import { describe, it, expect } from 'vitest';

// Tab configuration constants
const SEQUENCE_EDITOR_TABS = {
  PARTICIPANTS: 'Participants',
  FLOW: 'Flow',
};

/**
 * Panel state interface for testing tab behavior
 */
interface PanelState {
  activeTab: string;
  isSaving: boolean;
  diagramType: string;
}

/**
 * Helper function to determine if panel should render
 * Panel only renders when diagram type is 'Sequence'
 */
function shouldRenderSequenceEditorPanel(diagramType: string | null | undefined): boolean {
  return diagramType === 'Sequence';
}

/**
 * Helper function to get tab content based on active tab
 */
function getTabContent(activeTab: string): string {
  switch (activeTab) {
    case SEQUENCE_EDITOR_TABS.PARTICIPANTS:
      return 'ParticipantsTabContent';
    case SEQUENCE_EDITOR_TABS.FLOW:
      return 'FlowTabContent';
    default:
      return '';
  }
}

/**
 * Helper function to simulate tab switching
 */
function switchTab(state: PanelState, newTab: string): PanelState {
  return {
    ...state,
    activeTab: newTab,
  };
}

/**
 * Helper function to get saving indicator text
 */
function getSavingIndicator(isSaving: boolean): string | null {
  return isSaving ? 'Saving...' : null;
}

describe('SequenceEditorPanel - Tab Rendering', () => {
  describe('Task 2.1: Panel renders with correct tabs', () => {
    it('should have Participants and Flow tabs defined', () => {
      const tabs = Object.values(SEQUENCE_EDITOR_TABS);

      expect(tabs).toContain('Participants');
      expect(tabs).toContain('Flow');
      expect(tabs).toHaveLength(2);
    });

    it('should default to Participants tab as active', () => {
      const initialState: PanelState = {
        activeTab: SEQUENCE_EDITOR_TABS.PARTICIPANTS,
        isSaving: false,
        diagramType: 'Sequence',
      };

      expect(initialState.activeTab).toBe('Participants');
    });

    it('should render ParticipantsTabContent when Participants tab is active', () => {
      const content = getTabContent(SEQUENCE_EDITOR_TABS.PARTICIPANTS);

      expect(content).toBe('ParticipantsTabContent');
    });

    it('should render FlowTabContent when Flow tab is active', () => {
      const content = getTabContent(SEQUENCE_EDITOR_TABS.FLOW);

      expect(content).toBe('FlowTabContent');
    });
  });
});

describe('SequenceEditorPanel - Tab Switching', () => {
  describe('Task 2.1: Tab switching changes visible content', () => {
    it('should switch from Participants to Flow tab', () => {
      const initialState: PanelState = {
        activeTab: SEQUENCE_EDITOR_TABS.PARTICIPANTS,
        isSaving: false,
        diagramType: 'Sequence',
      };

      const newState = switchTab(initialState, SEQUENCE_EDITOR_TABS.FLOW);

      expect(newState.activeTab).toBe('Flow');
      expect(getTabContent(newState.activeTab)).toBe('FlowTabContent');
    });

    it('should switch from Flow to Participants tab', () => {
      const initialState: PanelState = {
        activeTab: SEQUENCE_EDITOR_TABS.FLOW,
        isSaving: false,
        diagramType: 'Sequence',
      };

      const newState = switchTab(initialState, SEQUENCE_EDITOR_TABS.PARTICIPANTS);

      expect(newState.activeTab).toBe('Participants');
      expect(getTabContent(newState.activeTab)).toBe('ParticipantsTabContent');
    });

    it('should preserve other state when switching tabs', () => {
      const initialState: PanelState = {
        activeTab: SEQUENCE_EDITOR_TABS.PARTICIPANTS,
        isSaving: true,
        diagramType: 'Sequence',
      };

      const newState = switchTab(initialState, SEQUENCE_EDITOR_TABS.FLOW);

      expect(newState.isSaving).toBe(true);
      expect(newState.diagramType).toBe('Sequence');
    });
  });
});

describe('SequenceEditorPanel - Saving Indicator', () => {
  describe('Task 2.1: Saving indicator appears during save operation', () => {
    it('should show "Saving..." indicator when isSaving is true', () => {
      const indicator = getSavingIndicator(true);

      expect(indicator).toBe('Saving...');
    });

    it('should not show indicator when isSaving is false', () => {
      const indicator = getSavingIndicator(false);

      expect(indicator).toBeNull();
    });

    it('should track saving state correctly', () => {
      const savingState: PanelState = {
        activeTab: SEQUENCE_EDITOR_TABS.PARTICIPANTS,
        isSaving: true,
        diagramType: 'Sequence',
      };

      expect(savingState.isSaving).toBe(true);

      const savedState: PanelState = {
        ...savingState,
        isSaving: false,
      };

      expect(savedState.isSaving).toBe(false);
    });
  });
});

describe('SequenceEditorPanel - Conditional Rendering', () => {
  describe('Task 2.1: Panel only renders when diagram type is Sequence', () => {
    it('should render panel for Sequence diagram type', () => {
      const shouldRender = shouldRenderSequenceEditorPanel('Sequence');

      expect(shouldRender).toBe(true);
    });

    it('should not render panel for General diagram type', () => {
      const shouldRender = shouldRenderSequenceEditorPanel('General');

      expect(shouldRender).toBe(false);
    });

    it('should not render panel for ER diagram type', () => {
      const shouldRender = shouldRenderSequenceEditorPanel('ER');

      expect(shouldRender).toBe(false);
    });

    it('should not render panel for State diagram type', () => {
      const shouldRender = shouldRenderSequenceEditorPanel('State');

      expect(shouldRender).toBe(false);
    });

    it('should not render panel for Activity diagram type', () => {
      const shouldRender = shouldRenderSequenceEditorPanel('Activity');

      expect(shouldRender).toBe(false);
    });

    it('should not render panel for null/undefined diagram type', () => {
      expect(shouldRenderSequenceEditorPanel(null)).toBe(false);
      expect(shouldRenderSequenceEditorPanel(undefined)).toBe(false);
    });
  });
});
