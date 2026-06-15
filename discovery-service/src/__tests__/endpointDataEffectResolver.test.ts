/**
 * Tests for the Spring Classic Endpoint->Data-Effect Call Graph (Task Group 3).
 *
 * Spec: 2026-05-29 Endpoint->Data-Effect Call Graph for Discovery
 * (Java / Spring Classic first).
 *
 * Covers the three sub-systems the task group adds:
 *   - Java IR enrichment (intra-method calls + autowired field uses + stable
 *     method id) -- `extractJavaIR`.
 *   - The controller->service->repository->entity resolver +
 *     `endpoint_data_effects` candidate emission --
 *     `buildEndpointDataEffectCandidates`.
 *   - Unresolved-chain findings -- `runSpringClassicFindingScanner`.
 *
 * Focused per the discovery test conventions: real Java source through
 * `extractJavaIR`, then assert on the resolver / candidate / finding output.
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { buildEndpointDataEffectCandidates } from '../services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectCandidates';
import { resolveEndpointDataEffects } from '../services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver';
import { runSpringClassicFindingScanner } from '../services/findings/packFindingScanners/springClassicFindingScanner';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../types/candidate';

// ---------------------------------------------------------------------------
// Shared fixtures: a classic Spring Owner/Visit slice.
// ---------------------------------------------------------------------------

const OWNER_ENTITY = `
package com.foo.model;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Id;

@Entity
@Table(name = "owners")
public class Owner {
  @Id
  private Long id;
  private String lastName;
}
`;

const VISIT_ENTITY = `
package com.foo.model;
import jakarta.persistence.Entity;

@Entity
public class Visit {
  private Long id;
  private String description;
}
`;

const OWNER_REPOSITORY = `
package com.foo.repo;
import org.springframework.data.jpa.repository.JpaRepository;
import com.foo.model.Owner;

public interface OwnerRepository extends JpaRepository<Owner, Long> {
}
`;

const VISIT_REPOSITORY = `
package com.foo.repo;
import org.springframework.data.jpa.repository.JpaRepository;
import com.foo.model.Visit;

public interface VisitRepository extends JpaRepository<Visit, Long> {
}
`;

const OWNER_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.foo.repo.OwnerRepository;
import com.foo.model.Owner;

@Service
public class OwnerService {
  private final OwnerRepository ownerRepository;
  public OwnerService(OwnerRepository ownerRepository) { this.ownerRepository = ownerRepository; }

  @Transactional
  public Owner save(Owner owner) {
    return ownerRepository.save(owner);
  }

  public Owner findById(Long id) {
    return ownerRepository.findById(id);
  }
}
`;

const OWNER_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.beans.factory.annotation.Autowired;
import com.foo.service.OwnerService;
import com.foo.model.Owner;

@RestController
@RequestMapping("/owners")
public class OwnerController {
  @Autowired
  private OwnerService ownerService;

  @PostMapping
  public Owner create(@RequestBody Owner owner) {
    return ownerService.save(owner);
  }

  @GetMapping("/{id}")
  public Owner get(Long id) {
    return ownerService.findById(id);
  }
}
`;

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

// ===========================================================================
// 1. IR enrichment
// ===========================================================================

describe('Java IR enrichment (calls + autowired field uses + stable method id)', () => {
  it('stamps each method with its stable method id (FQN + signature) and captures its receiver-qualified calls', () => {
    const [service] = ir(['service/OwnerService.java', OWNER_SERVICE]);
    const cls = service.classes.find((c) => c.name === 'OwnerService')!;
    const save = cls.methods.find((m) => m.name === 'save')!;

    // Stable method id: FQN#name(ParamType).
    expect(save.methodId).toBe('com.foo.service.OwnerService#save(Owner)');

    // The call `ownerRepository.save(owner)` is captured with its receiver
    // field name (so the resolver can walk to the repository).
    expect(save.calls).toBeDefined();
    const repoCall = save.calls!.find((c) => c.methodName === 'save');
    expect(repoCall).toBeDefined();
    expect(repoCall!.receiver).toBe('ownerRepository');
  });
});

// ===========================================================================
// 2 + 4. Happy-path write resolve (3 hops) + entity via repo generic param
// ===========================================================================

describe('controller->service->repository->entity happy path (write)', () => {
  it('OwnerController.create -> OwnerService#save -> OwnerRepository<Owner,Long> yields ONE write edge with a 3-hop path', () => {
    const files = ir(
      ['web/OwnerController.java', OWNER_CONTROLLER],
      ['service/OwnerService.java', OWNER_SERVICE],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      ['model/Owner.java', OWNER_ENTITY],
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    const createEdges = cands.filter(
      (c) => dataOf(c).endpointName === 'POST /owners',
    );
    expect(createEdges).toHaveLength(1);
    const edge = createEdges[0];
    const d = dataOf(edge);

    expect(edge.candidateType).toBe('endpoint_data_effects');
    expect(d.dataEntityName).toBe('Owner');
    expect(d.access_mode).toBe('write');
    expect(d.operation_hint).toBe('insert-or-update');

    // Structured 3-hop path: controller -> service -> repository.
    const hops = d.path_metadata_json.hops as Array<Record<string, string>>;
    expect(hops.map((h) => h.role)).toEqual(['controller', 'service', 'repository']);
    expect(hops[0].method_id).toBe('com.foo.web.OwnerController#create(Owner)');
    expect(hops[1].method_id).toBe('com.foo.service.OwnerService#save(Owner)');
    expect(hops[2].class_name).toBe('OwnerRepository');
  });

  it('resolves the entity via the repository generic type param (JpaRepository<Owner,Long> -> Owner)', () => {
    const files = ir(
      ['web/OwnerController.java', OWNER_CONTROLLER],
      ['service/OwnerService.java', OWNER_SERVICE],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      // NOTE: Owner @Entity intentionally OMITTED -- entity name must still
      // resolve from the repository generic param alone.
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    const names = new Set(cands.map((c) => dataOf(c).dataEntityName));
    expect(names.has('Owner')).toBe(true);
  });
});

// ===========================================================================
// 3. Read path
// ===========================================================================

describe('read path (findBy* -> read / select)', () => {
  it('a findById repository method yields access_mode read + operation hint select', () => {
    const files = ir(
      ['web/OwnerController.java', OWNER_CONTROLLER],
      ['service/OwnerService.java', OWNER_SERVICE],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      ['model/Owner.java', OWNER_ENTITY],
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    const getEdges = cands.filter(
      (c) => dataOf(c).endpointName === 'GET /owners/{id}',
    );
    expect(getEdges).toHaveLength(1);
    const d = dataOf(getEdges[0]);
    expect(d.access_mode).toBe('read');
    expect(d.operation_hint).toBe('select');
  });
});

// ===========================================================================
// 5. Single-interface-impl resolution
// ===========================================================================

describe('single-interface-implementation resolution', () => {
  it('an interface with exactly ONE impl in the scanned set resolves through the impl', () => {
    const IFACE = `
package com.foo.service;
import com.foo.model.Owner;
public interface OwnerService {
  Owner save(Owner owner);
}
`;
    const IMPL = `
package com.foo.service;
import org.springframework.stereotype.Service;
import com.foo.repo.OwnerRepository;
import com.foo.model.Owner;
@Service
public class OwnerServiceImpl implements OwnerService {
  private final OwnerRepository ownerRepository;
  public OwnerServiceImpl(OwnerRepository ownerRepository) { this.ownerRepository = ownerRepository; }
  public Owner save(Owner owner) { return ownerRepository.save(owner); }
}
`;
    const CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import com.foo.service.OwnerService;
import com.foo.model.Owner;
@RestController
@RequestMapping("/owners")
public class OwnerController {
  private final OwnerService ownerService;
  public OwnerController(OwnerService ownerService) { this.ownerService = ownerService; }
  @PostMapping
  public Owner create(@RequestBody Owner owner) { return ownerService.save(owner); }
}
`;
    const files = ir(
      ['web/OwnerController.java', CTRL],
      ['service/OwnerService.java', IFACE],
      ['service/OwnerServiceImpl.java', IMPL],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      ['model/Owner.java', OWNER_ENTITY],
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    const edges = cands.filter((c) => dataOf(c).endpointName === 'POST /owners');
    expect(edges).toHaveLength(1);
    const d = dataOf(edges[0]);
    expect(d.dataEntityName).toBe('Owner');
    expect(d.access_mode).toBe('write');
    // The resolved service hop is the IMPL, not the interface.
    const hops = d.path_metadata_json.hops as Array<Record<string, string>>;
    expect(hops[1].class_name).toBe('OwnerServiceImpl');
  });
});

// ===========================================================================
// 6. @Transactional flag
// ===========================================================================

describe('@Transactional derivation', () => {
  it('stamps transactional: true when the resolved service method is @Transactional, false otherwise', () => {
    const files = ir(
      ['web/OwnerController.java', OWNER_CONTROLLER],
      ['service/OwnerService.java', OWNER_SERVICE],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      ['model/Owner.java', OWNER_ENTITY],
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    // save() is @Transactional -> write edge transactional.
    const write = cands.find((c) => dataOf(c).endpointName === 'POST /owners')!;
    expect(dataOf(write).transactional).toBe(true);
    expect(dataOf(write).path_metadata_json.transactional).toBe(true);
    // findById() is NOT @Transactional -> read edge not transactional.
    const read = cands.find((c) => dataOf(c).endpointName === 'GET /owners/{id}')!;
    expect(dataOf(read).transactional).toBe(false);
  });
});

// ===========================================================================
// 7. One edge per (endpoint, data-entity)
// ===========================================================================

describe('one edge per (endpoint, data-entity) pair', () => {
  it('an endpoint touching Owner AND Visit emits TWO edges', () => {
    const MULTI_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import com.foo.repo.OwnerRepository;
import com.foo.repo.VisitRepository;
import com.foo.model.Owner;
import com.foo.model.Visit;
@Service
public class RegistrationService {
  private final OwnerRepository ownerRepository;
  private final VisitRepository visitRepository;
  public RegistrationService(OwnerRepository o, VisitRepository v) { this.ownerRepository = o; this.visitRepository = v; }
  public Owner register(Owner owner) {
    Owner saved = ownerRepository.save(owner);
    visitRepository.findById(1L);
    return saved;
  }
}
`;
    const MULTI_CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import com.foo.service.RegistrationService;
import com.foo.model.Owner;
@RestController
@RequestMapping("/registrations")
public class RegistrationController {
  private final RegistrationService registrationService;
  public RegistrationController(RegistrationService s) { this.registrationService = s; }
  @PostMapping
  public Owner register(@RequestBody Owner owner) { return registrationService.register(owner); }
}
`;
    const files = ir(
      ['web/RegistrationController.java', MULTI_CTRL],
      ['service/RegistrationService.java', MULTI_SERVICE],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      ['repo/VisitRepository.java', VISIT_REPOSITORY],
      ['model/Owner.java', OWNER_ENTITY],
      ['model/Visit.java', VISIT_ENTITY],
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    const edges = cands.filter(
      (c) => dataOf(c).endpointName === 'POST /registrations',
    );
    expect(edges).toHaveLength(2);
    const byEntity = new Map(edges.map((e) => [dataOf(e).dataEntityName, dataOf(e)]));
    expect(byEntity.get('Owner')!.access_mode).toBe('write');
    expect(byEntity.get('Visit')!.access_mode).toBe('read');
  });
});

// ===========================================================================
// 8. Unresolved chain -> finding, NO fabricated edge
// ===========================================================================

describe('unresolved chain -> finding (no silent drop, no fabricated edge)', () => {
  it('a JdbcTemplate-backed service emits a finding and NO edge candidate', () => {
    const JDBC_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.jdbc.core.JdbcTemplate;
import com.foo.model.Owner;
@Service
public class LegacyOwnerService {
  private final JdbcTemplate jdbcTemplate;
  public LegacyOwnerService(JdbcTemplate jdbcTemplate) { this.jdbcTemplate = jdbcTemplate; }
  public Owner load(Long id) {
    return jdbcTemplate.queryForObject("SELECT * FROM owners WHERE id = ?", null, id);
  }
}
`;
    const JDBC_CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import com.foo.service.LegacyOwnerService;
import com.foo.model.Owner;
@RestController
@RequestMapping("/legacy")
public class LegacyOwnerController {
  private final LegacyOwnerService legacyOwnerService;
  public LegacyOwnerController(LegacyOwnerService s) { this.legacyOwnerService = s; }
  @GetMapping("/{id}")
  public Owner load(Long id) { return legacyOwnerService.load(id); }
}
`;
    const files = ir(
      ['web/LegacyOwnerController.java', JDBC_CTRL],
      ['service/LegacyOwnerService.java', JDBC_SERVICE],
      ['model/Owner.java', OWNER_ENTITY],
    );

    // No edge candidate is fabricated.
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    expect(cands.filter((c) => dataOf(c).endpointName === 'GET /legacy/{id}')).toHaveLength(0);

    // The resolver reports it as unresolved with the jdbc_template reason.
    const { resolved, unresolved } = resolveEndpointDataEffects(files);
    expect(resolved).toHaveLength(0);
    expect(unresolved.some((u) => u.reason === 'jdbc_template')).toBe(true);

    // The finding scanner emits an actionable finding carrying the endpoint id.
    const irMap = new Map(files.map((f) => [f.filePath, f]));
    const findings = runSpringClassicFindingScanner({
      runId: 'r1',
      irFiles: irMap,
      packCandidates: [],
    });
    const edeFinding = findings.find(
      (f) => f.findingType === 'endpoint_data_effect_unresolved',
    );
    expect(edeFinding).toBeDefined();
    expect(edeFinding!.title).toContain('GET /legacy/{id}');
    expect((edeFinding!.detailJson as Record<string, any>).reason).toBe('jdbc_template');
  });

  it('a service interface with TWO implementations emits a multiple_impls finding and NO edge', () => {
    const IFACE = `
package com.foo.service;
import com.foo.model.Owner;
public interface OwnerService { Owner save(Owner owner); }
`;
    const IMPL_A = `
package com.foo.service;
import org.springframework.stereotype.Service;
import com.foo.model.Owner;
@Service
public class OwnerServiceImpl implements OwnerService { public Owner save(Owner o) { return o; } }
`;
    const IMPL_B = `
package com.foo.service;
import org.springframework.stereotype.Service;
import com.foo.model.Owner;
@Service
public class CachingOwnerService implements OwnerService { public Owner save(Owner o) { return o; } }
`;
    const CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import com.foo.service.OwnerService;
import com.foo.model.Owner;
@RestController
@RequestMapping("/owners")
public class OwnerController {
  private final OwnerService ownerService;
  public OwnerController(OwnerService s) { this.ownerService = s; }
  @PostMapping
  public Owner create(@RequestBody Owner owner) { return ownerService.save(owner); }
}
`;
    const files = ir(
      ['web/OwnerController.java', CTRL],
      ['service/OwnerService.java', IFACE],
      ['service/OwnerServiceImpl.java', IMPL_A],
      ['service/CachingOwnerService.java', IMPL_B],
      ['model/Owner.java', OWNER_ENTITY],
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    expect(cands).toHaveLength(0);

    const { unresolved } = resolveEndpointDataEffects(files);
    expect(unresolved.some((u) => u.reason === 'multiple_impls')).toBe(true);
  });
});

// ===========================================================================
// 9. Low-confidence-but-resolved -> normal candidate w/ LOW confidence
// ===========================================================================

describe('low-confidence-but-resolved -> normal candidate carrying LOW confidence', () => {
  it('a name-prefix-only repository resolution emits a NORMAL edge candidate with low confidence (not a finding)', () => {
    // OwnerRepository is NOT in the scanned set (no interface file) but the
    // controller calls a field typed `OwnerRepository`. The resolver falls back
    // to the `<Name>Repository` -> `Owner` name heuristic and stamps a LOW
    // confidence so the edge stays in the normal candidate stream.
    const THIN_CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import com.foo.repo.OwnerRepository;
import com.foo.model.Owner;
@RestController
@RequestMapping("/owners")
public class OwnerController {
  private final OwnerRepository ownerRepository;
  public OwnerController(OwnerRepository r) { this.ownerRepository = r; }
  @PostMapping
  public Owner create(@RequestBody Owner owner) { return ownerRepository.save(owner); }
}
`;
    const files = ir(['web/OwnerController.java', THIN_CTRL]);
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    const edges = cands.filter((c) => dataOf(c).endpointName === 'POST /owners');
    expect(edges).toHaveLength(1);
    const edge = edges[0];
    expect(dataOf(edge).dataEntityName).toBe('Owner');
    // LOW confidence, below the 0.75 auto-accept threshold, but STILL a normal
    // candidate (three-outcome model: low-but-resolved, not a finding).
    expect(edge.confidence).toBeLessThan(0.75);
    expect(edge.candidateType).toBe('endpoint_data_effects');

    // And NOT surfaced as a finding.
    const irMap = new Map(files.map((f) => [f.filePath, f]));
    const findings = runSpringClassicFindingScanner({
      runId: 'r1',
      irFiles: irMap,
      packCandidates: [],
    });
    expect(
      findings.filter((f) => f.findingType === 'endpoint_data_effect_unresolved'),
    ).toHaveLength(0);
  });
});

// ===========================================================================
// 10. Same-class private-helper inlining (2026-05-29 hardening)
//
// The classic PetClinic `VetController` shape: each @GetMapping method delegates
// the actual service call to a private same-class `getVets()` helper, which
// calls `this.clinicService.findVets()` (a Vet read). The pre-fix walk skipped
// the receiver-null/`this` helper call and produced NEITHER an edge NOR a
// finding (a silent drop). The walk must now follow same-class helpers and
// resolve the data effect through them.
// ===========================================================================

describe('same-class private-helper inlining (getVets() pattern)', () => {
  const VET_ENTITY = `
package com.foo.model;
import jakarta.persistence.Entity;
@Entity
public class Vet {
  private Long id;
  private String lastName;
}
`;
  const CLINIC_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.foo.repo.VetRepository;
import com.foo.model.Vet;
import java.util.Collection;
@Service
public class ClinicServiceImpl implements ClinicService {
  private final VetRepository vetRepository;
  public ClinicServiceImpl(VetRepository vetRepository) { this.vetRepository = vetRepository; }
  @Transactional(readOnly = true)
  public Collection<Vet> findVets() {
    return vetRepository.findAll();
  }
}
`;
  const CLINIC_SERVICE_IFACE = `
package com.foo.service;
import com.foo.model.Vet;
import java.util.Collection;
public interface ClinicService {
  Collection<Vet> findVets();
}
`;
  const VET_REPOSITORY = `
package com.foo.repo;
import org.springframework.data.jpa.repository.JpaRepository;
import com.foo.model.Vet;
public interface VetRepository extends JpaRepository<Vet, Integer> {
}
`;
  // Mirrors spring-framework-petclinic VetController: 3 mapping methods, each
  // delegating to a private same-class getVets() that calls clinicService.
  const VET_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ResponseBody;
import org.springframework.beans.factory.annotation.Autowired;
import com.foo.service.ClinicService;
import com.foo.model.Vet;
import com.foo.model.Vets;

@Controller
public class VetController {
  private final ClinicService clinicService;

  @Autowired
  public VetController(ClinicService clinicService) { this.clinicService = clinicService; }

  @GetMapping("/vets")
  public String showVetList(java.util.Map<String, Object> model) {
    // un-qualified same-class helper call (receiver = null)
    Vets vets = getVets();
    model.put("vets", vets);
    return "vets/vetList";
  }

  @GetMapping(value = "/vets.json", produces = "application/json")
  public @ResponseBody Vets showResourcesVetList() {
    // un-qualified same-class helper call (receiver = null)
    return getVets();
  }

  @GetMapping(value = "/vets.xml", produces = "application/xml")
  public @ResponseBody Vets showVetListXml() {
    // qualified same-class helper call (receiver = "this")
    return this.getVets();
  }

  private Vets getVets() {
    Vets vets = new Vets();
    vets.getVetList().addAll(this.clinicService.findVets());
    return vets;
  }
}
`;
  const VETS_WRAPPER = `
package com.foo.model;
import java.util.ArrayList;
import java.util.List;
public class Vets {
  private List<Vet> vets;
  public List<Vet> getVetList() {
    if (vets == null) { vets = new ArrayList<>(); }
    return vets;
  }
}
`;

  it('resolves controller -> private getVets() helper -> clinicService.findVets() -> Vet read for all three /vets* endpoints', () => {
    const files = ir(
      ['web/VetController.java', VET_CONTROLLER],
      ['service/ClinicService.java', CLINIC_SERVICE_IFACE],
      ['service/ClinicServiceImpl.java', CLINIC_SERVICE],
      ['repo/VetRepository.java', VET_REPOSITORY],
      ['model/Vet.java', VET_ENTITY],
      ['model/Vets.java', VETS_WRAPPER],
    );

    const cands = buildEndpointDataEffectCandidates(files, 'r1');

    // All three idiomatic endpoints resolve to a single Vet READ edge.
    for (const ep of ['GET /vets', 'GET /vets.json', 'GET /vets.xml']) {
      const edges = cands.filter((c) => dataOf(c).endpointName === ep);
      expect(edges).toHaveLength(1);
      const d = dataOf(edges[0]);
      expect(d.dataEntityName).toBe('Vet');
      expect(d.access_mode).toBe('read');
      expect(d.operation_hint).toBe('select');

      // The persisted path stays controller -> service -> repository; the
      // private helper is transparent (adds NO hop). The controller hop is the
      // ACTUAL mapping method, not the helper.
      const hops = d.path_metadata_json.hops as Array<Record<string, string>>;
      expect(hops.map((h) => h.role)).toEqual(['controller', 'service', 'repository']);
      expect(hops[0].method_name).toBe(
        ep === 'GET /vets'
          ? 'showVetList'
          : ep === 'GET /vets.json'
            ? 'showResourcesVetList'
            : 'showVetListXml',
      );
      expect(hops[1].class_name).toBe('ClinicServiceImpl');
      expect(hops[1].method_name).toBe('findVets');
      expect(hops[2].class_name).toBe('VetRepository');
    }

    // No false drops AND no false findings for these resolved endpoints.
    const irMap = new Map(files.map((f) => [f.filePath, f]));
    const findings = runSpringClassicFindingScanner({
      runId: 'r1',
      irFiles: irMap,
      packCandidates: [],
    });
    const vetFindings = findings.filter(
      (f) =>
        f.findingType === 'endpoint_data_effect_unresolved' &&
        String((f.detailJson as Record<string, any>).endpoint).startsWith('GET /vets'),
    );
    expect(vetFindings).toHaveLength(0);
  });

  it('still resolves precisely when the helper hides a WRITE through the service (no precision loss)', () => {
    const HELPER_WRITE_CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import com.foo.service.OwnerService;
import com.foo.model.Owner;
@RestController
@RequestMapping("/owners")
public class OwnerController {
  private final OwnerService ownerService;
  public OwnerController(OwnerService s) { this.ownerService = s; }

  @PostMapping
  public Owner create(@RequestBody Owner owner) {
    return persist(owner);
  }

  private Owner persist(Owner owner) {
    return ownerService.save(owner);
  }
}
`;
    const files = ir(
      ['web/OwnerController.java', HELPER_WRITE_CTRL],
      ['service/OwnerService.java', OWNER_SERVICE],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      ['model/Owner.java', OWNER_ENTITY],
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    const edges = cands.filter((c) => dataOf(c).endpointName === 'POST /owners');
    expect(edges).toHaveLength(1);
    const d = dataOf(edges[0]);
    expect(d.dataEntityName).toBe('Owner');
    expect(d.access_mode).toBe('write');
    expect(d.transactional).toBe(true); // OwnerService#save is @Transactional
    const hops = d.path_metadata_json.hops as Array<Record<string, string>>;
    expect(hops.map((h) => h.role)).toEqual(['controller', 'service', 'repository']);
    expect(hops[0].method_name).toBe('create'); // mapping method, not the helper
  });
});

// ===========================================================================
// 11. No silent drops: an unfollowable data-access call surfaces a finding
//
// After the deeper (helper-inclusive) walk, a mapping method that made a
// collaborator/helper call but resolved ZERO edges must emit an
// `endpoint_data_effect_unresolved` finding (reason `unfollowable_call`) rather
// than producing nothing.
// ===========================================================================

describe('no silent drops -> unfollowable_call finding (helper-inlining walk)', () => {
  it('a same-class helper whose service method is not in scope produces NO edge and an unfollowable_call finding', () => {
    // The controller delegates to a private helper that calls a method on an
    // autowired service whose declaration is NOT in the scanned set (inherited /
    // dynamic). No entity can be resolved -> zero edges -> must be a finding,
    // never silence.
    const SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
@Service
public class ReportService {
  // NOTE: no generateReport(...) method declared here -> unresolvable target.
}
`;
    const CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import com.foo.service.ReportService;
@RestController
@RequestMapping("/reports")
public class ReportController {
  private final ReportService reportService;
  public ReportController(ReportService s) { this.reportService = s; }

  @GetMapping("/{id}")
  public String report(Long id) {
    return build(id);
  }

  private String build(Long id) {
    // calls a service method that does not exist in the scanned set
    return reportService.generateReport(id);
  }
}
`;
    const files = ir(
      ['web/ReportController.java', CTRL],
      ['service/ReportService.java', SERVICE],
    );

    // No fabricated edge candidate.
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    expect(cands.filter((c) => dataOf(c).endpointName === 'GET /reports/{id}')).toHaveLength(0);

    // The resolver reports it as unresolved (not silence). The helper-hidden
    // service call is followed; the missing method yields a finding.
    const { resolved, unresolved } = resolveEndpointDataEffects(files);
    expect(resolved).toHaveLength(0);
    expect(unresolved.length).toBeGreaterThan(0);
    expect(unresolved.every((u) => u.endpointName === 'GET /reports/{id}')).toBe(true);

    // The finding scanner surfaces an actionable finding carrying the endpoint id.
    const irMap = new Map(files.map((f) => [f.filePath, f]));
    const findings = runSpringClassicFindingScanner({
      runId: 'r1',
      irFiles: irMap,
      packCandidates: [],
    });
    const edeFinding = findings.find(
      (f) => f.findingType === 'endpoint_data_effect_unresolved',
    );
    expect(edeFinding).toBeDefined();
    expect(edeFinding!.title).toContain('GET /reports/{id}');
  });

  it('a mapping method calling a non-resolvable (chained) receiver on a collaborator produces NO edge and a finding', () => {
    // The controller calls `clinicService.findVets().stream()` style chains where
    // the ACTUAL data-access receiver is a chained expression the resolver will
    // not trust as a simple receiver. The direct `clinicService.findFoo()` call
    // resolves to a service with no matching method -> zero edges -> finding.
    const SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
@Service
public class ClinicServiceImpl {
  // intentionally no findVets() method in scope
}
`;
    const CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import com.foo.service.ClinicServiceImpl;
@RestController
@RequestMapping("/vets")
public class VetRestController {
  private final ClinicServiceImpl clinicService;
  public VetRestController(ClinicServiceImpl s) { this.clinicService = s; }
  @GetMapping("")
  public String list() {
    return clinicService.findVets().toString();
  }
}
`;
    const files = ir(
      ['web/VetRestController.java', CTRL],
      ['service/ClinicServiceImpl.java', SERVICE],
    );
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    expect(cands.filter((c) => dataOf(c).endpointName === 'GET /vets')).toHaveLength(0);

    const { resolved, unresolved } = resolveEndpointDataEffects(files);
    expect(resolved).toHaveLength(0);
    expect(unresolved.some((u) => u.endpointName === 'GET /vets')).toBe(true);
  });

  it('does NOT emit a finding for an endpoint that genuinely touches no data (no collaborator call)', () => {
    // A pure view-rendering endpoint that calls only the Model and returns a
    // template name makes NO collaborator/helper call. It must produce neither
    // an edge nor a finding -- the catch-all must not introduce noise.
    const CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.ui.Model;
@Controller
public class WelcomeController {
  @GetMapping("/welcome")
  public String welcome(Model model) {
    model.addAttribute("message", "hello");
    return "welcome";
  }
}
`;
    const files = ir(['web/WelcomeController.java', CTRL]);
    const cands = buildEndpointDataEffectCandidates(files, 'r1');
    expect(cands.filter((c) => dataOf(c).endpointName === 'GET /welcome')).toHaveLength(0);

    const { resolved, unresolved } = resolveEndpointDataEffects(files);
    expect(resolved).toHaveLength(0);
    expect(unresolved).toHaveLength(0);

    const irMap = new Map(files.map((f) => [f.filePath, f]));
    const findings = runSpringClassicFindingScanner({
      runId: 'r1',
      irFiles: irMap,
      packCandidates: [],
    });
    expect(
      findings.filter((f) => f.findingType === 'endpoint_data_effect_unresolved'),
    ).toHaveLength(0);
  });
});


// ===========================================================================
// Spec #4 Task Group 6 -- close TODO(oracle-W1): the data-effect resolver fans
// out its edges/findings across EVERY (verb x path) variant a multi-verb /
// multi-path mapping declares, aligning Spec #1's edges with W1's fanned-out
// endpoint set. Single-mapping common case is unchanged.
// ===========================================================================

describe('endpointDataEffectResolver multi-verb/multi-path fan-out (Spec #4 TG6)', () => {
  it('attaches resolved edges to EVERY verb of a @RequestMapping(method={GET,POST})', () => {
    const CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.beans.factory.annotation.Autowired;
import com.foo.service.OwnerService;
import com.foo.model.Owner;

@RestController
@RequestMapping("/owners")
public class OwnerSaveController {
  @Autowired
  private OwnerService ownerService;

  @RequestMapping(value = "/save", method = {RequestMethod.GET, RequestMethod.POST})
  public Owner save(@RequestBody Owner owner) {
    return ownerService.save(owner);
  }
}
`;
    const files = ir(
      ['web/OwnerSaveController.java', CTRL],
      ['service/OwnerService.java', OWNER_SERVICE],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      ['model/Owner.java', OWNER_ENTITY],
    );
    const { resolved } = resolveEndpointDataEffects(files);
    const names = resolved.map((r) => r.endpointName).sort();
    // ONE edge per (verb x path) variant -- both GET and POST, neither garbled.
    expect(names).toEqual(['GET /owners/save', 'POST /owners/save']);
    for (const r of resolved) {
      expect(r.dataEntityName).toBe('Owner');
      expect(r.accessMode).toBe('write');
      // No garbled verb token leaked into the name.
      expect(r.endpointName).not.toMatch(/REQUESTMETHOD|[{}]/);
    }
  });

  it('attaches resolved edges to EVERY path alias of a @GetMapping({"/a","/b"})', () => {
    const CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.beans.factory.annotation.Autowired;
import com.foo.service.OwnerService;
import com.foo.model.Owner;

@RestController
@RequestMapping("/owners")
public class OwnerAliasController {
  @Autowired
  private OwnerService ownerService;

  @GetMapping({"/a", "/b"})
  public Owner find() {
    return ownerService.findById(1L);
  }
}
`;
    const files = ir(
      ['web/OwnerAliasController.java', CTRL],
      ['service/OwnerService.java', OWNER_SERVICE],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      ['model/Owner.java', OWNER_ENTITY],
    );
    const { resolved } = resolveEndpointDataEffects(files);
    const names = resolved.map((r) => r.endpointName).sort();
    // ONE edge per path alias -- the second alias is no longer silently dropped.
    expect(names).toEqual(['GET /owners/a', 'GET /owners/b']);
    for (const r of resolved) {
      expect(r.dataEntityName).toBe('Owner');
      expect(r.accessMode).toBe('read');
    }
  });

  it('fans an UNRESOLVED chain out to every (verb x path) variant too', () => {
    // A JdbcTemplate escape is unresolvable; with a 2-verb mapping the finding
    // must surface for BOTH verbs (one per variant), never just the first.
    const CTRL = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.beans.factory.annotation.Autowired;

@RestController
@RequestMapping("/raw")
public class RawJdbcController {
  @Autowired
  private JdbcTemplate jdbcTemplate;

  @RequestMapping(value = "/q", method = {RequestMethod.GET, RequestMethod.DELETE})
  public Object run() {
    return jdbcTemplate.queryForObject("SELECT 1", Integer.class);
  }
}
`;
    const files = ir(['web/RawJdbcController.java', CTRL]);
    const { unresolved } = resolveEndpointDataEffects(files);
    const names = unresolved.map((u) => u.endpointName).sort();
    expect(names).toEqual(['DELETE /raw/q', 'GET /raw/q']);
    for (const u of unresolved) {
      expect(u.reason).toBe('jdbc_template');
    }
  });

  it('single-verb/single-path mapping still yields exactly one edge (no behaviour change)', () => {
    const files = ir(
      ['web/OwnerController.java', OWNER_CONTROLLER],
      ['service/OwnerService.java', OWNER_SERVICE],
      ['repo/OwnerRepository.java', OWNER_REPOSITORY],
      ['model/Owner.java', OWNER_ENTITY],
    );
    const { resolved } = resolveEndpointDataEffects(files);
    const createEdges = resolved.filter((r) => r.endpointName === 'POST /owners');
    expect(createEdges).toHaveLength(1);
    const getEdges = resolved.filter((r) => r.endpointName === 'GET /owners/{id}');
    expect(getEdges).toHaveLength(1);
  });
});
