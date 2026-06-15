/**
 * Invocation-linkage resolver (D2 — Capability Synthesis + Batch Spines,
 * Task Group 4 / Decision D8).
 *
 * Operational functionality is a GRAPH, not a list of files: an Autosys JIL box
 * triggers shell scripts, which invoke plain-Java `main()` batch classes, which
 * read/write Sybase tables and publish a downstream message. This resolver
 * reconstructs that JIL -> shell -> Java -> DB chain as a typed
 * {@link InvocationEdge} array that lands INSIDE the capability `detail_json`.
 *
 * HARD boundary (D8): these edges live ONLY in `detail_json`. We mint NO
 * `DiscoveryRelationship` and NO `discovery_candidate` rows for inferred
 * cross-language edges — that would pollute the architecture relationship tables
 * with low-confidence string-matched links. Inferred (string-matched) edges
 * carry an explicit, LOWER confidence than structural edges (the JIL box-member
 * + condition DAG, which Group 2 derived deterministically).
 *
 * Resolution sources (each consumed WHEN PRESENT; none required — D9):
 *  - The JIL topology (Group 2): structural `box-member` + `condition` edges
 *    (high confidence) AND each job's `command:` (the shell entry point a job
 *    runs).
 *  - The discovered Java candidates (Group 3 batch-entrypoint `class`
 *    candidates + any other `class` candidate): the FQCN / simple-name targets a
 *    shell command or a JIL command can resolve to (inferred, lower confidence).
 *  - D1's `operational_artifact` findings' `detailJson.invokes` strings (plain
 *    file / FQCN / command strings): the shell -> Java / shell -> shell hops
 *    (inferred, lower confidence).
 *
 * Pure + deterministic: no I/O, no LLM. Given the same inputs it returns the
 * same edge set in a stable order.
 */

import type { JilTopology } from './jilParser';
import type { DiscoveryCandidate } from '../../types/candidate';

// ============================================================================
// Confidence bands
// ============================================================================

/**
 * Confidence for a STRUCTURAL edge derived deterministically from the JIL DAG
 * (Group 2's `box-member` / `condition` edges). These are read straight from the
 * `.jil` definition, so they are as certain as the source file itself.
 */
export const STRUCTURAL_EDGE_CONFIDENCE = 0.95;

/**
 * Confidence for an INFERRED edge resolved by FQCN / string match (a shell
 * command naming a Java class, an `invokes` string naming a discovered class).
 * Deliberately LOWER than {@link STRUCTURAL_EDGE_CONFIDENCE} so a consumer can
 * tell a derived link from a structural one, and so these never read as
 * architecture-grade relationships.
 */
export const INFERRED_EDGE_CONFIDENCE = 0.5;

/**
 * Confidence for a WEAK inferred edge — a plain `invokes` string that did NOT
 * resolve to any discovered Java candidate (an external command, a script we
 * never parsed, a downstream system). Recorded for completeness (the chain is
 * real) but at the lowest band.
 */
export const UNRESOLVED_EDGE_CONFIDENCE = 0.35;

// ============================================================================
// Edge / node types
// ============================================================================

/** The kind of node either end of an invocation edge denotes. */
export type InvocationNodeKind =
  | 'jil_box'
  | 'jil_job'
  | 'shell'
  | 'java_class'
  | 'database'
  | 'external'
  | 'unknown';

/** The mechanism by which `from` reaches `to`. */
export type InvocationMechanism =
  | 'jil_box_member' // structural: a box contains a child job
  | 'jil_condition' // structural: a condition-trigger DAG edge
  | 'jil_command' // a JIL job's `command:` runs a shell / binary
  | 'shell_invokes' // a shell script invokes another file / Java FQCN / command
  | 'invokes'; // a generic `invokes` reference (from a finding)

/**
 * One typed edge in the cross-language invocation chain. Stored verbatim in the
 * capability `detail_json.invocations[]`.
 */
export interface InvocationEdge {
  /** Source node identity (a job name, a script path, an FQCN, ...). */
  from: string;
  /** Source node kind. */
  fromKind: InvocationNodeKind;
  /** Target node identity. */
  to: string;
  /** Target node kind. */
  toKind: InvocationNodeKind;
  /** How `from` reaches `to`. */
  mechanism: InvocationMechanism;
  /** Confidence — structural edges high, inferred edges lower (see bands). */
  confidence: number;
}

/**
 * A minimal projection of an `operational_artifact` finding the resolver needs.
 * (We avoid importing the full Finding/`FindingEmitInput` shape so the resolver
 * stays decoupled and trivially testable.)
 */
export interface OperationalArtifactRef {
  /** Repo-relative file path of the artifact. */
  filePath: string;
  /** `detailJson.invokes` — plain file / FQCN / command strings (D1, Decision 6). */
  invokes: string[];
  /** Best-effort artifact kind (`shell_script` / `batch_job` / ...). */
  artifactKind?: string;
}

/**
 * Resolver input. Every field is optional / may be empty — the resolver seeds
 * from whatever exists and returns `[]` when nothing does (D9).
 */
export interface InvocationLinkageInput {
  /** The parsed JIL topology (Group 2). */
  topology?: JilTopology | null;
  /** Discovered Java candidates (Group 3 batch entrypoints + other `class` candidates). */
  javaCandidates?: DiscoveryCandidate[];
  /** D1 operational-artifact references (their `invokes` strings). */
  operationalArtifacts?: OperationalArtifactRef[];
}

// ============================================================================
// Java-candidate index (FQCN + simple-name resolution)
// ============================================================================

interface JavaTarget {
  /** The candidate's display name (simple class name). */
  simpleName: string;
  /** The fully-qualified class name when known (from `data.fullyQualifiedClass`). */
  fqcn?: string;
}

/**
 * Build lookup maps from the discovered `class` candidates so a string can be
 * resolved to a Java target by EITHER its FQCN or its simple name.
 */
function indexJavaCandidates(candidates: DiscoveryCandidate[]): {
  byFqcn: Map<string, JavaTarget>;
  bySimple: Map<string, JavaTarget>;
} {
  const byFqcn = new Map<string, JavaTarget>();
  const bySimple = new Map<string, JavaTarget>();
  for (const c of candidates) {
    if (c.candidateType !== 'class') continue;
    const data = (c.data ?? {}) as Record<string, unknown>;
    const fqcn =
      typeof data.fullyQualifiedClass === 'string' && data.fullyQualifiedClass.length > 0
        ? data.fullyQualifiedClass
        : undefined;
    const simpleName =
      typeof data.className === 'string' && data.className.length > 0
        ? data.className
        : c.name;
    const target: JavaTarget = { simpleName, fqcn };
    if (fqcn) byFqcn.set(fqcn, target);
    // Last-wins on a simple-name collision is acceptable — the inferred edge is
    // already low-confidence and a mis-seed is caught by human review.
    bySimple.set(simpleName, target);
  }
  return { byFqcn, bySimple };
}

/**
 * Resolve a free string (a shell command, a JIL `command:`, an `invokes` entry)
 * to a discovered Java target. Matches on:
 *  - an exact FQCN occurrence (`com.example.risk.RiskLoaderJob`), OR
 *  - a token equal to a known simple class name (`RiskLoaderJob`).
 * Returns null when nothing resolves.
 */
function resolveJavaTarget(
  raw: string,
  index: { byFqcn: Map<string, JavaTarget>; bySimple: Map<string, JavaTarget> },
): JavaTarget | null {
  const text = raw.trim();
  if (!text) return null;

  // 1) FQCN: any known FQCN appearing as a token in the string.
  for (const [fqcn, target] of index.byFqcn) {
    const re = new RegExp(`(^|[^A-Za-z0-9_.])${escapeRegExp(fqcn)}([^A-Za-z0-9_]|$)`);
    if (re.test(text)) return target;
  }

  // 2) Simple name: tokenise on shell / path separators and match a bare token.
  const tokens = text.split(/[\s/\\.;:()'"]+/).filter((t) => t.length > 0);
  for (const tok of tokens) {
    const hit = index.bySimple.get(tok);
    if (hit) return hit;
  }
  return null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does a string look like it references the DATABASE / a SQL object? Coarse —
 * used only to tag an `invokes`/command target's node kind for the chain
 * (never to mint a candidate).
 */
function looksLikeDatabase(raw: string): boolean {
  return /\b(insert|update|delete|select|merge|truncate|exec|sp_|proc_|\.sql)\b/i.test(raw);
}

/** Does a string look like a shell / script entry point? */
function looksLikeShell(raw: string): boolean {
  return /\.(sh|ksh|bash|bat|cmd|pl|py)\b/i.test(raw) || /^\//.test(raw.trim());
}

// ============================================================================
// Public resolver
// ============================================================================

/**
 * Build the typed cross-language invocation chain for a capability seed.
 *
 * Edge order is deterministic: structural JIL edges first (box-member, then
 * condition), then JIL `command:` -> shell/Java edges, then the operational
 * artifacts' `invokes` edges. Duplicate edges (same from/to/mechanism) are
 * collapsed, keeping the HIGHEST confidence seen.
 */
export function resolveInvocationLinkage(
  input: InvocationLinkageInput,
): InvocationEdge[] {
  const topology = input.topology ?? null;
  const javaCandidates = input.javaCandidates ?? [];
  const artifacts = input.operationalArtifacts ?? [];

  const javaIndex = indexJavaCandidates(javaCandidates);
  const edges: InvocationEdge[] = [];

  // --- 1) Structural JIL DAG edges (Group 2) — high confidence. ---
  if (topology) {
    const boxNames = new Set(topology.boxes.map((b) => b.name));
    for (const e of topology.edges) {
      if (e.type === 'box-member') {
        edges.push({
          from: e.from,
          fromKind: 'jil_box',
          to: e.to,
          toKind: boxNames.has(e.to) ? 'jil_box' : 'jil_job',
          mechanism: 'jil_box_member',
          confidence: STRUCTURAL_EDGE_CONFIDENCE,
        });
      } else {
        // condition edge
        edges.push({
          from: e.from,
          fromKind: boxNames.has(e.from) ? 'jil_box' : 'jil_job',
          to: e.to,
          toKind: boxNames.has(e.to) ? 'jil_box' : 'jil_job',
          mechanism: 'jil_condition',
          confidence: STRUCTURAL_EDGE_CONFIDENCE,
        });
      }
    }

    // --- 2) Each JIL job's `command:` -> the shell / Java it runs. ---
    for (const job of topology.jobs) {
      if (!job.command) continue;
      const cmd = job.command.trim();
      // The command itself is a shell/binary entry point.
      const java = resolveJavaTarget(cmd, javaIndex);
      if (java) {
        // The command runs (or wraps) a discovered Java class — inferred.
        edges.push({
          from: job.name,
          fromKind: 'jil_job',
          to: java.fqcn ?? java.simpleName,
          toKind: 'java_class',
          mechanism: 'jil_command',
          confidence: INFERRED_EDGE_CONFIDENCE,
        });
      } else {
        // The command is a shell script / external binary we did not resolve to
        // Java. Record the entry point (first token) so the chain is complete.
        const entry = firstCommandToken(cmd);
        if (entry) {
          edges.push({
            from: job.name,
            fromKind: 'jil_job',
            to: entry,
            toKind: looksLikeShell(entry) ? 'shell' : 'external',
            mechanism: 'jil_command',
            confidence: INFERRED_EDGE_CONFIDENCE,
          });
        }
      }
    }
  }

  // --- 3) Operational artifacts' `invokes` strings (D1) — inferred. ---
  for (const art of artifacts) {
    for (const inv of art.invokes) {
      const text = inv.trim();
      if (!text) continue;
      const java = resolveJavaTarget(text, javaIndex);
      if (java) {
        edges.push({
          from: art.filePath,
          fromKind: 'shell',
          to: java.fqcn ?? java.simpleName,
          toKind: 'java_class',
          mechanism: 'shell_invokes',
          confidence: INFERRED_EDGE_CONFIDENCE,
        });
      } else {
        // Unresolved invoke target: a downstream file / command / DB / system.
        const toKind: InvocationNodeKind = looksLikeDatabase(text)
          ? 'database'
          : looksLikeShell(text)
            ? 'shell'
            : 'external';
        edges.push({
          from: art.filePath,
          fromKind: 'shell',
          to: text,
          toKind,
          mechanism: 'invokes',
          confidence: UNRESOLVED_EDGE_CONFIDENCE,
        });
      }
    }
  }

  return dedupeEdges(edges);
}

/**
 * Extract the executable entry-point token of a shell `command:` — the first
 * whitespace-delimited token that is not an env-var assignment. Returns '' when
 * the command is empty.
 */
function firstCommandToken(command: string): string {
  const tokens = command.split(/\s+/).filter((t) => t.length > 0);
  for (const tok of tokens) {
    // Skip leading `VAR=value` environment assignments.
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) continue;
    return tok;
  }
  return '';
}

/**
 * Collapse duplicate edges (same `from` + `to` + `mechanism`), keeping the
 * highest confidence. Deterministic: input order is preserved for the survivors.
 */
function dedupeEdges(edges: InvocationEdge[]): InvocationEdge[] {
  const byKey = new Map<string, InvocationEdge>();
  for (const e of edges) {
    const key = `${e.from} ${e.to} ${e.mechanism}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, e);
    } else if (e.confidence > existing.confidence) {
      byKey.set(key, e);
    }
  }
  return Array.from(byKey.values());
}
