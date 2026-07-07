/**
 * Spec 2026-07-06-m — Spring Classic Internal Functionality (Code-Tier
 * Oracle Program). Pins:
 *
 *   QUARTZ PIN    — MethodInvokingJobDetail + CronTrigger XML -> quartz-job
 *                   fact with VERBATIM cron + resolved target class/method
 *   BATCH PIN     — batch job XML -> batch-job fact with the step graph
 *                   carried VERBATIM
 *   JMS/TASK PINS — jms:listener + task:scheduled facts with destinations /
 *                   schedules verbatim; minted candidates follow the
 *                   `<SUBTYPE-UC> <identifier>` convention with
 *                   fullPath/httpMethod mirroring the annotation emission
 *   ROOTS PIN     — a @Scheduled entry point resolves data-effect edges with
 *                   VERBATIM SQL through the REUSED walk (endpointName =
 *                   `SCHEDULED <cron>`), and an XML-wired target does the
 *                   same via xmlEntryTargets; the HTTP resolver output is
 *                   UNCHANGED (no regression to endpoint rooting)
 *   NAME PIN      — internalListenerEndpointName replicates the adapter's
 *                   listener naming convention
 *   MYBATIS PIN   — mapper XML SQL lands verbatim on query-less edges
 *                   (query_kind mybatis_xml, dynamic flagged); captured
 *                   annotation SQL is never overwritten
 *   SELF-CALL PIN — an internal process whose class makes an outbound HTTP
 *                   call to an OWN endpoint gets calls_own_endpoint
 *   JPA PIN       — @PreUpdate callback -> business_logics candidate +
 *                   finding; persistence.xml named queries matched against
 *                   createNamedQuery call sites
 */

import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { parseSpringBeansXml } from '../services/extensionPacks/languageExtractors/java/springBeansXmlParser';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../types/candidate';
import {
  attachSelfApiCallLinks,
  mintInternalProcessCandidates,
  scanInternalProcessXml,
  xmlEntryTargets,
} from '../services/extensionPacks/frameworkAdapters/springClassic/internalProcessXmlScanner';
import {
  detectInternalEntryPoints,
  internalListenerEndpointName,
  resolveEndpointDataEffects,
  resolveInternalProcessDataEffects,
} from '../services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver';
import {
  applyMyBatisXmlQueries,
  scanMyBatisXmlMappers,
} from '../services/extensionPacks/frameworkAdapters/springClassic/myBatisXmlMapper';
import {
  buildJpaInternalsFindings,
  mintJpaCallbackCandidates,
  scanJpaInternals,
} from '../services/extensionPacks/frameworkAdapters/springClassic/jpaInternalsScanner';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const INTERNAL_XML = `<?xml version="1.0"?>
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:task="http://www.springframework.org/schema/task"
       xmlns:jms="http://www.springframework.org/schema/jms"
       xmlns:batch="http://www.springframework.org/schema/batch">
  <bean id="orderSyncJob" class="com.foo.jobs.OrderSyncJob"/>
  <bean id="syncJobDetail"
        class="org.springframework.scheduling.quartz.MethodInvokingJobDetailFactoryBean">
    <property name="targetObject" ref="orderSyncJob"/>
    <property name="targetMethod" value="run"/>
  </bean>
  <bean class="org.springframework.scheduling.quartz.CronTriggerFactoryBean">
    <property name="jobDetail" ref="syncJobDetail"/>
    <property name="cronExpression" value="0 30 2 * * ?"/>
  </bean>
  <task:scheduled-tasks>
    <task:scheduled ref="orderSyncJob" method="nightly" cron="0 0 3 * * ?"/>
  </task:scheduled-tasks>
  <jms:listener-container>
    <jms:listener destination="orders.inbound" ref="orderSyncJob" method="onOrderMessage"/>
  </jms:listener-container>
  <batch:job id="orderExportJob">
    <batch:step id="readOrders" next="writeOrders">
      <batch:tasklet>
        <batch:chunk reader="orderReader" processor="orderProcessor" writer="orderWriter" commit-interval="100"/>
      </batch:tasklet>
    </batch:step>
    <batch:step id="writeOrders">
      <batch:tasklet ref="exportTasklet"/>
    </batch:step>
  </batch:job>
</beans>`;

const SCHEDULED_JOB = `
package com.foo.jobs;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Scheduled;
import com.foo.service.OrderSyncService;

@Component
public class OrderSyncJob {
  @Autowired private OrderSyncService orderSyncService;

  @Scheduled(cron = "0 0 * * * *")
  public void run() {
    orderSyncService.sync();
  }

  public void nightly() {
    orderSyncService.sync();
  }
}
`;

const SYNC_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.beans.factory.annotation.Autowired;
import com.foo.repo.OrderRepository;

@Service
public class OrderSyncService {
  @Autowired private OrderRepository orderRepository;

  public void sync() {
    orderRepository.findStale();
  }
}
`;

const ORDER_REPO = `
package com.foo.repo;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import com.foo.domain.Order;

public interface OrderRepository extends JpaRepository<Order, Long> {
  @Query(value = "SELECT * FROM orders WHERE synced = 0", nativeQuery = true)
  java.util.List<Order> findStale();
}
`;

const ORDER_ENTITY = `
package com.foo.domain;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.PreUpdate;

@Entity
@Table(name = "orders")
public class Order {
  private Long id;

  @PreUpdate
  public void stampAudit() {
    // mutates audit columns invisibly
  }
}
`;

const MAPPER_REPO = `
package com.foo.repo;
public interface LegacyOrderMapper {
  java.util.List<Object> selectOverdue();
}
`;

const MAPPER_XML = `<?xml version="1.0"?>
<mapper namespace="com.foo.repo.LegacyOrderMapper">
  <select id="selectOverdue" resultType="map">
    SELECT * FROM orders
    <if test="cutoff != null">WHERE due_date &lt; #{cutoff}</if>
  </select>
</mapper>`;

const PERSISTENCE_XML = `<?xml version="1.0"?>
<persistence xmlns="https://jakarta.ee/xml/ns/persistence">
  <persistence-unit name="main">
    <named-query name="Order.findShipped"><query>SELECT o FROM Order o WHERE o.shipped = true</query></named-query>
    <named-query name="Order.orphaned"><query>SELECT o FROM Order o WHERE o.owner IS NULL</query></named-query>
  </persistence-unit>
</persistence>`;

const QUERY_CALLER = `
package com.foo.service;
import jakarta.persistence.EntityManager;

public class ReportService {
  private EntityManager em;
  public Object shipped() {
    return em.createNamedQuery("Order.findShipped").getResultList();
  }
}
`;

function javaIr(path: string, src: string): SourceFileIR {
  const ir = extractJavaIR(path, src);
  if (!ir) throw new Error(`extractJavaIR returned null for ${path}`);
  return ir;
}

function springXmlIr(path: string, src: string): SourceFileIR {
  return {
    filePath: path,
    language: 'spring-xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    springXmlBeans: parseSpringBeansXml(src),
    rawContent: src,
  };
}

function rawIr(path: string, language: string, src: string): SourceFileIR {
  return {
    filePath: path,
    language,
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent: src,
  };
}

const JAVA_FILES = [
  javaIr('src/main/java/com/foo/jobs/OrderSyncJob.java', SCHEDULED_JOB),
  javaIr('src/main/java/com/foo/service/OrderSyncService.java', SYNC_SERVICE),
  javaIr('src/main/java/com/foo/repo/OrderRepository.java', ORDER_REPO),
];

// ---------------------------------------------------------------------------

describe('QUARTZ / TASK / JMS / BATCH XML PINS', () => {
  const scan = scanInternalProcessXml([springXmlIr('ctx.xml', INTERNAL_XML)]);

  it('QUARTZ PIN: cron trigger joins its method-invoking job detail, cron VERBATIM', () => {
    const quartz = scan.processes.find((p) => p.subtype === 'quartz-job')!;
    expect(quartz.name).toBe('QUARTZ-JOB OrderSyncJob');
    expect(quartz.metadata.cron_expression).toBe('0 30 2 * * ?');
    expect(quartz.className).toBe('OrderSyncJob');
    expect(quartz.methodName).toBe('run');
  });

  it('TASK PIN: task:scheduled carries schedule + target verbatim', () => {
    const task = scan.processes.find((p) => p.subtype === 'scheduled')!;
    expect(task.name).toBe('SCHEDULED 0 0 3 * * ?');
    expect(task.metadata.target_method).toBe('nightly');
    expect(task.className).toBe('OrderSyncJob');
  });

  it('JMS PIN: jms:listener destination verbatim', () => {
    const jms = scan.processes.find((p) => p.subtype === 'jms-listener')!;
    expect(jms.name).toBe('JMS-LISTENER orders.inbound');
    expect(jms.methodName).toBe('onOrderMessage');
  });

  it('BATCH PIN: step graph carried verbatim', () => {
    const batch = scan.processes.find((p) => p.subtype === 'batch-job')!;
    expect(batch.name).toBe('BATCH-JOB orderExportJob');
    const graph = batch.metadata.batch_graph as { steps: Array<Record<string, unknown>> };
    expect(graph.steps).toHaveLength(2);
    expect(graph.steps[0]).toMatchObject({
      id: 'readOrders',
      next: 'writeOrders',
      reader_ref: 'orderReader',
      writer_ref: 'orderWriter',
      commit_interval: '100',
    });
    expect(graph.steps[1]).toMatchObject({ id: 'writeOrders', tasklet_ref: 'exportTasklet' });
  });

  it('minted candidates mirror the listener emission shape (fullPath + httpMethod)', () => {
    const minted = mintInternalProcessCandidates(scan, 'run-1');
    const jms = minted.find((c) => c.name === 'JMS-LISTENER orders.inbound')!;
    expect(jms.data).toMatchObject({
      endpoint_subtype: 'jms-listener',
      fullPath: 'orders.inbound',
      httpMethod: 'JMS_LISTENER',
    });
    expect((jms.data as { internal_process: unknown }).internal_process).toBeDefined();
  });
});

describe('ROOTS PIN (criterion B)', () => {
  it('a @Scheduled entry resolves data-effect edges with VERBATIM SQL through the reused walk', () => {
    const { resolved } = resolveInternalProcessDataEffects(JAVA_FILES);
    const edge = resolved.find((r) => r.endpointName === 'SCHEDULED 0 0 * * * *');
    expect(edge).toBeDefined();
    expect(edge!.queryText).toBe('SELECT * FROM orders WHERE synced = 0');
    expect(edge!.path.some((h) => h.role === 'service')).toBe(true);
  });

  it('an XML-wired target (no annotation) resolves via xmlEntryTargets', () => {
    const scan = scanInternalProcessXml([springXmlIr('ctx.xml', INTERNAL_XML)]);
    const { resolved } = resolveInternalProcessDataEffects(JAVA_FILES, xmlEntryTargets(scan));
    const nightly = resolved.find((r) => r.endpointName === 'SCHEDULED 0 0 3 * * ?');
    expect(nightly).toBeDefined();
    expect(nightly!.queryText).toBe('SELECT * FROM orders WHERE synced = 0');
  });

  it('NO REGRESSION: the HTTP resolver output is unchanged by internal rooting', () => {
    const { resolved } = resolveEndpointDataEffects(JAVA_FILES);
    expect(resolved).toHaveLength(0); // no controllers in the fixture
  });

  it('detectInternalEntryPoints dedupes an XML target that is already annotated', () => {
    const scan = scanInternalProcessXml([springXmlIr('ctx.xml', INTERNAL_XML)]);
    // The quartz XML targets OrderSyncJob#run, which is ALSO @Scheduled.
    const entries = detectInternalEntryPoints(JAVA_FILES, xmlEntryTargets(scan));
    const runEntries = entries.filter((e) => e.method.name === 'run');
    expect(runEntries).toHaveLength(1);
    expect(runEntries[0].entryName).toBe('SCHEDULED 0 0 * * * *'); // annotation wins
  });
});

describe('NAME PIN', () => {
  it('replicates the adapter listener-name convention', () => {
    expect(
      internalListenerEndpointName(
        'JmsListener',
        { name: 'JmsListener', args: { destination: 'orders.inbound' } } as never,
        'onMsg'
      )
    ).toBe('JMS-LISTENER orders.inbound');
    expect(
      internalListenerEndpointName(
        'Scheduled',
        { name: 'Scheduled', args: { fixedDelay: '5000' } } as never,
        'tick'
      )
    ).toBe('SCHEDULED fixedDelay=5000');
  });
});

describe('MYBATIS PIN', () => {
  it('enriches query-less edges with verbatim mapper SQL; never overwrites captured SQL', () => {
    const scan = scanMyBatisXmlMappers([rawIr('mapper.xml', 'mybatis-xml', MAPPER_XML)]);
    expect(scan.statements).toHaveLength(1);
    expect(scan.statements[0].dynamic).toBe(true);

    const bare: DiscoveryCandidate = {
      id: 'e1',
      runId: 'r',
      candidateType: 'endpoint_data_effects',
      name: 'SCHEDULED x → orders (read)',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: ['x'],
      data: {
        path_metadata_json: {
          path: [
            { className: 'OrderSyncJob', methodName: 'run', role: 'controller' },
            { className: 'LegacyOrderMapper', methodName: 'selectOverdue', role: 'repository' },
          ],
        },
      },
      synthesizedAt: new Date().toISOString(),
    } as DiscoveryCandidate;
    const captured: DiscoveryCandidate = {
      ...bare,
      id: 'e2',
      data: {
        path_metadata_json: {
          query_text: 'SELECT 1',
          query_kind: 'native',
          path: [
            { className: 'LegacyOrderMapper', methodName: 'selectOverdue', role: 'repository' },
          ],
        },
      },
    } as DiscoveryCandidate;

    const enriched = applyMyBatisXmlQueries([bare, captured], scan);
    expect(enriched).toBe(1);
    const bareMeta = (bare.data as { path_metadata_json: Record<string, unknown> })
      .path_metadata_json;
    expect(bareMeta.query_kind).toBe('mybatis_xml');
    expect(bareMeta.dynamic_sql).toBe(true);
    expect(String(bareMeta.query_text)).toContain('SELECT * FROM orders');
    expect(String(bareMeta.query_text)).toContain('<if test='); // verbatim, never composed
    const capturedMeta = (captured.data as { path_metadata_json: Record<string, unknown> })
      .path_metadata_json;
    expect(capturedMeta.query_text).toBe('SELECT 1'); // annotation capture wins
  });
});

describe('SELF-CALL PIN', () => {
  it('stamps calls_own_endpoint when the internal class targets an own endpoint', () => {
    const internal: DiscoveryCandidate = {
      id: 'i1',
      runId: 'r',
      candidateType: 'endpoints',
      name: 'SCHEDULED 0 0 * * * *',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: ['x'],
      data: { endpoint_subtype: 'scheduled', className: 'OrderSyncJob', fullPath: '0 0 * * * *' },
      synthesizedAt: new Date().toISOString(),
    } as DiscoveryCandidate;
    const ownEndpoint: DiscoveryCandidate = {
      ...internal,
      id: 'h1',
      name: 'POST /api/orders/{id}/sync',
      data: { httpMethod: 'POST', fullPath: '/api/orders/{id}/sync' },
    } as DiscoveryCandidate;
    const outbound: DiscoveryCandidate = {
      ...internal,
      id: 'o1',
      candidateType: 'data_movements',
      name: 'OrderSyncJob → self',
      data: {
        ownerClassName: 'OrderSyncJob',
        target: 'http://localhost:8080/api/orders/42/sync',
        movementType: 'http',
      },
    } as DiscoveryCandidate;

    const stamped = attachSelfApiCallLinks([internal, ownEndpoint, outbound]);
    expect(stamped).toBe(1);
    expect((internal.data as { calls_own_endpoint: string[] }).calls_own_endpoint).toEqual([
      'POST /api/orders/{id}/sync',
    ]);
  });
});

describe('JPA PIN', () => {
  it('surfaces lifecycle callbacks as business_logics + findings, and matches named queries', () => {
    const files = [
      javaIr('src/main/java/com/foo/domain/Order.java', ORDER_ENTITY),
      javaIr('src/main/java/com/foo/service/ReportService.java', QUERY_CALLER),
      rawIr('META-INF/persistence.xml', 'persistence-xml', PERSISTENCE_XML),
    ];
    const scan = scanJpaInternals(files);
    expect(scan.callbacks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ entityClass: 'Order', methodName: 'stampAudit', callback: 'PreUpdate' }),
      ])
    );
    const candidates = mintJpaCallbackCandidates(scan, 'run-1');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].data).toMatchObject({ beanKind: 'entity-lifecycle-callback' });

    const shipped = scan.namedQueries.find((q) => q.name === 'Order.findShipped')!;
    expect(shipped.referenced).toBe(true);
    const orphaned = scan.namedQueries.find((q) => q.name === 'Order.orphaned')!;
    expect(orphaned.referenced).toBe(false);

    const findings = buildJpaInternalsFindings(scan);
    expect(findings.map((f) => f.findingType)).toEqual(
      expect.arrayContaining([
        'entity_lifecycle_callback',
        'persistence_named_query',
        'persistence_named_query_unmatched',
      ])
    );
  });
});
