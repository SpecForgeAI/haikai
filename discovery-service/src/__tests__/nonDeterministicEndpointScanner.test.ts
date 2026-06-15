/**
 * Tests for the non-deterministic-endpoint scanner.
 *
 * Spec: 2026-05-30 Oracle Integrity & Determinism (Spec #3), Task Group 4.
 *
 * Pins:
 *   1. a handler annotated `@Cacheable` -> one `non_deterministic_endpoint`
 *      Finding (`detail_json.gapType === 'non_deterministic_endpoint'`);
 *   2. a handler whose body reaches a CLOCK source (`Instant.now()`) -> Finding;
 *   3. a handler whose body reaches a RANDOM source (`UUID.randomUUID()`) -> Finding;
 *   4. a handler reaching a `@Profile`-gated autowired collaborator bean -> Finding;
 *   5. a PURE handler -> NO finding;
 *   6. the scanner SOFT-FAILS (never throws) on malformed input;
 *   7. a NON-Spring (non-java) input is a clean no-op.
 */

import type { DiscoveryCandidate } from '../types/candidate';
import type {
  SourceFileIR,
  ClassIR,
  FunctionIR,
} from '../services/extensionPacks';
import { runNonDeterministicEndpointScanner } from '../services/findings/packFindingScanners/nonDeterministicEndpointScanner';

const RUN_ID = 'run-nondet-001';

// ----------------------------------------------------------------------------
// Fixture builders (mirror springClassicFindingScanner.test.ts shapes)
// ----------------------------------------------------------------------------

function method(
  name: string,
  overrides: Partial<FunctionIR> = {},
): FunctionIR {
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

function javaIr(
  filePath: string,
  classes: ClassIR[],
  rawContent = '',
): SourceFileIR {
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

function runOn(irFiles: SourceFileIR[], packCandidates: DiscoveryCandidate[] = []) {
  const map = new Map<string, SourceFileIR>();
  for (const ir of irFiles) map.set(ir.filePath, ir);
  return runNonDeterministicEndpointScanner({
    runId: RUN_ID,
    irFiles: map,
    packCandidates,
  });
}

function nonDetGap(findings: ReturnType<typeof runOn>) {
  return findings.filter(
    (f) => (f.detailJson as Record<string, unknown> | undefined)?.gapType === 'non_deterministic_endpoint',
  );
}

// ============================================================================
// Test 1: @Cacheable handler -> Finding
// ============================================================================
describe('nonDeterministicEndpointScanner — annotation-based variance', () => {
  it('flags a @Cacheable controller endpoint with gapType=non_deterministic_endpoint', () => {
    const controller = cls('ReportController', {
      annotations: [{ name: 'RestController', args: {}, line: 1 }],
      methods: [
        method('getReport', {
          annotations: [
            { name: 'GetMapping', args: { value: '/report' }, line: 2 },
            { name: 'Cacheable', args: { value: 'reports' }, line: 3 },
          ],
          line: 2,
        }),
      ],
    });
    const findings = runOn([javaIr('ReportController.java', [controller])]);
    const gaps = nonDetGap(findings);
    expect(gaps).toHaveLength(1);
    expect((gaps[0].detailJson as Record<string, unknown>).gapType).toBe('non_deterministic_endpoint');
    expect(gaps[0].findingType).toBe('evidence_gap');
    expect((gaps[0].detailJson as Record<string, unknown>).sourcesOfVariance).toContain('@Cacheable');
  });
});

// ============================================================================
// Test 2: clock source in body -> Finding
// ============================================================================
describe('nonDeterministicEndpointScanner — clock source', () => {
  it('flags a handler whose body calls Instant.now()', () => {
    const raw = [
      'public class TimeController {',
      '  public String now() {',
      '    return Instant.now().toString();',
      '  }',
      '}',
    ].join('\n');
    const controller = cls('TimeController', {
      annotations: [{ name: 'RestController', args: {}, line: 0 }],
      methods: [
        method('now', {
          annotations: [{ name: 'GetMapping', args: { value: '/now' }, line: 1 }],
          line: 1,
        }),
      ],
    });
    const gaps = nonDetGap(runOn([javaIr('TimeController.java', [controller], raw)]));
    expect(gaps).toHaveLength(1);
    expect(
      (gaps[0].detailJson as { sourcesOfVariance: string[] }).sourcesOfVariance.some((s) =>
        s.startsWith('clock:'),
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Test 3: random source in body -> Finding
// ============================================================================
describe('nonDeterministicEndpointScanner — random source', () => {
  it('flags a handler whose body calls UUID.randomUUID()', () => {
    const raw = [
      'public class TokenController {',
      '  public String token() {',
      '    return UUID.randomUUID().toString();',
      '  }',
      '}',
    ].join('\n');
    const controller = cls('TokenController', {
      annotations: [{ name: 'RestController', args: {}, line: 0 }],
      methods: [
        method('token', {
          annotations: [{ name: 'GetMapping', args: { value: '/token' }, line: 1 }],
          line: 1,
        }),
      ],
    });
    const gaps = nonDetGap(runOn([javaIr('TokenController.java', [controller], raw)]));
    expect(gaps).toHaveLength(1);
    expect(
      (gaps[0].detailJson as { sourcesOfVariance: string[] }).sourcesOfVariance.some((s) =>
        s.startsWith('random:'),
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Test 4: @Profile-gated reached collaborator bean -> Finding
// ============================================================================
describe('nonDeterministicEndpointScanner — @Profile-gated collaborator bean (1-hop)', () => {
  it('flags an endpoint whose controller autowires a @Profile-gated service', () => {
    const profileBean = cls('FeatureService', {
      annotations: [{ name: 'Profile', args: { value: 'prod' }, line: 1 }],
    });
    const controller = cls('FeatureController', {
      annotations: [{ name: 'RestController', args: {}, line: 1 }],
      fields: [
        {
          name: 'featureService',
          type: 'FeatureService',
          annotations: [{ name: 'Autowired', args: {}, line: 2 }],
        } as ClassIR['fields'][number],
      ],
      methods: [
        method('get', {
          annotations: [{ name: 'GetMapping', args: { value: '/f' }, line: 3 }],
          line: 3,
        }),
      ],
    });
    const gaps = nonDetGap(
      runOn([javaIr('FeatureController.java', [controller, profileBean])]),
    );
    expect(gaps).toHaveLength(1);
    expect(
      (gaps[0].detailJson as { sourcesOfVariance: string[] }).sourcesOfVariance.some((s) =>
        s.includes('@Profile') && s.includes('FeatureService'),
      ),
    ).toBe(true);
  });
});

// ============================================================================
// Test 5: pure handler -> no finding
// ============================================================================
describe('nonDeterministicEndpointScanner — pure handler', () => {
  it('emits NOTHING for a deterministic endpoint with no variance source', () => {
    const raw = [
      'public class EchoController {',
      '  public String echo(String in) {',
      '    return in.trim();',
      '  }',
      '}',
    ].join('\n');
    const controller = cls('EchoController', {
      annotations: [{ name: 'RestController', args: {}, line: 0 }],
      methods: [
        method('echo', {
          annotations: [{ name: 'GetMapping', args: { value: '/echo' }, line: 1 }],
          parameters: [{ name: 'in', type: 'String', annotations: [] }],
          line: 1,
        }),
      ],
    });
    expect(nonDetGap(runOn([javaIr('EchoController.java', [controller], raw)]))).toHaveLength(0);
  });
});

// ============================================================================
// Test 6: soft-fail on malformed input
// ============================================================================
describe('nonDeterministicEndpointScanner — soft-fail', () => {
  it('never throws on a malformed IR entry (returns an array)', () => {
    // A class whose `annotations` is null and `methods` is null would throw if
    // accessed unguarded; the per-file try/catch must absorb it.
    const malformed = {
      filePath: 'Broken.java',
      language: 'java',
      packageOrNamespace: 'com.example',
      imports: [],
      // Intentionally malformed: classes entry with null annotations/methods.
      classes: [{ name: 'Broken', annotations: null, methods: null, fields: [], line: 0 }],
      functions: [],
      rawContent: '',
    } as unknown as SourceFileIR;
    let result: ReturnType<typeof runOn> | undefined;
    expect(() => {
      result = runOn([malformed]);
    }).not.toThrow();
    expect(Array.isArray(result)).toBe(true);
    expect(nonDetGap(result!)).toHaveLength(0);
  });
});

// ============================================================================
// Test 7: non-Spring input -> no-op
// ============================================================================
describe('nonDeterministicEndpointScanner — non-Spring input', () => {
  it('is a clean no-op for a non-java (e.g. typescript) IR file', () => {
    const tsIr: SourceFileIR = {
      filePath: 'app.controller.ts',
      language: 'typescript',
      packageOrNamespace: null,
      imports: [],
      classes: [
        cls('AppController', {
          annotations: [{ name: 'Controller', args: {}, line: 1 }],
          methods: [
            method('now', {
              annotations: [{ name: 'Get', args: {}, line: 2 }],
              line: 2,
            }),
          ],
        }),
      ],
      functions: [],
      rawContent: 'class AppController { now() { return Date.now(); } }',
    };
    expect(runOn([tsIr])).toHaveLength(0);
  });
});
