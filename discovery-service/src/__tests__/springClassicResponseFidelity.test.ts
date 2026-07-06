/**
 * Spec 2026-07-06-l — Spring Classic Response Fidelity (Code-Tier Oracle
 * Program). Pins for the three new deterministic passes + the request-binding
 * additions:
 *
 *   WEB-XML PIN   — ordered filter chain, error-pages merged into
 *                   error_responses, encoding-filter charset
 *   XML-MVC PIN   — SimpleUrl/BeanName handler mappings minted as endpoints
 *                   (default-GET VISIBLY marked), interceptors mapped onto
 *                   matching endpoints, security intercept-url (literal roles
 *                   resolved / SpEL carried unresolved)
 *   TX PIN        — tx:advice + aop pointcut flips `transactional` on the
 *                   emitted data-effect edge (annotation-free code)
 *   HEADER PIN    — literal code-set header captured verbatim; computed header
 *                   carried as expression + response_header_unresolved Finding
 *   VIEW PIN      — @Controller String-returning handler -> response_kind
 *                   'view-html' + parity_scope out_of_scope_view + Finding;
 *                   @RestController sibling -> 'json'
 *   COOKIE PIN    — @CookieValue / @MatrixVariable / @RequestPart land in
 *                   request_contract.param_formats with their locations
 *
 * Conventions: real Java through `extractJavaIR`, raw XML as SourceFileIR
 * rawContent entries, NO LLM anywhere (all passes are pure).
 */

import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../types/candidate';
import {
  attachWebXmlResponseFacts,
  parseWebXmlResponseFacts,
  scanWebXmlResponseFacts,
  urlPatternMatches,
} from '../services/extensionPacks/frameworkAdapters/springClassic/webXmlResponseFacts';
import {
  antPatternMatches,
  applyXmlTransactionalMatchers,
  attachXmlMvcFacts,
  buildXmlMvcEndpointCandidates,
  buildXmlMvcFindings,
  parsePointcutExpression,
  scanXmlMvc,
} from '../services/extensionPacks/frameworkAdapters/springClassic/xmlMvcScanner';
import {
  attachCodeResponseFacts,
  buildCodeResponseFactsFindings,
  scanCodeResponseFacts,
} from '../services/extensionPacks/frameworkAdapters/springClassic/codeResponseFactsScanner';
import { scanRequestContracts } from '../services/extensionPacks/frameworkAdapters/springClassic/requestContractScanner';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WEB_XML = `<?xml version="1.0" encoding="UTF-8"?>
<web-app xmlns="http://java.sun.com/xml/ns/javaee">
  <filter>
    <filter-name>encodingFilter</filter-name>
    <filter-class>org.springframework.web.filter.CharacterEncodingFilter</filter-class>
    <init-param><param-name>encoding</param-name><param-value>ISO-8859-1</param-value></init-param>
    <init-param><param-name>forceEncoding</param-name><param-value>true</param-value></init-param>
  </filter>
  <filter>
    <filter-name>auditFilter</filter-name>
    <filter-class>com.foo.web.AuditFilter</filter-class>
  </filter>
  <filter-mapping>
    <filter-name>encodingFilter</filter-name>
    <url-pattern>/*</url-pattern>
  </filter-mapping>
  <filter-mapping>
    <filter-name>auditFilter</filter-name>
    <url-pattern>/api/*</url-pattern>
    <dispatcher>REQUEST</dispatcher>
  </filter-mapping>
  <listener>
    <listener-class>com.foo.boot.StartupListener</listener-class>
  </listener>
  <error-page><error-code>404</error-code><location>/errors/404.jsp</location></error-page>
  <error-page><exception-type>com.foo.FooException</exception-type><location>/errors/foo.jsp</location></error-page>
  <session-config>
    <session-timeout>30</session-timeout>
    <cookie-config><http-only>true</http-only><secure>false</secure></cookie-config>
  </session-config>
  <context-param><param-name>appMode</param-name><param-value>classic</param-value></context-param>
  <mime-mapping><extension>csv</extension><mime-type>text/csv</mime-type></mime-mapping>
</web-app>`;

const SPRING_XML = `<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:mvc="http://www.springframework.org/schema/mvc"
       xmlns:security="http://www.springframework.org/schema/security"
       xmlns:tx="http://www.springframework.org/schema/tx"
       xmlns:aop="http://www.springframework.org/schema/aop">
  <bean class="org.springframework.web.servlet.handler.SimpleUrlHandlerMapping">
    <property name="mappings">
      <props>
        <prop key="/legacy/orders.do">legacyOrderController</prop>
      </props>
    </property>
  </bean>
  <bean id="/reports.do" class="com.foo.web.ReportsController"/>
  <mvc:interceptors>
    <bean class="com.foo.web.GlobalLoggingInterceptor"/>
    <mvc:interceptor>
      <mvc:mapping path="/admin/**"/>
      <bean class="com.foo.web.AdminAuditInterceptor"/>
    </mvc:interceptor>
  </mvc:interceptors>
  <security:http>
    <security:intercept-url pattern="/admin/**" access="hasRole('ADMIN')"/>
    <security:intercept-url pattern="/api/**" access="isAuthenticated() and hasIpAddress('10.0.0.0/8')"/>
  </security:http>
  <tx:advice id="txAdvice" transaction-manager="txManager"/>
  <aop:config>
    <aop:pointcut id="svc" expression="execution(* com.foo.service.*.*(..))"/>
    <aop:advisor advice-ref="txAdvice" pointcut-ref="svc" pointcut="execution(* com.foo.service.*.*(..))"/>
    <aop:pointcut id="weird" expression="@annotation(com.foo.Custom)"/>
  </aop:config>
</beans>`;

const HEADER_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import javax.servlet.http.HttpServletResponse;

@RestController
@RequestMapping("/api")
public class HeaderController {
  @GetMapping("/download")
  public String download(HttpServletResponse response) {
    response.setHeader("X-Export-Version", "3");
    response.addHeader(computeName(), "dynamic");
    response.setStatus(404);
    response.sendRedirect("/login");
    return "ok";
  }
  private String computeName() { return "X-Dyn"; }
}
`;

const VIEW_CONTROLLER = `
package com.foo.web;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
@RequestMapping("/pages")
public class PageController {
  @GetMapping("/home")
  public String home() {
    return "home";
  }
}
`;

const BINDINGS_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.CookieValue;
import org.springframework.web.bind.annotation.MatrixVariable;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/bind")
public class BindingsController {
  @GetMapping("/session")
  public String session(@CookieValue("JSESSIONID") String sessionId) { return "ok"; }

  @GetMapping("/matrix/{seg}")
  public String matrix(@MatrixVariable("q") String q) { return "ok"; }

  @PostMapping("/upload")
  public String upload(@RequestPart("file") MultipartFile file) { return "ok"; }
}
`;

function javaIr(path: string, src: string): SourceFileIR {
  const ir = extractJavaIR(path, src);
  if (!ir) throw new Error(`extractJavaIR returned null for ${path}`);
  return ir;
}

function xmlIr(path: string, src: string): SourceFileIR {
  return {
    filePath: path,
    language: 'spring-xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent: src,
  };
}

function webXmlIr(path: string, src: string): SourceFileIR {
  return {
    filePath: path,
    language: 'xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent: src,
  };
}

function endpointCandidate(name: string, fullPath: string): DiscoveryCandidate {
  return {
    id: `c-${name}`,
    runId: 'run-1',
    candidateType: 'endpoints',
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: ['x.java'],
    data: { httpMethod: name.split(' ')[0], fullPath },
    synthesizedAt: new Date().toISOString(),
  } as DiscoveryCandidate;
}

// ---------------------------------------------------------------------------

describe('WEB-XML PIN', () => {
  it('parses filters (ordered), error pages, listeners, session config, charset', () => {
    const facts = parseWebXmlResponseFacts(WEB_XML);
    expect(facts.filters.map((f) => f.filterName)).toEqual(['encodingFilter', 'auditFilter']);
    expect(facts.filters[0].isEncodingFilter).toBe(true);
    expect(facts.charset).toBe('ISO-8859-1');
    expect(facts.filters[1].urlPatterns).toEqual(['/api/*']);
    expect(facts.filters[1].dispatcherTypes).toEqual(['REQUEST']);
    expect(facts.errorPages).toEqual([
      { errorCode: 404, exceptionType: null, location: '/errors/404.jsp' },
      { errorCode: null, exceptionType: 'com.foo.FooException', location: '/errors/foo.jsp' },
    ]);
    expect(facts.listeners).toEqual(['com.foo.boot.StartupListener']);
    expect(facts.sessionConfig).toEqual({
      timeoutMinutes: 30,
      cookieHttpOnly: true,
      cookieSecure: false,
    });
    expect(facts.contextParams.appMode).toBe('classic');
    expect(facts.mimeMappings.csv).toBe('text/csv');
  });

  it('attaches ordered matched filters, merged error pages, and charset onto endpoints', () => {
    const files = [webXmlIr('src/main/webapp/WEB-INF/web.xml', WEB_XML)];
    const facts = scanWebXmlResponseFacts(files);
    const api = endpointCandidate('GET /api/orders', '/api/orders');
    const other = endpointCandidate('GET /public/info', '/public/info');
    const touched = attachWebXmlResponseFacts([api, other], facts);
    expect(touched).toBe(2);

    const apiContract = (api.data as { response_contract: Record<string, unknown> })
      .response_contract;
    const apiFilters = apiContract.filters as Array<{ name: string; order: number }>;
    expect(apiFilters.map((f) => f.name)).toEqual(['encodingFilter', 'auditFilter']);
    const errors = apiContract.error_responses as Array<Record<string, unknown>>;
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ statusCode: 404, source: 'web-xml-error-page' });
    const serialization = apiContract.serialization as Record<string, unknown>;
    expect(serialization.charset).toBe('ISO-8859-1');

    const otherContract = (other.data as { response_contract: Record<string, unknown> })
      .response_contract;
    const otherFilters = otherContract.filters as Array<{ name: string }>;
    expect(otherFilters.map((f) => f.name)).toEqual(['encodingFilter']); // /api/* not matched
  });

  it('servlet-spec url-pattern matching semantics', () => {
    expect(urlPatternMatches('/*', '/anything')).toBe(true);
    expect(urlPatternMatches('/api/*', '/api/orders')).toBe(true);
    expect(urlPatternMatches('/api/*', '/apix')).toBe(false);
    expect(urlPatternMatches('*.do', '/legacy/orders.do')).toBe(true);
    expect(urlPatternMatches('/exact', '/exact')).toBe(true);
  });
});

describe('XML-MVC + TX PINS', () => {
  const files = [xmlIr('src/main/resources/applicationContext.xml', SPRING_XML)];

  it('extracts handler mappings, interceptors, security rules, and tx matchers', () => {
    const scan = scanXmlMvc(files);
    expect(scan.endpoints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/legacy/orders.do',
          handler: 'legacyOrderController',
          mappingKind: 'simple-url-handler-mapping',
        }),
        expect.objectContaining({
          path: '/reports.do',
          handler: 'com.foo.web.ReportsController',
          mappingKind: 'bean-name-url-handler-mapping',
        }),
      ])
    );
    expect(scan.interceptors).toHaveLength(2);
    const scoped = scan.interceptors.find((i) => i.pathPatterns.length > 0)!;
    expect(scoped.interceptorClass).toBe('com.foo.web.AdminAuditInterceptor');
    expect(scoped.pathPatterns).toEqual(['/admin/**']);

    const adminRule = scan.securityRules.find((r) => r.pattern === '/admin/**')!;
    expect(adminRule.resolved).toBe(true);
    expect(adminRule.requiredRoles).toEqual(['ADMIN']);
    const apiRule = scan.securityRules.find((r) => r.pattern === '/api/**')!;
    expect(apiRule.resolved).toBe(false);
    expect(apiRule.access).toContain('hasIpAddress');

    expect(scan.txMatchers.length).toBeGreaterThanOrEqual(1);
    expect(scan.unresolvedPointcuts.map((p) => p.expression)).toContain(
      '@annotation(com.foo.Custom)'
    );
  });

  it('mints default-GET endpoints with the inference VISIBLY marked', () => {
    const scan = scanXmlMvc(files);
    const minted = buildXmlMvcEndpointCandidates(scan, 'run-1');
    const reports = minted.find((c) => c.name === 'GET /reports.do')!;
    expect(reports.data).toMatchObject({
      endpoint_subtype: 'xml-mvc',
      verb_inference: expect.stringContaining('default-get'),
      handlerBean: 'com.foo.web.ReportsController',
    });
  });

  it('attaches interceptors (global to all, scoped by ant path) + security auth', () => {
    const scan = scanXmlMvc(files);
    const admin = endpointCandidate('GET /admin/users', '/admin/users');
    const pub = endpointCandidate('GET /public/info', '/public/info');
    attachXmlMvcFacts([admin, pub], scan);

    const adminContract = (admin.data as { response_contract: Record<string, unknown> })
      .response_contract;
    const adminInterceptors = adminContract.interceptors as Array<{ class: string }>;
    expect(adminInterceptors.map((i) => i.class)).toEqual([
      'com.foo.web.GlobalLoggingInterceptor',
      'com.foo.web.AdminAuditInterceptor',
    ]);
    expect(adminContract.auth).toMatchObject({
      required_roles: ['ADMIN'],
      source: 'security-xml',
    });

    const pubContract = (pub.data as { response_contract: Record<string, unknown> })
      .response_contract;
    expect((pubContract.interceptors as unknown[]).length).toBe(1); // global only
    expect(pubContract.auth).toBeUndefined(); // no rule matches /public
  });

  it('TX PIN: flips transactional on data-effect edges whose hops match the pointcut', () => {
    const scan = scanXmlMvc(files);
    const edge: DiscoveryCandidate = {
      id: 'edge-1',
      runId: 'run-1',
      candidateType: 'endpoint_data_effects',
      name: 'GET /legacy/orders.do -> orders',
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: ['x.java'],
      data: {
        transactional: false,
        path_metadata_json: {
          transactional: false,
          path: [
            { className: 'com.foo.web.LegacyOrderController', methodName: 'handle' },
            { className: 'com.foo.service.OrderService', methodName: 'load' },
          ],
        },
      },
      synthesizedAt: new Date().toISOString(),
    } as DiscoveryCandidate;
    const other: DiscoveryCandidate = {
      ...edge,
      id: 'edge-2',
      data: {
        transactional: false,
        path_metadata_json: {
          transactional: false,
          path: [{ className: 'com.foo.util.Helper', methodName: 'noop' }],
        },
      },
    } as DiscoveryCandidate;

    const flipped = applyXmlTransactionalMatchers([edge, other], scan.txMatchers);
    expect(flipped).toBe(1);
    expect((edge.data as { transactional: boolean }).transactional).toBe(true);
    expect(
      (edge.data as { path_metadata_json: { transactional: boolean } }).path_metadata_json
        .transactional
    ).toBe(true);
    expect((other.data as { transactional: boolean }).transactional).toBe(false);
  });

  it('builds findings for unresolved pointcuts and unresolved security accesses', () => {
    const scan = scanXmlMvc(files);
    const findings = buildXmlMvcFindings(scan);
    expect(findings.map((f) => f.findingType)).toEqual(
      expect.arrayContaining(['tx_pointcut_unresolved', 'endpoint_auth_unresolved'])
    );
  });

  it('pointcut + ant helpers behave', () => {
    const m = parsePointcutExpression('execution(* com.foo.service.*.*(..))', 'f.xml')!;
    expect(m.classPattern.test('com.foo.service.OrderService')).toBe(true);
    expect(m.classPattern.test('com.foo.web.OrderController')).toBe(false);
    const w = parsePointcutExpression('within(com.foo..*)', 'f.xml')!;
    expect(w.classPattern.test('com.foo.service.deep.Thing')).toBe(true);
    expect(parsePointcutExpression('@annotation(X)', 'f.xml')).toBeNull();
    expect(antPatternMatches('/admin/**', '/admin/a/b')).toBe(true);
    expect(antPatternMatches('/admin/*', '/admin/a/b')).toBe(false);
  });
});

describe('HEADER + VIEW PINS', () => {
  const files = [
    javaIr('src/main/java/com/foo/web/HeaderController.java', HEADER_CONTROLLER),
    javaIr('src/main/java/com/foo/web/PageController.java', VIEW_CONTROLLER),
  ];

  it('captures literal headers verbatim, expressions unresolved, status + redirect', () => {
    const scan = scanCodeResponseFacts(files);
    const facts = scan.factsByEndpointName.get('GET /api/download')!;
    expect(facts).toBeDefined();
    const literal = facts.headersSetInCode.find((h) => h.name === 'X-Export-Version')!;
    expect(literal).toMatchObject({ value: '3', resolved: true, source: 'servlet-response' });
    const dynamic = facts.headersSetInCode.find((h) => !h.resolved)!;
    expect(dynamic.name).toContain('computeName');
    expect(facts.statusCodesSetInCode).toEqual([404]);
    expect(facts.redirects).toEqual([{ target: '/login', resolved: true }]);
    expect(facts.responseKind).toBe('json'); // @RestController
  });

  it('classifies the @Controller String handler as view-html and attaches parity scope', () => {
    const scan = scanCodeResponseFacts(files);
    const view = scan.factsByEndpointName.get('GET /pages/home')!;
    expect(view.responseKind).toBe('view-html');

    const candidate = endpointCandidate('GET /pages/home', '/pages/home');
    attachCodeResponseFacts([candidate], scan);
    const contract = (candidate.data as { response_contract: Record<string, unknown> })
      .response_contract;
    expect(contract.response_kind).toBe('view-html');
    expect(contract.parity_scope).toBe('out_of_scope_view');
  });

  it('emits response_header_unresolved + view_endpoint_out_of_parity_scope findings', () => {
    const findings = buildCodeResponseFactsFindings(scanCodeResponseFacts(files));
    const types = findings.map((f) => f.findingType);
    expect(types).toContain('response_header_unresolved');
    expect(types).toContain('view_endpoint_out_of_parity_scope');
  });
});

describe('COOKIE / MATRIX / MULTIPART PIN', () => {
  it('captures the three bindings in request_contract.param_formats', () => {
    const files = [javaIr('src/main/java/com/foo/web/BindingsController.java', BINDINGS_CONTROLLER)];
    const scan = scanRequestContracts(files);

    const session = scan.contractsByEndpointName.get('GET /bind/session')!;
    expect(session.param_formats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'JSESSIONID', location: 'cookie', source: 'binding' }),
      ])
    );

    const matrix = scan.contractsByEndpointName.get('GET /bind/matrix/{seg}')!;
    expect(matrix.param_formats).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'q', location: 'matrix' })])
    );

    const upload = scan.contractsByEndpointName.get('POST /bind/upload')!;
    expect(upload.param_formats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'file', location: 'multipart', source: 'binding' }),
      ])
    );
  });
});
