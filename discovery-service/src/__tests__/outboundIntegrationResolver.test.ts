/**
 * Tests for the Spring Classic Outbound Integration Graph resolver
 * (Outbound Integration Graph, Spec #5, Task Group 2).
 *
 * Spec: 2026-05-30 Outbound Integration Graph for Discovery
 * (Java / Spring Classic + Spring Boot).
 *
 * Covers the NEW deterministic `resolveOutboundIntegrations` resolver:
 *   - outbound HTTP-client target resolution from the now-populated
 *     `CallIR.args` (Task Group 1) -- `integration_kind: 'outbound-rest'`;
 *   - messaging-producer topic/queue/exchange resolution from `CallIR.args`;
 *   - a secondary-store / object-store case;
 *   - call-graph attribution (a call reached from a controller mapping
 *     attributes to the CALLING ENDPOINT; a call in a plain @Service attributes
 *     to the OWNING SERVICE);
 *   - one-edge-per-(source owner, resolved target) dedup;
 *   - soft-fail on malformed input (never throws).
 *
 * Focused per the discovery test conventions: real Java source through
 * `extractJavaIR`, then assert on the resolver output. Run IN ISOLATION by file
 * path (pre-existing tree-sitter combined-run fragility).
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import {
  resolveOutboundIntegrations,
  type ResolvedOutboundEdge,
} from '../services/extensionPacks/frameworkAdapters/springClassic/outboundIntegrationResolver';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';

function ir(...srcs: Array<[string, string]>): SourceFileIR[] {
  return srcs.map(([p, s]) => {
    const parsed = extractJavaIR(p, s);
    if (!parsed) throw new Error(`parse fail for ${p}`);
    return parsed;
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A controller whose handler calls restTemplate.getForObject("http://inventory/...")
const INVENTORY_CONTROLLER = `
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
    return restTemplate.getForObject("http://inventory/items", String.class);
  }
}
`;

// A plain @Service that publishes to Kafka -- attributes to the OWNING SERVICE.
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

// A controller delegating to a service that does the outbound HTTP call --
// the edge attributes to the CALLING ENDPOINT (reached from the mapping).
const PRICING_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.beans.factory.annotation.Autowired;
import com.foo.service.PricingService;

@RestController
@RequestMapping("/pricing")
public class PricingController {
  @Autowired
  private PricingService pricingService;

  @PostMapping("/quote")
  public String quote() {
    return pricingService.fetchQuote();
  }
}
`;

const PRICING_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

@Service
public class PricingService {
  private final RestTemplate restTemplate;
  public PricingService(RestTemplate restTemplate) { this.restTemplate = restTemplate; }

  public String fetchQuote() {
    return restTemplate.getForObject("http://pricing/quote", String.class);
  }
}
`;

// A @Service that writes to Redis (secondary/cache store).
const CACHE_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.data.redis.core.StringRedisTemplate;

@Service
public class SessionCacheService {
  private final StringRedisTemplate redisTemplate;
  public SessionCacheService(StringRedisTemplate redisTemplate) { this.redisTemplate = redisTemplate; }

  public void store(String token) {
    redisTemplate.opsForValue().set("session:" + token, "1");
  }
}
`;

// A pure handler with NO outbound calls (a plain in-process service method).
const PURE_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;

@Service
public class CalculatorService {
  public int add(int a, int b) {
    return a + b;
  }
}
`;

// Two endpoints reaching the SAME outbound target -> dedup to ONE edge per
// (source owner, resolved target).
const DUP_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.client.RestTemplate;

@RestController
@RequestMapping("/dup")
public class DupController {
  private final RestTemplate restTemplate;
  public DupController(RestTemplate restTemplate) { this.restTemplate = restTemplate; }

  @GetMapping("/a")
  public String a() {
    return restTemplate.getForObject("http://same/target", String.class);
  }
  @GetMapping("/b")
  public String b() {
    return restTemplate.getForObject("http://same/target", String.class);
  }
}
`;

function targetsOf(edges: ResolvedOutboundEdge[]): string[] {
  return edges.map((e) => e.target);
}

// ===========================================================================
// HTTP client target resolution (controller-owned)
// ===========================================================================

describe('outbound HTTP client target resolution', () => {
  it('restTemplate.getForObject("http://inventory/items") -> outbound-rest edge with the verbatim URL + GET verb, attributed to the calling endpoint', () => {
    const files = ir(['web/CatalogController.java', INVENTORY_CONTROLLER]);
    const { resolved } = resolveOutboundIntegrations(files);

    const rest = resolved.filter((e) => e.integrationKind === 'outbound-rest');
    expect(rest).toHaveLength(1);
    const edge = rest[0];
    expect(edge.target).toBe('http://inventory/items');
    expect(edge.httpVerb).toBe('GET');
    // Reached from the controller mapping -> attributed to the calling endpoint.
    expect(edge.sourceKind).toBe('endpoint');
    expect(edge.sourceName).toBe('GET /catalog/items');
  });
});

// ===========================================================================
// Messaging producer target resolution
// ===========================================================================

describe('messaging producer target resolution', () => {
  it('kafkaTemplate.send("orders-topic", event) -> messaging-producer edge with topic "orders-topic" + payload-type hint, attributed to the owning service', () => {
    const files = ir(['service/OrderEventService.java', ORDER_EVENT_SERVICE]);
    const { resolved } = resolveOutboundIntegrations(files);

    const msg = resolved.filter((e) => e.integrationKind === 'messaging-producer');
    expect(msg).toHaveLength(1);
    const edge = msg[0];
    expect(edge.target).toBe('orders-topic');
    expect(edge.messagingOperation).toBe('send');
    // Not reached from a controller -> attributed to the owning @Service.
    expect(edge.sourceKind).toBe('service');
    expect(edge.sourceName).toBe('OrderEventService');
    // Best-effort payload-type hint (the static type of the send payload arg).
    expect(edge.payloadHint).toBe('OrderEvent');
  });
});

// ===========================================================================
// Secondary / cache store
// ===========================================================================

describe('cache / secondary store detection', () => {
  it('a StringRedisTemplate op -> cache-store edge attributed to the owning service', () => {
    const files = ir(['service/SessionCacheService.java', CACHE_SERVICE]);
    const { resolved } = resolveOutboundIntegrations(files);

    const cache = resolved.filter((e) => e.integrationKind === 'cache-store');
    expect(cache.length).toBeGreaterThanOrEqual(1);
    const edge = cache[0];
    expect(edge.sourceKind).toBe('service');
    expect(edge.sourceName).toBe('SessionCacheService');
    expect(edge.target).toBe('redis');
  });
});

// ===========================================================================
// Call-graph attribution: controller -> service -> outbound
// ===========================================================================

describe('call-graph attribution (controller -> service -> outbound)', () => {
  it('an outbound call inside a @Service reached from a controller mapping attributes to the CALLING ENDPOINT', () => {
    const files = ir(
      ['web/PricingController.java', PRICING_CONTROLLER],
      ['service/PricingService.java', PRICING_SERVICE],
    );
    const { resolved } = resolveOutboundIntegrations(files);

    const rest = resolved.filter((e) => e.integrationKind === 'outbound-rest');
    // The SAME outbound call must NOT be double-counted (once as endpoint-owned,
    // once as service-owned) -- the controller-reached attribution wins.
    const endpointOwned = rest.filter((e) => e.sourceKind === 'endpoint');
    expect(endpointOwned).toHaveLength(1);
    expect(endpointOwned[0].sourceName).toBe('POST /pricing/quote');
    expect(endpointOwned[0].target).toBe('http://pricing/quote');
  });
});

// ===========================================================================
// Dedup: same target reached from multiple endpoints -> one edge per pair
// ===========================================================================

describe('dedup (one edge per (source owner, resolved target) pair)', () => {
  it('two endpoints reaching the same URL still produce one edge PER endpoint owner, never duplicates for the same owner', () => {
    const files = ir(['web/DupController.java', DUP_CONTROLLER]);
    const { resolved } = resolveOutboundIntegrations(files);

    const toTarget = resolved.filter((e) => e.target === 'http://same/target');
    // Two distinct endpoint owners (GET /dup/a, GET /dup/b) -> two edges, but
    // each (owner,target) pair appears exactly once.
    const pairs = new Set(toTarget.map((e) => `${e.sourceName}=>${e.target}`));
    expect(pairs.size).toBe(toTarget.length);
    expect(targetsOf(toTarget).every((t) => t === 'http://same/target')).toBe(true);
  });
});

// ===========================================================================
// Pure handler: no outbound -> nothing
// ===========================================================================

describe('pure handler with no outbound', () => {
  it('emits no outbound edges', () => {
    const files = ir(['service/CalculatorService.java', PURE_SERVICE]);
    const { resolved, unresolved } = resolveOutboundIntegrations(files);
    expect(resolved).toHaveLength(0);
    expect(unresolved).toHaveLength(0);
  });
});

// ===========================================================================
// Soft-fail on malformed input
// ===========================================================================

describe('soft-fail on malformed input', () => {
  it('never throws on null / undefined / garbage IR', () => {
    expect(() => resolveOutboundIntegrations(null as unknown as SourceFileIR[])).not.toThrow();
    expect(() => resolveOutboundIntegrations(undefined as unknown as SourceFileIR[])).not.toThrow();
    expect(() => resolveOutboundIntegrations([{} as unknown as SourceFileIR])).not.toThrow();
    expect(
      () =>
        resolveOutboundIntegrations([
          { classes: [{ methods: [{ calls: [{}] }] }] } as unknown as SourceFileIR,
        ]),
    ).not.toThrow();
    const out = resolveOutboundIntegrations(null as unknown as SourceFileIR[]);
    expect(out.resolved).toEqual([]);
    expect(out.unresolved).toEqual([]);
  });
});
