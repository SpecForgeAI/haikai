/**
 * journeyEnrichment.ts
 *
 * Enriches UserJourneyDiagramDto steps with ProcessActivity metadata
 * (user_interaction_level, frequency) and co-worker data from the meta model.
 */

import type { UserJourneyDiagramDto, UserJourneyDiagramStepDto, CoWorkerLink } from '../../types/userJourneyDiagram';
import type { ProcessActivity, ActivityStep, BusinessUser } from '../../types/model';

/**
 * Enrich journey diagram steps with ProcessActivity and co-worker data from the meta model.
 * Adds user_interaction_level, frequency, and co_worker_abbreviations to each step.
 */
export function enrichJourneySteps(
  journeyData: UserJourneyDiagramDto,
  processActivities: ProcessActivity[],
  activitySteps: ActivityStep[],
  businessUsers: BusinessUser[],
): UserJourneyDiagramDto {
  const paMap = new Map(processActivities.map(pa => [pa.id, pa]));
  const buMap = new Map(businessUsers.map(bu => [bu.id, bu]));

  // Group activity steps by process_activity_id for co-worker lookup
  const stepsByActivity = new Map<string, ActivityStep[]>();
  for (const as of activitySteps) {
    const existing = stepsByActivity.get(as.process_activity_id) || [];
    existing.push(as);
    stepsByActivity.set(as.process_activity_id, existing);
  }

  const enrichedSteps: UserJourneyDiagramStepDto[] = journeyData.steps.map(step => {
    const pa = paMap.get(step.process_activity_id);
    const enriched: UserJourneyDiagramStepDto = { ...step };

    if (pa) {
      enriched.user_interaction_level = pa.user_interaction_level;
      enriched.frequency = pa.frequency;
    }

    // Find co-workers: other business users with activity steps on the same process_activity
    const siblingSteps = stepsByActivity.get(step.process_activity_id) || [];
    const coWorkerAbbrevs: string[] = [];
    const coWorkerLinks: CoWorkerLink[] = [];
    const seenUserIds = new Set<string>();
    for (const sibling of siblingSteps) {
      if (sibling.business_user_id !== step.business_user_id && !seenUserIds.has(sibling.business_user_id)) {
        seenUserIds.add(sibling.business_user_id);
        const bu = buMap.get(sibling.business_user_id);
        if (bu) {
          const abbrev = bu.abbreviation || bu.name;
          coWorkerAbbrevs.push(abbrev);
          coWorkerLinks.push({ abbreviation: abbrev, user_journey_id: sibling.user_journey_id });
        }
      }
    }
    if (coWorkerAbbrevs.length > 0) {
      enriched.co_worker_abbreviations = coWorkerAbbrevs;
      enriched.co_worker_links = coWorkerLinks;
    }

    return enriched;
  });

  return { ...journeyData, steps: enrichedSteps };
}
