/**
 * MyBatis / iBatis XML mapper capture (Spec 2026-07-06-m — Spring Classic
 * Internal Functionality, Code-Tier Oracle Program).
 *
 * Classic estates keep the bulk of their SQL in mapper XML files the
 * annotation-driven capture never reads (only `@Select`-style annotations
 * were captured before). This module parses `<mapper namespace="...">`
 * documents (admitted to the IR with `rawContent` by the Java language pack)
 * into a statement index:
 *
 *   (namespace simple-name, statement id) -> { sqlText VERBATIM, kind,
 *                                              dynamic, resultRef }
 *
 * and applies it as a POST-PASS over the emitted `endpoint_data_effects`
 * candidates (the same additive idiom as the XML tx-pointcut flip): any edge
 * whose repository hop's class matches a mapper namespace and whose hop
 * method matches a statement id, and which carries NO captured query yet,
 * gains `query_text` (verbatim) + `query_kind: 'mybatis_xml'`. Statements
 * containing dynamic tags (`<if>`, `<choose>`, `<foreach>`, `<where>`,
 * `<set>`, `<trim>`, `<bind>`) are carried verbatim AND flagged
 * `dynamic_sql: true` — the composed SQL is runtime-dependent and is NEVER
 * synthesised (fail-closed honesty).
 */

import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';

const NS = '(?:[A-Za-z][A-Za-z0-9_-]*:)?';
const STATEMENT_TAGS = ['select', 'insert', 'update', 'delete'] as const;
const DYNAMIC_TAG_RE = /<\s*(if|choose|when|otherwise|foreach|where|set|trim|bind)\b/i;

export interface MyBatisStatement {
  namespace: string;
  /** Simple (last-segment) namespace name — matches the mapper interface. */
  namespaceSimpleName: string;
  id: string;
  kind: (typeof STATEMENT_TAGS)[number];
  /** The statement body VERBATIM (dynamic tags included, never composed). */
  sqlText: string;
  dynamic: boolean;
  parameterType: string | null;
  resultRef: string | null;
  sourceFilePath: string;
}

export interface MyBatisXmlScan {
  statements: MyBatisStatement[];
}

export function scanMyBatisXmlMappers(files: SourceFileIR[]): MyBatisXmlScan {
  const statements: MyBatisStatement[] = [];
  const mapperFiles = files.filter(
    (f) => f.language === 'mybatis-xml' && typeof f.rawContent === 'string'
  );

  for (const file of mapperFiles) {
    const xml = file.rawContent as string;
    const nsMatch = new RegExp(`<\\s*mapper\\b[^>]*\\bnamespace\\s*=\\s*"([^"]+)"`, 'i').exec(xml);
    if (!nsMatch) continue;
    const namespace = nsMatch[1];
    const namespaceSimpleName = namespace.split('.').pop() ?? namespace;

    for (const tag of STATEMENT_TAGS) {
      const re = new RegExp(
        `<\\s*${NS}${tag}\\b([^>]*)>([\\s\\S]*?)<\\s*/\\s*${NS}${tag}\\s*>`,
        'gi'
      );
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const attrs = m[1];
        const body = m[2];
        const id = /\bid\s*=\s*"([^"]+)"/.exec(attrs)?.[1];
        if (!id) continue;
        statements.push({
          namespace,
          namespaceSimpleName,
          id,
          kind: tag,
          sqlText: body.trim(),
          dynamic: DYNAMIC_TAG_RE.test(body),
          parameterType: /\bparameterType\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ?? null,
          resultRef:
            /\bresultMap\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ??
            /\bresultType\s*=\s*"([^"]+)"/.exec(attrs)?.[1] ??
            null,
          sourceFilePath: file.filePath,
        });
      }
    }
  }

  return { statements };
}

/**
 * POST-PASS: enrich `endpoint_data_effects` candidates whose repository hop
 * matches a mapper statement and which carry NO query yet. Returns the
 * enriched-edge count. Never overwrites an existing `query_text` (annotation
 * capture wins — it is the closer evidence).
 */
export function applyMyBatisXmlQueries(
  candidates: DiscoveryCandidate[],
  scan: MyBatisXmlScan
): number {
  if (scan.statements.length === 0) return 0;
  const byKey = new Map<string, MyBatisStatement>();
  for (const statement of scan.statements) {
    byKey.set(`${statement.namespaceSimpleName}#${statement.id}`, statement);
  }

  let enriched = 0;
  for (const candidate of candidates) {
    if (candidate.candidateType !== 'endpoint_data_effects') continue;
    const data = candidate.data as {
      path_metadata_json?: {
        query_text?: string;
        query_kind?: string;
        dynamic_sql?: boolean;
        path?: Array<{ className?: string; methodName?: string; role?: string }>;
      };
    };
    const meta = data.path_metadata_json;
    if (!meta || typeof meta.query_text === 'string') continue;
    const repoHop = (meta.path ?? []).find((h) => h.role === 'repository');
    if (!repoHop?.className || !repoHop.methodName) continue;
    const statement = byKey.get(`${repoHop.className}#${repoHop.methodName}`);
    if (!statement) continue;
    meta.query_text = statement.sqlText;
    meta.query_kind = 'mybatis_xml';
    if (statement.dynamic) meta.dynamic_sql = true;
    enriched++;
  }
  return enriched;
}
