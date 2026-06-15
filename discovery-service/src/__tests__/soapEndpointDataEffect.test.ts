/**
 * Tests for SOAP operation -> DB data-effect (Spec 4, Task Group 5).
 *
 * Spec: 2026-05-30 SOAP/WSDL message-field depth, Group 5.
 *
 * The GOAL of Group 5 is to give SOAP operations the SAME operation->DB
 * data-effect chain Spec 1 built for REST -- REUSING Spec 1's
 * `endpointDataEffectResolver` downstream walk verbatim; the ONLY new part is
 * detecting the SOAP entry-point. These offline tests cover exactly that:
 *
 *   1. A Spring-WS `@Endpoint`/`@PayloadRoot` handler is detected as an
 *      entry-point.
 *   2. A JAX-WS `@WebMethod` handler is detected as an entry-point.
 *   3. The detected entry-point feeds the reused resolver and yields an
 *      `endpoint_data_effects` candidate with the IDENTICAL Spec 1 shape
 *      (`access_mode`, `path_metadata_json` ordered call chain, operation hint,
 *      `transactional`).
 *   4. An unresolvable chain becomes a Finding -- NOT a fabricated edge.
 *
 * Pure / offline: real Java source through `extractJavaIR`, then assert on the
 * detector / resolver / emitter output. No I/O, no LLM.
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import {
  detectSoapEntryPoints,
  resolveSoapOperationDataEffects,
} from '../services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectResolver';
import { emitSoapDataEffects } from '../services/findings/packFindingScanners/springClassicSoap/soapDataEffectEmitter';
import { buildEndpointDataEffectCandidates } from '../services/extensionPacks/frameworkAdapters/springClassic/endpointDataEffectCandidates';
import { scanSpringWsSources } from '../services/findings/packFindingScanners/springClassicSoap/springWsScanner';
import { scanJaxWsSources } from '../services/findings/packFindingScanners/springClassicSoap/jaxWsScanner';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';
import type { DiscoveryCandidate } from '../types/candidate';

// ---------------------------------------------------------------------------
// Shared fixtures: a Country domain slice (entity + repo + service) plus
// SOAP handlers (Spring-WS + JAX-WS) and a matching REST controller (for the
// "identical shape" comparison).
// ---------------------------------------------------------------------------

const COUNTRY_ENTITY = `
package com.foo.model;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Id;

@Entity
@Table(name = "countries")
public class Country {
  @Id
  private Long id;
  private String name;
}
`;

const COUNTRY_REPOSITORY = `
package com.foo.repo;
import org.springframework.data.jpa.repository.JpaRepository;
import com.foo.model.Country;

public interface CountryRepository extends JpaRepository<Country, Long> {
}
`;

const COUNTRY_SERVICE = `
package com.foo.service;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.foo.repo.CountryRepository;
import com.foo.model.Country;

@Service
public class CountryService {
  private final CountryRepository countryRepository;
  public CountryService(CountryRepository countryRepository) { this.countryRepository = countryRepository; }

  @Transactional
  public Country save(Country country) {
    return countryRepository.save(country);
  }

  public Country findByName(String name) {
    return countryRepository.findByName(name);
  }
}
`;

// Spring-WS: @Endpoint class + @PayloadRoot handler. A WRITE operation
// (save) so we exercise access_mode=write + operation_hint + transactional.
const SPRING_WS_ENDPOINT = `
package com.foo.ws;
import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.PayloadRoot;
import org.springframework.ws.server.endpoint.annotation.RequestPayload;
import org.springframework.ws.server.endpoint.annotation.ResponsePayload;
import org.springframework.beans.factory.annotation.Autowired;
import com.foo.service.CountryService;

@Endpoint
public class CountryEndpoint {
  @Autowired
  private CountryService countryService;

  @PayloadRoot(namespace = "http://foo/countries", localPart = "addCountryRequest")
  @ResponsePayload
  public AddCountryResponse addCountry(@RequestPayload AddCountryRequest request) {
    return countryService.save(request.getCountry());
  }
}
`;

// JAX-WS: @WebService class + @WebMethod handler. A READ operation (findByName)
// so we exercise access_mode=read + operation_hint=select.
const JAX_WS_SERVICE = `
package com.foo.jaxws;
import javax.jws.WebService;
import javax.jws.WebMethod;
import org.springframework.beans.factory.annotation.Autowired;
import com.foo.service.CountryService;

@WebService(name = "CountryPort", targetNamespace = "http://foo/countries")
public class CountrySoapService {
  @Autowired
  private CountryService countryService;

  @WebMethod
  public Country getByName(String name) {
    return countryService.findByName(name);
  }
}
`;

// Equivalent REST controller -- the Spec 1 happy path -- used to prove the
// SOAP-emitted `endpoint_data_effects` candidate `data` shape is identical.
const COUNTRY_CONTROLLER = `
package com.foo.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.beans.factory.annotation.Autowired;
import com.foo.service.CountryService;
import com.foo.model.Country;

@RestController
@RequestMapping("/countries")
public class CountryController {
  @Autowired
  private CountryService countryService;

  @PostMapping
  public Country create(@RequestBody Country country) {
    return countryService.save(country);
  }
}
`;

// A SOAP handler that talks straight to a JdbcTemplate -- the touched table
// cannot be statically resolved, so the chain is UNRESOLVED (-> Finding).
const SPRING_WS_JDBC_ENDPOINT = `
package com.foo.ws;
import org.springframework.ws.server.endpoint.annotation.Endpoint;
import org.springframework.ws.server.endpoint.annotation.PayloadRoot;
import org.springframework.ws.server.endpoint.annotation.RequestPayload;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

@Endpoint
public class ReportEndpoint {
  @Autowired
  private JdbcTemplate jdbcTemplate;

  @PayloadRoot(namespace = "http://foo/reports", localPart = "getReportRequest")
  public GetReportResponse getReport(@RequestPayload GetReportRequest request) {
    jdbcTemplate.queryForList("SELECT * FROM legacy_report");
    return new GetReportResponse();
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

function sources(...srcs: Array<[string, string]>): { path: string; content: string }[] {
  return srcs.map(([path, content]) => ({ path, content }));
}

// ===========================================================================
// 1. SOAP entry-point DETECTION (the only new logic)
// ===========================================================================

describe('SOAP entry-point detection', () => {
  it('detects a Spring-WS @Endpoint/@PayloadRoot handler as a data-effect entry-point', () => {
    const files = ir(['ws/CountryEndpoint.java', SPRING_WS_ENDPOINT]);
    const entries = detectSoapEntryPoints(files);

    expect(entries).toHaveLength(1);
    expect(entries[0].entry.cls.name).toBe('CountryEndpoint');
    expect(entries[0].method.name).toBe('addCountry');
    expect(entries[0].defaultEndpointName).toBe('addCountry');
  });

  it('detects a JAX-WS @WebService/@WebMethod handler as a data-effect entry-point', () => {
    const files = ir(['jaxws/CountrySoapService.java', JAX_WS_SERVICE]);
    const entries = detectSoapEntryPoints(files);

    expect(entries).toHaveLength(1);
    expect(entries[0].entry.cls.name).toBe('CountrySoapService');
    expect(entries[0].method.name).toBe('getByName');
  });

  it('does NOT treat a plain @Service (non-SOAP) class as a SOAP entry-point', () => {
    const files = ir(['service/CountryService.java', COUNTRY_SERVICE]);
    expect(detectSoapEntryPoints(files)).toHaveLength(0);
  });
});

// ===========================================================================
// 2. Entry-point feeds the REUSED resolver -> resolved edge (Spring-WS write)
// ===========================================================================

describe('SOAP operation -> data-effect resolution (reuses Spec 1 walk)', () => {
  it('walks a Spring-WS handler -> service -> repository -> entity (write, transactional)', () => {
    const files = ir(
      ['model/Country.java', COUNTRY_ENTITY],
      ['repo/CountryRepository.java', COUNTRY_REPOSITORY],
      ['service/CountryService.java', COUNTRY_SERVICE],
      ['ws/CountryEndpoint.java', SPRING_WS_ENDPOINT],
    );

    const { resolved, unresolved } = resolveSoapOperationDataEffects(files);

    expect(unresolved).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    const edge = resolved[0];
    // endpointName is the SOAP OPERATION name (handler method), not a REST path.
    expect(edge.endpointName).toBe('addCountry');
    expect(edge.dataEntityName).toBe('Country');
    expect(edge.accessMode).toBe('write');
    expect(edge.operationHint).toBe('insert-or-update'); // save -> insert-or-update
    expect(edge.transactional).toBe(true);
    // Reused 3-hop happy path: handler(controller) -> service -> repository.
    expect(edge.path.map((h) => h.role)).toEqual(['controller', 'service', 'repository']);
    expect(edge.path[0].className).toBe('CountryEndpoint');
    expect(edge.path[1].className).toBe('CountryService');
    expect(edge.path[2].className).toBe('CountryRepository');
  });

  it('walks a JAX-WS handler -> service -> repository -> entity (read, select)', () => {
    const files = ir(
      ['model/Country.java', COUNTRY_ENTITY],
      ['repo/CountryRepository.java', COUNTRY_REPOSITORY],
      ['service/CountryService.java', COUNTRY_SERVICE],
      ['jaxws/CountrySoapService.java', JAX_WS_SERVICE],
    );

    const { resolved, unresolved } = resolveSoapOperationDataEffects(files);

    expect(unresolved).toHaveLength(0);
    expect(resolved).toHaveLength(1);
    const edge = resolved[0];
    expect(edge.endpointName).toBe('getByName');
    expect(edge.dataEntityName).toBe('Country');
    expect(edge.accessMode).toBe('read');
    expect(edge.operationHint).toBe('select');
  });
});

// ===========================================================================
// 3. Emitter -> `endpoint_data_effects` candidate with IDENTICAL Spec 1 shape
// ===========================================================================

describe('SOAP endpoint_data_effects candidate shape (identical to Spec 1 REST)', () => {
  it('emits a candidate whose data shape matches the REST builder field-for-field', () => {
    const soapFiles = ir(
      ['model/Country.java', COUNTRY_ENTITY],
      ['repo/CountryRepository.java', COUNTRY_REPOSITORY],
      ['service/CountryService.java', COUNTRY_SERVICE],
      ['ws/CountryEndpoint.java', SPRING_WS_ENDPOINT],
    );
    const springWs = scanSpringWsSources(sources(['ws/CountryEndpoint.java', SPRING_WS_ENDPOINT]));

    const { candidates, findings } = emitSoapDataEffects({
      files: soapFiles,
      springWs,
      jaxWs: [],
      runId: 'run-soap',
    });

    expect(findings).toHaveLength(0);
    expect(candidates).toHaveLength(1);
    const soapCand = candidates[0];
    expect(soapCand.candidateType).toBe('endpoint_data_effects');
    expect(soapCand.runId).toBe('run-soap');

    const d = dataOf(soapCand);
    // --- the IDENTICAL Spec 1 shape ---
    expect(d.access_mode).toBe('write');
    expect(d.operation_hint).toBe('insert-or-update');
    expect(d.transactional).toBe(true);
    expect(d.relationshipType).toBe('uses_data');
    expect(d.usesData).toEqual({ accessType: 'write', dataIdentifier: 'Country' });
    // path_metadata_json: ordered call chain with FQN+signature per hop + hint.
    expect(d.path_metadata_json.operation_hint).toBe('insert-or-update');
    expect(d.path_metadata_json.transactional).toBe(true);
    expect(d.path_metadata_json.hops.map((h: any) => h.role)).toEqual([
      'controller',
      'service',
      'repository',
    ]);
    expect(d.path_metadata_json.hops[1].method_id).toBe('com.foo.service.CountryService#save(Country)');

    // Prove the `data` KEY SET + the load-bearing save-back fields are identical
    // to what the REST builder emits for the equivalent endpoint.
    const restCands = buildEndpointDataEffectCandidates(
      ir(
        ['model/Country.java', COUNTRY_ENTITY],
        ['repo/CountryRepository.java', COUNTRY_REPOSITORY],
        ['service/CountryService.java', COUNTRY_SERVICE],
        ['web/CountryController.java', COUNTRY_CONTROLLER],
      ),
      'run-rest',
    );
    expect(restCands).toHaveLength(1);
    const restData = dataOf(restCands[0]);

    // Same key set (minus `_addedBy`, which legitimately differs by producer).
    const keysOf = (o: Record<string, any>) =>
      Object.keys(o).filter((k) => k !== '_addedBy').sort();
    expect(keysOf(d)).toEqual(keysOf(restData));

    // Same save-back resolution + headline fields (only endpointName +
    // dataEntityName differ by domain; the SHAPE is identical).
    expect(d.access_mode).toBe(restData.access_mode);
    expect(d.operation_hint).toBe(restData.operation_hint);
    expect(d.transactional).toBe(restData.transactional);
    expect(d.relationshipType).toBe(restData.relationshipType);
    expect(typeof d.endpointName).toBe(typeof restData.endpointName);
    expect(Object.keys(d.path_metadata_json).sort()).toEqual(
      Object.keys(restData.path_metadata_json).sort(),
    );
  });
});

// ===========================================================================
// 4. Unresolvable chain -> Finding (NOT a fabricated edge)
// ===========================================================================

describe('SOAP unresolved data chain -> Finding (never a fabricated edge)', () => {
  it('emits an endpoint_data_effect_unresolved Finding and ZERO edges for a JdbcTemplate chain', () => {
    const files = ir(['ws/ReportEndpoint.java', SPRING_WS_JDBC_ENDPOINT]);
    const springWs = scanSpringWsSources(sources(['ws/ReportEndpoint.java', SPRING_WS_JDBC_ENDPOINT]));

    const { candidates, findings } = emitSoapDataEffects({
      files,
      springWs,
      jaxWs: [],
      runId: 'run-soap',
    });

    // No fabricated edge.
    expect(candidates).toHaveLength(0);
    // Exactly one unresolved-chain Finding, carrying the SOAP operation identity.
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.findingType).toBe('endpoint_data_effect_unresolved');
    expect(f.severity).toBe('medium');
    expect(f.title).toContain('getReport');
    expect((f.detailJson as any).reason).toBe('jdbc_template');
    expect((f.detailJson as any).protocol).toBe('SOAP');
  });
});
