/**
 * Spec #4 (Inbound Surface Completeness), Task Group 2 — JAX-RS resource
 * detector.
 *
 * Drives the SAME harness-visible surface the W1 / TG1 tests use:
 *   `extractJavaIR(file, src)` -> `runSpringClassicAdapter([ir], runId)` ->
 *   filter `candidateType === 'endpoints' | 'interfaces'` -> assert on `name`
 *   (`"${verb} ${path}[disc]"`) and `data`.
 *
 * The JAX-RS detector emits the EXACT canonical candidate shape the Spring-MVC
 * path produces (`confidence: 0.9`, `status: 'proposed'`, endpoint `data`
 * carrying `httpMethod`/`fullPath`/`methodName`/`controllerClassName`/
 * `returnType`), with a detector-specific `_addedBy` tag — so save-back
 * resolves them unchanged. ADD/EXTEND only; built on HEAD `f33b44a` + TG1.
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';
import { detectJaxRsResource } from '../services/extensionPacks/frameworkAdapters/springClassic/inboundSurfaceDetectors';
import type { DiscoveryCandidate } from '../types/candidate';

function run(files: Array<{ path: string; src: string }>): DiscoveryCandidate[] {
  const irs = files.map((f) => {
    const ir = extractJavaIR(f.path, f.src);
    expect(ir).toBeTruthy();
    return ir!;
  });
  return runSpringClassicAdapter(irs, 'tg2-run');
}

function endpoints(cands: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return cands.filter((c) => c.candidateType === 'endpoints');
}
function interfaces(cands: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return cands.filter((c) => c.candidateType === 'interfaces');
}
function endpointNames(cands: DiscoveryCandidate[]): string[] {
  return endpoints(cands)
    .map((c) => c.name)
    .sort();
}

describe('TG2 — JAX-RS resource detector', () => {
  it('composes class @Path + method @Path and emits a GET endpoint parented to the resource interface', () => {
    const SRC = `package org.example.api;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
@Path("/users")
public class UserResource {
  @GET
  @Path("/{id}")
  public String get(String id) { return ""; }
}`;
    const cands = run([{ path: 'api/UserResource.java', src: SRC }]);
    // One JAX-RS resource interface + one composed-path GET endpoint.
    const ifaces = interfaces(cands).filter(
      (c) => (c.data as Record<string, unknown>).controllerType === 'JaxRsResource',
    );
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('UserResource');
    expect(ifaces[0].data.basePath).toBe('/users');

    expect(endpointNames(cands)).toEqual(['GET /users/{id}']);
    const ep = endpoints(cands)[0];
    expect(ep.data.httpMethod).toBe('GET');
    expect(ep.data.fullPath).toBe('/users/{id}');
    expect(ep.data.methodName).toBe('get');
    expect(ep.data.controllerClassName).toBe('UserResource');
    // Canonical shape: default confidence + proposed + parented to the resource.
    expect(ep.confidence).toBe(0.9);
    expect(ep.status).toBe('proposed');
    expect(ep.parentCandidateId).toBe(ifaces[0].id);
    expect((ep.data as Record<string, unknown>)._addedBy).toBe('spring-classic-jaxrs');
  });

  it('detects ALL JAX-RS verbs (@GET/@POST/@PUT/@DELETE/@HEAD/@OPTIONS)', () => {
    const SRC = `package org.example.api;
import javax.ws.rs.*;
@Path("/r")
public class AllVerbsResource {
  @GET public String g() { return ""; }
  @POST public String p() { return ""; }
  @PUT public String u() { return ""; }
  @DELETE public String d() { return ""; }
  @HEAD public String h() { return ""; }
  @OPTIONS public String o() { return ""; }
}`;
    const cands = run([{ path: 'api/AllVerbsResource.java', src: SRC }]);
    expect(endpointNames(cands)).toEqual([
      'DELETE /r',
      'GET /r',
      'HEAD /r',
      'OPTIONS /r',
      'POST /r',
      'PUT /r',
    ]);
  });

  it('maps @Produces/@Consumes onto the SAME discriminator fields (anti-collapse) so same path+verb stays distinct', () => {
    const SRC = `package org.example.api;
import javax.ws.rs.*;
@Path("/report")
public class ReportResource {
  @GET
  @Produces("application/json")
  public String json() { return ""; }
  @GET
  @Produces("application/xml")
  public String xml() { return ""; }
}`;
    const cands = run([{ path: 'api/ReportResource.java', src: SRC }]);
    const names = endpointNames(cands);
    expect(names).toEqual([
      'GET /report [produces=application/json]',
      'GET /report [produces=application/xml]',
    ]);
    const jsonEp = endpoints(cands).find((e) => e.name.includes('application/json'))!;
    expect(jsonEp.data.produces).toEqual(['application/json']);
  });

  it('maps @QueryParam/@HeaderParam/@PathParam onto the SAME input fields with @DefaultValue', () => {
    const SRC = `package org.example.api;
import javax.ws.rs.*;
@Path("/search")
public class SearchResource {
  @GET
  public String search(
      @QueryParam("q") @DefaultValue("all") String q,
      @HeaderParam("X-Tenant") String tenant,
      @PathParam("id") String id) {
    return "";
  }
}`;
    const cands = run([{ path: 'api/SearchResource.java', src: SRC }]);
    const ep = endpoints(cands)[0];
    expect(ep.data.requestParams).toEqual([
      { name: 'q', type: 'String', required: false, defaultValue: 'all' },
    ]);
    expect(ep.data.requestHeaders).toEqual([
      { name: 'X-Tenant', type: 'String', required: true },
    ]);
    expect(ep.data.pathParams).toEqual([
      { name: 'id', type: 'String', required: true },
    ]);
  });

  it('resolves BOTH javax.ws.rs.* and jakarta.ws.rs.* (incl. fully-qualified)', () => {
    const JAVAX = `package org.example.api;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
@Path("/javax")
public class JavaxResource {
  @GET public String g() { return ""; }
}`;
    const JAKARTA = `package org.example.api;
@jakarta.ws.rs.Path("/jakarta")
public class JakartaResource {
  @jakarta.ws.rs.GET public String g() { return ""; }
}`;
    const cands = run([
      { path: 'api/JavaxResource.java', src: JAVAX },
      { path: 'api/JakartaResource.java', src: JAKARTA },
    ]);
    expect(endpointNames(cands)).toEqual(['GET /jakarta', 'GET /javax']);
  });

  it('does NOT double-emit a class that is BOTH a Spring @RestController and carries @Path (Spring path wins)', () => {
    const SRC = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import javax.ws.rs.Path;
@RestController
@Path("/dual")
public class DualController {
  @GetMapping("/spring")
  public String spring() { return ""; }
}`;
    const cands = run([{ path: 'api/DualController.java', src: SRC }]);
    // Only the Spring endpoint — the JAX-RS detector no-ops on a Spring
    // controller. NOTE: @Path is NOT a Spring base path (Spring uses
    // @RequestMapping), so the Spring composed path is just /spring.
    expect(endpointNames(cands)).toEqual(['GET /spring']);
    // And no JAX-RS-tagged candidates leaked.
    expect(
      cands.some((c) => (c.data as Record<string, unknown>)._addedBy === 'spring-classic-jaxrs'),
    ).toBe(false);
  });

  it('no-ops on a non-JAX-RS class and soft-fails on a malformed IR without throwing', () => {
    const PLAIN = `package org.example.api;
public class PlainPojo {
  public String hello() { return ""; }
}`;
    let cands: DiscoveryCandidate[] = [];
    expect(() => {
      cands = run([{ path: 'api/PlainPojo.java', src: PLAIN }]);
    }).not.toThrow();
    expect(
      cands.some((c) => (c.data as Record<string, unknown>)._addedBy === 'spring-classic-jaxrs'),
    ).toBe(false);

    // Malformed IR: a class with a null methods array fed STRAIGHT to the
    // detector must not throw (the detector soft-fails per-class). Built as
    // `any` so the deliberately-broken shape compiles.
    const brokenCls: any = {
      name: 'Broken',
      annotations: [{ name: 'Path', args: { value: '/b' }, line: 1 }],
      extends: null,
      implements: [],
      isInterface: false,
      isAbstract: false,
      modifiers: ['public'],
      fields: [],
      methods: null, // <-- deliberately malformed
      line: 1,
    };
    const brokenFile: any = {
      filePath: 'api/Broken.java',
      language: 'java',
      packageOrNamespace: 'org.example.api',
      imports: [],
      classes: [brokenCls],
      functions: [],
    };
    let detectorOut: DiscoveryCandidate[] = [];
    expect(() => {
      detectorOut = detectJaxRsResource(brokenCls, brokenFile, 'tg2-malformed', false);
    }).not.toThrow();
    // Soft-fail returns no candidates rather than crashing.
    expect(detectorOut).toEqual([]);
  });

  it('emits a WELL-FORMED {param} fullPath for a method @Path whose value begins AND ends with a path param (malformed-brace source fix)', () => {
    // HAIKAI repro: a JAX-RS method whose @Path is a multi-param template with
    // NO leading slash -- `{businessDate}/{orgUnitId}`. The path starts with `{`
    // and ends with `}`, which the old array-literal unwrapper mistook for a
    // `{"...","..."}` array and stripped, yielding the malformed
    // `/hierarchy/businessDate}/{orgUnitId` (opening brace lost). That gave the
    // same logical endpoint a different canonical path than the WADL packs
    // well-formed twin, defeating the Spec-0 identity-keyed merge.
    const SRC = `package org.example.api;
import javax.ws.rs.POST;
import javax.ws.rs.Path;
@Path("/hierarchy")
public class HierarchyLookupService {
  @POST
  @Path("{businessDate}/{orgUnitId}")
  public String lookup(String businessDate, String orgUnitId) { return ""; }
}`;
    const cands = run([{ path: 'api/HierarchyLookupService.java', src: SRC }]);
    const ep = endpoints(cands)[0];
    expect(ep.data.fullPath).toBe('/hierarchy/{businessDate}/{orgUnitId}');
    expect(ep.name).toBe('POST /hierarchy/{businessDate}/{orgUnitId}');
    // No mangled form leaked: the malformed twin would carry the segment
    // `/businessDate}` (slash immediately before the param name, no opening `{`),
    // which the well-formed `/{businessDate}` never contains.
    expect(
      endpoints(cands).some((c) =>
        String((c.data as Record<string, unknown>).fullPath).includes('/businessDate}'),
      ),
    ).toBe(false);
  });

  it('emits a balanced {param} for a single bare-param method @Path (brace-less source fix)', () => {
    // The brace-LESS twin source: a single `{orgUnitId}` param with no slash. The
    // old unwrapper stripped BOTH braces, leaving `/orgUnitId` (a literal that
    // looks like a static segment). The fix keeps it as a balanced `{orgUnitId}`.
    const SRC = `package org.example.api;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
@Path("/hierarchynodes")
public class HierarchyNodesService {
  @GET
  @Path("{orgUnitId}")
  public String node(String orgUnitId) { return ""; }
}`;
    const cands = run([{ path: 'api/HierarchyNodesService.java', src: SRC }]);
    const ep = endpoints(cands)[0];
    expect(ep.data.fullPath).toBe('/hierarchynodes/{orgUnitId}');
  });

  it('still unwraps a genuine Spring-style @GetMapping array literal to its first member (regression guard)', () => {
    // A real array literal `{"/a","/b"}` (quoted members) must STILL unwrap --
    // the fix only narrows the unwrap to quote-led inner content. (Spring
    // controllers fan the array out to multiple endpoints; this guards the
    // per-member normalize path the unwrapper sits on.)
    const SRC = `package org.example.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
@RestController
public class AliasController {
  @GetMapping({"/a","/b"})
  public String handle() { return ""; }
}`;
    const cands = run([{ path: 'web/AliasController.java', src: SRC }]);
    expect(endpointNames(cands)).toEqual(['GET /a', 'GET /b']);
  });
});
