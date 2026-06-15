/**
 * Activity Partition Rendering Tests
 * Task Group 3: Partition Swimlane Component
 *
 * Tests for partition swimlane rendering functions:
 * - Test partition renders with header and body regions
 * - Test VERTICAL orientation renders header at top, lane extending down
 * - Test HORIZONTAL orientation renders header on left, lane extending right
 * - Test partition without orientation defaults to VERTICAL
 * - Test partition name displays centered in header
 *
 * Updated: Text centering now uses dominant-baseline="middle" for proper vertical centering
 */

import {
  renderPartition,
  PartitionRenderResult,
  PartitionRenderProps,
} from '../utils/activityPartitionRendering';
import { ACTIVITY_PARTITION_DEFAULTS } from '../config/defaults';
import { ActivityPartition, ActivityDiagramOrientation } from '../types/model';

describe('Activity Partition Rendering', () => {
  // Common test data
  const basePartition: ActivityPartition = {
    id: 'partition-1',
    name: 'User Actions',
  };

  const baseProps: PartitionRenderProps = {
    partition: basePartition,
    position: { x: 100, y: 50 },
    dimensions: { width: 200, height: 400 },
    orientation: 'VERTICAL',
    children: [],
  };

  /**
   * Test 1: Partition renders with header and body regions
   */
  describe('partition structure', () => {
    it('should render partition with header and body regions', () => {
      const result = renderPartition(baseProps);

      // Verify result structure
      expect(result).toBeDefined();
      expect(result.headerRect).toBeDefined();
      expect(result.bodyRect).toBeDefined();
      expect(result.dividerLine).toBeDefined();
      expect(result.textElement).toBeDefined();

      // Verify header dimensions exist
      expect(result.headerRect.x).toBeDefined();
      expect(result.headerRect.y).toBeDefined();
      expect(result.headerRect.width).toBeDefined();
      expect(result.headerRect.height).toBeDefined();

      // Verify body dimensions exist
      expect(result.bodyRect.x).toBeDefined();
      expect(result.bodyRect.y).toBeDefined();
      expect(result.bodyRect.width).toBeDefined();
      expect(result.bodyRect.height).toBeDefined();

      // Verify divider line exists
      expect(result.dividerLine.x1).toBeDefined();
      expect(result.dividerLine.y1).toBeDefined();
      expect(result.dividerLine.x2).toBeDefined();
      expect(result.dividerLine.y2).toBeDefined();

      // Verify full border around partition
      expect(result.fullBorderRect).toBeDefined();
      expect(result.fullBorderRect.x).toBe(baseProps.position.x);
      expect(result.fullBorderRect.y).toBe(baseProps.position.y);
      expect(result.fullBorderRect.width).toBe(baseProps.dimensions.width);
      expect(result.fullBorderRect.height).toBe(baseProps.dimensions.height);

      // Verify header has distinct background from body
      expect(result.headerRect.fill).toBe(ACTIVITY_PARTITION_DEFAULTS.header_background);
      expect(result.bodyRect.fill).toBe(ACTIVITY_PARTITION_DEFAULTS.body_background);
      expect(result.headerRect.fill).not.toBe(result.bodyRect.fill);
    });
  });

  /**
   * Test 2: VERTICAL orientation renders header at top, lane extending down
   */
  describe('VERTICAL orientation', () => {
    it('should render header at top and lane extending down', () => {
      const props: PartitionRenderProps = {
        ...baseProps,
        orientation: 'VERTICAL',
      };
      const result = renderPartition(props);

      const { position, dimensions } = props;
      const headerHeight = ACTIVITY_PARTITION_DEFAULTS.header_height;

      // Header should be at top
      expect(result.headerRect.x).toBe(position.x);
      expect(result.headerRect.y).toBe(position.y);
      expect(result.headerRect.width).toBe(dimensions.width);
      expect(result.headerRect.height).toBe(headerHeight);

      // Body should extend from below header to bottom
      expect(result.bodyRect.x).toBe(position.x);
      expect(result.bodyRect.y).toBe(position.y + headerHeight);
      expect(result.bodyRect.width).toBe(dimensions.width);
      expect(result.bodyRect.height).toBe(dimensions.height - headerHeight);

      // Divider should be horizontal, between header and body
      expect(result.dividerLine.x1).toBe(position.x);
      expect(result.dividerLine.y1).toBe(position.y + headerHeight);
      expect(result.dividerLine.x2).toBe(position.x + dimensions.width);
      expect(result.dividerLine.y2).toBe(position.y + headerHeight);

      // Verify lane extends from top to bottom
      expect(result.bodyRect.y + result.bodyRect.height).toBe(position.y + dimensions.height);
    });
  });

  /**
   * Test 3: HORIZONTAL orientation renders header on left, lane extending right
   */
  describe('HORIZONTAL orientation', () => {
    it('should render header on left and lane extending right', () => {
      const props: PartitionRenderProps = {
        ...baseProps,
        orientation: 'HORIZONTAL',
      };
      const result = renderPartition(props);

      const { position, dimensions } = props;
      // For horizontal, header height acts as header width
      const headerWidth = ACTIVITY_PARTITION_DEFAULTS.header_height;

      // Header should be on left
      expect(result.headerRect.x).toBe(position.x);
      expect(result.headerRect.y).toBe(position.y);
      expect(result.headerRect.width).toBe(headerWidth);
      expect(result.headerRect.height).toBe(dimensions.height);

      // Body should extend from right of header to right edge
      expect(result.bodyRect.x).toBe(position.x + headerWidth);
      expect(result.bodyRect.y).toBe(position.y);
      expect(result.bodyRect.width).toBe(dimensions.width - headerWidth);
      expect(result.bodyRect.height).toBe(dimensions.height);

      // Divider should be vertical, between header and body
      expect(result.dividerLine.x1).toBe(position.x + headerWidth);
      expect(result.dividerLine.y1).toBe(position.y);
      expect(result.dividerLine.x2).toBe(position.x + headerWidth);
      expect(result.dividerLine.y2).toBe(position.y + dimensions.height);

      // Verify lane extends from left to right
      expect(result.bodyRect.x + result.bodyRect.width).toBe(position.x + dimensions.width);
    });
  });

  /**
   * Test 4: Partition without orientation defaults to VERTICAL
   */
  describe('default orientation', () => {
    it('should default to VERTICAL when orientation is not specified', () => {
      // Props without orientation specified
      const props: PartitionRenderProps = {
        partition: basePartition,
        position: { x: 100, y: 50 },
        dimensions: { width: 200, height: 400 },
        children: [],
        // orientation not provided
      };
      const result = renderPartition(props);

      const { position, dimensions } = props;
      const headerHeight = ACTIVITY_PARTITION_DEFAULTS.header_height;

      // Should behave like VERTICAL orientation
      // Header at top
      expect(result.headerRect.x).toBe(position.x);
      expect(result.headerRect.y).toBe(position.y);
      expect(result.headerRect.height).toBe(headerHeight);

      // Body below header
      expect(result.bodyRect.y).toBe(position.y + headerHeight);

      // Divider should be horizontal (indicating VERTICAL layout)
      expect(result.dividerLine.y1).toBe(result.dividerLine.y2);
    });
  });

  /**
   * Test 5: Partition name displays centered in header
   * Updated: Implementation uses dominant-baseline="middle" for vertical centering
   */
  describe('header text rendering', () => {
    it('should display partition name centered in header', () => {
      const partitionWithName: ActivityPartition = {
        id: 'partition-2',
        name: 'Customer Service',
      };
      const props: PartitionRenderProps = {
        ...baseProps,
        partition: partitionWithName,
        orientation: 'VERTICAL',
      };
      const result = renderPartition(props);

      const { position, dimensions } = props;
      const headerHeight = ACTIVITY_PARTITION_DEFAULTS.header_height;

      // Text element should exist
      expect(result.textElement).toBeDefined();
      expect(result.textElement.content).toBe('Customer Service');

      // Text should be centered horizontally in header
      const expectedCenterX = position.x + dimensions.width / 2;
      expect(result.textElement.x).toBe(expectedCenterX);

      // Text should be centered vertically in header
      // Using dominant-baseline="middle", y is exactly at center
      const expectedCenterY = position.y + headerHeight / 2;
      expect(result.textElement.y).toBe(expectedCenterY);

      // Text anchor should be middle for centering
      expect(result.textElement.textAnchor).toBe('middle');

      // Should use dominant-baseline: middle for vertical centering
      expect(result.textElement.dominantBaseline).toBe('middle');
    });

    it('should center partition name in header for HORIZONTAL orientation', () => {
      const partitionWithName: ActivityPartition = {
        id: 'partition-3',
        name: 'Backend System',
      };
      const props: PartitionRenderProps = {
        ...baseProps,
        partition: partitionWithName,
        orientation: 'HORIZONTAL',
      };
      const result = renderPartition(props);

      const { position, dimensions } = props;
      const headerWidth = ACTIVITY_PARTITION_DEFAULTS.header_height;

      // Text element should exist
      expect(result.textElement).toBeDefined();
      expect(result.textElement.content).toBe('Backend System');

      // Text should be centered horizontally in header (which is on the left)
      const expectedCenterX = position.x + headerWidth / 2;
      expect(result.textElement.x).toBe(expectedCenterX);

      // Text should be centered vertically in header
      // Using dominant-baseline="middle", y is exactly at center
      const expectedCenterY = position.y + dimensions.height / 2;
      expect(result.textElement.y).toBe(expectedCenterY);

      // Should use dominant-baseline: middle for vertical centering
      expect(result.textElement.dominantBaseline).toBe('middle');
    });

    it('should handle partition without name gracefully', () => {
      const partitionWithoutName: ActivityPartition = {
        id: 'partition-4',
        // name not provided
      };
      const props: PartitionRenderProps = {
        ...baseProps,
        partition: partitionWithoutName,
      };
      const result = renderPartition(props);

      // Should fallback to partition.id per resolvePartitionDisplayName
      expect(result.textElement.content).toBe('partition-4');
    });
  });

  /**
   * Additional test: Data attributes for selection/interaction
   */
  describe('data attributes', () => {
    it('should include data attributes for selection and interaction', () => {
      const result = renderPartition(baseProps);

      // Verify data attributes exist
      expect(result.dataAttributes).toBeDefined();
      expect(result.dataAttributes['data-partition-id']).toBe(basePartition.id);
      expect(result.dataAttributes['data-entity-type']).toBe('ACTIVITY_PARTITION');
    });
  });
});
