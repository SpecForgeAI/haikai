/**
 * Activity Shape Bounds Rendering Tests
 * Task Group 1: Shape Rendering from Node Bounds
 * Spec 2026-01-01: Activity Diagram Shape Bounds and Interactive Labels
 *
 * Tests that activity node shapes (Decision, Merge, Initial, Final) are rendered
 * from explicit width/height parameters rather than hardcoded defaults.
 */

import {
  renderDecisionNode,
  renderMergeNode,
  renderInitialNode,
  renderFinalNode,
  renderActivityNode,
} from '../utils/activityNodeRendering';
import { Activity, ActivityKind } from '../types/model';
import { ACTIVITY_NODE_DEFAULTS } from '../config/defaults';

describe('Activity Shape Bounds Rendering', () => {
  describe('renderDecisionNode with custom dimensions', () => {
    it('should render diamond using passed width/height parameters', () => {
      const position = { x: 100, y: 100 };
      const customWidth = 80;
      const customHeight = 80;

      const result = renderDecisionNode(position, customWidth, customHeight);

      // Diamond polygon formula: [(w/2,0), (w,h/2), (w/2,h), (0,h/2)]
      // With center at (100, 100), width 80, height 80:
      // Top: (100, 60), Right: (140, 100), Bottom: (100, 140), Left: (60, 100)
      expect(result.pathData).toContain('M 100 60'); // Top vertex at (cx, cy - h/2)
      expect(result.pathData).toContain('L 140 100'); // Right vertex at (cx + w/2, cy)
      expect(result.pathData).toContain('L 100 140'); // Bottom vertex at (cx, cy + h/2)
      expect(result.pathData).toContain('L 60 100'); // Left vertex at (cx - w/2, cy)
      expect(result.width).toBe(customWidth);
      expect(result.height).toBe(customHeight);
    });

    it('should fall back to defaults when no dimensions provided', () => {
      const position = { x: 100, y: 100 };
      const defaultWidth = ACTIVITY_NODE_DEFAULTS.Decision.width || 60;
      const defaultHeight = ACTIVITY_NODE_DEFAULTS.Decision.height || 60;

      const result = renderDecisionNode(position);

      expect(result.width).toBe(defaultWidth);
      expect(result.height).toBe(defaultHeight);
    });

    it('should produce diamond polygon matching formula [(w/2,0), (w,h/2), (w/2,h), (0,h/2)]', () => {
      const position = { x: 50, y: 50 };
      const width = 40;
      const height = 60;

      const result = renderDecisionNode(position, width, height);

      // With center at (50, 50), width 40, height 60:
      // Top: (50, 20), Right: (70, 50), Bottom: (50, 80), Left: (30, 50)
      expect(result.pathData).toContain('M 50 20'); // Top vertex
      expect(result.pathData).toContain('L 70 50'); // Right vertex
      expect(result.pathData).toContain('L 50 80'); // Bottom vertex
      expect(result.pathData).toContain('L 30 50'); // Left vertex
    });
  });

  describe('renderMergeNode with custom dimensions', () => {
    it('should render diamond using passed width/height parameters', () => {
      const position = { x: 100, y: 100 };
      const customWidth = 30;
      const customHeight = 30;

      const result = renderMergeNode(position, customWidth, customHeight);

      // Diamond with center (100, 100), width 30, height 30:
      // Top: (100, 85), Right: (115, 100), Bottom: (100, 115), Left: (85, 100)
      expect(result.pathData).toContain('M 100 85'); // Top vertex
      expect(result.pathData).toContain('L 115 100'); // Right vertex
      expect(result.pathData).toContain('L 100 115'); // Bottom vertex
      expect(result.pathData).toContain('L 85 100'); // Left vertex
      expect(result.width).toBe(customWidth);
      expect(result.height).toBe(customHeight);
    });

    it('should fall back to smaller default dimensions than Decision', () => {
      const position = { x: 100, y: 100 };
      const mergeDefaults = ACTIVITY_NODE_DEFAULTS.Merge;
      const decisionDefaults = ACTIVITY_NODE_DEFAULTS.Decision;

      const mergeResult = renderMergeNode(position);
      const decisionResult = renderDecisionNode(position);

      // Merge should be smaller than Decision by default
      expect(mergeResult.width).toBeLessThan(decisionResult.width!);
      expect(mergeResult.height).toBeLessThan(decisionResult.height!);
      expect(mergeResult.width).toBe(mergeDefaults.width || 20);
      expect(mergeResult.height).toBe(mergeDefaults.height || 20);
    });
  });

  describe('renderInitialNode with custom dimensions', () => {
    it('should render circle using radius = min(width, height) / 2', () => {
      const position = { x: 100, y: 100 };
      const customWidth = 24;
      const customHeight = 24;

      const result = renderInitialNode(position, customWidth, customHeight);

      // Radius should be min(24, 24) / 2 = 12
      // Circle arc should span radius 12
      expect(result.pathData).toContain('A 12 12'); // Arc with radius 12
    });

    it('should use min dimension for non-square bounds', () => {
      const position = { x: 100, y: 100 };
      const customWidth = 30;
      const customHeight = 20;

      const result = renderInitialNode(position, customWidth, customHeight);

      // Radius should be min(30, 20) / 2 = 10
      expect(result.pathData).toContain('A 10 10'); // Arc with radius 10
    });

    it('should fall back to default diameter when no dimensions provided', () => {
      const position = { x: 100, y: 100 };
      const defaultDiameter = ACTIVITY_NODE_DEFAULTS.Initial.diameter || 18;
      const expectedRadius = defaultDiameter / 2;

      const result = renderInitialNode(position);

      expect(result.pathData).toContain(`A ${expectedRadius} ${expectedRadius}`);
    });
  });

  describe('renderFinalNode with custom dimensions', () => {
    it('should render bullseye using radius = min(width, height) / 2', () => {
      const position = { x: 100, y: 100 };
      const customWidth = 30;
      const customHeight = 30;

      const result = renderFinalNode(position, customWidth, customHeight);

      // Outer radius should be min(30, 30) / 2 = 15
      expect(result.outerPathData).toContain('A 15 15'); // Outer arc with radius 15

      // Inner diameter should be proportionally scaled
      expect(result.innerPathData).toBeDefined();
    });

    it('should preserve inner/outer diameter ratio when scaled', () => {
      const position = { x: 100, y: 100 };
      const defaults = ACTIVITY_NODE_DEFAULTS.Final;
      const defaultOuterDiameter = defaults.diameter || 22;
      const defaultInnerDiameter = defaults.innerDiameter || 14;
      const ratio = defaultInnerDiameter / defaultOuterDiameter;

      const customWidth = 44; // 2x default
      const customHeight = 44;

      const result = renderFinalNode(position, customWidth, customHeight);

      // With 44x44 bounds, outer radius = 22, inner should be scaled proportionally
      const expectedOuterRadius = 22;
      const expectedInnerRadius = expectedOuterRadius * ratio;

      expect(result.outerPathData).toContain(`A ${expectedOuterRadius} ${expectedOuterRadius}`);
      expect(result.innerPathData).toContain(`A ${expectedInnerRadius.toFixed(0)}`);
    });

    it('should fall back to defaults when no dimensions provided', () => {
      const position = { x: 100, y: 100 };
      const defaultDiameter = ACTIVITY_NODE_DEFAULTS.Final.diameter || 22;
      const expectedOuterRadius = defaultDiameter / 2;

      const result = renderFinalNode(position);

      expect(result.outerPathData).toContain(`A ${expectedOuterRadius} ${expectedOuterRadius}`);
    });
  });

  describe('renderActivityNode dispatcher with dimensions', () => {
    it('should pass dimensions to Decision node rendering', () => {
      const activity: Activity = {
        id: 'act-1',
        name: 'Test Decision',
        description: '',
        activity_kind: 'Decision',
        tags: '',
      };
      const position = { x: 100, y: 100 };
      const width = 70;
      const height = 70;

      const result = renderActivityNode(activity, position, width, height);

      expect(result.width).toBe(width);
      expect(result.height).toBe(height);
    });

    it('should pass dimensions to Initial node rendering', () => {
      const activity: Activity = {
        id: 'act-1',
        name: 'Start',
        description: '',
        activity_kind: 'Initial',
        tags: '',
      };
      const position = { x: 100, y: 100 };
      const width = 24;
      const height = 24;

      const result = renderActivityNode(activity, position, width, height);

      // Initial node uses min(width, height)/2 for radius
      expect(result.pathData).toContain('A 12 12');
    });

    it('should use default dimensions when none provided', () => {
      const activity: Activity = {
        id: 'act-1',
        name: 'Test Merge',
        description: '',
        activity_kind: 'Merge',
        tags: '',
      };
      const position = { x: 100, y: 100 };

      const result = renderActivityNode(activity, position);

      const mergeDefaults = ACTIVITY_NODE_DEFAULTS.Merge;
      expect(result.width).toBe(mergeDefaults.width || 20);
      expect(result.height).toBe(mergeDefaults.height || 20);
    });
  });
});
