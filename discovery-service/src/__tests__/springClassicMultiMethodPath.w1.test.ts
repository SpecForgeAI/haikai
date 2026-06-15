/**
 * W1 -- Multi-method / multi-path Spring mapping parsing fix.
 *
 * Quick-win audit fix (2026-05-30), NOT a spec. Targets two long-standing
 * bugs in the spring-classic framework adapter's endpoint-emission path:
 *
 *  BUG 1: `@RequestMapping(method = {RequestMethod.GET, RequestMethod.POST})`
 *         collapsed to ONE endpoint with a garbled verb. Root cause:
 *         `AnnotationIR.args.method` stores the whole brace-list as one
 *         string (`"{RequestMethod.GET, RequestMethod.POST}"`) and the old
 *         `extractHttpMethod` did `m.split('.'); parts[last].toUpperCase()`
 *         -> `"GET, REQUESTMETHOD.POST}"`.
 *
 *  BUG 2: `@GetMapping({"/a","/b"})` kept only the FIRST path -- the second
 *         alias was discarded by `stripArrayBracesAndQuotes`.
 *
 * FIX: parse the stored method / path arg strings as possible brace-lists and
 * emit ONE endpoint candidate per (HTTP-method x path) combination, while a
 * single-method / single-path mapping still produces exactly one endpoint.
 *
 * These tests drive the SAME harness-visible surface the smoke tests use:
 * `runSpringClassicAdapter(files, runId)` -> filter `candidateType ===
 * 'endpoints'` -> assert on the `name` (`"${httpMethod} ${fullPath}"`).
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';

function endpointNames(src: string, file = 'web/W1Controller.java'): string[] {
  const ir = extractJavaIR(file, src)!;
  expect(ir).toBeDefined();
  const candidates = runSpringClassicAdapter([ir], 'w1-run');
  return candidates
    .filter((c) => c.candidateType === 'endpoints')
    .map((c) => c.name)
    .sort();
}

describe('W1 -- spring-classic multi-method / multi-path endpoint emission', () => {
  it('BUG 1: @RequestMapping(method = {GET, POST}) -> two endpoints, verbs GET and POST', () => {
    const SRC = `
package org.example.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

@RestController
public class MultiMethodController {
  @RequestMapping(value = "/items", method = {RequestMethod.GET, RequestMethod.POST})
  public String handle() { return ""; }
}
`;
    const names = endpointNames(SRC);
    // Exactly two endpoints, one per declared verb -- NO garbled verb.
    expect(names).toEqual(['GET /items', 'POST /items']);
    expect(names.some((n) => n.includes('REQUESTMETHOD') || n.includes(','))).toBe(
      false,
    );
  });

  it('BUG 2: @GetMapping({"/a","/b"}) -> two endpoints, one per path alias', () => {
    const SRC = `
package org.example.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;

@RestController
public class MultiPathController {
  @GetMapping({"/a","/b"})
  public String handle() { return ""; }
}
`;
    const names = endpointNames(SRC);
    expect(names).toEqual(['GET /a', 'GET /b']);
  });

  it('REGRESSION GUARD: a plain @GetMapping("/x") still emits exactly one endpoint', () => {
    const SRC = `
package org.example.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.GetMapping;

@RestController
public class SinglePathController {
  @GetMapping("/x")
  public String handle() { return ""; }
}
`;
    const names = endpointNames(SRC);
    expect(names).toEqual(['GET /x']);
  });

  it('COMBINATION: multi-verb x multi-path produces the full (verb x path) matrix under a base path', () => {
    // @RequestMapping(method = {GET, PUT}) + value = {"/a","/b"} under a
    // class-level @RequestMapping("/base") -> 2 verbs x 2 paths = 4 endpoints,
    // each composed against the base path. Exercises both fixes together and
    // the cartesian fan-out.
    const SRC = `
package org.example.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;

@RestController
@RequestMapping("/base")
public class MatrixController {
  @RequestMapping(value = {"/a","/b"}, method = {RequestMethod.GET, RequestMethod.PUT})
  public String handle() { return ""; }
}
`;
    const names = endpointNames(SRC);
    expect(names).toEqual([
      'GET /base/a',
      'GET /base/b',
      'PUT /base/a',
      'PUT /base/b',
    ]);
  });
});
