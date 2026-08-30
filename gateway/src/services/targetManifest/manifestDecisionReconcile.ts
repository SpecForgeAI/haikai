/**
 * Manifest ↔ decision reconciliation (2026-08-15).
 *
 * The confirmed pom is the authoritative BASELINE: what is already in it must
 * never change silently (it auto-answered decisions), but the target-state
 * conversation legitimately implies ADDITIONS — the live gaps: decisions
 * declared Liquibase + Mixed JSON/XML while the pom had neither
 * liquibase-core nor jackson-dataformat-xml, so the scaffolded app could
 * neither read a table nor reach XML parity.
 *
 * Three divergence classes, three behaviours:
 *   - ADDITION  (decision-required coordinate absent): PROPOSED — the
 *     operator approves per-row/all; the tool writes a NEW latest manifest
 *     artifact version with the dependency inserted as a minimal TEXTUAL
 *     edit (the rest of the pom byte-identical). BOM-managed coordinates are
 *     inserted VERSION-LESS (the Boot/Cloud parents manage them).
 *   - CONFLICT  (decision contradicts an EXISTING entry's version): loud
 *     warning with both values; NEVER auto-changed — the operator either
 *     revises the decision or re-uploads a corrected pom.
 *   - EXTRAS    (pom entries decisions don't know): untouched.
 *
 * 2026-08-30: a SECOND pass reconciles the `modernize.*` namespace (SCL
 * modernization review) whose values name concrete Java packages — see
 * `reconcileManifestWithModernizationDecisions` below, plus the CAPABILITY
 * CONFLICT divergence class it introduces. `reconcileManifestWithAllDecisions`
 * feeds both namespaces through one additions/conflicts pipeline.
 *
 * Deterministic; no LLM; pure over its inputs.
 */

import { TargetStateCapturedDecision } from '../targetStateCapturedDecisionsClient';
import { architectureDecisionValues } from '../migrationTargetStackSpecSection';

// ---------------------------------------------------------------------------
// Decision-code -> required Maven coordinate mapping (small + obviously
// correct; extend as new decision values appear).
// ---------------------------------------------------------------------------

export interface RequiredCoordinateRule {
  decisionCode: string;
  /** Fires when the captured value matches (case-insensitive). */
  whenValueMatches: RegExp;
  groupId: string;
  artifactId: string;
  /** True = the Spring Boot / Cloud BOMs manage the version — insert version-less. */
  bomManaged: boolean;
  note: string;
}

export const REQUIRED_COORDINATE_RULES: readonly RequiredCoordinateRule[] = [
  {
    decisionCode: 'db.migrations',
    whenValueMatches: /liquibase/i,
    groupId: 'org.liquibase',
    artifactId: 'liquibase-core',
    bomManaged: true,
    note: 'Schema-migration tool declared by db.migrations — without it nothing can apply the changelogs.',
  },
  {
    decisionCode: 'api.contractFormat',
    whenValueMatches: /xml/i,
    groupId: 'com.fasterxml.jackson.dataformat',
    artifactId: 'jackson-dataformat-xml',
    bomManaged: true,
    note: 'XML payload support declared by api.contractFormat — without it XML Accept returns 406 and XML-captured baselines cannot reach parity.',
  },
  {
    decisionCode: 'api.protocol',
    whenValueMatches: /soap/i,
    groupId: 'org.springframework.boot',
    artifactId: 'spring-boot-starter-web-services',
    bomManaged: true,
    note: 'SOAP support declared by api.protocol.',
  },
  {
    decisionCode: 'db.driver',
    whenValueMatches: /pgjdbc|postgres/i,
    groupId: 'org.postgresql',
    artifactId: 'postgresql',
    bomManaged: true,
    note: 'JDBC driver declared by db.driver.',
  },
  {
    decisionCode: 'validation.framework',
    whenValueMatches: /bean validation|jakarta|hibernate validator/i,
    groupId: 'org.springframework.boot',
    artifactId: 'spring-boot-starter-validation',
    bomManaged: true,
    note: 'Bean Validation declared by validation.framework.',
  },
];

// ---------------------------------------------------------------------------
// Pom parsing (textual — the pom is never re-serialized)
// ---------------------------------------------------------------------------

export interface PomDependency {
  groupId: string;
  artifactId: string;
  version: string | null;
}

/**
 * Replace every XML comment's characters with spaces of EQUAL length. All
 * indices into the masked string are valid in the original — the scan runs on
 * the masked text, edits land on the original bytes. A commented-out
 * dependency (or a commented-out `</dependencies>` tag) therefore can never
 * satisfy a requirement or attract an insert.
 */
function maskComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, (m) => ' '.repeat(m.length));
}

interface PomScan {
  /**
   * Index of the `</dependencies>` close tag of the PROJECT-level
   * `<dependencies>` element (a direct child of `<project>`); -1 when the pom
   * has none. This is the ONLY block additions may be inserted into — a
   * `<dependencies>` inside `<build>/<plugin>` is a plugin classpath, and one
   * inside `<dependencyManagement>` only manages versions.
   */
  projectDependenciesCloseIdx: number;
  /** Every `<dependency>` element with its ancestor element names (outermost first). */
  dependencyBlocks: Array<{ start: number; end: number; path: string[] }>;
}

/**
 * Single lightweight element walk over the comment-masked pom. Tracks an open
 * -element stack so every `<dependency>` knows its ancestors and the
 * project-level `<dependencies>` is identified STRUCTURALLY — not by textual
 * position relative to `</dependencyManagement>`, which broke on the canonical
 * Spring Initializr layout (project dependencies BEFORE dependencyManagement,
 * `<build>` plugins carrying their own `<dependencies>` after it).
 */
function scanPom(masked: string): PomScan {
  const tagRe = /<(\/?)([A-Za-z][\w.:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)(\/?)>/g;
  const stack: string[] = [];
  const dependencyBlocks: PomScan['dependencyBlocks'] = [];
  let projectDependenciesCloseIdx = -1;
  let openDep: { start: number; path: string[] } | null = null;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(masked)) !== null) {
    const closing = m[1] === '/';
    const name = m[2];
    const selfClosing = m[4] === '/';
    if (!closing) {
      if (selfClosing) continue;
      if (name === 'dependency' && openDep === null) {
        openDep = { start: m.index, path: [...stack] };
      }
      stack.push(name);
    } else {
      const at = stack.lastIndexOf(name);
      if (at >= 0) stack.length = at; // tolerate malformed nesting
      if (name === 'dependency' && openDep !== null) {
        dependencyBlocks.push({
          start: openDep.start,
          end: m.index + m[0].length,
          path: openDep.path,
        });
        openDep = null;
      }
      if (
        name === 'dependencies' &&
        projectDependenciesCloseIdx < 0 &&
        stack.length === 1 &&
        stack[0] === 'project'
      ) {
        projectDependenciesCloseIdx = m.index;
      }
    }
  }
  return { projectDependenciesCloseIdx, dependencyBlocks };
}

/**
 * True when a `<dependency>` at this ancestor path DECLARES a dependency:
 * the project `<dependencies>`, `<dependencyManagement>` (project or profile
 * scoped — a managed entry still satisfies a requirement), or a `<profile>`'s
 * own `<dependencies>`. Excludes `<build>/<plugin>` dependencies (plugin
 * classpath, NOT the application's) — counting those as "present" silently
 * suppressed required additions.
 */
function declaresDependency(path: string[]): boolean {
  const parent = path[path.length - 1];
  const grand = path[path.length - 2];
  if (parent !== 'dependencies') return false;
  return grand === 'project' || grand === 'dependencyManagement' || grand === 'profile';
}

/** All DECLARED `<dependency>` entries (project deps + dependencyManagement +
 * profiles — a managed entry still satisfies the requirement). Comments are
 * masked first and `<build>/<plugin>` classpath sections never count. */
export function parsePomDependencies(content: string): PomDependency[] {
  const masked = maskComments(content);
  const { dependencyBlocks } = scanPom(masked);
  const out: PomDependency[] = [];
  for (const b of dependencyBlocks) {
    if (!declaresDependency(b.path)) continue;
    const block = masked.slice(b.start, b.end);
    const g = /<groupId>\s*([^<]+?)\s*<\/groupId>/.exec(block)?.[1] ?? null;
    const a = /<artifactId>\s*([^<]+?)\s*<\/artifactId>/.exec(block)?.[1] ?? null;
    const v = /<version>\s*([^<]+?)\s*<\/version>/.exec(block)?.[1] ?? null;
    if (g && a) out.push({ groupId: g, artifactId: a, version: v });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

export interface ProposedAddition {
  groupId: string;
  artifactId: string;
  /** Null = BOM-managed (inserted version-less). */
  version: string | null;
  decisionCode: string;
  note: string;
}

export interface ManifestConflict {
  decisionCode: string;
  coordinate: string;
  pomVersion: string;
  decisionValue: string;
  message: string;
  /**
   * `'version'`    (default, omitted for back-compat): the pom pins a
   *                DIFFERENT major of the same coordinate.
   * `'capability'` the pom declares a different library providing the SAME
   *                capability (e.g. two competing cache libraries). A version
   *                compare cannot detect this because the coordinates differ.
   */
  kind?: 'version' | 'capability';
  /** For `kind: 'capability'` — the `groupId:artifactId` found instead. */
  substituteCoordinate?: string;
}

export interface ManifestReconcileResult {
  additions: ProposedAddition[];
  conflicts: ManifestConflict[];
}

/** First integer run in a label (e.g. "Liquibase 4" -> "4"); null if none. */
function majorOf(label: string | null | undefined): string | null {
  const m = /(\d+)/.exec(label ?? '');
  return m ? m[1] : null;
}

export function reconcileManifestWithDecisions(
  pomContent: string,
  decisions: readonly TargetStateCapturedDecision[]
): ManifestReconcileResult {
  const values = architectureDecisionValues(decisions);
  const deps = parsePomDependencies(pomContent);
  const has = (g: string, a: string) =>
    deps.find((d) => d.groupId === g && d.artifactId === a) ?? null;

  const additions: ProposedAddition[] = [];
  const conflicts: ManifestConflict[] = [];
  for (const rule of REQUIRED_COORDINATE_RULES) {
    const value = values.get(rule.decisionCode);
    if (!value || !rule.whenValueMatches.test(value)) continue;
    const existing = has(rule.groupId, rule.artifactId);
    if (!existing) {
      additions.push({
        groupId: rule.groupId,
        artifactId: rule.artifactId,
        version: rule.bomManaged ? null : majorOf(value),
        decisionCode: rule.decisionCode,
        note: rule.note,
      });
      continue;
    }
    // Present: CONFLICT only when both sides carry an explicit version and
    // the majors disagree — never auto-changed, always the operator's call.
    const decisionMajor = majorOf(value);
    const pomMajor = majorOf(existing.version);
    if (
      decisionMajor !== null &&
      existing.version !== null &&
      pomMajor !== null &&
      decisionMajor !== pomMajor
    ) {
      conflicts.push({
        decisionCode: rule.decisionCode,
        coordinate: `${rule.groupId}:${rule.artifactId}`,
        pomVersion: existing.version,
        decisionValue: value,
        message:
          `The pom pins ${rule.groupId}:${rule.artifactId} at ${existing.version} but ` +
          `[decision:${rule.decisionCode}] captured "${value}". The pom is the ` +
          'authoritative baseline — this is NEVER changed automatically: either ' +
          'revise the decision through the conversation, or upload a corrected pom.',
      });
    }
  }
  return { additions, conflicts };
}

// ---------------------------------------------------------------------------
// Modernization-decision -> required Maven coordinate mapping (2026-08-30).
//
// THE LIVE GAP this closes: the reconciler above only ever saw the
// TARGET-STATE namespace (`db.migrations`, `api.contractFormat`, ...). The
// SCL modernization review writes a SECOND namespace (`modernize.*`) whose
// values name concrete Java packages — and nothing reconciled it against the
// seed pom. A scaffold shipped where confirmed modernization decisions kept
// library types (a cache API among them) while the authoritative seed pom
// declared NO such library and DID declare a competing one — the very option
// a decision had explicitly rejected. Because the seed block's own rule is
// "every entry must SURVIVE every later edit", the contradiction resolved
// AGAINST the decisions: the competitor stayed permanent and the kept types
// had no dependency to compile against.
//
// Two divergence classes are added here:
//   - ADDITION            required coordinate absent  -> propose (as before)
//   - CAPABILITY CONFLICT a SUBSTITUTE providing the same capability is
//                         present instead -> LOUD, never auto-changed. A
//                         version-major compare cannot see it because the
//                         coordinates differ.
// ---------------------------------------------------------------------------

export interface ModernizeCoordinateRule {
  /** Java package prefix that, when named as the decision TARGET, implies the coordinate. */
  packagePrefix: string;
  groupId: string;
  artifactId: string;
  bomManaged: boolean;
  /**
   * Coordinates that provide the SAME capability. If one of these is present
   * while the required coordinate is absent, that is a CAPABILITY CONFLICT
   * (not a missing addition) — the operator must resolve it.
   */
  substitutes?: readonly string[];
  note: string;
}

/** Ordered SPECIFIC -> GENERAL: the first prefix a token matches wins. */
export const MODERNIZE_COORDINATE_RULES: readonly ModernizeCoordinateRule[] = [
  {
    packagePrefix: 'com.google.common.cache.',
    groupId: 'com.google.guava',
    artifactId: 'guava',
    bomManaged: false,
    substitutes: ['com.github.ben-manes.caffeine:caffeine', 'org.ehcache:ehcache'],
    note: 'Guava cache required by a modernize.* decision that kept com.google.common.cache types.',
  },
  {
    packagePrefix: 'com.google.common.',
    groupId: 'com.google.guava',
    artifactId: 'guava',
    bomManaged: false,
    note: 'Guava required by a modernize.* decision naming com.google.common.* as the target type.',
  },
  {
    packagePrefix: 'org.joda.time.',
    groupId: 'joda-time',
    artifactId: 'joda-time',
    bomManaged: false,
    substitutes: [],
    note: 'Joda-Time required by a modernize.* decision that KEPT an org.joda.time.* target type.',
  },
  {
    packagePrefix: 'org.aspectj.lang.',
    groupId: 'org.aspectj',
    artifactId: 'aspectjweaver',
    bomManaged: true,
    note: 'AspectJ required by a modernize.* decision naming org.aspectj.lang.* (e.g. ProceedingJoinPoint).',
  },
  {
    packagePrefix: 'org.apache.poi.',
    groupId: 'org.apache.poi',
    artifactId: 'poi',
    bomManaged: false,
    note: 'Apache POI required by a modernize.* decision naming org.apache.poi.* (Excel loaders).',
  },
  {
    packagePrefix: 'org.apache.commons.cli.',
    groupId: 'commons-cli',
    artifactId: 'commons-cli',
    bomManaged: false,
    note: 'commons-cli required by a modernize.* decision naming org.apache.commons.cli.* (batch mains).',
  },
  {
    packagePrefix: 'org.apache.commons.collections4.',
    groupId: 'org.apache.commons',
    artifactId: 'commons-collections4',
    bomManaged: false,
    note: 'commons-collections4 required by a modernize.* decision naming org.apache.commons.collections4.*.',
  },
];

/** A confirmed modernization decision, normalised to code + captured value. */
export interface ModernizationDecisionValue {
  code: string;
  value: string;
}

/**
 * All `modernize.*` decisions normalised to (code, value). They arrive on the
 * SAME captured-decision fetch as the target-state namespace — but
 * `architectureDecisionValues` skips every SCOPED row and no
 * `REQUIRED_COORDINATE_RULES` entry keys on a modernize.* code, so the
 * target-state pass above can never see them; they need their own pass.
 */
export function modernizationDecisionValues(
  decisions: readonly TargetStateCapturedDecision[]
): ModernizationDecisionValue[] {
  return decisions
    .filter((d) => (d.decisionCode ?? '').startsWith('modernize.'))
    .map((d) => ({ code: d.decisionCode, value: d.answerValue ?? d.answerSummary ?? '' }))
    .filter((d) => d.value !== '');
}

/**
 * The TARGET side of a modernization value.
 *
 * Values arrive in three shapes and ALL must resolve to the same target:
 *   - the confirm-write JSON envelope `{"from","to",...}` — the target is the
 *     `to` member alone;
 *   - `"SourceType -> target text"` summaries — everything left of the LAST
 *     `->` is the SOURCE type and must be ignored (otherwise a decision that
 *     migrates AWAY from a library would require that library);
 *   - a plain target string.
 * The coordinate can sit either side of a parenthesis in the target text
 * (e.g. `keep dependency (com.example.cache.LoadingCache)`).
 */
export function modernizationTargetText(value: string): string {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === 'object') {
      const to = (parsed as Record<string, unknown>).to;
      if (typeof to === 'string' && to.trim().length > 0) return to.trim();
    }
  } catch {
    // not JSON — fall through to the textual shapes
  }
  const idx = value.lastIndexOf('->');
  return (idx >= 0 ? value.slice(idx + 2) : value).trim();
}

/** Fully-qualified Java type tokens (>= 3 dot-separated segments). */
const FQ_TOKEN_RE = /\b(?:[a-z][A-Za-z0-9_]*\.){2,}[A-Za-z][A-Za-z0-9_]*\b/g;

/**
 * Tokens the decision explicitly moves AWAY from — anything following a
 * drop/remove/replace/migrate-off cue. Without this, a decision shaped
 * `"-> new.Type (drop legacy.collections 3.x ...)"` would require the very
 * library it is removing.
 */
function droppedSpans(targetText: string): string {
  const cues = /\b(drop|remove|replace|instead of|migrate off|away from)\b/gi;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = cues.exec(targetText)) !== null) {
    out += ' ' + targetText.slice(m.index, m.index + 160);
  }
  return out;
}

/**
 * Reconcile the confirmed pom against the CONFIRMED MODERNIZATION decisions.
 *
 * Pure over its inputs; same result shape as the target-state reconciler so
 * both feed one additions/conflicts pipeline.
 */
export function reconcileManifestWithModernizationDecisions(
  pomContent: string,
  decisions: readonly ModernizationDecisionValue[]
): ManifestReconcileResult {
  const deps = parsePomDependencies(pomContent);
  const hasCoord = (g: string, a: string) =>
    deps.find((d) => d.groupId === g && d.artifactId === a) ?? null;

  // rule index -> the decision codes that demanded it (deduped, sorted).
  const demandedBy = new Map<number, Set<string>>();
  for (const d of decisions) {
    if (!d || typeof d.value !== 'string' || !d.code?.startsWith('modernize.')) continue;
    const target = modernizationTargetText(d.value);
    const dropped = droppedSpans(target);
    const tokens = target.match(FQ_TOKEN_RE) ?? [];
    for (const token of tokens) {
      // Ignore a token that only appears inside a drop/replace clause.
      if (dropped.includes(token)) continue;
      for (let i = 0; i < MODERNIZE_COORDINATE_RULES.length; i++) {
        if (token.startsWith(MODERNIZE_COORDINATE_RULES[i].packagePrefix)) {
          if (!demandedBy.has(i)) demandedBy.set(i, new Set());
          demandedBy.get(i)!.add(d.code);
          break; // most specific rule wins (ordered specific -> general)
        }
      }
    }
  }

  const additions: ProposedAddition[] = [];
  const conflicts: ManifestConflict[] = [];
  const alreadyProposed = new Set<string>();

  for (const [ruleIdx, codes] of [...demandedBy.entries()].sort((a, b) => a[0] - b[0])) {
    const rule = MODERNIZE_COORDINATE_RULES[ruleIdx];
    const coordinate = `${rule.groupId}:${rule.artifactId}`;
    if (hasCoord(rule.groupId, rule.artifactId)) continue; // satisfied
    if (alreadyProposed.has(coordinate)) continue;

    const sortedCodes = [...codes].sort();
    const citation =
      sortedCodes.length === 1
        ? `[decision:${sortedCodes[0]}]`
        : `${sortedCodes.length} decisions (e.g. [decision:${sortedCodes[0]}])`;

    // Capability conflict beats addition: a substitute is already installed.
    const substitute = (rule.substitutes ?? []).find((s) => {
      const [g, a] = s.split(':');
      return !!hasCoord(g, a);
    });
    if (substitute) {
      conflicts.push({
        decisionCode: sortedCodes[0],
        coordinate,
        pomVersion:
          hasCoord(substitute.split(':')[0], substitute.split(':')[1])?.version ??
          '(managed)',
        decisionValue: sortedCodes.join(', '),
        kind: 'capability',
        substituteCoordinate: substitute,
        message:
          `${citation} require ${coordinate}, but the confirmed pom declares ` +
          `${substitute} instead — the same capability from a DIFFERENT library. ` +
          'The pom is the authoritative baseline and its entries must survive every ' +
          'later edit, so this is NEVER changed automatically: either revise the ' +
          'modernization decision(s) to target ' +
          `${substitute.split(':')[1]}, or upload a corrected pom that declares ` +
          `${coordinate}. Leaving it unresolved ships BOTH libraries.`,
      });
      continue;
    }

    alreadyProposed.add(coordinate);
    additions.push({
      groupId: rule.groupId,
      artifactId: rule.artifactId,
      // No modernize.* rule pins a version: BOM-managed entries take the
      // parent BOM's version, the rest are proposed version-less for the
      // operator to pin on approval.
      version: null,
      decisionCode: sortedCodes[0],
      note: `${rule.note} Demanded by ${citation}.`,
    });
  }
  return { additions, conflicts };
}

/**
 * BOTH namespaces through ONE additions/conflicts pipeline (2026-08-30):
 * the target-state pass plus the modernize.* pass, additions de-duped by
 * coordinate (both namespaces can want the same jar), conflicts concatenated.
 * This is the shape the auto-apply AND the reconcile panel/apply routes read,
 * so the operator sees exactly what the auto-apply saw.
 */
export function reconcileManifestWithAllDecisions(
  pomContent: string,
  decisions: readonly TargetStateCapturedDecision[]
): ManifestReconcileResult {
  const targetState = reconcileManifestWithDecisions(pomContent, decisions);
  const modernization = reconcileManifestWithModernizationDecisions(
    pomContent,
    modernizationDecisionValues(decisions)
  );
  const seenAddition = new Set(
    targetState.additions.map((a) => `${a.groupId}:${a.artifactId}`)
  );
  const additions = [...targetState.additions];
  for (const a of modernization.additions) {
    const coord = `${a.groupId}:${a.artifactId}`;
    if (seenAddition.has(coord)) continue;
    seenAddition.add(coord);
    additions.push(a);
  }
  return { additions, conflicts: [...targetState.conflicts, ...modernization.conflicts] };
}

// ---------------------------------------------------------------------------
// Apply (minimal textual insert — the rest of the pom byte-identical)
// ---------------------------------------------------------------------------

/**
 * Insert the approved additions into the PROJECT-level `<dependencies>`
 * section, located STRUCTURALLY (a direct child of `<project>`) — never a
 * `<build>/<plugin>` classpath block or `<dependencyManagement>`, regardless
 * of element order. Indentation is sampled from the closing tag's own line
 * when that line is pure whitespace; a shared-line closing tag falls back to
 * a plain four-space indent inserted immediately before the tag (never
 * markup-as-indentation). Returns null when the pom has no project-level
 * `<dependencies>` element.
 */
export function applyAdditionsToPom(
  pomContent: string,
  additions: readonly ProposedAddition[]
): string | null {
  if (additions.length === 0) return pomContent;
  const closeIdx = scanPom(maskComments(pomContent)).projectDependenciesCloseIdx;
  if (closeIdx < 0) return null;

  const lineStart = pomContent.lastIndexOf('\n', closeIdx) + 1;
  const linePrefix = pomContent.slice(lineStart, closeIdx);
  const prefixIsIndent = /^[ \t]*$/.test(linePrefix);
  const closeIndent = prefixIsIndent ? linePrefix : '    ';
  const depIndent = `${closeIndent}    `;
  const inner = `${depIndent}    `;

  const blocks = additions
    .map((a) =>
      [
        `${depIndent}<dependency>`,
        `${inner}<groupId>${a.groupId}</groupId>`,
        `${inner}<artifactId>${a.artifactId}</artifactId>`,
        ...(a.version ? [`${inner}<version>${a.version}</version>`] : []),
        `${inner}<!-- added by decision reconciliation [decision:${a.decisionCode}] -->`,
        `${depIndent}</dependency>`,
      ].join('\n')
    )
    .join('\n');

  if (prefixIsIndent) {
    return pomContent.slice(0, lineStart) + blocks + '\n' + pomContent.slice(lineStart);
  }
  // `</dependencies>` shares its line with earlier markup — insert directly
  // before the tag; every byte outside the insert stays identical.
  return pomContent.slice(0, closeIdx) + '\n' + blocks + '\n' + pomContent.slice(closeIdx);
}
