/**
 * XML-defined MVC scanner (Spec 2026-07-06-l — Spring Classic Response
 * Fidelity, Code-Tier Oracle Program).
 *
 * Classic (pre-annotation) Spring MVC wires response-shaping behaviour in
 * bean XML the annotation scanners never see. This module reads the
 * spring-xml IR files' verbatim source (`rawContent`, admitted by the Java
 * language pack) and extracts, deterministically:
 *
 *   1. HANDLER MAPPINGS -> endpoint facts:
 *      - `SimpleUrlHandlerMapping` `mappings` props / `urlMap` entries
 *        (`/path -> beanNameOrRef`)
 *      - `BeanNameUrlHandlerMapping` convention: any bean whose id/name
 *        starts with `/` maps that path to its class.
 *      The HTTP verb is NOT expressed in XML — facts carry
 *      `verb: 'unknown'` (marked, never guessed); the adapter emits them as
 *      `endpoints` candidates with `endpoint_subtype: 'xml-mvc'`.
 *
 *   2. `mvc:interceptors` -> ordered interceptor facts (global + per
 *      `mvc:mapping path=` scoped), attached onto matching endpoints'
 *      `response_contract.interceptors[]` (Ant-path matched).
 *
 *   3. `security:http` `intercept-url` rules -> auth facts. Literal
 *      `hasRole('X')` / `ROLE_X` accesses yield required_roles; anything
 *      else is carried VERBATIM with `resolved: false` (never guessed).
 *
 *   4. `tx:advice` + `aop:config` pointcuts -> TRANSACTIONAL MATCHERS
 *      (`execution(...)` / `within(...)` subset). Applied as a POST-PASS
 *      over the emitted `endpoint_data_effects` candidates: any edge whose
 *      hop matches a pointcut flips `transactional: true` (the resolver only
 *      sees annotations). Unparseable pointcut expressions are surfaced on
 *      the scan result (`unresolvedPointcuts`) — nothing silent.
 *
 * Pure over its inputs; regex-based per the descriptor idiom; never throws
 * on malformed XML (returns what it could parse).
 */

import { v4 as uuidv4 } from 'uuid';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { FindingEmitInput } from '../../../findings/FindingEmitter';

// ---------------------------------------------------------------------------
// Fact shapes
// ---------------------------------------------------------------------------

export interface XmlMvcEndpointFact {
  path: string;
  handler: string;
  mappingKind: 'simple-url-handler-mapping' | 'bean-name-url-handler-mapping';
  sourceFilePath: string;
}

export interface XmlInterceptorFact {
  interceptorClass: string;
  /** Ant path patterns; empty = global (every request). */
  pathPatterns: string[];
  order: number;
  sourceFilePath: string;
}

export interface XmlSecurityRuleFact {
  pattern: string;
  /** The access expression VERBATIM. */
  access: string;
  /** Roles extracted from simple literal expressions; empty when unresolved. */
  requiredRoles: string[];
  resolved: boolean;
  sourceFilePath: string;
}

export interface XmlTransactionalMatcher {
  /** Regex over the fully-qualified class name. */
  classPattern: RegExp;
  /** Regex over the method name. */
  methodPattern: RegExp;
  expression: string;
  sourceFilePath: string;
}

export interface XmlMvcScanResult {
  endpoints: XmlMvcEndpointFact[];
  interceptors: XmlInterceptorFact[];
  securityRules: XmlSecurityRuleFact[];
  txMatchers: XmlTransactionalMatcher[];
  unresolvedPointcuts: Array<{ expression: string; sourceFilePath: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NS = '(?:[A-Za-z][A-Za-z0-9_-]*:)?';

function blocks(xml: string, localName: string): string[] {
  const re = new RegExp(
    `<\\s*${NS}${localName}\\b[^>]*>([\\s\\S]*?)<\\s*/\\s*${NS}${localName}\\s*>`,
    'gi'
  );
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[0]);
  return out;
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1] : null;
}

/** Ant-style matching: `**` any segments, `*` one segment chunk, `?` one char. */
export function antPatternMatches(pattern: string, path: string): boolean {
  if (!pattern) return false;
  const cleaned = path.split('?')[0];
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '§§')
    .replace(/\*/g, '[^/]*')
    .replace(/§§/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${regex}$`).test(cleaned);
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

export function scanXmlMvc(files: SourceFileIR[]): XmlMvcScanResult {
  const result: XmlMvcScanResult = {
    endpoints: [],
    interceptors: [],
    securityRules: [],
    txMatchers: [],
    unresolvedPointcuts: [],
  };

  const xmlFiles = files.filter(
    (f) => f.language === 'spring-xml' && typeof f.rawContent === 'string'
  );

  for (const file of xmlFiles) {
    const xml = file.rawContent as string;

    // ----- 1a. SimpleUrlHandlerMapping -----
    const beanRe = new RegExp(`<\\s*${NS}bean\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${NS}bean\\s*>|<\\s*${NS}bean\\b[^>]*/>`, 'gi');
    let beanMatch: RegExpExecArray | null;
    while ((beanMatch = beanRe.exec(xml)) !== null) {
      const bean = beanMatch[0];
      const openTag = bean.slice(0, bean.indexOf('>') + 1);
      const klass = attr(openTag, 'class') ?? '';
      const id = attr(openTag, 'id') ?? attr(openTag, 'name') ?? '';

      if (/SimpleUrlHandlerMapping$/.test(klass)) {
        // <prop key="/x.do">beanName</prop>
        const propRe = new RegExp(
          `<\\s*${NS}prop\\s+key\\s*=\\s*"([^"]+)"\\s*>([\\s\\S]*?)<\\s*/\\s*${NS}prop\\s*>`,
          'gi'
        );
        let m: RegExpExecArray | null;
        while ((m = propRe.exec(bean)) !== null) {
          result.endpoints.push({
            path: m[1].trim(),
            handler: m[2].trim(),
            mappingKind: 'simple-url-handler-mapping',
            sourceFilePath: file.filePath,
          });
        }
        // <entry key="/x" value-ref="bean"/> (urlMap form)
        const entryRe = new RegExp(`<\\s*${NS}entry\\b[^>]*/?>`, 'gi');
        while ((m = entryRe.exec(bean)) !== null) {
          const key = attr(m[0], 'key');
          const ref = attr(m[0], 'value-ref') ?? attr(m[0], 'value');
          if (key && ref && key.startsWith('/')) {
            result.endpoints.push({
              path: key,
              handler: ref,
              mappingKind: 'simple-url-handler-mapping',
              sourceFilePath: file.filePath,
            });
          }
        }
        // <value>/x.do=beanName</value> newline list form
        for (const valueBlock of blocks(bean, 'value')) {
          const inner = valueBlock.replace(/^<[^>]*>/, '').replace(/<[^>]*>$/, '');
          for (const line of inner.split(/\r?\n/)) {
            const pair = /^\s*(\/\S+)\s*=\s*(\S+)\s*$/.exec(line);
            if (pair) {
              result.endpoints.push({
                path: pair[1],
                handler: pair[2],
                mappingKind: 'simple-url-handler-mapping',
                sourceFilePath: file.filePath,
              });
            }
          }
        }
      }

      // ----- 1b. BeanNameUrlHandlerMapping convention: bean name is a path -----
      if (id.startsWith('/') && klass) {
        result.endpoints.push({
          path: id,
          handler: klass,
          mappingKind: 'bean-name-url-handler-mapping',
          sourceFilePath: file.filePath,
        });
      }
    }

    // ----- 2. mvc:interceptors (DOCUMENT order = registration order) -----
    let order = 0;
    for (const group of blocks(xml, 'interceptors')) {
      // Walk children in document order: either a scoped <interceptor> block
      // or a bare global <bean>. Bare beans INSIDE a scoped block are claimed
      // by the block (range-tracked), never double-counted as global.
      const scopedRe = new RegExp(
        `<\\s*${NS}interceptor\\b[\\s\\S]*?<\\s*/\\s*${NS}interceptor\\s*>`,
        'gi'
      );
      const scopedRanges: Array<{ start: number; end: number; body: string }> = [];
      let sm: RegExpExecArray | null;
      while ((sm = scopedRe.exec(group)) !== null) {
        scopedRanges.push({ start: sm.index, end: sm.index + sm[0].length, body: sm[0] });
      }
      const childRe = new RegExp(
        `<\\s*${NS}interceptor\\b[\\s\\S]*?<\\s*/\\s*${NS}interceptor\\s*>|<\\s*${NS}bean\\b[^>]*>`,
        'gi'
      );
      let child: RegExpExecArray | null;
      while ((child = childRe.exec(group)) !== null) {
        const at = child.index;
        const insideScoped = scopedRanges.some((r) => at > r.start && at < r.end);
        if (/^(<\s*(?:[A-Za-z][A-Za-z0-9_-]*:)?interceptor)/i.test(child[0])) {
          const scoped = child[0];
          const patterns: string[] = [];
          const mappingRe = new RegExp(`<\\s*${NS}mapping\\b[^>]*/?>`, 'gi');
          let m: RegExpExecArray | null;
          while ((m = mappingRe.exec(scoped)) !== null) {
            const p = attr(m[0], 'path');
            if (p) patterns.push(p);
          }
          const beanTag = new RegExp(`<\\s*${NS}bean\\b[^>]*>`, 'i').exec(scoped);
          const klass = beanTag ? attr(beanTag[0], 'class') : null;
          if (klass) {
            result.interceptors.push({
              interceptorClass: klass,
              pathPatterns: patterns,
              order: order++,
              sourceFilePath: file.filePath,
            });
          }
        } else if (!insideScoped) {
          const klass = attr(child[0], 'class');
          if (klass) {
            result.interceptors.push({
              interceptorClass: klass,
              pathPatterns: [],
              order: order++,
              sourceFilePath: file.filePath,
            });
          }
        }
      }
    }

    // ----- 3. security intercept-url -----
    const interceptUrlRe = new RegExp(`<\\s*${NS}intercept-url\\b[^>]*/?>`, 'gi');
    let s: RegExpExecArray | null;
    while ((s = interceptUrlRe.exec(xml)) !== null) {
      const pattern = attr(s[0], 'pattern');
      const access = attr(s[0], 'access');
      if (!pattern || !access) continue;
      const roles: string[] = [];
      const roleRe = /hasRole\(\s*'([^']+)'\s*\)|hasAuthority\(\s*'([^']+)'\s*\)|\b(ROLE_[A-Z0-9_]+)\b/g;
      let r: RegExpExecArray | null;
      let rest = access;
      while ((r = roleRe.exec(access)) !== null) {
        roles.push(r[1] ?? r[2] ?? r[3]);
        rest = rest.replace(r[0], '');
      }
      const leftovers = rest
        .replace(/\b(and|or)\b/gi, '')
        .replace(/[(),\s]/g, '')
        .trim();
      const resolved = roles.length > 0 && leftovers.length === 0;
      result.securityRules.push({
        pattern,
        access,
        requiredRoles: resolved ? roles : [],
        resolved,
        sourceFilePath: file.filePath,
      });
    }

    // ----- 4. tx:advice + aop pointcuts -----
    const hasTxAdvice = new RegExp(`<\\s*tx:advice\\b`, 'i').test(xml);
    const pointcutRe = new RegExp(`<\\s*${NS}pointcut\\b[^>]*/?>|<\\s*${NS}advisor\\b[^>]*/?>`, 'gi');
    let p: RegExpExecArray | null;
    while ((p = pointcutRe.exec(xml)) !== null) {
      const expression = attr(p[0], 'expression') ?? attr(p[0], 'pointcut');
      if (!expression) continue;
      if (!hasTxAdvice && !/advisor/i.test(p[0])) continue;
      const matcher = parsePointcutExpression(expression, file.filePath);
      if (matcher) result.txMatchers.push(matcher);
      else result.unresolvedPointcuts.push({ expression, sourceFilePath: file.filePath });
    }
  }

  return result;
}

/**
 * Parse the supported pointcut subset:
 *   execution(* com.x.service..*.*(..))   -> class com.x.service..* / any method
 *   execution(* com.x.Svc.save*(..))      -> class com.x.Svc / methods save*
 *   within(com.x..*)                       -> class com.x..*   / any method
 * Anything else -> null (caller records it unresolved).
 */
export function parsePointcutExpression(
  expression: string,
  sourceFilePath: string
): XmlTransactionalMatcher | null {
  const toRegex = (glob: string): RegExp => {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\.\\\./g, '§DOTS§')
      .replace(/\*/g, '[^.]*')
      .replace(/§DOTS§/g, '(?:\\..*)?');
    return new RegExp(`^${escaped}$`);
  };

  const executionMatch = /^execution\(\s*\S+\s+([\w.*]+)\.([\w*]+)\s*\(\s*\.\.\s*\)\s*\)$/.exec(
    expression.trim()
  );
  if (executionMatch) {
    return {
      classPattern: toRegex(executionMatch[1]),
      methodPattern: toRegex(executionMatch[2]),
      expression,
      sourceFilePath,
    };
  }
  const withinMatch = /^within\(\s*([\w.*]+)\s*\)$/.exec(expression.trim());
  if (withinMatch) {
    return {
      classPattern: toRegex(withinMatch[1]),
      methodPattern: /^.*$/,
      expression,
      sourceFilePath,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Attach passes
// ---------------------------------------------------------------------------

interface EndpointData {
  fullPath?: string;
  path?: string;
  response_contract?: Record<string, unknown>;
  [key: string]: unknown;
}

function endpointPathOf(candidate: DiscoveryCandidate): string | null {
  const data = (candidate.data ?? {}) as EndpointData;
  const path = data.fullPath ?? data.path;
  if (typeof path === 'string' && path.startsWith('/')) return path.split('?')[0];
  const m = /^[A-Z]+\s+(\/\S*)/.exec(candidate.name ?? '');
  return m ? m[1] : null;
}

function contractOf(data: EndpointData): Record<string, unknown> {
  if (!data.response_contract || typeof data.response_contract !== 'object') {
    data.response_contract = { schema_version: 'response_contract.v1', confidence: 0.9 };
  }
  return data.response_contract as Record<string, unknown>;
}

/**
 * Attach interceptors (ordered, Ant-matched; global interceptors match every
 * endpoint) and security rules (first matching rule wins, Spring semantics)
 * onto `endpoints` candidates. Returns the touched count.
 */
export function attachXmlMvcFacts(
  candidates: DiscoveryCandidate[],
  scan: XmlMvcScanResult
): number {
  if (scan.interceptors.length === 0 && scan.securityRules.length === 0) return 0;
  let touched = 0;
  for (const candidate of candidates) {
    if (candidate.candidateType !== 'endpoints') continue;
    const path = endpointPathOf(candidate);
    if (!path) continue;
    const data = (candidate.data ?? (candidate.data = {})) as EndpointData;

    const matched = scan.interceptors
      .filter((i) => i.pathPatterns.length === 0 || i.pathPatterns.some((p) => antPatternMatches(p, path)))
      .sort((a, b) => a.order - b.order)
      .map((i) => ({
        class: i.interceptorClass,
        order: i.order,
        path_patterns: i.pathPatterns,
        source: 'mvc-xml-interceptor',
      }));

    const rule = scan.securityRules.find((r) => antPatternMatches(r.pattern, path)) ?? null;

    if (matched.length === 0 && rule === null) continue;
    const contract = contractOf(data);
    if (matched.length > 0) contract.interceptors = matched;
    if (rule !== null && contract.auth === undefined) {
      contract.auth = rule.resolved
        ? {
            required_roles: rule.requiredRoles,
            source: 'security-xml',
            rule_pattern: rule.pattern,
          }
        : {
            source: 'unresolved',
            expression: rule.access,
            rule_pattern: rule.pattern,
          };
    }
    touched++;
  }
  return touched;
}

/**
 * Mint `endpoints` candidates for the XML-mapped handlers. XML mappings carry
 * NO HTTP verb — the candidate defaults to GET (the same default the
 * annotation scanners apply to a bare `@RequestMapping`) and records the
 * inference VISIBLY (`verb_inference` on data; `endpoint_subtype: 'xml-mvc'`).
 * Local makeCandidate copy per the adapter-module convention.
 */
export function buildXmlMvcEndpointCandidates(
  scan: XmlMvcScanResult,
  runId: string
): DiscoveryCandidate[] {
  const out: DiscoveryCandidate[] = [];
  const seen = new Set<string>();
  for (const fact of scan.endpoints) {
    const name = `GET ${fact.path}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const candidate: DiscoveryCandidate = {
      id: uuidv4(),
      runId,
      candidateType: 'endpoints',
      name,
      confidence: 0.85,
      status: 'proposed',
      sourceClusterIds: [fact.sourceFilePath],
      data: {
        httpMethod: 'GET',
        fullPath: fact.path,
        handlerBean: fact.handler,
        endpoint_subtype: 'xml-mvc',
        mapping_kind: fact.mappingKind,
        verb_inference: 'default-get (xml handler mapping carries no verb)',
        _addedBy: 'spring-classic-adapter',
      },
      synthesizedAt: new Date().toISOString(),
    };
    out.push(candidate);
  }
  return out;
}

/**
 * Findings (run-it-twice pattern; consumed by springClassicFindingScanner):
 * unresolved tx pointcuts + unresolved security accesses — nothing silent.
 */
export function buildXmlMvcFindings(scan: XmlMvcScanResult): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  for (const pc of scan.unresolvedPointcuts) {
    out.push({
      findingType: 'tx_pointcut_unresolved',
      category: 'evidence_gap',
      severity: 'medium',
      title: 'Unparsed XML transaction pointcut',
      summary:
        `An aop/tx pointcut expression could not be parsed into a class/method matcher, so ` +
        `the transactional boundary it declares is NOT reflected on the data-effect edges: ` +
        `\`${pc.expression}\`. Review it manually — transaction scope shapes response ` +
        `behaviour under failure.`,
      detailJson: { expression: pc.expression, filePath: pc.sourceFilePath },
    });
  }
  for (const rule of scan.securityRules.filter((r) => !r.resolved)) {
    out.push({
      findingType: 'endpoint_auth_unresolved',
      category: 'security',
      severity: 'medium',
      title: `Unresolved security-XML access rule: ${rule.pattern}`,
      summary:
        `intercept-url pattern '${rule.pattern}' carries an access expression that is not a ` +
        `simple literal role check: \`${rule.access}\`. The rule is attached with ` +
        `auth.source='unresolved' (no role was guessed).`,
      detailJson: {
        pattern: rule.pattern,
        access: rule.access,
        authSource: 'unresolved',
        filePath: rule.sourceFilePath,
      },
    });
  }
  return out;
}

/**
 * POST-PASS: flip `transactional: true` on `endpoint_data_effects` candidates
 * whose hop path matches an XML tx pointcut (the resolver derives the flag
 * from ANNOTATIONS only). Mutates both the top-level `transactional` field
 * and the `path_metadata_json.transactional` copy. Returns the flipped count.
 */
export function applyXmlTransactionalMatchers(
  candidates: DiscoveryCandidate[],
  matchers: XmlTransactionalMatcher[]
): number {
  if (matchers.length === 0) return 0;
  let flipped = 0;
  for (const candidate of candidates) {
    if (candidate.candidateType !== 'endpoint_data_effects') continue;
    const data = (candidate.data ?? {}) as {
      transactional?: boolean;
      path_metadata_json?: { transactional?: boolean; path?: Array<{ className?: string; methodName?: string }> };
    };
    if (data.transactional === true) continue;
    const hops = data.path_metadata_json?.path ?? [];
    const hit = hops.some((hop) =>
      matchers.some(
        (m) =>
          typeof hop.className === 'string' &&
          m.classPattern.test(hop.className) &&
          typeof hop.methodName === 'string' &&
          m.methodPattern.test(hop.methodName)
      )
    );
    if (!hit) continue;
    data.transactional = true;
    if (data.path_metadata_json) data.path_metadata_json.transactional = true;
    flipped++;
  }
  return flipped;
}
