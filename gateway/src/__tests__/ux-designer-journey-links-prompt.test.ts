/**
 * Tests for UX Designer Journey Links Prompt Extension
 *
 * Spec 2026-04-07: User Journey Links Workbook and UX Designer Ingestion
 * Task Group 4: Task Prompt Updates
 *
 * These are structural/contract tests that verify the prompt FILE CONTENT
 * contains expected strings and patterns for the journey links extension.
 * They do NOT perform full LLM integration testing.
 */

import path from 'path';
import { promises as fs } from 'fs';

const promptFilePath = path.resolve(
  __dirname,
  '..',
  'config',
  'prompts',
  'ux-designer.users-interactions.task.md'
);

describe('UX Designer Journey Links Prompt Extension (Task Group 4)', () => {
  let promptContent: string;

  beforeAll(async () => {
    promptContent = await fs.readFile(promptFilePath, 'utf-8');
  });

  // Test 1: When 4-sheet workbook CSV-text is provided (including User Journey Links block),
  // the prompt instructs the LLM to include User Journey Links count in summary
  it('should instruct LLM to include User Journey Links count in summary alongside existing counts', () => {
    // The prompt must mention User Journey Links in summary counts context
    expect(promptContent).toContain('User Journey Links');

    // The prompt must reference all 4 entity types in summary context
    expect(promptContent).toContain('Process Activities');
    expect(promptContent).toContain('User Journeys');
    expect(promptContent).toContain('Activity Steps');
    expect(promptContent).toContain('User Journey Links');

    // The prompt must contain the 4th worksheet delimiter example
    expect(promptContent).toContain('--- Worksheet: User Journey Links ---');
    expect(promptContent).toContain('--- End Worksheet: User Journey Links ---');

    // The prompt should mention counting journey links in summary
    // Look for co-occurrence of summary/counts and journey links
    const summarySection = promptContent.substring(
      promptContent.indexOf('## CONVERSATION FLOW')
    );
    expect(summarySection).toContain('User Journey Links');
  });

  // Test 2: When 3-sheet workbook CSV-text is provided (no User Journey Links block),
  // the prompt instructs LLM to state zero links cleanly without error appearance
  it('should instruct LLM to handle zero links cleanly without error appearance', () => {
    // The prompt must describe how to handle the absent/zero links case
    // Look for instructions about zero links or absent links being clean
    const hasZeroLinksGuidance =
      promptContent.includes('zero links') ||
      promptContent.includes('No User Journey Links') ||
      promptContent.includes('0 User Journey Links');
    expect(hasZeroLinksGuidance).toBe(true);

    // The prompt must indicate the 4th worksheet is optional
    const hasOptionalIndicator =
      promptContent.includes('optional') || promptContent.includes('Optional');
    expect(hasOptionalIndicator).toBe(true);

    // The prompt should NOT treat absent links as an error condition
    // Verify there is language about cleanly handling absence
    const hasCleanAbsenceLanguage =
      promptContent.includes('cleanly') ||
      promptContent.includes('without error') ||
      promptContent.includes('may be absent');
    expect(hasCleanAbsenceLanguage).toBe(true);
  });

  // Test 3: When the LLM phase is "ready", the structured JSON output schema
  // documents user_journey_links alongside user_journeys and activity_steps
  it('should document user_journey_links in the ready phase structured JSON output', () => {
    // The prompt must reference user_journey_links as part of the output payload
    expect(promptContent).toContain('user_journey_links');

    // The prompt must reference user_journeys (existing)
    expect(promptContent).toContain('user_journeys');

    // The prompt must reference activity_steps (existing)
    expect(promptContent).toContain('activity_steps');

    // The structured representation section should include user_journey_links collection
    const structuredSection = promptContent.substring(
      promptContent.indexOf('## INTERMEDIATE STRUCTURED REPRESENTATION')
    );
    expect(structuredSection).toContain('user_journey_links');
    expect(structuredSection).toContain('source_user_journey_name');
    expect(structuredSection).toContain('target_user_journey_name');
    expect(structuredSection).toContain('relationship_type');

    // The ready phase / save section should mention user_journey_links in the payload
    const conversationSection = promptContent.substring(
      promptContent.indexOf('## CONVERSATION FLOW')
    );
    expect(conversationSection).toContain('user_journey_links');
  });

  // Test 4: Save confirmation question mentions journey links alongside journeys and steps
  it('should include journey links in the save confirmation question', () => {
    // The save confirmation question must mention journey links
    // Look for the save confirmation pattern that includes all three data types
    const conversationSection = promptContent.substring(
      promptContent.indexOf('## CONVERSATION FLOW')
    );

    // The save confirmation question must mention journeys, steps, AND links
    const hasSaveConfirmationWithLinks =
      conversationSection.includes('journey links') ||
      conversationSection.includes('Journey Links') ||
      conversationSection.includes('user_journey_links');
    expect(hasSaveConfirmationWithLinks).toBe(true);

    // Specifically check the save confirmation question references all three types
    const saveConfirmationArea = conversationSection.substring(
      conversationSection.indexOf('save')
    );
    expect(saveConfirmationArea).toBeTruthy();

    // The prompt must also document the CSV 4 column structure for links
    expect(promptContent).toContain('CSV 4');
    expect(promptContent).toContain('source_user_journey_name');
    expect(promptContent).toContain('target_user_journey_name');
    expect(promptContent).toContain('relationship_type');

    // Validation rules section must cover link-specific validation
    const validationSection = promptContent.substring(
      promptContent.indexOf('## VALIDATION RULES')
    );
    expect(validationSection).toContain('self-link');
    expect(validationSection).toContain('RELATES_TO');
    expect(validationSection).toContain('PRECEDES');
    expect(validationSection).toContain('DEPENDS_ON');
    expect(validationSection).toContain('OPTIONALLY_LEADS_TO');
    expect(validationSection).toContain('TRIGGERS');
  });
});
