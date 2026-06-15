/**
 * Tests for the springBoot adapter's OUTBOUND-integration parity
 * (Outbound Integration Graph, Spec #5, Task Group 4).
 *
 * Spec: 2026-05-30 Outbound Integration Graph for Discovery
 * (Java / Spring Classic + Spring Boot).
 *
 * Task Group 4 gives the springBoot adapter the SAME outbound detection the
 * springClassic adapter gained in Task Group 3, REUSING (not forking) the
 * shared, framework-agnostic `outboundIntegrationResolver` (Task Group 2) +
 * `buildOutboundIntegrationCandidates` / `buildOutboundIntegrationFindings`
 * emit helpers (Task Group 3). These tests mirror the springClassic G3 tests
 * but drive everything THROUGH the springBoot adapter (the V3 pack pair the
 * other springBoot suites use), proving:
 *
 *   - a Spring Boot @RestController whose handler calls an HTTP client emits a
 *     `data_movements` candidate ATTRIBUTED TO THE BOOT ENDPOINT;
 *   - a Spring Boot @Service with a messaging producer emits a `data_movements`
 *     candidate with the topic resolved from `CallIR.args`, attributed to the
 *     OWNING SERVICE;
 *   - the dispatch is WIRED: `processOutboundIntegrations` runs in the adapter's
 *     run function (an eligible Boot class yields the edge);
 *   - a pure Boot handler with no outbound emits NO `data_movements` candidate;
 *   - an external bare-URL target produces a rich
 *     `external_integration_dependency` Finding (via the shared finding emitter
 *     the springBoot finding path also uses) -- NEVER a `*_points`, NEVER an
 *     invented external entity.
 *
 * Run IN ISOLATION by file path (pre-existing tree-sitter combined-run
 * fragility -- do NOT run the whole discovery suite).
 */
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { springBootFrameworkPack } from '../services/extensionPacks/frameworkPacks/springBootFrameworkPack';
import { buildOutboundIntegrationFindings } from '../services/extensionPacks/frameworkAdapters/springClassic/outboundIntegrationCandidates';
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR, TechHints } from '../services/extensionPacks';
import type { DiscoveryCandidate } from '../types/candidate';

const SPRING_BOOT_HINTS: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring Boot' },
};

/** Run the V3 Spring Boot pack pair (extract + adapt) over a set of sources. */
function runBootAdapter(
  files: Map<string, string>,
  runId: string,
): DiscoveryCandidate[] {
  const irFiles = javaLangPack.extract(files, SPRING_BOOT_HINTS);
  return springBootFrameworkPack.adapt(irFiles, runId, SPRING_BOOT_HINTS);
}

/** Parse a single Java source through the Java extractor into a SourceFileIR. */
function ir(path: string, src: string): SourceFileIR[] {
  const parsed = extractJavaIR(path, src);
  if (!parsed) throw new Error(`parse fail for ${path}`);
  return [parsed];
}

function dataOf(c: DiscoveryCandidate): Record<string, any> {
  return c.data as Record<string, any>;
}

// A Spring Boot @RestController whose handler calls restTemplate.getForObject to
// a PURELY EXTERNAL bare URL.
const BOOT_HTTP_CONTROLLER = `
package com.shop.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.client.RestTemplate;

@RestController
@RequestMapping("/catalog")
public class CatalogController {
  private final RestTemplate restTemplate;
  public CatalogController(RestTemplate restTemplate) { this.restTemplate = restTemplate; }

  @GetMapping("/items")
  public String items() {
    return restTemplate.getForObject("http://inventory.example.com/items", String.class);
  }
}
`;

// A Spring Boot @Service publishing to Kafka (topic resolved from CallIR.args).
const BOOT_ORDER_EVENT_SERVICE = `
package com.shop.service;
import org.springframework.stereotype.Service;
import org.springframework.kafka.core.KafkaTemplate;

@Service
public class OrderEventService {
  private final KafkaTemplate<String, OrderEvent> kafkaTemplate;
  public OrderEventService(KafkaTemplate<String, OrderEvent> kafkaTemplate) { this.kafkaTemplate = kafkaTemplate; }

  public void publish(OrderEvent event) {
    kafkaTemplate.send("orders-topic", event);
  }
}
`;

// A pure Spring Boot @Service -- no outbound integration at all.
const BOOT_PURE_SERVICE = `
package com.shop.service;
import org.springframework.stereotype.Service;

@Service
public class CalculatorService {
  public int add(int a, int b) { return a + b; }
}
`;

// ===========================================================================
// data_movements candidate emission THROUGH the springBoot adapter
// ===========================================================================

describe('springBoot adapter: data_movements outbound-edge parity', () => {
  it('a Spring Boot @RestController calling an HTTP client emits a data_movements candidate attributed to the Boot endpoint (no *_points)', () => {
    const cands = runBootAdapter(
      new Map([['src/main/java/com/shop/web/CatalogController.java', BOOT_HTTP_CONTROLLER]]),
      'boot-r1',
    );

    const dm = cands.filter((c) => c.candidateType === 'data_movements');
    expect(dm).toHaveLength(1);
    const d = dataOf(dm[0]);

    // The outbound REST target, resolved verbatim from CallIR.args.
    expect(d.movementType).toBe('outbound-rest');
    expect(d.target).toBe('http://inventory.example.com/items');
    // Source resolves to the OWNING class's application_point BY NAME (the
    // controller here) -- save-back resolves the point id LATE.
    expect(d.sourceServiceName).toBe('CatalogController');
    // Attributed to the CALLING endpoint via the shared call-graph walk.
    expect(d.sourceKind).toBe('endpoint');
    expect(d.sourceEndpointName).toBe('GET /catalog/items');

    // NEVER any *_points references -- save-back resolves the point ids LATE.
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/application_point/);
    expect(json).not.toMatch(/data_entity_point/);
    expect(d.source_application_point_id).toBeUndefined();
    expect(d.target_application_point_id).toBeUndefined();
  });

  it('a Spring Boot @Service with a Kafka producer emits a data_movements candidate with the topic from CallIR.args, attributed to the owning service', () => {
    const cands = runBootAdapter(
      new Map([['src/main/java/com/shop/service/OrderEventService.java', BOOT_ORDER_EVENT_SERVICE]]),
      'boot-r1',
    );

    const dm = cands.filter((c) => c.candidateType === 'data_movements');
    expect(dm).toHaveLength(1);
    const d = dataOf(dm[0]);
    expect(d.movementType).toBe('messaging-producer');
    // Topic resolved from the first literal arg of kafkaTemplate.send(...).
    expect(d.target).toBe('orders-topic');
    // A plain @Service (no inbound mapping) attributes to the OWNING service.
    expect(d.sourceServiceName).toBe('OrderEventService');
    expect(d.sourceKind).toBe('service');
    // Payload-type hint from the KafkaTemplate generic arg.
    expect(d.payloadHint).toBe('OrderEvent');
    expect(d.messagingOperation).toBe('send');
  });

  it('the dispatch is wired: an eligible Boot class yields the data_movements edge from the adapter run function (processOutboundIntegrations runs)', () => {
    // If the post-pass dispatch were absent, NO `data_movements` candidate would
    // appear in the adapter output for an outbound-calling Boot class. Its
    // presence proves `processOutboundIntegrations` runs in `runSpringBootAdapter`.
    const cands = runBootAdapter(
      new Map([['src/main/java/com/shop/service/OrderEventService.java', BOOT_ORDER_EVENT_SERVICE]]),
      'boot-r1',
    );
    expect(cands.some((c) => c.candidateType === 'data_movements')).toBe(true);
  });

  it('a pure Boot handler with no outbound call emits NO data_movements candidate', () => {
    const cands = runBootAdapter(
      new Map([['src/main/java/com/shop/service/CalculatorService.java', BOOT_PURE_SERVICE]]),
      'boot-r1',
    );
    expect(cands.filter((c) => c.candidateType === 'data_movements')).toHaveLength(0);
  });
});

// ===========================================================================
// external_integration_dependency Findings (shared emitter over the Boot IR)
// ===========================================================================

describe('springBoot adapter: external_integration_dependency Findings', () => {
  it('a Spring Boot endpoint calling a bare external URL produces a rich external_integration_dependency Finding (no *_points, no invented entity)', () => {
    // The springBoot finding path and the springClassic finding scanner both
    // call the SAME shared `buildOutboundIntegrationFindings(files)` over the IR.
    const files = ir('src/main/java/com/shop/web/CatalogController.java', BOOT_HTTP_CONTROLLER);
    const findings = buildOutboundIntegrationFindings(files);

    const ext = findings.filter((f) => f.findingType === 'external_integration_dependency');
    expect(ext).toHaveLength(1);
    const f = ext[0];
    expect(f.severity).toBe('medium');
    expect(f.summary).toContain('http://inventory.example.com/items');
    const detail = f.detailJson as Record<string, any>;
    expect(detail.target).toBe('http://inventory.example.com/items');
    expect(detail.integrationKind).toBe('outbound-rest');
    // Evidence: the calling endpoint + call-site FQN+line.
    expect(detail.sourceName).toBe('GET /catalog/items');
    expect(detail.callSiteFqn).toBe('com.shop.web.CatalogController#items');
    expect(typeof detail.callSiteLine).toBe('number');

    // Never a *_points reference, never an invented entity in the finding.
    const json = JSON.stringify(f);
    expect(json).not.toMatch(/application_point/);
    expect(json).not.toMatch(/data_entity_point/);
  });

  it('a pure Boot handler with no outbound emits no external Findings', () => {
    const files = ir('src/main/java/com/shop/service/CalculatorService.java', BOOT_PURE_SERVICE);
    const findings = buildOutboundIntegrationFindings(files);
    expect(
      findings.filter((f) => f.findingType === 'external_integration_dependency'),
    ).toHaveLength(0);
  });
});
