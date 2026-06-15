/**
 * State Node Rendering with Custom Dimensions Tests
 * Task Group 2: State Diagram UX Fixes
 *
 * Tests for dimension-aware rendering:
 * - renderInitialStateNode() uses customWidth/customHeight for radius
 * - renderNormalStateNode() uses customWidth/customHeight for bounds
 * - renderFinalStateNode() scales outer/inner radii proportionally
 * - renderStateNode() dispatcher passes dimensions correctly
 */

import { State } from '../types/model';
import {
  renderInitialStateNode,
  renderNormalStateNode,
  renderFinalStateNode,
  renderStateNode,
} from '../utils/stateNodeRendering';

describe('renderInitialStateNode with custom dimensions', () => {
  it('uses customWidth/customHeight for radius calculation', () => {
    const position = { x: 100, y: 100 };

    // Default rendering (no custom dimensions)
    const defaultResult = renderInitialStateNode(position);

    // Custom dimensions (larger)
    const customResult = renderInitialStateNode(position, 40, 40);

    // The path should contain different radius values
    expect(defaultResult.pathData).not.toBe(customResult.pathData);

    // Custom result should have larger radius (40/2 = 20 vs default 18/2 = 9)
    expect(customResult.pathData).toContain('20');
  });

  it('uses min(width, height) for radius when dimensions differ', () => {
    const position = { x: 100, y: 100 };

    // Asymmetric dimensions (should use smaller)
    const result = renderInitialStateNode(position, 60, 40);

    // Radius should be min(60, 40) / 2 = 20
    expect(result.pathData).toContain('20');
  });

  it('falls back to default diameter when dimensions not provided', () => {
    const position = { x: 100, y: 100 };

    const result = renderInitialStateNode(position);

    // Default diameter is 18, radius is 9
    expect(result.pathData).toContain('9');
  });
});

describe('renderNormalStateNode with custom dimensions', () => {
  it('uses customWidth/customHeight for rectangle bounds', () => {
    const position = { x: 100, y: 100 };

    const result = renderNormalStateNode(position, 200, 80);

    expect(result.width).toBe(200);
    expect(result.height).toBe(80);
  });

  it('returns correct bounds in path data', () => {
    const position = { x: 100, y: 100 };

    const result = renderNormalStateNode(position, 100, 60);

    // Path should use these dimensions
    // Left edge = 100 - 100/2 = 50
    // Top edge = 100 - 60/2 = 70
    expect(result.pathData).toContain('50');
    expect(result.pathData).toContain('70');
  });

  it('falls back to default dimensions when not provided', () => {
    const position = { x: 100, y: 100 };

    const result = renderNormalStateNode(position);

    // Default is 140x50
    expect(result.width).toBe(140);
    expect(result.height).toBe(50);
  });

  it('limits corner radius to half of smallest dimension', () => {
    const position = { x: 100, y: 100 };

    // Very small node where corner radius would exceed half dimension
    const result = renderNormalStateNode(position, 10, 10);

    // Should still produce valid path
    expect(result.pathData).toBeDefined();
    expect(result.width).toBe(10);
    expect(result.height).toBe(10);
  });
});

describe('renderFinalStateNode with custom dimensions', () => {
  it('scales outer/inner radii proportionally', () => {
    const position = { x: 100, y: 100 };

    // Default (22px outer, 14px inner - ratio 14/22 = 0.636)
    const defaultResult = renderFinalStateNode(position);

    // Custom larger size (44px)
    const customResult = renderFinalStateNode(position, 44, 44);

    // Outer radius should be 44/2 = 22
    expect(customResult.outerPathData).toContain('22');

    // Inner radius should be proportionally scaled: 22 * (14/22) = 14
    expect(customResult.innerPathData).toContain('14');
  });

  it('uses min(width, height) for outer radius', () => {
    const position = { x: 100, y: 100 };

    // Asymmetric dimensions
    const result = renderFinalStateNode(position, 60, 40);

    // Outer radius should be min(60, 40) / 2 = 20
    expect(result.outerPathData).toContain('20');
  });

  it('produces separate outer and inner path data', () => {
    const position = { x: 100, y: 100 };

    const result = renderFinalStateNode(position, 40, 40);

    expect(result.outerPathData).toBeDefined();
    expect(result.innerPathData).toBeDefined();
    expect(result.outerPathData).not.toBe(result.innerPathData);
  });

  it('falls back to default diameter when not provided', () => {
    const position = { x: 100, y: 100 };

    const result = renderFinalStateNode(position);

    // Default outer diameter is 22, radius is 11
    expect(result.outerPathData).toContain('11');
  });
});

describe('renderStateNode dispatcher with dimensions', () => {
  const position = { x: 100, y: 100 };

  it('passes dimensions to Initial state render function', () => {
    const state: State = { id: 'state-1', name: 'Start', state_kind: 'Initial' };

    const resultWithDims = renderStateNode(state, position, 30, 30);
    const resultWithoutDims = renderStateNode(state, position);

    // Results should differ
    expect(resultWithDims.pathData).not.toBe(resultWithoutDims.pathData);
  });

  it('passes dimensions to Normal state render function', () => {
    const state: State = { id: 'state-2', name: 'Active', state_kind: 'Normal' };

    const result = renderStateNode(state, position, 180, 70);

    expect(result.width).toBe(180);
    expect(result.height).toBe(70);
  });

  it('passes dimensions to Final state render function', () => {
    const state: State = { id: 'state-3', name: 'End', state_kind: 'Final' };

    const resultWithDims = renderStateNode(state, position, 40, 40);
    const resultWithoutDims = renderStateNode(state, position);

    // Results should differ
    expect(resultWithDims.pathData).not.toBe(resultWithoutDims.pathData);
    expect(resultWithDims.outerPathData).not.toBe(resultWithoutDims.outerPathData);
  });

  it('defaults to Normal rendering for unknown state_kind', () => {
    const state: State = { id: 'state-4', name: 'Unknown' } as State;

    const result = renderStateNode(state, position, 150, 60);

    // Should have Normal state properties (width/height, showLabel)
    expect(result.width).toBe(150);
    expect(result.height).toBe(60);
    expect(result.showLabel).toBe(true);
  });
});
