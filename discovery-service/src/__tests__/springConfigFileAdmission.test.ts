/**
 * END-TO-END admission test for the rank-1 global-date-format rung
 * (`spring.jackson.date-format` in application.properties / .yml).
 *
 * Spec: 2026-06-22 Spring Classic code-evidence format extraction --
 * global-date-format ladder, rank-1 follow-up wiring.
 *
 * The existing `globalDateFormatScanner.test.ts` proves rank-1 resolves from a
 * HAND-BUILT config IR fed straight to `resolveGlobalDateFormat` /
 * `runSpringClassicAdapter`. That left a wiring gap: in production the config
 * files never reached the IR `files` array (only `.java` / spring-bean `.xml` /
 * WADL/XSD / web.xml were admitted by `javaLangPack.extract`), so the rank-1
 * rung was INERT end-to-end.
 *
 * These tests run the REAL ingestion path -- `javaLangPack.extract` over a
 * `Map<filePath, content>` that contains an `application.properties` (and a
 * `.yml` variant) alongside a controller `.java` -- and then the REAL
 * `springClassicFrameworkPack.adapt`, asserting the config file is actually
 * ADMITTED (carrying `rawContent`) and that `inferred_date_format` resolves at
 * rank-1 with the `spring.jackson.date-format` source. This is the seam the
 * synthetic-IR test cannot cover.
 */

import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack/index';
import { springClassicFrameworkPack } from '../services/extensionPacks/frameworkPacks/springClassicFrameworkPack/index';
import type { TechHints } from '../services/extensionPacks';
import type { DiscoveryCandidate } from '../types/candidate';

const classicSpringHints: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring' },
};

const CONTROLLER_SRC = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;

@RestController
@RequestMapping("/g")
public class GController {
  @GetMapping("/at")
  public String at(@RequestParam java.time.LocalDate businessDate) {
    return "ok";
  }
}
`;

const APPLICATION_PROPERTIES = `spring.application.name=demo
spring.jackson.date-format=dd-MMM-yyyy
server.port=8080
`;

const APPLICATION_YML = `spring:
  jackson:
    date-format: dd-MMM-yyyy
`;

function endpointContract(candidates: DiscoveryCandidate[]): Record<string, unknown> {
  const endpoint = candidates.find(
    (c) => c.candidateType === 'endpoints' && c.name === 'GET /g/at',
  );
  expect(endpoint).toBeDefined();
  const contract = (endpoint!.data as Record<string, unknown>)
    .request_contract as Record<string, unknown>;
  expect(contract).toBeDefined();
  return contract;
}

describe('Spring config-file admission -> rank-1 global date-format (end-to-end)', () => {
  it('ADMITS application.properties to the IR (rawContent populated, not Java-parsed)', () => {
    const sourceFiles = new Map<string, string>([
      ['src/main/java/com/foo/web/GController.java', CONTROLLER_SRC],
      ['src/main/resources/application.properties', APPLICATION_PROPERTIES],
    ]);

    const irFiles = javaLangPack.extract(sourceFiles, classicSpringHints);

    // The config file reached the IR map...
    const cfg = irFiles.get('src/main/resources/application.properties');
    expect(cfg).toBeDefined();
    // ...carrying its verbatim rawContent so the resolver can read it...
    expect(cfg!.rawContent).toContain('spring.jackson.date-format=dd-MMM-yyyy');
    // ...with EMPTY structural fields (NOT fed to the Java AST parser).
    expect(cfg!.language).toBe('spring-config');
    expect(cfg!.classes).toEqual([]);
    expect(cfg!.functions).toEqual([]);
  });

  it('resolves inferred_date_format at RANK 1 from application.properties via the real adapter', () => {
    const sourceFiles = new Map<string, string>([
      ['src/main/java/com/foo/web/GController.java', CONTROLLER_SRC],
      ['src/main/resources/application.properties', APPLICATION_PROPERTIES],
    ]);

    const irFiles = javaLangPack.extract(sourceFiles, classicSpringHints);
    const candidates = springClassicFrameworkPack.adapt(
      irFiles,
      'cfg-admit-run',
      classicSpringHints,
    );

    const contract = endpointContract(candidates);
    const idf = contract.inferred_date_format as {
      format: string;
      source: string;
      confidence: number;
    };
    expect(idf).toBeDefined();
    expect(idf.format).toBe('dd-MMM-yyyy');
    // Rank-1 source label proves the config-file rung (not a .java rung) won.
    expect(idf.source).toContain('spring.jackson.date-format');
    expect(typeof idf.confidence).toBe('number');
  });

  it('resolves inferred_date_format at RANK 1 from application.yml too', () => {
    const sourceFiles = new Map<string, string>([
      ['src/main/java/com/foo/web/GController.java', CONTROLLER_SRC],
      ['src/main/resources/application.yml', APPLICATION_YML],
    ]);

    const irFiles = javaLangPack.extract(sourceFiles, classicSpringHints);
    const candidates = springClassicFrameworkPack.adapt(
      irFiles,
      'cfg-admit-yml-run',
      classicSpringHints,
    );

    const contract = endpointContract(candidates);
    const idf = contract.inferred_date_format as { format: string; source: string };
    expect(idf).toBeDefined();
    expect(idf.format).toBe('dd-MMM-yyyy');
    expect(idf.source).toContain('spring.jackson.date-format');
  });

  it('config-file admission does NOT mint spurious candidates or break Java scanning', () => {
    const sourceFiles = new Map<string, string>([
      ['src/main/java/com/foo/web/GController.java', CONTROLLER_SRC],
      ['src/main/resources/application.properties', APPLICATION_PROPERTIES],
    ]);
    const irFiles = javaLangPack.extract(sourceFiles, classicSpringHints);
    const candidates = springClassicFrameworkPack.adapt(
      irFiles,
      'cfg-admit-safety-run',
      classicSpringHints,
    );
    // The controller still produces its interface + endpoint candidates...
    expect(candidates.some((c) => c.candidateType === 'endpoints' && c.name === 'GET /g/at')).toBe(true);
    expect(candidates.some((c) => c.candidateType === 'interfaces' && c.name === 'GController')).toBe(true);
    // ...and NO candidate is sourced from the config file (it has no classes).
    const fromConfig = candidates.filter((c) =>
      Array.isArray(c.sourceClusterIds) &&
      c.sourceClusterIds.includes('src/main/resources/application.properties'),
    );
    expect(fromConfig).toEqual([]);
  });
});
