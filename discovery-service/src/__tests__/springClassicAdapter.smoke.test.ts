/**
 * Smoke tests for the spring-classic framework adapter.
 *
 * Covers annotation-era classic Spring (3.x/4.x/5.x, non-Boot). Does NOT cover
 * XML-based bean wiring or Hibernate HBM XML entity mappings (those require
 * a separate spring-classic-xml pack).
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { runSpringClassicAdapter } from '../services/extensionPacks/frameworkAdapters/springClassic';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';

const CONTROLLER_SRC = `
package org.example.web;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

@Controller
@RequestMapping("/patients")
public class PatientController {
  @GetMapping
  public String listPatients() { return "patients/list"; }

  @GetMapping("/{id}")
  public PatientDto getPatient(@PathVariable Integer id) { return null; }

  @PostMapping
  public String createPatient(@RequestBody CreatePatientDto dto) { return "redirect:/patients"; }
}
`;

const ENTITY_SRC = `
package org.example.model;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import jakarta.persistence.Id;
import jakarta.persistence.Column;
import jakarta.persistence.OneToMany;
import java.util.List;

@Entity
@Table(name = "patient")
public class Patient {
  @Id
  private Integer patientId;

  @Column(name = "given_name")
  private String givenName;

  @OneToMany
  private List<Visit> visits;
}
`;

const SERVICE_SRC = `
package org.example.service;
import org.springframework.stereotype.Service;

@Service
public class PatientService {
  public PatientDto getPatient(Integer id) { return null; }
  public void createPatient(Object dto) { }

  public Integer calculatePatientRiskScore(Integer id) { return 0; }
  public boolean validatePatientIdentifier(String identifier) { return true; }
}
`;

const DTO_SRC = `
package org.example.dto;
public class PatientDto {
  private Integer id;
  private String givenName;
}
`;

const CREATE_DTO_SRC = `
package org.example.dto;
public class CreatePatientDto {
  private String givenName;
  private String familyName;
}
`;

describe('spring-classic adapter smoke tests', () => {
  let files: SourceFileIR[];

  beforeAll(() => {
    files = [
      extractJavaIR('web/PatientController.java', CONTROLLER_SRC)!,
      extractJavaIR('model/Patient.java', ENTITY_SRC)!,
      extractJavaIR('service/PatientService.java', SERVICE_SRC)!,
      extractJavaIR('dto/PatientDto.java', DTO_SRC)!,
      extractJavaIR('dto/CreatePatientDto.java', CREATE_DTO_SRC)!,
    ];
    for (const f of files) if (!f) throw new Error('parse fail');
  });

  it('emits interface for @Controller class (NOT just @RestController)', () => {
    const c = runSpringClassicAdapter(files, 'sc-smoke');
    const ifaces = c.filter((x) => x.candidateType === 'interfaces');
    expect(ifaces).toHaveLength(1);
    expect(ifaces[0].name).toBe('PatientController');
  });

  it('emits endpoints with composed paths', () => {
    const c = runSpringClassicAdapter(files, 'sc-smoke');
    const eps = c.filter((x) => x.candidateType === 'endpoints').map((e) => e.name).sort();
    expect(eps).toEqual(['GET /patients', 'GET /patients/{id}', 'POST /patients']);
  });

  it('classic @Controller returning String (view name) does NOT leak into DTO set', () => {
    const c = runSpringClassicAdapter(files, 'sc-smoke');
    const logicals = c.filter((x) => x.candidateType === 'logical_data_entities').map((e) => e.name).sort();
    // PatientDto (via GET return), CreatePatientDto (via @RequestBody),
    // Patient (via JPA @Entity → emitLogicalPhysicalMappings) — NOT "String".
    // The "String" return type from the @Controller method must never appear
    // as a DTO; that's the failure mode this test guards against.
    expect(logicals).toEqual(['CreatePatientDto', 'Patient', 'PatientDto']);
    expect(logicals).not.toContain('String');
  });

  it('emits physical_entity + attributes from @Entity class', () => {
    const c = runSpringClassicAdapter(files, 'sc-smoke');
    expect(c.filter((x) => x.candidateType === 'physical_data_entities').map((e) => e.name)).toEqual(['Patient']);
    const attrs = c.filter((x) => x.candidateType === 'physical_data_attributes').map((e) => e.name).sort();
    expect(attrs).toEqual(['givenName', 'patientId']);
  });

  it('emits @OneToMany as entity_relationship', () => {
    const c = runSpringClassicAdapter(files, 'sc-smoke');
    const rels = c.filter((x) => x.candidateType === 'logical_data_entity_relationships').map((e) => e.name);
    expect(rels).toEqual(['Patient → Visit']);
  });

  it('emits business_logic for parameterised methods on @Service classes, including get*/create* with args', () => {
    // Zero-arg bean accessors (get/set/is) are excluded as pure boilerplate;
    // anything with parameters is treated as domain logic regardless of its
    // naming prefix (e.g. `getPatient(Integer id)` does a lookup + transform;
    // `createPatient(Object dto)` does validation/persistence).
    const c = runSpringClassicAdapter(files, 'sc-smoke');
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((e) => e.name).sort();
    expect(bl).toEqual([
      'calculatePatientRiskScore',
      'createPatient',
      'getPatient',
      'validatePatientIdentifier',
    ]);
  });

  it('Bug 3 — emits zero-arg getters on explicitly @Service-annotated classes (catalog-style lookups)', () => {
    const CATALOG_SRC = `
package org.example.service;
import org.springframework.stereotype.Service;
import java.util.List;

@Service
public class RulesCatalogService {
  private final List<String> facts;
  private final List<String> roles;
  public RulesCatalogService() { this.facts = List.of("a","b"); this.roles = List.of("x"); }
  public List<String> getFacts() { return facts; }
  public List<String> getRoles() { return roles; }
}
`;
    const catalogFiles = [
      extractJavaIR('service/RulesCatalogService.java', CATALOG_SRC)!,
    ];
    const c = runSpringClassicAdapter(catalogFiles, 'sc-catalog');
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((e) => e.name).sort();
    // Both zero-arg getters must be emitted because the class has @Service.
    expect(bl).toEqual(['getFacts', 'getRoles']);
  });

  it('Bug 2 — dedupes overloaded methods on (className, methodName)', () => {
    const OVERLOAD_SRC = `
package org.example.service;
import org.springframework.stereotype.Service;
@Service
public class ReportService {
  public String generate(String json) { return ""; }
  public String generate(String json, String sample) { return ""; }
  public void archive(String id) {}
}
`;
    const overloadFiles = [
      extractJavaIR('service/ReportService.java', OVERLOAD_SRC)!,
    ];
    const c = runSpringClassicAdapter(overloadFiles, 'sc-overload');
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((e) => e.name).sort();
    expect(bl).toEqual(['archive', 'generate']);
  });

  it('Bug 1 — does NOT emit methods from anonymous inner classes inside an @Service', () => {
    const INNER_SRC = `
package org.example.service;
import org.springframework.stereotype.Service;
import java.util.function.Predicate;
@Service
public class FilterService {
  public boolean hasAny(java.util.List<String> items, String term) {
    Predicate<String> p = new Predicate<String>() {
      @Override
      public boolean test(String s) { return s.contains(term); }
    };
    return items.stream().anyMatch(p);
  }
}
`;
    const innerFiles = [
      extractJavaIR('service/FilterService.java', INNER_SRC)!,
    ];
    const c = runSpringClassicAdapter(innerFiles, 'sc-inner');
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((e) => e.name).sort();
    // Only the outer method should be emitted; `test` belongs to the
    // anonymous Predicate and must NOT leak into the @Service's bucket.
    expect(bl).toEqual(['hasAny']);
  });

  it('Bug 5 — unwraps generic wrappers on @RequestBody types (List<Inner> → Inner)', () => {
    const NESTED_CTRL_SRC = `
package org.example.web;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import java.util.List;

@RestController
public class LogIngestController {
  @PostMapping("/logs")
  public void ingest(@RequestBody List<LogEntry> entries) {}

  public static class LogEntry {
    private String level;
    private String message;
  }
}
`;
    const logFiles = [
      extractJavaIR('web/LogIngestController.java', NESTED_CTRL_SRC)!,
    ];
    const c = runSpringClassicAdapter(logFiles, 'sc-nested');
    const logicalEntities = c
      .filter((x) => x.candidateType === 'logical_data_entities')
      .map((e) => e.name)
      .sort();
    // The inner class LogEntry (used as @RequestBody List<LogEntry>) must be
    // picked up as a logical_data_entity, NOT skipped as "List<LogEntry>".
    expect(logicalEntities).toEqual(['LogEntry']);
  });

  it('Bug 16 — emits business_logic from interface only, NOT from paired *Impl class', () => {
    // Common OpenMRS / legacy-Spring pattern: FooService interface declares
    // the contract, FooServiceImpl provides the @Service-annotated class.
    // Both used to emit every method → double-count. Interface is the
    // canonical carrier per java.md.
    const INTERFACE_SRC = `
package org.example.api;
public interface PatientService {
  Object getPatient(Integer id);
  Object createPatient(Object dto);
  Integer calculateRisk(Integer id);
}
`;
    const IMPL_SRC = `
package org.example.api.impl;
import org.springframework.stereotype.Service;

@Service
public class PatientServiceImpl implements org.example.api.PatientService {
  @Override public Object getPatient(Integer id) { return null; }
  @Override public Object createPatient(Object dto) { return null; }
  @Override public Integer calculateRisk(Integer id) { return 0; }
}
`;
    const bothFiles = [
      extractJavaIR('api/PatientService.java', INTERFACE_SRC)!,
      extractJavaIR('api/impl/PatientServiceImpl.java', IMPL_SRC)!,
    ];
    const c = runSpringClassicAdapter(bothFiles, 'sc-iface-dedup');
    const bl = c.filter((x) => x.candidateType === 'business_logics');
    // Exactly 3 methods emitted (one per method, NOT 6).
    expect(bl).toHaveLength(3);
    // All carry the interface name as className (not the impl).
    const classNames = new Set(bl.map((b) => (b.data as Record<string, unknown>)?.className));
    expect(classNames).toEqual(new Set(['PatientService']));
    const names = bl.map((b) => b.name).sort();
    expect(names).toEqual(['calculateRisk', 'createPatient', 'getPatient']);
  });

  it('Bug 17 — HBM XML-mapped class emits as physical_data_entity via javaLangPack', async () => {
    // End-to-end: Java POJO with no @Entity, but mapped in a sibling
    // Concept.hbm.xml file. After javaLangPack.extract() runs, the class
    // should present as if it had @Entity + @Column annotations and the
    // spring-classic adapter should emit a physical_data_entity with its
    // attributes + a many-to-one relationship.
    const POJO = `
package org.openmrs;
public class Patient {
  private Integer patientId;
  private String familyName;
  private Person person;
}
`;
    const HBM = `<?xml version="1.0"?>
<!DOCTYPE hibernate-mapping PUBLIC "-//Hibernate/Hibernate Mapping DTD 3.1//EN"
 "http://www.hibernate.org/dtd/hibernate-mapping-3.0.dtd">
<hibernate-mapping package="org.openmrs">
  <class name="Patient" table="patient">
    <id name="patientId" type="java.lang.Integer" column="patient_id"/>
    <property name="familyName" type="java.lang.String" column="family_name"/>
    <many-to-one name="person" class="Person" column="person_id"/>
  </class>
</hibernate-mapping>`;
    const { javaLangPack } = await import('../services/extensionPacks/languagePacks/javaLangPack');
    const sourceFiles = new Map<string, string>();
    sourceFiles.set('api/src/main/java/org/openmrs/Patient.java', POJO);
    sourceFiles.set('api/src/main/resources/org/openmrs/Patient.hbm.xml', HBM);
    const irs = javaLangPack.extract(sourceFiles, { '0': { language: 'Java' } });
    const allIrs = Array.from(irs.values());
    const c = runSpringClassicAdapter(allIrs, 'sc-hbm');
    const pdes = c
      .filter((x) => x.candidateType === 'physical_data_entities')
      .map((e) => e.name);
    expect(pdes).toContain('Patient');
    const pdas = c
      .filter((x) => x.candidateType === 'physical_data_attributes')
      .map((e) => e.name)
      .sort();
    expect(pdas).toEqual(['familyName', 'patientId']);
    const rels = c
      .filter((x) => x.candidateType === 'logical_data_entity_relationships')
      .map((e) => e.name);
    expect(rels).toEqual(['Patient → Person']);
  });

  it('Bug 16 — standalone @Service class (no paired interface) still emits its methods', () => {
    // Safety net: if the service has no paired interface, the impl must
    // still emit. Otherwise standalone @Service classes would be invisible.
    const STANDALONE_SRC = `
package org.example.util;
import org.springframework.stereotype.Service;

@Service
public class StandaloneUtilService {
  public String format(String input) { return input; }
  public int count(String input) { return 0; }
}
`;
    const standaloneFiles = [
      extractJavaIR('util/StandaloneUtilService.java', STANDALONE_SRC)!,
    ];
    const c = runSpringClassicAdapter(standaloneFiles, 'sc-standalone');
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((b) => b.name).sort();
    expect(bl).toEqual(['count', 'format']);
  });

  // ===========================================================================
  // @Configuration / @Bean / @Import / @ComponentScan capture
  //
  // Regression cover for the Fire UI codebase (~15+ `*SJC` Java-config classes
  // wiring the entire backend). Before this capture landed, the LLM gap-fill
  // stage had to recognise each @Configuration class per-file and could never
  // see the cross-file @Import graph because it only sees one file at a time.
  // ===========================================================================
  it('emits @Configuration class as interfaces with springConfigKind, plus @Bean methods as business_logics parented to it', () => {
    const SUBMISSION_SJC_SRC = `
package org.example.fire.config;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import javax.sql.DataSource;
import org.springframework.web.client.RestTemplate;

@Configuration
public class SubmissionSJC {
  @Bean
  public DataSource submissionDataSource() { return null; }

  @Bean(name = "submissionRestTemplate")
  public RestTemplate submissionRestTemplate() { return new RestTemplate(); }

  // Helper method without @Bean — must NOT emit as a candidate.
  private void wireUp() { }
}
`;
    const files = [
      extractJavaIR('config/SubmissionSJC.java', SUBMISSION_SJC_SRC)!,
    ];
    const c = runSpringClassicAdapter(files, 'sc-sjc');

    // Configuration class emitted as interfaces with the springConfigKind tag.
    const configIface = c.find(
      (x) => x.candidateType === 'interfaces' && x.name === 'SubmissionSJC',
    );
    expect(configIface).toBeDefined();
    const cfgData = configIface!.data as Record<string, unknown>;
    expect(cfgData.springConfigKind).toBe('configuration');
    expect(cfgData.className).toBe('SubmissionSJC');
    // No @Import / @ImportResource / @ComponentScan in this fixture, so the
    // optional fields are absent (unset rather than empty arrays).
    expect(cfgData.importedConfigs).toBeUndefined();
    expect(cfgData.importedXmlResources).toBeUndefined();
    expect(cfgData.componentScanPackages).toBeUndefined();

    // Both @Bean methods emitted as business_logics parented to the config.
    const beans = c.filter(
      (x) =>
        x.candidateType === 'business_logics' &&
        (x.data as Record<string, unknown>).beanKind === 'bean-factory',
    );
    expect(beans.map((b) => b.name).sort()).toEqual([
      'submissionDataSource',
      'submissionRestTemplate',
    ]);
    for (const b of beans) {
      expect(b.parentCandidateId).toBe(configIface!.id);
      const bd = b.data as Record<string, unknown>;
      expect(bd.className).toBe('SubmissionSJC');
    }
    // Bean-name override via `@Bean(name = "submissionRestTemplate")` flows
    // through to data.beanName even though it matches the method name here.
    const restTpl = beans.find((b) => b.name === 'submissionRestTemplate')!;
    expect((restTpl.data as Record<string, unknown>).beanName).toBe(
      'submissionRestTemplate',
    );

    // The non-@Bean helper method must NOT emit. processConfigurationClass
    // owns this class entirely, so processServiceLayerBusinessLogic must
    // skip it (the @Configuration guard).
    const helperEmissions = c.filter((x) => x.name === 'wireUp');
    expect(helperEmissions).toEqual([]);
  });

  it('captures @Import / @ImportResource / @ComponentScan as data on the @Configuration interfaces candidate', () => {
    const ROOT_CONFIG_SRC = `
package org.example.fire.config;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.ImportResource;
import org.springframework.context.annotation.ComponentScan;

@Configuration
@Import({SubmissionSJC.class, JobComparisonSJC.class, ProxySJC.class})
@ImportResource("classpath:applicationContext-dataSource.xml")
@ComponentScan(basePackages = {"org.example.fire.web", "org.example.fire.service"})
public class SpringRootConfig {
}
`;
    const files = [
      extractJavaIR('config/SpringRootConfig.java', ROOT_CONFIG_SRC)!,
    ];
    const c = runSpringClassicAdapter(files, 'sc-root');

    const root = c.find(
      (x) => x.candidateType === 'interfaces' && x.name === 'SpringRootConfig',
    );
    expect(root).toBeDefined();
    const data = root!.data as Record<string, unknown>;

    expect(data.springConfigKind).toBe('configuration');
    expect(data.importedConfigs).toEqual([
      'SubmissionSJC',
      'JobComparisonSJC',
      'ProxySJC',
    ]);
    expect(data.importedXmlResources).toEqual([
      'classpath:applicationContext-dataSource.xml',
    ]);
    expect(data.componentScanPackages).toEqual([
      'org.example.fire.web',
      'org.example.fire.service',
    ]);
  });

  it('emits Java service interfaces (PatientService + PatientServiceImpl pattern) as interfaces with springConfigKind=service-api', () => {
    // Regression cover for the OpenMRS scan (2026-04-25): 50+ Service Java
    // interfaces (`PatientService`, `EncounterService`, …) had their methods
    // surfacing as `business_logics` but the interfaces themselves never
    // appeared as `interfaces` candidates. processServiceInterface (added
    // 2026-04-25) closes that gap.
    const PATIENT_SERVICE_SRC = `
package org.example.fire.service;
public interface PatientService {
  Patient getPatient(Integer id);
  void createPatient(PatientDto dto);
}
`;
    const PATIENT_SERVICE_IMPL_SRC = `
package org.example.fire.service;
import org.springframework.stereotype.Service;

@Service
public class PatientServiceImpl implements PatientService {
  public Patient getPatient(Integer id) { return null; }
  public void createPatient(PatientDto dto) { }
}
`;
    const STANDALONE_DAO_SRC = `
package org.example.fire.dao;
public interface PatientDao {
  Patient findById(Integer id);
}
`;
    // A non-service interface that must NOT be emitted (suffix doesn't match,
    // no paired Impl with stereotype).
    const NON_SERVICE_INTERFACE_SRC = `
package org.example.fire.util;
public interface CharSequenceLike {
  int length();
}
`;
    const files = [
      extractJavaIR('service/PatientService.java', PATIENT_SERVICE_SRC)!,
      extractJavaIR('service/PatientServiceImpl.java', PATIENT_SERVICE_IMPL_SRC)!,
      extractJavaIR('dao/PatientDao.java', STANDALONE_DAO_SRC)!,
      extractJavaIR('util/CharSequenceLike.java', NON_SERVICE_INTERFACE_SRC)!,
    ];
    const c = runSpringClassicAdapter(files, 'sc-iface');

    const ifaces = c.filter((x) => x.candidateType === 'interfaces');
    const byName = new Map(ifaces.map((i) => [i.name, i]));

    // PatientService — paired with annotated impl AND name-matches.
    const ps = byName.get('PatientService');
    expect(ps).toBeDefined();
    const psData = ps!.data as Record<string, unknown>;
    expect(psData.springConfigKind).toBe('service-api');
    expect(psData.implClassName).toBe('PatientServiceImpl');
    expect(psData.className).toBe('PatientService');

    // PatientDao — name-matches only (no paired Impl in scan).
    const pd = byName.get('PatientDao');
    expect(pd).toBeDefined();
    expect((pd!.data as Record<string, unknown>).springConfigKind).toBe('service-api');
    expect((pd!.data as Record<string, unknown>).implClassName).toBeUndefined();

    // CharSequenceLike — generic interface, must NOT emit.
    expect(byName.has('CharSequenceLike')).toBe(false);

    // Bug 16 fix still holds — methods come from the PatientService
    // interface, not the Impl. PatientDao is excluded from `business_logics`
    // by NON_BUSINESS_LOGIC_SUFFIXES (DAOs are infrastructure, not domain
    // logic) — but the interface still surfaces as an `interfaces`
    // candidate via processServiceInterface. That is the intentional
    // service-API-vs-domain-logic distinction.
    const bl = c.filter((x) => x.candidateType === 'business_logics').map((b) => b.name).sort();
    expect(bl).toEqual(['createPatient', 'getPatient']);
  });

  it('captures @Enable* annotations on @Configuration as enabledFeatures (with args)', () => {
    // Regression cover for OpenMRS AOPConfig pattern observed 2026-04-25.
    const AOP_CONFIG_SRC = `
package org.example.fire.config;
import org.springframework.context.annotation.Configuration;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.context.annotation.EnableAspectJAutoProxy;
import org.springframework.scheduling.annotation.EnableScheduling;

@Configuration
@EnableTransactionManagement(order = 5, proxyTargetClass = true)
@EnableCaching(order = 4, proxyTargetClass = true)
@EnableAspectJAutoProxy(proxyTargetClass = true)
@EnableScheduling
public class AOPConfig {
}
`;
    const files = [extractJavaIR('config/AOPConfig.java', AOP_CONFIG_SRC)!];
    const c = runSpringClassicAdapter(files, 'sc-enable');

    const cfg = c.find((x) => x.candidateType === 'interfaces' && x.name === 'AOPConfig');
    expect(cfg).toBeDefined();
    const data = cfg!.data as Record<string, unknown>;
    expect(data.springConfigKind).toBe('configuration');

    const enabled = data.enabledFeatures as Array<{ name: string; args?: Record<string, string> }>;
    expect(enabled).toBeDefined();
    const names = enabled.map((e) => e.name).sort();
    expect(names).toEqual([
      'EnableAspectJAutoProxy',
      'EnableCaching',
      'EnableScheduling',
      'EnableTransactionManagement',
    ]);

    // Args flow through.
    const tx = enabled.find((e) => e.name === 'EnableTransactionManagement')!;
    expect(tx.args).toEqual(expect.objectContaining({ order: '5', proxyTargetClass: 'true' }));

    // Marker annotation has no args field.
    const sched = enabled.find((e) => e.name === 'EnableScheduling')!;
    expect(sched.args).toBeUndefined();
  });

  it('emits Spring bean XML beans as interfaces with springConfigKind=xml-bean (full javaLangPack → adapter pipeline)', async () => {
    // Regression cover for the OpenMRS Core scan (2026-04-25): 49 beans
    // in `applicationContext-service.xml` were invisible to discovery.
    // This drives the full pipeline: source-file map → javaLangPack
    // (which detects + parses Spring bean XML) → springClassicFrameworkPack
    // adapt → candidates.
    const { javaLangPack } = await import('../services/extensionPacks/languagePacks/javaLangPack');
    const { springClassicFrameworkPack } = await import(
      '../services/extensionPacks/frameworkPacks/springClassicFrameworkPack'
    );

    const APP_CTX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://www.springframework.org/schema/beans"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xmlns:context="http://www.springframework.org/schema/context"
       xmlns:tx="http://www.springframework.org/schema/tx">

  <context:component-scan base-package="org.example.service"/>
  <import resource="classpath:applicationContext-data.xml"/>

  <bean id="dataSource" class="org.apache.commons.dbcp2.BasicDataSource"/>
  <bean id="sessionFactory" class="org.springframework.orm.hibernate5.LocalSessionFactoryBean">
    <property name="dataSource" ref="dataSource"/>
  </bean>
  <bean id="patientService" class="org.example.service.PatientServiceImpl">
    <property name="sessionFactory" ref="sessionFactory"/>
  </bean>
</beans>
`;
    const sourceFiles = new Map<string, string>([
      ['src/main/resources/applicationContext.xml', APP_CTX_XML],
    ]);
    const techHints = {
      'src/main/resources/applicationContext.xml': { language: 'Java', technology: 'Spring' },
    };
    const ir = javaLangPack.extract(sourceFiles, techHints);
    const candidates = springClassicFrameworkPack.adapt(ir, 'sc-xml', techHints);

    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');
    const byKind = new Map<string, typeof ifaces>();
    for (const i of ifaces) {
      const kind = (i.data as Record<string, unknown>).springConfigKind as string;
      const list = byKind.get(kind) || [];
      list.push(i);
      byKind.set(kind, list);
    }

    // Three xml-bean candidates (one per <bean>).
    const xmlBeans = byKind.get('xml-bean') || [];
    expect(xmlBeans.map((b) => b.name).sort()).toEqual([
      'dataSource',
      'patientService',
      'sessionFactory',
    ]);
    const ps = xmlBeans.find((b) => b.name === 'patientService')!;
    const psData = ps.data as Record<string, unknown>;
    expect(psData.fullyQualifiedClass).toBe('org.example.service.PatientServiceImpl');
    expect(psData.className).toBe('PatientServiceImpl');
    expect(psData.dependencyRefs).toEqual(['sessionFactory']);

    // One xml-context candidate carrying the file-level wiring.
    const xmlContext = byKind.get('xml-context') || [];
    expect(xmlContext).toHaveLength(1);
    const ctxData = xmlContext[0].data as Record<string, unknown>;
    expect(ctxData.componentScanPackages).toEqual(['org.example.service']);
    expect(ctxData.importedXmlResources).toEqual(['classpath:applicationContext-data.xml']);
    expect((ctxData.usedNamespaces as string[]).sort()).toEqual(['context', 'tx']);
  });

  it('captures @Aspect classes with springConfigKind=aop-aspect plus advice methods as parented business_logics', () => {
    const ASPECT_SRC = `
package org.example.fire.aop;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Pointcut;
import org.aspectj.lang.annotation.Before;
import org.aspectj.lang.annotation.AfterReturning;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.ProceedingJoinPoint;

@Aspect
public class AuditAspect {
  @Pointcut("execution(* org.example.service.*Service.*(..))")
  public void anyServiceMethod() {}

  @Before("anyServiceMethod()")
  public void recordEntry(org.aspectj.lang.JoinPoint jp) {}

  @AfterReturning(pointcut = "anyServiceMethod()", returning = "result")
  public void recordExit(Object result) {}

  @Around("anyServiceMethod()")
  public Object timeIt(ProceedingJoinPoint pjp) throws Throwable { return pjp.proceed(); }

  // A non-advice helper — must NOT emit as business_logics.
  private void privateHelper() {}
}
`;
    const files = [extractJavaIR('aop/AuditAspect.java', ASPECT_SRC)!];
    const c = runSpringClassicAdapter(files, 'sc-aop');

    const aspect = c.find(
      (x) => x.candidateType === 'interfaces' && x.name === 'AuditAspect',
    );
    expect(aspect).toBeDefined();
    expect((aspect!.data as Record<string, unknown>).springConfigKind).toBe('aop-aspect');

    const advice = c
      .filter((x) => x.candidateType === 'business_logics')
      .filter((x) => x.parentCandidateId === aspect!.id);
    const adviceByName = new Map(advice.map((a) => [a.name, a]));

    // Pointcut named definition
    expect((adviceByName.get('anyServiceMethod')!.data as Record<string, unknown>).adviceKind).toBe('Pointcut');
    // Three advice methods captured with kind + expression
    expect((adviceByName.get('recordEntry')!.data as Record<string, unknown>).adviceKind).toBe('Before');
    expect((adviceByName.get('recordExit')!.data as Record<string, unknown>).adviceKind).toBe('AfterReturning');
    expect((adviceByName.get('timeIt')!.data as Record<string, unknown>).adviceKind).toBe('Around');

    // The non-advice helper does NOT emit (no advice annotation, and the
    // class is @Aspect so processServiceLayerBusinessLogic skips it).
    expect(c.some((x) => x.name === 'privateHelper')).toBe(false);
  });

  it('emits message-driven + scheduled methods as endpoints with the right endpoint_subtype', () => {
    const SRC = `
package org.example.fire.messaging;
import org.springframework.jms.annotation.JmsListener;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class OrderEvents {
  @JmsListener(destination = "orders.queue")
  public void onOrderJms(String msg) {}

  @KafkaListener(topics = "orders.events")
  public void onOrderKafka(String msg) {}

  @RabbitListener(queues = "orders.rmq")
  public void onOrderRabbit(String msg) {}

  @EventListener(classes = OrderCreatedEvent.class)
  public void onOrderEvent(OrderCreatedEvent e) {}

  @Scheduled(cron = "0 0 * * * *")
  public void hourlyJob() {}

  @Scheduled(fixedRate = 5000)
  public void everyFiveSeconds() {}
}
`;
    const files = [extractJavaIR('messaging/OrderEvents.java', SRC)!];
    const c = runSpringClassicAdapter(files, 'sc-msg');
    const ep = c.filter((x) => x.candidateType === 'endpoints');

    const subtypes = ep.map((e) => (e.data as Record<string, unknown>).endpoint_subtype).sort();
    expect(subtypes).toEqual([
      'event-listener',
      'jms-listener',
      'kafka-listener',
      'rabbit-listener',
      'scheduled',
      'scheduled',
    ]);

    // Destination/topic/cron flow through to the candidate name and data.
    const jms = ep.find((e) => (e.data as Record<string, unknown>).endpoint_subtype === 'jms-listener')!;
    expect((jms.data as Record<string, unknown>).destination).toBe('orders.queue');
    expect(jms.name).toContain('orders.queue');

    const kafka = ep.find((e) => (e.data as Record<string, unknown>).endpoint_subtype === 'kafka-listener')!;
    expect((kafka.data as Record<string, unknown>).topics).toBe('orders.events');

    const cron = ep.find((e) => (e.data as Record<string, unknown>).cron === '0 0 * * * *')!;
    expect(cron.name).toContain('0 0 * * * *');

    const fixed = ep.find((e) => (e.data as Record<string, unknown>).fixedRate === '5000')!;
    expect(fixed.name).toContain('fixedRate=5000');
  });

  it('emits @FeignClient interfaces as outbound-rest interfaces + per-method outbound endpoints', () => {
    const SRC = `
package org.example.fire.client;
import org.springframework.cloud.openfeign.FeignClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;

@FeignClient(name = "user-service", url = "https://users.example.com")
public interface UserClient {
  @GetMapping("/users/{id}")
  UserDto getUser(@PathVariable Integer id);

  @PostMapping("/users")
  UserDto createUser(@RequestBody CreateUserDto dto);
}
`;
    const files = [extractJavaIR('client/UserClient.java', SRC)!];
    const c = runSpringClassicAdapter(files, 'sc-feign');

    const ifaces = c.filter((x) => x.candidateType === 'interfaces');
    const feign = ifaces.find((i) => i.name === 'UserClient')!;
    expect(feign).toBeDefined();
    const fdata = feign.data as Record<string, unknown>;
    expect(fdata.springConfigKind).toBe('feign-client');
    expect(fdata.feignName).toBe('user-service');
    expect(fdata.feignUrl).toBe('https://users.example.com');

    const eps = c
      .filter((x) => x.candidateType === 'endpoints')
      .filter((x) => x.parentCandidateId === feign.id);
    expect(eps.map((e) => e.name).sort()).toEqual(['GET /users/{id}', 'POST /users']);
    expect((eps[0].data as Record<string, unknown>).endpoint_subtype).toBe('outbound-rest');
  });

  it('emits RestTemplate / WebClient call-site URLs as outbound-rest endpoints (rawContent regex)', () => {
    // Service class — the gating check is `@Service` annotation OR
    // name-suggested. RestTemplate and WebClient verbs both fire.
    const SRC = `
package org.example.fire.service;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.reactive.function.client.WebClient;

@Service
public class IntegrationService {
  private RestTemplate restTemplate = new RestTemplate();
  private WebClient webClient = WebClient.builder().build();

  public Object fetchOrder(String id) {
    return restTemplate.getForObject("/orders/123", Order.class);
  }

  public void postOrder() {
    restTemplate.postForObject("https://other.example.com/orders", null, Object.class);
  }

  public Object reactive() {
    return webClient.get().uri("/users/me").retrieve();
  }

  public void reactivePost() {
    webClient.post().uri("/orders").bodyValue(null);
  }
}
`;
    const files = [extractJavaIR('service/IntegrationService.java', SRC)!];
    const c = runSpringClassicAdapter(files, 'sc-rest');
    const ep = c.filter((x) => x.candidateType === 'endpoints');
    const subset = ep.filter((e) => (e.data as Record<string, unknown>).endpoint_subtype === 'outbound-rest');

    const byKey = new Set(subset.map((e) => e.name));
    expect(byKey.has('GET /orders/123')).toBe(true);
    expect(byKey.has('POST https://other.example.com/orders')).toBe(true);
    expect(byKey.has('GET /users/me')).toBe(true);
    expect(byKey.has('POST /orders')).toBe(true);

    const rt = subset.find((e) => e.name === 'GET /orders/123')!;
    expect((rt.data as Record<string, unknown>).integrationKind).toBe('rest-template');
    const wc = subset.find((e) => e.name === 'GET /users/me')!;
    expect((wc.data as Record<string, unknown>).integrationKind).toBe('webclient');
  });

  it('captures @Bean method parameter types as data.dependencies (wiring graph)', () => {
    const SRC = `
package org.example.fire.config;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;
import javax.sql.DataSource;
import org.springframework.transaction.PlatformTransactionManager;

@Configuration
public class TxConfig {
  @Bean
  public PlatformTransactionManager transactionManager(DataSource dataSource, SomeListener listener) {
    return null;
  }
}
`;
    const files = [extractJavaIR('config/TxConfig.java', SRC)!];
    const c = runSpringClassicAdapter(files, 'sc-bean-deps');
    const bean = c.find(
      (x) =>
        x.candidateType === 'business_logics' &&
        (x.data as Record<string, unknown>).beanKind === 'bean-factory' &&
        x.name === 'transactionManager',
    );
    expect(bean).toBeDefined();
    expect((bean!.data as Record<string, unknown>).dependencies).toEqual([
      'DataSource',
      'SomeListener',
    ]);
  });

  it('service-interface DTO seeding surfaces the DTOs but emits NO ILE links for the internal interface (Kiro 2026-08-25)', () => {
    const SRC = `
package org.example.fire.service;
public interface PatientService {
  PatientDto getPatient(Integer id);
  void createPatient(CreatePatientDto dto);
  java.util.List<PatientDto> listPatients();
}
`;
    const DTO_SRC = `
package org.example.fire.dto;
public class PatientDto {
  private Integer id;
}
`;
    const CREATE_DTO_SRC = `
package org.example.fire.dto;
public class CreatePatientDto {
  private String name;
}
`;
    const files = [
      extractJavaIR('service/PatientService.java', SRC)!,
      extractJavaIR('dto/PatientDto.java', DTO_SRC)!,
      extractJavaIR('dto/CreatePatientDto.java', CREATE_DTO_SRC)!,
    ];
    const c = runSpringClassicAdapter(files, 'sc-iface-dto');

    // Both DTOs surfaced as logical_data_entities (the existing emit pass —
    // the service-interface seeding still drives DTO discovery).
    const lde = c.filter((x) => x.candidateType === 'logical_data_entities').map((x) => x.name).sort();
    expect(lde).toEqual(['CreatePatientDto', 'PatientDto']);

    // NO service ↔ DTO links (Kiro 2026-08-25): PatientService is emitted as
    // internal service-api wiring and DROPPED by the stage-2 post-process, so
    // links referencing it dangled at save-back with no fillable value. A
    // link from an interface outside the external meta-model has no meaning.
    const links = c.filter((x) => x.candidateType === 'interface_logical_entities').map((x) => x.name).sort();
    expect(links).toEqual([]);
  });

  it('confidence stratification: paired-impl service-api > 0.9 > name-match > xml-alias-only', () => {
    const SRC_PAIRED = `
package org.example.s;
public interface PatientService { void m(); }
`;
    const SRC_PAIRED_IMPL = `
package org.example.s;
import org.springframework.stereotype.Service;
@Service
public class PatientServiceImpl implements PatientService { public void m() {} }
`;
    const SRC_NAME_ONLY = `
package org.example.s;
public interface OrphanDAO { void load(); }
`;
    const files = [
      extractJavaIR('s/PatientService.java', SRC_PAIRED)!,
      extractJavaIR('s/PatientServiceImpl.java', SRC_PAIRED_IMPL)!,
      extractJavaIR('s/OrphanDAO.java', SRC_NAME_ONLY)!,
    ];
    const c = runSpringClassicAdapter(files, 'sc-conf');
    const ps = c.find((x) => x.candidateType === 'interfaces' && x.name === 'PatientService')!;
    const dao = c.find((x) => x.candidateType === 'interfaces' && x.name === 'OrphanDAO')!;
    expect(ps.confidence).toBeGreaterThan(0.9);
    expect(dao.confidence).toBeLessThan(0.9);
    expect(ps.confidence).toBeGreaterThan(dao.confidence);
  });

  it('bean-class collapse: an xml-bean whose className matches a Java service-api row is folded onto the survivor (one row, xmlBeanIds preserved)', async () => {
    const { javaLangPack } = await import('../services/extensionPacks/languagePacks/javaLangPack');
    const { springClassicFrameworkPack } = await import(
      '../services/extensionPacks/frameworkPacks/springClassicFrameworkPack'
    );

    const PATIENT_SERVICE_SRC = `
package org.example.s;
public interface PatientService { void m(); }
`;
    const PATIENT_SERVICE_IMPL_SRC = `
package org.example.s;
import org.springframework.stereotype.Service;
@Service
public class PatientServiceImpl implements PatientService { public void m() {} }
`;
    const APP_CTX_XML = `<?xml version="1.0"?>
<beans xmlns="http://www.springframework.org/schema/beans">
  <bean id="patientService" class="org.example.s.PatientServiceImpl">
    <property name="dao" ref="patientDao"/>
  </bean>
</beans>
`;
    const sourceFiles = new Map<string, string>([
      ['s/PatientService.java', PATIENT_SERVICE_SRC],
      ['s/PatientServiceImpl.java', PATIENT_SERVICE_IMPL_SRC],
      ['s/applicationContext.xml', APP_CTX_XML],
    ]);
    const techHints = {
      's/applicationContext.xml': { language: 'Java', technology: 'Spring' },
    };
    const ir = javaLangPack.extract(sourceFiles, techHints);
    const candidates = springClassicFrameworkPack.adapt(ir, 'sc-collapse', techHints);

    // Before the collapse, we'd have 3 rows: PatientService (service-api),
    // PatientServiceImpl (xml-bean's className), and the xml-bean carrier
    // itself. The collapse folds the xml-bean carrier into PatientServiceImpl.
    const ifaces = candidates.filter((c) => c.candidateType === 'interfaces');

    // The xml-bean alias `patientService` is gone as its own row. The
    // canonical carrier is PatientServiceImpl with the bean key folded on.
    const xmlBeanRows = ifaces.filter(
      (c) => (c.data as Record<string, unknown>).springConfigKind === 'xml-bean',
    );
    expect(xmlBeanRows).toEqual([]);

    // The collapse tries `className` exact-match first, then `className`
    // minus `Impl` suffix. With no `PatientServiceImpl` interfaces row,
    // the Impl-strip falls back to `PatientService` (the service-api row),
    // and the xml bean folds onto it.
    const ps = ifaces.find((c) => c.name === 'PatientService')!;
    expect(ps).toBeDefined();
    const sd = ps.data as Record<string, unknown>;
    expect(sd.xmlBeanIds).toContain('patientService');
    expect(sd.xmlFilePath).toBe('s/applicationContext.xml');
    expect(sd.xmlDependencyRefs).toEqual(['patientDao']);
    // PatientService's source-cluster IDs now include the XML file path.
    expect(ps.sourceClusterIds).toContain('s/applicationContext.xml');
  });

  it('bean-class collapse on a JPA @Entity match — XML bean folds onto the entity row', () => {
    const ENTITY_SRC = `
package org.example.s;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

@Entity
@Table(name = "form")
public class Form {
  private Integer id;
}
`;
    const APP_CTX_XML = `<?xml version="1.0"?>
<beans xmlns="http://www.springframework.org/schema/beans">
  <bean id="formProto" class="org.example.s.Form"/>
</beans>
`;
    // Manually construct IR (avoid javaLangPack's filterJavaFiles complexity).
    const formIr = extractJavaIR('s/Form.java', ENTITY_SRC)!;
    const xmlIr = {
      filePath: 's/applicationContext.xml',
      language: 'spring-xml',
      packageOrNamespace: null,
      imports: [],
      classes: [],
      functions: [],
      springXmlBeans: {
        beans: [{
          beanKey: 'formProto',
          id: 'formProto',
          aliases: [],
          fullyQualifiedClass: 'org.example.s.Form',
          simpleClassName: 'Form',
          dependencyRefs: [],
        }],
        componentScans: [],
        imports: [],
        propertyPlaceholders: [],
        usedNamespaces: [],
      },
    } as any;

    const c = runSpringClassicAdapter([formIr, xmlIr], 'sc-entity-collapse');

    // The Form physical_data_entity should carry the folded xml bean info.
    const form = c.find(
      (x) => x.candidateType === 'physical_data_entities' && x.name === 'Form',
    );
    expect(form).toBeDefined();
    const fdata = form!.data as Record<string, unknown>;
    expect(fdata.xmlBeanIds).toEqual(['formProto']);

    // No standalone xml-bean row for `formProto`.
    expect(c.some((x) => x.name === 'formProto' && (x.data as Record<string, unknown>).springConfigKind === 'xml-bean')).toBe(false);
  });

  it('does not double-emit @Bean methods as both bean-factory business_logics and stereotype-name-suggests business_logics', () => {
    // A @Configuration class whose name happens to suggest a service
    // stereotype (e.g. ending in `Manager`). Without the @Configuration
    // guard in processServiceLayerBusinessLogic, every public method would
    // be emitted twice — once parented to the config, once not.
    const CONFLICTING_NAME_SRC = `
package org.example.fire.config;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Bean;

@Configuration
public class IntegrationManager {
  @Bean
  public String someClient() { return null; }

  public String helperUtility() { return null; }
}
`;
    const files = [
      extractJavaIR('config/IntegrationManager.java', CONFLICTING_NAME_SRC)!,
    ];
    const c = runSpringClassicAdapter(files, 'sc-conflict');
    const bl = c.filter((x) => x.candidateType === 'business_logics');

    // Exactly one entry per @Bean method. Helper methods on @Configuration
    // classes do NOT leak through processServiceLayerBusinessLogic.
    expect(bl.map((b) => b.name).sort()).toEqual(['someClient']);
    expect((bl[0].data as Record<string, unknown>).beanKind).toBe('bean-factory');
  });
});
