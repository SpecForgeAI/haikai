/**
 * Tests for Proposed Definition Extractor
 *
 * Spec 2026-01-18: Planner to Implementor Handoff via Orchestrations API
 * Task Group 3: Proposed Definition Extraction and Transformation
 *
 * Tests extraction of PROPOSED content from Planner messages and
 * transformation to shape-spec format.
 */

import {
  extractProposedDefinition,
  extractProposedDefinitionWithMetadata,
  transformToShapeSpec,
  extractAndTransformToShapeSpec,
} from '../utils/proposedDefinitionExtractor';
import { ChatMessage } from '../api/chatApi';

// ============================================================================
// Test Data
// ============================================================================

function createMessage(
  role: 'user' | 'assistant',
  content: string,
  id?: string
): ChatMessage {
  return {
    id: id || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    role,
    content,
    timestamp: new Date(),
  };
}

// Sample Planner message containing Part 4 and PROPOSED markers
const VALID_PLANNER_MESSAGE = `
Great! Based on our discussion, let me summarize the feature.

--- Part 4: Proposed Final Feature Definition ---

PROPOSED \u2014

**User Authentication System**

Context: The application needs secure user authentication to protect user data and enable personalized experiences.

Goal: Implement a complete user authentication system with login, registration, and password management.

Scope: Backend authentication service, frontend login/registration forms, session management.

Requirements:
- JWT-based authentication tokens
- Password hashing with bcrypt
- Email verification for new accounts
- Password reset functionality

Acceptance Criteria:
- Users can register with email and password
- Users can log in and receive a valid session
- Invalid credentials show appropriate error messages
- Sessions expire after 24 hours of inactivity

Non-Goals:
- OAuth/social login integration
- Multi-factor authentication
- SAML/enterprise SSO
`;

// Message with Part 4 but using regular hyphen instead of em-dash
const MESSAGE_WITH_REGULAR_HYPHEN = `
--- Part 4: Proposed Final Feature Definition ---

PROPOSED -

Simple Feature Title

Context: Basic context here.
Goal: Basic goal.
`;

// Message without Part 4 marker
const MESSAGE_WITHOUT_PART_4 = `
Here is my analysis of the feature requirements.

PROPOSED \u2014

Some proposed content that should NOT be extracted because Part 4 marker is missing.
`;

// Message without PROPOSED marker
const MESSAGE_WITHOUT_PROPOSED = `
--- Part 4: Proposed Final Feature Definition ---

This is Part 4 content but there is no PROPOSED marker so it should not be extracted.
`;

// ============================================================================
// Extraction Tests
// ============================================================================

describe('extractProposedDefinition', () => {
  it('should find Part 4 marker in assistant message', () => {
    const messages = [
      createMessage('user', 'Please implement authentication'),
      createMessage('assistant', VALID_PLANNER_MESSAGE),
    ];

    const result = extractProposedDefinition(messages);

    expect(result).not.toBeNull();
    expect(result).toContain('User Authentication System');
  });

  it('should find "PROPOSED -" marker and extract following text', () => {
    const messages = [createMessage('assistant', VALID_PLANNER_MESSAGE)];

    const result = extractProposedDefinition(messages);

    expect(result).not.toBeNull();
    expect(result).toContain('Context:');
    expect(result).toContain('Goal:');
    expect(result).toContain('Requirements:');
    expect(result).toContain('Acceptance Criteria:');
  });

  it('should support regular hyphen as PROPOSED marker', () => {
    const messages = [createMessage('assistant', MESSAGE_WITH_REGULAR_HYPHEN)];

    const result = extractProposedDefinition(messages);

    expect(result).not.toBeNull();
    expect(result).toContain('Simple Feature Title');
  });

  it('should return null when Part 4 marker is missing', () => {
    const messages = [createMessage('assistant', MESSAGE_WITHOUT_PART_4)];

    const result = extractProposedDefinition(messages);

    expect(result).toBeNull();
  });

  it('should return null when PROPOSED marker is missing', () => {
    const messages = [createMessage('assistant', MESSAGE_WITHOUT_PROPOSED)];

    const result = extractProposedDefinition(messages);

    expect(result).toBeNull();
  });

  it('should return null for empty messages array', () => {
    const result = extractProposedDefinition([]);
    expect(result).toBeNull();
  });

  it('should only search assistant messages, not user messages', () => {
    // Put the valid content in a user message
    const messages = [createMessage('user', VALID_PLANNER_MESSAGE)];

    const result = extractProposedDefinition(messages);

    expect(result).toBeNull();
  });

  it('should find the most recent assistant message with Part 4', () => {
    const oldMessage = createMessage(
      'assistant',
      `
--- Part 4: Proposed Final Feature Definition ---

PROPOSED \u2014

Old Proposed Feature
Context: Old context
`,
      'msg-old'
    );

    const newMessage = createMessage(
      'assistant',
      `
--- Part 4: Proposed Final Feature Definition ---

PROPOSED \u2014

New Proposed Feature
Context: Updated context
`,
      'msg-new'
    );

    const messages = [oldMessage, createMessage('user', 'Looks good'), newMessage];

    const result = extractProposedDefinition(messages);

    expect(result).not.toBeNull();
    expect(result).toContain('New Proposed Feature');
    expect(result).not.toContain('Old Proposed Feature');
  });
});

// ============================================================================
// Transformation Tests
// ============================================================================

describe('transformToShapeSpec', () => {
  it('should convert PROPOSED content to shape-spec format', () => {
    const proposed = `
**Feature Title**

Context: Background context for the feature.

Goal: What we want to achieve.

Scope: What is included.

Requirements:
- First requirement
- Second requirement

Acceptance Criteria:
- First criterion
- Second criterion

Non-Goals:
- Not doing this
`;

    const result = transformToShapeSpec(proposed);

    expect(result).toContain('title:');
    expect(result).toContain('context:');
    expect(result).toContain('goal:');
  });

  it('should produce output starting with "title: ..."', () => {
    const proposed = `
My Feature Title

Context: Some context
`;

    const result = transformToShapeSpec(proposed);

    expect(result.startsWith('title:')).toBe(true);
  });

  it('should NOT include "/agent-os:shape-spec" prefix', () => {
    const proposed = `
Feature Name

Context: Background
Goal: Objective
`;

    const result = transformToShapeSpec(proposed);

    expect(result).not.toContain('/agent-os');
    expect(result).not.toContain('shape-spec');
  });

  it('should include requirements as list items', () => {
    const proposed = `
Feature Title

Requirements:
- Implement login
- Add password reset
- Enable email verification
`;

    const result = transformToShapeSpec(proposed);

    expect(result).toContain('requirements:');
    expect(result).toContain('  - Implement login');
    expect(result).toContain('  - Add password reset');
  });

  it('should include acceptance_criteria as list items', () => {
    const proposed = `
Feature Title

Acceptance Criteria:
- Users can log in
- Invalid credentials show errors
`;

    const result = transformToShapeSpec(proposed);

    expect(result).toContain('acceptance_criteria:');
    expect(result).toContain('  - Users can log in');
  });

  it('should include non_goals as list items', () => {
    const proposed = `
Feature Title

Non-Goals:
- OAuth integration
- MFA support
`;

    const result = transformToShapeSpec(proposed);

    expect(result).toContain('non_goals:');
    expect(result).toContain('  - OAuth integration');
  });

  it('should handle empty input gracefully', () => {
    expect(transformToShapeSpec('')).toBe('');
    expect(transformToShapeSpec('   ')).toBe('');
  });

  it('should strip markdown bold markers from title', () => {
    const proposed = `**Bold Feature Title**

Context: Some context
`;

    const result = transformToShapeSpec(proposed);

    expect(result).toContain('title: Bold Feature Title');
    expect(result).not.toContain('**');
  });
});

// ============================================================================
// Combined Function Tests
// ============================================================================

describe('extractAndTransformToShapeSpec', () => {
  it('should extract and transform in one call', () => {
    const messages = [createMessage('assistant', VALID_PLANNER_MESSAGE)];

    const result = extractAndTransformToShapeSpec(messages);

    expect(result).not.toBeNull();
    expect(result!.startsWith('title:')).toBe(true);
    expect(result).toContain('context:');
  });

  it('should return null when extraction fails', () => {
    const messages = [createMessage('user', 'Just a user message')];

    const result = extractAndTransformToShapeSpec(messages);

    expect(result).toBeNull();
  });
});

// ============================================================================
// Metadata Extraction Tests
// ============================================================================

describe('extractProposedDefinitionWithMetadata', () => {
  it('should return source message ID along with content', () => {
    const messageId = 'specific-message-id-123';
    const messages = [createMessage('assistant', VALID_PLANNER_MESSAGE, messageId)];

    const result = extractProposedDefinitionWithMetadata(messages);

    expect(result).not.toBeNull();
    expect(result!.sourceMessageId).toBe(messageId);
    expect(result!.rawContent).toContain('User Authentication System');
  });

  it('should return null when markers not found', () => {
    const messages = [createMessage('assistant', 'No markers here')];

    const result = extractProposedDefinitionWithMetadata(messages);

    expect(result).toBeNull();
  });
});

// ============================================================================
// Edge Case Tests
// ============================================================================

describe('edge cases', () => {
  it('should handle PROPOSED marker at end of message with no content', () => {
    const message = `
--- Part 4: Proposed Final Feature Definition ---

PROPOSED \u2014
`;

    const messages = [createMessage('assistant', message)];
    const result = extractProposedDefinition(messages);

    expect(result).toBeNull();
  });

  it('should handle multiple Part 4 markers in same message', () => {
    const message = `
--- Part 4: Proposed Final Feature Definition ---

PROPOSED \u2014

First Version

--- Part 4: Proposed Final Feature Definition ---

PROPOSED \u2014

Second Version
`;

    const messages = [createMessage('assistant', message)];
    const result = extractProposedDefinition(messages);

    expect(result).not.toBeNull();
    // Should find the first occurrence (since we search from the marker position)
    expect(result).toContain('First Version');
  });

  it('should handle numbered list items in requirements', () => {
    const proposed = `
Feature Title

Requirements:
1. First requirement
2. Second requirement
3. Third requirement
`;

    const result = transformToShapeSpec(proposed);

    expect(result).toContain('requirements:');
    expect(result).toContain('First requirement');
    expect(result).toContain('Second requirement');
  });

  it('should handle asterisk list items', () => {
    const proposed = `
Feature Title

Requirements:
* First requirement
* Second requirement
`;

    const result = transformToShapeSpec(proposed);

    expect(result).toContain('requirements:');
    expect(result).toContain('First requirement');
  });

  it('should handle "Out of Scope" as alias for non_goals', () => {
    const proposed = `
Feature Title

Out of Scope:
- Not implementing this
- Excluding that
`;

    const result = transformToShapeSpec(proposed);

    expect(result).toContain('non_goals:');
    expect(result).toContain('Not implementing this');
  });
});
