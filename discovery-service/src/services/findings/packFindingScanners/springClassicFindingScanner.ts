/**
 * Spring Classic pack finding scanner.
 *
 * Spec: 2026-05-16 Wire Java + Spring Classic + Maven Findings (Task Group 3).
 *
 * Deterministic post-Stage-2 scanner that walks the Java language pack's
 * Stage-1 IR (which already carries the Spring beans-XML parse output via
 * `SourceFileIR.springXmlBeans` plus the verbatim `rawContent` for `.java`
 * files) and emits six new Spring-classic finding types plus two new
 * `evidence_gap` gapTypes:
 *
 *  - `spring_xml_bean_wiring` (medium): an applicationContext.xml /
 *    `*-context.xml` / beans.xml file with `<bean>` definitions. One
 *    finding per XML config file. Reads `springBeansXmlParser` output
 *    via `ir.springXmlBeans` (read-only consumer; that parser is not
 *    edited).
 *  - `legacy_transaction_configuration` (medium): XML transaction manager,
 *    `tx:advice`, `aop:config` for transactions, OR any `@Transactional`
 *    annotation in Java IR. One finding per (config source or class).
 *  - `security_filter_or_interceptor_detected` (medium / security): Spring
 *    Security XML namespace, classes that extend `Filter` /
 *    `OncePerRequestFilter`, classes that implement `HandlerInterceptor`,
 *    or class names matching the well-known auth-filter pattern.
 *  - `scheduled_or_batch_job_detected` (medium): `@Scheduled` annotations,
 *    Quartz / Spring Batch namespaces in XML, or `org.quartz.*` imports.
 *  - `stored_procedure_or_jdbc_usage` (high): `SimpleJdbcCall`,
 *    `StoredProcedure`, `CallableStatement`, `jdbcTemplate.call(`, or
 *    procedure-like SQL keywords (`EXEC`, `CALL`).
 *  - `spring_classic_migration_risk` (medium): the presence of `web.xml`
 *    (filename only -- no servlet-mapping extraction per spec out-of-scope),
 *    `ContextLoaderListener` references, or `DispatcherServlet` references.
 *
 * Evidence-gap extension (D1):
 *  - `endpoint_missing_request_schema`: a `@RequestMapping` / `@PostMapping`
 *    / `@PutMapping` / `@PatchMapping` controller endpoint where the
 *    `@RequestBody` parameter is absent on a write verb.
 *  - `endpoint_partial_path_variables`: a controller endpoint whose path
 *    template carries `{x}` placeholders but the method declares fewer
 *    `@PathVariable` parameters than the placeholder count.
 *    (`endpoint_missing_response_schema` is owned by the predecessor
 *    scanner; we do NOT re-emit it here.)
 *
 * Source = `spring-classic-framework-pack`;
 * createdByStage = `deterministic_spring_classic_analysis`.
 *
 * Snippets are routed through `snippetRedaction.redactSnippet` -- no
 * per-scanner ad-hoc redaction. Per D7 the scanner enforces
 * `MAX_FINDINGS_PER_TYPE_PER_RUN = 50` for each new finding_type.
 *
 * Soft-fail: a per-file detection failure is caught and logged so a
 * single malformed IR cannot poison the whole run. The shim in
 * `index.ts` ALSO catches at the scanner boundary -- belt and braces.
 *
 * SOAP peer pass (Spec 2026-05-17 SOAP Discovery, Task Group 5):
 *  - `runSpringClassicSoapPass` is invoked from `runSpringClassicScannerWithSoap`
 *    as a peer to the existing REST emit path. The SOAP pass produces
 *    `interfaces` / `endpoints` discovery candidates with `interface_type='SOAP_API'`
 *    and the seven `data` fields documented in
 *    `springClassicSoap/soapEndpointEmitter.ts`. REST scanning behaviour is
 *    unchanged for projects with no SOAP signals.
 *
 * REST WADL peer pass (Spec 2026-05-21 WADL Deterministic Parser, Task Group 5):
 *  - `runRestWadlPass` is invoked from `runSpringClassicScannerWithSoap` as a
 *    second peer pass alongside the SOAP pass. The WADL pass scans `.wadl`
 *    IR entries, resolves sibling `.xsd` files for `<grammars><include>`
 *    refs, and emits `interface_definition` + `endpoint` findings plus
 *    `wadl_*` evidence-gap findings. All output flows through the existing
 *    `FindingEmitter` (spec Q7 -- no parallel candidate pipeline). REST and
 *    SOAP scanning behaviour are unchanged for projects with no WADL signals.
 */

import type { DiscoveryCandidate } from '../../../types/candidate';
import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
  AnnotationIR,
} from '../../extensionPacks';
import type { FindingEmitInput } from '../FindingEmitter';
import type {
  DiscoveryFindingLinkPayload,
} from '../../archModelClient';
import type {
  SpringBeansXmlResult,
} from '../../extensionPacks/languageExtractors/java/springBeansXmlParser';
import { redactSnippet } from '../../../utils/snippetRedaction';
import { MAX_FINDINGS_PER_TYPE_PER_RUN } from './constants';
import type { PackFindingScannerInput } from './index';
import {
  runSpringClassicSoapPass,
  type SpringClassicSoapPassOutput,
} from './springClassicSoap';
import { runRestWadlPass } from './restWadl';
// Spec #4 (Inbound Surface Completeness), Task Group 3: the shared pure
// web.xml <servlet-mapping> parser. The finding scanner SUMMARISES the parsed
// mappings on its existing web_xml_present finding; the spring-classic adapter
// (inboundSurfaceDetectors.ts) consumes the SAME parser to emit servlet
// endpoint candidates (one candidate-emission path — NO candidate minting
// inside the finding scanner).
import { parseWebXmlServletMappings } from './webXmlServletParser';
import {
  resolveEndpointDataEffects,
  type UnresolvedDataEffect,
} from '../../extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver';
// Outbound Integration Graph (Spec #5, Task Group 3): the external-dependency
// Finding emit over the SAME `outboundIntegrationResolver` output the adapter
// uses for `data_movements` candidates (the "run it twice, cheap, keeps
// candidate vs finding emission separate" pattern). ADDITIVE -- this scanner is
// NOT refactored; the new pass is a peer of `scanEndpointDataEffects`.
import { buildOutboundIntegrationFindings } from '../../extensionPacks/frameworkAdapters/springClassic/outboundIntegrationCandidates';
import {
  scanResponseContracts,
  buildResponseContractFindings,
} from '../../extensionPacks/frameworkAdapters/springClassic/responseContractScanner';
// Detect-or-flag custom (de)serializers (Spec 2026-06-22 code-evidence format
// extraction, Task Group 3 / follow-up wiring): the pure detector finds
// @JsonSerialize / @JsonDeserialize(using=Class) DTO fields whose wire format
// is hidden in a separate class; the builder emits the matching evidence_gap
// Finding. Wired here as a cross-file pass (peer of the response-contract /
// outbound-integration passes) -- the detector had no production caller before.
import { detectCustomSerializerFields } from '../../extensionPacks/frameworkAdapters/springClassic/requestContractScanner';
import { buildRequestFormatUnresolvedFinding } from '../emissionSources';

const FINDING_SOURCE = 'spring-classic-framework-pack';
const CREATED_BY_STAGE = 'deterministic_spring_classic_analysis';

// ----------------------------------------------------------------------------
// Constant sets used during detection
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

const REQUEST_BODY_ANNOTATION_NAMES: ReadonlySet<string> = new Set([
  'RequestBody',
  'RequestPart',
  'ModelAttribute',
]);

const JDBC_PROC_SIGNALS = [
  'SimpleJdbcCall',
  'StoredProcedure',
  'CallableStatement',
  'jdbcTemplate.call(',
  'jdbcTemplate.execute(',
] as const;

const SQL_PROC_KEYWORD_REGEX = /\b(EXEC|CALL)\s+[A-Za-z_][A-Za-z0-9_]*/i;

const SCHEDULE_IMPORT_PREFIXES = [
  'org.quartz.',
  'org.springframework.batch.',
  'org.springframework.scheduling.',
];

// ----------------------------------------------------------------------------
// Cap helpers
// ----------------------------------------------------------------------------

function underCap(counts: Map<string, number>, findingType: string): boolean {
  const cur = counts.get(findingType) ?? 0;
  return cur < MAX_FINDINGS_PER_TYPE_PER_RUN;
}

function bumpCap(counts: Map<string, number>, findingType: string): void {
  counts.set(findingType, (counts.get(findingType) ?? 0) + 1);
}

// ----------------------------------------------------------------------------
// Generic helpers
// ----------------------------------------------------------------------------

/**
 * Type guard for the loose `springXmlBeans` field on `SourceFileIR`.
 * Mirrors the guard in the framework adapter (no shared module to avoid
 * a circular import).
 */
function isSpringBeansXmlResult(value: unknown): value is SpringBeansXmlResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.beans) &&
    Array.isArray(v.componentScans) &&
    Array.isArray(v.imports) &&
    Array.isArray(v.usedNamespaces)
  );
}

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

function findMappingAnnotation(annotations: AnnotationIR[]): AnnotationIR | undefined {
  return annotations.find((a) => MAPPING_ANNOTATION_NAMES.has(a.name));
}

function extractPathFromMapping(ann: AnnotationIR | undefined): string {
  if (!ann) return '';
  const v = ann.args.value ?? ann.args.path ?? '';
  return typeof v === 'string' ? v.replace(/^["']|["']$/g, '') : '';
}

function countPathVariables(pathTemplate: string): number {
  if (!pathTemplate) return 0;
  const matches = pathTemplate.match(/\{[^}]+\}/g);
  return matches ? matches.length : 0;
}

function offsetToLine(rawContent: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < rawContent.length; i++) {
    if (rawContent[i] === '\n') line++;
  }
  return line;
}

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

function inferHttpMethod(mappingAnn: AnnotationIR): string {
  switch (mappingAnn.name) {
    case 'GetMapping':
      return 'GET';
    case 'PostMapping':
      return 'POST';
    case 'PutMapping':
      return 'PUT';
    case 'DeleteMapping':
      return 'DELETE';
    case 'PatchMapping':
      return 'PATCH';
    case 'RequestMapping': {
      const m = mappingAnn.args.method ?? '';
      const upper = m.toUpperCase();
      if (upper.includes('POST')) return 'POST';
      if (upper.includes('PUT')) return 'PUT';
      if (upper.includes('DELETE')) return 'DELETE';
      if (upper.includes('PATCH')) return 'PATCH';
      if (upper.includes('GET')) return 'GET';
      return 'ANY';
    }
    default:
      return 'ANY';
  }
}

function isWriteVerb(httpMethod: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(httpMethod);
}

function methodHasRequestBody(m: FunctionIR): boolean {
  for (const p of m.parameters) {
    if (p.annotations.some((a) => REQUEST_BODY_ANNOTATION_NAMES.has(a.name))) {
      return true;
    }
  }
  return false;
}

/**
 * Decide whether a class looks like a Spring security filter / interceptor.
 * Returns the detected pattern name, or null when there is no match.
 */
function detectSecurityFilterPattern(
  className: string,
  extendsName: string,
  implementsArr: string[],
): string | null {
  if (extendsName === 'OncePerRequestFilter') return 'extends_once_per_request_filter';
  if (extendsName === 'GenericFilterBean') return 'extends_generic_filter_bean';
  if (extendsName === 'AbstractAuthenticationProcessingFilter')
    return 'extends_auth_processing_filter';
  if (implementsArr.includes('HandlerInterceptor')) return 'implements_handler_interceptor';
  if (implementsArr.includes('Filter')) return 'implements_servlet_filter';
  if (
    /(?:Auth|Security|Authentication|Authorization).*Filter$/.test(className) ||
    /(?:Auth|Security|Authentication|Authorization).*Interceptor$/.test(className)
  ) {
    return 'class_name_heuristic';
  }
  return null;
}

/**
 * Best-effort: extract the stored-proc name from a window around the
 * signal. Looks at the next `"..."` literal in `raw` after `from` and
 * returns the literal body when it looks identifier-shaped.
 */
function extractProcedureName(raw: string, from: number): string | null {
  const window = raw.slice(from, Math.min(raw.length, from + 200));
  const lit = window.match(/"([A-Za-z_][A-Za-z0-9_]*)"/);
  return lit ? lit[1] : null;
}

// ----------------------------------------------------------------------------
// Finding builders
// ----------------------------------------------------------------------------

function buildXmlBeanWiringFinding(args: {
  configFilePath: string;
  beanCount: number;
  topBeans: Array<{ id: string; className: string | null }>;
  importedXmlResources: string[];
  usedNamespaces: string[];
  relatedCandidateIds: string[];
}): FindingEmitInput {
  return {
    findingType: 'spring_xml_bean_wiring',
    category: 'migration_risk',
    severity: 'medium',
    title: `Spring XML bean wiring: ${args.configFilePath}`,
    summary:
      `Detected ${args.beanCount} <bean> definition(s) in ${args.configFilePath}. ` +
      `Classic XML wiring is harder to migrate than annotation-driven configuration.`,
    detailJson: {
      configFilePath: args.configFilePath,
      beanCount: args.beanCount,
      topBeans: args.topBeans,
      importedXmlResources: args.importedXmlResources,
      usedNamespaces: args.usedNamespaces,
      detectedPattern: 'xml_bean_wiring',
      migrationConcern:
        'Convert XML bean wiring to annotation-driven configuration or Java @Configuration classes.',
      confidence: 0.95,
      relatedCandidateIds: args.relatedCandidateIds,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

function buildLegacyTransactionConfigFinding(args: {
  source: 'xml' | 'annotation';
  configFilePath: string | null;
  controllerClass: string | null;
  methodName: string | null;
  detectedPattern: string;
  transactionManagerBean: string | null;
  propagationHint: string | null;
  rawSnippet: string;
  relatedCandidateIds: string[];
}): FindingEmitInput {
  const evidenceSnippet = redactSnippet(args.rawSnippet);
  const where =
    args.source === 'xml'
      ? args.configFilePath ?? '(unknown XML)'
      : `${args.controllerClass ?? '(class)'}${
          args.methodName ? '#' + args.methodName : ''
        }`;
  return {
    findingType: 'legacy_transaction_configuration',
    category: 'migration_risk',
    severity: 'medium',
    title: `Legacy transaction config: ${where}`,
    summary:
      args.source === 'xml'
        ? `XML-based transaction configuration detected in ${args.configFilePath}.`
        : `@Transactional declaration detected on ${where}.`,
    detailJson: {
      configFilePath: args.configFilePath,
      controllerClass: args.controllerClass,
      methodName: args.methodName,
      detectedPattern: args.detectedPattern,
      transactionConfig: {
        source: args.source,
        transactionManagerBean: args.transactionManagerBean,
        propagationHint: args.propagationHint,
      },
      evidenceSnippet,
      migrationConcern:
        'Migrating legacy transaction configuration to modern @Transactional / programmatic transaction management may change isolation semantics.',
      confidence: 0.85,
      relatedCandidateIds: args.relatedCandidateIds,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

function buildSecurityFilterFinding(args: {
  filePath: string | null;
  configFilePath: string | null;
  className: string | null;
  filterOrInterceptorName: string;
  detectedPattern: string;
  pathPatterns: string[];
  rawSnippet: string;
  relatedCandidateIds: string[];
}): FindingEmitInput {
  const evidenceSnippet = redactSnippet(args.rawSnippet);
  return {
    findingType: 'security_filter_or_interceptor_detected',
    category: 'security',
    severity: 'medium',
    title: `Security filter/interceptor: ${args.filterOrInterceptorName}`,
    summary:
      `Detected a security filter or interceptor: ${args.filterOrInterceptorName} ` +
      `(${args.detectedPattern}).`,
    detailJson: {
      filePath: args.filePath,
      configFilePath: args.configFilePath,
      className: args.className,
      filterOrInterceptorName: args.filterOrInterceptorName,
      detectedPattern: args.detectedPattern,
      pathPatterns: args.pathPatterns,
      securityConfig: {
        source: args.configFilePath ? 'xml' : 'class',
      },
      evidenceSnippet,
      migrationConcern:
        'Security filters / interceptors must be replicated on the target stack (Spring Security 6, gateway-layer rules, or platform IAM).',
      confidence: 0.85,
      relatedCandidateIds: args.relatedCandidateIds,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

function buildScheduledOrBatchJobFinding(args: {
  filePath: string | null;
  configFilePath: string | null;
  className: string | null;
  methodName: string | null;
  jobName: string;
  detectedPattern: string;
  cronOrSchedule: string | null;
  rawSnippet: string;
  relatedCandidateIds: string[];
}): FindingEmitInput {
  const evidenceSnippet = redactSnippet(args.rawSnippet);
  return {
    findingType: 'scheduled_or_batch_job_detected',
    category: 'migration_risk',
    severity: 'medium',
    title: `Scheduled/batch job: ${args.jobName}`,
    summary:
      `Detected scheduled or batch job '${args.jobName}' ` +
      (args.cronOrSchedule ? `(schedule: ${args.cronOrSchedule}).` : `(${args.detectedPattern}).`),
    detailJson: {
      filePath: args.filePath,
      configFilePath: args.configFilePath,
      controllerClass: args.className,
      methodName: args.methodName,
      jobName: args.jobName,
      detectedPattern: args.detectedPattern,
      scheduleConfig: {
        cronOrSchedule: args.cronOrSchedule,
      },
      evidenceSnippet,
      migrationConcern:
        'Scheduled / batch jobs are runtime invariants; mis-migration risks dropped or duplicated executions.',
      confidence: 0.85,
      relatedCandidateIds: args.relatedCandidateIds,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

function buildStoredProcOrJdbcFinding(args: {
  filePath: string;
  className: string | null;
  methodName: string | null;
  sourceLine: number;
  detectedPattern: string;
  procedureName: string | null;
  rawSnippet: string;
  relatedCandidateIds: string[];
}): FindingEmitInput {
  const evidenceSnippet = redactSnippet(args.rawSnippet);
  return {
    findingType: 'stored_procedure_or_jdbc_usage',
    category: 'business_logic',
    severity: 'high',
    title:
      `Stored procedure / JDBC call: ${args.className ?? args.filePath}` +
      (args.methodName ? `#${args.methodName}` : ''),
    summary:
      `Detected stored-procedure / low-level JDBC usage (${args.detectedPattern}) ` +
      `in ${args.filePath}` +
      (args.methodName ? ` (${args.className}#${args.methodName})` : '') +
      '.',
    detailJson: {
      filePath: args.filePath,
      controllerClass: args.className,
      methodName: args.methodName,
      sourceLineStart: args.sourceLine,
      sourceLineEnd: args.sourceLine,
      detectedPattern: args.detectedPattern,
      procedureName: args.procedureName,
      evidenceSnippet,
      migrationConcern:
        'Stored procedures and CallableStatement usage often hide business logic outside the service layer. ' +
        'Migration requires source-of-truth review and may require porting stored-proc logic to the application tier.',
      confidence: 0.9,
      relatedCandidateIds: args.relatedCandidateIds,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

function buildSpringClassicMigrationRiskFinding(args: {
  configFilePath: string | null;
  filePath: string | null;
  detectedPattern: string;
  severity: 'medium' | 'high';
  recommendedFollowUp: string;
  relatedCandidateIds: string[];
}): FindingEmitInput {
  return {
    findingType: 'spring_classic_migration_risk',
    category: 'migration_risk',
    severity: args.severity,
    title: `Spring classic migration risk: ${args.detectedPattern}`,
    summary:
      `Detected classic Spring infrastructure (${args.detectedPattern})` +
      (args.configFilePath ? ` in ${args.configFilePath}` : '') +
      (args.filePath ? ` in ${args.filePath}` : '') +
      '.',
    detailJson: {
      configFilePath: args.configFilePath,
      filePath: args.filePath,
      detectedPattern: args.detectedPattern,
      migrationConcern:
        'Classic Spring infrastructure (web.xml DispatcherServlet, ContextLoaderListener, XML-heavy wiring) does not port directly to Spring Boot / Spring 6 without rework.',
      recommendedFollowUp: args.recommendedFollowUp,
      confidence: 0.9,
      relatedCandidateIds: args.relatedCandidateIds,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

function buildSpringEvidenceGapFinding(args: {
  filePath: string;
  controllerClass: string | null;
  methodName: string | null;
  httpMethod: string | null;
  path: string | null;
  gapType:
    | 'endpoint_missing_request_schema'
    | 'endpoint_partial_path_variables';
  description: string;
  relatedCandidateIds: string[];
}): FindingEmitInput {
  return {
    findingType: 'evidence_gap',
    category: 'evidence_gap',
    severity: 'low',
    title:
      `Evidence gap (${args.gapType}): ${args.controllerClass ?? args.filePath}` +
      (args.methodName ? `#${args.methodName}` : ''),
    summary: args.description,
    detailJson: {
      gapType: args.gapType,
      filePath: args.filePath,
      controllerClass: args.controllerClass,
      methodName: args.methodName,
      httpMethod: args.httpMethod,
      path: args.path,
      relatedCandidateIds: args.relatedCandidateIds,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    links: buildLinks(args.relatedCandidateIds),
  };
}

// ----------------------------------------------------------------------------
// Per-file detection passes
// ----------------------------------------------------------------------------

/**
 * Scan a Spring beans XML file: emit `spring_xml_bean_wiring`, plus
 * `legacy_transaction_configuration` / `security_filter_or_interceptor_detected`
 * / `scheduled_or_batch_job_detected` when matching namespaces are present.
 */
function scanXmlFile(
  ir: SourceFileIR,
  packCandidates: DiscoveryCandidate[],
  counts: Map<string, number>,
): FindingEmitInput[] {
  if (!isSpringBeansXmlResult(ir.springXmlBeans)) return [];
  const xml = ir.springXmlBeans;
  const out: FindingEmitInput[] = [];
  const relatedCandidateIds = candidateIdsForFile(packCandidates, ir.filePath);
  const raw = typeof ir.rawContent === 'string' ? ir.rawContent : '';

  // spring_xml_bean_wiring -- one per XML file with >=1 <bean>.
  if (xml.beans.length > 0 && underCap(counts, 'spring_xml_bean_wiring')) {
    const topBeans = xml.beans.slice(0, 10).map((b) => ({
      id: b.beanKey,
      className: b.simpleClassName,
    }));
    out.push(
      buildXmlBeanWiringFinding({
        configFilePath: ir.filePath,
        beanCount: xml.beans.length,
        topBeans,
        importedXmlResources: xml.imports.map((i) => i.resource),
        usedNamespaces: xml.usedNamespaces,
        relatedCandidateIds,
      }),
    );
    bumpCap(counts, 'spring_xml_bean_wiring');
  }

  // legacy_transaction_configuration -- tx namespace OR aop+TransactionInterceptor.
  const hasTxNamespace = xml.usedNamespaces.includes('tx');
  const hasAopForTx =
    xml.usedNamespaces.includes('aop') &&
    /tx[:]advice|TransactionInterceptor|transactionManager/i.test(raw);
  if (
    (hasTxNamespace || hasAopForTx) &&
    underCap(counts, 'legacy_transaction_configuration')
  ) {
    const txMgrBean =
      xml.beans.find((b) => /transactionManager/i.test(b.id ?? ''))?.beanKey ?? null;
    out.push(
      buildLegacyTransactionConfigFinding({
        source: 'xml',
        configFilePath: ir.filePath,
        controllerClass: null,
        methodName: null,
        detectedPattern: hasTxNamespace ? 'tx_namespace' : 'aop_transaction_interceptor',
        transactionManagerBean: txMgrBean,
        propagationHint: null,
        rawSnippet: raw.slice(0, 300),
        relatedCandidateIds,
      }),
    );
    bumpCap(counts, 'legacy_transaction_configuration');
  }

  // security_filter_or_interceptor_detected -- spring-security namespace.
  const hasSecurityNamespace =
    xml.usedNamespaces.includes('security') || xml.usedNamespaces.includes('sec');
  if (
    hasSecurityNamespace &&
    underCap(counts, 'security_filter_or_interceptor_detected')
  ) {
    out.push(
      buildSecurityFilterFinding({
        filePath: null,
        configFilePath: ir.filePath,
        className: null,
        filterOrInterceptorName: ir.filePath,
        detectedPattern: 'spring_security_xml',
        pathPatterns: [],
        rawSnippet: raw.slice(0, 300),
        relatedCandidateIds,
      }),
    );
    bumpCap(counts, 'security_filter_or_interceptor_detected');
  }

  // scheduled_or_batch_job_detected -- task / batch namespace.
  const hasScheduleNamespace =
    xml.usedNamespaces.includes('task') || xml.usedNamespaces.includes('batch');
  if (
    hasScheduleNamespace &&
    underCap(counts, 'scheduled_or_batch_job_detected')
  ) {
    out.push(
      buildScheduledOrBatchJobFinding({
        filePath: null,
        configFilePath: ir.filePath,
        className: null,
        methodName: null,
        jobName: ir.filePath,
        detectedPattern: xml.usedNamespaces.includes('batch')
          ? 'spring_batch_xml'
          : 'spring_task_xml',
        cronOrSchedule: null,
        rawSnippet: raw.slice(0, 300),
        relatedCandidateIds,
      }),
    );
    bumpCap(counts, 'scheduled_or_batch_job_detected');
  }

  return out;
}

/**
 * Scan a Java source file: emit annotations-based findings + raw-content
 * patterns (stored-proc, DispatcherServlet references).
 */
function scanJavaFile(
  ir: SourceFileIR,
  packCandidates: DiscoveryCandidate[],
  counts: Map<string, number>,
): FindingEmitInput[] {
  if (ir.language !== 'java') return [];
  const out: FindingEmitInput[] = [];
  const relatedCandidateIds = candidateIdsForFile(packCandidates, ir.filePath);
  const raw = typeof ir.rawContent === 'string' ? ir.rawContent : '';

  for (const cls of ir.classes) {
    // @Transactional class-level OR method-level (one per class to avoid noise).
    if (underCap(counts, 'legacy_transaction_configuration')) {
      const classTxAnn = cls.annotations.find((a) => a.name === 'Transactional');
      if (classTxAnn) {
        out.push(
          buildLegacyTransactionConfigFinding({
            source: 'annotation',
            configFilePath: null,
            controllerClass: cls.name,
            methodName: null,
            detectedPattern: 'annotation_class_level',
            transactionManagerBean: classTxAnn.args.transactionManager ?? null,
            propagationHint: classTxAnn.args.propagation ?? null,
            rawSnippet: `@Transactional class ${cls.name}`,
            relatedCandidateIds,
          }),
        );
        bumpCap(counts, 'legacy_transaction_configuration');
      } else {
        for (const m of cls.methods) {
          if (!underCap(counts, 'legacy_transaction_configuration')) break;
          const methodTxAnn = m.annotations.find((a) => a.name === 'Transactional');
          if (methodTxAnn) {
            out.push(
              buildLegacyTransactionConfigFinding({
                source: 'annotation',
                configFilePath: null,
                controllerClass: cls.name,
                methodName: m.name,
                detectedPattern: 'annotation_method_level',
                transactionManagerBean: methodTxAnn.args.transactionManager ?? null,
                propagationHint: methodTxAnn.args.propagation ?? null,
                rawSnippet: `@Transactional ${cls.name}#${m.name}`,
                relatedCandidateIds,
              }),
            );
            bumpCap(counts, 'legacy_transaction_configuration');
          }
        }
      }
    }

    // security_filter_or_interceptor_detected -- class-level inheritance / heuristic.
    if (underCap(counts, 'security_filter_or_interceptor_detected')) {
      const extendsName = cls.extends ?? '';
      const detected = detectSecurityFilterPattern(cls.name, extendsName, cls.implements);
      if (detected !== null) {
        out.push(
          buildSecurityFilterFinding({
            filePath: ir.filePath,
            configFilePath: null,
            className: cls.name,
            filterOrInterceptorName: cls.name,
            detectedPattern: detected,
            pathPatterns: [],
            rawSnippet: `class ${cls.name} extends ${extendsName} implements ${cls.implements.join(',')}`,
            relatedCandidateIds,
          }),
        );
        bumpCap(counts, 'security_filter_or_interceptor_detected');
      }
    }

    // scheduled_or_batch_job_detected -- @Scheduled per method.
    for (const m of cls.methods) {
      if (!underCap(counts, 'scheduled_or_batch_job_detected')) break;
      const schedAnn = m.annotations.find((a) => a.name === 'Scheduled');
      if (schedAnn) {
        const cron =
          schedAnn.args.cron ??
          schedAnn.args.fixedRate ??
          schedAnn.args.fixedDelay ??
          null;
        out.push(
          buildScheduledOrBatchJobFinding({
            filePath: ir.filePath,
            configFilePath: null,
            className: cls.name,
            methodName: m.name,
            jobName: `${cls.name}#${m.name}`,
            detectedPattern: 'scheduled_annotation',
            cronOrSchedule: typeof cron === 'string' ? cron : null,
            rawSnippet: `@Scheduled ${cls.name}#${m.name}`,
            relatedCandidateIds,
          }),
        );
        bumpCap(counts, 'scheduled_or_batch_job_detected');
      }
    }

    // evidence_gap (Spring) -- controller endpoints with missing details.
    const isController = cls.annotations.some((a) =>
      CONTROLLER_ANNOTATION_NAMES.has(a.name),
    );
    if (isController) {
      for (const m of cls.methods) {
        const mappingAnn = findMappingAnnotation(m.annotations);
        if (!mappingAnn) continue;
        const httpMethod = inferHttpMethod(mappingAnn);
        const pathTemplate = extractPathFromMapping(mappingAnn);

        if (isWriteVerb(httpMethod) && !methodHasRequestBody(m)) {
          out.push(
            buildSpringEvidenceGapFinding({
              filePath: ir.filePath,
              controllerClass: cls.name,
              methodName: m.name,
              httpMethod,
              path: pathTemplate || null,
              gapType: 'endpoint_missing_request_schema',
              description:
                `Endpoint ${cls.name}#${m.name} (${httpMethod} ${pathTemplate}) is a write verb ` +
                `but no @RequestBody parameter was found; request schema cannot be inferred.`,
              relatedCandidateIds,
            }),
          );
        }

        const placeholderCount = countPathVariables(pathTemplate);
        if (placeholderCount > 0) {
          const pathVarCount = m.parameters.filter((p) =>
            p.annotations.some((a) => a.name === 'PathVariable'),
          ).length;
          if (pathVarCount < placeholderCount) {
            out.push(
              buildSpringEvidenceGapFinding({
                filePath: ir.filePath,
                controllerClass: cls.name,
                methodName: m.name,
                httpMethod,
                path: pathTemplate || null,
                gapType: 'endpoint_partial_path_variables',
                description:
                  `Endpoint ${cls.name}#${m.name} (${httpMethod} ${pathTemplate}) declares ` +
                  `${placeholderCount} path placeholder(s) but only ${pathVarCount} ` +
                  `@PathVariable parameter(s) were bound.`,
                relatedCandidateIds,
              }),
            );
          }
        }
      }
    }
  }

  // scheduled_or_batch_job_detected -- Quartz / Spring Batch / scheduling imports.
  if (underCap(counts, 'scheduled_or_batch_job_detected')) {
    const scheduleImport = ir.imports.find((imp) =>
      SCHEDULE_IMPORT_PREFIXES.some((pref) => imp.path.startsWith(pref)),
    );
    if (scheduleImport) {
      const fileClass = ir.classes[0]?.name ?? null;
      out.push(
        buildScheduledOrBatchJobFinding({
          filePath: ir.filePath,
          configFilePath: null,
          className: fileClass,
          methodName: null,
          jobName: scheduleImport.path,
          detectedPattern: scheduleImport.path.startsWith('org.quartz.')
            ? 'quartz_import'
            : scheduleImport.path.startsWith('org.springframework.batch.')
              ? 'spring_batch_import'
              : 'spring_scheduling_import',
          cronOrSchedule: null,
          rawSnippet: `import ${scheduleImport.path}`,
          relatedCandidateIds,
        }),
      );
      bumpCap(counts, 'scheduled_or_batch_job_detected');
    }
  }

  // stored_procedure_or_jdbc_usage -- scan raw content for known signals.
  if (raw.length > 0) {
    const sites = new Set<string>();
    // (a) Substring signals.
    for (const signal of JDBC_PROC_SIGNALS) {
      let from = 0;
      while (from < raw.length) {
        const idx = raw.indexOf(signal, from);
        if (idx < 0) break;
        from = idx + signal.length;
        const line = offsetToLine(raw, idx);
        const { cls, method } = findEnclosingClassAndMethod(ir, line);
        const key = `${ir.filePath}::${cls?.name ?? ''}::${method?.name ?? ''}::${signal}`;
        if (sites.has(key)) continue;
        sites.add(key);
        if (!underCap(counts, 'stored_procedure_or_jdbc_usage')) break;
        const start = Math.max(0, idx - 20);
        const end = Math.min(raw.length, idx + signal.length + 60);
        out.push(
          buildStoredProcOrJdbcFinding({
            filePath: ir.filePath,
            className: cls?.name ?? null,
            methodName: method?.name ?? null,
            sourceLine: line,
            detectedPattern: signal,
            procedureName: extractProcedureName(raw, idx),
            rawSnippet: raw.slice(start, end),
            relatedCandidateIds,
          }),
        );
        bumpCap(counts, 'stored_procedure_or_jdbc_usage');
      }
    }
    // (b) EXEC / CALL in a string literal -- one per (class, method) site.
    const litRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"/g;
    let m: RegExpExecArray | null;
    litRegex.lastIndex = 0;
    while ((m = litRegex.exec(raw)) !== null) {
      const body = m[1] ?? '';
      const procMatch = SQL_PROC_KEYWORD_REGEX.exec(body);
      if (!procMatch) continue;
      const line = offsetToLine(raw, m.index);
      const { cls, method } = findEnclosingClassAndMethod(ir, line);
      const key = `${ir.filePath}::${cls?.name ?? ''}::${method?.name ?? ''}::sql_proc`;
      if (sites.has(key)) continue;
      sites.add(key);
      if (!underCap(counts, 'stored_procedure_or_jdbc_usage')) break;
      const procName = procMatch[0].split(/\s+/)[1] ?? null;
      out.push(
        buildStoredProcOrJdbcFinding({
          filePath: ir.filePath,
          className: cls?.name ?? null,
          methodName: method?.name ?? null,
          sourceLine: line,
          detectedPattern: 'sql_exec_call_keyword',
          procedureName: procName,
          rawSnippet: m[0],
          relatedCandidateIds,
        }),
      );
      bumpCap(counts, 'stored_procedure_or_jdbc_usage');
    }
  }

  // spring_classic_migration_risk -- ContextLoaderListener / DispatcherServlet.
  if (underCap(counts, 'spring_classic_migration_risk') && raw.length > 0) {
    if (raw.includes('ContextLoaderListener')) {
      out.push(
        buildSpringClassicMigrationRiskFinding({
          configFilePath: null,
          filePath: ir.filePath,
          detectedPattern: 'context_loader_listener_reference',
          severity: 'medium',
          recommendedFollowUp:
            'Replace ContextLoaderListener bootstrap with Spring Boot main class.',
          relatedCandidateIds,
        }),
      );
      bumpCap(counts, 'spring_classic_migration_risk');
    } else if (raw.includes('DispatcherServlet')) {
      out.push(
        buildSpringClassicMigrationRiskFinding({
          configFilePath: null,
          filePath: ir.filePath,
          detectedPattern: 'dispatcher_servlet_reference',
          severity: 'medium',
          recommendedFollowUp:
            'Replace DispatcherServlet wiring with Spring Boot auto-configuration.',
          relatedCandidateIds,
        }),
      );
      bumpCap(counts, 'spring_classic_migration_risk');
    }
  }

  return out;
}

/**
 * Detect web.xml presence by filename AND parse its <servlet> /
 * <servlet-mapping> declarations (Spec #4, Task Group 3).
 *
 * The existing `web_xml_present` presence finding is KEPT verbatim; the parsed
 * (servlet-class -> url-pattern[]) mappings are SUMMARISED onto the finding's
 * `detailJson.servletMappings` so a reviewer can see the declared servlet URLs
 * without re-reading the descriptor. Endpoint/interface CANDIDATES for these
 * servlets are emitted by the spring-classic adapter
 * (inboundSurfaceDetectors.ts) via the SAME pure parser — this scanner emits
 * ONLY findings (no candidate minting here).
 */
function scanWebXmlPresence(
  ir: SourceFileIR,
  packCandidates: DiscoveryCandidate[],
  counts: Map<string, number>,
): FindingEmitInput[] {
  const lc = ir.filePath.toLowerCase();
  const isWebXml =
    lc.endsWith('/web.xml') ||
    lc.endsWith('\\web.xml') ||
    lc === 'web.xml';
  if (!isWebXml) return [];
  if (!underCap(counts, 'spring_classic_migration_risk')) return [];
  const relatedCandidateIds = candidateIdsForFile(packCandidates, ir.filePath);
  bumpCap(counts, 'spring_classic_migration_risk');

  const finding = buildSpringClassicMigrationRiskFinding({
    configFilePath: ir.filePath,
    filePath: null,
    detectedPattern: 'web_xml_present',
    severity: 'medium',
    recommendedFollowUp:
      'Replace web.xml servlet/filter declarations with Spring Boot auto-configuration or programmatic registration.',
    relatedCandidateIds,
  });

  // Parse <servlet> / <servlet-mapping> and summarise onto the finding. Pure;
  // soft-fails a malformed descriptor (the presence finding still stands).
  try {
    const mappings = parseWebXmlServletMappings(ir.rawContent ?? '');
    if (mappings.length > 0 && finding.detailJson) {
      (finding.detailJson as Record<string, unknown>).servletMappings = mappings.map(
        (m) => ({ servletClass: m.servletClass, urlPatterns: m.urlPatterns }),
      );
    }
  } catch (err) {
    console.warn(
      `[springClassicFindingScanner] web.xml servlet-mapping parse failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return [finding];
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

/**
 * Spring Classic pack finding scanner entry point. Pure: takes pack inputs,
 * returns FindingEmitInputs. Caller passes the result to
 * `findingEmitter.emitFindings`.
 */
/**
 * Build an actionable Finding for an endpoint whose data access could NOT be
 * statically resolved to a single data entity (Task Group 3.5). NEVER a silent
 * drop -- the spec requires every un-resolvable data effect to surface here.
 *
 * The finding carries the endpoint identity AND where resolution stopped (the
 * reason + a human-readable detail + the partial controller->service->repository
 * path), so a reviewer can pick up the chain manually. Severity is "medium".
 *
 * Emitted via the deferred FindingEmitter path (this scanner output flows
 * through runPackFindingScanners -> the V3 pipeline findingInputs ->
 * runManager.emitPipelineFindingsForRun AFTER candidates persist), so there is
 * NO inline pre-persist emission here -- consistent with the 2026-05-29
 * deferred-findings fix.
 */
function buildEndpointDataEffectUnresolvedFinding(
  u: UnresolvedDataEffect,
): FindingEmitInput {
  return {
    findingType: 'endpoint_data_effect_unresolved',
    category: 'migration_risk',
    severity: 'medium',
    title: `Unresolved data effect: ${u.endpointName}`,
    summary:
      `Endpoint '${u.endpointName}' (${u.controllerClassName}#${u.endpointMethodName}) ` +
      `touches data we could not statically resolve to a data entity (${u.reason}). ${u.detail}`,
    detailJson: {
      endpoint: u.endpointName,
      controllerClass: u.controllerClassName,
      methodName: u.endpointMethodName,
      reason: u.reason,
      detail: u.detail,
      stoppedAtPath: u.partialPath.map((h) => ({
        method_id: h.methodId,
        class_name: h.className,
        method_name: h.methodName,
        role: h.role,
      })),
      migrationConcern:
        'A data read/write exists on this endpoint but the touched entity/table could not be ' +
        'statically determined (multiple impls / dynamic dispatch / JdbcTemplate / native SQL / ' +
        'EntityManager / reflection / too-deep). Review the chain to capture the data effect manually.',
      filePath: u.sourceFilePath,
    },
    source: FINDING_SOURCE,
    createdByStage: CREATED_BY_STAGE,
    // No discovery_candidate link: by construction NO edge candidate was emitted
    // for an unresolved chain (the resolver returns it as 'unresolved', not
    // 'resolved'). The finding stands on its endpoint identity.
    links: [],
  };
}

/**
 * Cross-file pass (Task Group 3.5): run the endpoint->data-effect resolver over
 * the WHOLE IR set and emit a Finding per UNRESOLVED chain. Runs once (not
 * per-file) because resolution walks controller->service->repository across
 * files. Capped at MAX_FINDINGS_PER_TYPE_PER_RUN; soft-fails as a whole so a
 * malformed IR cannot poison the run.
 */
function scanEndpointDataEffects(
  irFiles: Map<string, SourceFileIR>,
  counts: Map<string, number>,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  try {
    const files = Array.from(irFiles.values());
    const { unresolved } = resolveEndpointDataEffects(files);
    for (const u of unresolved) {
      if (!underCap(counts, 'endpoint_data_effect_unresolved')) break;
      out.push(buildEndpointDataEffectUnresolvedFinding(u));
      bumpCap(counts, 'endpoint_data_effect_unresolved');
    }
  } catch (err) {
    console.warn(
      `[springClassicFindingScanner] endpoint-data-effect pass failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
    console.warn(`[diag-pack] scanner=spring_classic soft_fail=true category=ede_resolver_error`);
  }
  return out;
}

/**
 * Cross-file pass (Spec 2026-05-30 response-contract capture, Task Group 2.5):
 * run the deterministic response-contract scanner over the WHOLE IR set and
 * emit:
 *   - an `endpoint_auth_unresolved` Finding per endpoint whose authorization
 *     could NOT be statically resolved (SpEL beyond a simple role, a dynamic
 *     matcher, an unparseable filter chain) -- the contract's `auth.source` is
 *     set to `unresolved` and NO role is guessed;
 *   - an `endpoint_response_config_dependent` Finding per endpoint whose
 *     response is not a pure function of its input (config/profile/value
 *     branches).
 *
 * Runs once (not per-file) because resolution needs the cross-file controller /
 * advice / DTO / security-config set. Capped at MAX_FINDINGS_PER_TYPE_PER_RUN;
 * soft-fails as a whole so a malformed IR cannot poison the run. The contract
 * itself is attached to the `endpoints` candidate by the adapter; this pass
 * only surfaces the un-modellable cases as Findings (no candidate emission).
 */
function scanResponseContractFindings(
  irFiles: Map<string, SourceFileIR>,
  counts: Map<string, number>,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  try {
    const files = Array.from(irFiles.values());
    const scan = scanResponseContracts(files);
    for (const f of buildResponseContractFindings(scan)) {
      if (!underCap(counts, f.findingType)) continue;
      out.push(f);
      bumpCap(counts, f.findingType);
    }
  } catch (err) {
    console.warn(
      `[springClassicFindingScanner] response-contract pass failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
    console.warn(`[diag-pack] scanner=spring_classic soft_fail=true category=response_contract_error`);
  }
  return out;
}

/**
 * Cross-file pass (Outbound Integration Graph, Spec #5, Task Group 3): run the
 * SHARED `outboundIntegrationResolver` over the WHOLE IR set and emit one
 * `external_integration_dependency` Finding per PURELY-EXTERNAL resolved outbound
 * edge (a bare URL / topic / queue / store / file / SDK endpoint with no in-model
 * counterpart). The verbatim target + payload hint + integration kind + calling
 * endpoint/service + call-site FQN+line are carried as evidence -- never an
 * invented external entity, never a `*_points` reference.
 *
 * Runs once (not per-file) because attribution walks controller->service across
 * files. Capped at MAX_FINDINGS_PER_TYPE_PER_RUN; soft-fails as a whole so a
 * malformed IR cannot poison the run. The `data_movements` candidate side is
 * emitted by the adapter over the SAME resolver output (this pass only surfaces
 * the external-only edges as Findings -- no candidate emission here).
 */
function scanOutboundIntegrations(
  irFiles: Map<string, SourceFileIR>,
  counts: Map<string, number>,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  try {
    const files = Array.from(irFiles.values());
    for (const f of buildOutboundIntegrationFindings(files)) {
      if (!underCap(counts, f.findingType)) continue;
      out.push(f);
      bumpCap(counts, f.findingType);
    }
  } catch (err) {
    console.warn(
      `[springClassicFindingScanner] outbound-integration pass failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
    console.warn(`[diag-pack] scanner=spring_classic soft_fail=true category=outbound_integration_error`);
  }
  return out;
}

/**
 * Cross-file pass (Spec 2026-06-22 Spring Classic code-evidence format
 * extraction, Task Group 3 / follow-up wiring): detect request-body DTO fields
 * that hide their wire format inside a CUSTOM Jackson (de)serializer
 * (@JsonSerialize / @JsonDeserialize(using=SomeClass.class)) and emit one
 * `request_format_unresolved` evidence_gap Finding (severity info) per hit,
 * carrying the field + endpoint + referenced serializer class. The format is
 * NEVER guessed -- the field is flagged for manual review.
 *
 * Runs ONCE across the whole IR set (it walks the controller -> @RequestBody
 * DTO path cross-file), AFTER the per-file passes -- a peer of the
 * response-contract / outbound-integration cross-file passes above. Best-effort:
 * capped at MAX_FINDINGS_PER_TYPE_PER_RUN and soft-fails as a whole so a
 * malformed IR cannot poison the run. Emits via the SAME FindingEmitInput ->
 * caller-emit path every other source uses (no parallel emitter).
 */
function scanCustomSerializerFindings(
  irFiles: Map<string, SourceFileIR>,
  counts: Map<string, number>,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];
  try {
    const files = Array.from(irFiles.values());
    for (const hit of detectCustomSerializerFields(files)) {
      const finding = buildRequestFormatUnresolvedFinding({
        field: hit.field,
        endpoint: hit.endpoint,
        serializerClass: hit.serializerClass,
      });
      if (!underCap(counts, finding.findingType)) break;
      out.push(finding);
      bumpCap(counts, finding.findingType);
    }
  } catch (err) {
    console.warn(
      `[springClassicFindingScanner] custom-(de)serializer pass failed; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
    console.warn(`[diag-pack] scanner=spring_classic soft_fail=true category=request_format_unresolved_error`);
  }
  return out;
}

export function runSpringClassicFindingScanner(
  input: PackFindingScannerInput,
): FindingEmitInput[] {
  const collected: FindingEmitInput[] = [];
  const counts = new Map<string, number>();
  let softFailFiles = 0;
  for (const [, ir] of input.irFiles) {
    try {
      collected.push(...scanWebXmlPresence(ir, input.packCandidates, counts));
      collected.push(...scanXmlFile(ir, input.packCandidates, counts));
      collected.push(...scanJavaFile(ir, input.packCandidates, counts));
    } catch (err) {
      softFailFiles += 1;
      console.warn(
        `[springClassicFindingScanner] Failed on file '${ir.filePath}'; continuing:`,
        err instanceof Error ? err.message : String(err),
      );
      // Structured diag: category only, never the file path.
      console.warn(`[diag-pack] scanner=spring_classic soft_fail=true category=parse_error`);
    }
  }
  // Endpoint->Data-Effect unresolved-chain findings (Task Group 3.5). Run
  // ONCE across the whole IR set (cross-file controller->service->repository
  // resolution), AFTER the per-file passes.
  collected.push(...scanEndpointDataEffects(input.irFiles, counts));
  // Response-contract unresolved-auth + config-dependent findings
  // (Spec 2026-05-30 response-contract capture, Task Group 2.5). Run ONCE
  // across the whole IR set (cross-file controller / advice / security-config
  // resolution), AFTER the per-file passes.
  collected.push(...scanResponseContractFindings(input.irFiles, counts));
  // External-dependency Findings for purely-external outbound targets
  // (Outbound Integration Graph, Spec #5, Task Group 3). Run ONCE across the
  // whole IR set (cross-file controller->service attribution), AFTER the
  // per-file passes -- a peer of the endpoint-data-effect + response-contract
  // cross-file passes above.
  collected.push(...scanOutboundIntegrations(input.irFiles, counts));
  // Custom-(de)serializer detect-or-flag Findings (Spec 2026-06-22 code-evidence
  // format extraction, Task Group 3 / follow-up wiring). Run ONCE across the
  // whole IR set (cross-file controller -> @RequestBody DTO walk), AFTER the
  // per-file passes -- a peer of the cross-file passes above.
  collected.push(...scanCustomSerializerFindings(input.irFiles, counts));

  for (const [type, count] of counts) {
    if (count >= MAX_FINDINGS_PER_TYPE_PER_RUN) {
      console.warn(`[diag-pack] scanner=spring_classic cap_hit=true type=${type} at=${count}`);
    }
  }
  if (softFailFiles > 0) {
    console.warn(`[diag-pack] scanner=spring_classic soft_fail_files=${softFailFiles}`);
  }
  return collected;
}

// ----------------------------------------------------------------------------
// Combined Spring Classic scanner entry point (REST findings + SOAP candidates)
// ----------------------------------------------------------------------------

/**
 * Combined output of the Spring Classic scanner's REST emit path PLUS the
 * SOAP peer pass (Spec 2026-05-17 SOAP Discovery, Task Group 5) PLUS the
 * REST WADL peer pass (Spec 2026-05-21 WADL Deterministic Parser, Task Group 5).
 *
 *  - `findings`: the REST emit path's `FindingEmitInput[]` -- byte-identical
 *    to the standalone `runSpringClassicFindingScanner` return for back-compat.
 *    NOTE: WADL pack findings are NOT folded in here; they ride on the
 *    `wadlFindings` field below so callers that already split SOAP candidates
 *    from REST findings can split WADL findings the same way.
 *  - `soapInterfaceCandidates` / `soapEndpointCandidates`: SOAP-shaped
 *    candidates produced by the SOAP sub-module. Parent interfaces carry
 *    `interface_type='SOAP_API'`; endpoints carry the seven new `data`
 *    fields documented in `springClassicSoap/soapEndpointEmitter.ts`.
 *  - `soapDiagnostics`: diagnostic stream from the SOAP emitter. Group 6
 *    translates these entries into `[diag-pack] scanner=spring_classic_soap`
 *  - `wadlFindings`: structural + evidence-gap findings produced by the REST
 *    WADL sub-module (`restWadl/index.ts`). One stream containing
 *    `interface_definition` + `endpoint` + `evidence_gap` finding kinds in
 *    spec-Q9 order (structural first per WADL file, gaps last). Empty array
 *    when no `.wadl` IR entries were present.
 */
export interface SpringClassicScannerOutput {
  findings: FindingEmitInput[];
  soapInterfaceCandidates: DiscoveryCandidate[];
  soapEndpointCandidates: DiscoveryCandidate[];
  soapDiagnostics: SpringClassicSoapPassOutput['diagnostics'];
  wadlFindings: FindingEmitInput[];
  /**
   * Bug-fix 2026-05-28: the SOAP pass DOES emit `FindingEmitInput`s
   * (`soap_endpoint_url_unknown` + `wsdl_parse_failed` from
   * `buildSoapEvidenceGapFindings`, plus `oas_spec_*` from the spec-link
   * step inside `emitSoapCandidates`) but they were never propagated
   * through the parent bundle. Now they ride here so the shim in
   * `packFindingScanners/index.ts` can push them into the collected
   * findings stream alongside REST + WADL findings.
   */
  soapFindings: FindingEmitInput[];
}

/**
 * Run the Spring Classic REST emit path, the SOAP peer pass, and the REST
 * WADL peer pass against the same `PackFindingScannerInput` and return all
 * three outputs merged.
 *
 * Wiring (one call-site per peer pass):
 *  - REST emit path: `runSpringClassicFindingScanner(input)` -- unchanged.
 *  - SOAP peer pass: `runSpringClassicSoapPass(input)` -- imported from the
 *    `springClassicSoap/` sub-module.
 *  - REST WADL peer pass: `runRestWadlPass(input)` -- imported from the
 *    `restWadl/` sub-module (Spec 2026-05-21).
 *
 * REST scanning behaviour is byte-identical to the standalone scanner for
 * projects with no SOAP / no WADL signals (SOAP arrays and WADL findings come
 * back empty cleanly).
 */
export function runSpringClassicScannerWithSoap(
  input: PackFindingScannerInput,
): SpringClassicScannerOutput {
  const findings = runSpringClassicFindingScanner(input);
  const soap = runSpringClassicSoapPass(input);
  const wadl = runRestWadlPass(input);
  return {
    findings,
    soapInterfaceCandidates: soap.interfaceCandidates,
    soapEndpointCandidates: soap.endpointCandidates,
    soapDiagnostics: soap.diagnostics,
    wadlFindings: wadl.findings,
    soapFindings: soap.findings,
  };
}
