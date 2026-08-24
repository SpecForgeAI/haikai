/**
 * interface_type on REST surfaces (Kiro 2026-08-24, replicated from the
 * work-machine fix). Only the SOAP emitter ever set `interface_type`, so
 * every JAX-RS resource and @RestController committed with the field null
 * and surfaced as a save-back QUALITY_GAP the operator had to fill in by
 * hand. A JAX-RS resource IS a REST API; @RestController IS a REST API; a
 * plain @Controller is deliberately left unset (it may serve MVC views —
 * guessing would put a wrong value in the model instead of an honest
 * QUALITY_GAP prompt).
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
  return runSpringClassicAdapter(irs, 'itype-run');
}

function interfaceOf(cands: DiscoveryCandidate[], name: string): DiscoveryCandidate {
  const match = cands.find((c) => c.candidateType === 'interfaces' && c.name === name);
  expect(match).toBeDefined();
  return match!;
}

describe('interface_type on REST surfaces (Kiro 2026-08-24)', () => {
  it('a JAX-RS resource carries interface_type REST_API', () => {
    const SRC = `package org.example.api;
import javax.ws.rs.GET;
import javax.ws.rs.Path;
@Path("/users")
public class UserResource {
  @GET
  public String list() { return ""; }
}`;
    const cands = run([{ path: 'api/UserResource.java', src: SRC }]);
    const iface = interfaceOf(cands, 'UserResource');
    expect((iface.data as Record<string, unknown>).interface_type).toBe('REST_API');
  });

  it('a @RestController carries interface_type REST_API', () => {
    const SRC = `package org.example.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;
@RestController
public class OrderApiController {
  @GetMapping("/orders")
  public String list() { return ""; }
}`;
    const cands = run([{ path: 'web/OrderApiController.java', src: SRC }]);
    const iface = interfaceOf(cands, 'OrderApiController');
    expect((iface.data as Record<string, unknown>).interface_type).toBe('REST_API');
  });

  it('a plain @Controller is deliberately left WITHOUT interface_type (honest QUALITY_GAP)', () => {
    const SRC = `package org.example.web;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
@Controller
public class PageController {
  @GetMapping("/home")
  public String home() { return "home"; }
}`;
    const cands = run([{ path: 'web/PageController.java', src: SRC }]);
    const iface = interfaceOf(cands, 'PageController');
    expect((iface.data as Record<string, unknown>).interface_type).toBeUndefined();
  });
});
