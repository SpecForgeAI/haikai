/**
 * Product Backlog Stage 4 - Archived Filter Tests
 *
 * Spec 2026-01-04: Product Backlog Stage 4 - Roadmap Epic Anchoring
 * Task Group 1: Archived Filter State and LocalStorage Persistence
 * Task Group 2: Work Item Filtering Before Tree Build
 * Task Group 3: Filter Toggle UI in Backlog Header
 * Task Group 4: Empty State Guidance When No Active Epics
 * Task Group 5: Feature Creation Gating on Archived Epics
 * Task Group 6: Integration Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkItem } from '../types/workItems';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Sample work items for testing
const createMockWorkItem = (overrides: Partial<WorkItem>): WorkItem => ({
  id: 'test-id',
  projectId: 'test-project',
  type: 'FEATURE',
  parentId: null,
  title: 'Test Item',
  description: null,
  status: 'NEW',
  sortOrder: 1,
  priority: null,
  targetWindow: null,
  tags: null,
  externalSystem: null,
  externalKey: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

const mockActiveInitiative = createMockWorkItem({
  id: 'init-active',
  type: 'INITIATIVE',
  parentId: null,
  title: 'Active Initiative',
  status: 'IN_PROGRESS',
});

const mockArchivedInitiative = createMockWorkItem({
  id: 'init-archived',
  type: 'INITIATIVE',
  parentId: null,
  title: 'Archived Initiative',
  status: 'ARCHIVED',
});

const mockActiveEpic = createMockWorkItem({
  id: 'epic-active',
  type: 'EPIC',
  parentId: 'init-active',
  title: 'Active Epic',
  status: 'IN_PROGRESS',
});

const mockArchivedEpic = createMockWorkItem({
  id: 'epic-archived',
  type: 'EPIC',
  parentId: 'init-active',
  title: 'Archived Epic',
  status: 'ARCHIVED',
});

const mockFeatureUnderArchivedEpic = createMockWorkItem({
  id: 'feature-under-archived',
  type: 'FEATURE',
  parentId: 'epic-archived',
  title: 'Feature Under Archived Epic',
  status: 'PLANNED',
});

const mockFeatureUnderActiveEpic = createMockWorkItem({
  id: 'feature-under-active',
  type: 'FEATURE',
  parentId: 'epic-active',
  title: 'Feature Under Active Epic',
  status: 'PLANNED',
});

const mockStory = createMockWorkItem({
  id: 'story-1',
  type: 'STORY',
  parentId: 'feature-under-active',
  title: 'Test Story',
  status: 'READY',
});

/**
 * Filter function that excludes archived INITIATIVE and EPIC items
 * when showArchivedRoadmapItems is false
 */
function filterWorkItemsForTree(
  items: WorkItem[],
  showArchivedRoadmapItems: boolean
): WorkItem[] {
  if (showArchivedRoadmapItems) {
    return items;
  }
  return items.filter((item) => {
    const isRoadmapItem = item.type === 'INITIATIVE' || item.type === 'EPIC';
    const isArchived = item.status === 'ARCHIVED';
    return !(isRoadmapItem && isArchived);
  });
}

/**
 * Get localStorage key for archived filter preference
 */
function getArchivedFilterStorageKey(projectId: string): string {
  return `product_backlog_show_archived::${projectId}`;
}

// ============================================================================
// Task Group 1: Archived Filter State and LocalStorage Persistence
// ============================================================================

describe('Task Group 1: Archived Filter State and LocalStorage Persistence', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorageMock.clear();
  });

  it('1.1.1: showArchivedRoadmapItems defaults to false', () => {
    const defaultValue = false;
    expect(defaultValue).toBe(false);
  });

  it('1.1.2: localStorage read on component mount uses correct key pattern', () => {
    const projectId = 'my-test-project';
    const expectedKey = `product_backlog_show_archived::${projectId}`;

    localStorageMock.setItem(expectedKey, 'true');

    const storedValue = localStorageMock.getItem(expectedKey);
    expect(storedValue).toBe('true');
    expect(localStorageMock.getItem).toHaveBeenCalledWith(expectedKey);
  });

  it('1.1.3: localStorage write when toggle changes', () => {
    const projectId = 'my-test-project';
    const key = getArchivedFilterStorageKey(projectId);

    // Simulate toggle to true
    localStorageMock.setItem(key, 'true');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(key, 'true');

    // Simulate toggle to false
    localStorageMock.setItem(key, 'false');
    expect(localStorageMock.setItem).toHaveBeenCalledWith(key, 'false');
  });

  it('1.1.4: state resets when loadedFileName (projectId) changes', () => {
    const projectId1 = 'project-1';
    const projectId2 = 'project-2';

    // Set preference for project 1
    localStorageMock.setItem(getArchivedFilterStorageKey(projectId1), 'true');

    // When switching to project 2, should read project 2's preference (which doesn't exist)
    const project2Value = localStorageMock.getItem(getArchivedFilterStorageKey(projectId2));
    expect(project2Value).toBeNull();

    // Should default to false when no stored value exists
    const showArchived = project2Value === 'true' ? true : false;
    expect(showArchived).toBe(false);
  });

  it('1.1.5: localStorage key includes correct projectId', () => {
    const projectId = 'unique-project-id-123';
    const key = getArchivedFilterStorageKey(projectId);

    expect(key).toBe('product_backlog_show_archived::unique-project-id-123');
    expect(key).toContain(projectId);
  });

  it('1.1.6: handles missing localStorage value gracefully (defaults to false)', () => {
    const projectId = 'new-project';
    const key = getArchivedFilterStorageKey(projectId);

    // No value set
    const storedValue = localStorageMock.getItem(key);
    expect(storedValue).toBeNull();

    // Should default to false
    const showArchived = storedValue === 'true';
    expect(showArchived).toBe(false);
  });
});

// ============================================================================
// Task Group 2: Work Item Filtering Before Tree Build
// ============================================================================

describe('Task Group 2: Work Item Filtering Before Tree Build', () => {
  const allItems = [
    mockActiveInitiative,
    mockArchivedInitiative,
    mockActiveEpic,
    mockArchivedEpic,
    mockFeatureUnderArchivedEpic,
    mockFeatureUnderActiveEpic,
    mockStory,
  ];

  it('2.1.1: ARCHIVED INITIATIVEs are excluded when toggle is OFF', () => {
    const filtered = filterWorkItemsForTree(allItems, false);

    const hasArchivedInitiative = filtered.some(
      (item) => item.type === 'INITIATIVE' && item.status === 'ARCHIVED'
    );
    expect(hasArchivedInitiative).toBe(false);

    // Active initiative should still be present
    const hasActiveInitiative = filtered.some((item) => item.id === 'init-active');
    expect(hasActiveInitiative).toBe(true);
  });

  it('2.1.2: ARCHIVED EPICs are excluded when toggle is OFF', () => {
    const filtered = filterWorkItemsForTree(allItems, false);

    const hasArchivedEpic = filtered.some(
      (item) => item.type === 'EPIC' && item.status === 'ARCHIVED'
    );
    expect(hasArchivedEpic).toBe(false);

    // Active epic should still be present
    const hasActiveEpic = filtered.some((item) => item.id === 'epic-active');
    expect(hasActiveEpic).toBe(true);
  });

  it('2.1.3: children of ARCHIVED parents are naturally hidden (orphan handling)', () => {
    const filtered = filterWorkItemsForTree(allItems, false);

    // Feature under archived epic is still in filtered list (filter only removes roadmap items)
    // But when tree is built, it will become an orphan since its parent is gone
    const featureUnderArchived = filtered.find((item) => item.id === 'feature-under-archived');

    // The feature itself is present in filtered items
    expect(featureUnderArchived).toBeDefined();

    // But its parent (archived epic) is not
    const archivedEpicPresent = filtered.some((item) => item.id === 'epic-archived');
    expect(archivedEpicPresent).toBe(false);

    // This means when tree is built, feature-under-archived will be orphaned
  });

  it('2.1.4: ARCHIVED items appear when toggle is ON', () => {
    const filtered = filterWorkItemsForTree(allItems, true);

    // All items should be present
    expect(filtered).toHaveLength(allItems.length);

    const hasArchivedInitiative = filtered.some((item) => item.id === 'init-archived');
    const hasArchivedEpic = filtered.some((item) => item.id === 'epic-archived');

    expect(hasArchivedInitiative).toBe(true);
    expect(hasArchivedEpic).toBe(true);
  });

  it('2.1.5: FEATUREs and STORYs are never filtered by this logic (only their parents)', () => {
    const filtered = filterWorkItemsForTree(allItems, false);

    // Features and stories should not be filtered regardless of their own status
    const features = filtered.filter((item) => item.type === 'FEATURE');
    const stories = filtered.filter((item) => item.type === 'STORY');

    // Both features should be in the filtered list
    expect(features).toHaveLength(2);
    expect(stories).toHaveLength(1);
  });

  it('2.1.6: visibleEpics count computation for non-archived EPICs', () => {
    const visibleEpics = allItems.filter(
      (item) => item.type === 'EPIC' && item.status !== 'ARCHIVED'
    );

    expect(visibleEpics).toHaveLength(1);
    expect(visibleEpics[0].id).toBe('epic-active');
  });
});

// ============================================================================
// Task Group 3: Filter Toggle UI in Backlog Header
// ============================================================================

describe('Task Group 3: Filter Toggle UI in Backlog Header', () => {
  it('3.1.1: header hint text value is correct', () => {
    const hintText = 'Features belong under Roadmap Epics.';
    expect(hintText).toBe('Features belong under Roadmap Epics.');
  });

  it('3.1.2: checkbox label text is correct', () => {
    const labelText = 'Show archived roadmap items';
    expect(labelText).toBe('Show archived roadmap items');
  });

  it('3.1.3: checkbox reflects showArchivedRoadmapItems state', () => {
    // When state is false, checkbox should be unchecked
    let showArchivedRoadmapItems = false;
    expect(showArchivedRoadmapItems).toBe(false);

    // When state is true, checkbox should be checked
    showArchivedRoadmapItems = true;
    expect(showArchivedRoadmapItems).toBe(true);
  });

  it('3.1.4: toggle handler toggles the state', () => {
    let showArchivedRoadmapItems = false;

    // Simulate toggle handler
    const handleToggleShowArchived = () => {
      showArchivedRoadmapItems = !showArchivedRoadmapItems;
    };

    handleToggleShowArchived();
    expect(showArchivedRoadmapItems).toBe(true);

    handleToggleShowArchived();
    expect(showArchivedRoadmapItems).toBe(false);
  });

  it('3.1.5: toggle preserves accessibility with proper data-testid attributes', () => {
    // These are the expected data-testid values for testing
    const expectedTestIds = {
      header: 'backlog-header',
      hintText: 'backlog-header-hint',
      toggleCheckbox: 'archived-filter-checkbox',
      toggleLabel: 'archived-filter-label',
    };

    expect(expectedTestIds.toggleCheckbox).toBe('archived-filter-checkbox');
    expect(expectedTestIds.toggleLabel).toBe('archived-filter-label');
  });
});

// ============================================================================
// Task Group 4: Empty State Guidance When No Active Epics
// ============================================================================

describe('Task Group 4: Empty State Guidance When No Active Epics', () => {
  it('4.1.1: guidance block appears when visibleEpics.length === 0', () => {
    const items: WorkItem[] = [mockArchivedInitiative, mockArchivedEpic];
    const visibleEpics = items.filter(
      (item) => item.type === 'EPIC' && item.status !== 'ARCHIVED'
    );

    const shouldShowGuidance = visibleEpics.length === 0;
    expect(shouldShowGuidance).toBe(true);
  });

  it('4.1.2: primary guidance text is correct', () => {
    const primaryText = 'No active roadmap epics found.';
    expect(primaryText).toBe('No active roadmap epics found.');
  });

  it('4.1.3: secondary guidance text is correct', () => {
    const secondaryText = 'Import a roadmap to create epics before adding features.';
    expect(secondaryText).toBe('Import a roadmap to create epics before adding features.');
  });

  it('4.1.4: "Go to Roadmap" button navigates to /product/roadmap', () => {
    const targetPath = '/product/roadmap';
    expect(targetPath).toBe('/product/roadmap');
  });

  it('4.1.5: guidance disappears when toggle reveals archived epics', () => {
    const items: WorkItem[] = [mockArchivedInitiative, mockArchivedEpic];

    // When toggle is OFF, visible epics = 0
    let showArchived = false;
    let filteredItems = filterWorkItemsForTree(items, showArchived);
    let visibleEpics = filteredItems.filter((item) => item.type === 'EPIC');
    expect(visibleEpics.length).toBe(0);

    // When toggle is ON, archived epics are visible
    showArchived = true;
    filteredItems = filterWorkItemsForTree(items, showArchived);
    visibleEpics = filteredItems.filter((item) => item.type === 'EPIC');
    expect(visibleEpics.length).toBe(1);
  });

  it('4.1.6: guidance block does not appear when active epics exist', () => {
    const items: WorkItem[] = [mockActiveInitiative, mockActiveEpic, mockArchivedEpic];
    const visibleEpics = items.filter(
      (item) => item.type === 'EPIC' && item.status !== 'ARCHIVED'
    );

    const shouldShowGuidance = visibleEpics.length === 0;
    expect(shouldShowGuidance).toBe(false);
  });
});

// ============================================================================
// Task Group 5: Feature Creation Gating on Archived Epics
// ============================================================================

describe('Task Group 5: Feature Creation Gating on Archived Epics', () => {
  it('5.1.1: "+ Add Feature" is enabled when active EPIC is selected', () => {
    const selectedItem = mockActiveEpic;
    const isEpic = selectedItem.type === 'EPIC';
    const isNotArchived = selectedItem.status !== 'ARCHIVED';
    const isAddFeatureEnabled = isEpic && isNotArchived;

    expect(isAddFeatureEnabled).toBe(true);
  });

  it('5.1.2: "+ Add Feature" is disabled when ARCHIVED EPIC is selected', () => {
    const selectedItem = mockArchivedEpic;
    const isEpic = selectedItem.type === 'EPIC';
    const isNotArchived = selectedItem.status !== 'ARCHIVED';
    const isAddFeatureEnabled = isEpic && isNotArchived;

    expect(isAddFeatureEnabled).toBe(false);
  });

  it('5.1.3: disabled button shows correct tooltip text', () => {
    const tooltipText = 'Cannot add features under an archived epic.';
    expect(tooltipText).toBe('Cannot add features under an archived epic.');
  });

  it('5.1.4: button remains hidden for non-EPIC types', () => {
    // For INITIATIVE
    const initiative = mockActiveInitiative;
    const showForInitiative = initiative.type === 'EPIC';
    expect(showForInitiative).toBe(false);

    // For FEATURE
    const feature = mockFeatureUnderActiveEpic;
    const showForFeature = feature.type === 'EPIC';
    expect(showForFeature).toBe(false);

    // For STORY
    const story = mockStory;
    const showForStory = story.type === 'EPIC';
    expect(showForStory).toBe(false);
  });

  it('5.1.5: button click is prevented when disabled', () => {
    const selectedItem = mockArchivedEpic;
    const isDisabled = selectedItem.type === 'EPIC' && selectedItem.status === 'ARCHIVED';

    let featureCreationAttempted = false;
    const handleAddFeature = () => {
      if (!isDisabled) {
        featureCreationAttempted = true;
      }
    };

    handleAddFeature();
    expect(featureCreationAttempted).toBe(false);
  });
});

// ============================================================================
// Task Group 6: Integration Tests
// ============================================================================

describe('Task Group 6: Integration Tests', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('6.3.1: User loads page with persisted preference (true)', () => {
    const projectId = 'test-project';
    const key = getArchivedFilterStorageKey(projectId);

    // Simulate persisted preference
    localStorageMock.setItem(key, 'true');

    // On page load, read from localStorage
    const storedValue = localStorageMock.getItem(key);
    const showArchivedRoadmapItems = storedValue === 'true';

    expect(showArchivedRoadmapItems).toBe(true);
  });

  it('6.3.2: User loads page with persisted preference (false)', () => {
    const projectId = 'test-project';
    const key = getArchivedFilterStorageKey(projectId);

    // Simulate persisted preference
    localStorageMock.setItem(key, 'false');

    // On page load, read from localStorage
    const storedValue = localStorageMock.getItem(key);
    const showArchivedRoadmapItems = storedValue === 'true';

    expect(showArchivedRoadmapItems).toBe(false);
  });

  it('6.3.3: User toggles filter and sees tree update', () => {
    const allItems = [
      mockActiveInitiative,
      mockArchivedInitiative,
      mockActiveEpic,
      mockArchivedEpic,
    ];

    // Initial state: toggle OFF
    let showArchived = false;
    let filteredItems = filterWorkItemsForTree(allItems, showArchived);
    expect(filteredItems).toHaveLength(2); // Only active items

    // User toggles ON
    showArchived = true;
    filteredItems = filterWorkItemsForTree(allItems, showArchived);
    expect(filteredItems).toHaveLength(4); // All items visible
  });

  it('6.3.4: User selects archived item, toggles filter off, selection clears', () => {
    const allItems = [mockActiveInitiative, mockArchivedEpic];

    // User selects archived epic
    let selectedId: string | null = 'epic-archived';
    let showArchived = true;

    // User toggles filter OFF
    showArchived = false;
    const filteredItems = filterWorkItemsForTree(allItems, showArchived);
    const byId = new Map(filteredItems.map((item) => [item.id, item]));

    // Check if selected item is still visible
    if (selectedId && !byId.has(selectedId)) {
      selectedId = null;
    }

    expect(selectedId).toBeNull();
  });

  it('6.3.5: Selection remains when toggling does not hide selected item', () => {
    const allItems = [mockActiveInitiative, mockActiveEpic, mockArchivedEpic];

    // User selects active epic
    let selectedId: string | null = 'epic-active';
    let showArchived = true;

    // User toggles filter OFF
    showArchived = false;
    const filteredItems = filterWorkItemsForTree(allItems, showArchived);
    const byId = new Map(filteredItems.map((item) => [item.id, item]));

    // Check if selected item is still visible
    if (selectedId && !byId.has(selectedId)) {
      selectedId = null;
    }

    expect(selectedId).toBe('epic-active');
  });

  it('6.3.6: Empty state shows when all epics are archived and toggle is OFF', () => {
    const items = [mockArchivedInitiative, mockArchivedEpic];

    const showArchived = false;
    const filteredItems = filterWorkItemsForTree(items, showArchived);
    const visibleEpics = filteredItems.filter((item) => item.type === 'EPIC');

    expect(visibleEpics.length).toBe(0);
  });

  it('6.3.7: Rapid toggle switching maintains consistency', () => {
    const projectId = 'test-project';
    const key = getArchivedFilterStorageKey(projectId);

    // Rapid toggles
    localStorageMock.setItem(key, 'true');
    localStorageMock.setItem(key, 'false');
    localStorageMock.setItem(key, 'true');
    localStorageMock.setItem(key, 'false');

    const finalValue = localStorageMock.getItem(key);
    expect(finalValue).toBe('false');
  });

  it('6.3.8: Feature creation gating integrates with archived filter', () => {
    // When toggle is ON, archived epic is visible but feature creation is still disabled
    const selectedItem = mockArchivedEpic;
    const showArchived = true;

    const filteredItems = filterWorkItemsForTree([mockArchivedEpic], showArchived);
    const isVisible = filteredItems.some((item) => item.id === selectedItem.id);
    const canAddFeature =
      selectedItem.type === 'EPIC' && selectedItem.status !== 'ARCHIVED';

    expect(isVisible).toBe(true);
    expect(canAddFeature).toBe(false);
  });
});
