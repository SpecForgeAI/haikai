/**
 * Tests for renderNote shape rendering
 * Spec: Sequence Diagram - Enable Decorations and Add Note Decoration
 * Task Group 2: Note Shape SVG Rendering
 */

import { describe, it, expect } from 'vitest';
import { renderNote, renderShapeDecoration } from '../utils/shapeRendering';

function makeNoteShape(overrides = {}) {
  return {
    id: 'test-note-1',
    type: 'NOTE' as const,
    pos_x: 100,
    pos_y: 200,
    width: 140,
    height: 100,
    rotation: 0,
    text: '',
    text_h_align: 'CENTER' as const,
    text_v_align: 'MIDDLE' as const,
    text_font_size: 14,
    text_font_weight: 'normal',
    text_font_style: 'normal',
    text_color: '#000000',
    background_color: '',
    line_color: '',
    line_weight: '',
    line_style: 'SOLID' as const,
    ...overrides,
  };
}

describe('renderNote', () => {
  it('returns a ShapeRenderResult with valid pathData', () => {
    const result = renderNote(makeNoteShape() as any);
    expect(result).toBeDefined();
    expect(result.pathData).toBeDefined();
    expect(typeof result.pathData).toBe('string');
    expect(result.pathData.length).toBeGreaterThan(0);
    expect(result.pathData).toContain('M');
    expect(result.pathData).toContain('L');
  });

  it('pathData contains a diagonal line for the top-left fold (from (pos_x, pos_y+15) to (pos_x+15, pos_y))', () => {
    const shape = makeNoteShape({ pos_x: 100, pos_y: 200 });
    const result = renderNote(shape as any);
    // The fold diagonal: M 100 215 L 115 200
    expect(result.pathData).toContain('100 215');
    expect(result.pathData).toContain('115 200');
  });

  it('uses #FFEB3B fill by default', () => {
    const result = renderNote(makeNoteShape() as any);
    expect(result.fill).toBe('#FFEB3B');
  });

  it('uses stroke width 3 by default', () => {
    const result = renderNote(makeNoteShape() as any);
    expect(result.strokeWidth).toBe(3);
  });

  it('renderShapeDecoration routes NOTE type to renderNote', () => {
    const shape = makeNoteShape({ text: 'Hello' });
    const result = renderShapeDecoration(shape as any, false);
    expect(result.shape).toBeDefined();
    expect(result.shape.fill).toBe('#FFEB3B');
    expect(result.shape.strokeWidth).toBe(3);
    expect(result.shape.pathData).toContain('115 200');
  });
});
