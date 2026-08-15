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

/** All `<dependency>` entries anywhere in the pom (deps + dependencyManagement
 * both count as "present" — a managed entry still satisfies the requirement). */
export function parsePomDependencies(content: string): PomDependency[] {
  const out: PomDependency[] = [];
  const blockRe = /<dependency>([\s\S]*?)<\/dependency>/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(content)) !== null) {
    const block = m[1];
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
 * Insert the approved additions into the PROJECT `<dependencies>` section
 * (the first `</dependencies>` AFTER `</dependencyManagement>` when one
 * exists, else the first `</dependencies>`). Indentation is sampled from the
 * closing tag's own line. Returns null when no insertion point exists.
 */
export function applyAdditionsToPom(
  pomContent: string,
  additions: readonly ProposedAddition[]
): string | null {
  if (additions.length === 0) return pomContent;
  const mgmtEnd = pomContent.indexOf('</dependencyManagement>');
  const searchFrom = mgmtEnd >= 0 ? mgmtEnd + '</dependencyManagement>'.length : 0;
  const closeIdx = pomContent.indexOf('</dependencies>', searchFrom);
  if (closeIdx < 0) return null;

  // Sample the closing tag's leading whitespace for faithful indentation.
  const lineStart = pomContent.lastIndexOf('\n', closeIdx) + 1;
  const closeIndent = pomContent.slice(lineStart, closeIdx);
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

  return pomContent.slice(0, lineStart) + blocks + '\n' + pomContent.slice(lineStart);
}
