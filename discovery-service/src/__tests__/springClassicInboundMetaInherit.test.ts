/**
 * Spec #4 (Inbound Surface Completeness), Task Group 1 -- Surface 1.
 *
 * Generalised mapping matcher (meta-annotated + fully-qualified mapping
 * annotations), inherited / abstract base-controller mappings, and endpoint
 * discriminators (`consumes`/`produces`/`headers`/`params`) folded into the
 * endpoint identity + `@RequestParam`/`@RequestHeader` input capture.
 *
 * Drives the SAME harness-visible surface the W1 + smoke tests use:
 *   `extractJavaIR(file, src)` -> `runSpringClassicAdapter([ir], runId)` ->
 *   filter `candidateType === 'endpoints' | 'interfaces'` -> assert on
 *   `name` (`"${verb} ${path}[disc]"`) and `data`.
 *
 * Built on HEAD `f33b44a`. ADD/EXTEND only -- reuses the existing
 * `makeCandidate` emission shape (`confidence: 0.9`,
 * `_addedBy: 'spring-classic-adapter'`); no save-back / AMS change.
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';
import type { DiscoveryCandidate } from '../types/candidate';

function run(files: Array<{ path: string; src: string }>): DiscoveryCandidate[] {
  const irs = files.map((f) => {
    const ir = extractJavaIR(f.path, f.src);
    expect(ir).toBeTruthy();
    return ir!;
  });
  return runSpringClassicAdapter(irs, 'tg1-run');
}

function endpoints(cands: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return cands.filter((c) => c.candidateType === 'endpoints');
}

function endpointNames(cands: DiscoveryCandidate[]): string[] {
  return endpoints(cands)
    .map((c) => c.name)
    .sort();
}

describe('TG1 -- meta-annotation / FQN mapping resolution', () => {
  it('resolves a handler annotated only with a custom @GetMapping-meta-annotated annotation to ONE GET endpoint', () => {
    const ANN = `package org.example.api;
import org.springframework.web.bind.annotation.GetMapping;
import java.lang.annotation.*;
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@GetMapping
public @interface ApiV2Get {
  String value() default "";
}`;
    const CTRL = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
@RestController
public class V2Controller {
  @ApiV2Get("/widgets")
  public String widgets() { return ""; }
}`;
    const cands = run([
      { path: 'api/ApiV2Get.java', src: ANN },
      { path: 'api/V2Controller.java', src: CTRL },
    ]);
    // Exactly one endpoint, GET, carrying the OUTER annotation's path arg.
    expect(endpointNames(cands)).toEqual(['GET /widgets']);
    const ep = endpoints(cands)[0];
    expect(ep.data.httpMethod).toBe('GET');
    expect(ep.data.fullPath).toBe('/widgets');
    // Candidate shape unchanged: default confidence + adapter stamp preserved.
    expect(ep.confidence).toBe(0.9);
    expect(ep.status).toBe('proposed');
    expect((ep.data as Record<string, unknown>)._addedBy).toBe('spring-classic-adapter');
  });

  it('falls back to the meta-annotation path arg when the outer annotation declares none', () => {
    const ANN = `package org.example.api;
import org.springframework.web.bind.annotation.GetMapping;
public @interface HealthGet {}`;
    // The @interface itself carries @GetMapping("/health").
    const ANN2 = ANN.replace('public @interface HealthGet {}', '@GetMapping("/health")\npublic @interface HealthGet {}');
    const CTRL = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
@RestController
public class HealthController {
  @HealthGet
  public String health() { return ""; }
}`;
    const cands = run([
      { path: 'api/HealthGet.java', src: ANN2 },
      { path: 'api/HealthController.java', src: CTRL },
    ]);
    expect(endpointNames(cands)).toEqual(['GET /health']);
  });

  it('resolves a fully-qualified @org...GetMapping on the final simple-name segment to ONE GET endpoint', () => {
    const CTRL = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
@RestController
public class FqnController {
  @org.springframework.web.bind.annotation.GetMapping("/fqn")
  public String fqn() { return ""; }
}`;
    const cands = run([{ path: 'api/FqnController.java', src: CTRL }]);
    expect(endpointNames(cands)).toEqual(['GET /fqn']);
    expect(endpoints(cands)[0].data.httpMethod).toBe('GET');
  });

  it('terminates on a meta-annotation cycle without throwing (and emits nothing for the cycle)', () => {
    // @A meta-annotated with @B, @B meta-annotated with @A -- neither resolves
    // to a known mapping. Must terminate (bounded + cycle-guarded).
    const A = `package org.example.api;
@B
public @interface A {}`;
    const B = `package org.example.api;
@A
public @interface B {}`;
    const CTRL = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
@RestController
public class CycleController {
  @A
  public String handler() { return ""; }
}`;
    let cands: DiscoveryCandidate[] = [];
    expect(() => {
      cands = run([
        { path: 'api/A.java', src: A },
        { path: 'api/B.java', src: B },
        { path: 'api/CycleController.java', src: CTRL },
      ]);
    }).not.toThrow();
    // No mapping resolves -> the (non-mapping) handler emits no endpoint.
    expect(endpointNames(cands)).toEqual([]);
  });
});

describe('TG1 -- inherited / abstract base-controller mappings', () => {
  it('composes the full path from an abstract base @RequestMapping + an inherited (non-overridden) handler', () => {
    const BASE = `package org.example.api;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
@RequestMapping("/api")
public abstract class AbstractBaseController {
  @GetMapping("/ping")
  public String ping() { return ""; }
}`;
    const CONCRETE = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
@RestController
public class ConcreteController extends AbstractBaseController {
  @GetMapping("/own")
  public String own() { return ""; }
}`;
    const cands = run([
      { path: 'api/AbstractBaseController.java', src: BASE },
      { path: 'api/ConcreteController.java', src: CONCRETE },
    ]);
    // /own composed against the inherited base path, plus the inherited /ping.
    expect(endpointNames(cands)).toEqual(['GET /api/own', 'GET /api/ping']);
    const ping = endpoints(cands).find((e) => e.name === 'GET /api/ping')!;
    // The inherited handler is parented to the concrete controller + tagged.
    expect(ping.data.controllerClassName).toBe('ConcreteController');
    expect(ping.data.inheritedFrom).toBe('AbstractBaseController');
  });

  it('uses the most-derived class-level base path over the inherited one', () => {
    const BASE = `package org.example.api;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
@RequestMapping("/base")
public abstract class BasePathController {
  @GetMapping("/ping")
  public String ping() { return ""; }
}`;
    const CONCRETE = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
@RestController
@RequestMapping("/derived")
public class DerivedController extends BasePathController {
}`;
    const cands = run([
      { path: 'api/BasePathController.java', src: BASE },
      { path: 'api/DerivedController.java', src: CONCRETE },
    ]);
    // Inherited /ping handler composes against the DERIVED base path.
    expect(endpointNames(cands)).toEqual(['GET /derived/ping']);
  });

  it('terminates on an extends cycle without throwing (cycle-guarded walk)', () => {
    // A extends B, B extends A -- a degenerate inheritance cycle. The
    // `cls.extends` walk must terminate (visited cycle-guard), not loop.
    const A = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
@RestController
public class CyclicA extends CyclicB {
  @GetMapping("/a")
  public String a() { return ""; }
}`;
    const B = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
@RestController
public class CyclicB extends CyclicA {
  @GetMapping("/b")
  public String b() { return ""; }
}`;
    let cands: DiscoveryCandidate[] = [];
    expect(() => {
      cands = run([
        { path: 'api/CyclicA.java', src: A },
        { path: 'api/CyclicB.java', src: B },
      ]);
    }).not.toThrow();
    // Both controllers still emit their own handler; the walk does not hang
    // or double-emit the cyclic partner's handler back onto itself.
    const names = endpointNames(cands);
    expect(names).toContain('GET /a');
    expect(names).toContain('GET /b');
  });
});

describe('TG1 -- endpoint discriminators (anti-collapse) + request-shaping inputs', () => {
  it('keeps two same-path+verb handlers differing only by produces as TWO DISTINCT endpoints', () => {
    const CTRL = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
@RestController
public class NegotiationController {
  @GetMapping(value = "/report", produces = "application/json")
  public String json() { return ""; }
  @GetMapping(value = "/report", produces = "application/xml")
  public String xml() { return ""; }
}`;
    const cands = run([{ path: 'api/NegotiationController.java', src: CTRL }]);
    const names = endpointNames(cands);
    expect(names.length).toBe(2);
    // Both share verb + path but stay DISTINCT via the folded produces.
    expect(names).toEqual([
      'GET /report [produces=application/json]',
      'GET /report [produces=application/xml]',
    ]);
    const jsonEp = endpoints(cands).find((e) => e.name.includes('application/json'))!;
    expect(jsonEp.data.produces).toEqual(['application/json']);
    expect(jsonEp.data.fullPath).toBe('/report');
    expect(jsonEp.data.httpMethod).toBe('GET');
  });

  it('keeps two same-path+verb handlers differing only by params as TWO DISTINCT endpoints', () => {
    const CTRL = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
@RestController
public class ParamRoutedController {
  @RequestMapping(value = "/edit", method = RequestMethod.GET, params = "action=save")
  public String save() { return ""; }
  @RequestMapping(value = "/edit", method = RequestMethod.GET, params = "action=cancel")
  public String cancel() { return ""; }
}`;
    const cands = run([{ path: 'api/ParamRoutedController.java', src: CTRL }]);
    const names = endpointNames(cands);
    expect(names.length).toBe(2);
    expect(names).toEqual([
      'GET /edit [params=action=cancel]',
      'GET /edit [params=action=save]',
    ]);
  });

  it('captures @RequestParam / @RequestHeader inputs onto the endpoint data', () => {
    const CTRL = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestHeader;
@RestController
public class SearchController {
  @GetMapping("/search")
  public String search(
      @RequestParam(name = "q", required = false, defaultValue = "all") String q,
      @RequestHeader(name = "X-Tenant") String tenant) {
    return "";
  }
}`;
    const cands = run([{ path: 'api/SearchController.java', src: CTRL }]);
    expect(endpointNames(cands)).toEqual(['GET /search']);
    const ep = endpoints(cands)[0];
    expect(ep.data.requestParams).toEqual([
      { name: 'q', type: 'String', required: false, defaultValue: 'all' },
    ]);
    expect(ep.data.requestHeaders).toEqual([
      { name: 'X-Tenant', type: 'String', required: true },
    ]);
  });
});

describe('TG1 -- regression guard', () => {
  it('a plain single @GetMapping("/x") still emits EXACTLY one endpoint with the unchanged name', () => {
    const CTRL = `package org.example.api;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
@RestController
public class PlainController {
  @GetMapping("/x")
  public String handle() { return ""; }
}`;
    const cands = run([{ path: 'api/PlainController.java', src: CTRL }]);
    // No discriminators -> exact `${verb} ${path}` name (no suffix).
    expect(endpointNames(cands)).toEqual(['GET /x']);
    const ep = endpoints(cands)[0];
    // No discriminator / input fields leak onto the common-case data shape.
    expect(ep.data.produces).toBeUndefined();
    expect(ep.data.params).toBeUndefined();
    expect(ep.data.requestParams).toBeUndefined();
    expect(ep.data.requestHeaders).toBeUndefined();
    expect(ep.data.inheritedFrom).toBeUndefined();
  });
});
