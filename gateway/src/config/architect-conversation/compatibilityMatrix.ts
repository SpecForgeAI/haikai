/**
 * Deterministic compatibility matrix (code pre-filter for grey questions) —
 * Target-conversation tech-stack constraints
 * (Spec 2026-06-24-target-conversation-tech-stack-constraints, FR3
 * deterministic half).
 *
 * PURE DATA + A PURE RESOLVER. No I/O, no LLM, no orchestration in this file.
 *
 * The `grey` questions (9 of them) are NOT hard-branched, but many of their
 * candidate choices are nonetheless CLEAR-CUT compatible or incompatible given
 * the foundational answers (e.g. Spring Actuator only makes sense under Spring
 * Boot; Resilience4j is JVM-only). This matrix resolves those clear-cut cases
 * deterministically so the LLM-judge in Task Group 3 only ever adjudicates the
 * genuinely ambiguous residue (`undecided`).
 *
 * This is the code-pre-filter half of the code-pre-filter-then-LLM pattern
 * (mirroring the vuln-dedup shape). Resolving everything that is clear-cut here
 * keeps the LLM off the happy path entirely.
 *
 * Validated at load time by `validateQuestionLibrary` (every `grey` entry must
 * be covered by a branch-list OR a matrix rule here, else the loader throws).
 */

import {
  engineBucketOf,
  languageBucketOf,
  uiBucketOf,
} from './branchLists';

/** Per-candidate deterministic verdict. `undecided` => escalate to LLM-judge. */
export type CompatibilityVerdict = 'keep' | 'hide' | 'undecided';

/**
 * A deterministic rule for one grey question. Given the candidate choice and
 * the foundational answers gathered so far, returns a verdict. Returning
 * `undecided` for a candidate means "code can't decide — let the LLM-judge
 * adjudicate this one".
 *
 * Rules are PURE functions of (candidate, answers). They never call out.
 */
export type CompatibilityRule = (
  candidate: string,
  answers: Readonly<Record<string, string | readonly string[]>>
) => CompatibilityVerdict;

function languageBucket(
  answers: Readonly<Record<string, string | readonly string[]>>
): ReturnType<typeof languageBucketOf> {
  const v = answers['service.language'];
  return languageBucketOf(typeof v === 'string' ? v : undefined);
}

function isSpringBoot(
  answers: Readonly<Record<string, string | readonly string[]>>
): boolean {
  const fw = answers['service.framework'];
  return typeof fw === 'string' && fw.toLowerCase().includes('spring boot');
}

function frameworkKnown(
  answers: Readonly<Record<string, string | readonly string[]>>
): boolean {
  return typeof answers['service.framework'] === 'string';
}

/**
 * Deterministic compatibility rules for the clear-cut portion of each grey
 * question. Anything a rule returns `undecided` for falls through to the
 * LLM-judge (Task Group 3).
 */
export const COMPATIBILITY_MATRIX: Readonly<
  Record<string, CompatibilityRule>
> = {
  // service.healthcheck (G, keys off service.framework):
  // Spring Actuator only makes sense under Spring Boot. Other contracts are
  // framework-agnostic => keep.
  'service.healthcheck': (candidate, answers) => {
    const isActuator = candidate.toLowerCase().includes('actuator');
    if (!frameworkKnown(answers)) return isActuator ? 'undecided' : 'keep';
    if (isActuator) return isSpringBoot(answers) ? 'keep' : 'hide';
    return 'keep';
  },

  // api.versioning (G, keys off api.protocol): gRPC strongly implies
  // header-based; but URL-path / content-negotiation remain plausible across
  // REST/GraphQL, so only the clearly-incompatible "URL path under pure gRPC"
  // case is decided; everything else is undecided/keep.
  'api.versioning': (candidate, answers) => {
    const protocols = answers['api.protocol'];
    const list = Array.isArray(protocols)
      ? protocols.map((p) => String(p).toLowerCase())
      : typeof protocols === 'string'
        ? [protocols.toLowerCase()]
        : [];
    const onlyGrpc =
      list.length > 0 && list.every((p) => p.includes('grpc'));
    if (onlyGrpc && candidate.toLowerCase().includes('url path')) return 'hide';
    return 'keep';
  },

  // api.errorContract (G, keys off api.protocol):
  // gRPC status only under gRPC; GraphQL errors[] only under GraphQL. RFC 7807
  // / custom JSON envelope are REST-leaning but broadly usable => keep.
  'api.errorContract': (candidate, answers) => {
    const protocols = answers['api.protocol'];
    const list = Array.isArray(protocols)
      ? protocols.map((p) => String(p).toLowerCase())
      : typeof protocols === 'string'
        ? [protocols.toLowerCase()]
        : [];
    if (list.length === 0) return 'keep';
    const hasGrpc = list.some((p) => p.includes('grpc'));
    const hasGraphql = list.some((p) => p.includes('graphql'));
    const c = candidate.toLowerCase();
    if (c.includes('grpc status')) return hasGrpc ? 'keep' : 'hide';
    if (c.includes('graphql errors')) return hasGraphql ? 'keep' : 'hide';
    return 'keep';
  },

  // domain.mappingStrategy (G, keys off service.language):
  // MapStruct / ModelMapper are JVM-only. Non-JVM => hide them (manual/direct
  // remain). JVM => keep. Manual / direct exposure are always keep.
  'domain.mappingStrategy': (candidate, answers) => {
    const c = candidate.toLowerCase();
    const jvmOnly = c.includes('mapstruct') || c.includes('modelmapper');
    if (!jvmOnly) return 'keep';
    const bucket = languageBucket(answers);
    if (bucket === undefined) return 'undecided';
    return bucket === 'jvm' ? 'keep' : 'hide';
  },

  // ui.designSystem (G, keys off ui.framework):
  // Mostly cross-framework. MUI / Chakra are React-leaning but technically
  // usable elsewhere => genuinely grey under a non-React framework => undecided
  // (LLM-judge). Tailwind + headless and in-house are always cross-framework
  // => keep.
  'ui.designSystem': (candidate, answers) => {
    const c = candidate.toLowerCase();
    const crossFramework =
      c.includes('tailwind') || c.includes('in-house');
    if (crossFramework) return 'keep';
    const ui = answers['ui.framework'];
    const bucket = uiBucketOf(typeof ui === 'string' ? ui : undefined);
    if (bucket === undefined) return 'keep';
    const reactLeaning =
      c.includes('mui') || c.includes('chakra') || c.includes('ant design');
    if (!reactLeaning) return 'keep';
    return bucket === 'react' ? 'keep' : 'undecided';
  },

  // logging.framework (G, keys off service.language):
  // SLF4J/Logback/Log4j are JVM; pino is Node; structlog is Python; zap is Go.
  // Deterministic hide of the off-language libraries; the universal ones (none)
  // stay. JVM keeps SLF4J/Log4j.
  'logging.framework': (candidate, answers) => {
    const bucket = languageBucket(answers);
    if (bucket === undefined) return 'undecided';
    const c = candidate.toLowerCase();
    const jvm = c.includes('slf4j') || c.includes('log4j') || c.includes('logback');
    const node = c.includes('pino');
    const python = c.includes('structlog');
    const go = c.includes('zap');
    if (!jvm && !node && !python && !go) return 'keep';
    if (bucket === 'jvm') return jvm ? 'keep' : 'hide';
    if (bucket === 'node') return node ? 'keep' : 'hide';
    if (bucket === 'python') return python ? 'keep' : 'hide';
    if (bucket === 'go') return go ? 'keep' : 'hide';
    // dotnet: none of these are native => undecided (LLM-judge).
    return 'undecided';
  },

  // metrics.framework (G, keys off service.language):
  // Micrometer is JVM; prom-client is Node. OpenTelemetry metrics is
  // CROSS-LANGUAGE => always keep. "none" => keep.
  'metrics.framework': (candidate, answers) => {
    const c = candidate.toLowerCase();
    if (c.includes('opentelemetry') || c === 'none') return 'keep';
    const bucket = languageBucket(answers);
    if (bucket === undefined) return 'undecided';
    const isMicrometer = c.includes('micrometer');
    const isPromClient = c.includes('prom-client');
    if (isMicrometer) return bucket === 'jvm' ? 'keep' : 'hide';
    if (isPromClient) return bucket === 'node' ? 'keep' : 'hide';
    return 'keep';
  },

  // interservice.messageFormat (G, keys off interservice.asyncBus):
  // Kafka strongly implies Avro + Schema Registry; SQS => plain JSON; but JSON
  // Schema / Protobuf / plain JSON are broadly usable across buses => the only
  // clear-cut hide is "Avro + Schema Registry" when the bus is explicitly NOT
  // Kafka and IS set; otherwise keep.
  'interservice.messageFormat': (candidate, answers) => {
    const bus = answers['interservice.asyncBus'];
    if (typeof bus !== 'string') return 'keep';
    const b = bus.toLowerCase();
    const c = candidate.toLowerCase();
    if (c.includes('avro')) {
      if (b.includes('kafka')) return 'keep';
      if (b === 'none') return 'hide';
      return 'undecided';
    }
    return 'keep';
  },

  // interservice.retryStrategy (G, keys off service.language):
  // Resilience4j is JVM-only. Non-JVM => hide it (exponential / fail-fast stay).
  'interservice.retryStrategy': (candidate, answers) => {
    const c = candidate.toLowerCase();
    if (!c.includes('resilience4j')) return 'keep';
    const bucket = languageBucket(answers);
    if (bucket === undefined) return 'undecided';
    return bucket === 'jvm' ? 'keep' : 'hide';
  },
};

/** True iff this grey question has a deterministic compatibility rule. */
export function hasCompatibilityRule(questionCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    COMPATIBILITY_MATRIX,
    questionCode
  );
}

/**
 * Resolve a single candidate choice deterministically. Returns `undecided`
 * (escalate to the LLM-judge) when there is no rule for the code or the rule
 * itself can't decide.
 */
export function resolveCompatibility(
  questionCode: string,
  candidate: string,
  answers: Readonly<Record<string, string | readonly string[]>>
): CompatibilityVerdict {
  const rule = COMPATIBILITY_MATRIX[questionCode];
  if (!rule) return 'undecided';
  return rule(candidate, answers);
}
