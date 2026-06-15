/**
 * Java pack finding scanner.
 *
 * Spec: 2026-05-16 Wire Java + Spring Classic + Maven Findings (Task Group 2).
 *
 * Deterministic post-Stage-2 scanner that walks the Java language pack's
 * Stage-1 IR (plus the matching Stage-2 candidates for linking) and emits
 * three new finding types plus three new `evidence_gap` gapTypes:
 *
 *  - `raw_sql_detected` (medium): inline SQL string literals in Java source.
 *    Heuristic: SELECT/INSERT/UPDATE/DELETE keyword inside a quoted string
 *    literal. Aggregated to ONE finding per (file, class, method) site.
 *  - `hardcoded_endpoint_or_url` (medium): `http://` or `https://` string
 *    literals in source. Aggregated per (file, class, method).
 *  - `legacy_java_api_usage` (low/medium): `javax.*` imports, old date/time
 *    API (`java.util.Date`, `java.text.SimpleDateFormat`), `SecurityManager`,
 *    `sun.misc.*`. Aggregated per (file, class, API category).
 *  - `evidence_gap` with `detail_json.gapType` in
 *    `{ 'java_unresolved_return_type', 'java_unresolved_import',
 *       'java_class_no_methods' }`.
 *
 * Source = `java-language-pack`; createdByStage = `deterministic_java_analysis`.
 *
 * The scanner is a single pure pass over the IR. It uses `rawContent` (the
 * verbatim source) for body-level detection because Java IR does not carry
 * method bodies -- only declarations. Detection sites are tied back to
 * (class, method) by walking class/method start lines against the regex match
 * line. Snippets are routed through `snippetRedaction.redactSnippet` -- no
 * per-scanner ad-hoc redaction.
 *
 * Per D7 the scanner enforces `MAX_FINDINGS_PER_TYPE_PER_RUN = 50` for each
 * new finding_type. The `evidence_gap` cap is shared with the predecessor
 * scanner and is NOT capped here (the predecessor scanner already produces
 * at most one per candidate).
 */

import type { DiscoveryCandidate } from '../../../types/candidate';
import type { SourceFileIR, ClassIR, FunctionIR } from '../../extensionPacks';
import type { FindingEmitInput } from '../FindingEmitter';
import type {
  DiscoveryFindingLinkPayload,
} from '../../archModelClient';
import { redactSnippet } from '../../../utils/snippetRedaction';
import { MAX_FINDINGS_PER_TYPE_PER_RUN } from './constants';
import type { PackFindingScannerInput } from './index';

const FINDING_SOURCE = 'java-language-pack';
const CREATED_BY_STAGE = 'deterministic_java_analysis';

const SQL_KEYWORDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;

/**
 * Regex used to find a quoted string literal that contains an SQL keyword.
 * Note: this is a heuristic, not a real SQL parser. We accept some false
 * positives (e.g. a log message saying "Will SELECT now") because the
 * Findings tab review path handles them. We do require a quoted literal so
 * comments and identifiers do not match.
 *
 * Capture group 1: the full quoted literal (with quotes). The SQL keyword
 * must appear inside it, case-insensitive, surrounded by either whitespace
 * or the literal's quote boundary.
 */
const SQL_IN_STRING_REGEX =
  /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;

/**
 * Regex for an http(s) URL inside a string literal. Same shape as
 * SQL_IN_STRING_REGEX: capture the literal body, then check for the URL
 * prefix on the body in the consumer.
 */
const URL_IN_STRING_REGEX = SQL_IN_STRING_REGEX;

// Legacy-API category classification. Each entry's `match` is a predicate over
// import paths; `concern` is the migration concern surfaced on the finding.
const LEGACY_API_CATEGORIES: Array<{
  category: string;
  concern: string;
  severity: 'low' | 'medium';
  match: (importPath: string) => boolean;
}> = [
  {
    category: 'javax_namespace',
    concern: 'Migrate javax.* to jakarta.* (Spring 6 / Jakarta EE 9+)',
    severity: 'medium',
    match: (p) => p.startsWith('javax.'),
  },
  {
    category: 'old_date_time_api',
    concern: 'Migrate java.util.Date / SimpleDateFormat to java.time.*',
    severity: 'low',
    match: (p) =>
      p === 'java.util.Date' ||
      p === 'java.util.Calendar' ||
      p === 'java.text.SimpleDateFormat',
  },
  {
    category: 'security_manager',
    concern: 'SecurityManager is deprecated for removal (JEP 411)',
    severity: 'medium',
    match: (p) => p === 'java.lang.SecurityManager',
  },
  {
    category: 'sun_internal_api',
    concern: 'sun.* internal APIs are not supported on modern JDKs',
    severity: 'medium',
    match: (p) => p.startsWith('sun.'),
  },
];

/**
 * Per-type cap helper. Returns true while the current count is under the cap.
 */
function underCap(counts: Map<string, number>, findingType: string): boolean {
  const cur = counts.get(findingType) ?? 0;
  return cur < MAX_FINDINGS_PER_TYPE_PER_RUN;
}

function bumpCap(counts: Map<string, number>, findingType: string): void {
  counts.set(findingType, (counts.get(findingType) ?? 0) + 1);
}

/**
 * Identify which class + method contains the given line. Java IR carries
 * `line` (start) but not end line, so we approximate: the containing class
 * is the latest one whose `line <= target`; the containing method is the
 * latest one inside that class whose `line <= target`. Returns nulls when
 * no class/method covers the line (top-of-file imports, package decl).
 */
function findEnclosingClassAndMethod(
  ir: SourceFileIR,
  targetLine: number,
): { cls: ClassIR | null; method: FunctionIR | null } {
  let bestCls: ClassIR | null = null;
  for (const c of ir.classes) {
    if (c.line <= targetLine && (bestCls === null || c.line > bestCls.line)) {
      bestCls = c;
    }
  }
  let bestMethod: FunctionIR | null = null;
  if (bestCls) {
    for (const m of bestCls.methods) {
      if (m.line <= targetLine && (bestMethod === null || m.line > bestMethod.line)) {
        bestMethod = m;
      }
    }
  }
  return { cls: bestCls, method: bestMethod };
}

/**
 * Map a character offset in `rawContent` to a 0-based line number.
 */
function offsetToLine(rawContent: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < rawContent.length; i++) {
    if (rawContent[i] === '\n') line++;
  }
  return line;
}

/**
 * Find candidate ids whose `sourceClusterIds` contains the given file path.
 * Used to populate `relatedCandidateIds` on emitted findings.
 */
function candidateIdsForFile(
  candidates: DiscoveryCandidate[],
  filePath: string,
): string[] {
  const out: string[] = [];
  for (const c of candidates) {
    if (Array.isArray(c.sourceClusterIds) && c.sourceClusterIds.includes(filePath)) {
      out.push(c.id);
    }
  }
  return out;
}

function buildLinks(candidateIds: string[]): DiscoveryFindingLinkPayload[] {
  return candidateIds.map((id) => ({
    linkType: 'supports',
    targetType: 'discovery_candidate',
    targetId: id,
  }));
}

/**
 * Build a `raw_sql_detected` finding.
 */
function buildRawSqlFinding(args: {
  filePath: string;
  packageName: string | null;
  className: string | null;
  methodName: string | null;
  sourceLine: number;
  queryType: string;
  rawSnippet: string;
  relatedCandidateIds: string[];
}): FindingEmitInput {
  const evidenceSnippet = redactSnippet(args.rawSnippet);
  return {
    findingType: 'raw_sql_detected',
    category: 'migration_risk',
    severity: 'medium',
    title:
      `Raw SQL detected: ${args.className ?? '(file)'}` +
      (args.methodName ? `#${args.methodName}` : ''),
    summary:
      `Inline ${args.queryType} statement found in ${args.filePath}` +
      (args.methodName ? ` (${args.className}#${args.methodName})` : ''),
    detailJson: {
      filePath: args.filePath,
      packageName: args.packageName,
      className: args.className,
      methodName: args.methodName,
      sourceLineStart: args.sourceLine,
      sourceLineEnd: args.sourceLine,
      detectedPattern: 'inline_jdbc_sql',
      evidenceSnippet,
      queryType: args.queryType,
      relatedCandidateIds: args.relatedCandidateIds,
      relatedEvidenceIds: [],
      confidence: 0.8,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

/**
 * Build a `hardcoded_endpoint_or_url` finding.
 */
function buildHardcodedUrlFinding(args: {
  filePath: string;
  packageName: string | null;
  className: string | null;
  methodName: string | null;
  sourceLine: number;
  rawSnippet: string;
  relatedCandidateIds: string[];
}): FindingEmitInput {
  const evidenceSnippet = redactSnippet(args.rawSnippet);
  return {
    findingType: 'hardcoded_endpoint_or_url',
    category: 'migration_risk',
    severity: 'medium',
    title:
      `Hardcoded URL: ${args.className ?? '(file)'}` +
      (args.methodName ? `#${args.methodName}` : ''),
    summary:
      `Hardcoded HTTP(S) URL literal found in ${args.filePath}` +
      (args.methodName ? ` (${args.className}#${args.methodName})` : ''),
    detailJson: {
      filePath: args.filePath,
      packageName: args.packageName,
      className: args.className,
      methodName: args.methodName,
      sourceLineStart: args.sourceLine,
      sourceLineEnd: args.sourceLine,
      detectedPattern: 'inline_http_url',
      evidenceSnippet,
      relatedCandidateIds: args.relatedCandidateIds,
      relatedEvidenceIds: [],
      confidence: 0.8,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

/**
 * Build a `legacy_java_api_usage` finding for a (file, class, API category).
 */
function buildLegacyApiFinding(args: {
  filePath: string;
  packageName: string | null;
  className: string | null;
  apiCategory: string;
  migrationConcern: string;
  severity: 'low' | 'medium';
  importPaths: string[];
  relatedCandidateIds: string[];
}): FindingEmitInput {
  const evidenceSnippet = redactSnippet(args.importPaths.join(', '));
  return {
    findingType: 'legacy_java_api_usage',
    category: 'migration_risk',
    severity: args.severity,
    title:
      `Legacy Java API (${args.apiCategory}): ${args.className ?? args.filePath}`,
    summary:
      `Detected legacy API category '${args.apiCategory}' in ${args.filePath}. ` +
      args.migrationConcern,
    detailJson: {
      filePath: args.filePath,
      packageName: args.packageName,
      className: args.className,
      methodName: null,
      detectedPattern: args.apiCategory,
      evidenceSnippet,
      migrationConcern: args.migrationConcern,
      importPaths: args.importPaths,
      relatedCandidateIds: args.relatedCandidateIds,
      relatedEvidenceIds: [],
      confidence: 0.9,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

/**
 * Build an `evidence_gap` finding for a Java-specific gapType.
 */
function buildJavaEvidenceGapFinding(args: {
  filePath: string;
  packageName: string | null;
  className: string | null;
  methodName: string | null;
  gapType:
    | 'java_unresolved_return_type'
    | 'java_unresolved_import'
    | 'java_class_no_methods';
  description: string;
  relatedCandidateIds: string[];
}): FindingEmitInput {
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'low',
    title:
      `Evidence gap (${args.gapType}): ${args.className ?? args.filePath}` +
      (args.methodName ? `#${args.methodName}` : ''),
    summary: args.description,
    detailJson: {
      gapType: args.gapType,
      filePath: args.filePath,
      packageName: args.packageName,
      className: args.className,
      methodName: args.methodName,
      relatedCandidateIds: args.relatedCandidateIds,
      relatedEvidenceIds: [],
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

/**
 * Walk a single file's IR + raw content. Returns the FindingEmitInputs
 * produced for that file. Caller aggregates across files and respects caps.
 */
function scanSingleFile(
  ir: SourceFileIR,
  packCandidates: DiscoveryCandidate[],
  counts: Map<string, number>,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  // Skip non-Java IR (e.g. spring-xml entries the language pack emits).
  if (ir.language !== 'java') return out;

  const relatedCandidateIds = candidateIdsForFile(packCandidates, ir.filePath);
  const raw = typeof ir.rawContent === 'string' ? ir.rawContent : '';

  // ---------------------------------------------------------------------
  // raw_sql_detected + hardcoded_endpoint_or_url: scan string literals.
  // Aggregate ONE finding per (file, class, method) per finding type.
  // ---------------------------------------------------------------------
  const sqlSitesSeen = new Set<string>();
  const urlSitesSeen = new Set<string>();
  if (raw.length > 0) {
    let m: RegExpExecArray | null;
    SQL_IN_STRING_REGEX.lastIndex = 0;
    while ((m = SQL_IN_STRING_REGEX.exec(raw)) !== null) {
      const body = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : '';
      const fullLiteral = m[0];
      const matchOffset = m.index;
      const upper = body.toUpperCase();

      // SQL detection: keyword must appear with non-letter neighbours so we
      // do not catch words like "DELETED" or "SELECTOR".
      const hasSql = SQL_KEYWORDS.some((kw) => {
        const re = new RegExp(`(^|[^A-Z])${kw}([^A-Z]|$)`);
        return re.test(upper);
      });

      if (hasSql) {
        const line = offsetToLine(raw, matchOffset);
        const { cls, method } = findEnclosingClassAndMethod(ir, line);
        const key = `${ir.filePath}::${cls?.name ?? ''}::${method?.name ?? ''}`;
        if (!sqlSitesSeen.has(key) && underCap(counts, 'raw_sql_detected')) {
          sqlSitesSeen.add(key);
          const queryType =
            SQL_KEYWORDS.find((kw) =>
              new RegExp(`(^|[^A-Z])${kw}([^A-Z]|$)`).test(upper),
            ) ?? 'SELECT';
          out.push(
            buildRawSqlFinding({
              filePath: ir.filePath,
              packageName: ir.packageOrNamespace,
              className: cls?.name ?? null,
              methodName: method?.name ?? null,
              sourceLine: line,
              queryType,
              rawSnippet: fullLiteral,
              relatedCandidateIds,
            }),
          );
          bumpCap(counts, 'raw_sql_detected');
        }
      }

      // URL detection: literal body starts with http:// or https://.
      const trimmedBody = body.trim();
      if (
        trimmedBody.startsWith('http://') ||
        trimmedBody.startsWith('https://')
      ) {
        const line = offsetToLine(raw, matchOffset);
        const { cls, method } = findEnclosingClassAndMethod(ir, line);
        const key = `${ir.filePath}::${cls?.name ?? ''}::${method?.name ?? ''}`;
        if (!urlSitesSeen.has(key) && underCap(counts, 'hardcoded_endpoint_or_url')) {
          urlSitesSeen.add(key);
          out.push(
            buildHardcodedUrlFinding({
              filePath: ir.filePath,
              packageName: ir.packageOrNamespace,
              className: cls?.name ?? null,
              methodName: method?.name ?? null,
              sourceLine: line,
              rawSnippet: fullLiteral,
              relatedCandidateIds,
            }),
          );
          bumpCap(counts, 'hardcoded_endpoint_or_url');
        }
      }
    }
  }

  // ---------------------------------------------------------------------
  // legacy_java_api_usage: walk imports and group by (file, class,
  // category). The "class" for an import is the first declared class in
  // the file, since imports are file-level.
  // ---------------------------------------------------------------------
  const fileClassName: string | null = ir.classes[0]?.name ?? null;
  const importsByCategory = new Map<string, { concern: string; severity: 'low' | 'medium'; paths: string[] }>();
  for (const imp of ir.imports) {
    for (const cat of LEGACY_API_CATEGORIES) {
      if (cat.match(imp.path)) {
        const entry = importsByCategory.get(cat.category);
        if (entry) {
          entry.paths.push(imp.path);
        } else {
          importsByCategory.set(cat.category, {
            concern: cat.concern,
            severity: cat.severity,
            paths: [imp.path],
          });
        }
        break; // one category per import is enough
      }
    }
  }
  for (const [category, info] of importsByCategory) {
    if (!underCap(counts, 'legacy_java_api_usage')) break;
    out.push(
      buildLegacyApiFinding({
        filePath: ir.filePath,
        packageName: ir.packageOrNamespace,
        className: fileClassName,
        apiCategory: category,
        migrationConcern: info.concern,
        severity: info.severity,
        importPaths: info.paths,
        relatedCandidateIds,
      }),
    );
    bumpCap(counts, 'legacy_java_api_usage');
  }

  // ---------------------------------------------------------------------
  // evidence_gap (Java): unresolved return type, unresolved import,
  // class-with-no-methods. The per-type cap is NOT applied to evidence_gap
  // because the predecessor scanner already produces at most one finding
  // per candidate and the Java pack adds at most one per
  // (file, class, method) site.
  // ---------------------------------------------------------------------
  for (const cls of ir.classes) {
    // Class with no methods (heuristic: not an interface, has class-level
    // annotations suggesting it should carry methods).
    if (!cls.isInterface && cls.methods.length === 0 && cls.annotations.length > 0) {
      out.push(
        buildJavaEvidenceGapFinding({
          filePath: ir.filePath,
          packageName: ir.packageOrNamespace,
          className: cls.name,
          methodName: null,
          gapType: 'java_class_no_methods',
          description:
            `Class '${cls.name}' carries annotations (${cls.annotations
              .map((a) => '@' + a.name)
              .join(', ')}) but has no methods.`,
          relatedCandidateIds,
        }),
      );
    }
    // Unresolved return type per method.
    for (const m of cls.methods) {
      const rt = (m.returnType ?? '').trim();
      if (rt === '' || rt.includes('?')) {
        out.push(
          buildJavaEvidenceGapFinding({
            filePath: ir.filePath,
            packageName: ir.packageOrNamespace,
            className: cls.name,
            methodName: m.name,
            gapType: 'java_unresolved_return_type',
            description:
              `Method ${cls.name}#${m.name} return type could not be resolved (got '${m.returnType}').`,
            relatedCandidateIds,
          }),
        );
      }
    }
  }
  for (const imp of ir.imports) {
    // An unresolved import looks like one whose names list is empty but the
    // path does not end with `.*` (wildcard imports are intentional).
    if (imp.names.length === 0 && !imp.path.endsWith('.*') && imp.path !== '') {
      out.push(
        buildJavaEvidenceGapFinding({
          filePath: ir.filePath,
          packageName: ir.packageOrNamespace,
          className: fileClassName,
          methodName: null,
          gapType: 'java_unresolved_import',
          description: `Import '${imp.path}' could not be resolved to a named symbol.`,
          relatedCandidateIds,
        }),
      );
    }
  }

  return out;
}

/**
 * Java pack finding scanner entry point. Pure: takes pack inputs, returns
 * FindingEmitInputs. Caller passes the result to `findingEmitter.emitFindings`.
 *
 * Soft-fail: a per-file detection failure is caught and logged so a single
 * malformed IR cannot poison the whole run. The shim in `index.ts` ALSO
 * catches at the scanner boundary -- belt and braces.
 */
export function runJavaFindingScanner(
  input: PackFindingScannerInput,
): FindingEmitInput[] {
  const collected: FindingEmitInput[] = [];
  const counts = new Map<string, number>();
  let softFailFiles = 0;
  for (const [, ir] of input.irFiles) {
    try {
      collected.push(...scanSingleFile(ir, input.packCandidates, counts));
    } catch (err) {
      softFailFiles += 1;
      console.warn(
        `[javaFindingScanner] Failed on file '${ir.filePath}'; continuing:`,
        err instanceof Error ? err.message : String(err),
      );
      // Structured diag: category only, never the file path.
      console.warn(`[diag-pack] scanner=java soft_fail=true category=parse_error`);
    }
  }
  // Cap-hit diag: emit one line per finding_type that reached the cap. No
  // candidate / file detail -- just the type that saturated so the runbook
  // can correlate against the AMS Findings count for that type.
  for (const [type, count] of counts) {
    if (count >= MAX_FINDINGS_PER_TYPE_PER_RUN) {
      console.warn(`[diag-pack] scanner=java cap_hit=true type=${type} at=${count}`);
    }
  }
  if (softFailFiles > 0) {
    console.warn(`[diag-pack] scanner=java soft_fail_files=${softFailFiles}`);
  }
  return collected;
}
