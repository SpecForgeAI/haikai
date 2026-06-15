/**
 * Tests for Task Group 3: saveTemporaryArchitectureDiagram tool registration
 *
 * Tests verify:
 * 1. Tool name is in ALLOWED_TOOL_NAMES
 * 2. TOOL_DEFINITIONS has correct entry with name, required params, and description
 * 3. validateToolArguments rejects missing params and accepts valid ones
 */

import {
  ToolName,
  ALLOWED_TOOL_NAMES,
  TOOL_DEFINITIONS,
} from '../types/tools';

import {
  isToolAllowed,
  validateToolArguments,
} from '../services/toolExecutor';

describe('saveTemporaryArchitectureDiagram -- Gateway Tool Registration', () => {
  // ============================================================================
  // Test 1: saveTemporaryArchitectureDiagram is in ALLOWED_TOOL_NAMES
  // ============================================================================
  it('is present in ALLOWED_TOOL_NAMES and recognized by isToolAllowed', () => {
    // Verify it is in ALLOWED_TOOL_NAMES (which mirrors the ToolName union)
    expect(ALLOWED_TOOL_NAMES).toContain('saveTemporaryArchitectureDiagram');

    // Verify isToolAllowed recognizes it
    expect(isToolAllowed('saveTemporaryArchitectureDiagram')).toBe(true);
  });

  // ============================================================================
  // Test 2: TOOL_DEFINITIONS has correct entry with name, required params,
  //         and description
  // ============================================================================
  it('has a TOOL_DEFINITIONS entry with correct name, required params, and description', () => {
    const toolDef = TOOL_DEFINITIONS.find(
      (def) => def.function.name === 'saveTemporaryArchitectureDiagram'
    );
    expect(toolDef).toBeDefined();
    expect(toolDef!.type).toBe('function');
    expect(toolDef!.function.name).toBe('saveTemporaryArchitectureDiagram');

    // Verify description exists and is non-empty
    expect(typeof toolDef!.function.description).toBe('string');
    expect(toolDef!.function.description.length).toBeGreaterThan(0);

    // Verify required params are exactly projectId and diagramJson
    expect(toolDef!.function.parameters.required).toEqual(
      expect.arrayContaining(['projectId', 'diagramJson'])
    );
    expect(toolDef!.function.parameters.required).toHaveLength(2);

    // Verify parameter properties exist with correct types
    const props = toolDef!.function.parameters.properties;
    expect(props.projectId).toBeDefined();
    expect(props.projectId.type).toBe('string');
    expect(props.diagramJson).toBeDefined();
    expect(props.diagramJson.type).toBe('string');
  });

  // ============================================================================
  // Test 3: validateToolArguments rejects missing params and accepts valid ones
  // ============================================================================
  it('validateToolArguments rejects missing params and accepts valid ones', () => {
    // Missing all required params
    const missingAll = validateToolArguments('saveTemporaryArchitectureDiagram' as ToolName, {});
    expect(missingAll.valid).toBe(false);
    expect(missingAll.error).toContain('projectId');

    // Missing diagramJson
    const missingDiagramJson = validateToolArguments('saveTemporaryArchitectureDiagram' as ToolName, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(missingDiagramJson.valid).toBe(false);
    expect(missingDiagramJson.error).toContain('diagramJson');

    // Missing projectId
    const missingProjectId = validateToolArguments('saveTemporaryArchitectureDiagram' as ToolName, {
      diagramJson: '{"id":"diag-1","name":"Test","diagram_kind":"ER","nodes":[],"edges":[],"version":1}',
    });
    expect(missingProjectId.valid).toBe(false);
    expect(missingProjectId.error).toContain('projectId');

    // All required params present: should be valid
    const allPresent = validateToolArguments('saveTemporaryArchitectureDiagram' as ToolName, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      diagramJson: '{"id":"diag-1","name":"Test ER Diagram","diagram_kind":"ER","nodes":[],"edges":[],"version":1}',
    });
    expect(allPresent.valid).toBe(true);
  });
});
