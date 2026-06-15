/**
 * Non-deterministic-endpoint scanner (Spring / Spring Classic ONLY).
 *
 * Spec: 2026-05-30 Oracle Integrity & Determinism (Spec #3), Task Group 4.
 *
 * A NEW deterministic post-Stage-2 scanner that walks the Java language pack's
 * Stage-1 IR (controllers + `rawContent`) and emits ONE
 * `non_deterministic_endpoint` evidence-gap Finding per controller endpoint
 * whose handler reaches a source of LEGITIMATE runtime VARIANCE -- i.e. the
 * endpoint is NOT a pure function of its inputs:
 *
 *  - `@Scheduled` / `@Cacheable` / `@Async` on the handler OR its controller
 *    class (response depends on cache state / async timing / a schedule);
 *  - a `@Profile`-gated controller class OR a `@Profile`-gated / `@Scheduled` /
 *    `@Cacheable` / `@Async` autowired collaborator bean the handler reaches
 *    (1-hop, resolved by field type against the IR -- mirrors the behaviour-
 *    capture stage's field-type resolution);
 *  - session-scoped state in the handler (`HttpSession`, `@SessionAttribute(s)`,
 *    `session.getAttribute(`);
 *  - a clock source in the handler body (`new Date(`, `System.currentTimeMillis`,
 *    `Instant.now`, `LocalDate(Time).now`, `LocalTime.now`, `ZonedDateTime.now`);
 *  - a random source in the handler body (`Math.random`, `new Random(`,
 *    `UUID.randomUUID`, `ThreadLocalRandom`).
 *
 * Tells the runtime harness the endpoint has EXPECTED variance so it must not
 * treat a differing replay response as a behavioural diff.
 *
 * Reuses the EXISTING evidence-gap machinery: it returns `FindingEmitInput[]`
 * via `buildNonDeterministicEndpointFinding` (the `emissionSources.ts` builder)
 * onto the SAME caller-emit boundary every other pack scanner uses -- no
 * parallel emitter, no `FindingEmitter` fork (the emitter normalizes + dedupes
 * + soft-fails). Per-file detection failures are caught so a single malformed
 * IR cannot poison the run; the shim in `index.ts` ALSO catches at the scanner
 * boundary (belt + braces, W4-aligned).
 *
 * Spring / Spring Classic ONLY -- non-`java` IR files are skipped (no-op on a
 * non-Spring input). Capped at `MAX_FINDINGS_PER_TYPE_PER_RUN` per run.
 */

import type { DiscoveryCandidate } from '../../../types/candidate';
import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
  AnnotationIR,
} from '../../extensionPacks';
import type { FindingEmitInput } from '../FindingEmitter';
import { buildNonDeterministicEndpointFinding } from '../emissionSources';
import { MAX_FINDINGS_PER_TYPE_PER_RUN } from './constants';
import type { PackFindingScannerInput } from './index';

// ----------------------------------------------------------------------------
// Constant sets
// ----------------------------------------------------------------------------

const MAPPING_ANNOTATION_NAMES: ReadonlySet<string> = new Set([
  'RequestMapping',
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping',
]);

const CONTROLLER_ANNOTATION_NAMES: ReadonlySet<string> = new Set([
  'Controller',
  'RestController',
]);

/**
 * Annotations whose presence on the handler, its controller class, OR a reached
 * collaborator bean makes the endpoint non-deterministic. `@Profile` gates which
 * bean is wired (so the response can differ by active profile); the other three
 * make the response depend on cache state / async timing / a schedule.
 */
const VARIANCE_ANNOTATIONS: ReadonlySet<string> = new Set([
  'Scheduled',
  'Cacheable',
  'Async',
  'Profile',
]);

/** Clock-source substrings looked for in the handler body. */
const CLOCK_PATTERNS: readonly string[] = [
  'new Date(',
  'System.currentTimeMillis',
  'System.nanoTime',
  'Instant.now',
  'LocalDate.now',
  'LocalDateTime.now',
  'LocalTime.now',
  'ZonedDateTime.now',
  'OffsetDateTime.now',
  'Calendar.getInstance',
];

/** Random-source substrings looked for in the handler body. */
const RANDOM_PATTERNS: readonly string[] = [
  'Math.random',
  'new Random(',
  'UUID.randomUUID',
  'ThreadLocalRandom',
  'SecureRandom',
];

/** Session-scoped-state substrings looked for in the handler body. */
const SESSION_PATTERNS: readonly string[] = [
  'HttpSession',
  'session.getAttribute',
  'session.setAttribute',
];

// ----------------------------------------------------------------------------
// Cap helpers (mirror springClassicFindingScanner)
// ----------------------------------------------------------------------------

function underCap(counts: Map<string, number>, findingType: string): boolean {
  return (counts.get(findingType) ?? 0) < MAX_FINDINGS_PER_TYPE_PER_RUN;
}
function bumpCap(counts: Map<string, number>, findingType: string): void {
  counts.set(findingType, (counts.get(findingType) ?? 0) + 1);
}

// ----------------------------------------------------------------------------
// IR helpers
// ----------------------------------------------------------------------------

function findMappingAnnotation(annotations: AnnotationIR[]): AnnotationIR | undefined {
  return annotations.find((a) => MAPPING_ANNOTATION_NAMES.has(a.name));
}

function hasAnyVarianceAnnotation(annotations: AnnotationIR[]): string[] {
  const hits: string[] = [];
  for (const a of annotations) {
    if (VARIANCE_ANNOTATIONS.has(a.name)) hits.push(`@${a.name}`);
  }
  return hits;
}

function candidateIdForEndpoint(
  candidates: DiscoveryCandidate[],
  filePath: string,
): string | undefined {
  for (const c of candidates) {
    if (
      c.candidateType === 'endpoints' &&
      Array.isArray(c.sourceClusterIds) &&
      c.sourceClusterIds.includes(filePath)
    ) {
      return c.id;
    }
  }
  return undefined;
}

/**
 * Slice a method body from raw source by balancing braces from the declaration
 * line. Best-effort + dependency-free (mirrors the behaviour-capture slicer).
 * Returns '' when the body cannot be located so callers can pattern-match
 * safely.
 */
function sliceMethodBody(rawContent: string, startLine: number): string {
  const lines = rawContent.split(/\r?\n/);
  if (startLine < 0 || startLine >= lines.length) return '';
  let openIdx = -1;
  let openCol = -1;
  for (let i = startLine; i < lines.length && i < startLine + 50; i += 1) {
    const col = lines[i].indexOf('{');
    if (col >= 0) {
      openIdx = i;
      openCol = col;
      break;
    }
    if (/;\s*$/.test(lines[i])) return ''; // abstract / interface declaration
  }
  if (openIdx < 0) return '';
  let depth = 0;
  for (let i = openIdx; i < lines.length; i += 1) {
    const line = lines[i];
    const from = i === openIdx ? openCol : 0;
    for (let c = from; c < line.length; c += 1) {
      if (line[c] === '{') depth += 1;
      else if (line[c] === '}') {
        depth -= 1;
        if (depth === 0) {
          return lines.slice(openIdx, i + 1).join('\n');
        }
      }
    }
  }
  // Unbalanced -- cap to avoid runaway.
  return lines.slice(startLine, Math.min(lines.length, startLine + 200)).join('\n');
}

function matchPatterns(body: string, patterns: readonly string[]): string[] {
  const hits: string[] = [];
  for (const pat of patterns) {
    if (body.includes(pat)) hits.push(pat);
  }
  return hits;
}

/**
 * Build the simple-name -> ClassIR index across the whole IR so handler bodies
 * can resolve an autowired collaborator field's type to a bean class and check
 * it for variance annotations (1-hop only).
 */
function buildClassIndex(
  irFiles: Map<string, SourceFileIR>,
): Map<string, ClassIR> {
  const idx = new Map<string, ClassIR>();
  for (const ir of irFiles.values()) {
    if (ir.language !== 'java') continue;
    for (const cls of ir.classes) idx.set(cls.name, cls);
  }
  return idx;
}

/**
 * Resolve the 1-hop reachable collaborator bean classes of a controller (its
 * autowired field types resolved against the IR). Returns the variance
 * annotations found on those beans (e.g. a `@Profile`-gated service).
 */
function reachedBeanVariance(
  controller: ClassIR,
  classIndex: Map<string, ClassIR>,
): string[] {
  const hits: string[] = [];
  for (const f of controller.fields) {
    const t = (f.type || '').trim();
    const lt = t.indexOf('<');
    const base = lt > 0 ? t.slice(0, lt) : t;
    const dot = base.lastIndexOf('.');
    const simple = dot >= 0 ? base.slice(dot + 1) : base;
    const beanCls = classIndex.get(simple);
    if (!beanCls) continue;
    for (const a of hasAnyVarianceAnnotation(beanCls.annotations)) {
      hits.push(`${a} on collaborator ${simple}`);
    }
  }
  return hits;
}

// ----------------------------------------------------------------------------
// Per-controller detection
// ----------------------------------------------------------------------------

function scanController(
  ir: SourceFileIR,
  cls: ClassIR,
  classIndex: Map<string, ClassIR>,
  packCandidates: DiscoveryCandidate[],
  counts: Map<string, number>,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  const raw = typeof ir.rawContent === 'string' ? ir.rawContent : '';

  // Class-level variance signals shared by every handler in the controller.
  const classAnnVariance = hasAnyVarianceAnnotation(cls.annotations);
  const beanVariance = reachedBeanVariance(cls, classIndex);

  for (const m of cls.methods) {
    const mappingAnn = findMappingAnnotation(m.annotations);
    if (!mappingAnn) continue; // not an endpoint handler

    const sources: string[] = [];

    // (1) Method-level + class-level variance annotations.
    for (const a of hasAnyVarianceAnnotation(m.annotations)) sources.push(a);
    for (const a of classAnnVariance) sources.push(`${a} (controller)`);

    // (2) Reached @Profile/@Scheduled/@Cacheable/@Async collaborator beans.
    for (const b of beanVariance) sources.push(b);

    // (3) Body patterns: clock / random / session.
    const body = raw ? sliceMethodBody(raw, m.line) : '';
    if (body) {
      for (const c of matchPatterns(body, CLOCK_PATTERNS)) sources.push(`clock:${c}`);
      for (const r of matchPatterns(body, RANDOM_PATTERNS)) sources.push(`random:${r}`);
      for (const sp of matchPatterns(body, SESSION_PATTERNS)) sources.push(`session:${sp}`);
    }
    // (3b) Session via parameter annotation/type (no body needed).
    for (const p of m.parameters) {
      if (p.annotations.some((a) => a.name === 'SessionAttribute' || a.name === 'SessionAttributes')) {
        sources.push('session:@SessionAttribute');
      }
      if ((p.type || '').includes('HttpSession')) {
        sources.push('session:HttpSession-param');
      }
    }

    if (sources.length === 0) continue; // pure handler -> no finding

    if (!underCap(counts, 'evidence_gap')) break;
    // De-duplicate the source list (a signal can be detected via >1 path).
    const uniqueSources = Array.from(new Set(sources));
    out.push(
      buildNonDeterministicEndpointFinding({
        endpointName: `${cls.name}#${m.name}`,
        controllerClass: cls.name,
        methodName: m.name,
        sourcesOfVariance: uniqueSources,
        sourceFilePath: ir.filePath,
        candidateId: candidateIdForEndpoint(packCandidates, ir.filePath),
      }),
    );
    bumpCap(counts, 'evidence_gap');
  }

  return out;
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

/**
 * Non-deterministic-endpoint scanner entry point. Pure: takes pack inputs,
 * returns `FindingEmitInput[]`. The caller passes the result to
 * `findingEmitter.emitFindings` (via `runPackFindingScanners`). Spring /
 * Spring Classic ONLY -- non-`java` IR files are skipped, so a non-Spring input
 * is a clean no-op. Per-controller soft-fail so a malformed IR cannot poison
 * the run.
 */
export function runNonDeterministicEndpointScanner(
  input: PackFindingScannerInput,
): FindingEmitInput[] {
  const collected: FindingEmitInput[] = [];
  const counts = new Map<string, number>();
  const classIndex = buildClassIndex(input.irFiles);
  let softFailFiles = 0;

  for (const [, ir] of input.irFiles) {
    if (ir.language !== 'java') continue; // Spring / Spring Classic only.
    try {
      for (const cls of ir.classes) {
        const isController = cls.annotations.some((a) =>
          CONTROLLER_ANNOTATION_NAMES.has(a.name),
        );
        if (!isController) continue;
        collected.push(
          ...scanController(ir, cls, classIndex, input.packCandidates, counts),
        );
      }
    } catch (err) {
      // Per-file soft-fail: never throw out of the scanner.
      softFailFiles += 1;
      console.warn(
        `[nonDeterministicEndpointScanner] Failed on file '${ir.filePath}'; continuing:`,
        err instanceof Error ? err.message : String(err),
      );
      console.warn(
        `[diag-pack] scanner=non_deterministic_endpoint soft_fail=true category=parse_error`,
      );
    }
  }

  if (softFailFiles > 0) {
    console.warn(
      `[diag-pack] scanner=non_deterministic_endpoint soft_fail_files=${softFailFiles}`,
    );
  }
  return collected;
}
