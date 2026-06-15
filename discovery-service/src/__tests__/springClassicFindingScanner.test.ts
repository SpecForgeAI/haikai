/**
 * Tests for the Spring Classic pack finding scanner (Spec 2026-05-16 Wire
 * Java + Spring + Maven Findings -- Task Group 3, sub-task 3.1).
 *
 * Coverage scope (8 focused cases):
 *  - `emitsSpringXmlBeanWiring`: applicationContext.xml with <bean>
 *    definitions produces ONE `spring_xml_bean_wiring` finding.
 *  - `emitsLegacyTransactionConfiguration`: an XML with `tx` namespace
 *    produces ONE `legacy_transaction_configuration` finding.
 *  - `emitsSecurityFilterOrInterceptorDetected`: class implementing
 *    HandlerInterceptor produces one `security_filter_or_interceptor_detected`.
 *  - `emitsScheduledOrBatchJobDetected`: `@Scheduled` annotation produces
 *    one `scheduled_or_batch_job_detected` finding.
 *  - `emitsStoredProcedureOrJdbcUsage`: a `SimpleJdbcCall` site produces
 *    one `stored_procedure_or_jdbc_usage` finding (high severity), and
 *    the snippet is routed through `snippetRedaction.redactSnippet` so
 *    a quoted SQL literal is masked.
 *  - `emitsSpringClassicMigrationRisk`: a `web.xml` file (filename only)
 *    produces one `spring_classic_migration_risk` finding.
 *  - `extendsEvidenceGapWithSpringContractGapTypes`: a POST controller
 *    endpoint missing @RequestBody produces an `evidence_gap` finding
 *    whose `detail_json.gapType === 'endpoint_missing_request_schema'`.
 *  - `enforcesMaxFindingsPerTypePerRunCap`: 60 distinct stored-proc sites
 *    yield exactly 50 `stored_procedure_or_jdbc_usage` findings (cap=50).
 */

import type { DiscoveryCandidate } from '../types/candidate';
import type { SourceFileIR } from '../services/extensionPacks';
import { runSpringClassicFindingScanner } from '../services/findings/packFindingScanners/springClassicFindingScanner';

const RUN_ID = 'run-spring-scan-001';

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

// ============================================================================
// spring_xml_bean_wiring
// ============================================================================
describe('springClassicFindingScanner -- spring_xml_bean_wiring', () => {
  it('emits one finding per XML config file with <bean> definitions', () => {
    const ir = makeXmlIr(
      'src/main/resources/applicationContext.xml',
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
        {
          beanKey: 'paymentService',
          id: 'paymentService',
          aliases: [],
          fullyQualifiedClass: 'com.example.PaymentService',
          simpleClassName: 'PaymentService',
          dependencyRefs: [],
        },
      ],
      [],
    );
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const wiring = out.filter((f) => f.findingType === 'spring_xml_bean_wiring');
    expect(wiring).toHaveLength(1);
    expect(wiring[0].severity).toBe('medium');
    expect(wiring[0].source).toBe('spring-classic-framework-pack');
    expect(wiring[0].createdByStage).toBe('deterministic_spring_classic_analysis');
    const detail = wiring[0].detailJson as Record<string, unknown>;
    expect(detail.configFilePath).toBe('src/main/resources/applicationContext.xml');
    expect(detail.beanCount).toBe(2);
    expect(Array.isArray(detail.topBeans)).toBe(true);
    expect((detail.topBeans as unknown[]).length).toBe(2);
  });
});

// ============================================================================
// legacy_transaction_configuration
// ============================================================================
describe('springClassicFindingScanner -- legacy_transaction_configuration', () => {
  it('emits one finding when XML carries the `tx` namespace', () => {
    const xmlRaw = `
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:tx="http://www.springframework.org/schema/tx">
  <tx:advice id="txAdvice" transaction-manager="transactionManager">
    <tx:attributes>
      <tx:method name="save*" propagation="REQUIRED"/>
    </tx:attributes>
  </tx:advice>
  <bean id="transactionManager" class="org.springframework.orm.hibernate5.HibernateTransactionManager"/>
</beans>`;
    const ir = makeXmlIr(
      'src/main/resources/tx-context.xml',
      xmlRaw,
      [
        {
          beanKey: 'transactionManager',
          id: 'transactionManager',
          aliases: [],
          fullyQualifiedClass: 'org.springframework.orm.hibernate5.HibernateTransactionManager',
          simpleClassName: 'HibernateTransactionManager',
          dependencyRefs: [],
        },
      ],
      ['tx'],
    );
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const tx = out.filter((f) => f.findingType === 'legacy_transaction_configuration');
    expect(tx).toHaveLength(1);
    expect(tx[0].severity).toBe('medium');
    const detail = tx[0].detailJson as Record<string, unknown>;
    expect(detail.detectedPattern).toBe('tx_namespace');
    expect(detail.configFilePath).toBe('src/main/resources/tx-context.xml');
  });
});

// ============================================================================
// security_filter_or_interceptor_detected
// ============================================================================
describe('springClassicFindingScanner -- security_filter_or_interceptor_detected', () => {
  it('emits one finding for a class implementing HandlerInterceptor', () => {
    const ir = makeJavaIr(
      'src/main/java/AuthInterceptor.java',
      'package com.example;\npublic class AuthInterceptor implements HandlerInterceptor {}\n',
      [
        {
          name: 'AuthInterceptor',
          annotations: [],
          extends: null,
          implements: ['HandlerInterceptor'],
          isInterface: false,
          isAbstract: false,
          modifiers: ['public'],
          fields: [],
          methods: [],
          line: 1,
        },
      ],
    );
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const sec = out.filter(
      (f) => f.findingType === 'security_filter_or_interceptor_detected',
    );
    expect(sec).toHaveLength(1);
    expect(sec[0].category).toBe('security');
    expect(sec[0].severity).toBe('medium');
    const detail = sec[0].detailJson as Record<string, unknown>;
    expect(detail.detectedPattern).toBe('implements_handler_interceptor');
    expect(detail.className).toBe('AuthInterceptor');
  });
});

// ============================================================================
// scheduled_or_batch_job_detected
// ============================================================================
describe('springClassicFindingScanner -- scheduled_or_batch_job_detected', () => {
  it('emits one finding per @Scheduled method', () => {
    const ir = makeJavaIr(
      'src/main/java/CleanupJob.java',
      'package com.example;\npublic class CleanupJob { public void run() {} }\n',
      [
        {
          name: 'CleanupJob',
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
              annotations: [
                { name: 'Scheduled', args: { cron: '0 0 * * * *' }, line: 2 },
              ],
              modifiers: ['public'],
              line: 2,
            },
          ],
          line: 1,
        },
      ],
    );
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const sched = out.filter((f) => f.findingType === 'scheduled_or_batch_job_detected');
    expect(sched).toHaveLength(1);
    expect(sched[0].severity).toBe('medium');
    const detail = sched[0].detailJson as Record<string, unknown>;
    expect(detail.detectedPattern).toBe('scheduled_annotation');
    expect(detail.controllerClass).toBe('CleanupJob');
    expect(detail.methodName).toBe('run');
    const sched2 = (detail.scheduleConfig as Record<string, unknown>).cronOrSchedule;
    expect(sched2).toBe('0 0 * * * *');
  });
});

// ============================================================================
// stored_procedure_or_jdbc_usage + snippet redaction
// ============================================================================
describe('springClassicFindingScanner -- stored_procedure_or_jdbc_usage', () => {
  it('emits a high-severity finding with redacted snippet for SimpleJdbcCall', () => {
    const raw = [
      'package com.example;',
      'public class OrderProcRepo {',
      '  public void run() {',
      '    String proc = "SECRET_PROC_NAME";',
      '    SimpleJdbcCall call = new SimpleJdbcCall(ds).withProcedureName(proc);',
      '  }',
      '}',
    ].join('\n');
    const ir = makeJavaIr('src/main/java/OrderProcRepo.java', raw, [
      {
        name: 'OrderProcRepo',
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
    ]);
    const cand: DiscoveryCandidate = {
      id: 'C-1',
      runId: RUN_ID,
      candidateType: 'service',
      name: 'X',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: [ir.filePath],
      data: {},
      synthesizedAt: '2026-05-16T00:00:00Z',
    };
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [cand],
    });
    const sp = out.filter((f) => f.findingType === 'stored_procedure_or_jdbc_usage');
    expect(sp).toHaveLength(1);
    expect(sp[0].severity).toBe('high');
    const detail = sp[0].detailJson as Record<string, unknown>;
    expect(detail.detectedPattern).toBe('SimpleJdbcCall');
    expect(detail.controllerClass).toBe('OrderProcRepo');
    expect(detail.methodName).toBe('run');
    // The snippet went through redactSnippet -- quoted string literals
    // collapse to `?`, so the verbatim SECRET_PROC_NAME does NOT leak.
    expect(typeof detail.evidenceSnippet).toBe('string');
    expect(detail.evidenceSnippet).not.toContain('SECRET_PROC_NAME');
    // Link points to the candidate we registered.
    const candLink = sp[0].links?.find((l) => l.targetType === 'discovery_candidate');
    expect(candLink?.targetId).toBe('C-1');
  });
});

// ============================================================================
// spring_classic_migration_risk -- web.xml filename detection
// ============================================================================
describe('springClassicFindingScanner -- spring_classic_migration_risk', () => {
  it('emits a finding when web.xml is present (filename only)', () => {
    // A bare web.xml entry -- no springXmlBeans, no classes. Filename-only
    // detection MUST still fire.
    const ir: SourceFileIR = {
      filePath: 'src/main/webapp/WEB-INF/web.xml',
      language: 'xml',
      packageOrNamespace: null,
      imports: [],
      classes: [],
      functions: [],
      rawContent: '<web-app/>',
    };
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const risk = out.filter((f) => f.findingType === 'spring_classic_migration_risk');
    expect(risk).toHaveLength(1);
    expect(risk[0].severity).toBe('medium');
    const detail = risk[0].detailJson as Record<string, unknown>;
    expect(detail.detectedPattern).toBe('web_xml_present');
    expect(detail.configFilePath).toBe('src/main/webapp/WEB-INF/web.xml');
  });
});

// ============================================================================
// evidence_gap extension (Spring contract gapTypes)
// ============================================================================
describe('springClassicFindingScanner -- evidence_gap extension', () => {
  it('emits evidence_gap with gapType=endpoint_missing_request_schema for a POST without @RequestBody', () => {
    const ir = makeJavaIr(
      'src/main/java/OrderController.java',
      'package com.example;\n@RestController\npublic class OrderController {\n  @PostMapping("/orders") public void create() {}\n}\n',
      [
        {
          name: 'OrderController',
          annotations: [{ name: 'RestController', args: {}, line: 1 }],
          extends: null,
          implements: [],
          isInterface: false,
          isAbstract: false,
          modifiers: ['public'],
          fields: [],
          methods: [
            {
              name: 'create',
              returnType: 'void',
              parameters: [], // <-- no @RequestBody!
              annotations: [
                { name: 'PostMapping', args: { value: '/orders' }, line: 3 },
              ],
              modifiers: ['public'],
              line: 3,
            },
          ],
          line: 1,
        },
      ],
    );
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const gaps = out.filter((f) => f.findingType === 'evidence_gap');
    expect(gaps.length).toBeGreaterThanOrEqual(1);
    const reqGap = gaps.find((f) => {
      const d = f.detailJson as Record<string, unknown> | undefined;
      return d && d.gapType === 'endpoint_missing_request_schema';
    });
    expect(reqGap).toBeDefined();
    const detail = reqGap?.detailJson as Record<string, unknown>;
    expect(detail.controllerClass).toBe('OrderController');
    expect(detail.methodName).toBe('create');
    expect(detail.httpMethod).toBe('POST');
  });
});

// ============================================================================
// Cap enforcement
// ============================================================================
describe('springClassicFindingScanner -- cap enforcement', () => {
  it('enforces MAX_FINDINGS_PER_TYPE_PER_RUN=50 for stored_procedure_or_jdbc_usage', () => {
    // Build a synthetic file with 60 distinct stored-proc call sites
    // (60 different methods, each invoking jdbcTemplate.call once).
    const lines: string[] = ['package com.example;', 'public class Big {'];
    const methods = [];
    for (let i = 0; i < 60; i++) {
      lines.push(`  public void m${i}() { jdbcTemplate.call(callbacks${i}); }`);
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
    const ir = makeJavaIr('src/main/java/Big.java', raw, [
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
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const sp = out.filter((f) => f.findingType === 'stored_procedure_or_jdbc_usage');
    expect(sp).toHaveLength(50);
  });
});


// ============================================================================
// web.xml servlet-mapping PARSE (Spec #4, Task Group 3)
// ============================================================================
describe('springClassicFindingScanner -- web.xml servlet-mapping parse', () => {
  it('parses <servlet>/<servlet-mapping> and summarises them onto the web_xml_present finding (finding KEPT)', () => {
    const xml =
      '<web-app>' +
      '<servlet><servlet-name>report</servlet-name>' +
      '<servlet-class>org.example.web.ReportServlet</servlet-class></servlet>' +
      '<servlet-mapping><servlet-name>report</servlet-name>' +
      '<url-pattern>/reports/*</url-pattern></servlet-mapping>' +
      '</web-app>';
    const ir: SourceFileIR = {
      filePath: 'src/main/webapp/WEB-INF/web.xml',
      language: 'xml',
      packageOrNamespace: null,
      imports: [],
      classes: [],
      functions: [],
      rawContent: xml,
    };
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const risk = out.filter((f) => f.findingType === 'spring_classic_migration_risk');
    // The presence finding is STILL emitted (not replaced).
    expect(risk).toHaveLength(1);
    const detail = risk[0].detailJson as Record<string, unknown>;
    expect(detail.detectedPattern).toBe('web_xml_present');
    // The parsed servlet-mappings are summarised onto the finding.
    expect(detail.servletMappings).toEqual([
      { servletClass: 'org.example.web.ReportServlet', urlPatterns: ['/reports/*'] },
    ]);
  });

  it('keeps the web_xml_present finding with NO servletMappings when the descriptor has none', () => {
    const ir: SourceFileIR = {
      filePath: 'WEB-INF/web.xml',
      language: 'xml',
      packageOrNamespace: null,
      imports: [],
      classes: [],
      functions: [],
      rawContent: '<web-app/>',
    };
    const out = runSpringClassicFindingScanner({
      runId: RUN_ID,
      irFiles: new Map([[ir.filePath, ir]]),
      packCandidates: [],
    });
    const risk = out.filter((f) => f.findingType === 'spring_classic_migration_risk');
    expect(risk).toHaveLength(1);
    const detail = risk[0].detailJson as Record<string, unknown>;
    expect(detail.detectedPattern).toBe('web_xml_present');
    expect(detail.servletMappings).toBeUndefined();
  });
});
