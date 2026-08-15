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
