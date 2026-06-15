/**
 * Tests for gateway tool wiring: save_roadmap_structure
 *
 * Validates that the new save_roadmap_structure tool is properly registered
 * in the gateway's tool definitions, allow-list, and validation logic.
 */

import { isToolAllowed, validateToolArguments } from '../services/toolExecutor';
import { TOOL_DEFINITIONS } from '../types';

describe('save_roadmap_structure gateway registration', () => {
  it('isToolAllowed returns true for save_roadmap_structure', () => {
    expect(isToolAllowed('save_roadmap_structure')).toBe(true);
  });

  it('validateToolArguments succeeds with required params', () => {
    const result = validateToolArguments('save_roadmap_structure', {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      roadmapJson: '{"initiatives":[]}',
    });
    expect(result.valid).toBe(true);
  });

  it('validateToolArguments fails when projectId is missing', () => {
    const result = validateToolArguments('save_roadmap_structure', {
      roadmapJson: '{"initiatives":[]}',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('projectId');
  });

  it('validateToolArguments fails when roadmapJson is missing', () => {
    const result = validateToolArguments('save_roadmap_structure', {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('roadmapJson');
  });

  it('TOOL_DEFINITIONS contains save_roadmap_structure with both required params', () => {
    const definition = TOOL_DEFINITIONS.find(
      (def) => def.function.name === 'save_roadmap_structure'
    );
    expect(definition).toBeDefined();
    expect(definition!.function.parameters.required).toContain('projectId');
    expect(definition!.function.parameters.required).toContain('roadmapJson');
  });
});
