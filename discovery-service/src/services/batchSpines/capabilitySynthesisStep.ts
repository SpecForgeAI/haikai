/**
 * Capability-synthesis step (D2 — Capability Synthesis + Batch Spines,
 * Task Group 4 / Decisions D2, D7, D8, D9).
 *
 * Turns D1's scattered per-file `operational_artifact` findings (plus the
 * discovered batch-entrypoint candidates, the DB-object findings, and the JIL
 * topology) into coherent, durable, migrate-able `discovery_capability` records.
 * Thirty disconnected "here's a shell script" findings become ONE
 * "Daily Risk Hierarchy Load Pipeline" capability with its schedule, invocation
 * chain, and members.
 *
 * ARCHITECTURE (the non-negotiables):
 *  - Membership is DETERMINISTIC. The LLM is NAMING-ONLY (name / summary /
 *    `kind`) and NEVER adds, removes, or moves members. A mis-seed is caught by
 *    the capability's human review, not by a smarter seeder (D2).
 *  - TWO deterministic seeding modes:
 *      (a) JIL-DAG transitive closure — a box plus everything its DAG
 *          transitively triggers plus the shell/Java/DB it invokes = ONE seed.
 *      (b) Co-location / shared-external-system / artifactKind heuristic for the
 *          un-orchestrated long tail (Monitoring, Deployment/ARM, FTP ingestion)
 *          — operational artifacts NOT pulled into any JIL DAG.
 *  - The JIL topology + the typed `invocations[]` edges + schedule / external
 *    systems + an aggregated `behaviourBearing` hint land AUTHORITATIVELY in the
 *    capability `detail_json` (D7 / D8). Inferred edges carry explicit, lower
 *    confidence; NO `DiscoveryRelationship` / `discovery_candidate` rows are
 *    minted for them.
 *  - STANDS ALONE (D9): consumes D1 findings WHEN PRESENT but requires NONE.
 *    Seeds from batch entrypoints + DB-object findings + JIL topology alone;
 *    sparse signals -> fewer / smaller capabilities; ZERO signals -> a no-op
 *    (no capabilities, no error).
 *
 * MEMBERS, precisely: at the point this step runs (inside `discoveryV3Pipeline`
 * AFTER the merge/persist seam), the discovery CANDIDATES already carry stable
 * ids and are persisted, so they are referenceable as
 * `discovery_candidate` members. The operational-artifact FINDINGS are emitted
 * LATER by `runManager` (post-persist, so their links validate) and therefore do
 * NOT yet have AMS ids here — so their substance (file path, kind, invokes,
 * external systems, behaviourBearing) is folded into `detail_json` rather than
 * referenced by a dangling `member_id`. This is the graceful-degradation contract
 * (D9): a capability without D1 simply has candidate members; with D1 it also
 * carries the artifact detail in `detail_json`.
 *
 * The LLM relay reuses the `gatewayClient` -> gateway precedent
 * (`nameCapability` -> `discoveryCapabilityNaming.ts`), temperature 0, with a
 * source-hash cache mirroring `llmBehaviourCaptureStep` (`normalizeForHash` /
 * `createHash`). Mocked in all tests (no live LLM).
 */

import { createHash } from 'crypto';
import {
  gatewayClient,
  CapabilityNamingGatewayError,
} from '../gatewayClient';
import type {
  DiscoveryCapabilityCreatePayload,
  DiscoveryCapabilityMemberPayload,
} from '../archModelClient';
import type { DiscoveryCandidate } from '../../types/candidate';
import type { JilTopology, JilJob } from './jilParser';
import {
  resolveInvocationLinkage,
  type InvocationEdge,
  type OperationalArtifactRef,
} from './invocationLinkage';

// ============================================================================
// Input types
// ============================================================================

/**
 * The minimal projection of an `operational_artifact` finding the synthesis
 * consumes. Built by the caller from the in-memory `operational_artifact`
 * `FindingEmitInput.detailJson` (D1) -- decoupled from the full finding shape so
 * the step is trivially testable.
 */
export interface OperationalArtifactInput {
  /** Repo-relative file path. */
  filePath: string;
  /** Controlled artifact kind (`batch_job` / `shell_script` / `monitoring_config` / ...). */
  artifactKind: string;
  /** Does the file do operational work that must carry over like-for-like? */
  behaviourBearing: boolean;
  /** Files / Java FQCNs / external commands it invokes (plain strings). */
  invokes: string[];
  /** External systems it touches (DB / FTP / MQ / ...). */
  externalSystems: string[];
  /** One-line purpose (rides into the seed summary context). */
  purpose?: string;
}

/** Step input. Every signal is optional — synthesis seeds from whatever exists. */
export interface CapabilitySynthesisInput {
  runId: string;
  /** All merged + persisted discovery candidates for the run (have stable ids). */
  candidates: DiscoveryCandidate[];
  /** D1 operational-artifact projections (empty when D1 did not run). */
  operationalArtifacts?: OperationalArtifactInput[];
  /**
   * Parsed JIL topologies keyed by the source `.jil` file path. Empty when no
   * `.jil` file was present / parsed. The caller parses each batch
   * orchestration file via `parseJil` and supplies the map.
   */
  jilTopologies?: Map<string, JilTopology>;
}

/** One synthesised seed — the deterministic group BEFORE the LLM names it. */
export interface CapabilitySeed {
  /** Stable seed key (`jil:<box>` or `colocation:<kind>` ...). Drives the cache + naming correlation. */
  seedKey: string;
  /** The deterministic seeding mode that produced this seed. */
  mode: 'jil_dag' | 'colocation';
  /** Member candidate ids (discovery_candidate members). */
  candidateMemberIds: string[];
  /** The operational artifacts folded into this seed (their detail rides in detail_json). */
  artifacts: OperationalArtifactInput[];
  /** The JIL topology snapshot for this seed (jil_dag mode), if any. */
  topology?: JilTopology;
  /** The typed invocation edges for this seed (live in detail_json). */
  invocations: InvocationEdge[];
  /** Schedule attributes hoisted from the seed's JIL box/jobs. */
  schedule?: Record<string, unknown>;
  /** External systems aggregated across the seed's artifacts. */
  externalSystems: string[];
  /** Aggregated behaviourBearing: true if ANY member artifact bears behaviour. */
  behaviourBearing: boolean;
  /** A deterministic fallback name (used when the LLM relay fails / is absent). */
  fallbackName: string;
  /** The deterministic kind hint (the LLM may refine it). */
  kindHint: string;
}

/** Step output (observability + the payloads the caller persists). */
export interface CapabilitySynthesisOutput {
  /** The capability create payloads, ready for the AMS bulk endpoint. */
  payloads: DiscoveryCapabilityCreatePayload[];
  /** Number of deterministic seeds produced. */
  seedCount: number;
  /** Number of seeds the LLM named (the rest used the deterministic fallback). */
  namedByLlm: number;
  /** Number of naming-cache hits (source-hash unchanged). */
  cacheHits: number;
  /** Per-seed naming failures (non-fatal — fell back to the deterministic name). */
  namingFailures: number;
}

// ============================================================================
// Source-hash cache (mirrors llmBehaviourCaptureStep)
// ============================================================================

/**
 * Normalize a string for hashing: collapse whitespace + lower-case so the
 * `source_hash` is insensitive to incidental formatting but busts on any real
 * change to the seed's membership / topology.
 */
export function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Compute the seed's `source_hash` over its STABLE deterministic shape — the
 * sorted member ids, the sorted artifact paths, the invocation edges, and the
 * kind hint. A naming-cache entry keyed by this hash lets a re-run skip the LLM
 * when the seed is byte-identical (temperature-0 determinism + cost).
 */
export function computeSeedHash(seed: CapabilitySeed): string {
  const h = createHash('sha256');
  h.update(seed.mode);
  h.update('|');
  h.update([...seed.candidateMemberIds].sort().join(','));
  h.update('|');
  h.update(
    seed.artifacts
      .map((a) => a.filePath)
      .sort()
      .join(','),
  );
  h.update('|');
  h.update(
    seed.invocations
      .map((e) => `${e.from}>${e.to}:${e.mechanism}`)
      .sort()
      .join(','),
  );
  h.update('|');
  h.update(normalizeForHash(seed.kindHint));
  return h.digest('hex');
}

/** A cached naming result, keyed by `seedKey` and validated by `sourceHash`. */
export interface CapabilityNamingCacheEntry {
  sourceHash: string;
  name: string;
  summary: string;
  kind: string;
}

// ============================================================================
// Mode (a): JIL-DAG transitive closure
// ============================================================================

/**
 * Compute the set of jobs reachable from `start` by following the orchestration
 * DAG forward (box-member + condition edges). The closure is the box itself plus
 * everything it transitively triggers — ONE seed group (D2 mode a).
 */
function jilTransitiveClosure(topology: JilTopology, start: string): Set<string> {
  const adjacency = new Map<string, string[]>();
  for (const e of topology.edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }
  const seen = new Set<string>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const node = stack.pop() as string;
    for (const next of adjacency.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return seen;
}

/**
 * Pick the schedule attributes off a JIL box/job (the first job in the closure
 * that carries a schedule wins — boxes usually own the schedule).
 */
function hoistSchedule(jobs: JilJob[]): Record<string, unknown> | undefined {
  for (const j of jobs) {
    if (j.schedule && Object.keys(j.schedule).length > 0) {
      return {
        startTimes: j.schedule.startTimes,
        startMins: j.schedule.startMins,
        daysOfWeek: j.schedule.daysOfWeek,
        runCalendar: j.schedule.runCalendar,
        machine: j.machine,
        ownerJob: j.name,
      };
    }
  }
  return undefined;
}

/**
 * Build the JIL-DAG seeds. Each BOX becomes one seed (its transitive closure).
 * Standalone jobs (no box, no box membership) that are NOT in any box's closure
 * become their own single-job seed so an un-boxed orchestrated job is never lost.
 */
function seedFromJilTopologies(
  input: CapabilitySynthesisInput,
  javaCandidates: DiscoveryCandidate[],
): { seeds: CapabilitySeed[]; claimedArtifactPaths: Set<string> } {
  const seeds: CapabilitySeed[] = [];
  const claimedArtifactPaths = new Set<string>();
  const artifacts = input.operationalArtifacts ?? [];

  const topologies = input.jilTopologies ?? new Map<string, JilTopology>();
  for (const [jilPath, topology] of topologies) {
    if (topology.jobs.length === 0) continue;

    const jobByName = new Map(topology.jobs.map((j) => [j.name, j]));
    const claimedJobs = new Set<string>();

    // One seed per box (its transitive closure).
    for (const box of topology.boxes) {
      const closureNames = jilTransitiveClosure(topology, box.name);
      const closureJobs = [...closureNames]
        .map((n) => jobByName.get(n))
        .filter((j): j is JilJob => j !== undefined);
      for (const n of closureNames) claimedJobs.add(n);

      seeds.push(
        buildJilSeed(jilPath, box.name, topology, closureJobs, artifacts, javaCandidates, claimedArtifactPaths),
      );
    }

    // Any job not claimed by a box and not a box itself -> its own seed.
    for (const job of topology.jobs) {
      if (claimedJobs.has(job.name)) continue;
      if (job.jobType === 'b') continue; // an empty box with no members — skip
      const closureNames = jilTransitiveClosure(topology, job.name);
      const closureJobs = [...closureNames]
        .map((n) => jobByName.get(n))
        .filter((j): j is JilJob => j !== undefined);
      for (const n of closureNames) claimedJobs.add(n);
      seeds.push(
        buildJilSeed(jilPath, job.name, topology, closureJobs, artifacts, javaCandidates, claimedArtifactPaths),
      );
    }
  }

  return { seeds, claimedArtifactPaths };
}

/**
 * Build one JIL-DAG seed from a box/job and its closure. Resolves the
 * invocation linkage (structural DAG + each job's command -> shell/Java +
 * artifact invokes) and folds in the operational artifacts the closure's
 * commands reference (so a `.sh` the JIL runs is part of the pipeline seed, not
 * the un-orchestrated tail).
 */
function buildJilSeed(
  jilPath: string,
  rootName: string,
  fullTopology: JilTopology,
  closureJobs: JilJob[],
  allArtifacts: OperationalArtifactInput[],
  javaCandidates: DiscoveryCandidate[],
  claimedArtifactPaths: Set<string>,
): CapabilitySeed {
  // Project the closure into a sub-topology snapshot for detail_json.
  const closureNameSet = new Set(closureJobs.map((j) => j.name));
  const subTopology: JilTopology = {
    jobs: closureJobs,
    boxes: closureJobs.filter((j) => j.jobType === 'b'),
    fileWatchers: closureJobs.filter((j) => j.jobType === 'f'),
    edges: fullTopology.edges.filter(
      (e) => closureNameSet.has(e.from) || closureNameSet.has(e.to),
    ),
  };

  // Fold in artifacts whose path is named by any closure command (the shell
  // scripts this pipeline actually runs).
  const seedArtifacts: OperationalArtifactInput[] = [];
  for (const art of allArtifacts) {
    const base = art.filePath.split('/').pop() ?? art.filePath;
    const referenced = closureJobs.some(
      (j) => j.command != null && (j.command.includes(art.filePath) || j.command.includes(base)),
    );
    if (referenced) {
      seedArtifacts.push(art);
      claimedArtifactPaths.add(art.filePath);
    }
  }

  // Resolve the typed invocation chain for this seed.
  const invocations = resolveInvocationLinkage({
    topology: subTopology,
    javaCandidates,
    operationalArtifacts: toArtifactRefs(seedArtifacts),
  });

  // Members: every Java class candidate a closure command (or a folded
  // artifact's invokes) resolves to + that class's child method candidates.
  const candidateMemberIds = resolveCandidateMembers(invocations, javaCandidates);

  const externalSystems = dedupeStrings(seedArtifacts.flatMap((a) => a.externalSystems));
  const behaviourBearing = seedArtifacts.some((a) => a.behaviourBearing) || closureJobs.length > 0;

  return {
    seedKey: `jil:${jilPath}#${rootName}`,
    mode: 'jil_dag',
    candidateMemberIds,
    artifacts: seedArtifacts,
    topology: subTopology,
    invocations,
    schedule: hoistSchedule(closureJobs),
    externalSystems,
    behaviourBearing,
    fallbackName: `${humaniseName(rootName)} Pipeline`,
    kindHint: 'batch_pipeline',
  };
}

// ============================================================================
// Mode (b): co-location / shared-external-system / artifactKind heuristic
// ============================================================================

/**
 * Map an operational-artifact `artifactKind` to a coarse capability-kind bucket
 * for the un-orchestrated long tail. These are the co-location grouping keys.
 */
function colocationGroupKey(art: OperationalArtifactInput): { key: string; kind: string } {
  const k = art.artifactKind;
  if (k === 'monitoring_config') return { key: 'monitoring', kind: 'monitoring' };
  if (k === 'deployment_script' || k === 'ci_config') return { key: 'deployment', kind: 'deployment' };
  if (k === 'integration_config') return { key: 'ftp_ingestion', kind: 'ftp_ingestion' };
  if (k === 'maintenance_script') return { key: 'housekeeping', kind: 'housekeeping' };
  if (k === 'scheduler_config') return { key: 'scheduling', kind: 'batch_pipeline' };
  if (k === 'batch_job' || k === 'shell_script') return { key: 'batch_scripts', kind: 'batch_pipeline' };
  return { key: 'operational_other', kind: 'operational' };
}

/**
 * Build co-location seeds for operational artifacts NOT already claimed by a JIL
 * DAG seed. Groups by the artifactKind bucket; a shared external system refines
 * the key so two unrelated FTP feeds to different systems do not over-merge.
 */
function seedFromColocation(
  artifacts: OperationalArtifactInput[],
  claimedArtifactPaths: Set<string>,
  javaCandidates: DiscoveryCandidate[],
): CapabilitySeed[] {
  const groups = new Map<string, { kind: string; artifacts: OperationalArtifactInput[] }>();

  for (const art of artifacts) {
    if (claimedArtifactPaths.has(art.filePath)) continue;
    const { key, kind } = colocationGroupKey(art);
    // Shared-external-system refinement: append the (sorted) external systems so
    // co-located artifacts touching the SAME system group together.
    const sys = [...art.externalSystems].sort().join('+');
    const groupKey = sys.length > 0 ? `${key}|${sys}` : key;
    const g = groups.get(groupKey) ?? { kind, artifacts: [] };
    g.artifacts.push(art);
    groups.set(groupKey, g);
  }

  const seeds: CapabilitySeed[] = [];
  for (const [groupKey, g] of groups) {
    const invocations = resolveInvocationLinkage({
      javaCandidates,
      operationalArtifacts: toArtifactRefs(g.artifacts),
    });
    const candidateMemberIds = resolveCandidateMembers(invocations, javaCandidates);
    const externalSystems = dedupeStrings(g.artifacts.flatMap((a) => a.externalSystems));
    seeds.push({
      seedKey: `colocation:${groupKey}`,
      mode: 'colocation',
      candidateMemberIds,
      artifacts: g.artifacts,
      invocations,
      externalSystems,
      behaviourBearing: g.artifacts.some((a) => a.behaviourBearing),
      fallbackName: `${humaniseName(g.kind)} (${g.artifacts.length} artifact${g.artifacts.length === 1 ? '' : 's'})`,
      kindHint: g.kind,
    });
  }
  return seeds;
}

// ============================================================================
// Mode seam: orphan batch-entrypoint candidates (no JIL, no D1)
// ============================================================================

/**
 * When a batch-entrypoint `class` candidate is NOT pulled into any JIL-DAG seed
 * (no `.jil` referenced it) and D1 did not run, it would otherwise be lost. Seed
 * each such entrypoint as its own minimal capability so the plain-Java batch tier
 * is captured even with ZERO orchestration / D1 signal (D9 — seeds from batch
 * entrypoints alone).
 */
function seedFromOrphanBatchEntrypoints(
  javaCandidates: DiscoveryCandidate[],
  claimedCandidateIds: Set<string>,
): CapabilitySeed[] {
  const seeds: CapabilitySeed[] = [];
  for (const c of javaCandidates) {
    if (c.candidateType !== 'class') continue;
    const data = (c.data ?? {}) as Record<string, unknown>;
    if (data.batch_entrypoint !== true) continue;
    if (claimedCandidateIds.has(c.id)) continue;

    // Pull the class + its child method candidates as members.
    const memberIds = [c.id];
    for (const m of javaCandidates) {
      if (m.candidateType === 'method' && m.parentCandidateId === c.id) {
        memberIds.push(m.id);
      }
    }
    const operations = Array.isArray(data.operations) ? (data.operations as unknown[]) : [];
    seeds.push({
      seedKey: `batch_entrypoint:${c.id}`,
      mode: 'colocation',
      candidateMemberIds: memberIds,
      artifacts: [],
      invocations: [],
      externalSystems: [],
      behaviourBearing: true,
      fallbackName: `${humaniseName(c.name)} Batch Job`,
      kindHint: 'batch_pipeline',
      schedule: operations.length > 0 ? { operations } : undefined,
    });
  }
  return seeds;
}

// ============================================================================
// Member resolution (candidates only — findings ride in detail_json)
// ============================================================================

/**
 * Resolve the `discovery_candidate` members for a seed from its invocation
 * edges: every edge whose target resolved to a discovered Java class becomes a
 * class member, plus that class's child `method` candidates. Deterministic +
 * de-duplicated, preserving first-seen order.
 */
function resolveCandidateMembers(
  invocations: InvocationEdge[],
  javaCandidates: DiscoveryCandidate[],
): string[] {
  // Index class candidates by FQCN and simple name to map an edge target back
  // to a candidate id.
  const idByFqcn = new Map<string, string>();
  const idBySimple = new Map<string, string>();
  const childMethods = new Map<string, string[]>();
  for (const c of javaCandidates) {
    if (c.candidateType === 'class') {
      const data = (c.data ?? {}) as Record<string, unknown>;
      if (typeof data.fullyQualifiedClass === 'string') idByFqcn.set(data.fullyQualifiedClass, c.id);
      const simple = typeof data.className === 'string' ? data.className : c.name;
      idBySimple.set(simple, c.id);
    }
  }
  for (const c of javaCandidates) {
    if (c.candidateType === 'method' && c.parentCandidateId) {
      const list = childMethods.get(c.parentCandidateId) ?? [];
      list.push(c.id);
      childMethods.set(c.parentCandidateId, list);
    }
  }

  const memberIds: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id);
      memberIds.push(id);
    }
  };
  for (const e of invocations) {
    if (e.toKind !== 'java_class') continue;
    const classId = idByFqcn.get(e.to) ?? idBySimple.get(e.to);
    if (!classId) continue;
    add(classId);
    for (const childId of childMethods.get(classId) ?? []) add(childId);
  }
  return memberIds;
}

// ============================================================================
// Naming-only LLM (deterministic membership; LLM names/summarises/classifies)
// ============================================================================

/** Compose the naming prompt. STRICT JSON contract; the seed is fixed. */
export function composeNamingPrompt(seed: CapabilitySeed): string {
  const memberLines = seed.candidateMemberIds.length;
  const artifactLines = seed.artifacts
    .map((a) => `- ${a.filePath} (${a.artifactKind})${a.purpose ? `: ${a.purpose}` : ''}`)
    .join('\n');
  const edgeLines = seed.invocations
    .slice(0, 40)
    .map((e) => `- ${e.from} --[${e.mechanism}]--> ${e.to}`)
    .join('\n');
  const scheduleStr = seed.schedule ? JSON.stringify(seed.schedule) : '(none)';
  const externalStr = seed.externalSystems.length > 0 ? seed.externalSystems.join(', ') : '(none)';

  return [
    'You are a migration analyst NAMING a current-state operational CAPABILITY',
    '(a cross-cutting aggregation of related operational parts that becomes ONE',
    'migration story). The MEMBERSHIP of this capability is ALREADY FIXED — you',
    'must NOT add, remove, or change members. Name and classify it ONLY.',
    '',
    'Return STRICT JSON only (no markdown, no prose outside the object) with EXACTLY:',
    '  "name":    string   // a concise, human-readable capability name',
    '  "summary": string   // one sentence: what the capability does + its schedule/trigger if any',
    `  "kind":    string   // a short kind label, e.g. ${[
      'batch_pipeline',
      'monitoring',
      'ftp_ingestion',
      'deployment',
      'housekeeping',
    ].join(' | ')}`,
    '',
    `Deterministic seeding mode: ${seed.mode}`,
    `Member candidate count: ${memberLines}`,
    `Schedule / trigger: ${scheduleStr}`,
    `External systems: ${externalStr}`,
    '',
    '=== OPERATIONAL ARTIFACTS IN THIS CAPABILITY ===',
    artifactLines || '(none)',
    '',
    '=== INVOCATION CHAIN (evidence; do not restate verbatim) ===',
    edgeLines || '(none)',
  ].join('\n');
}

/** Parse the naming response into `{ name, summary, kind }`. Tolerant of a JSON fence. */
export function parseNamingResponse(content: string): {
  name?: string;
  summary?: string;
  kind?: string;
} {
  let text = (content ?? '').trim();
  if (text.length === 0) return {};
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fence) text = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;
  return {
    name: typeof obj.name === 'string' && obj.name.trim().length > 0 ? obj.name.trim() : undefined,
    summary:
      typeof obj.summary === 'string' && obj.summary.trim().length > 0 ? obj.summary.trim() : undefined,
    kind: typeof obj.kind === 'string' && obj.kind.trim().length > 0 ? obj.kind.trim() : undefined,
  };
}

// ============================================================================
// detail_json assembly + payload build
// ============================================================================

/** Build the capability `detail_json` for a seed (D7 / D8 + behaviourBearing). */
export function buildDetailJson(seed: CapabilitySeed): Record<string, unknown> {
  return {
    seedKey: seed.seedKey,
    seedMode: seed.mode,
    // JIL-DAG topology snapshot (authoritative here — enriches the .jil's D1 finding).
    jilTopology: seed.topology
      ? {
          jobs: seed.topology.jobs,
          boxes: seed.topology.boxes.map((b) => b.name),
          fileWatchers: seed.topology.fileWatchers.map((f) => f.name),
          edges: seed.topology.edges,
        }
      : null,
    // The typed cross-language invocation edges (D8) — inferred edges lower conf.
    invocations: seed.invocations,
    schedule: seed.schedule ?? null,
    externalSystems: seed.externalSystems,
    // Aggregated forward-seam hint for the later D4-gate spec.
    behaviourBearing: seed.behaviourBearing,
    // The operational artifacts folded into this capability (their substance —
    // they are NOT yet AMS findings with ids at synthesis time, so they ride here).
    artifacts: seed.artifacts.map((a) => ({
      filePath: a.filePath,
      artifactKind: a.artifactKind,
      behaviourBearing: a.behaviourBearing,
      invokes: a.invokes,
      externalSystems: a.externalSystems,
      purpose: a.purpose ?? null,
    })),
  };
}

// ============================================================================
// Public entry point
// ============================================================================

/**
 * Run capability synthesis: deterministic seeding -> naming-only LLM -> capability
 * create payloads. Pure of persistence (the caller posts the payloads via the AMS
 * bulk endpoint). Soft on the LLM: a naming failure falls back to the
 * deterministic name (the run never fails on naming).
 *
 * @param input the synthesis signals (candidates + D1 artifacts + JIL topologies)
 * @param priorCache prior naming-cache entries keyed by `seedKey` (source-hash
 *   cache; empty on a first run) — a hash match skips the LLM.
 */
export async function runCapabilitySynthesis(
  input: CapabilitySynthesisInput,
  priorCache?: Map<string, CapabilityNamingCacheEntry>,
): Promise<CapabilitySynthesisOutput> {
  const javaCandidates = input.candidates.filter(
    (c) => c.candidateType === 'class' || c.candidateType === 'method',
  );
  const cache = priorCache ?? new Map<string, CapabilityNamingCacheEntry>();

  // --- Seeding (deterministic) ---
  const { seeds: jilSeeds, claimedArtifactPaths } = seedFromJilTopologies(input, javaCandidates);
  const claimedCandidateIds = new Set<string>();
  for (const s of jilSeeds) for (const id of s.candidateMemberIds) claimedCandidateIds.add(id);

  const colocationSeeds = seedFromColocation(
    input.operationalArtifacts ?? [],
    claimedArtifactPaths,
    javaCandidates,
  );
  for (const s of colocationSeeds) for (const id of s.candidateMemberIds) claimedCandidateIds.add(id);

  const orphanSeeds = seedFromOrphanBatchEntrypoints(javaCandidates, claimedCandidateIds);

  // Keep only seeds that have at least one member OR at least one artifact —
  // an empty seed is meaningless (and the zero-signal no-op falls out here).
  const seeds = [...jilSeeds, ...colocationSeeds, ...orphanSeeds].filter(
    (s) => s.candidateMemberIds.length > 0 || s.artifacts.length > 0,
  );

  if (seeds.length === 0) {
    // D9: ZERO signals -> a clean no-op (no capabilities, no error).
    return { payloads: [], seedCount: 0, namedByLlm: 0, cacheHits: 0, namingFailures: 0 };
  }

  // --- Naming-only LLM (membership already fixed) ---
  let namedByLlm = 0;
  let cacheHits = 0;
  let namingFailures = 0;
  const payloads: DiscoveryCapabilityCreatePayload[] = [];

  for (const seed of seeds) {
    const sourceHash = computeSeedHash(seed);
    let name = seed.fallbackName;
    let summary = '';
    let kind = seed.kindHint;

    const cached = cache.get(seed.seedKey);
    if (cached && cached.sourceHash === sourceHash) {
      // Source-hash cache hit — skip the LLM, carry the prior naming forward.
      name = cached.name;
      summary = cached.summary;
      kind = cached.kind;
      cacheHits += 1;
    } else {
      try {
        const prompt = composeNamingPrompt(seed);
        const response = await gatewayClient.nameCapability(prompt, seed.seedKey, input.runId);
        const parsed = parseNamingResponse(response?.content ?? '');
        if (parsed.name) {
          name = parsed.name;
          namedByLlm += 1;
        }
        if (parsed.summary) summary = parsed.summary;
        if (parsed.kind) kind = parsed.kind;
        // Refresh the cache entry for the next run.
        cache.set(seed.seedKey, { sourceHash, name, summary, kind });
      } catch (err) {
        // Naming-only LLM failure is NON-FATAL — membership is already fixed.
        namingFailures += 1;
        const msg =
          err instanceof CapabilityNamingGatewayError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        console.warn(
          `[CapabilitySynthesis] naming failed for ${seed.seedKey}; using deterministic fallback: ${msg}`,
        );
      }
    }

    const members: DiscoveryCapabilityMemberPayload[] = seed.candidateMemberIds.map((id) => ({
      memberType: 'discovery_candidate',
      memberId: id,
    }));

    payloads.push({
      name,
      kind,
      summary: summary.length > 0 ? summary : null,
      // Synthesis confidence: the seed's structural strength. JIL-DAG seeds are
      // stronger (structural) than co-location seeds (heuristic).
      confidence: seed.mode === 'jil_dag' ? 0.85 : 0.6,
      detailJson: buildDetailJson(seed),
      source: 'capability_synthesis',
      createdByStage: 'discoveryV3Pipeline.capabilitySynthesis',
      members,
    });
  }

  console.log(
    `[CapabilitySynthesis] runId=${input.runId}: seeds=${seeds.length} ` +
      `(jil=${jilSeeds.length}, colocation=${colocationSeeds.length}, orphanEntrypoints=${orphanSeeds.length}), ` +
      `namedByLlm=${namedByLlm}, cacheHits=${cacheHits}, namingFailures=${namingFailures}`,
  );

  return {
    payloads,
    seedCount: seeds.length,
    namedByLlm,
    cacheHits,
    namingFailures,
  };
}

// ============================================================================
// Small helpers
// ============================================================================

function toArtifactRefs(arts: OperationalArtifactInput[]): OperationalArtifactRef[] {
  return arts.map((a) => ({
    filePath: a.filePath,
    invokes: a.invokes,
    artifactKind: a.artifactKind,
  }));
}

function dedupeStrings(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const t = it.trim();
    if (t.length > 0 && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Turn a JIL/box/class identifier into a human-readable Title Case phrase. */
function humaniseName(raw: string): string {
  const cleaned = raw
    .replace(/\.(jil|sh|ksh|bash)$/i, '')
    .replace(/[._-]+/g, ' ')
    // split camelCase
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  return cleaned
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
