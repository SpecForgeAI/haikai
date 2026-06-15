/**
 * Outbound Integration resolver (Spring Classic).
 *
 * Spec: 2026-05-30 Outbound Integration Graph for Discovery
 * (Java / Spring Classic + Spring Boot), Task Group 2.
 *
 * Captures what a service CALLS OUT TO -- outbound HTTP calls, published
 * messages, secondary stores, files/objects, email/SMS, and third-party SDKs --
 * as resolved outbound EDGES, so a like-for-like migration target can reproduce
 * the same downstream behaviour.
 *
 * This is a NEW, ADDITIVE, pure module modelled on `endpointDataEffectResolver`.
 * It does NOT modify that file; it REUSES the SAME endpoint->service call-graph
 * walk SHAPE (controller mapping -> autowired @Service field -> service method,
 * with same-class private-helper inlining + a cycle guard) to ATTRIBUTE each
 * outbound call site to the calling endpoint or the owning service.
 *
 * How it works
 * ------------
 *  1. Index every class by simple name (+ interface-impl resolution), exactly
 *     as the data-effect resolver does.
 *  2. Detect outbound call sites by RECEIVER-TYPE / METHOD-NAME signature over
 *     the now-retained `CallIR.args` (populated by Task Group 1). The verbatim
 *     TARGET (URL / topic / queue / exchange / store / path) is read from the
 *     literal args; a non-literal arg leaves the target unresolved (a finding,
 *     never a guessed target).
 *  3. ATTRIBUTE each detected outbound site:
 *       - reached from an inbound controller mapping (directly, through a
 *         same-class helper, OR through an autowired @Service method) ->
 *         the CALLING ENDPOINT (`${httpMethod} ${fullPath}`);
 *       - otherwise (a plain @Service/@Component method not reached from any
 *         mapping) -> the OWNING SERVICE (its class name).
 *     The `data_movements` SOURCE is that endpoint's interface or the owning
 *     service (its auto-managed `application_point`, resolved LATE at save-back
 *     -- NEVER here, NEVER a `*_points` reference).
 *  4. DEDUP: one resolved edge per (source owner, resolved target) pair, exactly
 *     mirroring Spec #1's one-edge-per-pair rule.
 *
 * Two outputs (Q6): `resolved` outbound edges (target resolved verbatim) and an
 * `unresolved` list (an outbound call site whose target literal could not be
 * statically resolved -- a finding, never a fabricated edge).
 *
 * External-vs-modellable resolution is NOT decided here -- the resolver records
 * the verbatim target + a `targetLooksExternal` shape hint; the framework
 * adapter (candidates) and the finding scanner (external-dependency Findings)
 * each consume this SAME output (the established "run it twice, cheap, keeps
 * candidate vs finding emission separate" pattern). NEVER mints an external
 * entity; NEVER creates `*_points`; NEVER synthesizes a 1:1 mapping.
 *
 * Deterministic: the literal targets are statically present in the retained
 * call args; NO LLM, NO gateway relay. Pure: reads the supplied `SourceFileIR[]`
 * only. Soft-fails on malformed input (never throws) -- a malformed IR cannot
 * poison the run.
 */

import type {
  SourceFileIR,
  ClassIR,
  FieldIR,
  FunctionIR,
  CallIR,
} from '../../languageIR';
import { hasAnnotation, findAnnotation, annotationArg } from '../../languageIR';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTROLLER_ANNOTATIONS = ['RestController', 'Controller'];
const ENDPOINT_ANNOTATIONS = [
  'GetMapping',
  'PostMapping',
  'PutMapping',
  'DeleteMapping',
  'PatchMapping',
  'RequestMapping',
];
const HTTP_METHOD_ANNOTATIONS: Record<string, string> = {
  GetMapping: 'GET',
  PostMapping: 'POST',
  PutMapping: 'PUT',
  DeleteMapping: 'DELETE',
  PatchMapping: 'PATCH',
};

const ASYNC_METHOD_ANNOTATIONS = [
  'JmsListener',
  'KafkaListener',
  'RabbitListener',
  'SqsListener',
  'EventListener',
  'Scheduled',
];

const SERVICE_STEREOTYPES = ['Service', 'Component'];
const TRANSACTIONAL_ANNOTATION = 'Transactional';

// Receivers that denote a SAME-CLASS (`this`) method call (un-qualified call ->
// receiver=null; `this.x()` -> receiver="this"). Both mean "a method on the
// class itself" -- a candidate same-class helper to inline.
const SELF_RECEIVERS = new Set<string | null | undefined>([null, undefined, 'this']);

// Maximum controller->service depth + same-class-helper depth the walk follows.
const MAX_RESOLVE_DEPTH = 6;
const MAX_HELPER_DEPTH = 8;

// Placeholder length cap -- the extractor truncates non-literal args with a
// trailing ellipsis; a target that contains it is NOT a usable literal.
const PLACEHOLDER_ELLIPSIS = '…';

// ---------------------------------------------------------------------------
// Outbound family detection tables (RECEIVER-TYPE + METHOD-NAME signatures)
// ---------------------------------------------------------------------------

export type IntegrationKind =
  | 'outbound-rest'
  | 'messaging-producer'
  | 'cache-store'
  | 'secondary-store'
  | 'file-store'
  | 'object-store'
  | 'email'
  | 'sms'
  | 'third-party-sdk';

// HTTP-client receiver TYPE name suffixes -> the call is an outbound REST call.
// We gate on the receiver FIELD's declared type so a method named `exchange`
// on an unrelated class does not false-positive.
const HTTP_CLIENT_TYPES = new Set([
  'RestTemplate',
  'TestRestTemplate',
  'AsyncRestTemplate',
  'WebClient',
  'RestClient',
  'OkHttpClient',
  'CloseableHttpClient',
  'HttpClient',
  'RestOperations',
]);
const HTTP_CLIENT_METHODS = new Set([
  'getForObject',
  'getForEntity',
  'postForObject',
  'postForEntity',
  'postForLocation',
  'put',
  'patchForObject',
  'delete',
  'exchange',
  'execute',
  // WebClient / RestClient builder entry verbs.
  'get',
  'post',
  'method',
  // OkHttp / Apache / JDK HttpClient send.
  'newCall',
  'send',
  'sendAsync',
]);

// Method-name -> HTTP verb hint (best-effort; null = unknown verb).
function httpVerbFor(methodName: string): string | null {
  const n = methodName.toLowerCase();
  if (n.startsWith('getfor') || n === 'get') return 'GET';
  if (n.startsWith('postfor') || n === 'post') return 'POST';
  if (n === 'put') return 'PUT';
  if (n === 'delete') return 'DELETE';
  if (n.startsWith('patch')) return 'PATCH';
  if (n === 'exchange' || n === 'execute' || n === 'method') return null;
  return null;
}

// Messaging-producer receiver TYPE -> kind. The producing call name + the
// literal topic/queue/exchange arg pin the target.
const MESSAGING_PRODUCER_TYPES = new Set([
  'KafkaTemplate',
  'JmsTemplate',
  'RabbitTemplate',
  'AmqpTemplate',
  'SqsTemplate',
  'StreamBridge',
]);
const MESSAGING_PRODUCER_METHODS = new Set([
  'send',
  'sendDefault',
  'convertAndSend',
  'convertSendAndReceive',
  'sendMessage',
  'publish',
]);

// Cache / secondary-store receiver TYPE -> store kind + a stable target token.
// (Redis/Mongo/Elasticsearch are secondary STORES; the dependency, not a row.)
const STORE_TYPE_TARGETS: Array<{ types: Set<string>; kind: IntegrationKind; target: string }> = [
  {
    types: new Set([
      'RedisTemplate',
      'StringRedisTemplate',
      'ReactiveRedisTemplate',
    ]),
    kind: 'cache-store',
    target: 'redis',
  },
  {
    types: new Set(['MongoTemplate', 'ReactiveMongoTemplate', 'GridFsTemplate']),
    kind: 'secondary-store',
    target: 'mongodb',
  },
  {
    types: new Set([
      'ElasticsearchOperations',
      'ElasticsearchRestTemplate',
      'ElasticsearchTemplate',
      'RestHighLevelClient',
      'ElasticsearchClient',
    ]),
    kind: 'secondary-store',
    target: 'elasticsearch',
  },
];

// Object-store (S3) receiver TYPE -> bucket/key resolved from literal args.
const OBJECT_STORE_TYPES = new Set([
  'AmazonS3',
  'S3Client',
  'AmazonS3Client',
]);
const OBJECT_STORE_METHODS = new Set([
  'putObject',
  'getObject',
  'deleteObject',
  'copyObject',
]);

// Email / SMS receiver TYPE -> kind + a stable target token.
const EMAIL_TYPES = new Set(['JavaMailSender', 'MailSender']);
const EMAIL_METHODS = new Set(['send']);
const SMS_TYPES = new Set(['AmazonSNS', 'SnsClient']);
const SMS_METHODS = new Set(['publish', 'sendMessage', 'sendTextMessage']);

// ---------------------------------------------------------------------------
// Public result shapes
// ---------------------------------------------------------------------------

/** Where an outbound edge is attributed -- the calling endpoint or owning service. */
export type OutboundSourceKind = 'endpoint' | 'service';

/** A resolved outbound edge (one per (source owner, resolved target) pair). */
export interface ResolvedOutboundEdge {
  /** Whether the SOURCE is a calling endpoint or the owning service. */
  sourceKind: OutboundSourceKind;
  /**
   * The source NAME -- the endpoint identity (`${httpMethod} ${fullPath}`) when
   * `sourceKind === 'endpoint'`, else the owning service class name. Resolves to
   * the source `application_point` BY NAME at save-back (NEVER a point id here).
   */
  sourceName: string;
  /** The integration family. */
  integrationKind: IntegrationKind;
  /** The verbatim resolved target (URL / topic / queue / exchange / store / path). */
  target: string;
  /**
   * Whether the target LOOKS purely external (a bare URL / topic / store token
   * with no obvious in-model counterpart) -- a SHAPE hint only. The real
   * external-vs-modellable decision is made by the consumer (the adapter resolves
   * modellable targets; the finding scanner emits external-dependency Findings).
   */
  targetLooksExternal: boolean;
  /** Optional HTTP verb (outbound-rest). */
  httpVerb?: string;
  /** Optional messaging operation (`send` / `convertAndSend` / `publish` / ...). */
  messagingOperation?: string;
  /** Optional best-effort payload-type hint (static type of the send payload arg). */
  payloadHint?: string;
  /** Detection confidence (0..1). */
  confidence: number;
  /** Owning class simple name (context). */
  ownerClassName: string;
  /** Owning method simple name where the outbound call physically lives (context). */
  ownerMethodName: string;
  /** Call-site FQN (`package.Class#method`) of the outbound site (evidence). */
  callSiteFqn: string;
  /** Call-site 0-based source line (evidence). */
  callSiteLine: number;
  /** The source file path of the calling/owning class (candidate `sourceClusterIds`). */
  sourceFilePath: string;
}

/**
 * An outbound call site whose target literal could NOT be statically resolved
 * (a non-literal URL / topic built from a method call / concatenation / config
 * property). Carries enough context for an actionable finding -- never a
 * fabricated edge.
 */
export interface UnresolvedOutboundEdge {
  sourceKind: OutboundSourceKind;
  sourceName: string;
  integrationKind: IntegrationKind;
  /** Why the target could not be resolved (the raw placeholder / absent arg). */
  reason: 'non_literal_target' | 'missing_target_arg';
  /** The raw (placeholder / receiver) text for the finding detail. */
  detail: string;
  ownerClassName: string;
  ownerMethodName: string;
  callSiteFqn: string;
  callSiteLine: number;
  sourceFilePath: string;
}

export interface OutboundResolverOutput {
  resolved: ResolvedOutboundEdge[];
  unresolved: UnresolvedOutboundEdge[];
}

// ---------------------------------------------------------------------------
// Internal indexes (mirror endpointDataEffectResolver's shape)
// ---------------------------------------------------------------------------

interface ClassEntry {
  cls: ClassIR;
  file: SourceFileIR;
  fqn: string;
}

interface ResolverIndex {
  byName: Map<string, ClassEntry>;
  implsByInterface: Map<string, ClassEntry[]>;
}

function fqnOf(file: SourceFileIR, cls: ClassIR): string {
  return file.packageOrNamespace ? `${file.packageOrNamespace}.${cls.name}` : cls.name;
}

function simpleName(t: string): string {
  const s = (t ?? '').trim();
  const dot = s.lastIndexOf('.');
  return dot >= 0 ? s.slice(dot + 1) : s;
}

function stripGenerics(t: string): string {
  const lt = (t ?? '').indexOf('<');
  return (lt > 0 ? t.slice(0, lt) : t ?? '').trim();
}

/**
 * Extract the LAST generic type argument: `KafkaTemplate<String, OrderEvent>` ->
 * `OrderEvent` (the message payload type). Returns null when absent.
 */
function lastGenericArg(t: string): string | null {
  const lt = (t ?? '').indexOf('<');
  const gt = (t ?? '').lastIndexOf('>');
  if (lt < 0 || gt <= lt) return null;
  const inner = t.slice(lt + 1, gt);
  // Split on top-level commas only (good enough for the common 1-2 arg case).
  const parts = splitTopLevel(inner);
  if (parts.length === 0) return null;
  return simpleName(stripGenerics(parts[parts.length - 1].trim()));
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '<') depth += 1;
    else if (ch === '>') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim().length > 0) out.push(cur);
  return out;
}

function buildResolverIndex(files: SourceFileIR[]): ResolverIndex {
  const byName = new Map<string, ClassEntry>();
  const implsByInterface = new Map<string, ClassEntry[]>();
  for (const file of files) {
    if (!file || !Array.isArray(file.classes)) continue;
    for (const cls of file.classes) {
      if (!cls || typeof cls.name !== 'string') continue;
      const entry: ClassEntry = { cls, file, fqn: fqnOf(file, cls) };
      byName.set(cls.name, entry);
      if (!cls.isInterface && Array.isArray(cls.implements)) {
        for (const iface of cls.implements) {
          const base = stripGenerics(simpleName(iface));
          const list = implsByInterface.get(base) ?? [];
          list.push(entry);
          implsByInterface.set(base, list);
        }
      }
    }
  }
  return { byName, implsByInterface };
}

// ---------------------------------------------------------------------------
// Class / method predicates
// ---------------------------------------------------------------------------

function isController(cls: ClassIR): boolean {
  return CONTROLLER_ANNOTATIONS.some((n) => hasAnnotation(cls.annotations ?? [], n));
}

function isMappingMethod(m: FunctionIR): boolean {
  return ENDPOINT_ANNOTATIONS.some((n) => hasAnnotation(m.annotations ?? [], n));
}

function isAsyncMethod(m: FunctionIR): boolean {
  return ASYNC_METHOD_ANNOTATIONS.some((n) => hasAnnotation(m.annotations ?? [], n));
}

function isServiceClass(cls: ClassIR): boolean {
  if (SERVICE_STEREOTYPES.some((n) => hasAnnotation(cls.annotations ?? [], n))) return true;
  if (hasAnnotation(cls.annotations ?? [], TRANSACTIONAL_ANNOTATION)) return true;
  // Method-level @Transactional also marks a service-flavoured bean.
  if ((cls.methods ?? []).some((m) => hasAnnotation(m.annotations ?? [], TRANSACTIONAL_ANNOTATION))) {
    return true;
  }
  return false;
}

function fieldByName(cls: ClassIR, receiver: string): FieldIR | undefined {
  return (cls.fields ?? []).find((f) => f.name === receiver);
}

function methodByName(cls: ClassIR, name: string): FunctionIR | undefined {
  return (cls.methods ?? []).find((m) => m.name === name);
}

function methodIdOf(entry: ClassEntry, m: FunctionIR): string {
  if (m.methodId) return m.methodId;
  const params = (m.parameters ?? []).map((p) => simpleName(stripGenerics(p.type))).join(',');
  return `${entry.fqn}#${m.name}(${params})`;
}

// ---------------------------------------------------------------------------
// Endpoint identity (mirror the data-effect resolver's path composition exactly
// so the source endpoint NAME matches the emitted `endpoints` candidate name and
// resolves BY NAME at save-back). A single-verb / single-path mapping yields
// exactly one name.
// ---------------------------------------------------------------------------

function stripArrayBracesAndQuotes(value: string): string {
  let v = value.trim();
  if (v.startsWith('{') && v.endsWith('}')) {
    v = v.slice(1, -1).trim();
    if (v.includes(',')) v = v.split(',')[0].trim();
  }
  return v.replace(/^["']|["']$/g, '');
}

function normalisePath(path: string): string {
  let v = stripArrayBracesAndQuotes(path);
  if (!v.startsWith('/')) v = '/' + v;
  if (v.length > 1 && v.endsWith('/')) v = v.slice(0, -1);
  return v;
}

function composeFullPath(basePath: string, methodPath: string): string {
  const base = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  const method = methodPath.startsWith('/') ? methodPath : '/' + methodPath;
  if (!base && !methodPath) return '/';
  if (!base) return method;
  if (!methodPath) return base;
  return base + method;
}

function extractBasePath(cls: ClassIR): string {
  const rm = findAnnotation(cls.annotations ?? [], 'RequestMapping');
  if (!rm) return '';
  const val = annotationArg(rm, 'value') || annotationArg(rm, 'path');
  return val ? normalisePath(val) : '';
}

function splitBraceList(raw: string): string[] {
  let v = raw.trim();
  if (v.startsWith('{') && v.endsWith('}')) v = v.slice(1, -1);
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const HTTP_METHOD_TOKENS = new Set(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE']);

function extractHttpMethods(m: FunctionIR): string[] {
  for (const [ann, httpMethod] of Object.entries(HTTP_METHOD_ANNOTATIONS)) {
    if (hasAnnotation(m.annotations ?? [], ann)) return [httpMethod];
  }
  const rm = findAnnotation(m.annotations ?? [], 'RequestMapping');
  if (rm) {
    const methodArg = annotationArg(rm, 'method');
    if (methodArg) {
      const verbs: string[] = [];
      for (const member of splitBraceList(methodArg)) {
        const parts = member.split('.');
        const token = parts[parts.length - 1].toUpperCase();
        if (HTTP_METHOD_TOKENS.has(token) && !verbs.includes(token)) verbs.push(token);
      }
      return verbs.length > 0 ? verbs : ['GET'];
    }
    return ['GET'];
  }
  return ['GET'];
}

function extractMethodPaths(m: FunctionIR): string[] {
  for (const ann of ENDPOINT_ANNOTATIONS) {
    const a = findAnnotation(m.annotations ?? [], ann);
    if (!a) continue;
    const raw = annotationArg(a, 'value') || annotationArg(a, 'path');
    if (!raw) return [''];
    const members = splitBraceList(raw);
    if (members.length === 0) return [''];
    const paths: string[] = [];
    for (const member of members) {
      const p = normalisePath(member);
      if (!paths.includes(p)) paths.push(p);
    }
    return paths.length > 0 ? paths : [''];
  }
  return [''];
}

function endpointNamesFor(cls: ClassIR, m: FunctionIR): string[] {
  const basePath = extractBasePath(cls);
  const verbs = extractHttpMethods(m);
  const paths = extractMethodPaths(m);
  const names: string[] = [];
  for (const verb of verbs) {
    for (const methodPath of paths) {
      const name = `${verb} ${composeFullPath(basePath, methodPath)}`;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names.length > 0 ? names : [`GET ${composeFullPath(basePath, '')}`];
}

// ---------------------------------------------------------------------------
// Outbound call-site detection
// ---------------------------------------------------------------------------

/** A detected outbound site within a single method body (pre-attribution). */
interface OutboundSite {
  integrationKind: IntegrationKind;
  /** Resolved verbatim target, or null when the literal could not be resolved. */
  target: string | null;
  /** For unresolved: a reason + the raw detail text. */
  unresolvedReason?: 'non_literal_target' | 'missing_target_arg';
  unresolvedDetail?: string;
  httpVerb?: string;
  messagingOperation?: string;
  payloadHint?: string;
  confidence: number;
  callLine: number;
}

/** Is `s` a usable literal (not a truncated non-literal placeholder / empty)? */
function isUsableLiteral(s: string | undefined): s is string {
  if (s === undefined || s === null) return false;
  if (s.length === 0) return false;
  if (s.includes(PLACEHOLDER_ELLIPSIS)) return false;
  // A method-call / concatenation placeholder retains parens / operators / dots
  // that a bare URL / topic / queue token does not. We accept URLs (which carry
  // `/`, `:`) and dotted hosts, but reject obvious code fragments.
  if (/[()]/.test(s)) return false;
  if (/\s\+\s|"\s*\+|\+\s*"/.test(s)) return false;
  return true;
}

/**
 * Heuristic: does the resolved target look PURELY EXTERNAL (a bare absolute URL
 * / topic / queue / store token with no in-model counterpart)? A SHAPE hint only
 * -- the real decision is the consumer's (it can match the host/path against the
 * discovered interface set). An absolute `http(s)://` URL, a store sentinel
 * (`redis`/`mongodb`/...), or a topic/queue token => external-looking.
 */
function looksExternalTarget(target: string, kind: IntegrationKind): boolean {
  if (/^https?:\/\//i.test(target)) return true;
  if (kind === 'cache-store' || kind === 'secondary-store') return true;
  if (kind === 'object-store' || kind === 'file-store') return true;
  if (kind === 'email' || kind === 'sms') return true;
  // A relative internal base path (`/inventory/...`) is potentially modellable.
  if (target.startsWith('/')) return false;
  // A bare topic/queue/exchange token (no scheme, no leading slash) is external.
  return true;
}

/**
 * Classify a single call within a method body as an outbound site, reading the
 * receiver field's declared type + the method name + the literal `call.args`.
 * Returns null when the call is NOT an outbound integration.
 */
function classifyOutboundCall(owningClass: ClassIR, call: CallIR): OutboundSite | null {
  const methodName = call.methodName ?? '';
  if (!methodName) return null;
  const receiver = call.receiver;
  const args = Array.isArray(call.args) ? call.args : [];
  const line = typeof call.line === 'number' ? call.line : 0;

  // Resolve the receiver field's declared TYPE (only simple-identifier receivers
  // that name an autowired/declared field qualify -- a chained receiver cannot).
  let receiverType: string | null = null;
  let receiverField: FieldIR | undefined;
  if (receiver && !SELF_RECEIVERS.has(receiver)) {
    receiverField = fieldByName(owningClass, receiver);
    if (receiverField) receiverType = stripGenerics(simpleName(receiverField.type));
  }

  // --- HTTP clients ------------------------------------------------------
  if (
    receiverType &&
    HTTP_CLIENT_TYPES.has(receiverType) &&
    HTTP_CLIENT_METHODS.has(methodName)
  ) {
    const verb = httpVerbFor(methodName);
    // The URL is the FIRST string-literal-shaped arg. RestTemplate verbs take the
    // URL first; WebClient/RestClient builder chains put the URL on a later
    // `.uri(...)` call (captured as its own CallIR with `uri` as the method --
    // handled below by the generic uri() rule).
    const urlArg = args.find((a) => isUsableLiteral(a) && /[:/]/.test(a));
    if (urlArg) {
      return {
        integrationKind: 'outbound-rest',
        target: urlArg,
        httpVerb: verb ?? undefined,
        confidence: 0.9,
        callLine: line,
      };
    }
    // An HTTP call whose URL is non-literal (built from a method/concatenation)
    // -- record an unresolved site (a finding), never a guessed target. Skip the
    // builder entry verbs that legitimately take no URL here (`get()`/`post()`).
    if (methodName !== 'get' && methodName !== 'post' && methodName !== 'method' && methodName !== 'newCall') {
      const raw = args[0] ?? `${receiver}.${methodName}(...)`;
      return {
        integrationKind: 'outbound-rest',
        target: null,
        unresolvedReason: args.length === 0 ? 'missing_target_arg' : 'non_literal_target',
        unresolvedDetail: raw,
        httpVerb: verb ?? undefined,
        confidence: 0.4,
        callLine: line,
      };
    }
    return null;
  }

  // WebClient / RestClient `.uri("...")` chain -- the URL literal lives here.
  if (receiver && methodName === 'uri') {
    const urlArg = args.find((a) => isUsableLiteral(a) && /[:/]/.test(a));
    if (urlArg) {
      return {
        integrationKind: 'outbound-rest',
        target: urlArg,
        confidence: 0.75,
        callLine: line,
      };
    }
    return null;
  }

  // OkHttp `Request.Builder().url("...")` -- the URL literal lives on `.url(...)`.
  if (methodName === 'url') {
    const urlArg = args.find((a) => isUsableLiteral(a) && /[:/]/.test(a));
    if (urlArg) {
      return {
        integrationKind: 'outbound-rest',
        target: urlArg,
        confidence: 0.7,
        callLine: line,
      };
    }
    return null;
  }

  // --- Messaging producers ----------------------------------------------
  if (
    receiverType &&
    MESSAGING_PRODUCER_TYPES.has(receiverType) &&
    MESSAGING_PRODUCER_METHODS.has(methodName)
  ) {
    // Rabbit `convertAndSend(exchange, routingKey, payload)` -> the EXCHANGE is
    // the first literal; everything else -> the topic/queue is the first literal.
    const topicArg = args.find((a) => isUsableLiteral(a));
    // Payload-type hint: the LAST generic arg on the template type
    // (`KafkaTemplate<String, OrderEvent>` -> `OrderEvent`).
    const payloadHint = receiverField ? lastGenericArg(receiverField.type) : null;
    if (topicArg) {
      return {
        integrationKind: 'messaging-producer',
        target: topicArg,
        messagingOperation: methodName,
        payloadHint: payloadHint ?? undefined,
        confidence: 0.9,
        callLine: line,
      };
    }
    // A producer whose destination is non-literal (a config-driven topic) ->
    // unresolved finding, never a guessed topic.
    return {
      integrationKind: 'messaging-producer',
      target: null,
      unresolvedReason: args.length === 0 ? 'missing_target_arg' : 'non_literal_target',
      unresolvedDetail: args[0] ?? `${receiver}.${methodName}(...)`,
      messagingOperation: methodName,
      payloadHint: payloadHint ?? undefined,
      confidence: 0.4,
      callLine: line,
    };
  }

  if (!receiverType) return null;

  // --- Cache / secondary stores -----------------------------------------
  for (const store of STORE_TYPE_TARGETS) {
    if (store.types.has(receiverType)) {
      return {
        integrationKind: store.kind,
        target: store.target,
        confidence: 0.75,
        callLine: line,
      };
    }
  }

  // --- Object store (S3) -------------------------------------------------
  if (OBJECT_STORE_TYPES.has(receiverType) && OBJECT_STORE_METHODS.has(methodName)) {
    // First literal arg is the bucket; second (when present) is the key.
    const literals = args.filter((a) => isUsableLiteral(a));
    const bucket = literals[0];
    const key = literals[1];
    const target = bucket ? (key ? `${bucket}/${key}` : bucket) : 's3';
    return {
      integrationKind: 'object-store',
      target,
      confidence: bucket ? 0.8 : 0.5,
      callLine: line,
    };
  }

  // --- Email / SMS -------------------------------------------------------
  if (EMAIL_TYPES.has(receiverType) && EMAIL_METHODS.has(methodName)) {
    return { integrationKind: 'email', target: 'email', confidence: 0.7, callLine: line };
  }
  if (SMS_TYPES.has(receiverType) && SMS_METHODS.has(methodName)) {
    const topicArg = args.find((a) => isUsableLiteral(a));
    return {
      integrationKind: 'sms',
      target: topicArg ?? 'sms',
      confidence: topicArg ? 0.7 : 0.5,
      callLine: line,
    };
  }

  return null;
}

/** All outbound sites detected directly within one method body. */
function detectOutboundSitesInMethod(owningClass: ClassIR, method: FunctionIR): OutboundSite[] {
  const out: OutboundSite[] = [];
  for (const call of method.calls ?? []) {
    if (!call) continue;
    try {
      const site = classifyOutboundCall(owningClass, call);
      if (site) out.push(site);
    } catch {
      // Per-call soft-fail -- one malformed call never poisons the method.
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Attribution: which endpoint/service OWNS each outbound site
// ---------------------------------------------------------------------------

/**
 * Accumulator threaded through resolution. Keyed dedup ensures one edge per
 * (source owner, resolved target) pair. We also record every (owningClass,
 * owningMethod) reached from a controller mapping so the later service-owned
 * sweep does NOT double-count an outbound call already attributed to an endpoint.
 */
interface Accumulator {
  resolved: ResolvedOutboundEdge[];
  unresolved: UnresolvedOutboundEdge[];
  /** Dedup key set: `${sourceName}=>${integrationKind}=>${target}`. */
  resolvedKeys: Set<string>;
  unresolvedKeys: Set<string>;
  /** `${className}#${methodName}` reached from ANY controller mapping. */
  endpointReachedMethods: Set<string>;
}

function reachKey(className: string, methodName: string): string {
  return `${className}#${methodName}`;
}

function pushResolved(acc: Accumulator, edge: ResolvedOutboundEdge): void {
  const key = `${edge.sourceName}=>${edge.integrationKind}=>${edge.target}`;
  if (acc.resolvedKeys.has(key)) return;
  acc.resolvedKeys.add(key);
  acc.resolved.push(edge);
}

function pushUnresolved(acc: Accumulator, edge: UnresolvedOutboundEdge): void {
  const key = `${edge.sourceName}=>${edge.integrationKind}=>${edge.callSiteFqn}=>${edge.callSiteLine}`;
  if (acc.unresolvedKeys.has(key)) return;
  acc.unresolvedKeys.add(key);
  acc.unresolved.push(edge);
}

/**
 * Emit edges for every outbound site in `method`, attributed to `sourceName`
 * (an endpoint identity OR a service class name per `sourceKind`).
 */
function emitSitesFor(
  acc: Accumulator,
  sourceKind: OutboundSourceKind,
  sourceName: string,
  owningEntry: ClassEntry,
  method: FunctionIR,
): void {
  const sites = detectOutboundSitesInMethod(owningEntry.cls, method);
  if (sites.length === 0) return;
  const callSiteFqn = `${owningEntry.fqn}#${method.name}`;
  for (const site of sites) {
    if (site.target !== null) {
      pushResolved(acc, {
        sourceKind,
        sourceName,
        integrationKind: site.integrationKind,
        target: site.target,
        targetLooksExternal: looksExternalTarget(site.target, site.integrationKind),
        httpVerb: site.httpVerb,
        messagingOperation: site.messagingOperation,
        payloadHint: site.payloadHint,
        confidence: site.confidence,
        ownerClassName: owningEntry.cls.name,
        ownerMethodName: method.name,
        callSiteFqn,
        callSiteLine: site.callLine,
        sourceFilePath: owningEntry.file.filePath,
      });
    } else {
      pushUnresolved(acc, {
        sourceKind,
        sourceName,
        integrationKind: site.integrationKind,
        reason: site.unresolvedReason ?? 'non_literal_target',
        detail: site.unresolvedDetail ?? '',
        ownerClassName: owningEntry.cls.name,
        ownerMethodName: method.name,
        callSiteFqn,
        callSiteLine: site.callLine,
        sourceFilePath: owningEntry.file.filePath,
      });
    }
  }
}

/**
 * Resolve an autowired-service field on `owningClass` to its concrete service
 * class entry (single-impl resolution for interfaces). Mirrors the data-effect
 * resolver's `asServiceField`.
 */
function resolveServiceField(field: FieldIR, index: ResolverIndex): ClassEntry | null {
  const typeName = stripGenerics(simpleName(field.type));
  const entry = index.byName.get(typeName);
  if (!entry) return null;
  if (!entry.cls.isInterface) {
    return isServiceClass(entry.cls) ? entry : null;
  }
  const impls = index.implsByInterface.get(typeName) ?? [];
  const serviceImpls = impls.filter((e) => isServiceClass(e.cls));
  if (serviceImpls.length === 1) return serviceImpls[0];
  if (impls.length === 1) return impls[0];
  return null;
}

/**
 * Walk a controller mapping method, attributing every outbound site reached
 * (directly, through a same-class helper, OR through an autowired @Service
 * method) to the CALLING ENDPOINT. Bounded by depth + a visited cycle guard.
 * Records each reached (class,method) so the service sweep skips it.
 */
function walkFromEndpoint(
  acc: Accumulator,
  endpointNames: string[],
  controllerEntry: ClassEntry,
  method: FunctionIR,
  index: ResolverIndex,
  visited: Set<string>,
  helperDepth: number,
  serviceDepthBudget: number,
): void {
  const methodKey = methodIdOf(controllerEntry, method);
  if (visited.has(methodKey)) return;
  visited.add(methodKey);

  // Mark this method reached-from-endpoint so the service sweep doesn't re-own
  // its outbound sites, then attribute its DIRECT outbound sites to the endpoint
  // (one edge per endpoint-name variant).
  acc.endpointReachedMethods.add(reachKey(controllerEntry.cls.name, method.name));
  for (const name of endpointNames) {
    emitSitesFor(acc, 'endpoint', name, controllerEntry, method);
  }

  for (const call of method.calls ?? []) {
    if (!call) continue;
    const calleeName = call.methodName ?? '';
    if (!calleeName) continue;

    // (a) Same-class helper -> inline (the outbound site, if any, attributes to
    //     this endpoint via the recursion's direct-site emit).
    if (SELF_RECEIVERS.has(call.receiver)) {
      const helper = methodByName(controllerEntry.cls, calleeName);
      if (helper && helper.name !== method.name && helperDepth < MAX_HELPER_DEPTH) {
        walkFromEndpoint(
          acc,
          endpointNames,
          controllerEntry,
          helper,
          index,
          visited,
          helperDepth + 1,
          serviceDepthBudget,
        );
      }
      continue;
    }

    // (b) Call on an autowired @Service field -> follow into the service method;
    //     its outbound sites attribute to THIS endpoint.
    if (serviceDepthBudget <= 0) continue;
    const field = call.receiver ? fieldByName(controllerEntry.cls, call.receiver) : undefined;
    if (!field) continue;
    const serviceEntry = resolveServiceField(field, index);
    if (!serviceEntry) continue;
    const serviceMethod = methodByName(serviceEntry.cls, calleeName);
    if (!serviceMethod) continue;

    walkServiceFromEndpoint(
      acc,
      endpointNames,
      serviceEntry,
      serviceMethod,
      index,
      new Set<string>(),
      serviceDepthBudget - 1,
    );
  }
}

/**
 * Walk a service method reached FROM an endpoint, attributing its outbound sites
 * (and those of any same-class helper it calls, and any further autowired
 * service it delegates to) to the calling endpoint. Bounded.
 */
function walkServiceFromEndpoint(
  acc: Accumulator,
  endpointNames: string[],
  serviceEntry: ClassEntry,
  method: FunctionIR,
  index: ResolverIndex,
  visited: Set<string>,
  serviceDepthBudget: number,
): void {
  const methodKey = methodIdOf(serviceEntry, method);
  if (visited.has(methodKey)) return;
  visited.add(methodKey);

  acc.endpointReachedMethods.add(reachKey(serviceEntry.cls.name, method.name));
  for (const name of endpointNames) {
    emitSitesFor(acc, 'endpoint', name, serviceEntry, method);
  }

  if (serviceDepthBudget <= 0) return;
  for (const call of method.calls ?? []) {
    if (!call) continue;
    const calleeName = call.methodName ?? '';
    if (!calleeName) continue;

    if (SELF_RECEIVERS.has(call.receiver)) {
      const helper = methodByName(serviceEntry.cls, calleeName);
      if (helper && helper.name !== method.name) {
        walkServiceFromEndpoint(
          acc,
          endpointNames,
          serviceEntry,
          helper,
          index,
          visited,
          serviceDepthBudget - 1,
        );
      }
      continue;
    }
    const field = call.receiver ? fieldByName(serviceEntry.cls, call.receiver) : undefined;
    if (!field) continue;
    const nextService = resolveServiceField(field, index);
    if (!nextService) continue;
    const nextMethod = methodByName(nextService.cls, calleeName);
    if (!nextMethod) continue;
    walkServiceFromEndpoint(
      acc,
      endpointNames,
      nextService,
      nextMethod,
      index,
      new Set<string>(),
      serviceDepthBudget - 1,
    );
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Resolve outbound integration edges across the scanned IR.
 *
 * Pass 1: walk every inbound controller mapping (REUSING Spec #1's
 * controller->service walk shape) and attribute every reachable outbound site to
 * the CALLING ENDPOINT.
 *
 * Pass 2: sweep every @Service/@Component method NOT already reached from a
 * controller mapping and attribute its outbound sites to the OWNING SERVICE.
 *
 * Deduped one-per-(source owner, resolved target) pair. Soft-fails (never
 * throws) on malformed input.
 */
export function resolveOutboundIntegrations(files: SourceFileIR[]): OutboundResolverOutput {
  const acc: Accumulator = {
    resolved: [],
    unresolved: [],
    resolvedKeys: new Set<string>(),
    unresolvedKeys: new Set<string>(),
    endpointReachedMethods: new Set<string>(),
  };

  try {
    if (!Array.isArray(files) || files.length === 0) {
      return { resolved: [], unresolved: [] };
    }
    const index = buildResolverIndex(files);

    // Pass 1 -- endpoint-attributed outbound sites.
    for (const file of files) {
      if (!file || !Array.isArray(file.classes)) continue;
      for (const cls of file.classes) {
        if (!cls || !isController(cls)) continue;
        const controllerEntry: ClassEntry = { cls, file, fqn: fqnOf(file, cls) };
        for (const method of cls.methods ?? []) {
          if (!isMappingMethod(method)) continue;
          if (isAsyncMethod(method)) continue;
          const endpointNames = endpointNamesFor(cls, method);
          walkFromEndpoint(
            acc,
            endpointNames,
            controllerEntry,
            method,
            index,
            new Set<string>(),
            0,
            MAX_RESOLVE_DEPTH,
          );
        }
      }
    }

    // Pass 2 -- service-owned outbound sites (anything not reached from an
    // endpoint). A controller's NON-mapping methods are also swept here only if
    // the class is service-flavoured; controllers are not, so their helpers stay
    // endpoint-owned. We sweep @Service/@Component/@Transactional classes.
    for (const file of files) {
      if (!file || !Array.isArray(file.classes)) continue;
      for (const cls of file.classes) {
        if (!cls) continue;
        if (!isServiceClass(cls)) continue;
        const owningEntry: ClassEntry = { cls, file, fqn: fqnOf(file, cls) };
        for (const method of cls.methods ?? []) {
          // Skip methods already attributed to an endpoint (no double-count).
          if (acc.endpointReachedMethods.has(reachKey(cls.name, method.name))) continue;
          emitSitesFor(acc, 'service', cls.name, owningEntry, method);
        }
      }
    }
  } catch (err) {
    // Whole-resolver soft-fail -- a malformed IR cannot poison the run. Return
    // whatever was accumulated before the throw.
    console.warn(
      `[outboundIntegrationResolver] resolution failed; continuing with partial output:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return { resolved: acc.resolved, unresolved: acc.unresolved };
}

// Re-export the call shape so consumers can introspect (unused import guard).
export type { CallIR };
