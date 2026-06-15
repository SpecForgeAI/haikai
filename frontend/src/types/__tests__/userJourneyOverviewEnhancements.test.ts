/**
 * User Journey Overview Diagram Enhancement Type Tests
 *
 * Spec 2026-04-10: User Journey Overview Diagram Enhancements
 * Task Group 2, Task 2.1: 3 focused tests for type correctness
 *
 * Test 1: Verify UserJourneyOverviewDiagramDto accepts optional related_colleagues field with the correct shape
 * Test 2: Verify RelatedColleagueDto interface has business_user_id, business_user_name, and has_overview fields
 * Test 3: Verify UserJourneyOverviewDiagramRendererProps accepts optional onColleagueClick callback prop
 */

import { describe, it, expect } from 'vitest';
import type {
  UserJourneyOverviewDiagramDto,
  RelatedColleagueDto,
} from '../userJourneyOverviewDiagram';
import type { UserJourneyOverviewDiagramRendererProps } from '../../components/DiagramsView/UserJourneyOverviewDiagramRenderer';

/**
 * Helper: builds a minimal valid UserJourneyOverviewDiagramDto.
 */
function buildMinimalDto(
  overrides?: Partial<UserJourneyOverviewDiagramDto>
): UserJourneyOverviewDiagramDto {
  return {
    diagram_type: 'USER_JOURNEY_OVERVIEW',
    version: '1.0',
    overview: {
      business_user_id: 'bu-1',
      business_user_name: 'Customer',
      title: 'Customer Journey Overview',
    },
    lanes: [],
    nodes: [],
    edges: [],
    render_hints: {
      lane_axis: 'VERTICAL',
      flow_direction: 'LEFT_TO_RIGHT',
      show_title: true,
      show_lane_headers: true,
      show_node_description: true,
      show_relationship_labels: true,
    },
    ...overrides,
  };
}

describe('User Journey Overview Enhancement Types', () => {
  it('UserJourneyOverviewDiagramDto accepts optional related_colleagues field with the correct shape', () => {
    // Build a DTO without related_colleagues -- should still be valid (field is optional)
    const dtoWithout = buildMinimalDto();
    expect(dtoWithout.related_colleagues).toBeUndefined();

    // Build a DTO with related_colleagues populated
    const colleagues: RelatedColleagueDto[] = [
      { business_user_id: 'bu-2', business_user_name: 'Agent', has_overview: true },
      { business_user_id: 'bu-3', business_user_name: 'Manager', has_overview: false },
    ];
    const dtoWith = buildMinimalDto({ related_colleagues: colleagues });

    expect(dtoWith.related_colleagues).toBeDefined();
    expect(dtoWith.related_colleagues).toHaveLength(2);
    expect(dtoWith.related_colleagues![0].business_user_id).toBe('bu-2');
    expect(dtoWith.related_colleagues![0].business_user_name).toBe('Agent');
    expect(dtoWith.related_colleagues![0].has_overview).toBe(true);
    expect(dtoWith.related_colleagues![1].has_overview).toBe(false);
  });

  it('RelatedColleagueDto interface has business_user_id, business_user_name, and has_overview fields', () => {
    // Construct a valid RelatedColleagueDto -- all three fields must be present
    const colleague: RelatedColleagueDto = {
      business_user_id: 'bu-42',
      business_user_name: 'Branch Officer',
      has_overview: true,
    };

    expect(colleague.business_user_id).toBe('bu-42');
    expect(colleague.business_user_name).toBe('Branch Officer');
    expect(colleague.has_overview).toBe(true);

    // Verify the three fields are the only required fields by checking their types at runtime
    expect(typeof colleague.business_user_id).toBe('string');
    expect(typeof colleague.business_user_name).toBe('string');
    expect(typeof colleague.has_overview).toBe('boolean');

    // Verify the interface works with has_overview = false
    const noOverview: RelatedColleagueDto = {
      business_user_id: 'bu-99',
      business_user_name: 'External Partner',
      has_overview: false,
    };
    expect(noOverview.has_overview).toBe(false);
  });

  it('UserJourneyOverviewDiagramRendererProps accepts optional onColleagueClick callback prop', () => {
    // Build props without onColleagueClick -- should be valid (optional field)
    const propsWithout: UserJourneyOverviewDiagramRendererProps = {
      overviewData: buildMinimalDto(),
    };
    expect(propsWithout.onColleagueClick).toBeUndefined();

    // Build props with onColleagueClick callback
    const clickHandler = (businessUserId: string): void => {
      // No-op handler for type checking
      void businessUserId;
    };

    const propsWith: UserJourneyOverviewDiagramRendererProps = {
      overviewData: buildMinimalDto(),
      onColleagueClick: clickHandler,
    };

    expect(propsWith.onColleagueClick).toBeDefined();
    expect(typeof propsWith.onColleagueClick).toBe('function');

    // Verify the callback signature accepts a string parameter
    propsWith.onColleagueClick!('bu-clicked');
    // No assertion needed -- the fact that this compiles and runs validates the type
  });
});
