/**
 * Tests for save_user_journeys tool registration and chatV2 adapter configuration.
 *
 * Tests verify:
 * 1. Tool name is in ALLOWED_TOOL_NAMES with correct definition
 * 2. Tool executor has correct endpoint and required params
 * 3. USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE exists and has correct placeholders
 * 4. Task config has the artifact entry for user-journeys
 * 5. Existing users-interactions tool still works (regression)
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

import {
  USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE,
  USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE,
} from '../services/promptBuilder';

import * as fs from 'fs';
import * as path from 'path';

describe('save_user_journeys -- Gateway Tool Registration', () => {
  // ============================================================================
  // Test 1: save_user_journeys is in ALLOWED_TOOL_NAMES
  // ============================================================================
  it('is present in ALLOWED_TOOL_NAMES and recognized by isToolAllowed', () => {
    expect(ALLOWED_TOOL_NAMES).toContain('save_user_journeys');
    expect(isToolAllowed('save_user_journeys')).toBe(true);
  });

  // ============================================================================
  // Test 2: TOOL_DEFINITIONS has correct entry
  // ============================================================================
  it('has a TOOL_DEFINITIONS entry with correct name, required params, and description', () => {
    const toolDef = TOOL_DEFINITIONS.find(
      (def) => def.function.name === 'save_user_journeys'
    );
    expect(toolDef).toBeDefined();
    expect(toolDef!.type).toBe('function');
    expect(toolDef!.function.name).toBe('save_user_journeys');

    // Verify description exists and is non-empty
    expect(typeof toolDef!.function.description).toBe('string');
    expect(toolDef!.function.description.length).toBeGreaterThan(0);

    // Verify required params are exactly projectId and userJourneysJson
    expect(toolDef!.function.parameters.required).toEqual(
      expect.arrayContaining(['projectId', 'userJourneysJson'])
    );
    expect(toolDef!.function.parameters.required).toHaveLength(2);

    // Verify parameter properties exist with correct types
    const props = toolDef!.function.parameters.properties;
    expect(props.projectId).toBeDefined();
    expect(props.projectId.type).toBe('string');
    expect(props.userJourneysJson).toBeDefined();
    expect(props.userJourneysJson.type).toBe('string');
  });

  // ============================================================================
  // Test 3: validateToolArguments rejects missing params and accepts valid ones
  // ============================================================================
  it('validates required params: rejects missing, accepts valid', () => {
    // Missing projectId
    const missingProjectId = validateToolArguments('save_user_journeys' as ToolName, {
      userJourneysJson: '{}',
    });
    expect(missingProjectId.valid).toBe(false);
    expect(missingProjectId.error).toContain('projectId');

    // Missing userJourneysJson
    const missingJson = validateToolArguments('save_user_journeys' as ToolName, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(missingJson.valid).toBe(false);
    expect(missingJson.error).toContain('userJourneysJson');

    // Valid params
    const valid = validateToolArguments('save_user_journeys' as ToolName, {
      projectId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      userJourneysJson: '{"user_journeys":[]}',
    });
    expect(valid.valid).toBe(true);
  });
});

describe('USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE', () => {
  // ============================================================================
  // Test 4: Template exists and has correct placeholders
  // ============================================================================
  it('exists and contains {conversationTranscript} placeholder', () => {
    expect(USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE).toBeDefined();
    expect(typeof USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE).toBe('string');
    expect(USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE).toContain('{conversationTranscript}');
    // Should mention user_journeys and activity_steps in the schema
    expect(USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE).toContain('user_journeys');
    expect(USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE).toContain('activity_steps');
    // Issue fields were renamed to activity_issues / ui_issues
    expect(USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE).toContain('activity_issues');
    expect(USER_JOURNEYS_GENERATION_PROMPT_TEMPLATE).toContain('ui_issues');
  });
});

describe('Task config -- ux-designer--users-interactions.json', () => {
  // ============================================================================
  // Test 5: Task config has artifact entry for user-journeys
  // ============================================================================
  it('has an artifact entry with artifactId user-journeys', () => {
    const configPath = path.join(__dirname, '..', 'config', 'tasks', 'ux-designer--users-interactions.json');
    const configContent = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configContent);

    expect(config.artifacts).toBeDefined();
    expect(Array.isArray(config.artifacts)).toBe(true);
    expect(config.artifacts.length).toBeGreaterThan(0);

    const artifact = config.artifacts.find((a: any) => a.artifactId === 'user-journeys');
    expect(artifact).toBeDefined();
    expect(artifact.tool).toBe('save_user_journeys');
    expect(artifact.filename).toBe('USER_JOURNEYS');
  });
});

describe('Regression -- existing save_users_interactions tool', () => {
  // ============================================================================
  // Test 6: Existing save_users_interactions is still registered
  // ============================================================================
  it('save_users_interactions is still in ALLOWED_TOOL_NAMES', () => {
    expect(ALLOWED_TOOL_NAMES).toContain('save_users_interactions');
    expect(isToolAllowed('save_users_interactions')).toBe(true);
  });

  it('USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE still exists', () => {
    expect(USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE).toBeDefined();
    expect(typeof USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE).toBe('string');
    expect(USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE).toContain('{conversationTranscript}');
    expect(USERS_INTERACTIONS_GENERATION_PROMPT_TEMPLATE).toContain('business_users');
  });
});
