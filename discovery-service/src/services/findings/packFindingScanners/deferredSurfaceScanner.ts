/**
 * Deferred-inbound-surface scanner (Spring / Spring Classic ONLY).
 *
 * Spec: 2026-05-30 Inbound Surface Completeness (Spec #4), Task Group 7.
 *
 * A NEW deterministic post-Stage-2 scanner that walks the Java language pack's
 * Stage-1 IR (class annotations + superclass) AND the file paths in the IR set
 * and emits ONE `deferred_inbound_surface` evidence-gap Finding per detected
 * inbound ENTRY-POINT surface that v1 deliberately does NOT model as an
 * endpoint:
 *
 *  - **GraphQL** -- `@QueryMapping` / `@MutationMapping` / `@SchemaMapping` /
 *    `@SubscriptionMapping` on a Java method/class, OR a `.graphqls` /
 *    `.graphql` schema file.
 *  - **gRPC** -- a class extending a `*ImplBase` / `BindableService` gRPC base
 *    OR annotated `@GrpcService`, OR a `.proto` file.
 *  - **WebSocket-STOMP** -- `@MessageMapping` / `@SubscribeMapping` on a Java
 *    method/class.
 *  - **Spring Batch** -- `@EnableBatchProcessing` on a class, OR a `@Bean`
 *    factory method whose return type is a Spring Batch `Job` / `Step`.
 *
 * Finding-and-defer: these surfaces are rare in the Spring-Classic -> Boot
 * migration target and are OUT of full modelling for v1 (they are NOT emitted
 * as `endpoints` / `interfaces` candidates). But an unobserved entry point is an
 * entry point the runtime equivalence harness silently never tests, so the
 * scanner records each surface's PRESENCE as a Finding -- never a silent drop,
 * never a fabricated endpoint.
 *
 * Reuses the EXISTING evidence-gap machinery: it returns `FindingEmitInput[]`
 * via `buildDeferredSurfacePresentFinding` (the `emissionSources.ts` builder)
 * onto the SAME caller-emit boundary every other pack scanner uses -- no
 * parallel emitter, no `FindingEmitter` fork (the emitter normalizes + dedupes
 * + soft-fails). Per-file detection failures are caught so a single malformed IR
 * cannot poison the run; the shim in `index.ts` ALSO catches at the scanner
 * boundary (belt + braces, W4-aligned).
 *
 * Scope: Java-annotation surfaces are gated to `language === 'java'` files
 * (Spring / Spring Classic). Schema FILES (`.proto` / `.graphqls` / `.graphql`)
 * are detected by file-path extension regardless of `language`. Non-Java stacks
 * with NONE of these signals are a clean no-op, and Actuator endpoints carry
 * none of these signals so emit nothing. Capped at
 * `MAX_FINDINGS_PER_TYPE_PER_RUN` per run.
 */

import type {
  SourceFileIR,
  ClassIR,
  AnnotationIR,
} from '../../extensionPacks';
import type { FindingEmitInput } from '../FindingEmitter';
import { buildDeferredSurfacePresentFinding } from '../emissionSources';
import { MAX_FINDINGS_PER_TYPE_PER_RUN } from './constants';
import type { PackFindingScannerInput } from './index';

type DeferredSurface = 'graphql' | 'grpc' | 'websocket_stomp' | 'spring_batch';

// ----------------------------------------------------------------------------
// Signal sets
// ----------------------------------------------------------------------------

/** GraphQL handler-method annotations (Spring for GraphQL). */
const GRAPHQL_ANNOTATIONS: ReadonlySet<string> = new Set([
  'QueryMapping',
  'MutationMapping',
  'SubscriptionMapping',
  'SchemaMapping',
  'BatchMapping',
]);

/** WebSocket-STOMP message-handler annotations. */
const STOMP_ANNOTATIONS: ReadonlySet<string> = new Set([
  'MessageMapping',
  'SubscribeMapping',
]);

/** gRPC class-level service annotations. */
const GRPC_ANNOTATIONS: ReadonlySet<string> = new Set([
  'GrpcService',
]);

/** Spring Batch class-level enabler. */
const SPRING_BATCH_CLASS_ANNOTATIONS: ReadonlySet<string> = new Set([
  'EnableBatchProcessing',
]);

/** Spring Batch `@Bean` factory return types that indicate a batch entry point. */
const SPRING_BATCH_BEAN_RETURN_TYPES: ReadonlySet<string> = new Set([
  'Job',
  'Step',
]);

/** gRPC generated-base superclass markers (a class extending one of these is a
 *  gRPC service impl). `BindableService` is the interface; `*ImplBase` is the
 *  generated abstract base. */
function extendsGrpcBase(cls: ClassIR): boolean {
  const ext = (cls.extends ?? '').trim();
  if (!ext) return false;
  const simple = ext.includes('.') ? ext.slice(ext.lastIndexOf('.') + 1) : ext;
  if (simple === 'BindableService') return true;
  // Generated gRPC service base classes are named `<Service>Grpc.<Service>ImplBase`
  // -> simple name ends `ImplBase`.
  return /ImplBase$/.test(simple);
}

// ----------------------------------------------------------------------------
// Cap helpers (mirror nonDeterministicEndpointScanner / springClassicFindingScanner)
// ----------------------------------------------------------------------------

function underCap(counts: Map<string, number>): boolean {
  return (counts.get('evidence_gap') ?? 0) < MAX_FINDINGS_PER_TYPE_PER_RUN;
}
function bumpCap(counts: Map<string, number>): void {
  counts.set('evidence_gap', (counts.get('evidence_gap') ?? 0) + 1);
}

// ----------------------------------------------------------------------------
// IR helpers
// ----------------------------------------------------------------------------

function annotationSimpleName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1) : name;
}

function classHasAnnotationIn(cls: ClassIR, names: ReadonlySet<string>): string | null {
  for (const a of cls.annotations) {
    const simple = annotationSimpleName(a.name);
    if (names.has(simple)) return `@${simple}`;
  }
  return null;
}

function methodHasAnnotationIn(cls: ClassIR, names: ReadonlySet<string>): string | null {
  for (const m of cls.methods) {
    for (const a of m.annotations) {
      const simple = annotationSimpleName(a.name);
      if (names.has(simple)) return `@${simple}`;
    }
  }
  return null;
}

/** A `@Bean` method whose return type is a Spring Batch `Job` / `Step`. */
function hasBatchBeanFactory(cls: ClassIR): string | null {
  for (const m of cls.methods) {
    const isBean = m.annotations.some((a) => annotationSimpleName(a.name) === 'Bean');
    if (!isBean) continue;
    const ret = (m.returnType ?? '').trim();
    const lt = ret.indexOf('<');
    const base = (lt > 0 ? ret.slice(0, lt) : ret).trim();
    const simple = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : base;
    if (SPRING_BATCH_BEAN_RETURN_TYPES.has(simple)) return `@Bean ${simple}`;
  }
  return null;
}

function isSchemaFile(filePath: string): { surface: DeferredSurface; signal: string } | null {
  const lc = filePath.toLowerCase();
  if (lc.endsWith('.proto')) return { surface: 'grpc', signal: '.proto schema file' };
  if (lc.endsWith('.graphqls') || lc.endsWith('.graphql')) {
    return { surface: 'graphql', signal: 'GraphQL schema file' };
  }
  return null;
}

// ----------------------------------------------------------------------------
// Per-file detection
// ----------------------------------------------------------------------------

/**
 * Detect each deferred surface present in one IR file. Returns at most ONE
 * presence-signal per surface kind for the file (so a file with three
 * `@QueryMapping` methods yields ONE GraphQL finding, not three). Java-annotation
 * surfaces require `ir.language === 'java'`; schema files are detected by path.
 */
function detectSurfacesInFile(
  ir: SourceFileIR,
): Array<{ surface: DeferredSurface; signal: string }> {
  const hits = new Map<DeferredSurface, string>();
  const add = (surface: DeferredSurface, signal: string): void => {
    if (!hits.has(surface)) hits.set(surface, signal);
  };

  // (1) Schema files by extension -- any language (a `.proto` / `.graphqls`
  // file is an entry-point contract regardless of how the IR tagged it).
  const schema = isSchemaFile(ir.filePath);
  if (schema) add(schema.surface, schema.signal);

  // (2) Java-annotation surfaces (Spring / Spring Classic only).
  if (ir.language === 'java') {
    for (const cls of ir.classes) {
      // GraphQL: handler annotations on the class or its methods.
      const gqlClass = classHasAnnotationIn(cls, GRAPHQL_ANNOTATIONS);
      const gqlMethod = gqlClass ? null : methodHasAnnotationIn(cls, GRAPHQL_ANNOTATIONS);
      if (gqlClass || gqlMethod) add('graphql', gqlClass ?? gqlMethod ?? '@QueryMapping');

      // WebSocket-STOMP: message-mapping annotations on the class or methods.
      const stompClass = classHasAnnotationIn(cls, STOMP_ANNOTATIONS);
      const stompMethod = stompClass ? null : methodHasAnnotationIn(cls, STOMP_ANNOTATIONS);
      if (stompClass || stompMethod) {
        add('websocket_stomp', stompClass ?? stompMethod ?? '@MessageMapping');
      }

      // gRPC: @GrpcService annotation OR an extends of a gRPC generated base.
      const grpcAnn = classHasAnnotationIn(cls, GRPC_ANNOTATIONS);
      if (grpcAnn) add('grpc', grpcAnn);
      else if (extendsGrpcBase(cls)) add('grpc', `extends ${cls.extends}`);

      // Spring Batch: @EnableBatchProcessing OR a Job/Step @Bean factory.
      const batchAnn = classHasAnnotationIn(cls, SPRING_BATCH_CLASS_ANNOTATIONS);
      if (batchAnn) add('spring_batch', batchAnn);
      else {
        const batchBean = hasBatchBeanFactory(cls);
        if (batchBean) add('spring_batch', batchBean);
      }
    }
  }

  return Array.from(hits.entries()).map(([surface, signal]) => ({ surface, signal }));
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------

/**
 * Deferred-inbound-surface scanner entry point. Pure: takes pack inputs,
 * returns `FindingEmitInput[]`. The caller passes the result to
 * `findingEmitter.emitFindings` (via `runPackFindingScanners`). Java-annotation
 * surfaces are Spring / Spring Classic ONLY; schema files (`.proto` /
 * `.graphqls` / `.graphql`) are detected by path. A non-Java input with no
 * schema files is a clean no-op. Per-file soft-fail so a malformed IR cannot
 * poison the run.
 */
export function runDeferredSurfaceScanner(
  input: PackFindingScannerInput,
): FindingEmitInput[] {
  const collected: FindingEmitInput[] = [];
  const counts = new Map<string, number>();
  let softFailFiles = 0;

  for (const [, ir] of input.irFiles) {
    try {
      const surfaces = detectSurfacesInFile(ir);
      for (const { surface, signal } of surfaces) {
        if (!underCap(counts)) break;
        collected.push(
          buildDeferredSurfacePresentFinding({
            surface,
            signal,
            sourceFilePath: ir.filePath,
          }),
        );
        bumpCap(counts);
      }
    } catch (err) {
      // Per-file soft-fail: never throw out of the scanner.
      softFailFiles += 1;
      console.warn(
        `[deferredSurfaceScanner] Failed on file '${ir.filePath}'; continuing:`,
        err instanceof Error ? err.message : String(err),
      );
      console.warn(
        `[diag-pack] scanner=deferred_inbound_surface soft_fail=true category=parse_error`,
      );
    }
  }

  if (softFailFiles > 0) {
    console.warn(
      `[diag-pack] scanner=deferred_inbound_surface soft_fail_files=${softFailFiles}`,
    );
  }
  return collected;
}
