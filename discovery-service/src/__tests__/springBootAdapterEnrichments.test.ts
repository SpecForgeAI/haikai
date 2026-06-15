/**
 * Tier-1 / Tier-2 enrichment tests for the spring-boot framework adapter.
 *
 * Targets the metadata + subtype additions made on 2026-04-26 to push the
 * `java-lang` / `java-spring-boot` pack toward the Excellent band:
 *   - @Transactional capture (method + class-level fallback)
 *   - @PreAuthorize / @Secured / @RolesAllowed on endpoints
 *   - @Operation / @Tag / @ApiResponse on endpoints / controllers
 *   - @Async / @EventListener / @Scheduled subtype tagging
 *   - @Cacheable / @CacheEvict / @CachePut metadata
 *   - @Configuration + @Bean → interface candidate with subtype
 *     `spring-bean-definition`
 *   - @PostConstruct / @PreDestroy lifecycle methods dropped from
 *     business_logics emission
 */
import { phpLangPack as _php } from '../services/extensionPacks/languagePacks/phpLangPack'; void _php;
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { springBootFrameworkPack } from '../services/extensionPacks/frameworkPacks/springBootFrameworkPack';
import type { TechHints } from '../services/extensionPacks';
import type { DiscoveryCandidate } from '../types/candidate';

const HINTS: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring Boot' },
};

function runPipeline(files: Map<string, string>, runId: string): DiscoveryCandidate[] {
  const ir = javaLangPack.extract(files, HINTS);
  return springBootFrameworkPack.adapt(ir, runId, HINTS);
}

describe('spring-boot adapter — endpoint enrichments', () => {
  const SRC = `package x.y;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.transaction.annotation.Transactional;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import io.swagger.v3.oas.annotations.responses.ApiResponse;

@RestController
@RequestMapping("/api/owners")
@Tag(name = "owners", description = "Owner CRUD endpoints")
public class OwnerController {
  @GetMapping("/{id}")
  @PreAuthorize("hasRole('USER')")
  @Operation(summary = "Get one owner", description = "Returns a single owner by id")
  @ApiResponse(responseCode = "200", description = "Found")
  @ApiResponse(responseCode = "404", description = "Not found")
  @Transactional(readOnly = true, propagation = "SUPPORTS")
  public OwnerDto findOne(@PathVariable Long id) { return null; }
}
`;

  it('captures @PreAuthorize, @Operation, @ApiResponse, and @Transactional on endpoints', () => {
    const cs = runPipeline(new Map([['OwnerController.java', SRC]]), 'r');
    const ep = cs.find((c) => c.candidateType === 'endpoints' && c.name === 'GET /api/owners/{id}');
    expect(ep).toBeDefined();
    expect(ep!.data.security).toMatchObject({
      annotation: 'PreAuthorize',
      expression: expect.stringContaining("hasRole('USER')"),
      inheritedFromClass: false,
    });
    expect(ep!.data.openApiOperation).toMatchObject({
      summary: expect.stringContaining('Get one owner'),
      description: expect.stringContaining('Returns'),
    });
    expect(Array.isArray(ep!.data.openApiResponses)).toBe(true);
    const responses = ep!.data.openApiResponses as Array<Record<string, string>>;
    expect(responses.length).toBeGreaterThanOrEqual(2);
    const codes = responses.map((r) => r.responseCode);
    expect(codes).toEqual(expect.arrayContaining(['200', '404']));
    expect(ep!.data.transactional).toMatchObject({
      readOnly: 'true',
      propagation: 'SUPPORTS',
    });
  });

  it('captures controller-level @Tag onto the interface candidate', () => {
    const cs = runPipeline(new Map([['OwnerController.java', SRC]]), 'r');
    const iface = cs.find((c) => c.candidateType === 'interfaces' && c.name === 'OwnerController');
    expect(iface).toBeDefined();
    expect(iface!.data.openApiTag).toMatchObject({
      name: 'owners',
      description: expect.stringContaining('Owner'),
    });
  });
});

describe('spring-boot adapter — service-layer enrichments', () => {
  const SRC = `package x.y;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.context.event.EventListener;
import javax.annotation.PostConstruct;

@Service
@Transactional
public class OwnerService {
  @PostConstruct
  public void init() {}

  public OwnerDto findOne(Long id) { return null; }

  @Transactional(readOnly = true, propagation = "REQUIRED")
  @Cacheable(value = "owners", key = "#id")
  public OwnerDto findOneCached(Long id) { return null; }

  @CacheEvict(value = "owners", key = "#id")
  public void evictOwner(Long id) {}

  @Async("taskExecutor")
  public void notifyAsync(Long id) {}

  @Scheduled(cron = "0 0 * * * *")
  public void hourlyHousekeeping() {}

  @EventListener(classes = OwnerCreatedEvent.class)
  public void onOwnerCreated(OwnerCreatedEvent ev) {}
}
`;

  it('drops @PostConstruct lifecycle methods from business_logics', () => {
    const cs = runPipeline(new Map([['OwnerService.java', SRC]]), 'r');
    const names = cs.filter((c) => c.candidateType === 'business_logics').map((c) => c.name);
    expect(names).not.toContain('init');
  });

  it('inherits class-level @Transactional onto plain service methods', () => {
    const cs = runPipeline(new Map([['OwnerService.java', SRC]]), 'r');
    const m = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'findOne');
    expect(m).toBeDefined();
    expect(m!.data.transactional).toMatchObject({ inheritedFromClass: 'true' });
  });

  it('captures method-level @Transactional with explicit args', () => {
    const cs = runPipeline(new Map([['OwnerService.java', SRC]]), 'r');
    const m = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'findOneCached');
    expect(m).toBeDefined();
    expect(m!.data.transactional).toMatchObject({
      readOnly: 'true',
      propagation: 'REQUIRED',
    });
  });

  it('captures @Cacheable / @CacheEvict metadata', () => {
    const cs = runPipeline(new Map([['OwnerService.java', SRC]]), 'r');
    const cached = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'findOneCached');
    expect(cached!.data.cache).toMatchObject({ cacheKind: 'Cacheable' });
    const evict = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'evictOwner');
    expect(evict!.data.cache).toMatchObject({ cacheKind: 'CacheEvict' });
  });

  it('tags @Async methods with subtype async-job and captures executor', () => {
    const cs = runPipeline(new Map([['OwnerService.java', SRC]]), 'r');
    const m = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'notifyAsync');
    expect(m!.data.businessLogicSubtype).toBe('async-job');
    expect(m!.data.async).toMatchObject({ executor: expect.stringContaining('taskExecutor') });
  });

  it('tags @Scheduled methods with subtype scheduled-task and captures cron', () => {
    const cs = runPipeline(new Map([['OwnerService.java', SRC]]), 'r');
    const m = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'hourlyHousekeeping');
    expect(m!.data.businessLogicSubtype).toBe('scheduled-task');
    expect(m!.data.scheduled).toMatchObject({ cron: expect.stringContaining('0 0 * * * *') });
  });

  it('tags @EventListener methods with subtype event-handler and captures classes arg', () => {
    const cs = runPipeline(new Map([['OwnerService.java', SRC]]), 'r');
    const m = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'onOwnerCreated');
    expect(m!.data.businessLogicSubtype).toBe('event-handler');
    expect(m!.data.eventListener).toMatchObject({
      listenerKind: 'EventListener',
      classes: expect.stringContaining('OwnerCreatedEvent'),
    });
  });
});

describe('spring-boot adapter — @Configuration / @Bean', () => {
  const SRC = `package x.y;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Scope;

@Configuration
public class CoreConfig {
  @Bean(name = "primaryClock")
  @Primary
  public Clock primaryClock() { return null; }

  @Bean
  @Scope("prototype")
  public OwnerValidator ownerValidator() { return null; }
}
`;

  it('emits one interfaces candidate per @Bean method, tagged spring-bean-definition', () => {
    const cs = runPipeline(new Map([['CoreConfig.java', SRC]]), 'r');
    const beans = cs.filter(
      (c) => c.candidateType === 'interfaces' && (c.data.interfaceSubtype === 'spring-bean-definition'),
    );
    expect(beans.length).toBe(2);
    const primary = beans.find((b) => b.data.beanName === 'primaryClock');
    expect(primary).toBeDefined();
    expect(primary!.data.beanReturnType).toBe('Clock');
    expect(primary!.data.configurationClassName).toBe('CoreConfig');
    expect(primary!.data.isPrimary).toBe(true);

    const validator = beans.find((b) => b.data.beanName === 'ownerValidator');
    expect(validator).toBeDefined();
    expect(validator!.data.scope).toBe('prototype');
  });
});


// ===========================================================================
// Spec #4 Task Group 6 -- close TODO(oracle-W1): the Spring-Boot adapter fans
// out one endpoint per (verb x path) IDENTICALLY to spring-classic, instead of
// emitting a single garbled verb / dropping every path alias past the first.
// ===========================================================================

describe('spring-boot adapter — multi-verb/multi-path endpoint fan-out (Spec #4 TG6)', () => {
  it('fans out @RequestMapping(method={GET,POST}) into one endpoint per verb (no garbled verb)', () => {
    const SRC = `package x.y;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/items")
public class ItemController {
  @RequestMapping(value = "/save", method = {RequestMethod.GET, RequestMethod.POST})
  public ItemDto save(@RequestBody ItemDto dto) { return null; }
}
`;
    const cs = runPipeline(new Map([['ItemController.java', SRC]]), 'r');
    const endpoints = cs
      .filter((c) => c.candidateType === 'endpoints')
      .map((c) => c.name)
      .sort();
    expect(endpoints).toEqual(['GET /api/items/save', 'POST /api/items/save']);
    // No garbled verb / brace token leaked into any endpoint name.
    for (const n of endpoints) expect(n).not.toMatch(/REQUESTMETHOD|[{}]/);
  });

  it('fans out @GetMapping({"/a","/b"}) into one endpoint per path alias', () => {
    const SRC = `package x.y;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/items")
public class ItemAliasController {
  @GetMapping({"/a", "/b"})
  public ItemDto find() { return null; }
}
`;
    const cs = runPipeline(new Map([['ItemAliasController.java', SRC]]), 'r');
    const endpoints = cs
      .filter((c) => c.candidateType === 'endpoints')
      .map((c) => c.name)
      .sort();
    expect(endpoints).toEqual(['GET /api/items/a', 'GET /api/items/b']);
  });

  it('emits the cartesian (verb x path) product for a multi-verb + multi-path mapping', () => {
    const SRC = `package x.y;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/items")
public class ItemMatrixController {
  @RequestMapping(value = {"/a", "/b"}, method = {RequestMethod.GET, RequestMethod.PUT})
  public ItemDto handle(@RequestBody ItemDto dto) { return null; }
}
`;
    const cs = runPipeline(new Map([['ItemMatrixController.java', SRC]]), 'r');
    const endpoints = cs
      .filter((c) => c.candidateType === 'endpoints')
      .map((c) => c.name)
      .sort();
    expect(endpoints).toEqual([
      'GET /api/items/a',
      'GET /api/items/b',
      'PUT /api/items/a',
      'PUT /api/items/b',
    ]);
  });

  it('single-verb/single-path mapping still yields exactly one endpoint (no behaviour change)', () => {
    const SRC = `package x.y;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/items")
public class ItemSingleController {
  @GetMapping("/{id}")
  public ItemDto findOne(@PathVariable Long id) { return null; }
}
`;
    const cs = runPipeline(new Map([['ItemSingleController.java', SRC]]), 'r');
    const endpoints = cs.filter((c) => c.candidateType === 'endpoints');
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].name).toBe('GET /api/items/{id}');
  });
});
