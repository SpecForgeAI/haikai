/**
 * PDF Data Fetcher
 *
 * Fetches all diagram and meta-model data from the architecture-model-service,
 * performs enrichment (equivalent to the frontend's enrichJourneySteps and
 * enrichOverviewFull), and assembles a PdfGenerationRequest ready for the
 * PDF generator.
 *
 * This allows PDF generation without the frontend — e.g. via a direct
 * GET /api/pdf/generate/:projectId call.
 */

import { getConfig } from '../../config';
import { fetchProjectFolder, resolveDefaultArchitectureId } from '../architectureModelClient';
import { logger } from '../logger';
import type { PdfGenerationRequest, PdfDiagramGroup, PdfDiagramEntry } from './types';

// ============================================================================
// Model-service fetch helpers
// ============================================================================

function getBaseUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

/** Fetch the project name from the project DTO. */
async function fetchProjectName(projectId: string): Promise<string | null> {
  const url = `${getBaseUrl()}/api/projects/${encodeURIComponent(projectId)}`;
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;
    const name = data.name;
    return (name && typeof name === 'string' && name.trim().length > 0) ? name : null;
  } catch {
    return null;
  }
}

/**
 * Fetch the full architecture model (entities + relationships) for a project's
 * Default architecture.
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3: migrated from the
 * removed `/api/model?projectId=...` query-param form to the path-segment
 * Bucket A endpoint `/api/model/projects/{projectId}/architectures/{architectureId}`.
 * Resolves the project's Default architecture (oldest non-archived) up front.
 */
async function fetchModel(projectId: string): Promise<any | null> {
  const architectureId = await resolveDefaultArchitectureId(projectId);
  if (!architectureId) {
    logger.warn('PDF: cannot fetch model -- no default architecture for project', { projectId });
    return null;
  }
  const url = `${getBaseUrl()}/api/model/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`;
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) { logger.warn('Failed to fetch model', { projectId, architectureId, status: res.status }); return null; }
    return await res.json();
  } catch (e) {
    logger.warn('Error fetching model', { projectId, architectureId, error: (e as Error).message });
    return null;
  }
}

/**
 * Fetch all USER_JOURNEY diagram contracts for a project's Default architecture.
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3: now embeds the
 * required `{architectureId}` path segment.
 */
async function fetchAllJourneyDiagrams(projectId: string, architectureId: string): Promise<any[]> {
  const url = `${getBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/user-journey-diagrams/temporary`;
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) { logger.warn('Failed to fetch journey diagrams', { projectId, architectureId, status: res.status }); return []; }
    return await res.json();
  } catch (e) {
    logger.warn('Error fetching journey diagrams', { projectId, architectureId, error: (e as Error).message });
    return [];
  }
}

/**
 * Fetch a USER_JOURNEY_OVERVIEW diagram contract for a specific business user
 * within a project's Default architecture.
 *
 * Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3: now embeds the
 * required `{architectureId}` path segment.
 */
async function fetchOverviewDiagram(projectId: string, architectureId: string, businessUserId: string): Promise<any | null> {
  const url = `${getBaseUrl()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/user-journey-overview-diagrams/temporary?businessUserId=${encodeURIComponent(businessUserId)}`;
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) { logger.warn('Failed to fetch overview diagram', { projectId, architectureId, businessUserId, status: res.status }); return null; }
    return await res.json();
  } catch (e) {
    logger.warn('Error fetching overview diagram', { projectId, architectureId, businessUserId, error: (e as Error).message });
    return null;
  }
}

// ============================================================================
// Enrichment (ported from frontend journeyEnrichment.ts + overviewEnrichment.ts)
// ============================================================================

/** Enrich journey steps with interaction level, frequency, and co-worker data. */
function enrichJourneySteps(
  journeyData: any,
  processActivities: any[],
  activitySteps: any[],
  businessUsers: any[],
): any {
  const paMap = new Map(processActivities.map((pa: any) => [pa.id, pa]));
  const buMap = new Map(businessUsers.map((bu: any) => [bu.id, bu]));

  const stepsByActivity = new Map<string, any[]>();
  for (const as of activitySteps) {
    const existing = stepsByActivity.get(as.process_activity_id) || [];
    existing.push(as);
    stepsByActivity.set(as.process_activity_id, existing);
  }

  const enrichedSteps = (journeyData.steps || []).map((step: any) => {
    const pa = paMap.get(step.process_activity_id);
    const enriched = { ...step };

    if (pa) {
      enriched.user_interaction_level = pa.user_interaction_level;
      enriched.frequency = pa.frequency;
    }

    const siblingSteps = stepsByActivity.get(step.process_activity_id) || [];
    const coWorkerAbbrevs: string[] = [];
    const coWorkerLinks: Array<{ abbreviation: string; user_journey_id: string }> = [];
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

/** Enrich overview diagram with application details, summary counts, and related colleagues. */
function enrichOverviewFull(
  dto: any,
  activitySteps: any[],
  applications: any[],
  businessUserBusinessPoints: any[],
  businessUsers: any[],
  userJourneys: any[],
): any {
  const appMap = new Map(
    (applications || []).map((a: any) => [a.id, a.abbreviation || a.name]),
  );

  // Phase 1: Enrich nodes with application details
  const enrichedNodes = (dto.nodes || []).map((node: any) => {
    if (node.metadata?.applications?.length) return node;

    const journeySteps = (activitySteps || []).filter(
      (s: any) => s.user_journey_id === node.id,
    );
    const uniqueAppIds = [...new Set(
      journeySteps.map((s: any) => s.application_id).filter(Boolean) as string[],
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

  const enrichedDto = { ...dto, nodes: enrichedNodes };

  // Phase 2: Summary counts
  const journeyCount = enrichedDto.nodes.length;
  const businessProcessCount = (enrichedDto.lanes || []).filter((l: any) => l.id !== 'unassigned').length;
  const activityStepCount = enrichedDto.nodes.reduce(
    (sum: number, n: any) => sum + (n.metadata?.step_count || 0), 0,
  );
  const allAppIds = new Set<string>();
  for (const node of enrichedDto.nodes) {
    if (node.metadata?.applications) {
      for (const app of node.metadata.applications) allAppIds.add(app.id);
    }
  }
  enrichedDto.summary_counts = {
    journey_count: journeyCount,
    business_process_count: businessProcessCount,
    activity_step_count: activityStepCount,
    application_count: allAppIds.size,
  };

  // Phase 3: Related colleagues
  const businessUserId = dto.overview?.business_user_id;
  if (businessUserId && businessUserBusinessPoints?.length) {
    const currentUserPointIds = new Set(
      businessUserBusinessPoints
        .filter((rel: any) => rel.business_user_id === businessUserId)
        .map((rel: any) => rel.business_point_id),
    );
    const colleagueUserIds = new Set<string>();
    for (const rel of businessUserBusinessPoints) {
      if (rel.business_user_id !== businessUserId && currentUserPointIds.has(rel.business_point_id)) {
        colleagueUserIds.add(rel.business_user_id);
      }
    }
    const buNameMap = new Map((businessUsers || []).map((u: any) => [u.id, u.name]));
    const usersWithJourneys = new Set(
      (userJourneys || []).filter((j: any) => j.primary_business_user_id).map((j: any) => j.primary_business_user_id),
    );
    const colleagues: any[] = [];
    for (const cid of colleagueUserIds) {
      const name = buNameMap.get(cid);
      if (name !== undefined) {
        colleagues.push({ business_user_id: cid, business_user_name: name, has_overview: usersWithJourneys.has(cid) });
      }
    }
    colleagues.sort((a, b) => a.business_user_name.localeCompare(b.business_user_name));
    enrichedDto.related_colleagues = colleagues;
  } else {
    enrichedDto.related_colleagues = [];
  }

  return enrichedDto;
}

// ============================================================================
// Main: Assemble PdfGenerationRequest from projectId alone
// ============================================================================

/**
 * Fetches all data needed from the architecture-model-service and assembles a
 * complete PdfGenerationRequest for the given project. Returns null if
 * essential data is unavailable.
 */
export async function buildPdfRequestFromProject(projectId: string): Promise<{
  request: PdfGenerationRequest;
  outputDir: string;
} | null> {
  // Spec 2026-05-01 Multi-Architecture Plumbing - Task Group 3:
  // resolve the project's Default architecture once up-front; every Bucket A
  // helper takes it as a required parameter.
  const architectureId = await resolveDefaultArchitectureId(projectId);
  if (!architectureId) {
    logger.warn('Cannot build PDF request: no default architecture for project', { projectId });
    return null;
  }

  // Fetch model, journey diagrams, project folder, and project name in parallel
  const [model, journeyDiagrams, projectFolder, projectName] = await Promise.all([
    fetchModel(projectId),
    fetchAllJourneyDiagrams(projectId, architectureId),
    fetchProjectFolder(projectId),
    fetchProjectName(projectId),
  ]);

  if (!projectFolder) {
    logger.warn('Cannot build PDF request: project folder not found', { projectId });
    return null;
  }
  if (!model || !model.metaModel) {
    logger.warn('Cannot build PDF request: model not found', { projectId });
    return null;
  }
  if (journeyDiagrams.length === 0) {
    logger.warn('Cannot build PDF request: no journey diagrams found', { projectId });
    return null;
  }

  const entities = model.metaModel.entities || {};
  const relationships = model.metaModel.relationships || {};
  const processActivities: any[] = entities.process_activities || [];
  const activitySteps: any[] = entities.activity_steps || [];
  const businessUsers: any[] = entities.business_users || [];
  const applications: any[] = entities.applications || [];
  const userJourneys: any[] = entities.user_journeys || [];
  const businessUserBusinessPoints: any[] = relationships.business_user_business_points || [];

  // Build maps from entity IDs -> saved diagram IDs using model.diagrams.
  // The PDF generator registers named destinations as dest_${entry.id}, so entry IDs
  // must match the IDs that overview nodes reference in linked_diagram_id (for journeys)
  // and that the pageNumberMap/dest system uses (for overviews).
  const savedDiagrams: any[] = model.diagrams || [];
  const entityIdToSavedDiagramId = new Map<string, string>();
  const businessUserToSavedOverviewId = new Map<string, string>();
  for (const d of savedDiagrams) {
    const tc = d.typed_content || d.typedContent;
    if (d.diagram_type === 'USER_JOURNEY') {
      const journeyEntityId = tc?.content?.journey?.id;
      if (journeyEntityId) entityIdToSavedDiagramId.set(journeyEntityId, d.id);
    } else if (d.diagram_type === 'USER_JOURNEY_OVERVIEW') {
      const buName = tc?.content?.overview?.business_user_name;
      if (buName) businessUserToSavedOverviewId.set(buName, d.id);
    }
  }

  // Group journey diagrams by business user (user_role_name on the journey object)
  const groupMap = new Map<string, { userId: string; diagrams: any[] }>();
  for (const jd of journeyDiagrams) {
    const userName = jd.journey?.user_role_name || 'Unknown';
    const userId = jd.journey?.user_role_id || '';
    if (!groupMap.has(userName)) {
      groupMap.set(userName, { userId, diagrams: [] });
    }
    groupMap.get(userName)!.diagrams.push(jd);
  }

  // Resolve a stable diagram ID for each journey: prefer saved diagram ID, fall back to entity ID
  function resolveDiagramId(journeyEntityId: string): string {
    return entityIdToSavedDiagramId.get(journeyEntityId) || journeyEntityId;
  }

  // Build coWorkerDiagramMap: user_journey_id -> diagram ID
  const coWorkerDiagramMap: Record<string, string> = {};
  for (const jd of journeyDiagrams) {
    const entityId = jd.journey?.id;
    if (entityId) coWorkerDiagramMap[entityId] = resolveDiagramId(entityId);
  }

  // For each business user group, fetch overview + enrich all diagrams
  const groups: PdfDiagramGroup[] = [];
  const sortedUserNames = [...groupMap.keys()].sort();

  for (const userName of sortedUserNames) {
    const { userId, diagrams: rawJourneys } = groupMap.get(userName)!;
    const groupDiagrams: PdfDiagramEntry[] = [];

    // Fetch and enrich the overview diagram for this business user
    if (userId) {
      const overviewDto = await fetchOverviewDiagram(projectId, architectureId, userId);
      if (overviewDto && overviewDto.nodes?.length > 0) {
        const enrichedOverview = enrichOverviewFull(
          overviewDto, activitySteps, applications,
          businessUserBusinessPoints, businessUsers, userJourneys,
        );
        // Compute nav links for overview: linkedJourneys = all journeys in this group
        const linkedJourneys = rawJourneys.map((jd: any) => ({
          id: resolveDiagramId(jd.journey?.id || ''),
          name: jd.journey?.name || '',
        }));
        // Use saved diagram ID if available, so dest_${id} matches what the
        // generator registers; fall back to a synthetic ID with underscore (not colon)
        // to stay consistent with the dest_overview_${buName} pattern.
        const overviewId = businessUserToSavedOverviewId.get(userName) || `overview_${userName}`;
        groupDiagrams.push({
          id: overviewId,
          name: `${userName} — Overview`,
          type: 'USER_JOURNEY_OVERVIEW',
          content: enrichedOverview,
          navLinks: { linkedJourneys },
        });
      }
    }

    // Enrich and add each journey diagram
    for (const jd of rawJourneys) {
      const enriched = enrichJourneySteps(jd, processActivities, activitySteps, businessUsers);

      // Compute nav links for this journey
      const journeyEntityId = jd.journey?.id;
      let parentOverview: { id: string; name: string } | null = null;
      if (userId) {
        const overviewId = businessUserToSavedOverviewId.get(userName) || `overview_${userName}`;
        parentOverview = { id: overviewId, name: `${userName} — Overview` };
      }

      // Linked journeys: other journeys sharing activity steps via user_journey_links
      const linkedJourneys: { id: string; name: string }[] = [];
      // Find linked journey IDs through the overview's node links
      const overviewNodeIds = new Set(
        (rawJourneys.map((j: any) => j.journey?.id)).filter(Boolean),
      );
      // Find journeys linked via shared process activities (co-workers)
      for (const step of enriched.steps || []) {
        for (const cw of step.co_worker_links || []) {
          const linkedDiagramId = coWorkerDiagramMap[cw.user_journey_id];
          if (linkedDiagramId && linkedDiagramId !== journeyEntityId) {
            const linkedJd = journeyDiagrams.find((d: any) => d.journey?.id === cw.user_journey_id);
            if (linkedJd) {
              linkedJourneys.push({ id: linkedDiagramId, name: linkedJd.journey?.name || '' });
            }
          }
        }
      }
      // Deduplicate
      const seenLinks = new Set<string>();
      const uniqueLinkedJourneys = linkedJourneys.filter(l => {
        if (seenLinks.has(l.id)) return false;
        seenLinks.add(l.id);
        return true;
      });

      groupDiagrams.push({
        id: resolveDiagramId(journeyEntityId || '') || jd.journey?.name || '',
        name: jd.journey?.name || 'Untitled Journey',
        type: 'USER_JOURNEY',
        content: enriched,
        navLinks: { parentOverview, linkedJourneys: uniqueLinkedJourneys, coWorkerDiagramMap },
      });
    }

    groups.push({
      businessUserName: userName,
      diagrams: groupDiagrams,
    });
  }

  const pdfProjectName = projectName || `Project ${projectId.substring(0, 8)}`;

  return {
    request: { projectId, projectName: pdfProjectName, groups },
    outputDir: `${projectFolder}/exports`,
  };
}
