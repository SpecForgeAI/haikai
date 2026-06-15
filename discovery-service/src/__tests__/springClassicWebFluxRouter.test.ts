/**
 * Spec #4 (Inbound Surface Completeness), Task Group 4 — WebFlux functional
 * `RouterFunction` route detector.
 *
 * The functional routing DSL is a CALL chain the Java IR does not model, so —
 * like the existing outbound `RestTemplate` / `WebClient` path — the detector
 * parses it from `file.rawContent`. Drives the harness-visible surface:
 * `extractJavaIR` -> `runSpringClassicAdapter` -> filter `endpoints` /
 * `interfaces`.
 *
 * Functional routes emit the canonical candidate shape (`confidence: 0.9`,
 * `status: 'proposed'`, endpoint `data` carrying `httpMethod`/`fullPath`/
 * `methodName`/`controllerClassName`/`returnType`) with `_addedBy:
 * 'spring-classic-webflux-fn'`. ADD/EXTEND only; built on HEAD `f33b44a` + TG1.
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';
import { detectWebFluxRouterFunctions } from '../services/extensionPacks/frameworkAdapters/springClassic/inboundSurfaceDetectors';
import type { DiscoveryCandidate } from '../types/candidate';

function run(files: Array<{ path: string; src: string }>): DiscoveryCandidate[] {
  const irs = files.map((f) => {
    const ir = extractJavaIR(f.path, f.src);
    expect(ir).toBeTruthy();
    return ir!;
  });
  return runSpringClassicAdapter(irs, 'tg4-run');
}

function endpoints(cands: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return cands.filter((c) => c.candidateType === 'endpoints');
}
function routerEndpointNames(cands: DiscoveryCandidate[]): string[] {
  return endpoints(cands)
    .filter((c) => (c.data as Record<string, unknown>)._addedBy === 'spring-classic-webflux-fn')
    .map((c) => c.name)
    .sort();
}
function routerInterfaces(cands: DiscoveryCandidate[]): DiscoveryCandidate[] {
  return cands.filter(
    (c) =>
      c.candidateType === 'interfaces' &&
      (c.data as Record<string, unknown>)._addedBy === 'spring-classic-webflux-fn',
  );
}

describe('TG4 — WebFlux RouterFunction detector', () => {
  it('route().GET("/x", h).POST("/y", h) (builder chain) emits a GET /x and a POST /y endpoint', () => {
    const SRC = `package org.example.web;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;
@Configuration
public class RouterConfig {
  @Bean
  public RouterFunction<ServerResponse> routes(MyHandler handler) {
    return route()
      .GET("/x", handler::list)
      .POST("/y", handler::create)
      .build();
  }
}`;
    const cands = run([{ path: 'web/RouterConfig.java', src: SRC }]);
    expect(routerEndpointNames(cands)).toEqual(['GET /x', 'POST /y']);

    const ifaces = routerInterfaces(cands);
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].data.controllerType).toBe('WebFluxFunctional');

    const getX = endpoints(cands).find((e) => e.name === 'GET /x')!;
    expect(getX.data.httpMethod).toBe('GET');
    expect(getX.data.fullPath).toBe('/x');
    expect(getX.data.controllerClassName).toBe('RouterConfig');
    expect(getX.confidence).toBe(0.9);
    expect(getX.status).toBe('proposed');
    expect(getX.parentCandidateId).toBe(ifaces[0].id);
  });

  it('route(GET("/items/{id}"), h).andRoute(POST("/items"), h) (predicate-arg form) maps each predicate verb', () => {
    const SRC = `package org.example.web;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;
import static org.springframework.web.reactive.function.server.RequestPredicates.GET;
import static org.springframework.web.reactive.function.server.RequestPredicates.POST;
@Configuration
public class ItemRouter {
  @Bean
  public RouterFunction<ServerResponse> itemRoutes(ItemHandler h) {
    return route(GET("/items/{id}"), h::getItem)
      .andRoute(POST("/items"), h::addItem);
  }
}`;
    const cands = run([{ path: 'web/ItemRouter.java', src: SRC }]);
    expect(routerEndpointNames(cands)).toEqual(['GET /items/{id}', 'POST /items']);
  });

  it('fully-qualified RequestPredicates.PUT("/p") predicate maps to PUT', () => {
    const SRC = `package org.example.web;
import org.springframework.context.annotation.Bean;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;
import org.springframework.web.reactive.function.server.RequestPredicates;
import org.springframework.web.reactive.function.server.RouterFunctions;
public class FqnRouter {
  @Bean
  public RouterFunction<ServerResponse> r(H h) {
    return RouterFunctions.route(RequestPredicates.PUT("/p"), h::put);
  }
}`;
    const cands = run([{ path: 'web/FqnRouter.java', src: SRC }]);
    expect(routerEndpointNames(cands)).toEqual(['PUT /p']);
  });

  it('dedupes a route DSL that mentions the same (verb, path) twice', () => {
    const SRC = `package org.example.web;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;
public class DupRouter {
  @Bean
  public RouterFunction<ServerResponse> r(H h) {
    return route().GET("/dup", h::a).GET("/dup", h::b).build();
  }
}`;
    const cands = run([{ path: 'web/DupRouter.java', src: SRC }]);
    expect(routerEndpointNames(cands)).toEqual(['GET /dup']);
  });

  it('no-ops on a plain Spring MVC controller (no functional routing DSL) without firing', () => {
    // A pure Spring MVC controller: no RouterFunction return type anywhere in
    // the file, so the functional-route detector must NOT fire.
    const PLAIN = `package org.example.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
@RestController
public class MvcController {
  @GetMapping("/mvc")
  public String mvc() { return "hello"; }
}`;
    const cands = run([{ path: 'web/MvcController.java', src: PLAIN }]);
    // The WebFlux detector did not fire (no functional routing DSL in the file).
    expect(routerEndpointNames(cands)).toEqual([]);
    // The Spring MVC endpoint is still emitted by the controller path.
    expect(endpoints(cands).some((e) => e.name === 'GET /mvc')).toBe(true);
  });

  it('soft-fails on malformed input (a file with no rawContent) without throwing', () => {
    // A SourceFileIR with no rawContent must not crash the detector.
    const noRaw: any = {
      filePath: 'web/NoRaw.java',
      language: 'java',
      packageOrNamespace: 'org.example.web',
      imports: [],
      classes: [],
      functions: [],
    };
    let out: DiscoveryCandidate[] = [];
    expect(() => {
      out = detectWebFluxRouterFunctions(noRaw, 'tg4-malformed');
    }).not.toThrow();
    expect(out).toEqual([]);
  });
});
