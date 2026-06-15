/**
 * Tests for the `data_movements` candidate emission + external-dependency
 * Findings (Outbound Integration Graph, Spec #5, Task Group 3).
 *
 * Spec: 2026-05-30 Outbound Integration Graph for Discovery
 * (Java / Spring Classic + Spring Boot).
 *
 * Covers:
 *   - a resolved outbound edge emits a `data_movements` candidate carrying the
 *     source service NAME + resolved target NAME + `movement_type` + verbatim
 *     target (+ payload hint), and NEVER any `application_points` /
 *     `data_entity_points` references;
 *   - a messaging edge emits a `data_movements` candidate (topic from args);
 *   - a purely-external bare-URL target emits a rich
 *     `external_integration_dependency` Finding (NOT a candidate, NOT a
 *     `*_points`) via the external-dependency finding builder;
 *   - a modellable target does NOT emit an external Finding (external-only);
 *   - a pure handler with no outbound emits nothing.
 *
 * Focused per the discovery test conventions: real Java source through
 * `extractJavaIR`. Run IN ISOLATION by file path (tree-sitter combined-run
 * fragility).
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import {
  buildOutboundIntegrationCandidates,
  buildOutboundIntegrationFindings,
} from '../services/extensionPacks/frameworkAdapters/springClassic/outboundIntegrationCandidates';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../types/candidate';

function ir(...srcs: Array<[string, string]>): SourceFileIR[] {
  return srcs.map(([p, s]) => {
    const parsed = extractJavaIR(p, s);
    if (!parsed) throw new Error(`parse fail for ${p}`);
    return parsed;
  });
}

function dataOf(c: DiscoveryCandidate): Record<string, any> {
  return c.data as Record<string, any>;
}

// A controller calling restTemplate.getForObject to a PURELY EXTERNAL bare URL.
const EXTERNAL_HTTP_CONTROLLER = `
package com.foo.web;
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

// A @Service publishing to Kafka.
const ORDER_EVENT_SERVICE = `
package com.foo.service;
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

// A pure service -- no outbound.
const PURE_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;

@Service
public class CalculatorService {
  public int add(int a, int b) { return a + b; }
}
`;

// ===========================================================================
// data_movements candidate emission
// ===========================================================================

describe('data_movements candidate emission', () => {
  it('a resolved HTTP outbound edge emits a data_movements candidate carrying source service NAME + target + movement_type + verbatim target, and NO *_points', () => {
    const files = ir(['web/CatalogController.java', EXTERNAL_HTTP_CONTROLLER]);
    const cands = buildOutboundIntegrationCandidates(files, 'r1');

    const dm = cands.filter((c) => c.candidateType === 'data_movements');
    expect(dm).toHaveLength(1);
    const d = dataOf(dm[0]);

    // Save-back resolution keys (read BY NAME by the MCP Group-5 producer).
    expect(d.movementType).toBe('outbound-rest');
    expect(d.target).toBe('http://inventory.example.com/items');
    // Source resolves to the OWNING class's application_point BY NAME (the
    // service/interface that contains the call) -- here the controller class.
    expect(d.sourceServiceName).toBe('CatalogController');
    // Endpoint context retained for traceability (the calling endpoint).
    expect(d.sourceEndpointName).toBe('GET /catalog/items');
    expect(d.sourceKind).toBe('endpoint');

    // NEVER any *_points references -- save-back resolves the point ids LATE.
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/application_point/);
    expect(json).not.toMatch(/data_entity_point/);
    expect(d.source_application_point_id).toBeUndefined();
    expect(d.target_application_point_id).toBeUndefined();
  });

  it('a messaging producer emits a data_movements candidate with the topic from args + the payload-type hint + movement_type messaging-producer', () => {
    const files = ir(['service/OrderEventService.java', ORDER_EVENT_SERVICE]);
    const cands = buildOutboundIntegrationCandidates(files, 'r1');

    const dm = cands.filter((c) => c.candidateType === 'data_movements');
    expect(dm).toHaveLength(1);
    const d = dataOf(dm[0]);
    expect(d.movementType).toBe('messaging-producer');
    expect(d.target).toBe('orders-topic');
    expect(d.sourceServiceName).toBe('OrderEventService');
    expect(d.sourceKind).toBe('service');
    expect(d.payloadHint).toBe('OrderEvent');
    expect(d.messagingOperation).toBe('send');
  });

  it('a pure handler with no outbound emits no data_movements candidates', () => {
    const files = ir(['service/CalculatorService.java', PURE_SERVICE]);
    const cands = buildOutboundIntegrationCandidates(files, 'r1');
    expect(cands.filter((c) => c.candidateType === 'data_movements')).toHaveLength(0);
  });
});

// ===========================================================================
// external_integration_dependency Findings
// ===========================================================================

describe('external_integration_dependency Findings', () => {
  it('a purely-external bare-URL target emits a rich external_integration_dependency Finding (NOT a candidate, NOT a *_points) with the verbatim target + integration_kind + calling endpoint + call-site FQN+line', () => {
    const files = ir(['web/CatalogController.java', EXTERNAL_HTTP_CONTROLLER]);
    const findings = buildOutboundIntegrationFindings(files);

    const ext = findings.filter((f) => f.findingType === 'external_integration_dependency');
    expect(ext).toHaveLength(1);
    const f = ext[0];
    expect(f.severity).toBe('medium');
    // Verbatim external target carried.
    expect(f.summary).toContain('http://inventory.example.com/items');
    const detail = f.detailJson as Record<string, any>;
    expect(detail.target).toBe('http://inventory.example.com/items');
    expect(detail.integrationKind).toBe('outbound-rest');
    expect(detail.sourceName).toBe('GET /catalog/items');
    expect(detail.callSiteFqn).toBe('com.foo.web.CatalogController#items');
    expect(typeof detail.callSiteLine).toBe('number');

    // Never a *_points reference, never an invented entity in the finding.
    const json = JSON.stringify(f);
    expect(json).not.toMatch(/application_point/);
    expect(json).not.toMatch(/data_entity_point/);
  });

  it('the external target ALSO produces a data_movements candidate (source resolved, target left for the producer to NULL) -- records the dependency without an invented counterpart', () => {
    const files = ir(['web/CatalogController.java', EXTERNAL_HTTP_CONTROLLER]);
    const cands = buildOutboundIntegrationCandidates(files, 'r1');
    const dm = cands.filter((c) => c.candidateType === 'data_movements');
    expect(dm).toHaveLength(1);
    const d = dataOf(dm[0]);
    // The candidate flags the target as external so the producer leaves the
    // target_application_point_id NULL (the architecture records the outbound
    // dependency without minting a fake counterpart).
    expect(d.targetLooksExternal).toBe(true);
    expect(d.sourceServiceName).toBe('CatalogController');
  });

  it('a pure handler with no outbound emits no external Findings', () => {
    const files = ir(['service/CalculatorService.java', PURE_SERVICE]);
    const findings = buildOutboundIntegrationFindings(files);
    expect(findings.filter((f) => f.findingType === 'external_integration_dependency')).toHaveLength(0);
  });
});
