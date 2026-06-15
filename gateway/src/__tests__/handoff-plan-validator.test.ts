/**
 * Tests for handoff plan validation
 *
 * Spec 2026-01-14: Implement Assistant Stage 6a - Sub-Spec Planning and Handoff Plan Preview
 * Task Group 3: Handoff Plan Validation and Chat Route Integration
 */

import { validateHandoffPlan, HandoffPlanValidationResult, generateFallbackPlan } from '../services/handoffPlanValidator';

describe('validateHandoffPlan', () => {
  describe('valid JSON parsing', () => {
    it('should return valid result for well-formed JSON with single intent', () => {
      const content = JSON.stringify({
        is_split: false,
        handoff_plan_summary: 'Single implementation unit',
        handoff_intents: [
          {
            id: 'S1',
            title: 'Test intent',
            intent: 'Test description',
            in_scope: ['item1'],
            out_of_scope: ['item2'],
            acceptance_criteria: ['criterion1'],
            dependencies: [],
          },
        ],
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(true);
      expect(result.handoffPlan).toBeDefined();
      expect(result.handoffPlan?.is_split).toBe(false);
      expect(result.handoffPlan?.handoff_intents).toHaveLength(1);
    });

    it('should return valid result for JSON with multiple intents', () => {
      const content = JSON.stringify({
        is_split: true,
        handoff_plan_summary: 'Multiple sub-specs',
        handoff_intents: [
          {
            id: 'S1',
            title: 'First',
            intent: 'First intent',
            in_scope: [],
            out_of_scope: [],
            acceptance_criteria: [],
            dependencies: [],
          },
          {
            id: 'S2',
            title: 'Second',
            intent: 'Second intent',
            in_scope: [],
            out_of_scope: [],
            acceptance_criteria: [],
            dependencies: ['S1'],
          },
        ],
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(true);
      expect(result.handoffPlan?.is_split).toBe(true);
      expect(result.handoffPlan?.handoff_intents).toHaveLength(2);
    });
  });

  describe('invalid JSON handling', () => {
    it('should return invalid for malformed JSON', () => {
      const content = 'not valid json at all';

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not valid JSON');
    });

    it('should return invalid for incomplete JSON', () => {
      const content = '{"is_split": true, "handoff_plan_summary":';

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('not valid JSON');
    });
  });

  describe('missing required fields', () => {
    it('should return invalid when is_split is missing', () => {
      const content = JSON.stringify({
        handoff_plan_summary: 'Summary',
        handoff_intents: [{ id: 'S1', title: 'T', intent: 'I', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] }],
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('is_split');
    });

    it('should return invalid when handoff_plan_summary is missing', () => {
      const content = JSON.stringify({
        is_split: false,
        handoff_intents: [{ id: 'S1', title: 'T', intent: 'I', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] }],
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('handoff_plan_summary');
    });

    it('should return invalid when handoff_intents is missing', () => {
      const content = JSON.stringify({
        is_split: false,
        handoff_plan_summary: 'Summary',
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('handoff_intents');
    });
  });

  describe('handoff_intents array validation', () => {
    it('should return invalid for empty handoff_intents array', () => {
      const content = JSON.stringify({
        is_split: false,
        handoff_plan_summary: 'Summary',
        handoff_intents: [],
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('at least one');
    });

    it('should return invalid when intent is missing required id field', () => {
      const content = JSON.stringify({
        is_split: false,
        handoff_plan_summary: 'Summary',
        handoff_intents: [{ title: 'T', intent: 'I', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] }],
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('id');
    });

    it('should return invalid when intent is missing required title field', () => {
      const content = JSON.stringify({
        is_split: false,
        handoff_plan_summary: 'Summary',
        handoff_intents: [{ id: 'S1', intent: 'I', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] }],
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('title');
    });
  });

  describe('is_split consistency check', () => {
    it('should return invalid when is_split=true but only one intent', () => {
      const content = JSON.stringify({
        is_split: true,
        handoff_plan_summary: 'Summary',
        handoff_intents: [{ id: 'S1', title: 'T', intent: 'I', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] }],
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('is_split');
    });

    it('should return invalid when is_split=false but multiple intents', () => {
      const content = JSON.stringify({
        is_split: false,
        handoff_plan_summary: 'Summary',
        handoff_intents: [
          { id: 'S1', title: 'T1', intent: 'I1', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] },
          { id: 'S2', title: 'T2', intent: 'I2', in_scope: [], out_of_scope: [], acceptance_criteria: [], dependencies: [] },
        ],
      });

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(false);
      expect(result.error).toContain('is_split');
    });
  });

  describe('JSON embedded in prose extraction', () => {
    it('should extract JSON from prose with code block', () => {
      const content = `Here is the plan:
\`\`\`json
{
  "is_split": false,
  "handoff_plan_summary": "Summary",
  "handoff_intents": [{"id": "S1", "title": "T", "intent": "I", "in_scope": [], "out_of_scope": [], "acceptance_criteria": [], "dependencies": []}]
}
\`\`\`
Let me know if you need changes.`;

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(true);
      expect(result.handoffPlan).toBeDefined();
    });

    it('should extract bare JSON object from prose', () => {
      const content = `After analyzing the requirements, here is my plan:
{
  "is_split": false,
  "handoff_plan_summary": "Single unit",
  "handoff_intents": [{"id": "S1", "title": "T", "intent": "I", "in_scope": [], "out_of_scope": [], "acceptance_criteria": [], "dependencies": []}]
}
I hope this helps!`;

      const result = validateHandoffPlan(content);

      expect(result.valid).toBe(true);
      expect(result.handoffPlan).toBeDefined();
    });
  });
});

describe('generateFallbackPlan', () => {
  it('should generate a single-intent fallback plan', () => {
    const workItemTitle = 'Add user login';
    const workItemDescription = 'Implement login functionality';

    const plan = generateFallbackPlan(workItemTitle, workItemDescription);

    expect(plan.is_split).toBe(false);
    expect(plan.handoff_intents).toHaveLength(1);
    expect(plan.handoff_intents[0].id).toBe('S1');
    expect(plan.handoff_intents[0].title).toContain(workItemTitle);
  });

  it('should use default values when parameters are missing', () => {
    const plan = generateFallbackPlan();

    expect(plan.is_split).toBe(false);
    expect(plan.handoff_intents).toHaveLength(1);
    expect(plan.handoff_plan_summary).toContain('Unable to parse');
  });
});
