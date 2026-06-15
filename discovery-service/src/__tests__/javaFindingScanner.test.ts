/**
 * Tests for the Java pack finding scanner (Spec 2026-05-16 Wire Java +
 * Spring + Maven Findings -- Task Group 2, sub-task 2.1).
 *
 * Coverage scope (7 focused cases):
 *  - `emitsRawSqlDetectedOncePerMethodSite`: multiple SQL literals in one
 *    method produce exactly ONE finding for that (file, class, method).
 *  - `emitsHardcodedEndpointOrUrl`: http(s) literal produces one
 *    `hardcoded_endpoint_or_url` finding with the URL redacted via the
 *    shared snippet-redaction utility.
 *  - `emitsLegacyJavaApiUsage`: `javax.servlet.*` import produces one
 *    `legacy_java_api_usage` finding with the migration concern populated.
 *  - `extendsEvidenceGapWithJavaGapTypes`: a non-interface class with
 *    annotations but no methods produces an `evidence_gap` finding whose
 *    `detail_json.gapType === 'java_class_no_methods'`.
 *  - `linksFindingToCandidateWhenSourceClusterIdsMatch`: pack candidates
 *    whose `sourceClusterIds` includes the file path receive
 *    `discovery_candidate` links.
 *  - `enforcesMaxFindingsPerTypePerRunCap`: 60 raw-SQL sites yield exactly
 *    50 `raw_sql_detected` findings (cap = 50).
 *  - `pipelineHookFansOutToJavaScanner`: the `runPackFindingScanners` shim
 *    invokes the Java scanner and returns its emissions.
 */

import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR } from '../services/extensionPacks';
import {
  runJavaFindingScanner,
} from '../services/findings/packFindingScanners/javaFindingScanner';
import { runPackFindingScanners } from '../services/findings/packFindingScanners';

const RUN_ID = 'run-java-scan-001';

function makeIr(
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

function makeCandidate(id: string, filePath: string): DiscoveryCandidate {
  return {
    id,
    runId: RUN_ID,
    candidateType: 'service',
    name: 'X',
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [filePath],
    data: {},
    synthesizedAt: '2026-05-16T00:00:00Z',
  };
}

describe('javaFindingScanner -- raw_sql_detected', () => {
  it('emits exactly one raw_sql_detected per (file, class, method) site', () => {
    const raw = [
      'package com.example;',
      'public class OrderDao {',
      '  public void doIt(java.sql.Connection c) {',
      '    String q1 = "SELECT * FROM orders WHERE id = 1";',
      '    String q2 = "UPDATE orders SET status = ? WHERE id = ?";',
      '    String q3 = "DELETE FROM orders WHERE id > 0";',
      '  }',
      '}',
    ].join('\n');
    const ir = makeIr('src/main/java/OrderDao.java', raw, [
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
            name: 'doIt',
            returnType: 'void',
            parameters: [],
            annotations: [],
            modifiers: ['public'],
            line: 2,
          },
        ],
        line: 1,
      },
    ]);
    const out = runJavaFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const sqlFindings = out.filter((f) => f.findingType === 'raw_sql_detected');
    expect(sqlFindings).toHaveLength(1);
    expect(sqlFindings[0].severity).toBe('medium');
    expect(sqlFindings[0].source).toBe('java-language-pack');
    expect(sqlFindings[0].createdByStage).toBe('deterministic_java_analysis');
    // The literal body is redacted to `?` and present inside the snippet.
    const detail = sqlFindings[0].detailJson as Record<string, unknown>;
    expect(detail.filePath).toBe('src/main/java/OrderDao.java');
    expect(detail.className).toBe('OrderDao');
    expect(detail.methodName).toBe('doIt');
    expect(typeof detail.evidenceSnippet).toBe('string');
    // Redaction replaces the quoted body with `?` so the verbatim SQL text
    // does NOT survive in the snippet.
    expect(detail.evidenceSnippet).not.toContain('orders');
  });
});

describe('javaFindingScanner -- hardcoded_endpoint_or_url', () => {
  it('emits one hardcoded_endpoint_or_url with redacted URL via snippetRedaction', () => {
    const raw = [
      'package com.example;',
      'public class Client {',
      '  public void call() {',
      '    String url = "https://api.example.com/v1/users?api_key=SECRET";',
      '  }',
      '}',
    ].join('\n');
    const ir = makeIr('src/main/java/Client.java', raw, [
      {
        name: 'Client',
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
    ]);
    const out = runJavaFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const urlFindings = out.filter((f) => f.findingType === 'hardcoded_endpoint_or_url');
    expect(urlFindings).toHaveLength(1);
    expect(urlFindings[0].severity).toBe('medium');
    const detail = urlFindings[0].detailJson as Record<string, unknown>;
    expect(detail.className).toBe('Client');
    expect(detail.methodName).toBe('call');
    // The shared redactor masks api_key= AND replaces the literal -- in
    // either ordering the verbatim secret must NOT leak through.
    expect(detail.evidenceSnippet).not.toContain('SECRET');
  });
});

describe('javaFindingScanner -- legacy_java_api_usage', () => {
  it('emits one legacy_java_api_usage finding for javax.* imports', () => {
    const ir = makeIr(
      'src/main/java/LegacyServlet.java',
      'package com.example;\npublic class LegacyServlet {}\n',
      [
        {
          name: 'LegacyServlet',
          annotations: [{ name: 'Component', args: {}, line: 1 }],
          extends: null,
          implements: [],
          isInterface: false,
          isAbstract: false,
          modifiers: ['public'],
          fields: [],
          methods: [
            {
              name: 'doGet',
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
      [
        { path: 'javax.servlet.http.HttpServlet', names: ['HttpServlet'] },
        { path: 'javax.servlet.ServletException', names: ['ServletException'] },
      ],
    );
    const out = runJavaFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const legacy = out.filter((f) => f.findingType === 'legacy_java_api_usage');
    expect(legacy).toHaveLength(1);
    expect(legacy[0].severity).toBe('medium');
    const detail = legacy[0].detailJson as Record<string, unknown>;
    expect(detail.detectedPattern).toBe('javax_namespace');
    expect(typeof detail.migrationConcern).toBe('string');
    expect((detail.migrationConcern as string).toLowerCase()).toContain('jakarta');
    expect(Array.isArray(detail.importPaths)).toBe(true);
    expect((detail.importPaths as string[]).length).toBe(2);
  });
});

describe('javaFindingScanner -- evidence_gap extension', () => {
  it('emits an evidence_gap with detail_json.gapType === java_class_no_methods', () => {
    const ir = makeIr(
      'src/main/java/EmptyService.java',
      'package com.example;\n@Service\npublic class EmptyService {}\n',
      [
        {
          name: 'EmptyService',
          annotations: [{ name: 'Service', args: {}, line: 1 }],
          extends: null,
          implements: [],
          isInterface: false,
          isAbstract: false,
          modifiers: ['public'],
          fields: [],
          methods: [],
          line: 1,
        },
      ],
    );
    const out = runJavaFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const gaps = out.filter((f) => f.findingType === 'evidence_gap');
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    const hasGap = gaps.some((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return d && d.gapType === 'java_class_no_methods';
    });
    expect(hasGap).toBe(true);
  });
});

describe('javaFindingScanner -- links to source candidates', () => {
  it('links findings to candidates whose sourceClusterIds contains the file path', () => {
    const filePath = 'src/main/java/Linked.java';
    const raw = [
      'package com.example;',
      'public class Linked {',
      '  public void m() { String q = "SELECT 1 FROM dual"; }',
      '}',
    ].join('\n');
    const ir = makeIr(filePath, raw, [
      {
        name: 'Linked',
        annotations: [],
        extends: null,
        implements: [],
        isInterface: false,
        isAbstract: false,
        modifiers: ['public'],
        fields: [],
        methods: [
          {
            name: 'm',
            returnType: 'void',
            parameters: [],
            annotations: [],
            modifiers: ['public'],
            line: 2,
          },
        ],
        line: 1,
      },
    ]);
    const cand = makeCandidate('CAND-1', filePath);
    const out = runJavaFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[filePath, ir]]),
      packCandidates: [cand],
    });
    const sql = out.find((f) => f.findingType === 'raw_sql_detected');
    expect(sql).toBeDefined();
    expect(sql?.links).toBeDefined();
    const candLink = sql?.links?.find((l) => l.targetType === 'discovery_candidate');
    expect(candLink?.targetId).toBe('CAND-1');
    const detail = sql?.detailJson as Record<string, unknown>;
    expect(Array.isArray(detail.relatedCandidateIds)).toBe(true);
    expect((detail.relatedCandidateIds as string[]).includes('CAND-1')).toBe(true);
  });
});

describe('javaFindingScanner -- cap enforcement', () => {
  it('enforces MAX_FINDINGS_PER_TYPE_PER_RUN=50 for raw_sql_detected', () => {
    // 60 different methods, each with one SQL literal -> 60 raw-SQL sites.
    const lines: string[] = ['package com.example;', 'public class Big {'];
    const methods = [];
    for (let i = 0; i < 60; i++) {
      lines.push(`  public void m${i}() { String q = "SELECT * FROM t${i}"; }`);
      methods.push({
        name: `m${i}`,
        returnType: 'void',
        parameters: [],
        annotations: [],
        modifiers: ['public'],
        line: i + 2,
      });
    }
    lines.push('}');
    const raw = lines.join('\n');
    const ir = makeIr('src/main/java/Big.java', raw, [
      {
        name: 'Big',
        annotations: [],
        extends: null,
        implements: [],
        isInterface: false,
        isAbstract: false,
        modifiers: ['public'],
        fields: [],
        methods,
        line: 1,
      },
    ]);
    const out = runJavaFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const sql = out.filter((f) => f.findingType === 'raw_sql_detected');
    expect(sql).toHaveLength(50);
  });
});

describe('packFindingScanners shim', () => {
  it('runPackFindingScanners fans out to the Java scanner', () => {
    const raw = [
      'package com.example;',
      'public class C {',
      '  public void f() { String q = "SELECT 1"; }',
      '}',
    ].join('\n');
    const ir = makeIr('src/main/java/C.java', raw, [
      {
        name: 'C',
        annotations: [],
        extends: null,
        implements: [],
        isInterface: false,
        isAbstract: false,
        modifiers: ['public'],
        fields: [],
        methods: [
          {
            name: 'f',
            returnType: 'void',
            parameters: [],
            annotations: [],
            modifiers: ['public'],
            line: 2,
          },
        ],
        line: 1,
      },
    ]);
    const out = runPackFindingScanners({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const sql = out.find((f) => f.findingType === 'raw_sql_detected');
    expect(sql).toBeDefined();
    expect(sql?.source).toBe('java-language-pack');
  });
});
