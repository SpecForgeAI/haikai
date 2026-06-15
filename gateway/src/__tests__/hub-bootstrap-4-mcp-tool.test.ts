/**
 * Tests for Task Group 2: save_markdown_artifact MCP tool registration
 *
 * Tests verify:
 * 1. Gateway tool type definitions (ToolName, ALLOWED_TOOL_NAMES, TOOL_DEFINITIONS)
 * 2. Gateway executor mappings (TOOL_ENDPOINTS, TOOL_REQUIRED_PARAMS)
 */

import {
  ToolName,
  ALLOWED_TOOL_NAMES,
  TOOL_DEFINITIONS,
} from '../types/tools';

// We need to read TOOL_ENDPOINTS and TOOL_REQUIRED_PARAMS from toolExecutor.
// They are module-scoped consts, so we test them indirectly through the public API.
import {
  isToolAllowed,
  validateToolArguments,
} from '../services/toolExecutor';

describe('save_markdown_artifact -- Gateway Tool Registration', () => {
  // ============================================================================
  // Test 1: save_markdown_artifact is present in ToolName, ALLOWED_TOOL_NAMES,
  //         and TOOL_DEFINITIONS with correct params
  // ============================================================================
  it('is present in ToolName union, ALLOWED_TOOL_NAMES, and TOOL_DEFINITIONS with correct required params', () => {
    // Verify it is in ALLOWED_TOOL_NAMES (which mirrors the ToolName union)
    expect(ALLOWED_TOOL_NAMES).toContain('save_markdown_artifact');

    // Verify TOOL_DEFINITIONS has an entry for save_markdown_artifact
    const toolDef = TOOL_DEFINITIONS.find(
      (def) => def.function.name === 'save_markdown_artifact'
    );
    expect(toolDef).toBeDefined();
    expect(toolDef!.type).toBe('function');
    expect(toolDef!.function.name).toBe('save_markdown_artifact');
    expect(typeof toolDef!.function.description).toBe('string');
    expect(toolDef!.function.description.length).toBeGreaterThan(0);

    // Verify required params
    expect(toolDef!.function.parameters.required).toEqual(
      expect.arrayContaining(['projectId', 'artifactFilename', 'markdown'])
    );
    expect(toolDef!.function.parameters.required).toHaveLength(3);

    // Verify parameter properties exist
    const props = toolDef!.function.parameters.properties;
    expect(props.projectId).toBeDefined();
    expect(props.artifactFilename).toBeDefined();
    expect(props.markdown).toBeDefined();
    expect(props.projectParentFolder).toBeDefined(); // optional param
  });

  // ============================================================================
  // Test 2: toolExecutor has save_markdown_artifact in TOOL_ENDPOINTS and
  //         TOOL_REQUIRED_PARAMS (tested via public API)
  // ============================================================================
  it('is recognized by isToolAllowed and validateToolArguments requires projectId, artifactFilename, markdown', () => {
    // TOOL_ENDPOINTS: isToolAllowed returns true if tool is in the allowed list
    // which also means TOOL_ENDPOINTS has a mapping for it
    expect(isToolAllowed('save_markdown_artifact')).toBe(true);

    // TOOL_REQUIRED_PARAMS: validateToolArguments should fail for missing required params
    const missingAll = validateToolArguments('save_markdown_artifact' as ToolName, {});
    expect(missingAll.valid).toBe(false);
    expect(missingAll.error).toContain('projectId');

    const missingFilename = validateToolArguments('save_markdown_artifact' as ToolName, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(missingFilename.valid).toBe(false);
    expect(missingFilename.error).toContain('artifactFilename');

    const missingMarkdown = validateToolArguments('save_markdown_artifact' as ToolName, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      artifactFilename: 'TECH-STACK.MD',
    });
    expect(missingMarkdown.valid).toBe(false);
    expect(missingMarkdown.error).toContain('markdown');

    // All required params present: should be valid
    const allPresent = validateToolArguments('save_markdown_artifact' as ToolName, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      artifactFilename: 'TECH-STACK.MD',
      markdown: '# Tech Stack\n\nSome content here.',
    });
    expect(allPresent.valid).toBe(true);
  });
});
