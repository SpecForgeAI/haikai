/**
 * Spec #4 (Inbound Surface Completeness), Task Group 3 — raw servlet /
 * `web.xml` / `@WebServlet` candidate emission.
 *
 * Candidate-emission assertions (the finding-scanner web.xml PARSE assertions
 * live in `springClassicFindingScanner.test.ts`). Drives the harness-visible
 * surface: `extractJavaIR` (and a synthetic web.xml `SourceFileIR`) ->
 * `runSpringClassicAdapter` -> filter `endpoints`/`interfaces`.
 *
 * Servlet endpoints emit the canonical candidate shape (`confidence: 0.9`,
 * `status: 'proposed'`, endpoint `data` carrying `httpMethod`/`fullPath`/
 * `methodName`/`controllerClassName`/`returnType`) with `_addedBy:
 * 'spring-classic-servlet'`. ADD/EXTEND only; built on HEAD `f33b44a` + TG1.
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';
import type { SourceFileIR } from '../services/extensionPacks';
import type { DiscoveryCandidate } from '../types/candidate';

function javaIr(path: string, src: string): SourceFileIR {
  const ir = extractJavaIR(path, src);
  expect(ir).toBeTruthy();
  return ir!;
}

/** A synthetic web.xml SourceFileIR (filename + rawContent only) — the shape
 *  the java language pack admits for `web.xml`. */
function webXmlIr(path: string, xml: string): SourceFileIR {
  return {
    filePath: path,
    language: 'xml',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent: xml,
  };
}

function run(files: SourceFileIR[]): DiscoveryCandidate[] {
  return runSpringClassicAdapter(files, 'tg3-run');
}
function endpoints(cands: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return cands.filter((c) => c.candidateType === 'endpoints');
}
function servletEndpointNames(cands: DiscoveryCandidate[]): string[] {
  return endpoints(cands)
    .filter((c) => (c.data as Record<string, unknown>)._addedBy === 'spring-classic-servlet')
    .map((c) => c.name)
    .sort();
}
function servletInterfaces(cands: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return cands.filter(
    (c) =>
      c.candidateType === 'interfaces' &&
      (c.data as Record<string, unknown>)._addedBy === 'spring-classic-servlet',
  );
}

describe('TG3 — @WebServlet + extends HttpServlet', () => {
  it('@WebServlet(urlPatterns={"/a","/b"}) with doGet/doPost emits one endpoint per (url-pattern × inferred verb)', () => {
    const SRC = `package org.example.web;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
@WebServlet(urlPatterns = {"/a", "/b"})
public class AbServlet extends HttpServlet {
  protected void doGet(Object req, Object resp) {}
  protected void doPost(Object req, Object resp) {}
}`;
    const cands = run([javaIr('web/AbServlet.java', SRC)]);
    // 2 url-patterns × {GET, POST} = 4 endpoints.
    expect(servletEndpointNames(cands)).toEqual([
      'GET /a',
      'GET /b',
      'POST /a',
      'POST /b',
    ]);
    const ifaces = servletInterfaces(cands);
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('AbServlet');
    expect(ifaces[0].data.controllerType).toBe('Servlet');

    const getA = endpoints(cands).find((e) => e.name === 'GET /a')!;
    expect(getA.data.httpMethod).toBe('GET');
    expect(getA.data.fullPath).toBe('/a');
    expect(getA.data.controllerClassName).toBe('AbServlet');
    expect(getA.data.methodName).toBe('doGet');
    expect(getA.confidence).toBe(0.9);
    expect(getA.status).toBe('proposed');
    expect(getA.parentCandidateId).toBe(ifaces[0].id);
  });

  it('@WebServlet(value="/legacy") (value shorthand) infers GET when only doGet is present', () => {
    const SRC = `package org.example.web;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
@WebServlet("/legacy")
public class LegacyServlet extends HttpServlet {
  protected void doGet(Object req, Object resp) {}
}`;
    const cands = run([javaIr('web/LegacyServlet.java', SRC)]);
    expect(servletEndpointNames(cands)).toEqual(['GET /legacy']);
  });

  it('service(...) surfaces as all verbs per the default-verb convention', () => {
    const SRC = `package org.example.web;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
@WebServlet("/all")
public class AllServlet extends HttpServlet {
  protected void service(Object req, Object resp) {}
}`;
    const cands = run([javaIr('web/AllServlet.java', SRC)]);
    expect(servletEndpointNames(cands)).toEqual([
      'DELETE /all',
      'GET /all',
      'POST /all',
      'PUT /all',
    ]);
  });

  it('a bare extends HttpServlet (no @WebServlet, no web.xml) still surfaces with a placeholder path', () => {
    const SRC = `package org.example.web;
import javax.servlet.http.HttpServlet;
public class BareServlet extends HttpServlet {
  protected void doPost(Object req, Object resp) {}
}`;
    const cands = run([javaIr('web/BareServlet.java', SRC)]);
    expect(servletEndpointNames(cands)).toEqual(['POST /']);
  });
});

describe('TG3 — web.xml servlet-mapping → endpoints', () => {
  it('a <servlet>+<servlet-mapping> in web.xml emits one endpoint per url-pattern for the mapped servlet class', () => {
    // The servlet class is in the scan but has NO @WebServlet annotation — the
    // url-patterns come purely from web.xml.
    const SERVLET = `package org.example.web;
import javax.servlet.http.HttpServlet;
public class ReportServlet extends HttpServlet {
  protected void doGet(Object req, Object resp) {}
}`;
    const WEB_XML = `<?xml version="1.0"?>
<web-app>
  <servlet>
    <servlet-name>report</servlet-name>
    <servlet-class>org.example.web.ReportServlet</servlet-class>
  </servlet>
  <servlet-mapping>
    <servlet-name>report</servlet-name>
    <url-pattern>/reports/*</url-pattern>
  </servlet-mapping>
</web-app>`;
    const cands = run([
      javaIr('web/ReportServlet.java', SERVLET),
      webXmlIr('src/main/webapp/WEB-INF/web.xml', WEB_XML),
    ]);
    // The web.xml-declared /reports/* url-pattern surfaces as a GET endpoint.
    const names = servletEndpointNames(cands);
    expect(names).toContain('GET /reports/*');
    // The bare-servlet placeholder is REPLACED by the web.xml pattern (merged
    // onto the same class), so no '/' placeholder remains.
    expect(names).not.toContain('GET /');
  });

  it('merges web.xml url-patterns with a @WebServlet annotation on the same class (deduped)', () => {
    const SERVLET = `package org.example.web;
import javax.servlet.annotation.WebServlet;
import javax.servlet.http.HttpServlet;
@WebServlet("/anno")
public class MixedServlet extends HttpServlet {
  protected void doGet(Object req, Object resp) {}
}`;
    const WEB_XML = `<web-app>
  <servlet>
    <servlet-name>mixed</servlet-name>
    <servlet-class>org.example.web.MixedServlet</servlet-class>
  </servlet>
  <servlet-mapping>
    <servlet-name>mixed</servlet-name>
    <url-pattern>/xml-mapped</url-pattern>
  </servlet-mapping>
</web-app>`;
    const cands = run([
      javaIr('web/MixedServlet.java', SERVLET),
      webXmlIr('WEB-INF/web.xml', WEB_XML),
    ]);
    const names = servletEndpointNames(cands);
    expect(names).toEqual(['GET /anno', 'GET /xml-mapped']);
  });
});

describe('TG3 — robustness', () => {
  it('no-ops on a non-servlet class and on a malformed web.xml without throwing', () => {
    const PLAIN = `package org.example.web;
public class NotAServlet {
  public void doStuff() {}
}`;
    let cands: DiscoveryCandidate[] = [];
    expect(() => {
      cands = run([
        javaIr('web/NotAServlet.java', PLAIN),
        webXmlIr('WEB-INF/web.xml', '<web-app><servlet><servlet-name>oops'),
      ]);
    }).not.toThrow();
    expect(servletEndpointNames(cands)).toEqual([]);
  });
});
