/**
 * Tests for the Signal-#2 project-wide global date-format resolver
 * (`extensionPacks/frameworkAdapters/springClassic/globalDateFormatScanner.ts`).
 *
 * Spec: 2026-06-22 Spring Classic code-evidence format extraction -- Task Group 2.
 *
 * The resolver returns ONE project-wide `{ format, source, confidence } | null`
 * via the precedence ladder:
 *   (1) `spring.jackson.date-format` (application.properties / yml)
 *   (2) `ObjectMapper.setDateFormat("...")` / `Jackson2ObjectMapperBuilder` in @Configuration
 *   (3) `@InitBinder` + `CustomDateEditor` / `registerCustomEditor(Date.class, new SimpleDateFormat("..."))`
 *   (4) bare `new SimpleDateFormat("...")` / `DateTimeFormatter.ofPattern("...")` literal
 *
 * Higher rank wins; a same-rank disagreement takes the FIRST in stable file
 * order at LOWER confidence. Covers each ladder source in isolation, precedence,
 * and the same-rank tiebreak, plus the headline `dd-MMM-yyyy` value.
 */

import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import { resolveGlobalDateFormat } from '../services/extensionPacks/frameworkAdapters/springClassic/globalDateFormatScanner';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';
import type { DiscoveryCandidate } from '../types/candidate';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function javaIr(path: string, src: string): SourceFileIR {
  const parsed = extractJavaIR(path, src);
  if (!parsed) throw new Error(`parse fail for ${path}`);
  return parsed;
}

// A plain config-file IR entry (the java pack admits these with rawContent).
function configIr(path: string, content: string): SourceFileIR {
  return {
    filePath: path,
    language: 'properties',
    packageOrNamespace: null,
    imports: [],
    classes: [],
    functions: [],
    rawContent: content,
  };
}

const PROPERTIES_DATE_FORMAT = `
spring.application.name=demo
spring.jackson.date-format=dd-MMM-yyyy
server.port=8080
`;

const YML_DATE_FORMAT = `
spring:
  jackson:
    date-format: dd-MMM-yyyy
`;

const CONFIG_SET_DATE_FORMAT = `
package com.foo.config;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.text.SimpleDateFormat;

@Configuration
public class JacksonConfig {
  @Bean
  public ObjectMapper objectMapper() {
    ObjectMapper mapper = new ObjectMapper();
    mapper.setDateFormat(new SimpleDateFormat("yyyy/MM/dd"));
    return mapper;
  }
}
`;

const INIT_BINDER_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.WebDataBinder;
import org.springframework.web.bind.annotation.InitBinder;
import org.springframework.beans.propertyeditors.CustomDateEditor;
import java.text.SimpleDateFormat;
import java.util.Date;

public class SomeController {
  @InitBinder
  public void initBinder(WebDataBinder binder) {
    binder.registerCustomEditor(Date.class, new CustomDateEditor(new SimpleDateFormat("MM-dd-yyyy"), true));
  }
}
`;

const BARE_SIMPLE_DATE_FORMAT = `
package com.foo.util;
import java.text.SimpleDateFormat;

public class DateUtil {
  public String fmt(java.util.Date d) {
    return new SimpleDateFormat("dd.MM.yyyy").format(d);
  }
}
`;

const BARE_OF_PATTERN = `
package com.foo.util;
import java.time.format.DateTimeFormatter;

public class DateUtil2 {
  static final DateTimeFormatter F = DateTimeFormatter.ofPattern("yyyy-MM-dd");
}
`;

// ---------------------------------------------------------------------------
// (1) Each ladder source resolves in isolation.
// ---------------------------------------------------------------------------

describe('resolveGlobalDateFormat -- each ladder source in isolation', () => {
  it('(1) reads spring.jackson.date-format from application.properties', () => {
    const r = resolveGlobalDateFormat([configIr('application.properties', PROPERTIES_DATE_FORMAT)]);
    expect(r).not.toBeNull();
    expect(r!.format).toBe('dd-MMM-yyyy');
    expect(r!.source).toContain('spring.jackson.date-format');
  });

  it('(1) reads spring.jackson.date-format from application.yml', () => {
    const r = resolveGlobalDateFormat([configIr('application.yml', YML_DATE_FORMAT)]);
    expect(r).not.toBeNull();
    expect(r!.format).toBe('dd-MMM-yyyy');
  });

  it('(2) reads ObjectMapper.setDateFormat(new SimpleDateFormat("...")) in a @Configuration', () => {
    const r = resolveGlobalDateFormat([javaIr('JacksonConfig.java', CONFIG_SET_DATE_FORMAT)]);
    expect(r).not.toBeNull();
    expect(r!.format).toBe('yyyy/MM/dd');
    expect(r!.source.toLowerCase()).toContain('setdateformat');
  });

  it('(3) reads @InitBinder + registerCustomEditor(Date.class, new SimpleDateFormat("..."))', () => {
    const r = resolveGlobalDateFormat([javaIr('SomeController.java', INIT_BINDER_CONTROLLER)]);
    expect(r).not.toBeNull();
    expect(r!.format).toBe('MM-dd-yyyy');
    expect(r!.source.toLowerCase()).toContain('initbinder');
  });

  it('(4) reads a bare new SimpleDateFormat("...") literal', () => {
    const r = resolveGlobalDateFormat([javaIr('DateUtil.java', BARE_SIMPLE_DATE_FORMAT)]);
    expect(r).not.toBeNull();
    expect(r!.format).toBe('dd.MM.yyyy');
  });

  it('(4) reads a bare DateTimeFormatter.ofPattern("...") literal', () => {
    const r = resolveGlobalDateFormat([javaIr('DateUtil2.java', BARE_OF_PATTERN)]);
    expect(r).not.toBeNull();
    expect(r!.format).toBe('yyyy-MM-dd');
  });
});

// ---------------------------------------------------------------------------
// (2) Precedence: higher rank wins.
// ---------------------------------------------------------------------------

describe('resolveGlobalDateFormat -- precedence ladder', () => {
  it('properties (rank 1) wins over a @Configuration setDateFormat (rank 2)', () => {
    const r = resolveGlobalDateFormat([
      javaIr('JacksonConfig.java', CONFIG_SET_DATE_FORMAT), // rank 2 -> yyyy/MM/dd
      configIr('application.properties', PROPERTIES_DATE_FORMAT), // rank 1 -> dd-MMM-yyyy
    ]);
    expect(r!.format).toBe('dd-MMM-yyyy');
    expect(r!.source).toContain('spring.jackson.date-format');
  });

  it('a @Configuration setDateFormat (rank 2) wins over a bare SimpleDateFormat (rank 4)', () => {
    const r = resolveGlobalDateFormat([
      javaIr('DateUtil.java', BARE_SIMPLE_DATE_FORMAT), // rank 4 -> dd.MM.yyyy
      javaIr('JacksonConfig.java', CONFIG_SET_DATE_FORMAT), // rank 2 -> yyyy/MM/dd
    ]);
    expect(r!.format).toBe('yyyy/MM/dd');
  });
});

// ---------------------------------------------------------------------------
// (3) Same-rank disagreement -> first by stable file order at LOWER confidence.
// ---------------------------------------------------------------------------

describe('resolveGlobalDateFormat -- same-rank tiebreak', () => {
  it('two rank-4 disagreements pick the FIRST in stable file order at lower confidence', () => {
    const both = resolveGlobalDateFormat([
      javaIr('DateUtil.java', BARE_SIMPLE_DATE_FORMAT), // dd.MM.yyyy (first)
      javaIr('DateUtil2.java', BARE_OF_PATTERN), // yyyy-MM-dd (second)
    ]);
    const single = resolveGlobalDateFormat([javaIr('DateUtil.java', BARE_SIMPLE_DATE_FORMAT)]);
    expect(both!.format).toBe('dd.MM.yyyy');
    // A same-rank disagreement lowers confidence vs. the unambiguous single case.
    expect(both!.confidence).toBeLessThan(single!.confidence);
  });

  it('returns null when nothing resolves', () => {
    expect(resolveGlobalDateFormat([configIr('application.properties', 'server.port=8080\n')])).toBeNull();
  });
});


// ---------------------------------------------------------------------------
// (4) End-to-end: the single inferred_date_format attaches to each endpoint's
//     request_contract via the springClassic adapter.
// ---------------------------------------------------------------------------

const E2E_CONTROLLER = `
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

describe('globalDateFormatScanner -- end-to-end attach via the springClassic adapter', () => {
  it('stamps ONE top-level inferred_date_format on the endpoint request_contract', () => {
    const files = [
      configIr('application.properties', PROPERTIES_DATE_FORMAT), // dd-MMM-yyyy
      javaIr('GController.java', E2E_CONTROLLER),
    ];
    const candidates = runSpringClassicAdapter(files, 'g-run');
    const endpoint = candidates.find(
      (c: DiscoveryCandidate) => c.candidateType === 'endpoints' && c.name === 'GET /g/at',
    )!;
    expect(endpoint).toBeDefined();
    const contract = (endpoint.data as Record<string, unknown>).request_contract as Record<string, unknown>;
    expect(contract).toBeDefined();
    const idf = contract.inferred_date_format as { format: string; source: string; confidence: number };
    expect(idf).toBeDefined();
    expect(idf.format).toBe('dd-MMM-yyyy');
    expect(idf.source).toContain('spring.jackson.date-format');
    expect(typeof idf.confidence).toBe('number');
  });

  it('attaches NOTHING (no empty object) when no global date format resolves', () => {
    const files = [javaIr('GController.java', E2E_CONTROLLER)];
    const candidates = runSpringClassicAdapter(files, 'g-run-2');
    const endpoint = candidates.find(
      (c: DiscoveryCandidate) => c.candidateType === 'endpoints' && c.name === 'GET /g/at',
    )!;
    const contract = (endpoint.data as Record<string, unknown>).request_contract as Record<string, unknown>;
    expect(contract).toBeDefined();
    expect(contract.inferred_date_format).toBeUndefined();
  });
});
