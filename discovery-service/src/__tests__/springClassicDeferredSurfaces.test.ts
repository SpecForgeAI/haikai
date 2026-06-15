/**
 * Tests for the deferred-inbound-surface scanner.
 *
 * Spec: 2026-05-30 Inbound Surface Completeness (Spec #4), Task Group 7.
 *
 * Pins (observation -> emission; Finding-and-defer, NEVER a candidate):
 *   1. a `@QueryMapping` handler -> ONE `deferred_inbound_surface` Finding
 *      (surface=graphql), and NO endpoint/interface candidate (the scanner only
 *      returns FindingEmitInputs);
 *   2. a `.graphqls` schema file -> graphql Finding (detected by extension);
 *   3. gRPC: an `extends *ImplBase` class AND a `.proto` file -> grpc Finding;
 *   4. WebSocket-STOMP: a `@MessageMapping` handler -> websocket_stomp Finding;
 *   5. Spring Batch: `@EnableBatchProcessing` AND a `Job` @Bean -> spring_batch
 *      Finding;
 *   6. a pure REST `@RestController` (+ an Actuator-style controller) -> NO
 *      finding (negative case);
 *   7. a NON-Java stack input -> NO finding (clean no-op);
 *   8. multiple `@QueryMapping` methods in one file -> exactly ONE graphql
 *      Finding (per-file/per-surface de-dup);
 *   9. the scanner SOFT-FAILS (never throws) on malformed input.
 */

import type { DiscoveryCandidate } from '../types/candidate';
import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
} from '../services/extensionPacks';
import { runDeferredSurfaceScanner } from '../services/findings/packFindingScanners/deferredSurfaceScanner';
import type { EvidenceGapType } from '../services/findings/emissionSources';

const RUN_ID = 'run-deferred-001';

// ----------------------------------------------------------------------------
// Fixture builders (mirror nonDeterministicEndpointScanner.test.ts shapes)
// ----------------------------------------------------------------------------

function method(name: string, overrides: Partial<FunctionIR> = {}): FunctionIR {
  return {
    name,
    returnType: 'String',
    parameters: [],
    annotations: [],
    modifiers: ['public'],
    line: 1,
    ...overrides,
  };
}

function cls(name: string, overrides: Partial<ClassIR> = {}): ClassIR {
  return {
    name,
    annotations: [],
    extends: null,
    implements: [],
    isInterface: false,
    isAbstract: false,
    modifiers: ['public'],
    fields: [],
    methods: [],
    line: 1,
    ...overrides,
  };
}

function javaIr(filePath: string, classes: ClassIR[], rawContent = ''): SourceFileIR {
  return {
    filePath,
    language: 'java',
    packageOrNamespace: 'com.example',
    imports: [],
    classes,
    functions: [],
    rawContent,
  };
}

/** A non-`java` IR file (schema file or a non-Java stack source). */
function nonJavaIr(filePath: string, language: string, rawContent = ''): SourceFileIR {
  return {
    filePath,
    language,
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent,
  };
}

function runOn(
  irFiles: SourceFileIR[],
  packCandidates: DiscoveryCandidate[] = [],
) {
  const map = new Map<string, SourceFileIR>();
  for (const ir of irFiles) map.set(ir.filePath, ir);
  return runDeferredSurfaceScanner({
    runId: RUN_ID,
    irFiles: map,
    packCandidates,
  });
}

function deferredGaps(findings: ReturnType<typeof runOn>) {
  return findings.filter(
    (f) =>
      (f.detailJson as Record<string, unknown> | undefined)?.gapType ===
      'deferred_inbound_surface',
  );
}

function surfacesOf(findings: ReturnType<typeof runOn>): string[] {
  return deferredGaps(findings)
    .map((f) => (f.detailJson as Record<string, unknown>).surface as string)
    .sort();
}

// ============================================================================
// 1. GraphQL @QueryMapping -> Finding, NO candidate
// ============================================================================
describe('deferredSurfaceScanner — GraphQL', () => {
  it('emits ONE graphql deferred-surface Finding for a @QueryMapping handler and NO candidate', () => {
    const controller = cls('BookController', {
      annotations: [{ name: 'Controller', args: {}, line: 1 }],
      methods: [
        method('book', {
          annotations: [{ name: 'QueryMapping', args: {}, line: 2 }],
          line: 2,
        }),
      ],
    });
    const findings = runOn([javaIr('BookController.java', [controller])]);
    const gaps = deferredGaps(findings);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].findingType).toBe('evidence_gap');
    expect(gaps[0].category).toBe('migration_risk');
    expect((gaps[0].detailJson as Record<string, unknown>).surface).toBe('graphql');
    expect((gaps[0].detailJson as Record<string, unknown>).gapType).toBe(
      'deferred_inbound_surface',
    );
    // Finding-and-defer: the scanner NEVER produces an endpoint/interface
    // candidate (it returns FindingEmitInputs only — they carry NO
    // candidateType field).
    for (const f of findings) {
      expect((f as unknown as Record<string, unknown>).candidateType).toBeUndefined();
    }
  });

  it('detects a .graphqls schema file by extension (graphql surface)', () => {
    const schema = nonJavaIr(
      'src/main/resources/graphql/schema.graphqls',
      'graphql',
      'type Query { book(id: ID): Book }',
    );
    expect(surfacesOf(runOn([schema]))).toEqual(['graphql']);
  });

  it('collapses multiple @QueryMapping methods in one file into ONE graphql Finding', () => {
    const controller = cls('CatalogController', {
      annotations: [{ name: 'Controller', args: {}, line: 1 }],
      methods: [
        method('book', { annotations: [{ name: 'QueryMapping', args: {}, line: 2 }], line: 2 }),
        method('author', { annotations: [{ name: 'QueryMapping', args: {}, line: 3 }], line: 3 }),
        method('save', { annotations: [{ name: 'MutationMapping', args: {}, line: 4 }], line: 4 }),
      ],
    });
    const gaps = deferredGaps(runOn([javaIr('CatalogController.java', [controller])]));
    expect(gaps).toHaveLength(1);
    expect((gaps[0].detailJson as Record<string, unknown>).surface).toBe('graphql');
  });
});

// ============================================================================
// 2. gRPC -> Finding
// ============================================================================
describe('deferredSurfaceScanner — gRPC', () => {
  it('emits a grpc Finding for a class extending a generated *ImplBase', () => {
    const svc = cls('GreeterServiceImpl', {
      extends: 'GreeterGrpc.GreeterImplBase',
      methods: [method('sayHello')],
    });
    const gaps = deferredGaps(runOn([javaIr('GreeterServiceImpl.java', [svc])]));
    expect(gaps).toHaveLength(1);
    expect((gaps[0].detailJson as Record<string, unknown>).surface).toBe('grpc');
  });

  it('emits a grpc Finding for a @GrpcService class', () => {
    const svc = cls('OrderGrpcService', {
      annotations: [{ name: 'GrpcService', args: {}, line: 1 }],
      methods: [method('placeOrder')],
    });
    expect(surfacesOf(runOn([javaIr('OrderGrpcService.java', [svc])]))).toEqual(['grpc']);
  });

  it('detects a .proto schema file by extension (grpc surface)', () => {
    const proto = nonJavaIr('src/main/proto/greeter.proto', 'proto', 'service Greeter {}');
    expect(surfacesOf(runOn([proto]))).toEqual(['grpc']);
  });
});

// ============================================================================
// 3. WebSocket-STOMP -> Finding
// ============================================================================
describe('deferredSurfaceScanner — WebSocket-STOMP', () => {
  it('emits a websocket_stomp Finding for a @MessageMapping handler', () => {
    const controller = cls('ChatController', {
      annotations: [{ name: 'Controller', args: {}, line: 1 }],
      methods: [
        method('greeting', {
          annotations: [{ name: 'MessageMapping', args: { value: '/hello' }, line: 2 }],
          line: 2,
        }),
      ],
    });
    expect(surfacesOf(runOn([javaIr('ChatController.java', [controller])]))).toEqual([
      'websocket_stomp',
    ]);
  });
});

// ============================================================================
// 4. Spring Batch -> Finding
// ============================================================================
describe('deferredSurfaceScanner — Spring Batch', () => {
  it('emits a spring_batch Finding for an @EnableBatchProcessing class', () => {
    const config = cls('BatchConfig', {
      annotations: [
        { name: 'Configuration', args: {}, line: 1 },
        { name: 'EnableBatchProcessing', args: {}, line: 2 },
      ],
    });
    expect(surfacesOf(runOn([javaIr('BatchConfig.java', [config])]))).toEqual(['spring_batch']);
  });

  it('emits a spring_batch Finding for a Job @Bean factory method', () => {
    const config = cls('JobConfig', {
      annotations: [{ name: 'Configuration', args: {}, line: 1 }],
      methods: [
        method('importJob', {
          returnType: 'Job',
          annotations: [{ name: 'Bean', args: {}, line: 2 }],
          line: 2,
        }),
      ],
    });
    expect(surfacesOf(runOn([javaIr('JobConfig.java', [config])]))).toEqual(['spring_batch']);
  });
});

// ============================================================================
// 5. Negative cases — pure REST + Actuator + non-Java
// ============================================================================
describe('deferredSurfaceScanner — negatives', () => {
  it('emits NO finding for a pure REST @RestController', () => {
    const controller = cls('OwnerController', {
      annotations: [{ name: 'RestController', args: {}, line: 1 }],
      methods: [
        method('list', {
          annotations: [{ name: 'GetMapping', args: { value: '/owners' }, line: 2 }],
          line: 2,
        }),
      ],
    });
    expect(deferredGaps(runOn([javaIr('OwnerController.java', [controller])]))).toHaveLength(0);
  });

  it('emits NO finding for an Actuator-style endpoint class (fully out of scope)', () => {
    const actuator = cls('CustomHealthEndpoint', {
      annotations: [
        { name: 'Component', args: {}, line: 1 },
        { name: 'Endpoint', args: { id: 'custom' }, line: 2 },
      ],
      methods: [method('health', { annotations: [{ name: 'ReadOperation', args: {}, line: 3 }], line: 3 })],
    });
    expect(deferredGaps(runOn([javaIr('CustomHealthEndpoint.java', [actuator])]))).toHaveLength(0);
  });

  it('emits NO finding for a non-Java stack input with no schema files (clean no-op)', () => {
    const ts = nonJavaIr('src/api/orders.ts', 'typescript', 'export const handler = () => {};');
    const py = nonJavaIr('app/views.py', 'python', 'def index(request): pass');
    expect(deferredGaps(runOn([ts, py]))).toHaveLength(0);
  });
});

// ============================================================================
// 6. Multiple surfaces across a repo + soft-fail
// ============================================================================
describe('deferredSurfaceScanner — multi-surface + robustness', () => {
  it('reports each distinct surface once across a mixed repo', () => {
    const gql = cls('GqlController', {
      annotations: [{ name: 'Controller', args: {}, line: 1 }],
      methods: [method('q', { annotations: [{ name: 'QueryMapping', args: {}, line: 2 }], line: 2 })],
    });
    const stomp = cls('ChatController', {
      annotations: [{ name: 'Controller', args: {}, line: 1 }],
      methods: [method('m', { annotations: [{ name: 'MessageMapping', args: {}, line: 2 }], line: 2 })],
    });
    const proto = nonJavaIr('proto/svc.proto', 'proto', 'service S {}');
    const surfaces = surfacesOf(
      runOn([
        javaIr('GqlController.java', [gql]),
        javaIr('ChatController.java', [stomp]),
        proto,
      ]),
    );
    expect(surfaces).toEqual(['graphql', 'grpc', 'websocket_stomp']);
  });

  it('soft-fails (never throws) on a malformed IR file', () => {
    const broken = {
      filePath: 'Broken.java',
      language: 'java',
      packageOrNamespace: 'com.example',
      imports: [],
      // classes deliberately not an array -> a .classes iteration would throw,
      // which the per-file try/catch must swallow.
      classes: null as unknown as ClassIR[],
      functions: [],
    } as SourceFileIR;
    expect(() => runOn([broken])).not.toThrow();
    expect(deferredGaps(runOn([broken]))).toHaveLength(0);
  });
});

// ============================================================================
// 7. Sentinel membership (compile-time + runtime)
// ============================================================================
describe('deferred_inbound_surface sentinel', () => {
  it('is a member of the EvidenceGapType union', () => {
    // Compile-time: this assignment only type-checks if the literal is a union
    // member. Runtime assertion keeps the test non-trivial.
    const sentinel: EvidenceGapType = 'deferred_inbound_surface';
    expect(sentinel).toBe('deferred_inbound_surface');
  });
});
