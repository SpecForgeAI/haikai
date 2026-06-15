/**
 * DiscoveryReviewRoom
 *
 * Spec: 2026-06-02-conversational-discovery-review-architect (Spec 3 — capstone,
 * Task Group 4) + 2026-06-06-discovery-review-room-agenda-redesign-2 (Task Group 5:
 * the four-button rich-cascade FAMILY chunk, immediate-apply + auto-advance +
 * scroll, conflicts-applied-in-place, and the single terminal Save Yes/No).
 *
 * The conversational "Architect" discovery-review room hosted inside
 * `RightHandPanelShell` (persona `architect`). It is the thin, hybrid,
 * LLM-enhanced layer over the already-built deterministic backbone (Specs 0-2):
 * the LLM only NARRATES facts and PROPOSES structured intents; deterministic
 * code (server-side) owns every count, cascade, conflict, and write.
 *
 * 2026-06-06 redesign-2 — the confirm box is GONE from the chunk + conflict path:
 *   - A FAMILY chunk renders a rich multi-line cascade summary (from the
 *     server-supplied `cascadePreview`) PLUS four immediate-apply buttons: Approve
 *     All (`scope:'cascade'`) / Approve visible chunk (`scope:'family'`) / Reject
 *     All / Defer All. Clicking ANY of the four applies IMMEDIATELY (the click IS
 *     the confirmation) and the coordinator returns the NEXT agenda chunk in the
 *     `'applied'` outcome — the room appends it and scrolls the user's last blue
 *     action message to the top so the new chunk directly below is visible.
 *   - Conflict resolution ("Use <source>" / "Use <source> for all N") also applies
 *     immediately and re-renders the SAME chunk IN PLACE with the conflict cleared
 *     (it does NOT advance — Q4).
 *   - The ONLY surviving confirmation is the terminal "Save all approved candidates
 *     back to the architecture?" Yes/No, auto-appended when an apply leaves the
 *     agenda exhausted. "Yes" mirrors the candidates-table "Save All Approved"
 *     effect; "No" is a no-op (the candidates table is the anytime escape hatch).
 *
 * Surfaces (Decisions 3, 6, 8, 9):
 *   - The scan-selection OPENING TURN — lists the project/architecture runs grouped
 *     per service for a 0-or-1-per-service pick, defaulting to the current run.
 *   - The re-skinned per-kind transcript renderer + the click-to-answer input bar.
 *   - The net-new four-button rich-cascade chunk renderer (`chunk-summary`) + the
 *     terminal Save surface (`pending-confirmation`, terminal Save ONLY). Every
 *     action — chunk button, conflict pick, or LLM proposal — routes through the
 *     SAME `/capture` `propose-intent` (immediate apply) or `/answer` path.
 *   - Degrade-in-place: on ANY LLM-failure signal the room ADDITIONALLY shows the
 *     deterministic agenda IN PLACE over the SAME chunk — the user is NOT bounced
 *     out to the grid.
 *
 * Sync (Decision 6): an OPTIMISTIC local snapshot gives instant transcript
 * feedback, then a lightweight refetch of the Spec 1 review-model counts after
 * each applied decision keeps counts authoritative. NO shared cross-page store.
 *
 * The CSS chrome is re-skinned from the chassis `ArchitectConversation.module.css`
 * (the transcript / input-bar / chip surfaces) plus a small room-specific module
 * for the net-new chunk + terminal-Save surfaces.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getDiscoveryRuns, readSnapshotServiceName } from '../../api/discoveryApi';
import type { DiscoveryRunDto } from '../../api/discoveryApi';
import {
  answerReviewTurn,
  captureReviewTurn,
  confirmReviewTurn,
  getReviewModelCounts,
  loadReviewConversation,
  startReview,
  type BulkReviewActionWire,
  type CascadePreviewWire,
  type CrossLayerMappingWire,
  type ChunkItemRefWire,
  type ChunkSummaryTurnWire,
  type PendingConfirmationTurnWire,
  type ProposedReviewIntentWire,
  type ReviewModelCounts,
  type ReviewTurnOutcomeWire,
  type ReviewTurnWire,
  type SelectedScanSetWire,
} from '../../api/discoveryReviewApi';
import { useArchitecture } from '../../contexts/ArchitectureContext';
import type { ApplicationComponent, Service } from '../../types/model';
import { deriveServiceTier, type ServiceTier } from '../../utils/deriveServiceTier';
import chassis from '../targetState/architectConversation/ArchitectConversation.module.css';
import styles from './DiscoveryReviewRoom.module.css';

export interface DiscoveryReviewRoomProps {
  projectId: string;
  architectureId: string;
  /** The current run (the default-selected scan in the opener). */
  runId: string;
  /**
   * The current run's `discovery_kind`. Retained on the props contract (callers
   * still pass it), but no longer drives picker seating -- the per-service picker
   * seats the current run within ITS service group by `service_id` (spec
   * 2026-06-05-per-service-scan-selection, Task Group 4.5), not by kind.
   */
  runDiscoveryKind?: string | null;
  /** Who opened the room (recorded on the `open` turn). */
  openedBy: string;
}

type ScanKind = 'code' | 'database';

function normalizeScanKind(kind: string | null | undefined): ScanKind {
  return kind === 'database' ? 'database' : 'code';
}

/** A short, stable run label for the picker + the room (no name field exists on the DTO). */
function runLabel(run: DiscoveryRunDto): string {
  const shortId = run.id.length > 8 ? `${run.id.slice(0, 8)}…` : run.id;
  return `${shortId} · ${run.status}`;
}

/**
 * The synthetic group key the orphan (NULL `service_id`) runs collect under.
 * Real service groups key on the `service_id` value itself.
 */
const UNASSIGNED_KEY = '__unassigned__';
const UNASSIGNED_NAME = 'Unassigned scans';

/** Human label for each architectural TECHNOLOGY tier (NOT the A/B/C confidence tier). */
const TIER_LABEL: Record<ServiceTier, string> = {
  UI: 'UI',
  Service: 'Service',
  Persistence: 'Persistence',
  Unknown: 'Unknown',
};

/**
 * One per-service picker group: the runs that share a `service_id` (or the
 * orphan bucket), the resolved human display name, and the optional technology
 * tier label. `key` is the `service_id` for a real service, or `UNASSIGNED_KEY`
 * for the orphan bucket. `serviceId` is the real FK (null for the orphan group).
 */
interface ServiceGroup {
  key: string;
  serviceId: string | null;
  /** Human display name: model `services[].name` -> snapshot name -> run label. */
  displayName: string;
  /** Architectural TECHNOLOGY tier (UI/Service/Persistence/Unknown); never blocks. */
  tier: ServiceTier;
  runs: DiscoveryRunDto[];
}

/**
 * Group the runs by `service_id` into per-service picker groups (spec
 * `2026-06-05-per-service-scan-selection`, Task Group 4.4). Orphan runs (NULL
 * `service_id`) collect under the synthetic "Unassigned scans" bucket. The
 * display name precedence is: the cached model `services[].name` when the
 * `service_id` resolves -> else the run's snapshot service name (camelCase-first
 * dual-tolerant) -> else today's short `runLabel`. The optional technology tier
 * is derived from the cached model via `deriveServiceTier` and NEVER blocks
 * (an unresolved tier is the fully-selectable `'Unknown'`).
 *
 * Pure (no I/O). Real service groups sort by display name for a stable order;
 * the "Unassigned scans" bucket always sorts LAST.
 */
function buildServiceGroups(
  runs: readonly DiscoveryRunDto[],
  serviceById: ReadonlyMap<string, Service>,
  appComponentsById: ReadonlyMap<string, ApplicationComponent>,
): ServiceGroup[] {
  const byKey = new Map<string, DiscoveryRunDto[]>();
  for (const run of runs) {
    const sid = run.service_id ?? null;
    const key = sid ?? UNASSIGNED_KEY;
    const bucket = byKey.get(key);
    if (bucket) bucket.push(run);
    else byKey.set(key, [run]);
  }

  const groups: ServiceGroup[] = [];
  for (const [key, groupRuns] of byKey) {
    if (key === UNASSIGNED_KEY) {
      groups.push({
        key,
        serviceId: null,
        displayName: UNASSIGNED_NAME,
        tier: 'Unknown',
        runs: groupRuns,
      });
      continue;
    }
    const service = serviceById.get(key);
    // Display name: model service name -> snapshot name (from any run) -> run label.
    const snapshotName = groupRuns
      .map((r) => readSnapshotServiceName(r))
      .find((n): n is string => n != null);
    const displayName =
      (service?.name && service.name.length > 0 ? service.name : null) ??
      snapshotName ??
      runLabel(groupRuns[0]);
    groups.push({
      key,
      serviceId: key,
      displayName,
      tier: deriveServiceTier(service, appComponentsById),
      runs: groupRuns,
    });
  }

  groups.sort((a, b) => {
    // "Unassigned scans" always last; real services alphabetical by display name.
    const aUnassigned = a.key === UNASSIGNED_KEY;
    const bUnassigned = b.key === UNASSIGNED_KEY;
    if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
    return a.displayName.localeCompare(b.displayName);
  });
  return groups;
}

/**
 * Re-derive the `open`-turn summary line from the selected scan SET (spec
 * `2026-06-05-per-service-scan-selection`, Task Group 4.9). Replaces the old
 * 2-run `secondRunId`-keyed "code + database scans" vs "<kind> scan" wording,
 * which no longer holds for a 3-run (2 code + 1 DB) selection. Reads correctly
 * for any 1..N selection: "N scans (X code, Y database)" for >1 run, else
 * "<kind> scan" for a single run.
 */
function openTurnScanSummary(set: SelectedScanSetWire): string {
  const runs = set.runs ?? [];
  if (runs.length <= 1) {
    const kind = runs[0]?.scanKind ?? 'code';
    return `${kind} scan`;
  }
  const codeCount = runs.filter((r) => r.scanKind === 'code').length;
  const dbCount = runs.filter((r) => r.scanKind === 'database').length;
  const parts: string[] = [];
  if (codeCount > 0) parts.push(`${codeCount} code`);
  if (dbCount > 0) parts.push(`${dbCount} database`);
  return `${runs.length} scans (${parts.join(', ')})`;
}

/** The three dispositions the per-row chunk buttons offer, with their display verbs. */
const ACTION_BUTTONS: Array<{ action: BulkReviewActionWire; label: string }> = [
  { action: 'approved', label: 'Approve' },
  { action: 'rejected', label: 'Reject' },
  { action: 'deferred', label: 'Defer' },
];

const ACTION_VERB: Record<BulkReviewActionWire, string> = {
  approved: 'Approve',
  rejected: 'Reject',
  deferred: 'Defer',
};

/**
 * The whole-family bulk button label (2026-06-06 redesign-2). These are the
 * FULL-CASCADE dispositions — Approve All / Reject All / Defer All.
 */
const FAMILY_ACTION_LABEL: Record<BulkReviewActionWire, string> = {
  approved: 'Approve All',
  rejected: 'Reject All',
  deferred: 'Defer All',
};

/**
 * Build the apply-decision intent for a single chunk item (candidate XOR
 * finding). Pure helper shared by the chunk buttons + the degraded agenda so the
 * candidate/finding routing lives in one place. A per-row apply is a FULL cascade
 * (no `scope` ⇒ `'cascade'`).
 */
function applyDecisionIntentFor(
  item: ChunkItemRefWire,
  action: BulkReviewActionWire,
): ProposedReviewIntentWire {
  return item.itemType === 'finding'
    ? { kind: 'apply-decision', seedCandidateIds: [], findingIds: [item.id], action }
    : { kind: 'apply-decision', seedCandidateIds: [item.id], findingIds: [], action };
}

/**
 * Build the family-level bulk apply-decision intent (2026-06-05 agenda redesign;
 * 2026-06-06 `scope` discriminator — S1). Seeds ONLY the family parent id — the
 * server-side cascade pulls the `parent_child` children. The `scope` selects the
 * apply REACH: `'cascade'` (default) for Approve All / Reject All / Defer All (the
 * resolver's FULL touched set), or `'family'` for "Approve visible chunk" (seed ∪
 * direct `parent_child` children ONLY). The frontend never enumerates the
 * children into the seed.
 */
function familyBulkIntentFor(
  parentId: string,
  action: BulkReviewActionWire,
  scope: 'family' | 'cascade' = 'cascade',
): ProposedReviewIntentWire {
  return {
    kind: 'apply-decision',
    seedCandidateIds: [parentId],
    findingIds: [],
    action,
    scope,
  };
}

/**
 * Build the "Approve visible chunk" intent (2026-06-06 redesign-2, the FOURTH
 * family button). It is an `apply-decision` with `action: 'approved'` +
 * `scope: 'family'` — the `deriveFamilyForSeed` reach (seed ∪ direct `parent_child`
 * children ONLY). The associated logical entities/attributes are NOT cascaded and
 * arrive as their own later chunks.
 */
function familyVisibleChunkIntentFor(parentId: string): ProposedReviewIntentWire {
  return familyBulkIntentFor(parentId, 'approved', 'family');
}

/**
 * Build the TYPE-LEVEL bulk intent (2026-06-09) for an orphan-by-type chunk:
 * Approve / Reject / Defer ALL still-actionable candidates of one `candidateType`
 * within a scan. The coordinator enumerates the target set from the model
 * server-side, so the room sends only the (type, scan, action) — never the
 * (potentially thousands of) candidate ids.
 */
function typeBulkIntentFor(
  candidateType: string,
  scanScope: 'code' | 'database',
  action: BulkReviewActionWire,
): ProposedReviewIntentWire {
  return { kind: 'apply-decision-by-type', candidateType, scanScope, action };
}

/**
 * Build the FINDINGS bulk intent (2026-06-09) for a findings-by-severity chunk:
 * Approve / Reject / Defer ALL still-actionable findings within a scan. The
 * coordinator enumerates the target finding ids server-side.
 */
function findingsBulkIntentFor(
  scanScope: 'code' | 'database',
  action: BulkReviewActionWire,
): ProposedReviewIntentWire {
  return { kind: 'apply-decision-findings', scanScope, action };
}

// ---------------------------------------------------------------------------
// Rich cascade-summary prose (2026-06-06 redesign-2, feature i). Type-driven,
// pure, rendered from the server-supplied `cascadePreview`. Faithful to the
// worked examples but generalised to any `candidate_type` (so a DB-scan family
// renders the table/columns + logical entities/attributes analogue).
// ---------------------------------------------------------------------------

/**
 * Humanise a `candidate_type` into a readable singular/plural noun phrase. Covers
 * the code-scan + DB-scan types the agenda surfaces; an unknown type falls back to
 * its underscores-as-spaces form (with a naive plural `s`). PURE.
 */
function humanizeCandidateType(type: string, count: number): string {
  const plural = count !== 1;
  // Keyed by the canonical AMS `candidate_type`, which is the PLURAL collection
  // name (e.g. `logical_data_attributes`, `logical_data_entities`). Singular
  // aliases are also accepted so an older/singular wire still renders correctly.
  // Each entry carries BOTH the one- and many- noun phrase so "1 logical data
  // entity" / "10 logical data attributes" both read naturally.
  const NOUNS: Record<string, { one: string; many: string }> = {
    interface: { one: 'interface', many: 'interfaces' },
    interfaces: { one: 'interface', many: 'interfaces' },
    endpoint: { one: 'endpoint', many: 'endpoints' },
    endpoints: { one: 'endpoint', many: 'endpoints' },
    service: { one: 'service', many: 'services' },
    services: { one: 'service', many: 'services' },
    class: { one: 'class', many: 'classes' },
    classes: { one: 'class', many: 'classes' },
    method: { one: 'method', many: 'methods' },
    methods: { one: 'method', many: 'methods' },
    logical_data_entity: { one: 'logical data entity', many: 'logical data entities' },
    logical_data_entities: { one: 'logical data entity', many: 'logical data entities' },
    logical_data_attribute: { one: 'logical data attribute', many: 'logical data attributes' },
    logical_data_attributes: { one: 'logical data attribute', many: 'logical data attributes' },
    physical_data_entity: { one: 'physical data entity', many: 'physical data entities' },
    physical_data_entities: { one: 'physical data entity', many: 'physical data entities' },
    physical_data_attribute: { one: 'physical data attribute', many: 'physical data attributes' },
    physical_data_attributes: { one: 'physical data attribute', many: 'physical data attributes' },
    table: { one: 'table', many: 'tables' },
    tables: { one: 'table', many: 'tables' },
    column: { one: 'column', many: 'columns' },
    columns: { one: 'column', many: 'columns' },
  };
  const noun = NOUNS[type];
  if (noun) return plural ? noun.many : noun.one;
  // Unknown type: underscores → spaces. Pluralise ONLY when the base does not
  // already end in 's' (so a plural collection name is never double-pluralised
  // into e.g. "attributess").
  const base = type.replace(/_/g, ' ');
  if (!plural) return base;
  return base.endsWith('s') ? base : `${base}s`;
}

/**
 * The "(N already approved)" / "(N already rejected)" / "(N already deferred)"
 * annotation suffix for one per-type row (only the non-zero dispositions are
 * surfaced, in approve→reject→defer order). PURE — returns '' when nothing is
 * already decided.
 */
function alreadyAnnotation(row: CascadePreviewWire['byType'][number]): string {
  const parts: string[] = [];
  if (row.alreadyApproved > 0) parts.push(`${row.alreadyApproved} already approved`);
  if (row.alreadyRejected > 0) parts.push(`${row.alreadyRejected} already rejected`);
  if (row.alreadyDeferred > 0) parts.push(`${row.alreadyDeferred} already deferred`);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

/** One rendered cascade-summary line (a numbered per-type breakdown row). */
interface CascadeSummaryLine {
  /** The `candidate_type` this line aggregates (also its render key + test id suffix). */
  type: string;
  /** The full sentence text, e.g. "2 logical data entities (1 already approved)". */
  text: string;
}

/**
 * Build the rich multi-line cascade summary (header + numbered per-type lines)
 * from the server-supplied `cascadePreview` (2026-06-06 redesign-2). The seed name
 * (the family parent's display name) is woven into the header for context. PURE —
 * a faithful, type-driven render of the precomputed preview; NO client-side count
 * recomputation.
 */
function buildCascadeSummary(
  preview: CascadePreviewWire,
  seedName: string | null,
): { header: string; lines: CascadeSummaryLine[] } {
  const total = preview.total;
  const seedPart = seedName ? ` — the current seed '${seedName}' and its cascade` : '';
  const header = `Review the current ${total} candidate${total === 1 ? '' : 's'}${seedPart}:`;
  const lines: CascadeSummaryLine[] = preview.byType.map((row) => ({
    type: row.type,
    text: `${row.count} ${humanizeCandidateType(row.type, row.count)}${alreadyAnnotation(row)}`,
  }));
  return { header, lines };
}

/**
 * Build the cross-layer (logical↔physical) mapping note text from the
 * server-supplied `crossLayerMapping` (Spec 2026-06-08). The logical↔physical
 * cascade is intentionally NOT crossed, so this preserves the connection:
 *   - PHYSICAL family → the mapped LOGICAL entities + their decided tally (the
 *     "you have already approved/rejected N" note the user asked for);
 *   - LOGICAL family → the mapped PHYSICAL entity names (reviewed later in the DB scan).
 * PURE — a faithful render of the precomputed mapping; no client recomputation.
 */
function buildCrossLayerNote(clm: CrossLayerMappingWire): string {
  const names = clm.counterpartNames;
  const namesList = names.length > 0 ? ` (${names.join(', ')})` : '';

  if (clm.parentLayer === 'logical') {
    // Logical family: name the mapped physical counterparts (reviewed separately).
    const noun = names.length === 1 ? 'physical entity' : 'physical entities';
    return `mapped to ${names.length} ${noun}${namesList} — reviewed separately in the database scan.`;
  }

  // Physical family: the mapped logical entities + their decided tally.
  const d = clm.mappedDecisions ?? { approved: 0, rejected: 0, deferred: 0, pending: 0 };
  const total = d.approved + d.rejected + d.deferred + d.pending;
  const entityNoun = total === 1 ? 'logical entity' : 'logical entities';
  const decided: string[] = [];
  if (d.approved > 0) decided.push(`${d.approved} approved`);
  if (d.rejected > 0) decided.push(`${d.rejected} rejected`);
  if (d.deferred > 0) decided.push(`${d.deferred} deferred`);

  if (decided.length === 0) {
    // None decided yet — still surface the connection.
    return `${total} ${entityNoun} mapped to this physical entity${namesList} — not yet reviewed.`;
  }
  const pendingTail = d.pending > 0 ? ` (${d.pending} still pending)` : '';
  return `you have already reviewed ${decided.join(', ')} of the ${total} ${entityNoun} mapped to this physical entity${pendingTail}${namesList}.`;
}

export function DiscoveryReviewRoom({
  projectId,
  architectureId,
  runId,
  openedBy,
}: DiscoveryReviewRoomProps) {
  // ---- Scan-selection opener state -------------------------------------
  const [runs, setRuns] = useState<DiscoveryRunDto[]>([]);
  const [runsLoading, setRunsLoading] = useState(true);
  const [runsError, setRunsError] = useState<string | null>(null);

  // The per-service selection map: serviceKey -> the selected runId in THAT
  // group (or null = "None"). 0-or-1 selected per service; >=1 overall to Begin
  // (spec 2026-06-05-per-service-scan-selection, Task Group 4.6). The current
  // run seeds ITS service group; other groups start unselected. Seeded once the
  // runs load (the run -> service grouping isn't known until then).
  const [selectionByService, setSelectionByService] = useState<
    Record<string, string | null>
  >({});
  // Guards the one-time seeding of the current run's group from the loaded runs.
  const [selectionSeeded, setSelectionSeeded] = useState(false);

  // ---- Session / transcript state --------------------------------------
  const [started, setStarted] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [turns, setTurns] = useState<ReviewTurnWire[]>([]);
  const [scanSet, setScanSet] = useState<SelectedScanSetWire | null>(null);
  const [counts, setCounts] = useState<ReviewModelCounts | null>(null);

  // The newest chunk (drives the degraded agenda's items + the conflict in-place
  // refresh). For a disposition this advances to the next chunk; for a conflict it
  // is the SAME chunk refreshed; on agenda exhaustion it is null.
  const [currentChunk, setCurrentChunk] = useState<ChunkSummaryTurnWire | null>(null);
  // The newest still-open pending intent — after the 2026-06-06 redesign this is
  // ONLY ever the terminal Save Yes/No (auto-appended on agenda exhaustion).
  const [pending, setPending] = useState<PendingConfirmationTurnWire | null>(null);

  // Per-action busy/error.
  const [answerBusy, setAnswerBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Degrade-in-place: once the LLM fails we keep the deterministic
  // click-to-answer agenda visible IN PLACE (never bounce to the grid).
  const [degraded, setDegraded] = useState(false);

  const [inputText, setInputText] = useState('');

  // The transcript scroll container + a nonce bumped after a disposition
  // auto-advance. A `useEffect` on the nonce scrolls the user's LAST blue action
  // message so its TOP sits at the viewport top, leaving the just-appended next
  // chunk directly below it visible without manual scrolling (2026-06-06 feature
  // ii). Conflicts do NOT bump the nonce (they refresh in place — Q4).
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);

  // -----------------------------------------------------------------------
  // Load the runs list for the scan-selection opener (grouped per service).
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setRunsLoading(true);
    setRunsError(null);
    getDiscoveryRuns(projectId, architectureId)
      .then((result) => {
        if (cancelled) return;
        setRuns(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRunsError(err instanceof Error ? err.message : 'Failed to load discovery runs');
      })
      .finally(() => {
        if (!cancelled) setRunsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, architectureId]);

  // -----------------------------------------------------------------------
  // The cached meta-model (services + app_components) backs the human display
  // name + the optional technology-tier label. The AppShell already loads +
  // caches the full model per (project, architecture) -- NO new fetch / AMS
  // endpoint (spec 2026-06-05-per-service-scan-selection, Task Group 4.3).
  // -----------------------------------------------------------------------
  const { model } = useArchitecture();
  const serviceById = useMemo(() => {
    const map = new Map<string, Service>();
    for (const svc of model.metaModel.entities.services ?? []) map.set(svc.id, svc);
    return map;
  }, [model.metaModel.entities.services]);
  const appComponentsById = useMemo(() => {
    const map = new Map<string, ApplicationComponent>();
    for (const ac of model.metaModel.entities.app_components ?? []) map.set(ac.id, ac);
    return map;
  }, [model.metaModel.entities.app_components]);

  // Group the runs by service_id into per-service picker groups (+ the synthetic
  // "Unassigned scans" bucket for orphan runs), with display name + tier label.
  const serviceGroups = useMemo(
    () => buildServiceGroups(runs, serviceById, appComponentsById),
    [runs, serviceById, appComponentsById],
  );

  // Seed the per-service selection ONCE the runs have loaded: the current run
  // (`runId`) is the default selection within ITS service group; every other
  // group starts at "None". Runs the seed exactly once (the run->service map
  // isn't known until the runs arrive).
  useEffect(() => {
    if (selectionSeeded || runs.length === 0) return;
    const currentRun = runs.find((r) => r.id === runId);
    const currentKey = currentRun ? currentRun.service_id ?? UNASSIGNED_KEY : null;
    setSelectionByService((prev) => {
      // Merge-seed: preserve any pick the user already made (don't clobber a
      // race where a click landed before this one-time seed fired); default
      // every other group to "None" and the current run's group to the run.
      const seed: Record<string, string | null> = { ...prev };
      for (const group of serviceGroups) {
        if (group.key in seed) continue;
        seed[group.key] = currentKey != null && group.key === currentKey ? runId : null;
      }
      return seed;
    });
    setSelectionSeeded(true);
  }, [runs, serviceGroups, runId, selectionSeeded]);

  // The flattened set of selected runs (one-or-zero per group), in the
  // deterministic group order. Drives the Begin gate + the SelectedScanSet.
  const selectedRuns = useMemo(() => {
    const picks: DiscoveryRunDto[] = [];
    for (const group of serviceGroups) {
      const selectedId = selectionByService[group.key] ?? null;
      if (!selectedId) continue;
      const run = group.runs.find((r) => r.id === selectedId);
      if (run) picks.push(run);
    }
    return picks;
  }, [serviceGroups, selectionByService]);

  // -----------------------------------------------------------------------
  // Optimistic snapshot helper — append turns locally for instant feedback.
  // -----------------------------------------------------------------------
  const appendTurns = useCallback((...incoming: (ReviewTurnWire | null | undefined)[]) => {
    const real = incoming.filter((t): t is ReviewTurnWire => t != null);
    if (real.length === 0) return;
    setTurns((prev) => [...prev, ...real]);
  }, []);

  // -----------------------------------------------------------------------
  // Re-read-after-write — refetch the authoritative whole-run counts for the
  // FULL selected set (the primary keys the path; every OTHER run rides as a
  // repeated secondRunId — spec 2026-06-05-per-service-scan-selection, TG 4.8).
  // -----------------------------------------------------------------------
  const refetchCounts = useCallback(
    async (set: SelectedScanSetWire) => {
      try {
        const additionalRunIds = set.runs
          .map((r) => r.runId)
          .filter((id) => id !== set.primaryRunId);
        const fresh = await getReviewModelCounts(
          projectId,
          architectureId,
          set.primaryRunId,
          additionalRunIds,
        );
        setCounts(fresh);
      } catch {
        // The transcript already reflects the write optimistically; a failed
        // count refetch is non-fatal (the next action retries).
      }
    },
    [projectId, architectureId],
  );

  // -----------------------------------------------------------------------
  // Begin the review — assemble the per-service SelectedScanSet + open session.
  // -----------------------------------------------------------------------
  const handleBegin = useCallback(async () => {
    // Build runs[] from every per-service pick (0-or-1 per service; >=1 overall).
    const picks = selectedRuns.map((run) => ({
      runId: run.id,
      scanKind: normalizeScanKind(run.discovery_kind),
      serviceId: run.service_id ?? null,
    }));
    if (picks.length === 0) return; // Begin is disabled here, but guard anyway.

    // primaryRunId (the thread/path anchor) is deterministic: the current run
    // when it's among the picks, else the first pick in the stable group order.
    const primaryRunId = picks.some((p) => p.runId === runId) ? runId : picks[0].runId;

    const set: SelectedScanSetWire = { runs: picks, primaryRunId };

    setStartBusy(true);
    setActionError(null);
    try {
      // Load any prior transcript first (resume), then start a fresh session.
      const envelope = await loadReviewConversation(projectId, architectureId, primaryRunId);
      const response = await startReview({
        projectId,
        architectureId,
        runId: primaryRunId,
        openedBy,
        scanPair: set,
      });
      setScanSet(set);
      setTurns([...envelope.turns, response.openTurn, response.firstChunk]);
      setCurrentChunk(response.firstChunk);
      setStarted(true);
      // Seed the authoritative counts.
      void refetchCounts(set);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to start the review.');
    } finally {
      setStartBusy(false);
    }
  }, [
    projectId,
    architectureId,
    runId,
    openedBy,
    selectedRuns,
    refetchCounts,
  ]);

  // -----------------------------------------------------------------------
  // Apply an outcome from /answer or /capture to local state.
  //
  // 2026-06-06 redesign-2: the `'applied'` outcome is now the IMMEDIATE-APPLY +
  // auto-advance path. The server already wrote the decision (the click WAS the
  // confirmation); the room reflects the applied result and then either
  //   - advances (a DISPOSITION): append the NEXT chunk carried in the outcome —
  //     or the terminal Save when the agenda is exhausted — and scroll the user's
  //     last blue action message to the top; or
  //   - refreshes in place (a CONFLICT): replace the current chunk-summary turn
  //     with the SAME chunk refreshed (conflict cleared), WITHOUT advancing (Q4).
  // The `pending-confirmation` outcome now only ever carries the terminal Save.
  // -----------------------------------------------------------------------
  const applyOutcome = useCallback(
    (outcome: ReviewTurnOutcomeWire) => {
      switch (outcome.kind) {
        case 'pending-confirmation':
          // The TERMINAL Save Yes/No (the only surviving confirm gate).
          appendTurns(outcome.userMessageTurn, outcome.previewTurn, outcome.pendingTurn);
          setPending(outcome.pendingTurn);
          break;
        case 'applied': {
          // The server applied immediately. Reflect the applied evidence
          // (user-message + deterministic preview counts + the applied turn)
          // WITHOUT a confirm surface, then re-read the authoritative counts.
          const advanced = outcome.advanced ?? true;
          const nextChunk = outcome.nextChunk ?? null;
          const terminalSaveTurn = outcome.terminalSaveTurn ?? null;

          if (advanced) {
            // A DISPOSITION: append the applied evidence + the next chunk (or the
            // terminal Save on exhaustion), then scroll. `appendTurns` filters out
            // the null evidence/trailing turns.
            appendTurns(
              outcome.userMessageTurn,
              outcome.previewTurn,
              outcome.appliedTurn,
              nextChunk,
              terminalSaveTurn,
            );
            setCurrentChunk(nextChunk);
            setPending(terminalSaveTurn);
            // Scroll the user's last blue action message to the top so the
            // just-appended next chunk directly below it is visible.
            setScrollNonce((n) => n + 1);
          } else {
            // A CONFLICT: append the applied evidence, then REPLACE the most
            // recent chunk-summary turn with the refreshed chunk IN PLACE — do
            // NOT advance and do NOT scroll. `evidence` is widened to the full
            // union (| null) so the non-null narrowing predicate is valid.
            const evidence: Array<ReviewTurnWire | null> = [
              outcome.userMessageTurn,
              outcome.previewTurn,
              outcome.appliedTurn,
            ];
            setTurns((prev) => {
              const appended: ReviewTurnWire[] = [
                ...prev,
                ...evidence.filter((t): t is ReviewTurnWire => t != null),
              ];
              if (!nextChunk) return appended;
              // Replace the LAST chunk-summary turn (the one being acted on) with
              // the refreshed chunk so the resolved conflict's pick control is gone.
              const lastChunkIdx = appended.map((t) => t.kind).lastIndexOf('chunk-summary');
              if (lastChunkIdx === -1) return appended;
              const replaced = [...appended];
              replaced[lastChunkIdx] = nextChunk;
              return replaced;
            });
            if (nextChunk) setCurrentChunk(nextChunk);
          }
          if (scanSet) void refetchCounts(scanSet);
          break;
        }
        case 'narrated':
          appendTurns(outcome.userMessageTurn, outcome.narrationTurn, outcome.chunkTurn);
          if (outcome.chunkTurn) setCurrentChunk(outcome.chunkTurn);
          break;
        case 'error':
          // Degrade IN PLACE: keep the transcript + the SAME chunk, reveal the
          // deterministic click-to-answer agenda. The user is NOT bounced out.
          appendTurns(outcome.userMessageTurn, outcome.errorTurn);
          setDegraded(true);
          break;
      }
    },
    [appendTurns, scanSet, refetchCounts],
  );

  // -----------------------------------------------------------------------
  // Auto-scroll the user's LAST blue action message to the viewport top after a
  // disposition auto-advance (2026-06-06 feature ii). Keyed on `scrollNonce`
  // (bumped only by a disposition), so it never fires on the initial render or on
  // a conflict in-place refresh.
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (scrollNonce === 0) return;
    const container = transcriptRef.current;
    if (!container) return;
    const userTurns = container.querySelectorAll<HTMLElement>(
      '[data-testid="review-room-turn-user-message"]',
    );
    const last = userTurns[userTurns.length - 1];
    if (last) last.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [scrollNonce]);

  // -----------------------------------------------------------------------
  // The LLM path (/answer) — the LLM PROPOSES; never writes.
  // -----------------------------------------------------------------------
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || !scanSet) return;
    setAnswerBusy(true);
    setActionError(null);
    try {
      const outcome = await answerReviewTurn({
        projectId,
        architectureId,
        runId: scanSet.primaryRunId,
        userMessage: text,
        scanPair: scanSet,
      });
      applyOutcome(outcome);
      setInputText('');
    } catch (err) {
      // A thrown call (relay down / network) is itself an LLM-failure signal:
      // degrade in place rather than bouncing the user to the grid.
      appendTurns({ kind: 'user-message', text });
      appendTurns({
        kind: 'error',
        errorKind: 'llm-call-failed',
        errorMessage: err instanceof Error ? err.message : 'The Architect is unavailable.',
        recoverableHint: 'Continue with the deterministic agenda; your decisions apply immediately and only the final Save asks to confirm.',
      });
      setDegraded(true);
      setInputText('');
    } finally {
      setAnswerBusy(false);
    }
  }, [inputText, scanSet, projectId, architectureId, applyOutcome, appendTurns]);

  // -----------------------------------------------------------------------
  // The deterministic NO-LLM path (/capture) — drives BOTH the always-on chunk
  // buttons AND the degrade-in-place agenda AND advance-chunk. A chunk
  // disposition / conflict applies IMMEDIATELY (the click IS the confirmation)
  // and returns `'applied'`; an `advance-chunk` returns the next chunk narrated.
  // -----------------------------------------------------------------------
  const handleCapture = useCallback(
    async (
      capture:
        | { action: 'advance-chunk'; agendaCursor: number }
        | { action: 'propose-intent'; intent: ProposedReviewIntentWire; userText?: string },
    ) => {
      if (!scanSet) return;
      setAnswerBusy(true);
      setActionError(null);
      try {
        const outcome = await captureReviewTurn({
          projectId,
          architectureId,
          runId: scanSet.primaryRunId,
          scanPair: scanSet,
          capture,
        });
        applyOutcome(outcome);
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'The deterministic action failed.');
      } finally {
        setAnswerBusy(false);
      }
    },
    [scanSet, projectId, architectureId, applyOutcome],
  );

  // Propose a deterministic intent (a chunk/agenda button). After the 2026-06-06
  // redesign this APPLIES IMMEDIATELY server-side (the click IS the confirmation)
  // and returns the `'applied'` auto-advance outcome — there is no longer an
  // off-screen confirm gate. This is the single seam every always-on control
  // routes through.
  const handlePropose = useCallback(
    (intent: ProposedReviewIntentWire, userText: string) => {
      void handleCapture({ action: 'propose-intent', intent, userText });
    },
    [handleCapture],
  );

  // Advance the agenda to the next chunk (NO write). Retained for the degraded
  // agenda's manual "Next chunk" control; the in-chunk advance button is replaced
  // by the disposition auto-advance.
  const handleAdvance = useCallback(
    (agendaCursor: number) => {
      void handleCapture({ action: 'advance-chunk', agendaCursor });
    },
    [handleCapture],
  );

  // The degraded agenda's Approve shortcut reuses the same propose seam.
  const handleDegradedApprove = useCallback(
    (item: ChunkItemRefWire) => {
      handlePropose(applyDecisionIntentFor(item, 'approved'), `${ACTION_VERB.approved} ${item.name}`);
    },
    [handlePropose],
  );

  // -----------------------------------------------------------------------
  // CONFIRM — the TERMINAL Save write path. After the 2026-06-06 redesign the
  // ONLY pending intent is the terminal Save (auto-appended on agenda
  // exhaustion); "Yes" confirms it (the same effect as the candidates-table
  // "Save All Approved" button). A natural-language reply is re-validated
  // server-side against the still-pending Save intent.
  // -----------------------------------------------------------------------
  const handleConfirm = useCallback(
    async (confirmation: { kind: 'click' } | { kind: 'natural-language'; text: string }) => {
      if (!pending || !scanSet) return;
      setConfirmBusy(true);
      setActionError(null);
      try {
        const outcome = await confirmReviewTurn({
          projectId,
          architectureId,
          runId: scanSet.primaryRunId,
          pendingId: pending.pendingId,
          intent: pending.intent,
          confirmation,
          scanPair: scanSet,
        });
        if (outcome.kind === 'applied') {
          appendTurns(outcome.appliedTurn);
          setPending(null);
          // Re-read-after-write: refetch the authoritative whole-run counts.
          await refetchCounts(scanSet);
        } else if (outcome.kind === 'cancelled') {
          appendTurns(outcome.narrationTurn);
          setPending(null);
        } else {
          appendTurns(outcome.errorTurn);
        }
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'The change could not be applied.');
      } finally {
        setConfirmBusy(false);
      }
    },
    [pending, scanSet, projectId, architectureId, appendTurns, refetchCounts],
  );

  // "No" on the terminal Save — a no-op dismiss (2026-06-06 Q3). Nothing further
  // happens; the user closes the conversation and the candidates table remains the
  // anytime escape hatch. Clears the pending gate locally (no server round-trip).
  const handleDismissSave = useCallback(() => {
    setPending(null);
  }, []);

  // -----------------------------------------------------------------------
  // Render — scan-selection opener, then the conversation.
  // -----------------------------------------------------------------------
  if (!started) {
    return (
      <div className={styles.room} data-testid="review-room">
        <ScanSelection
          runsLoading={runsLoading}
          runsError={runsError}
          serviceGroups={serviceGroups}
          selectionByService={selectionByService}
          onPick={(serviceKey, runId) =>
            setSelectionByService((prev) => ({ ...prev, [serviceKey]: runId }))
          }
          hasSelection={selectedRuns.length > 0}
          onBegin={handleBegin}
          beginBusy={startBusy}
          error={actionError}
        />
      </div>
    );
  }

  return (
    <div className={styles.room} data-testid="review-room">
      {counts && (
        <div className={styles.countsBar} data-testid="review-room-counts">
          <span data-testid="review-room-count-actionable">
            Actionable: {counts.actionableCount}
          </span>
          <span data-testid="review-room-count-committed">
            Committed: {counts.committedCount}
          </span>
          <span data-testid="review-room-count-conflicts">
            Live conflicts: {counts.liveConflictCount}
          </span>
        </div>
      )}

      <div className={chassis.transcript} data-testid="review-room-transcript" ref={transcriptRef}>
        {turns.map((turn, idx) => (
          <ReviewTurnView
            key={`${turn.kind}-${idx}`}
            turn={turn}
            confirmBusy={confirmBusy}
            onConfirmClick={() => handleConfirm({ kind: 'click' })}
            onDismissClick={handleDismissSave}
            isOpenPending={
              turn.kind === 'pending-confirmation' &&
              pending != null &&
              turn.pendingId === pending.pendingId
            }
            actionBusy={answerBusy}
            onPropose={handlePropose}
          />
        ))}
      </div>

      {/* Degrade-in-place: the deterministic click-to-answer agenda over the
          SAME chunk. Shown only after an LLM-failure signal — the user is NOT
          bounced to the grid. The in-transcript chunk is ALSO actionable; this
          is an additive, explicit "the Architect is unavailable" surface. */}
      {degraded && currentChunk && (
        <DegradedAgenda
          chunk={currentChunk}
          busy={answerBusy}
          onApprove={handleDegradedApprove}
          onAdvance={
            currentChunk.nextCursor != null
              ? () => handleAdvance(currentChunk.nextCursor as number)
              : undefined
          }
        />
      )}

      {/* The re-skinned click-to-answer input bar (natural-language to the LLM;
          a re-validated "yes" confirms the terminal Save when one is pending). */}
      <div className={chassis.inputBar} data-testid="review-room-input-bar">
        <div className={chassis.inputRow}>
          <input
            type="text"
            className={chassis.inputField}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder={
              pending
                ? 'Reply "yes" to save, or tell me what to change…'
                : 'Tell me what to do (e.g. "approve all of those")…'
            }
            disabled={answerBusy || confirmBusy}
            data-testid="review-room-input"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (pending) void handleConfirm({ kind: 'natural-language', text: inputText });
                else void handleSend();
              }
            }}
          />
          {pending ? (
            <button
              type="button"
              className={chassis.primaryButton}
              disabled={!inputText.trim() || confirmBusy}
              onClick={() => handleConfirm({ kind: 'natural-language', text: inputText })}
              data-testid="review-room-confirm-nl"
            >
              {confirmBusy ? 'Saving…' : 'Reply'}
            </button>
          ) : (
            <button
              type="button"
              className={chassis.primaryButton}
              disabled={!inputText.trim() || answerBusy}
              onClick={handleSend}
              data-testid="review-room-send"
            >
              {answerBusy ? 'Thinking…' : 'Send'}
            </button>
          )}
        </div>
        {actionError && (
          <div
            className={`${chassis.banner} ${chassis.bannerError}`}
            role="alert"
            data-testid="review-room-error"
          >
            {actionError}
          </div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Scan-selection opening turn.
// ===========================================================================

interface ScanSelectionProps {
  runsLoading: boolean;
  runsError: string | null;
  /** One picker group per scanned service (+ the "Unassigned scans" bucket). */
  serviceGroups: ServiceGroup[];
  /** serviceKey -> selected runId in that group (or null = "None"). */
  selectionByService: Record<string, string | null>;
  /** Pick a run (or null) within a service group. */
  onPick: (serviceKey: string, runId: string | null) => void;
  /** True once >=1 run is selected across all groups (gates Begin). */
  hasSelection: boolean;
  onBegin: () => void;
  beginBusy: boolean;
  error: string | null;
}

function ScanSelection({
  runsLoading,
  runsError,
  serviceGroups,
  selectionByService,
  onPick,
  hasSelection,
  onBegin,
  beginBusy,
  error,
}: ScanSelectionProps) {
  return (
    <div className={styles.scanSelection} data-testid="review-room-scan-selection">
      <h3 className={styles.scanSelectionTitle}>Which scan(s) shall we review?</h3>
      <p className={styles.scanSelectionHelp}>
        Pick one scan per service to review (or skip a service with “None”) — at
        least one overall. The Architect walks a deterministically-ordered agenda:
        conflicts first, then high-impact candidates, then the rest by type, then
        findings by severity, then cross-scan links.
      </p>

      {runsLoading && <div className={styles.scanLoading}>Loading runs…</div>}
      {runsError && (
        <div className={styles.scanError} role="alert" data-testid="review-room-runs-error">
          {runsError}
        </div>
      )}

      {!runsLoading && !runsError && serviceGroups.length === 0 && (
        <div className={styles.scanEmpty} data-testid="review-room-no-runs">
          No discovery runs to review.
        </div>
      )}

      {!runsLoading && !runsError && serviceGroups.length > 0 && (
        <div className={styles.scanGroups}>
          {serviceGroups.map((group) => {
            const selectedId = selectionByService[group.key] ?? null;
            const radioName = `review-room-service-${group.key}`;
            return (
              <fieldset
                key={group.key}
                className={styles.scanGroup}
                data-testid={`review-room-service-group-${group.key}`}
              >
                <legend>
                  {group.displayName}
                  {group.serviceId != null && (
                    <span
                      className={styles.scanGroupTier}
                      data-testid={`review-room-service-tier-${group.key}`}
                    >
                      {' · '}
                      {TIER_LABEL[group.tier]}
                    </span>
                  )}
                </legend>
                {group.runs.map((run) => (
                  <label key={run.id} className={styles.scanOption}>
                    <input
                      type="radio"
                      name={radioName}
                      checked={selectedId === run.id}
                      onChange={() => onPick(group.key, run.id)}
                      data-testid={`review-room-service-run-${group.key}-${run.id}`}
                    />
                    {runLabel(run)}
                  </label>
                ))}
                <label className={styles.scanOption}>
                  <input
                    type="radio"
                    name={radioName}
                    checked={selectedId === null}
                    onChange={() => onPick(group.key, null)}
                    data-testid={`review-room-service-run-${group.key}-none`}
                  />
                  None
                </label>
              </fieldset>
            );
          })}
        </div>
      )}

      {error && (
        <div className={styles.scanError} role="alert">
          {error}
        </div>
      )}

      <button
        type="button"
        className={styles.beginButton}
        onClick={onBegin}
        disabled={beginBusy || runsLoading || !hasSelection}
        data-testid="review-room-begin"
      >
        {beginBusy ? 'Opening…' : 'Begin review'}
      </button>
    </div>
  );
}

// ===========================================================================
// The net-new chunk/agenda renderer + the terminal Save surface, plus the
// re-skinned per-kind transcript renderer.
// ===========================================================================

const SECTION_LABELS: Record<ChunkSummaryTurnWire['section'], string> = {
  'interfaces-endpoints': 'Interfaces & endpoints',
  'logical-data': 'Logical data model',
  'physical-data': 'Physical data model',
  'cross-scan-links': 'Cross-scan logical↔physical mappings',
  'business-logic': 'Business logic',
  'findings-by-severity': 'Findings by severity',
};

interface ReviewTurnViewProps {
  turn: ReviewTurnWire;
  confirmBusy: boolean;
  onConfirmClick: () => void;
  /** "No" on the terminal Save — a local no-op dismiss. */
  onDismissClick: () => void;
  /** True only for the newest still-open pending (terminal Save) turn. */
  isOpenPending: boolean;
  /** True while any deterministic /capture action is in flight (disables chunk buttons). */
  actionBusy: boolean;
  /** Propose a deterministic intent (chunk button) — applies immediately via /capture. */
  onPropose: (intent: ProposedReviewIntentWire, userText: string) => void;
}

function ReviewTurnView({
  turn,
  confirmBusy,
  onConfirmClick,
  onDismissClick,
  isOpenPending,
  actionBusy,
  onPropose,
}: ReviewTurnViewProps) {
  switch (turn.kind) {
    case 'open':
      return (
        <div className={`${chassis.turn} ${chassis.turnSystem}`} data-testid="review-room-turn-open">
          Review opened by {turn.openedBy}
          {` · ${openTurnScanSummary(turn.scanPair)}`}
        </div>
      );
    case 'chunk-summary':
      return (
        <ChunkSummaryView
          turn={turn}
          actionBusy={actionBusy}
          onPropose={onPropose}
        />
      );
    case 'preview':
      return (
        <div className={`${chassis.turn} ${chassis.turnMutationSummary}`} data-testid="review-room-turn-preview">
          <div className={chassis.turnLabel}>Preview · {turn.action}</div>
          {turn.totalCandidates} candidate{turn.totalCandidates === 1 ? '' : 's'} (
          {turn.seedCandidates} seed + {turn.cascadedCandidates} cascaded)
          {turn.runTotalCandidates != null ? ` of ${turn.runTotalCandidates}` : ''}, and{' '}
          {turn.totalFindings} finding{turn.totalFindings === 1 ? '' : 's'}
          {turn.runTotalFindings != null ? ` of ${turn.runTotalFindings}` : ''}.
        </div>
      );
    case 'pending-confirmation':
      return (
        <PendingConfirmationView
          turn={turn}
          confirmBusy={confirmBusy}
          onConfirmClick={onConfirmClick}
          onDismissClick={onDismissClick}
          showConfirm={isOpenPending}
        />
      );
    case 'decision-applied':
      return (
        <div className={`${chassis.turn} ${chassis.turnSystem}`} data-testid="review-room-turn-decision-applied">
          Applied {turn.action}:{' '}
          {turn.appliedCandidateCount != null ? `${turn.appliedCandidateCount} candidate(s)` : `${turn.candidateIds.length} candidate(s)`}
          {turn.appliedFindingCount != null
            ? `, ${turn.appliedFindingCount} finding(s)`
            : turn.findingIds.length > 0
              ? `, ${turn.findingIds.length} finding(s)`
              : ''}
          .
        </div>
      );
    case 'conflict-resolved':
      return (
        <div className={`${chassis.turn} ${chassis.turnSystem}`} data-testid="review-room-turn-conflict-resolved">
          Resolved conflict on {turn.attr} → {String(turn.chosenValue)} (source: {turn.chosenSource}).
        </div>
      );
    case 'bulk-pattern-resolved':
      return (
        <div className={`${chassis.turn} ${chassis.turnSystem}`} data-testid="review-room-turn-bulk-pattern-resolved">
          Resolved {turn.resolvedCount} {turn.attr} conflict{turn.resolvedCount === 1 ? '' : 's'} to {turn.chosenSource}.
        </div>
      );
    case 'saved':
      return (
        <div className={`${chassis.turn} ${chassis.turnSystem}`} data-testid="review-room-turn-saved">
          Saved{turn.savedCount != null ? ` ${turn.savedCount} candidate(s)` : ''}.
        </div>
      );
    case 'error':
      return (
        <div className={`${chassis.turn} ${chassis.turnError}`} role="alert" data-testid="review-room-turn-error">
          <div className={chassis.turnLabel}>Error · {turn.errorKind}</div>
          {turn.errorMessage}
          {turn.recoverableHint && <p style={{ marginTop: '0.5rem' }}>{turn.recoverableHint}</p>}
        </div>
      );
    case 'user-message':
      return (
        <div className={`${chassis.turn} ${chassis.turnUser}`} data-testid="review-room-turn-user-message">
          <div className={chassis.turnLabel}>You</div>
          {turn.text}
        </div>
      );
    case 'narration':
      return (
        <div className={`${chassis.turn} ${chassis.turnLlm}`} data-testid="review-room-turn-narration">
          {turn.text}
        </div>
      );
    default:
      return null;
  }
}

interface ChunkSummaryViewProps {
  turn: ChunkSummaryTurnWire;
  actionBusy: boolean;
  onPropose: (intent: ProposedReviewIntentWire, userText: string) => void;
}

/**
 * The ALWAYS-ACTIONABLE chunk renderer.
 *
 * 2026-06-06 redesign-2 — a FAMILY chunk additionally carries a rich multi-line
 * cascade summary (`cascadePreview`) and FOUR immediate-apply buttons: Approve All
 * (`scope:'cascade'`) / Approve visible chunk (`scope:'family'`) / Reject All /
 * Defer All. Every button PROPOSES an intent through the SAME `onPropose` seam,
 * which APPLIES IMMEDIATELY server-side (the click IS the confirmation) and
 * auto-advances — there is no off-screen confirm gate. Every item ALSO carries the
 * per-row Approve / Reject / Defer controls; live-conflict items carry a "pick a
 * source" control per conflicting attribute (and a "resolve all" control for a
 * similarity class >= 2) that applies immediately and refreshes the chunk in place.
 */
function ChunkSummaryView({ turn, actionBusy, onPropose }: ChunkSummaryViewProps) {
  // A FAMILY chunk (2026-06-05 agenda redesign) carries `family` (parent id +
  // child ids) + `familyBulkActions`. The parent is always the FIRST item; the
  // `childIds` set marks which rows render INDENTED. Non-family chunks (orphan-
  // by-type / findings / cross-scan) leave both absent and render flat as before.
  const family = turn.family;
  const childIdSet = useMemo(
    () => new Set(family ? family.childIds : []),
    [family],
  );

  // The seed (family parent) display name — woven into the cascade summary header.
  const seedName = useMemo(() => {
    if (!family) return null;
    const parent = turn.items.find((it) => it.id === family.parentId);
    return parent?.name ?? null;
  }, [family, turn.items]);

  // The rich multi-line cascade summary (2026-06-06 feature i) — present for FAMILY
  // chunks ONLY (where `cascadePreview` is populated). Type-driven + pure.
  const cascadeSummary = useMemo(
    () => (turn.cascadePreview ? buildCascadeSummary(turn.cascadePreview, seedName) : null),
    [turn.cascadePreview, seedName],
  );

  // The cross-layer (logical↔physical) mapping note (Spec 2026-06-08) — present on a
  // logical/physical data ENTITY family. The cascade does NOT cross layers, so this
  // preserves the connection (and surfaces "already approved/rejected" on a physical
  // family). Server-supplied; pure render.
  const crossLayerNote = useMemo(
    () => (turn.crossLayerMapping ? buildCrossLayerNote(turn.crossLayerMapping) : null),
    [turn.crossLayerMapping],
  );

  return (
    <div className={styles.chunk} data-testid="review-room-chunk">
      <div className={styles.chunkHeader}>
        <span className={styles.chunkSection}>{SECTION_LABELS[turn.section]}</span>
        <span className={styles.chunkScope} data-testid="review-room-chunk-scope">
          {turn.scanScope} scan
        </span>
        <span className={styles.chunkProgress}>
          {turn.items.length} of {turn.agendaTotal} on the agenda
        </span>
      </div>

      {/* The rich multi-line cascade summary (feature i): the full-cascade total
          line + the numbered per-type breakdown, each row carrying the
          "(N already approved/rejected/deferred)" annotations from the
          server-supplied sub-counts. Present for FAMILY chunks ONLY. */}
      {cascadeSummary && (
        <div className={styles.chunkCascadeSummary} data-testid="review-room-chunk-cascade-summary">
          <p className={styles.chunkCascadeHeader} data-testid="review-room-cascade-header">
            {cascadeSummary.header}
          </p>
          <ol className={styles.chunkCascadeList}>
            {cascadeSummary.lines.map((line, i) => (
              <li
                key={line.type}
                className={styles.chunkCascadeLine}
                data-testid={`review-room-cascade-type-${line.type}`}
              >
                {i + 1}) {line.text}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* The cross-layer (logical↔physical) mapping note (Spec 2026-06-08): the
          cascade does NOT cross layers, so this preserves the connection — on a
          PHYSICAL family it surfaces the mapped logical entities + how many are
          already approved/rejected; on a LOGICAL family it names the mapped physical
          entities. Present for logical/physical data ENTITY families only. */}
      {crossLayerNote && (
        <p
          className={styles.chunkCrossLayerNote}
          data-testid="review-room-chunk-cross-layer-note"
        >
          📎 Note — {crossLayerNote}
        </p>
      )}

      {/* The FOUR family buttons (2026-06-06 feature i), present for FAMILY chunks
          ONLY. Approve All / Reject All / Defer All apply the FULL cascade
          (`scope:'cascade'`); Approve visible chunk applies the family-only reach
          (`scope:'family'`). All four apply IMMEDIATELY through the SAME `onPropose`
          seam (no confirm gate); cascaded entities decided by Approve All do NOT get
          their own later chunk, while Approve visible chunk leaves them for later. */}
      {family && (turn.familyBulkActions?.length || turn.familyVisibleChunkAction) && (
        <div className={styles.chunkFamilyBulk} data-testid="review-room-chunk-family-bulk">
          <span className={styles.chunkFamilyBulkLabel}>Whole family:</span>
          {/* Approve All (full cascade). */}
          {turn.familyBulkActions?.includes('approved') && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  familyBulkIntentFor(family.parentId, 'approved', 'cascade'),
                  `${FAMILY_ACTION_LABEL.approved} in this family (full cascade)`,
                )
              }
              data-testid="review-room-chunk-family-approved"
            >
              {FAMILY_ACTION_LABEL.approved}
            </button>
          )}
          {/* Approve visible chunk (family-only reach). */}
          {turn.familyVisibleChunkAction && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  familyVisibleChunkIntentFor(family.parentId),
                  'Approve the visible chunk (this family only)',
                )
              }
              data-testid="review-room-chunk-family-approve-visible-chunk"
            >
              Approve visible chunk
            </button>
          )}
          {/* Reject All (full cascade). */}
          {turn.familyBulkActions?.includes('rejected') && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  familyBulkIntentFor(family.parentId, 'rejected', 'cascade'),
                  `${FAMILY_ACTION_LABEL.rejected} in this family (full cascade)`,
                )
              }
              data-testid="review-room-chunk-family-rejected"
            >
              {FAMILY_ACTION_LABEL.rejected}
            </button>
          )}
          {/* Defer All (full cascade). */}
          {turn.familyBulkActions?.includes('deferred') && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  familyBulkIntentFor(family.parentId, 'deferred', 'cascade'),
                  `${FAMILY_ACTION_LABEL.deferred} in this family (full cascade)`,
                )
              }
              data-testid="review-room-chunk-family-deferred"
            >
              {FAMILY_ACTION_LABEL.deferred}
            </button>
          )}
        </div>
      )}

      {/* The TYPE-LEVEL bulk control (2026-06-09), present for an ORPHAN-by-type
          chunk ONLY (no parent_child family). These candidates (e.g. the thousands
          of `business_logics` service methods) have no family to bulk-approve, so
          without this they could only be actioned one row at a time. Each button
          proposes an `apply-decision-by-type` intent that the coordinator
          enumerates + applies across the WHOLE (type, scan) — not just the visible
          slice — through the SAME immediate-apply + auto-advance seam. */}
      {turn.typeBulk && (turn.typeBulkActions?.length ?? 0) > 0 && (
        <div className={styles.chunkFamilyBulk} data-testid="review-room-chunk-type-bulk">
          <span className={styles.chunkFamilyBulkLabel}>
            All {turn.typeBulk.actionableCount}{' '}
            {humanizeCandidateType(turn.typeBulk.candidateType, turn.typeBulk.actionableCount)} in
            this scan:
          </span>
          {turn.typeBulkActions?.includes('approved') && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  typeBulkIntentFor(turn.typeBulk!.candidateType, turn.typeBulk!.scanScope, 'approved'),
                  `Approve all ${turn.typeBulk!.actionableCount} ${turn.typeBulk!.candidateType}`,
                )
              }
              data-testid="review-room-chunk-type-approved"
            >
              Approve all {turn.typeBulk.actionableCount}
            </button>
          )}
          {turn.typeBulkActions?.includes('rejected') && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  typeBulkIntentFor(turn.typeBulk!.candidateType, turn.typeBulk!.scanScope, 'rejected'),
                  `Reject all ${turn.typeBulk!.actionableCount} ${turn.typeBulk!.candidateType}`,
                )
              }
              data-testid="review-room-chunk-type-rejected"
            >
              Reject all
            </button>
          )}
          {turn.typeBulkActions?.includes('deferred') && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  typeBulkIntentFor(turn.typeBulk!.candidateType, turn.typeBulk!.scanScope, 'deferred'),
                  `Defer all ${turn.typeBulk!.actionableCount} ${turn.typeBulk!.candidateType}`,
                )
              }
              data-testid="review-room-chunk-type-deferred"
            >
              Defer all
            </button>
          )}
        </div>
      )}

      {/* The FINDINGS bulk control (2026-06-09), present for a findings-by-severity
          chunk ONLY. Findings are neither families nor candidates, so without this
          they could only be actioned one row at a time. Each button proposes an
          `apply-decision-findings` intent the coordinator enumerates + applies
          across the WHOLE scan's actionable findings, then auto-advances. */}
      {turn.findingsBulk && (turn.findingsBulkActions?.length ?? 0) > 0 && (
        <div className={styles.chunkFamilyBulk} data-testid="review-room-chunk-findings-bulk">
          <span className={styles.chunkFamilyBulkLabel}>
            All {turn.findingsBulk.actionableCount} finding
            {turn.findingsBulk.actionableCount === 1 ? '' : 's'} in this scan:
          </span>
          {turn.findingsBulkActions?.includes('approved') && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  findingsBulkIntentFor(turn.findingsBulk!.scanScope, 'approved'),
                  `Approve all ${turn.findingsBulk!.actionableCount} findings`,
                )
              }
              data-testid="review-room-chunk-findings-approved"
            >
              Approve all {turn.findingsBulk.actionableCount}
            </button>
          )}
          {turn.findingsBulkActions?.includes('rejected') && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  findingsBulkIntentFor(turn.findingsBulk!.scanScope, 'rejected'),
                  `Reject all ${turn.findingsBulk!.actionableCount} findings`,
                )
              }
              data-testid="review-room-chunk-findings-rejected"
            >
              Reject all
            </button>
          )}
          {turn.findingsBulkActions?.includes('deferred') && (
            <button
              type="button"
              className={styles.chunkFamilyBulkButton}
              disabled={actionBusy}
              onClick={() =>
                onPropose(
                  findingsBulkIntentFor(turn.findingsBulk!.scanScope, 'deferred'),
                  `Defer all ${turn.findingsBulk!.actionableCount} findings`,
                )
              }
              data-testid="review-room-chunk-findings-deferred"
            >
              Defer all
            </button>
          )}
        </div>
      )}

      <ul className={styles.chunkList}>
        {turn.items.map((item) => (
          <li
            key={item.id}
            className={`${styles.chunkItem}${childIdSet.has(item.id) ? ` ${styles.chunkItemChild}` : ''}`}
            data-testid={`review-room-chunk-item-${item.id}`}
            data-family-child={childIdSet.has(item.id) ? 'true' : undefined}
          >
            <div className={styles.chunkItemRow}>
              <span className={styles.chunkItemName}>{item.name}</span>
              <span className={styles.chunkItemDetail}>
                {item.itemType === 'finding' ? `finding · ${item.detail}` : item.detail}
              </span>
              <div className={styles.chunkItemActions}>
                {ACTION_BUTTONS.map(({ action, label }) => (
                  <button
                    key={action}
                    type="button"
                    className={styles.chunkActionButton}
                    disabled={actionBusy}
                    onClick={() =>
                      onPropose(applyDecisionIntentFor(item, action), `${ACTION_VERB[action]} ${item.name}`)
                    }
                    data-testid={`review-room-chunk-${action}-${item.id}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Live-conflict controls: one "pick a source" group per conflicting
                attribute, sourced from the server-supplied competing facts. A pick
                applies IMMEDIATELY and refreshes this chunk in place (Q4). */}
            {item.conflicts && item.conflicts.length > 0 && (
              <div className={styles.chunkConflicts} data-testid={`review-room-chunk-conflicts-${item.id}`}>
                {item.conflicts.map((conflict) => (
                  <div
                    key={conflict.attr}
                    className={styles.chunkConflict}
                    data-testid={`review-room-chunk-conflict-${item.id}-${conflict.attr}`}
                  >
                    <span className={styles.chunkConflictAttr}>{conflict.attr}</span>
                    <div className={styles.chunkConflictSources}>
                      {conflict.competing.map((entry) => (
                        <span key={entry.source} className={styles.chunkConflictSourceGroup}>
                          <button
                            type="button"
                            className={styles.chunkConflictPick}
                            disabled={actionBusy}
                            onClick={() =>
                              onPropose(
                                {
                                  kind: 'resolve-conflict',
                                  candidateId: item.id,
                                  attr: conflict.attr,
                                  chosenValue: entry.value,
                                  chosenSource: entry.source,
                                },
                                `Resolve ${conflict.attr} → ${entry.source}`,
                              )
                            }
                            data-testid={`review-room-chunk-resolve-${item.id}-${conflict.attr}-${entry.source}`}
                            title={`Use ${String(entry.value)} (from ${entry.source})`}
                          >
                            Use {entry.source}
                          </button>
                          {conflict.similarCount >= 2 && (
                            <button
                              type="button"
                              className={styles.chunkConflictPickAll}
                              disabled={actionBusy}
                              onClick={() =>
                                onPropose(
                                  {
                                    kind: 'resolve-conflicts-by-pattern',
                                    candidateId: item.id,
                                    attr: conflict.attr,
                                    chosenSource: entry.source,
                                    classCandidateIds: [],
                                  },
                                  `Use ${entry.source} for all ${conflict.similarCount} ${conflict.attr} conflicts`,
                                )
                              }
                              data-testid={`review-room-chunk-resolve-all-${item.id}-${conflict.attr}-${entry.source}`}
                            >
                              Use {entry.source} for all {conflict.similarCount}
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface PendingConfirmationViewProps {
  turn: PendingConfirmationTurnWire;
  confirmBusy: boolean;
  onConfirmClick: () => void;
  /** "No" — a local no-op dismiss of the terminal Save. */
  onDismissClick: () => void;
  showConfirm: boolean;
}

/**
 * The terminal Save Yes/No surface (2026-06-06 redesign-2).
 *
 * After the confirm-box-removal redesign this is the ONLY surviving
 * `pending-confirmation` use: a single terminal "Save all approved candidates back
 * to the architecture?" Yes/No, auto-appended when an apply leaves the agenda
 * exhausted. "Yes" confirms the `save` intent (the same effect as the
 * candidates-table "Save All Approved" button); "No" is a no-op dismiss.
 *
 * The historic `previewCounts` / `patternFacts` / `overage` blocks remain
 * null-guarded purely for transcript-replay back-compat of any pre-redesign
 * pending turn; a terminal Save carries all three null, so they render nothing.
 */
function PendingConfirmationView({
  turn,
  confirmBusy,
  onConfirmClick,
  onDismissClick,
  showConfirm,
}: PendingConfirmationViewProps) {
  const isSave = turn.intent.kind === 'save';
  return (
    <div className={styles.pending} data-testid="review-room-pending-confirmation">
      <div className={styles.pendingLabel}>
        {isSave ? 'Save to the architecture' : 'Confirm before applying'}
      </div>
      <p className={styles.pendingSummary}>{turn.summary}</p>

      {/* Back-compat (pre-redesign replay only): the off-screen OVERAGE figures. */}
      {turn.overage &&
        (turn.overage.beyondFamilyCount > 0 || turn.overage.relationshipsDroppedCount > 0) && (
          <div className={styles.pendingOverage} data-testid="review-room-pending-overage">
            {turn.overage.beyondFamilyCount > 0 && (
              <span
                className={styles.pendingOverageFigure}
                data-testid="review-room-overage-beyond-family"
              >
                +{turn.overage.beyondFamilyCount} beyond this family
              </span>
            )}
            {turn.overage.relationshipsDroppedCount > 0 && (
              <span
                className={styles.pendingOverageFigure}
                data-testid="review-room-overage-relationships-dropped"
              >
                +{turn.overage.relationshipsDroppedCount} relationship
                {turn.overage.relationshipsDroppedCount === 1 ? '' : 's'} dropped
              </span>
            )}
          </div>
        )}

      {/* Back-compat (pre-redesign replay only): the DETERMINISTIC preview counts. */}
      {turn.previewCounts && (
        <ul className={styles.pendingCounts} data-testid="review-room-pending-counts">
          <li>
            <strong data-testid="review-room-count-total-candidates">
              {turn.previewCounts.totalCandidates}
            </strong>{' '}
            candidate{turn.previewCounts.totalCandidates === 1 ? '' : 's'} affected
          </li>
          <li>
            <strong>{turn.previewCounts.seedCandidates}</strong> seed +{' '}
            <strong data-testid="review-room-count-cascaded">
              {turn.previewCounts.cascadedCandidates}
            </strong>{' '}
            cascaded
          </li>
          <li>
            <strong data-testid="review-room-count-findings">
              {turn.previewCounts.totalFindings}
            </strong>{' '}
            linked finding{turn.previewCounts.totalFindings === 1 ? '' : 's'}
          </li>
        </ul>
      )}

      {/* Back-compat (pre-redesign replay only): the bulk-pattern resolve facts. */}
      {turn.patternFacts && (
        <div className={styles.pendingPattern} data-testid="review-room-pattern-facts">
          <strong data-testid="review-room-pattern-count">
            {turn.patternFacts.classMemberCount}
          </strong>{' '}
          <code data-testid="review-room-pattern-attr">{turn.patternFacts.attr}</code> conflicts
          compete between{' '}
          <span data-testid="review-room-pattern-sources">
            {turn.patternFacts.competingSources.join(' and ')}
          </span>{' '}
          — resolve all to <strong>{turn.patternFacts.chosenSource}</strong>?
        </div>
      )}

      {showConfirm && (
        <div className={styles.pendingActions} data-testid="review-room-pending-actions">
          <button
            type="button"
            className={styles.confirmButton}
            onClick={onConfirmClick}
            disabled={confirmBusy}
            data-testid="review-room-confirm-apply"
          >
            {confirmBusy ? (isSave ? 'Saving…' : 'Applying…') : isSave ? 'Yes, save' : 'Confirm & apply'}
          </button>
          {isSave && (
            <button
              type="button"
              className={styles.dismissButton}
              onClick={onDismissClick}
              disabled={confirmBusy}
              data-testid="review-room-confirm-dismiss"
            >
              No
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Degrade-in-place deterministic click-to-answer agenda (NO LLM).
// ===========================================================================

interface DegradedAgendaProps {
  chunk: ChunkSummaryTurnWire;
  busy: boolean;
  onApprove: (item: ChunkItemRefWire) => void;
  onAdvance?: () => void;
}

function DegradedAgenda({ chunk, busy, onApprove, onAdvance }: DegradedAgendaProps) {
  return (
    <div className={styles.degraded} data-testid="review-room-degraded-agenda">
      <div className={styles.degradedNote}>
        The Architect is unavailable — continuing with the deterministic agenda.
        Your decisions apply immediately; only the final Save asks to confirm.
      </div>
      <ul className={styles.degradedList}>
        {chunk.items.map((item) => (
          <li key={item.id} className={styles.degradedItem}>
            <span className={styles.degradedItemName}>{item.name}</span>
            <span className={styles.degradedItemDetail}>{item.detail}</span>
            <button
              type="button"
              className={styles.degradedApprove}
              onClick={() => onApprove(item)}
              disabled={busy}
              data-testid={`review-room-degraded-approve-${item.id}`}
            >
              Approve
            </button>
          </li>
        ))}
      </ul>
      {onAdvance && (
        <button
          type="button"
          className={styles.degradedAdvance}
          onClick={onAdvance}
          disabled={busy}
          data-testid="review-room-degraded-advance"
        >
          Next chunk
        </button>
      )}
    </div>
  );
}
