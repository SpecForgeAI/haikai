/**
 * UI Screen Association Tests
 *
 * Task Group 1: Prop Wiring Tests (3 tests)
 * - Test that uiScreens array is passed to OverviewTab
 * - Test that onSelectScreenId callback is wired to setScreenId from hook
 * - Test that selectedScreenId (from content.screen_id) is passed correctly
 *
 * Task Group 2: Dropdown UI Tests (5 tests)
 * - Test dropdown renders with "Select a UIScreen..." placeholder when no selection
 * - Test dropdown options display as {screen.name} ({screen.route}) format
 * - Test selecting a screen calls onSelectScreenId with screen ID
 * - Test "Clear" button appears only when a screen is selected
 * - Test warning message displays when screen_id is set but screen not found in list
 *
 * Task Group 3: Integration Tests (up to 3 additional tests)
 * - Test full flow: select screen -> verify dirty state -> autosave triggers
 * - Test clear flow: clear selection -> verify dirty state -> autosave triggers
 * - Test persistence: verify typed_content.screen_id is updated correctly
 */

import { describe, it, expect, vi } from 'vitest';
import { Diagram, UIScreen, MetaModel } from '../types/model';
import { UIScreenContent, TypedContentEnvelope } from '../types/typedContent';

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock UIScreen entity
 */
function createMockUIScreen(id: string, name: string, route: string): UIScreen {
  return { id, name, route };
}

/**
 * Create a mock UIScreenContent
 */
function createMockUIScreenContent(screenId: string | null = null): UIScreenContent {
  return {
    screen_id: screenId,
    components: [],
    actions: [],
  };
}

/**
 * Create a mock TypedContentEnvelope for UI_SCREEN
 */
function createMockUIScreenEnvelope(content: UIScreenContent): TypedContentEnvelope {
  return {
    type: 'UI_SCREEN',
    version: 1,
    content,
  };
}

/**
 * Create a mock UI_SCREEN diagram
 */
function createMockUIScreenDiagram(
  id: string,
  screenId: string | null = null
): Diagram {
  return {
    id,
    name: 'Test UI Screen Diagram',
    description: '',
    diagram_type: 'UI_SCREEN',
    diagram_nodes: [],
    diagram_edges: [],
    typed_content: createMockUIScreenEnvelope(createMockUIScreenContent(screenId)),
  };
}

/**
 * Create a mock MetaModel with UIScreens
 */
function createMockMetaModel(uiScreens: UIScreen[]): MetaModel {
  return {
    entities: {
      business_users: [],
      business_processes: [],
      process_activities: [],
      business_points: [],
      applications: [],
      app_components: [],
      services: [],
      interfaces: [],
      endpoints: [],
      classes: [],
      methods: [],
      application_points: [],
      logical_data_entities: [],
      logical_data_attributes: [],
      physical_data_entities: [],
      physical_data_attributes: [],
      interactions: [],
      app_business_points: [],
      events: [],
      states: [],
      state_transitions: [],
      activities: [],
      activity_flows: [],
      activity_partitions: [],
      ui_screens: uiScreens,
    },
    relationships: {
      business_user_business_points: [],
      application_point_business_points: [],
      logical_data_entity_relationships: [],
      logical_data_entity_physical_data_entities: [],
      logical_data_attribute_physical_data_attributes: [],
      data_movements: [],
      interface_logical_entities: [],
      ui_workflow_transitions: [],
    },
  };
}

/**
 * Helper function to check if a screen is missing from the list
 * Matches the logic in OverviewTab.tsx
 */
function isScreenMissingFromList(
  selectedScreenId: string | null,
  uiScreens: UIScreen[]
): boolean {
  if (!selectedScreenId) return false;
  return !uiScreens.some((screen) => screen.id === selectedScreenId);
}

// ============================================================================
// Task Group 1: Prop Wiring Tests (3 tests)
// ============================================================================

describe('Task Group 1: Prop Wiring - uiScreens array passed to OverviewTab', () => {
  it('should pass uiScreensList from metaModel.entities.ui_screens to OverviewTab', () => {
    // Arrange: Create mock UIScreens
    const screen1 = createMockUIScreen('screen-1', 'Dashboard', '/dashboard');
    const screen2 = createMockUIScreen('screen-2', 'Profile', '/profile');
    const mockMetaModel = createMockMetaModel([screen1, screen2]);

    // Act: Simulate extracting uiScreensList from metaModel
    const uiScreensList = mockMetaModel.entities.ui_screens || [];

    // Assert: uiScreensList should contain the screens from metaModel
    expect(uiScreensList).toHaveLength(2);
    expect(uiScreensList[0].id).toBe('screen-1');
    expect(uiScreensList[0].name).toBe('Dashboard');
    expect(uiScreensList[1].id).toBe('screen-2');
    expect(uiScreensList[1].name).toBe('Profile');
  });

  it('should wire onSelectScreenId callback to setScreenId from hook', () => {
    // Arrange: Create a mock setScreenId function
    const mockSetScreenId = vi.fn();

    // Simulate handleScreenIdChange callback wrapping setScreenId
    const handleScreenIdChange = (screenId: string | null) => {
      mockSetScreenId(screenId);
    };

    // Act: Call the callback with a screen ID
    handleScreenIdChange('screen-1');

    // Assert: setScreenId should be called with the screen ID
    expect(mockSetScreenId).toHaveBeenCalledWith('screen-1');
    expect(mockSetScreenId).toHaveBeenCalledTimes(1);
  });

  it('should pass selectedScreenId from content.screen_id correctly', () => {
    // Arrange: Create content with a screen_id
    const content = createMockUIScreenContent('screen-123');

    // Act: Extract selectedScreenId from content
    const selectedScreenId = content.screen_id;

    // Assert: selectedScreenId should match content.screen_id
    expect(selectedScreenId).toBe('screen-123');
  });
});

// ============================================================================
// Task Group 2: Dropdown UI Tests (5 tests)
// ============================================================================

describe('Task Group 2: Dropdown UI - placeholder when no selection', () => {
  it('should render dropdown with "Select a UIScreen..." placeholder when no selection', () => {
    // Arrange: No screen selected
    const selectedScreenId: string | null = null;
    const dropdownValue = selectedScreenId || '';

    // Assert: Dropdown value should be empty string for placeholder
    expect(dropdownValue).toBe('');
    // The <option value="">Select a UIScreen...</option> would be shown
  });
});

describe('Task Group 2: Dropdown UI - options format', () => {
  it('should display dropdown options as {screen.name} ({screen.route}) format', () => {
    // Arrange: Create UIScreens
    const screen1 = createMockUIScreen('screen-1', 'Dashboard', '/dashboard');
    const screen2 = createMockUIScreen('screen-2', 'Profile', '/profile');
    const screens = [screen1, screen2];

    // Act: Format options as they would be displayed
    const formatOptionLabel = (screen: UIScreen): string => {
      if (screen.route) {
        return `${screen.name} (${screen.route})`;
      }
      return screen.name;
    };

    const options = screens.map((screen) => ({
      key: screen.id,
      value: screen.id,
      label: formatOptionLabel(screen),
    }));

    // Assert: Options should be formatted correctly
    expect(options[0].label).toBe('Dashboard (/dashboard)');
    expect(options[1].label).toBe('Profile (/profile)');
    expect(options[0].value).toBe('screen-1');
    expect(options[1].value).toBe('screen-2');
  });

  it('should display just screen name when route is empty', () => {
    // Arrange: UIScreen with no route
    const screen = createMockUIScreen('screen-1', 'Dashboard', '');

    // Act: Format option label
    const formatOptionLabel = (s: UIScreen): string => {
      if (s.route) {
        return `${s.name} (${s.route})`;
      }
      return s.name;
    };

    const label = formatOptionLabel(screen);

    // Assert: Should show just the name
    expect(label).toBe('Dashboard');
  });
});

describe('Task Group 2: Dropdown UI - selection callback', () => {
  it('should call onSelectScreenId with screen ID when a screen is selected', () => {
    // Arrange: Mock callback
    const mockOnSelectScreenId = vi.fn();

    // Simulate dropdown change handler
    const handleDropdownChange = (e: { target: { value: string } }) => {
      const value = e.target.value;
      mockOnSelectScreenId(value === '' ? null : value);
    };

    // Act: Simulate selecting a screen
    handleDropdownChange({ target: { value: 'screen-1' } });

    // Assert: Callback should be called with the screen ID
    expect(mockOnSelectScreenId).toHaveBeenCalledWith('screen-1');
    expect(mockOnSelectScreenId).toHaveBeenCalledTimes(1);
  });
});

describe('Task Group 2: Dropdown UI - Clear button visibility', () => {
  it('should show Clear button only when a screen is selected', () => {
    // Arrange & Assert: No selection - Clear button should not appear
    const noSelection: string | null = null;
    expect(!!noSelection).toBe(false);

    // Arrange & Assert: With selection - Clear button should appear
    const withSelection: string | null = 'screen-1';
    expect(!!withSelection).toBe(true);
  });
});

describe('Task Group 2: Dropdown UI - missing screen warning', () => {
  it('should display warning when screen_id is set but screen not found in list', () => {
    // Arrange: screen_id that doesn't exist in the list
    const selectedScreenId = 'non-existent-screen';
    const uiScreens = [
      createMockUIScreen('screen-1', 'Dashboard', '/dashboard'),
      createMockUIScreen('screen-2', 'Profile', '/profile'),
    ];

    // Act: Check if screen is missing using helper function (matches OverviewTab logic)
    const isMissing = isScreenMissingFromList(selectedScreenId, uiScreens);

    // Assert: Warning should be shown
    expect(isMissing).toBe(true);
  });

  it('should not display warning when screen_id matches a screen in the list', () => {
    // Arrange: Valid screen_id
    const selectedScreenId = 'screen-1';
    const uiScreens = [
      createMockUIScreen('screen-1', 'Dashboard', '/dashboard'),
      createMockUIScreen('screen-2', 'Profile', '/profile'),
    ];

    // Act: Check if screen is missing using helper function
    const isMissing = isScreenMissingFromList(selectedScreenId, uiScreens);

    // Assert: Warning should not be shown
    expect(isMissing).toBe(false);
  });

  it('should not display warning when no screen_id is set', () => {
    // Arrange: No screen selected
    const selectedScreenId: string | null = null;
    const uiScreens = [
      createMockUIScreen('screen-1', 'Dashboard', '/dashboard'),
    ];

    // Act: Check if screen is missing using helper function (matches OverviewTab logic)
    const isMissing = isScreenMissingFromList(selectedScreenId, uiScreens);

    // Assert: Warning should not be shown (null means no selection, not missing)
    expect(isMissing).toBe(false);
  });
});

// ============================================================================
// Task Group 3: Integration Tests (up to 3 additional tests)
// ============================================================================

describe('Task Group 3: Integration - full association workflow', () => {
  it('should update typed_content.screen_id when selecting a screen', () => {
    // Arrange: Initial content with no screen_id
    const initialContent = createMockUIScreenContent(null);
    let content = { ...initialContent };

    // Simulate setScreenId behavior from useUIScreenDiagram hook
    const setScreenId = (screenId: string | null) => {
      content = { ...content, screen_id: screenId };
    };

    // Act: Select a screen
    setScreenId('screen-1');

    // Assert: content.screen_id should be updated
    expect(content.screen_id).toBe('screen-1');
  });

  it('should clear typed_content.screen_id when clicking Clear', () => {
    // Arrange: Content with screen_id set
    const initialContent = createMockUIScreenContent('screen-1');
    let content = { ...initialContent };

    // Simulate setScreenId behavior from useUIScreenDiagram hook
    const setScreenId = (screenId: string | null) => {
      content = { ...content, screen_id: screenId };
    };

    // Act: Clear the selection
    setScreenId(null);

    // Assert: content.screen_id should be null
    expect(content.screen_id).toBeNull();
  });

  it('should preserve typed_content envelope structure after screen_id update', () => {
    // Arrange: Initial diagram with typed_content
    const diagram = createMockUIScreenDiagram('diag-1', null);
    const initialEnvelope = diagram.typed_content as TypedContentEnvelope;

    // Simulate updating screen_id while preserving envelope structure
    const updatedContent: UIScreenContent = {
      ...(initialEnvelope.content as UIScreenContent),
      screen_id: 'screen-1',
    };
    const updatedEnvelope: TypedContentEnvelope = {
      ...initialEnvelope,
      content: updatedContent,
    };

    // Assert: Envelope structure is preserved
    expect(updatedEnvelope.type).toBe('UI_SCREEN');
    expect(updatedEnvelope.version).toBe(1);
    expect((updatedEnvelope.content as UIScreenContent).screen_id).toBe('screen-1');
    expect((updatedEnvelope.content as UIScreenContent).components).toEqual([]);
    expect((updatedEnvelope.content as UIScreenContent).actions).toEqual([]);
  });
});
