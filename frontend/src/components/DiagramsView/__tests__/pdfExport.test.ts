/**
 * PDF Export Utility Tests
 *
 * Spec 2026-04-13: Save All Diagrams as PDF
 * Task Group 2, Task 2.1: 6 focused tests for the PDF export utility
 *
 * Test 1: groupDiagramsByBusinessUser groups diagrams by user_role_name / business_user_name, sorted alphabetically
 * Test 2: Within each group, USER_JOURNEY_OVERVIEW diagrams appear first, then USER_JOURNEY sorted alphabetically
 * Test 3: determinePageOrientation returns 'landscape' when width > 1.3x height, 'portrait' otherwise
 * Test 4: buildPdfFilename uses loadedFileName (stripped of extension) + " - User Journey Diagrams.pdf"; fallback when null/empty
 * Test 5: formatTitleDate returns date in "DD Month YYYY" format
 * Test 6: buildTocEntries produces correct structure with page numbers starting at 3
 */

import { describe, it, expect, vi } from 'vitest';

// Mock jspdf and html2canvas so they don't fail during import
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
  determinePageOrientation,
  buildPdfFilename,
  formatTitleDate,
  buildTocEntries,
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

// ============================================================================
// Tests
// ============================================================================

describe('pdfExport', () => {
  describe('groupDiagramsByBusinessUser', () => {
    it('groups USER_JOURNEY by user_role_name and USER_JOURNEY_OVERVIEW by business_user_name, sorted alphabetically by business user', () => {
      const diagrams: Diagram[] = [
        createJourneyDiagram('1', 'Login Flow', 'Charlie'),
        createOverviewDiagram('2', 'Charlie Overview', 'Charlie'),
        createJourneyDiagram('3', 'Checkout Flow', 'Alice'),
        createOverviewDiagram('4', 'Alice Overview', 'Alice'),
        createJourneyDiagram('5', 'Browse Flow', 'Bob'),
      ];

      const groups = groupDiagramsByBusinessUser(diagrams);

      // Should be sorted alphabetically: Alice, Bob, Charlie
      expect(groups).toHaveLength(3);
      expect(groups[0].businessUserName).toBe('Alice');
      expect(groups[1].businessUserName).toBe('Bob');
      expect(groups[2].businessUserName).toBe('Charlie');

      // Alice has 1 overview + 1 journey
      expect(groups[0].diagrams).toHaveLength(2);
      // Bob has 1 journey
      expect(groups[1].diagrams).toHaveLength(1);
      // Charlie has 1 overview + 1 journey
      expect(groups[2].diagrams).toHaveLength(2);
    });

    it('within each group, USER_JOURNEY_OVERVIEW appears first, then USER_JOURNEY sorted alphabetically by name', () => {
      const diagrams: Diagram[] = [
        createJourneyDiagram('1', 'Zebra Journey', 'Alice'),
        createJourneyDiagram('2', 'Apple Journey', 'Alice'),
        createOverviewDiagram('3', 'Alice Overview', 'Alice'),
        createJourneyDiagram('4', 'Mango Journey', 'Alice'),
      ];

      const groups = groupDiagramsByBusinessUser(diagrams);

      expect(groups).toHaveLength(1);
      expect(groups[0].businessUserName).toBe('Alice');
      expect(groups[0].diagrams).toHaveLength(4);

      // First should be the overview
      expect(groups[0].diagrams[0].type).toBe('USER_JOURNEY_OVERVIEW');
      expect(groups[0].diagrams[0].name).toBe('Alice Overview');

      // Then journeys sorted alphabetically
      expect(groups[0].diagrams[1].type).toBe('USER_JOURNEY');
      expect(groups[0].diagrams[1].name).toBe('Apple Journey');
      expect(groups[0].diagrams[2].type).toBe('USER_JOURNEY');
      expect(groups[0].diagrams[2].name).toBe('Mango Journey');
      expect(groups[0].diagrams[3].type).toBe('USER_JOURNEY');
      expect(groups[0].diagrams[3].name).toBe('Zebra Journey');
    });
  });

  describe('determinePageOrientation', () => {
    it('returns landscape when width > 1.3x height, portrait otherwise', () => {
      // Width 1400, height 1000: ratio 1.4 > 1.3 => landscape
      expect(determinePageOrientation(1400, 1000)).toBe('landscape');

      // Width 1300, height 1000: ratio 1.3, NOT exceeding => portrait
      expect(determinePageOrientation(1300, 1000)).toBe('portrait');

      // Width 1000, height 1000: ratio 1.0 => portrait
      expect(determinePageOrientation(1000, 1000)).toBe('portrait');

      // Width 800, height 1200: ratio 0.67 => portrait
      expect(determinePageOrientation(800, 1200)).toBe('portrait');

      // Width 1301, height 1000: ratio 1.301 > 1.3 => landscape
      expect(determinePageOrientation(1301, 1000)).toBe('landscape');
    });
  });

  describe('buildPdfFilename', () => {
    it('uses loadedFileName stripped of extension plus suffix; falls back when null/empty', () => {
      // Normal filename with extension
      expect(buildPdfFilename('MyProject.json')).toBe('MyProject - User Journey Diagrams.pdf');

      // Filename without extension
      expect(buildPdfFilename('MyProject')).toBe('MyProject - User Journey Diagrams.pdf');

      // Filename with multiple dots
      expect(buildPdfFilename('my.project.v2.json')).toBe('my.project.v2 - User Journey Diagrams.pdf');

      // null loadedFileName
      expect(buildPdfFilename(null)).toBe('User Journey Diagrams.pdf');

      // empty string
      expect(buildPdfFilename('')).toBe('User Journey Diagrams.pdf');
    });
  });

  describe('formatTitleDate', () => {
    it('returns date in "DD Month YYYY" format', () => {
      // Use a specific date to avoid timezone issues
      const date = new Date(2026, 3, 13); // April 13, 2026 (month is 0-indexed)
      expect(formatTitleDate(date)).toBe('13 April 2026');

      // Single digit day (no leading zero)
      const date2 = new Date(2026, 0, 3); // January 3, 2026
      expect(formatTitleDate(date2)).toBe('3 January 2026');

      // December
      const date3 = new Date(2025, 11, 25); // December 25, 2025
      expect(formatTitleDate(date3)).toBe('25 December 2025');
    });
  });

  describe('buildTocEntries', () => {
    it('produces correct structure with section headers and diagram entries, page numbers starting at 3', () => {
      const groups = [
        {
          businessUserName: 'Alice',
          diagrams: [
            { diagram: createOverviewDiagram('1', 'Alice Overview', 'Alice'), type: 'USER_JOURNEY_OVERVIEW' as const, name: 'Alice Overview' },
            { diagram: createJourneyDiagram('2', 'Login Flow', 'Alice'), type: 'USER_JOURNEY' as const, name: 'Login Flow' },
          ],
        },
        {
          businessUserName: 'Bob',
          diagrams: [
            { diagram: createJourneyDiagram('3', 'Checkout Flow', 'Bob'), type: 'USER_JOURNEY' as const, name: 'Checkout Flow' },
          ],
        },
      ];

      const entries = buildTocEntries(groups);

      // Should have: Alice header, Alice Overview, Login Flow, Bob header, Checkout Flow = 5 entries
      expect(entries).toHaveLength(5);

      // Alice section header
      expect(entries[0].text).toBe('Alice');
      expect(entries[0].isSection).toBe(true);
      expect(entries[0].pageNumber).toBe(3); // First diagram is page 3 (after title + TOC)
      expect(entries[0].targetPageIndex).toBe(3);

      // Alice Overview
      expect(entries[1].text).toBe('Alice Overview');
      expect(entries[1].isSection).toBe(false);
      expect(entries[1].pageNumber).toBe(3);
      expect(entries[1].targetPageIndex).toBe(3);

      // Login Flow
      expect(entries[2].text).toBe('Login Flow');
      expect(entries[2].isSection).toBe(false);
      expect(entries[2].pageNumber).toBe(4);
      expect(entries[2].targetPageIndex).toBe(4);

      // Bob section header
      expect(entries[3].text).toBe('Bob');
      expect(entries[3].isSection).toBe(true);
      expect(entries[3].pageNumber).toBe(5);
      expect(entries[3].targetPageIndex).toBe(5);

      // Checkout Flow
      expect(entries[4].text).toBe('Checkout Flow');
      expect(entries[4].isSection).toBe(false);
      expect(entries[4].pageNumber).toBe(5);
      expect(entries[4].targetPageIndex).toBe(5);
    });
  });
});
