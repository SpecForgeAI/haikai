/**
 * Cross-pack integration tests for the Java + Spring + Maven finding scanners.
 *
 * Spec: 2026-05-16 Wire Java + Spring Classic + Maven Findings -- Task Group 8.
 *
 * Per-pack tests (Groups 1-7) cover each scanner in isolation. This file
 * targets the GENUINE cross-pack gaps that show up only when more than one
 * scanner participates in the same pipeline pass:
 *
 *   1. End-to-end fan-out through `runPackFindingScanners` + `emitFindings`:
 *      a Java + Spring fixture exercises both scanners and ALL emissions reach
 *      the stubbed `FindingEmitterArchClient.bulkCreateDiscoveryFindings` in a
 *      single bulk call. Asserts the same emission boundary owns both packs.
 *   2. Soft-fail isolation across packs: when one registered scanner throws,
 *      the shim swallows it and the OTHER scanner's emissions still flow.
 *   3. Cross-pack dedupe collapse: when two scanners independently produce
 *      identical `(runId, findingType, category, title, primaryLinkedTarget)`
 *      tuples, `emitFindings` collapses them to a single payload. Confirms the
 *      D2 dedupe key sees them as the SAME finding (the `source` field is NOT
 *      part of the key, by design).
 *   4. Maven scanner per-POM soft-fail: a malformed pom.xml input does NOT
 *      stop the scanner from emitting findings for the OTHER (well-formed)
 *      POMs in the same pass.
 *   5. End-to-end snippet redaction: a Java scanner emission carrying a secret
 *      in its source literal arrives at the emitter wire payload with the
 *      secret already redacted (i.e. the redactor is invoked in the scanner,
 *      not somewhere downstream).
 */

import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR } from '../services/extensionPacks';
import {
  FindingEmitter,
  type FindingEmitterArchClient,
} from '../services/findings/FindingEmitter';
import type {
  DiscoveryFindingCreatePayload,
  DiscoveryFindingDto,
} from '../services/archModelClient';
import { runPackFindingScanners } from '../services/findings/packFindingScanners';
import { runMavenFindingScanner } from '../services/findings/packFindingScanners/mavenFindingScanner';
import { parsePomMetadataFromString } from '../services/dependencyResolvers/maven/mavenPomMetadataParser';

const RUN_CTX = {
  runId: 'run-x-pack-001',
  projectId: 'proj-x-pack-001',
  architectureId: 'arch-x-pack-001',
};

// ---------------------------------------------------------------------------
// Stub AMS client (copied shape from findingEmitter.test.ts -- intentional
// duplication so this file remains a black-box integration test that does NOT
// import the per-emitter helpers).
// ---------------------------------------------------------------------------

function makeStubClient(): {
  client: FindingEmitterArchClient;
  bulkCalls: Array<{
    projectId: string;
    runId: string;
    payloads: DiscoveryFindingCreatePayload[];
  }>;
} {
  const bulkCalls: Array<{
    projectId: string;
    runId: string;
    payloads: DiscoveryFindingCreatePayload[];
  }> = [];

  const stubDto = (
    projectId: string,
    runId: string,
    payload: DiscoveryFindingCreatePayload,
  ): DiscoveryFindingDto => ({
    id: 'finding-' + Math.random().toString(36).slice(2, 10),
    runId,
    projectId,
    architectureId: 'arch-x-pack-001',
    findingType: payload.findingType,
    category: payload.category,
    severity: payload.severity,
    confidence: payload.confidence ?? null,
    reviewStatus: payload.reviewStatus ?? 'pending_review',
    previousReviewStatus: null,
    title: payload.title,
    summary: payload.summary ?? null,
    detailJson: payload.detailJson ?? null,
    source: payload.source ?? null,
    createdByStage: payload.createdByStage ?? null,
    createdAt: '2026-05-16T00:00:00Z',
    updatedAt: '2026-05-16T00:00:00Z',
    reviewedAt: null,
    reviewerNotes: null,
    links: [],
  });

  const client: FindingEmitterArchClient = {
    async createDiscoveryFinding(projectId, runId, payload) {
      return stubDto(projectId, runId, payload);
    },
    async bulkCreateDiscoveryFindings(projectId, runId, payloads) {
      bulkCalls.push({ projectId, runId, payloads });
      return payloads.map((p) => stubDto(projectId, runId, p));
    },
  };

  return { client, bulkCalls };
}

// ---------------------------------------------------------------------------
// Test fixture builders
// ---------------------------------------------------------------------------

function makeJavaIr(
  filePath: string,
  rawContent: string,
  classes: SourceFileIR['classes'] = [],
  imports: SourceFileIR['imports'] = [],
): SourceFileIR {
  return {
    filePath,
    language: 'java',
    packageOrNamespace: 'com.example',
    imports,
    classes,
    functions: [],
    rawContent,
  };
}

function makeXmlIr(
  filePath: string,
  rawContent: string,
  beans: Array<{
    beanKey: string;
    id: string | null;
    aliases: string[];
    fullyQualifiedClass: string | null;
    simpleClassName: string | null;
    dependencyRefs: string[];
  }>,
  usedNamespaces: string[],
): SourceFileIR {
  return {
    filePath,
    language: 'xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent,
    springXmlBeans: {
      beans,
      componentScans: [],
      imports: [],
      propertyPlaceholders: [],
      usedNamespaces,
    },
  };
}

// One Java file with a JDBC SQL literal (triggers raw_sql_detected) +
// one Spring applicationContext.xml (triggers spring_xml_bean_wiring).
function buildMixedJavaPlusSpringInput(): {
  runId: string;
  irFiles: Map<string, SourceFileIR>;
  packCandidates: DiscoveryCandidate[];
} {
  const javaPath = 'src/main/java/OrderDao.java';
  const javaIr = makeJavaIr(
    javaPath,
    [
      'package com.example;',
      'public class OrderDao {',
      '  public void run() {',
      '    String q = "SELECT * FROM orders WHERE id = ?";',
      '  }',
      '}',
    ].join('\n'),
    [
      {
        name: 'OrderDao',
        annotations: [],
        extends: null,
        implements: [],
        isInterface: false,
        isAbstract: false,
        modifiers: ['public'],
        fields: [],
        methods: [
          {
            name: 'run',
            returnType: 'void',
            parameters: [],
            annotations: [],
            modifiers: ['public'],
            line: 2,
          },
        ],
        line: 1,
      },
    ],
  );

  const xmlPath = 'src/main/resources/applicationContext.xml';
  const xmlIr = makeXmlIr(
    xmlPath,
    '<beans xmlns="http://www.springframework.org/schema/beans"></beans>',
    [
      {
        beanKey: 'orderService',
        id: 'orderService',
        aliases: [],
        fullyQualifiedClass: 'com.example.OrderService',
        simpleClassName: 'OrderService',
        dependencyRefs: [],
      },
    ],
    [],
  );

  return {
    runId: RUN_CTX.runId,
    irFiles: new Map<string, SourceFileIR>([
      [javaPath, javaIr],
      [xmlPath, xmlIr],
    ]),
    packCandidates: [],
  };
}

// ===========================================================================
// 1. End-to-end fan-out through the shim + emitter
// ===========================================================================
describe('cross-pack integration -- Java + Spring fan-out reaches emitFindings', () => {
  it('runPackFindingScanners + emitFindings push both packs through one bulk call', async () => {
    const input = buildMixedJavaPlusSpringInput();
    const findings = runPackFindingScanners(input);

    // Pre-emit sanity: both pack scanners contributed.
    const fromJava = findings.filter((f) => f.source === 'java-language-pack');
    const fromSpring = findings.filter(
      (f) => f.source === 'spring-classic-framework-pack',
    );
    expect(fromJava.length).toBeGreaterThan(0);
    expect(fromSpring.length).toBeGreaterThan(0);

    const { client, bulkCalls } = makeStubClient();
    const emitter = new FindingEmitter(client);
    const persisted = await emitter.emitFindings(RUN_CTX, findings);

    // One bulk round-trip carrying all the prepared payloads.
    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0].projectId).toBe(RUN_CTX.projectId);
    expect(bulkCalls[0].runId).toBe(RUN_CTX.runId);
    expect(persisted.length).toBe(findings.length);

    // Both packs survived into the persisted batch.
    const persistedSources = new Set(bulkCalls[0].payloads.map((p) => p.source));
    expect(persistedSources.has('java-language-pack')).toBe(true);
    expect(persistedSources.has('spring-classic-framework-pack')).toBe(true);
  });
});

// ===========================================================================
// 2. Soft-fail isolation across packs
// ===========================================================================
describe('cross-pack integration -- shim soft-fail isolation', () => {
  it('a Java-scanner throw does NOT prevent Spring-scanner emissions from flowing', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // Mock the Java scanner module so it throws when invoked. The shim
      // imports `runJavaFindingScanner` from this module; replacing the
      // implementation through jest.spyOn on the live module exercises
      // the same try/catch boundary the shim ships with.
      const javaModule = require(
        '../services/findings/packFindingScanners/javaFindingScanner',
      ) as {
        runJavaFindingScanner: (
          ...args: unknown[]
        ) => unknown;
      };
      const javaSpy = jest
        .spyOn(javaModule, 'runJavaFindingScanner')
        .mockImplementation(() => {
          throw new Error('Java scanner boom (synthetic)');
        });

      try {
        const input = buildMixedJavaPlusSpringInput();
        const findings = runPackFindingScanners(input);

        // Java threw -- no Java findings in the output.
        expect(findings.filter((f) => f.source === 'java-language-pack')).toHaveLength(
          0,
        );
        // Spring scanner still ran and contributed findings.
        const springOut = findings.filter(
          (f) => f.source === 'spring-classic-framework-pack',
        );
        expect(springOut.length).toBeGreaterThan(0);
        // The shim logged the soft-fail warning.
        const warnedAboutJava = warnSpy.mock.calls.some((args) =>
          args.some(
            (a) =>
              typeof a === 'string' &&
              a.includes('javaFindingScanner threw'),
          ),
        );
        expect(warnedAboutJava).toBe(true);
      } finally {
        javaSpy.mockRestore();
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ===========================================================================
// 3. Cross-pack dedupe collapse
// ===========================================================================
describe('cross-pack integration -- dedupe collapses identical key from two packs', () => {
  it("emitFindings collapses two inputs with the same (runId, findingType, category, title, primary-link) even when 'source' differs", async () => {
    // Two inputs that look like they came from two different pack scanners
    // (different `source`) but otherwise share the entire dedupe-key tuple:
    //   runId (from runContext), findingType, category, title, and the
    //   primary-link (discovery_candidate:C-shared). The D2 dedupe key
    //   intentionally excludes `source`, so these MUST collapse to one
    //   persisted finding.
    const sharedLink = {
      linkType: 'supports' as const,
      targetType: 'discovery_candidate' as const,
      targetId: 'C-shared',
    };
    const fromSpring = {
      findingType: 'risky_dependency',
      category: 'dependency',
      severity: 'high',
      title: 'Risky dependency: log4j:log4j',
      source: 'spring-classic-framework-pack',
      links: [sharedLink],
    };
    const fromMaven = {
      findingType: 'risky_dependency',
      category: 'dependency',
      severity: 'high',
      title: 'Risky dependency: log4j:log4j',
      source: 'maven-dependency-pack',
      links: [sharedLink],
    };

    const { client, bulkCalls } = makeStubClient();
    const emitter = new FindingEmitter(client);
    const persisted = await emitter.emitFindings(RUN_CTX, [fromSpring, fromMaven]);

    // Only ONE payload made it through the dedupe gate.
    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0].payloads).toHaveLength(1);
    expect(persisted).toHaveLength(1);
    // The survivor's source is the FIRST one seen (Spring in this ordering)
    // -- this asserts dedupe is "first wins" and is NOT merging sources.
    expect(bulkCalls[0].payloads[0].source).toBe('spring-classic-framework-pack');
  });

  it('different primary-link targets keep two findings distinct across packs', async () => {
    // Same finding_type / category / title / source-of-truth, but the linked
    // candidate differs -- dedupe MUST keep both.
    const fromSpring = {
      findingType: 'risky_dependency',
      category: 'dependency',
      severity: 'high',
      title: 'Risky dependency: log4j:log4j',
      source: 'spring-classic-framework-pack',
      links: [
        {
          linkType: 'supports' as const,
          targetType: 'discovery_candidate' as const,
          targetId: 'C-A',
        },
      ],
    };
    const fromMaven = {
      findingType: 'risky_dependency',
      category: 'dependency',
      severity: 'high',
      title: 'Risky dependency: log4j:log4j',
      source: 'maven-dependency-pack',
      links: [
        {
          linkType: 'supports' as const,
          targetType: 'discovery_candidate' as const,
          targetId: 'C-B',
        },
      ],
    };

    const { client, bulkCalls } = makeStubClient();
    const emitter = new FindingEmitter(client);
    const persisted = await emitter.emitFindings(RUN_CTX, [fromSpring, fromMaven]);

    expect(bulkCalls).toHaveLength(1);
    expect(bulkCalls[0].payloads).toHaveLength(2);
    expect(persisted).toHaveLength(2);
  });
});

// ===========================================================================
// 4. Maven scanner per-POM soft-fail
// ===========================================================================
describe('cross-pack integration -- Maven scanner per-POM soft-fail', () => {
  it('a malformed pom.xml does NOT prevent emissions for the well-formed POMs in the same pass', () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const malformedXml = '<project><properties><<<garbage';
      const goodXml = `
        <project>
          <properties>
            <maven.compiler.source>17</maven.compiler.source>
          </properties>
        </project>
      `;

      const out = runMavenFindingScanner({
        runId: RUN_CTX.runId,
        poms: [
          {
            pomPath: 'module-malformed/pom.xml',
            dependencies: [],
            metadata: parsePomMetadataFromString(
              'module-malformed/pom.xml',
              malformedXml,
            ),
          },
          {
            pomPath: 'module-good/pom.xml',
            dependencies: [],
            metadata: parsePomMetadataFromString('module-good/pom.xml', goodXml),
          },
        ],
      });

      // Good POM produced its java_version_detected finding.
      const javaForGood = out.filter(
        (f) =>
          f.findingType === 'java_version_detected' &&
          (f.detailJson as Record<string, unknown>).pomPath === 'module-good/pom.xml',
      );
      expect(javaForGood).toHaveLength(1);
      // Malformed POM did NOT produce a java_version_detected finding
      // (no usable signal) but also did NOT throw -- the scanner kept going.
      const javaForBad = out.filter(
        (f) =>
          f.findingType === 'java_version_detected' &&
          (f.detailJson as Record<string, unknown>).pomPath ===
            'module-malformed/pom.xml',
      );
      expect(javaForBad).toHaveLength(0);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ===========================================================================
// 5. End-to-end snippet redaction
// ===========================================================================
describe('cross-pack integration -- snippet redaction reaches the emitter payload', () => {
  it('a Java scanner emission carries a redacted snippet through to the AMS wire payload', async () => {
    // A hardcoded URL literal carrying a secret -- the Java scanner emits
    // a `hardcoded_endpoint_or_url` finding, the snippet runs through
    // `redactSnippet`, and the redacted text MUST appear in the persisted
    // payload's `detail_json.evidenceSnippet`.
    const javaPath = 'src/main/java/Caller.java';
    const javaIr = makeJavaIr(
      javaPath,
      [
        'package com.example;',
        'public class Caller {',
        '  public void call() {',
        '    String url = "https://api.example.com/?api_key=ABCDEF_LEAK_DO_NOT_PERSIST";',
        '  }',
        '}',
      ].join('\n'),
      [
        {
          name: 'Caller',
          annotations: [],
          extends: null,
          implements: [],
          isInterface: false,
          isAbstract: false,
          modifiers: ['public'],
          fields: [],
          methods: [
            {
              name: 'call',
              returnType: 'void',
              parameters: [],
              annotations: [],
              modifiers: ['public'],
              line: 2,
            },
          ],
          line: 1,
        },
      ],
    );

    const findings = runPackFindingScanners({
      runId: RUN_CTX.runId,
      irFiles: new Map<string, SourceFileIR>([[javaPath, javaIr]]),
      packCandidates: [],
    });

    const { client, bulkCalls } = makeStubClient();
    const emitter = new FindingEmitter(client);
    await emitter.emitFindings(RUN_CTX, findings);

    expect(bulkCalls).toHaveLength(1);
    // Locate the hardcoded_endpoint_or_url payload in the persisted batch.
    const url = bulkCalls[0].payloads.find(
      (p) => p.findingType === 'hardcoded_endpoint_or_url',
    );
    expect(url).toBeDefined();
    const detail = url!.detailJson as Record<string, unknown>;
    expect(typeof detail.evidenceSnippet).toBe('string');
    // The secret value MUST NOT survive verbatim in the persisted payload.
    expect(detail.evidenceSnippet).not.toContain('ABCDEF_LEAK_DO_NOT_PERSIST');
  });
});
