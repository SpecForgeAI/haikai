/**
 * Tests for NOTE decoration type registration and factory
 * Task Group 1: Note Decoration Type, Defaults, and Factory
 */
import { DECORATION_TYPES, SHAPE_DECORATION_TYPES } from '../types/model';
import { isShapeDecoration, createShapeDecoration } from '../utils/decorationUtils';

describe('NOTE decoration type and factory', () => {
  test("'NOTE' is included in DECORATION_TYPES array", () => {
    expect(DECORATION_TYPES).toContain('NOTE');
  });

  test("'NOTE' is included in SHAPE_DECORATION_TYPES array", () => {
    expect(SHAPE_DECORATION_TYPES).toContain('NOTE');
  });

  test("isShapeDecoration returns true for a decoration with type 'NOTE'", () => {
    const noteDecoration = {
      id: 'test_note_1',
      type: 'NOTE',
      pos_x: 100,
      pos_y: 200,
      width: 140,
      height: 100,
    };
    expect(isShapeDecoration(noteDecoration)).toBe(true);
  });

  test("createShapeDecoration('NOTE', ...) returns a shape decoration with correct defaults", () => {
    const result = createShapeDecoration('NOTE', 50, 60, 140, 100);
    expect(result.type).toBe('NOTE');
    expect(result.pos_x).toBe(50);
    expect(result.pos_y).toBe(60);
    expect(result.width).toBe(140);
    expect(result.height).toBe(100);
    expect(result.background_color).toBe('#FFEB3B');
  });
});
