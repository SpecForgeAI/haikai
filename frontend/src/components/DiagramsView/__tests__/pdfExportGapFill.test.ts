/**
 * PDF Export Gap-Fill Tests
 *
 * Spec 2026-04-13: Save All Diagrams as PDF
 * Task Group 5, Task 5.3: Strategic tests to fill critical coverage gaps.
 *
 * Gap Test 1: groupDiagramsByBusinessUser with empty diagrams array returns empty groups
 * Gap Test 2: groupDiagramsByBusinessUser with only USER_JOURNEY diagrams (no overviews) still groups correctly
 * Gap Test 3: groupDiagramsByBusinessUser correctly handles a diagram where extraction returns null (malformed content) -- skips it
 * Gap Test 4: buildTocEntries generates correct page numbers when multiple groups exist (sequential page counting)
 * Gap Test 5: generatePdf calls onProgress with generating: false even when an error occurs (error recovery)
 *
 * Gaps 5-7 from the task spec (determinePageOrientation at 1.3x, buildPdfFilename with multiple dots,
 * formatTitleDate single-digit days) are already covered by pdfExport.test.ts and are skipped here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock jspdf and html2canvas before importing the module under test
vi.mock('jspdf', () => ({
  default: vi.fn().mockImplementation(() => ({
    setFontSize: vi.fn(),
    setFont: vi.fn(),
    setTextColor: vi.fn(),
    text: vi.fn(),
    addPage: vi.fn(),
    addImage: vi.fn(),
    link: vi.fn(),
    save: vi.fn(),
    outline: { add: vi.fn() },
    getNumberOfPages: vi.fn().mockReturnValue(1),
    getTextWidth: vi.fn().mockReturnValue(50),
  })),
}));

vi.mock('html2canvas', () => ({
  default: vi.fn().mockResolvedValue({
    toDataURL: vi.fn().mockReturnValue('data:image/png;base64,mockdata'),
    width: 800,
    height: 600,
  }),
}));

import {
  groupDiagramsByBusinessUser,
  buildTocEntries,
  generatePdf,
} from '../pdfExport';
import type { Diagram } from '../../../types/model';

// ============================================================================
// Test Helpers
// ============================================================================

function createJourneyDiagram(id: string, name: string, userRoleName: string): Diagram {
  return {
    id,
    name,
    description: '',
    diagram_type: 'USER_JOURNEY',
    diagram_nodes: [],
    diagram_edges: [],
    typedContent: {
      type: 'USER_JOURNEY',
      version: 1,
      content: {
        diagram_type: 'USER_JOURNEY',
        version: '1.0',
        journey: {
          id: `j-${id}`,
          name,
          description: '',
          user_role_id: `ur-${id}`,
          user_role_name: userRoleName,
          parent_business_process_id: 'bp-1',
          parent_business_process_name: 'Process',
        },
        lanes: [{ id: 'l-1', name: 'App', order: 0 }],
        steps: [{ id: 's-1', journey_id: `j-${id}`, order: 0, lane_id: 'l-1', process_activity_id: 'pa-1', process_activity_name: 'Step', name: 'Step 1', diagram_label: 'Step 1', description: '', business_user_id: 'bu-1', business_user_name: userRoleName, activity_issues: '', ui_issues: '' }],
        edges: [{ id: 'e-1', from_step_id: 's-1', to_step_id: 's-2', order: 0, is_cross_lane: false }],
        render_hints: { lane_axis: 'vertical', flow_direction: 'left-to-right', show_title: true },
      } as any,
    },
  };
}

function createOverviewDiagram(id: string, name: string, businessUserName: string): Diagram {
  return {
    id,
    name,
    description: '',
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    diagram_nodes: [],
    diagram_edges: [],
    typedContent: {
      type: 'USER_JOURNEY_OVERVIEW',
      version: 1,
      content: {
        diagram_type: 'USER_JOURNEY_OVERVIEW',
        version: '1.0',
        overview: {
          business_user_id: `bu-${id}`,
          business_user_name: businessUserName,
          title: `${businessUserName} Overview`,
        },
        lanes: [{ id: 'l-1', name: 'Process', order: 0 }],
        nodes: [{ id: 'n-1', lane_id: 'l-1', name: 'Journey', description: '', primary_business_user_id: `bu-${id}`, primary_business_user_name: businessUserName, parent_business_process_id: 'bp-1', parent_business_process_name: 'Process', metadata: { step_count: 3, application_count: 2, relationship_in_count: 1, relationship_out_count: 0 } }],
        edges: [],
        render_hints: { lane_axis: 'vertical', flow_direction: 'left-to-right', show_title: true, show_lane_headers: true, show_node_description: true, show_relationship_labels: true },
      } as any,
    },
  };
}

/**
 * Create a diagram with malformed/missing typed content that extraction will return null for.
 * The diagram_type is USER_JOURNEY but the content is missing required fields (no journey, steps, etc.).
 */
function createMalformedJourneyDiagram(id: string, name: string): Diagram {
  return {
    id,
    name,
    description: '',
    diagram_type: 'USER_JOURNEY',
    diagram_nodes: [],
    diagram_edges: [],
    typedContent: {
      type: 'USER_JOURNEY',
      version: 1,
      content: {
        // Malformed: missing journey, steps, edges fields
        lanes: [{ id: 'l-1', name: 'App', order: 0 }],
      } as any,
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('pdfExport - gap-fill tests', () => {
  describe('groupDiagramsByBusinessUser edge cases', () => {
    it('returns empty groups array when diagrams array is empty', () => {
      const groups = groupDiagramsByBusinessUser([]);
      expect(groups).toHaveLength(0);
      expect(groups).toEqual([]);
    });

    it('groups correctly with only USER_JOURNEY diagrams (no overviews)', () => {
      const diagrams: Diagram[] = [
        createJourneyDiagram('1', 'Login Flow', 'Alice'),
        createJourneyDiagram('2', 'Checkout Flow', 'Alice'),
        createJourneyDiagram('3', 'Browse Flow', 'Bob'),
      ];

      const groups = groupDiagramsByBusinessUser(diagrams);

      // Should have 2 groups: Alice and Bob
      expect(groups).toHaveLength(2);
      expect(groups[0].businessUserName).toBe('Alice');
      expect(groups[1].businessUserName).toBe('Bob');

      // Alice has 2 journeys sorted alphabetically (no overview)
      expect(groups[0].diagrams).toHaveLength(2);
      expect(groups[0].diagrams[0].name).toBe('Checkout Flow');
      expect(groups[0].diagrams[0].type).toBe('USER_JOURNEY');
      expect(groups[0].diagrams[1].name).toBe('Login Flow');
      expect(groups[0].diagrams[1].type).toBe('USER_JOURNEY');

      // Bob has 1 journey
      expect(groups[1].diagrams).toHaveLength(1);
      expect(groups[1].diagrams[0].name).toBe('Browse Flow');
    });

    it('skips diagrams where extraction returns null (malformed content)', () => {
      const diagrams: Diagram[] = [
        createJourneyDiagram('1', 'Valid Journey', 'Alice'),
        createMalformedJourneyDiagram('2', 'Malformed Journey'),
        createOverviewDiagram('3', 'Alice Overview', 'Alice'),
      ];

      const groups = groupDiagramsByBusinessUser(diagrams);

      // Only Alice should have a group with the valid journey and the overview
      expect(groups).toHaveLength(1);
      expect(groups[0].businessUserName).toBe('Alice');
      // 2 diagrams: overview first, then the valid journey
      expect(groups[0].diagrams).toHaveLength(2);
      expect(groups[0].diagrams[0].type).toBe('USER_JOURNEY_OVERVIEW');
      expect(groups[0].diagrams[0].name).toBe('Alice Overview');
      expect(groups[0].diagrams[1].type).toBe('USER_JOURNEY');
      expect(groups[0].diagrams[1].name).toBe('Valid Journey');
    });
  });

  describe('buildTocEntries sequential page counting', () => {
    it('generates correct sequential page numbers across three groups with varying diagram counts', () => {
      const groups = [
        {
          businessUserName: 'Alice',
          diagrams: [
            { diagram: createOverviewDiagram('1', 'Alice Overview', 'Alice'), type: 'USER_JOURNEY_OVERVIEW' as const, name: 'Alice Overview' },
            { diagram: createJourneyDiagram('2', 'Login Flow', 'Alice'), type: 'USER_JOURNEY' as const, name: 'Login Flow' },
            { diagram: createJourneyDiagram('3', 'Checkout Flow', 'Alice'), type: 'USER_JOURNEY' as const, name: 'Checkout Flow' },
          ],
        },
        {
          businessUserName: 'Bob',
          diagrams: [
            { diagram: createJourneyDiagram('4', 'Browse Flow', 'Bob'), type: 'USER_JOURNEY' as const, name: 'Browse Flow' },
          ],
        },
        {
          businessUserName: 'Charlie',
          diagrams: [
            { diagram: createOverviewDiagram('5', 'Charlie Overview', 'Charlie'), type: 'USER_JOURNEY_OVERVIEW' as const, name: 'Charlie Overview' },
            { diagram: createJourneyDiagram('6', 'Search Flow', 'Charlie'), type: 'USER_JOURNEY' as const, name: 'Search Flow' },
          ],
        },
      ];

      const entries = buildTocEntries(groups);

      // 3 section headers + 6 diagram entries = 9 total
      expect(entries).toHaveLength(9);

      // Alice section header -> page 3 (first diagram page after title + TOC)
      expect(entries[0]).toEqual({ text: 'Alice', isSection: true, pageNumber: 3, targetPageIndex: 3 });
      // Alice Overview -> page 3
      expect(entries[1]).toEqual({ text: 'Alice Overview', isSection: false, pageNumber: 3, targetPageIndex: 3 });
      // Login Flow -> page 4
      expect(entries[2]).toEqual({ text: 'Login Flow', isSection: false, pageNumber: 4, targetPageIndex: 4 });
      // Checkout Flow -> page 5
      expect(entries[3]).toEqual({ text: 'Checkout Flow', isSection: false, pageNumber: 5, targetPageIndex: 5 });

      // Bob section header -> page 6 (next page after Alice's last diagram)
      expect(entries[4]).toEqual({ text: 'Bob', isSection: true, pageNumber: 6, targetPageIndex: 6 });
      // Browse Flow -> page 6
      expect(entries[5]).toEqual({ text: 'Browse Flow', isSection: false, pageNumber: 6, targetPageIndex: 6 });

      // Charlie section header -> page 7
      expect(entries[6]).toEqual({ text: 'Charlie', isSection: true, pageNumber: 7, targetPageIndex: 7 });
      // Charlie Overview -> page 7
      expect(entries[7]).toEqual({ text: 'Charlie Overview', isSection: false, pageNumber: 7, targetPageIndex: 7 });
      // Search Flow -> page 8
      expect(entries[8]).toEqual({ text: 'Search Flow', isSection: false, pageNumber: 8, targetPageIndex: 8 });
    });
  });

  describe('generatePdf error recovery', () => {
    it('calls onProgress with generating: false even when an error occurs during generation', async () => {
      const onProgress = vi.fn();

      // Pass diagrams that will cause an error in renderDiagramOffScreen
      // (since document.createElement won't work properly in JSDOM for full rendering,
      // the mock setup will throw when trying to use ReactDOM.createRoot)
      // We use valid-looking diagrams so grouping works, but the off-screen render will fail
      const diagrams: Diagram[] = [
        createJourneyDiagram('1', 'Login Flow', 'Alice'),
      ];

      // The generatePdf function wraps everything in try/catch and resets progress on error
      await generatePdf(diagrams, {}, 'test.json', onProgress);

      // Verify that onProgress was called (at minimum: initial progress + final reset)
      expect(onProgress).toHaveBeenCalled();

      // The last call should always reset progress to generating: false
      const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];
      expect(lastCall).toEqual({ generating: false, current: 0, total: 0 });
    });
  });
});
