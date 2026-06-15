/**
 * Overview Diagram Enrichment Utilities
 *
 * Pure functions for enriching UserJourneyOverviewDiagramDto with:
 * 1. Application details per node (existing enrichOverviewWithApps logic, extracted)
 * 2. Summary counts (journey, business process, activity step, application counts)
 * 3. Related colleagues (business users sharing BusinessPoints via relationships)
 *
 * These functions are designed to be called from both DiagramsView.tsx and Canvas.tsx,
 * ensuring consistent enrichment at all three overview render sites.
 *
 * Spec 2026-04-10: User Journey Overview Diagram Enhancements
 * Task Group 3: Frontend Data Enrichment for Summary and Colleagues
 */

import type {
  UserJourneyOverviewDiagramDto,
  OverviewSummaryCountsDto,
  RelatedColleagueDto,
} from '../../types/userJourneyOverviewDiagram';

// ============================================================================
// Meta-model data shapes (minimal typing for the meta-model slices we need)
// ============================================================================

/** Minimal shape for an activity step entity from the meta-model */
export interface MetaModelActivityStep {
  id: string;
  user_journey_id: string;
  application_id?: string;
}

/** Minimal shape for an application entity from the meta-model */
export interface MetaModelApplication {
  id: string;
  name: string;
  abbreviation?: string;
}

/** Minimal shape for a business_user_business_points relationship */
export interface MetaModelBusinessUserBusinessPoint {
  id: string;
  business_user_id: string;
  business_point_id: string;
}

/** Minimal shape for a business user entity */
export interface MetaModelBusinessUser {
  id: string;
  name: string;
}

/** Minimal shape for a user journey entity */
export interface MetaModelUserJourney {
  id: string;
  name: string;
  primary_business_user_id?: string;
}

/**
 * The subset of meta-model data needed for overview enrichment.
 * Callers extract these from state.model.metaModel.
 */
export interface OverviewEnrichmentMetaData {
  activitySteps: MetaModelActivityStep[];
  applications: MetaModelApplication[];
  businessUserBusinessPoints: MetaModelBusinessUserBusinessPoint[];
  businessUsers: MetaModelBusinessUser[];
  userJourneys: MetaModelUserJourney[];
}

// ============================================================================
// Summary Counts Computation (Task 3.2)
// ============================================================================

/**
 * Compute summary counts from an overview DTO.
 *
 * A = dto.nodes.length (journey count)
 * B = dto.lanes excluding 'unassigned' (business process count)
 * C = sum of all node.metadata.step_count (activity step count)
 * D = unique application IDs across all nodes' metadata.applications arrays
 */
export function computeSummaryCounts(dto: UserJourneyOverviewDiagramDto): OverviewSummaryCountsDto {
  const journeyCount = dto.nodes.length;

  const businessProcessCount = dto.lanes.filter(l => l.id !== 'unassigned').length;

  const activityStepCount = dto.nodes.reduce(
    (sum, node) => sum + (node.metadata.step_count || 0),
    0,
  );

  const allAppIds = new Set<string>();
  for (const node of dto.nodes) {
    if (node.metadata.applications) {
      for (const app of node.metadata.applications) {
        allAppIds.add(app.id);
      }
    }
  }
  const applicationCount = allAppIds.size;

  return {
    journey_count: journeyCount,
    business_process_count: businessProcessCount,
    activity_step_count: activityStepCount,
    application_count: applicationCount,
  };
}

// ============================================================================
// Related Colleagues Computation (Task 3.3)
// ============================================================================

/**
 * Compute related colleagues for an overview diagram's business user.
 *
 * Algorithm:
 * 1. Find all business_point_ids linked to the current business_user_id
 *    via business_user_business_points relationships
 * 2. Find all OTHER business_user_ids linked to any of those same business_point_ids
 * 3. Resolve colleague names from entities.business_users
 * 4. Determine has_overview for each colleague by checking if any user_journey
 *    has that colleague's ID as primary_business_user_id
 * 5. Return sorted alphabetically by name
 */
export function computeRelatedColleagues(
  businessUserId: string,
  meta: OverviewEnrichmentMetaData,
): RelatedColleagueDto[] {
  const { businessUserBusinessPoints, businessUsers, userJourneys } = meta;

  if (!businessUserBusinessPoints || businessUserBusinessPoints.length === 0) {
    return [];
  }

  // Step 1: Find all business_point_ids linked to the current user
  const currentUserPointIds = new Set(
    businessUserBusinessPoints
      .filter(rel => rel.business_user_id === businessUserId)
      .map(rel => rel.business_point_id),
  );

  if (currentUserPointIds.size === 0) {
    return [];
  }

  // Step 2: Find all OTHER business_user_ids linked to any of those points
  const colleagueUserIds = new Set<string>();
  for (const rel of businessUserBusinessPoints) {
    if (rel.business_user_id !== businessUserId && currentUserPointIds.has(rel.business_point_id)) {
      colleagueUserIds.add(rel.business_user_id);
    }
  }

  if (colleagueUserIds.size === 0) {
    return [];
  }

  // Step 3: Resolve colleague names from business_users
  const businessUserMap = new Map(
    (businessUsers || []).map(u => [u.id, u.name]),
  );

  // Step 4: Determine has_overview for each colleague
  // A colleague has_overview if any user_journey has their ID as primary_business_user_id
  const usersWithJourneys = new Set(
    (userJourneys || [])
      .filter(j => j.primary_business_user_id)
      .map(j => j.primary_business_user_id!),
  );

  // Step 5: Build and sort the result
  const colleagues: RelatedColleagueDto[] = [];
  for (const colleagueId of colleagueUserIds) {
    const name = businessUserMap.get(colleagueId);
    if (name !== undefined) {
      colleagues.push({
        business_user_id: colleagueId,
        business_user_name: name,
        has_overview: usersWithJourneys.has(colleagueId),
      });
    }
  }

  colleagues.sort((a, b) => a.business_user_name.localeCompare(b.business_user_name));

  return colleagues;
}

// ============================================================================
// Full Enrichment (Task 3.4 / 3.5)
// ============================================================================

/**
 * Perform full overview enrichment: app details per node, summary counts,
 * and related colleagues.
 *
 * This is the single entry point used at all three render sites:
 * - DiagramsView.tsx journey review
 * - DiagramsView.tsx standalone overview review
 * - Canvas.tsx saved diagram render
 */
export function enrichOverviewFull(
  dto: UserJourneyOverviewDiagramDto,
  meta: OverviewEnrichmentMetaData,
): UserJourneyOverviewDiagramDto {
  const { activitySteps, applications } = meta;

  // --- Phase 1: Enrich nodes with application details (existing pattern) ---
  const appMap = new Map(
    (applications || []).map((a: MetaModelApplication) => [a.id, a.abbreviation || a.name]),
  );

  const enrichedNodes = dto.nodes.map(node => {
    // Skip if already enriched (idempotency guard)
    if (node.metadata.applications?.length) return node;

    const journeySteps = (activitySteps || []).filter(
      (s: MetaModelActivityStep) => s.user_journey_id === node.id,
    );
    const uniqueAppIds = [...new Set(
      journeySteps.map((s: MetaModelActivityStep) => s.application_id).filter(Boolean) as string[],
    )];
    const apps = uniqueAppIds
      .map(id => ({ id, abbreviation: appMap.get(id) || id }))
      .sort((a, b) => a.abbreviation.localeCompare(b.abbreviation));

    return {
      ...node,
      metadata: {
        ...node.metadata,
        applications: apps,
      },
    };
  });

  const enrichedDto: UserJourneyOverviewDiagramDto = { ...dto, nodes: enrichedNodes };

  // --- Phase 2: Compute summary counts ---
  enrichedDto.summary_counts = computeSummaryCounts(enrichedDto);

  // --- Phase 3: Compute related colleagues ---
  const businessUserId = dto.overview?.business_user_id;
  if (businessUserId) {
    enrichedDto.related_colleagues = computeRelatedColleagues(businessUserId, meta);
  } else {
    enrichedDto.related_colleagues = [];
  }

  return enrichedDto;
}
