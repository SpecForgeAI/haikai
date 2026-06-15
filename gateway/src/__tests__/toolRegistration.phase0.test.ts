/**
 * Tests for gateway tool registration: save_project_anchor_entities and create_project_artifact
 *
 * Validates that both new tools are properly registered in the gateway's
 * tool definitions, allow-list, and validation logic.
 *
 * 2 focused tests (Task Group 2):
 * 1. isToolAllowed returns true for save_project_anchor_entities
 * 2. isToolAllowed returns true for create_project_artifact
 *
 * Gap-fill test (Task Group 6):
 * 3. validateToolArguments accepts correct params and rejects missing required params
 */

import { isToolAllowed, validateToolArguments } from '../services/toolExecutor';
import { TOOL_DEFINITIONS } from '../types';

describe('Gateway Tool Registration: Phase 0 Completion Tools', () => {

  // ============================================================================
  // Test 1: isToolAllowed returns true for save_project_anchor_entities
  // ============================================================================
  it('isToolAllowed returns true for save_project_anchor_entities', () => {
    const result = isToolAllowed('save_project_anchor_entities');
    expect(result).toBe(true);
  });

  // ============================================================================
  // Test 2: isToolAllowed returns true for create_project_artifact
  // ============================================================================
  it('isToolAllowed returns true for create_project_artifact', () => {
    const result = isToolAllowed('create_project_artifact');
    expect(result).toBe(true);
  });

  // ============================================================================
  // Gap Fill Test 3: validateToolArguments validates required params for both new tools
  // ============================================================================
  describe('validateToolArguments for Phase 0 tools', () => {
    it('validates save_project_anchor_entities: accepts valid args, rejects missing projectId', () => {
      // Valid arguments
      const validResult = validateToolArguments('save_project_anchor_entities', {
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        applications: [{ name: 'App1', description: 'Test' }],
        appComponents: [],
      });
      expect(validResult.valid).toBe(true);
      expect(validResult.error).toBeUndefined();

      // Missing projectId
      const missingProjectId = validateToolArguments('save_project_anchor_entities', {
        applications: [{ name: 'App1', description: 'Test' }],
        appComponents: [],
      });
      expect(missingProjectId.valid).toBe(false);
      expect(missingProjectId.error).toContain('projectId');
    });

    it('validates create_project_artifact: accepts valid args, rejects missing content', () => {
      // Valid arguments
      const validResult = validateToolArguments('create_project_artifact', {
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        artifactType: 'DISCOVERY_BRIEF_MD',
        content: '# Discovery Brief',
        source: 'discovery-framing',
      });
      expect(validResult.valid).toBe(true);
      expect(validResult.error).toBeUndefined();

      // Missing content
      const missingContent = validateToolArguments('create_project_artifact', {
        projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
        artifactType: 'DISCOVERY_BRIEF_MD',
        source: 'discovery-framing',
      });
      expect(missingContent.valid).toBe(false);
      expect(missingContent.error).toContain('content');
    });
  });
});
