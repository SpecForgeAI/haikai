/**
 * Tests for WhatsNextEvaluator
 *
 * Spec 2026-03-04: Assistant "What's Next" v1
 * Task Group 3 (Task 3.1): Write 5-8 focused tests for WhatsNextEvaluator
 *
 * Spec 2026-03-04: What's Next v1-B -- Modal Launch
 * Task Group 6 (Task 6.1): Update tests for ModalAction shape on
 * DEFINE_TECH_STACK_ACTION and REFRESH_TECH_STANDARDS_ACTION.
 *
 * Spec 2026-03-04: What's Next v1-C -- Work Item Picker
 * Task Group 10: Add tests for START_IMPLEMENTATION_ACTION in optimisation branch.
 *
 * Tests the pure, synchronous evaluateNextActions function that produces
 * deterministic recommendations based on ProjectSignals.
 */

import { evaluateNextActions } from '../services/whatsNextEvaluator';
import { ProjectSignals } from '../services/projectSignals';

/**
 * Helper to create a ProjectSignals object with all-true booleans
 * and sensible defaults, allowing selective overrides.
 */
function makeSignals(overrides?: Partial<ProjectSignals>): ProjectSignals {
  return {
    missionExists: true,
    techStandardsExists: true,
    testStrategyExists: true,
    roadmapExists: true,
    architectureBaselineExists: true,
    usersAndInteractionsExists: true,
    epicCount: 5,
    storyCount: 0,
    storiesWithAC: 0,
    storiesInProgress: 0,
    storiesDone: 0,
    storiesVerified: 0,
    ...overrides,
  };
}

describe('evaluateNextActions (Spec 2026-03-04, Task Group 3 + v1-B Task Group 6 + v1-C Task Group 10)', () => {
  // ========================================================================
  // Test 1: No mission -- returns exactly 1 action with id 'define-mission'
  // ========================================================================
  it('returns only "Define Product Mission" when missionExists is false', () => {
    const result = evaluateNextActions(makeSignals({ missionExists: false }));

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].id).toBe('define-mission');
    expect(result.actions[0].priority).toBe(100);
    expect(result.actions[0].target).toEqual({
      screen: 'product',
      tab: 'product',
      personaId: 'product-manager',
      taskId: 'product-manager--define-product',
    });
    expect(result.explanation).toContain('does not yet have a Product Mission');
  });

  // ========================================================================
  // Test 2: Mission exists, tech stack missing -- includes define-tech-stack
  //         (v1-B: now a ModalAction with modalId, no screen/taskId)
  // ========================================================================
  it('includes "Define Tech Stack" as a ModalAction when mission exists but techStandardsExists is false', () => {
    const result = evaluateNextActions(makeSignals({ techStandardsExists: false }));

    const techStackAction = result.actions.find(a => a.id === 'define-tech-stack');
    expect(techStackAction).toBeDefined();
    expect(techStackAction!.priority).toBe(80);
    expect(techStackAction!.launch).toBe('modal');
    expect((techStackAction as any).modalId).toBe('generate-standards');
    expect(techStackAction!.target).toEqual({
      personaId: 'architect',
    });
  });

  // ========================================================================
  // Test 3: Multiple bootstrap items missing -- returns 4 actions in priority order
  // ========================================================================
  it('returns 5 actions ordered by priority when mission exists but 5 bootstrap items missing', () => {
    const result = evaluateNextActions(makeSignals({
      techStandardsExists: false,
      roadmapExists: false,
      architectureBaselineExists: false,
      usersAndInteractionsExists: false,
      testStrategyExists: false,
    }));

    expect(result.actions).toHaveLength(5);
    expect(result.actions.map(a => a.priority)).toEqual([80, 75, 65, 55, 50]);
    expect(result.actions.map(a => a.id)).toEqual([
      'define-tech-stack',
      'define-architecture',
      'define-users-interactions',
      'define-roadmap',
      'define-test-strategy',
    ]);
    expect(result.explanation).toContain('missing 5 foundational artifacts');
  });

  // ========================================================================
  // Test 4: All bootstrap complete -- returns exactly 4 optimisation actions
  //         (v1-C: now includes START_IMPLEMENTATION_ACTION at priority 45)
  // ========================================================================
  it('returns 4 optimisation actions when all bootstrap artifacts exist', () => {
    const result = evaluateNextActions(makeSignals());

    expect(result.actions).toHaveLength(4);
    expect(result.actions[0].id).toBe('start-implementation');
    expect(result.actions[0].priority).toBe(45);
    expect(result.actions[1].id).toBe('review-roadmap');
    expect(result.actions[1].priority).toBe(40);
    expect(result.actions[2].id).toBe('review-architecture');
    expect(result.actions[2].priority).toBe(35);
    expect(result.actions[3].id).toBe('refresh-tech-standards');
    expect(result.actions[3].priority).toBe(30);
    expect(result.explanation).toContain('All foundational artifacts are in place');
  });

  // ========================================================================
  // Test 5: Maximum 5 actions rule -- result.actions.length <= 5
  // ========================================================================
  it('never returns more than 5 actions', () => {
    // With 5 bootstrap items missing (the maximum possible since mission blocks others)
    const result = evaluateNextActions(makeSignals({
      techStandardsExists: false,
      roadmapExists: false,
      architectureBaselineExists: false,
      usersAndInteractionsExists: false,
      testStrategyExists: false,
    }));

    expect(result.actions.length).toBeLessThanOrEqual(5);

    // Also verify for fully bootstrapped
    const optimisationResult = evaluateNextActions(makeSignals());
    expect(optimisationResult.actions.length).toBeLessThanOrEqual(5);
  });

  // ========================================================================
  // Test 6: No mission blocks other actions -- even when other signals are also false
  // ========================================================================
  it('returns only define-mission when missionExists is false regardless of other signals', () => {
    const result = evaluateNextActions(makeSignals({
      missionExists: false,
      techStandardsExists: false,
      roadmapExists: false,
      architectureBaselineExists: false,
      usersAndInteractionsExists: false,
      testStrategyExists: false,
    }));

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].id).toBe('define-mission');
  });

  // ========================================================================
  // Test 7: All actions have correct launch type
  //         (v1-B: define-tech-stack and refresh-tech-standards are 'modal';
  //          all others are 'panel')
  // ========================================================================
  it('assigns correct launch type to each action across all scenarios', () => {
    // No mission: define-mission should have launch: 'panel'
    const noMission = evaluateNextActions(makeSignals({ missionExists: false }));
    expect(noMission.actions[0].launch).toBe('panel');

    // Bootstrap missing: define-tech-stack is 'modal'; define-roadmap is 'panel'
    const bootstrap = evaluateNextActions(makeSignals({
      techStandardsExists: false,
      roadmapExists: false,
    }));
    const techStack = bootstrap.actions.find(a => a.id === 'define-tech-stack');
    const roadmap = bootstrap.actions.find(a => a.id === 'define-roadmap');
    expect(techStack!.launch).toBe('modal');
    expect(roadmap!.launch).toBe('panel');

    // Optimisation: review-roadmap and review-architecture are 'panel';
    // refresh-tech-standards is 'modal'; start-implementation is 'implementPicker'
    const optimisation = evaluateNextActions(makeSignals());
    const reviewRoadmap = optimisation.actions.find(a => a.id === 'review-roadmap');
    const reviewArch = optimisation.actions.find(a => a.id === 'review-architecture');
    const refreshStandards = optimisation.actions.find(a => a.id === 'refresh-tech-standards');
    const startImpl = optimisation.actions.find(a => a.id === 'start-implementation');
    expect(reviewRoadmap!.launch).toBe('panel');
    expect(reviewArch!.launch).toBe('panel');
    expect(refreshStandards!.launch).toBe('modal');
    expect(startImpl!.launch).toBe('implementPicker');
  });

  // ========================================================================
  // Test 8: Action catalog correctness -- verify exact fields from spec section 6
  //         (v1-B: techStack is now ModalAction with modalId, no screen/taskId)
  // ========================================================================
  it('has correct id, label, target.personaId, and action-specific fields for each bootstrap action', () => {
    // Trigger all bootstrap actions by having mission but nothing else
    const result = evaluateNextActions(makeSignals({
      techStandardsExists: false,
      roadmapExists: false,
      architectureBaselineExists: false,
      usersAndInteractionsExists: false,
      testStrategyExists: false,
    }));

    // techStack is now a ModalAction
    const techStack = result.actions.find(a => a.id === 'define-tech-stack')!;
    expect(techStack.label).toBe('Define Tech Stack');
    expect(techStack.launch).toBe('modal');
    expect((techStack as any).modalId).toBe('generate-standards');
    expect(techStack.target).toEqual({ personaId: 'architect' });

    // architecture remains a PanelAction
    const arch = result.actions.find(a => a.id === 'define-architecture')!;
    expect(arch.label).toBe('Define Architecture Baseline');
    expect(arch.target.personaId).toBe('architect');
    expect((arch.target as any).taskId).toBe('architect--define-architecture');

    // users & interactions is a PanelAction
    const usersInteractions = result.actions.find(a => a.id === 'define-users-interactions')!;
    expect(usersInteractions.label).toBe('Define Users & Interactions');
    expect(usersInteractions.target.personaId).toBe('ux-designer');
    expect((usersInteractions.target as any).taskId).toBe('ux-designer--ui-domain');

    // roadmap remains a PanelAction
    const roadmap = result.actions.find(a => a.id === 'define-roadmap')!;
    expect(roadmap.label).toBe('Define Product Roadmap');
    expect(roadmap.target.personaId).toBe('product-manager');
    expect((roadmap.target as any).taskId).toBe('product-manager--roadmap');
    expect((roadmap.target as any).tab).toBe('roadmap');

    // test strategy remains a PanelAction
    const testStrategy = result.actions.find(a => a.id === 'define-test-strategy')!;
    expect(testStrategy.label).toBe('Define Test Strategy');
    expect(testStrategy.target.personaId).toBe('test-engineer');
    expect((testStrategy.target as any).taskId).toBe('test-engineer--test-strategy');
  });

  // ========================================================================
  // Test 9: ModalAction shape has modalId and minimal target
  //         (v1-B new test: verify ModalAction shape explicitly)
  // ========================================================================
  it('ModalAction shape has modalId and minimal target without screen or taskId', () => {
    // Trigger the optimisation branch (all bootstrap complete)
    const result = evaluateNextActions(makeSignals());

    const refreshAction = result.actions.find(a => a.id === 'refresh-tech-standards');
    expect(refreshAction).toBeDefined();
    expect(refreshAction!.launch).toBe('modal');
    expect((refreshAction as any).modalId).toBe('generate-standards');
    expect(refreshAction!.target).toEqual({ personaId: 'architect' });

    // Verify ModalAction does NOT have screen or taskId on target
    expect(refreshAction!.target).not.toHaveProperty('screen');
    expect(refreshAction!.target).not.toHaveProperty('taskId');
  });

  // ========================================================================
  // Test 10: START_IMPLEMENTATION_ACTION appears in optimisation branch
  //          (v1-C: PickerAction with launch 'implementPicker')
  // ========================================================================
  it('includes START_IMPLEMENTATION_ACTION with launch implementPicker in optimisation branch', () => {
    const result = evaluateNextActions(makeSignals());

    const startImpl = result.actions.find(a => a.id === 'start-implementation');
    expect(startImpl).toBeDefined();
    expect(startImpl!.launch).toBe('implementPicker');
    expect(startImpl!.target).toEqual({ personaId: 'developer' });
    expect(startImpl!.priority).toBe(45);
    expect(startImpl!.label).toBe('Start Implementation');

    // Optimisation branch now has 4 actions total
    expect(result.actions).toHaveLength(4);
  });

  // ========================================================================
  // Test 11: START_IMPLEMENTATION_ACTION not present when bootstrap incomplete
  //          (v1-C: only appears in the optimisation branch)
  // ========================================================================
  it('does NOT include start-implementation when bootstrap is incomplete', () => {
    const result = evaluateNextActions(makeSignals({ missionExists: false }));

    const startImpl = result.actions.find(a => a.id === 'start-implementation');
    expect(startImpl).toBeUndefined();

    // Also check with partial bootstrap
    const partialResult = evaluateNextActions(makeSignals({ roadmapExists: false }));
    const startImplPartial = partialResult.actions.find(a => a.id === 'start-implementation');
    expect(startImplPartial).toBeUndefined();
  });
});
