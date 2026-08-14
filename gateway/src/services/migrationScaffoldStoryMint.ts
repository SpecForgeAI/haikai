/**
 * Scaffold-story mint for a SAVED book (2026-08-14).
 *
 * The scaffold feature+story normally inject at epic EXPANSION time — but
 * expansion is draft-only (AMS: "items/append is only allowed on a draft
 * book"), so a plan that was saved to the backlog BEFORE the target manifest
 * existed had NO path to a scaffold story at all (the live dead end: the
 * plan-screen warning said "re-expand" and re-expand 400'd).
 *
 * This mint is the saved-book equivalent: ONE additive story via the AMS
 * add-item endpoint (which is built for saved books — it creates the
 * work_item row and stamps the blob item `workItemId + saveState=saved` in a
 * single transaction, exactly like a manual add). The story:
 *
 *   - parents under the service plane's foundations FEATURE (lowest-sequence
 *     feature of the manifest-homed host epic) with `sequence_order 0`, so
 *     the execution walk dispatches it FIRST;
 *   - carries the `seed_build_files` TAG (+ stream/provenance markers) so the
 *     deterministic bootstrap carriage, the preflight scaffold route, and the
 *     book-level warning all recognise it;
 *   - uses `kind='operational'` (the AMS ALLOWED_KINDS constraint) — the
 *     batch routes seed-tagged stories deterministically BEFORE the
 *     manual-add flavour is ever consulted.
 *
 * Additive-only: existing stories (and their generated specs) are untouched —
 * the stack-blind foundation/interface specs are refreshed via the existing
 * per-story Regenerate, not by replacement.
 */

import { getConfig } from '../config';
import { logger } from './logger';
import {
  LoadedBookOfWork,
  LoadedBookOfWorkItem,
  BookOfWorkLoader,
  defaultLoadBookOfWork,
} from './migrationShapeSpecGenerationHandler';
import { isSeedBuildFilesStory } from './migrationSeedBuildFilesEnrichment';
import {
  TargetManifestArtifactWire,
  fetchLatestTargetManifestArtifacts,
} from './targetManifestArtifactsClient';
import {
  ScaffoldServiceElement,
  resolveScaffoldServiceName,
  scaffoldManifestFilename,
  workstreamForEcosystem,
} from './migrationBookOfWorkExpansionHandler';
import {
  diagnoseScaffoldManifestGate,
  scaffoldManifestGateRemedy,
} from './migrationScaffoldManifestGate';
import { getElementsInventory } from './architectureModelClient';

// ---------------------------------------------------------------------------
// AMS add-item client (snake_case wire; the saved-book write path)
// ---------------------------------------------------------------------------

export interface ScaffoldAddItemRequest {
  provenance: string;
  kind: string;
  title: string;
  description: string;
  parent_book_item_id: string | null;
  sequence_order: number;
  workstream: string;
  acceptance_criteria: string[];
  tags: string[];
}

export type AddWorkItemFn = (
  projectId: string,
  bookId: string,
  request: ScaffoldAddItemRequest
) => Promise<{ workItemId: string | null }>;

async function defaultAddWorkItem(
  projectId: string,
  bookId: string,
  request: ScaffoldAddItemRequest
): Promise<{ workItemId: string | null }> {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url =
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}` +
    `/migration-books-of-work/${encodeURIComponent(bookId)}/items/add-item`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 500);
    } catch {
      // status alone will have to do.
    }
    throw new Error(
      `architecture model service add-item (scaffold) failed: HTTP ${response.status}` +
        (detail ? ` — ${detail}` : '')
    );
  }
  const json = (await response.json()) as { work_item_id?: string | null };
  return { workItemId: json?.work_item_id ?? null };
}

/** Reader for the target-state services elements (service-name resolution). */
export type FetchScaffoldServicesFn = (
  projectId: string,
  targetArchitectureId: string
) => Promise<ScaffoldServiceElement[]>;

async function defaultFetchScaffoldServices(
  projectId: string,
  targetArchitectureId: string
): Promise<ScaffoldServiceElement[]> {
  const inventory = await getElementsInventory(projectId, targetArchitectureId);
  const services: ScaffoldServiceElement[] = [];
  for (const domain of inventory.domains ?? []) {
    if (domain.name !== 'Applications') continue;
    for (const type of domain.types ?? []) {
      if (!/service/i.test(type.name)) continue;
      for (const instance of type.instances ?? []) {
        services.push({ id: instance.id, name: instance.name });
      }
    }
  }
  return services;
}

// ---------------------------------------------------------------------------
// Outcome + deps
// ---------------------------------------------------------------------------

export type ScaffoldMintOutcome =
  | { status: 'minted'; workItemId: string | null; parentFeatureId: string | null; title: string }
  | { status: 'already_present'; bookItemId: string }
  | { status: 'manifest_missing'; remedy: string }
  | { status: 'no_host_epic'; reason: string };

export interface ScaffoldMintDeps {
  loadBookOfWork?: BookOfWorkLoader;
  fetchManifests?: typeof fetchLatestTargetManifestArtifacts;
  fetchScaffoldServices?: FetchScaffoldServicesFn;
  addWorkItem?: AddWorkItemFn;
  diagnoseManifestGate?: typeof diagnoseScaffoldManifestGate;
}

// ---------------------------------------------------------------------------
// Host resolution over the LOADED book (stream tags, not blob workstream)
// ---------------------------------------------------------------------------

function streamOf(item: LoadedBookOfWorkItem): string | null {
  for (const t of item.tags ?? []) {
    const tag = (t ?? '').trim();
    if (tag.startsWith('stream:')) return tag.substring('stream:'.length);
  }
  return null;
}

/**
 * The manifest-homed host epic (lowest-sequence epic of the ecosystem's
 * workstream) and its lowest-sequence child FEATURE — the scaffold story's
 * parent. Mirrors the expansion-time host selection.
 */
export function resolveScaffoldParent(
  bow: LoadedBookOfWork,
  manifests: TargetManifestArtifactWire[]
): { workstream: string; hostEpic: LoadedBookOfWorkItem; parentFeature: LoadedBookOfWorkItem | null; manifest: TargetManifestArtifactWire } | null {
  for (const manifest of manifests) {
    const ws = workstreamForEcosystem(manifest?.ecosystem);
    if (!ws) continue;
    let hostEpic: LoadedBookOfWorkItem | null = null;
    for (const item of bow.items) {
      if (item.type !== 'epic') continue;
      if (streamOf(item) !== ws) continue;
      if (
        hostEpic === null ||
        (item.sequenceOrder ?? 0) < (hostEpic.sequenceOrder ?? 0) ||
        ((item.sequenceOrder ?? 0) === (hostEpic.sequenceOrder ?? 0) && item.id < hostEpic.id)
      ) {
        hostEpic = item;
      }
    }
    if (!hostEpic) continue;
    let parentFeature: LoadedBookOfWorkItem | null = null;
    for (const item of bow.items) {
      if (item.type !== 'feature' || item.parentId !== hostEpic.id) continue;
      if (
        parentFeature === null ||
        (item.sequenceOrder ?? 0) < (parentFeature.sequenceOrder ?? 0)
      ) {
        parentFeature = item;
      }
    }
    return { workstream: ws, hostEpic, parentFeature, manifest };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Mint the scaffold story into a (saved) book. Idempotent: an existing
 * `seed_build_files` story short-circuits `already_present`. The manifest
 * gate is re-checked so the mint can never create a story whose spec would
 * immediately be `insufficient_context`-blocked on a missing manifest.
 */
export async function mintScaffoldStoryIntoBook(
  input: { projectId: string; bookId: string },
  deps: ScaffoldMintDeps = {}
): Promise<ScaffoldMintOutcome> {
  const { projectId, bookId } = input;
  const loadBook = deps.loadBookOfWork ?? defaultLoadBookOfWork;
  const fetchManifests = deps.fetchManifests ?? fetchLatestTargetManifestArtifacts;
  const fetchServices = deps.fetchScaffoldServices ?? defaultFetchScaffoldServices;
  const addWorkItem = deps.addWorkItem ?? defaultAddWorkItem;
  const diagnose = deps.diagnoseManifestGate ?? diagnoseScaffoldManifestGate;

  const bow = await loadBook(projectId, bookId);

  // Idempotency: one scaffold story per book, ever.
  const existing = bow.items.find(
    (i) => i.type === 'story' && isSeedBuildFilesStory(i)
  );
  if (existing) {
    return { status: 'already_present', bookItemId: existing.id };
  }

  // The manifest gate must be OK — the story's whole content is the manifest.
  const diagnosis = await diagnose(projectId, bow.targetArchitectureId ?? null);
  if (diagnosis.status !== 'ok') {
    return { status: 'manifest_missing', remedy: scaffoldManifestGateRemedy(diagnosis) };
  }

  const manifests = await fetchManifests(projectId, bow.targetArchitectureId as string);
  const resolved = resolveScaffoldParent(bow, manifests);
  if (!resolved) {
    return {
      status: 'no_host_epic',
      reason:
        'No epic of the manifest-homed workstream exists in this plan — expand ' +
        'the service plane (or regenerate the plan) before minting the scaffold story.',
    };
  }

  // Service-name resolution (fail-soft — the label never blocks the mint).
  let services: ScaffoldServiceElement[] = [];
  try {
    services = await fetchServices(projectId, bow.targetArchitectureId as string);
  } catch (e) {
    logger.warn('Scaffold mint: services read failed; falling back to generic label', {
      projectId,
      bookId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
  const { serviceName } = resolveScaffoldServiceName({
    manifest: resolved.manifest,
    workstream: resolved.workstream as never,
    services,
  });
  const manifestFilename = scaffoldManifestFilename(resolved.manifest);

  // The FR3 seed sentence — identical to the expansion-time scaffold story.
  const seed =
    `Scaffold the ${serviceName} app and reproduce ${manifestFilename} exactly as ` +
    `confirmed, dependency-for-dependency.`;

  const { workItemId } = await addWorkItem(projectId, bookId, {
    provenance: 'net_new',
    kind: 'operational',
    title: seed,
    description: seed,
    parent_book_item_id: resolved.parentFeature?.id ?? null,
    // FIRST in the walk: every service-plane story the planner minted starts
    // at sequenceOrder >= 1.
    sequence_order: 0,
    workstream: resolved.workstream,
    acceptance_criteria: [seed],
    tags: ['seed_build_files', `stream:${resolved.workstream}`, 'provenance:scaffold'],
  });

  console.log(
    `[diag-gateway] pm_migration_delivery_plan stage=scaffold_minted_saved_book ` +
      `projectId=${projectId} bookId=${bookId} workItemId=${workItemId ?? 'null'} ` +
      `parentFeatureId=${resolved.parentFeature?.id ?? 'null'} ` +
      `workstream=${resolved.workstream} manifest=${manifestFilename}`
  );

  return {
    status: 'minted',
    workItemId,
    parentFeatureId: resolved.parentFeature?.id ?? null,
    title: seed,
  };
}
