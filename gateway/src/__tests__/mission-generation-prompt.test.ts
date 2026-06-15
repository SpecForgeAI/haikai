/**
 * Tests for MISSION_GENERATION_PROMPT_TEMPLATE constant
 *
 * Tests cover:
 * - MISSION_GENERATION_PROMPT_TEMPLATE is a non-empty string containing instructions about save_product_artifacts
 * - MISSION_GENERATION_PROMPT_TEMPLATE contains references to all 10 information areas from the PM discovery prompt
 *
 * Spec: 2026-02-12 Increment 5 - Wire Confirmation, Mission Generation, Tool Execution
 * Task Group 2: MISSION_GENERATION_PROMPT_TEMPLATE tests
 */

import { MISSION_GENERATION_PROMPT_TEMPLATE } from '../services/promptBuilder';

describe('MISSION_GENERATION_PROMPT_TEMPLATE', () => {
  it('should be a non-empty string containing instructions about save_product_artifacts', () => {
    expect(typeof MISSION_GENERATION_PROMPT_TEMPLATE).toBe('string');
    expect(MISSION_GENERATION_PROMPT_TEMPLATE.length).toBeGreaterThan(0);

    // Must reference the save_product_artifacts tool
    expect(MISSION_GENERATION_PROMPT_TEMPLATE).toContain('save_product_artifacts');

    // Must instruct to use the tool call, not text
    expect(MISSION_GENERATION_PROMPT_TEMPLATE).toContain('tool call');

    // Must mention missionMarkdown parameter
    expect(MISSION_GENERATION_PROMPT_TEMPLATE).toContain('missionMarkdown');

    // Must instruct EXCLUSIVELY via tool call, NOT as text
    expect(MISSION_GENERATION_PROMPT_TEMPLATE).toContain('EXCLUSIVELY');
  });

  it('should contain references to all 10 information areas from the PM discovery prompt', () => {
    // The 10 information areas from the PRODUCT_MANAGER_PROMPT_TEMPLATE:
    // 1. Project name confirmation
    // 2. New vs. existing product
    // 3. Existing documentation availability
    // 4. Core problem the product solves
    // 5. Target audience / users
    // 6. Desired outcome / vision
    // 7. Success criteria / key metrics
    // 8. Constraints (technical, budget, timeline, regulatory)
    // 9. Scope boundaries (what is explicitly in and out of scope)
    // 10. Delivery expectations (timeline, milestones, MVP definition)

    const template = MISSION_GENERATION_PROMPT_TEMPLATE;

    // 1. Project name
    expect(template).toMatch(/[Pp]roject [Nn]ame/);

    // 2. New vs. existing product
    expect(template).toMatch(/[Nn]ew vs\.? [Ee]xisting/i);

    // 3. Existing documentation
    expect(template).toMatch(/[Ee]xisting [Dd]ocumentation/i);

    // 4. Core problem
    expect(template).toMatch(/[Cc]ore [Pp]roblem/i);

    // 5. Target audience / users
    expect(template).toMatch(/[Tt]arget [Aa]udience/i);

    // 6. Desired outcome / vision
    expect(template).toMatch(/[Vv]ision/i);

    // 7. Success criteria / key metrics
    expect(template).toMatch(/[Ss]uccess [Cc]riteria/i);

    // 8. Constraints
    expect(template).toMatch(/[Cc]onstraints/i);

    // 9. Scope boundaries
    expect(template).toMatch(/[Ss]cope [Bb]oundaries/i);

    // 10. Delivery expectations
    expect(template).toMatch(/[Dd]elivery [Ee]xpectations/i);
  });
});
