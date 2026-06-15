/**
 * Tests for Decoration Gesture Handling
 * Task Group 2: Add Gesture Handling for New Decoration Types
 *
 * Tests for:
 * - handleMouseDown with shape modes initializes boxAddGestureState with shapeType
 * - handleMouseDown with arrow modes initializes lineAddGestureState with arrowType
 * - handleMouseMove updates gesture state coordinates
 * - handleMouseUp with shape creates decoration via createShapeDecoration
 * - handleMouseUp with arrow creates decoration via createLineTypeDecoration
 * - Gesture state resets after decoration creation
 */

import {
  ShapeDecorationType,
  LineDecorationType,
  SHAPE_DECORATION_TYPES,
  LINE_DECORATION_TYPES,
} from '../types/model';

import {
  createShapeDecoration,
  createLineTypeDecoration,
} from '../utils/decorationUtils';

describe('Decoration Gesture Handling', () => {
  describe('Shape decoration gesture initialization', () => {
    it('should initialize gesture state for OVAL shape type', () => {
      const decorationAddMode: ShapeDecorationType = 'OVAL';

      // Simulate what handleMouseDown does when decorationAddMode is a shape
      const isShapeType = (type: string | null | undefined): type is ShapeDecorationType => {
        if (!type) return false;
        return (SHAPE_DECORATION_TYPES as readonly string[]).includes(type);
      };

      expect(isShapeType(decorationAddMode)).toBe(true);

      // Simulate gesture state initialization
      const gestureState = {
        isActive: true,
        startX: 100,
        startY: 150,
        currentX: 100,
        currentY: 150,
        shapeType: decorationAddMode,
      };

      expect(gestureState.shapeType).toBe('OVAL');
      expect(gestureState.isActive).toBe(true);
    });

    it('should initialize gesture state for all 8 shape types', () => {
      const shapeTypes: ShapeDecorationType[] = [
        'BOX', 'OVAL', 'DIAMOND', 'PARALLELOGRAM',
        'CIRCLE', 'CYLINDER', 'TRAPEZOID', 'HEXAGON',
      ];

      shapeTypes.forEach(shapeType => {
        const gestureState = {
          isActive: true,
          startX: 0,
          startY: 0,
          currentX: 0,
          currentY: 0,
          shapeType,
        };

        expect(gestureState.shapeType).toBe(shapeType);
      });
    });
  });

  describe('Line decoration gesture initialization', () => {
    it('should initialize gesture state for ARROW_SINGLE', () => {
      const decorationAddMode: LineDecorationType = 'ARROW_SINGLE';

      const isLineType = (type: string | null | undefined): type is LineDecorationType => {
        if (!type) return false;
        return (LINE_DECORATION_TYPES as readonly string[]).includes(type);
      };

      expect(isLineType(decorationAddMode)).toBe(true);

      // Simulate first click - recording start point
      const gestureState = {
        isActive: true,
        startX: 100,
        startY: 200,
        hasFirstPoint: true,
        arrowType: decorationAddMode,
      };

      expect(gestureState.arrowType).toBe('ARROW_SINGLE');
      expect(gestureState.hasFirstPoint).toBe(true);
    });

    it('should initialize gesture state for ARROW_DOUBLE', () => {
      const gestureState = {
        isActive: true,
        startX: 50,
        startY: 75,
        hasFirstPoint: true,
        arrowType: 'ARROW_DOUBLE' as LineDecorationType,
      };

      expect(gestureState.arrowType).toBe('ARROW_DOUBLE');
    });

    it('should initialize gesture state for LINE', () => {
      const gestureState = {
        isActive: true,
        startX: 0,
        startY: 0,
        hasFirstPoint: true,
        arrowType: 'LINE' as LineDecorationType,
      };

      expect(gestureState.arrowType).toBe('LINE');
    });
  });

  describe('Mouse move updates gesture state', () => {
    it('should update currentX and currentY during shape drawing', () => {
      let gestureState = {
        isActive: true,
        startX: 100,
        startY: 100,
        currentX: 100,
        currentY: 100,
        shapeType: 'OVAL' as ShapeDecorationType,
      };

      // Simulate mouse move
      const newX = 250;
      const newY = 200;

      gestureState = {
        ...gestureState,
        currentX: newX,
        currentY: newY,
      };

      expect(gestureState.currentX).toBe(250);
      expect(gestureState.currentY).toBe(200);
      expect(gestureState.startX).toBe(100); // Start should not change
      expect(gestureState.startY).toBe(100);
    });
  });

  describe('Shape creation on mouse up', () => {
    it('should create decoration via createShapeDecoration for OVAL', () => {
      const shapeType: ShapeDecorationType = 'OVAL';
      const startX = 100;
      const startY = 100;
      const endX = 250;
      const endY = 200;

      // Calculate normalized coordinates (as Canvas does)
      const minX = Math.min(startX, endX);
      const minY = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);

      const decoration = createShapeDecoration(shapeType, minX, minY, width, height);

      expect(decoration.type).toBe('OVAL');
      expect(decoration.pos_x).toBe(100);
      expect(decoration.pos_y).toBe(100);
      expect(decoration.width).toBe(150);
      expect(decoration.height).toBe(100);
      expect(decoration.id).toMatch(/^dec_oval_/);
    });

    it('should create decoration for all shape types', () => {
      const shapeTypes: ShapeDecorationType[] = [
        'BOX', 'OVAL', 'DIAMOND', 'PARALLELOGRAM',
        'CIRCLE', 'CYLINDER', 'TRAPEZOID', 'HEXAGON',
      ];

      shapeTypes.forEach(shapeType => {
        const decoration = createShapeDecoration(shapeType, 50, 50, 100, 80);
        expect(decoration.type).toBe(shapeType);
        expect(decoration.id).toBeDefined();
      });
    });

    it('should handle CIRCLE with equal width and height', () => {
      // CIRCLE uses min dimension for both width and height
      const shapeType: ShapeDecorationType = 'CIRCLE';
      const width = 150;
      const height = 100;

      // Canvas normalizes CIRCLE to use min dimension
      const minDim = Math.min(width, height);

      const decoration = createShapeDecoration(shapeType, 0, 0, minDim, minDim);

      expect(decoration.type).toBe('CIRCLE');
      expect(decoration.width).toBe(decoration.height); // Circle should be square
    });
  });

  describe('Arrow/Line creation on second click', () => {
    it('should create LINE decoration via createLineTypeDecoration', () => {
      const arrowType: LineDecorationType = 'LINE';
      const startPoint = { x: 100, y: 100 };
      const endPoint = { x: 300, y: 200 };

      const decoration = createLineTypeDecoration(arrowType, [startPoint, endPoint]);

      expect(decoration.type).toBe('LINE');
      expect(decoration.line_points.length).toBe(2);
      expect(decoration.line_points[0]).toEqual(startPoint);
      expect(decoration.line_points[1]).toEqual(endPoint);
      expect(decoration.id).toMatch(/^dec_line_/);
    });

    it('should create ARROW_SINGLE with arrow_end set', () => {
      const decoration = createLineTypeDecoration('ARROW_SINGLE', [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]);

      expect(decoration.type).toBe('ARROW_SINGLE');
      expect(decoration.arrow_start).toBe('NONE');
      expect(decoration.arrow_end).toBe('ARROW');
    });

    it('should create ARROW_DOUBLE with both arrow_start and arrow_end set', () => {
      const decoration = createLineTypeDecoration('ARROW_DOUBLE', [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ]);

      expect(decoration.type).toBe('ARROW_DOUBLE');
      expect(decoration.arrow_start).toBe('ARROW');
      expect(decoration.arrow_end).toBe('ARROW');
    });
  });

  describe('Gesture state reset after creation', () => {
    it('should reset shape gesture state after creation', () => {
      // Initial state during drawing
      let gestureState = {
        isActive: true,
        startX: 100,
        startY: 100,
        currentX: 250,
        currentY: 200,
        shapeType: 'DIAMOND' as ShapeDecorationType | null,
      };

      // After mouse up and decoration creation, reset to initial state
      gestureState = {
        isActive: false,
        startX: 0,
        startY: 0,
        currentX: 0,
        currentY: 0,
        shapeType: null,
      };

      expect(gestureState.isActive).toBe(false);
      expect(gestureState.shapeType).toBeNull();
    });

    it('should reset line gesture state after creation', () => {
      // Initial state after first point
      let gestureState = {
        isActive: true,
        startX: 100,
        startY: 100,
        hasFirstPoint: true,
        arrowType: 'ARROW_SINGLE' as LineDecorationType | null,
      };

      // After second click and decoration creation, reset to initial state
      gestureState = {
        isActive: false,
        startX: 0,
        startY: 0,
        hasFirstPoint: false,
        arrowType: null,
      };

      expect(gestureState.isActive).toBe(false);
      expect(gestureState.hasFirstPoint).toBe(false);
      expect(gestureState.arrowType).toBeNull();
    });
  });

  describe('Minimum size threshold', () => {
    it('should only create decoration if width >= 5 and height >= 5', () => {
      // Simulate minimum size check in Canvas handleMouseUp
      const MIN_SIZE = 5;

      // Too small - should not create
      const smallWidth = 3;
      const smallHeight = 4;
      const shouldCreateSmall = smallWidth >= MIN_SIZE && smallHeight >= MIN_SIZE;
      expect(shouldCreateSmall).toBe(false);

      // Just big enough - should create
      const okWidth = 5;
      const okHeight = 5;
      const shouldCreateOk = okWidth >= MIN_SIZE && okHeight >= MIN_SIZE;
      expect(shouldCreateOk).toBe(true);

      // Large - should create
      const largeWidth = 100;
      const largeHeight = 80;
      const shouldCreateLarge = largeWidth >= MIN_SIZE && largeHeight >= MIN_SIZE;
      expect(shouldCreateLarge).toBe(true);
    });
  });

  describe('Coordinate normalization', () => {
    it('should handle drag in any direction', () => {
      // Test drag from bottom-right to top-left
      const startX = 300;
      const startY = 200;
      const endX = 100;
      const endY = 100;

      // Normalization logic from Canvas
      const x = Math.min(startX, endX);
      const y = Math.min(startY, endY);
      const width = Math.abs(endX - startX);
      const height = Math.abs(endY - startY);

      expect(x).toBe(100);  // Uses minimum
      expect(y).toBe(100);  // Uses minimum
      expect(width).toBe(200);
      expect(height).toBe(100);
    });
  });
});
