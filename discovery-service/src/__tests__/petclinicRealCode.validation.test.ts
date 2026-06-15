/**
 * Real-world validation: V2 Spring Boot adapter on actual PetClinic code.
 *
 * Fetches key Java source files from the spring-petclinic repo on GitHub,
 * runs them through extractJavaIR + runSpringBootAdapter, and prints the
 * emitted candidate breakdown. Asserts against the ground-truth numbers
 * we established in the 2026-04-17 gap analysis.
 *
 * Run with: npx jest petclinicRealCode.validation --no-coverage
 *
 * Requires network access (downloads ~20 Java files from github.com).
 */
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import { runSpringBootAdapter } from '../services/extensionPacks/frameworkAdapters/springBoot';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';

const BASE =
  'https://raw.githubusercontent.com/spring-projects/spring-petclinic/main/src/main/java/org/springframework/samples/petclinic/';

const PATHS = [
  'owner/Owner.java',
  'owner/OwnerController.java',
  'owner/OwnerRepository.java',
  'owner/Pet.java',
  'owner/PetController.java',
  'owner/PetType.java',
  'owner/PetTypeRepository.java',
  'owner/PetValidator.java',
  'owner/Visit.java',
  'owner/VisitController.java',
  'vet/Specialty.java',
  'vet/Vet.java',
  'vet/VetController.java',
  'vet/VetRepository.java',
  'vet/Vets.java',
  'system/CrashController.java',
  'system/WelcomeController.java',
  'system/CacheConfiguration.java',
  'system/WebConfiguration.java',
  'model/BaseEntity.java',
  'model/NamedEntity.java',
  'model/Person.java',
  'PetClinicApplication.java',
];

async function fetchJava(relPath: string): Promise<{ path: string; src: string }> {
  const url = BASE + relPath;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch ${url} → ${res.status}`);
  return { path: `src/main/java/org/springframework/samples/petclinic/${relPath}`, src: await res.text() };
}

describe('V2 Spring Boot adapter — real PetClinic code', () => {
  let files: SourceFileIR[];

  beforeAll(async () => {
    const sources = await Promise.all(PATHS.map(fetchJava));
    files = [];
    for (const { path, src } of sources) {
      const ir = extractJavaIR(path, src);
      if (ir) files.push(ir);
      else console.warn(`  [parse fail] ${path}`);
    }
  }, 60_000);

  it('prints candidate breakdown by type', () => {
    const candidates = runSpringBootAdapter(files, 'petclinic-validation');
    const byType: Record<string, string[]> = {};
    for (const c of candidates) {
      (byType[c.candidateType] ||= []).push(c.name);
    }

    console.log('\n==================== V2 adapter output — PetClinic ====================');
    console.log(`Parsed ${files.length}/${PATHS.length} files. Emitted ${candidates.length} candidates.\n`);
    for (const type of Object.keys(byType).sort()) {
      console.log(`${type} (${byType[type].length}):`);
      for (const name of byType[type].sort()) console.log(`  • ${name}`);
      console.log('');
    }
    console.log('========================================================================\n');

    expect(candidates.length).toBeGreaterThan(0);
  }, 60_000);

  it('emits interface candidates for each controller plus each @Configuration @Bean method', () => {
    const candidates = runSpringBootAdapter(files, 'petclinic-validation');
    const interfaces = candidates.filter((c) => c.candidateType === 'interfaces');
    const names = interfaces.map((i) => i.name).sort();
    // 6 one-per-controller interfaces PLUS the spring-bean-definition interfaces
    // emitted by processConfigurationClass: one per @Bean method in a
    // @Configuration class, named `<ConfigClass>#<beanName>`. PetClinic has
    // CacheConfiguration (1 bean) and WebConfiguration (2 beans).
    expect(names).toEqual(
      [
        'CacheConfiguration#petclinicCacheConfigurationCustomizer',
        'CrashController',
        'OwnerController',
        'PetController',
        'VetController',
        'VisitController',
        'WebConfiguration#localeChangeInterceptor',
        'WebConfiguration#localeResolver',
        'WelcomeController',
      ].sort(),
    );
  });

  it('emits roughly 17 endpoint candidates', () => {
    const candidates = runSpringBootAdapter(files, 'petclinic-validation');
    const endpoints = candidates.filter((c) => c.candidateType === 'endpoints');
    // Known ground truth: 17 endpoints across the 6 controllers.
    expect(endpoints.length).toBeGreaterThanOrEqual(15);
    expect(endpoints.length).toBeLessThanOrEqual(20);
  });

  it('emits 6 physical_entity candidates (JPA @Entity classes)', () => {
    const candidates = runSpringBootAdapter(files, 'petclinic-validation');
    const entities = candidates.filter((c) => c.candidateType === 'physical_data_entities');
    const names = entities.map((e) => e.name).sort();
    // Expect the 6 JPA entities. Note: PetClinic's abstract base classes
    // (BaseEntity, NamedEntity, Person) are @MappedSuperclass, not @Entity —
    // they should NOT appear here.
    expect(names).toEqual(['Owner', 'Pet', 'PetType', 'Specialty', 'Vet', 'Visit']);
  });

  it('emits entity_relationship candidates for JPA associations', () => {
    const candidates = runSpringBootAdapter(files, 'petclinic-validation');
    const rels = candidates.filter((c) => c.candidateType === 'logical_data_entity_relationships');
    const names = rels.map((r) => r.name).sort();
    // Known ground truth: Owner→Pet (@OneToMany), Pet→PetType (@ManyToOne),
    // Pet→Visit (@OneToMany), Vet→Specialty (@ManyToMany)
    expect(names).toEqual(expect.arrayContaining(['Owner → Pet', 'Pet → PetType', 'Pet → Visit', 'Vet → Specialty']));
  });

  it('does NOT emit candidates for repositories, validators, configs, or main class', () => {
    const candidates = runSpringBootAdapter(files, 'petclinic-validation');
    // Repositories (JpaRepository interfaces) have no Spring stereotype/JPA annotations
    // and should be silently skipped. Validators, Configs, and the main class are
    // also out of scope for the V2 adapter.
    const outOfScopeNames = ['OwnerRepository', 'PetTypeRepository', 'VetRepository', 'WebConfiguration', 'CacheConfiguration', 'PetClinicApplication'];
    for (const name of outOfScopeNames) {
      const match = candidates.find((c) => c.name === name && c.candidateType !== 'logical_data_entities');
      expect(match).toBeUndefined();
    }
  });

  it('includes inherited @MappedSuperclass fields (id, name, firstName, lastName)', () => {
    const candidates = runSpringBootAdapter(files, 'petclinic-validation');
    const attrs = candidates.filter((c) => c.candidateType === 'physical_data_attributes');

    // Group attributes by entity to verify inheritance flowed correctly.
    const byEntity: Record<string, string[]> = {};
    for (const a of attrs) {
      const entity = String(a.data.entityClassName);
      (byEntity[entity] ||= []).push(a.name);
    }

    // Owner extends Person extends NamedEntity extends BaseEntity.
    // Expect: id (BaseEntity), name (NamedEntity)? actually Owner's direct fields are
    // address/city/telephone; inherited: firstName, lastName (Person), name (NamedEntity), id (BaseEntity).
    // Note: "name" comes from NamedEntity but Person overrides nothing — Owner should get all 4.
    expect(byEntity.Owner).toEqual(
      expect.arrayContaining(['id', 'firstName', 'lastName', 'address', 'city', 'telephone']),
    );

    // Pet extends NamedEntity extends BaseEntity. Direct: birthDate (and a relationship 'type' we skip).
    // Inherited: id, name.
    expect(byEntity.Pet).toEqual(expect.arrayContaining(['id', 'name', 'birthDate']));

    // PetType/Specialty extend NamedEntity — only inherit id, name.
    expect(byEntity.PetType).toEqual(expect.arrayContaining(['id', 'name']));
    expect(byEntity.Specialty).toEqual(expect.arrayContaining(['id', 'name']));

    // Vet extends Person extends NamedEntity extends BaseEntity.
    expect(byEntity.Vet).toEqual(expect.arrayContaining(['id', 'firstName', 'lastName']));

    // Visit extends BaseEntity. Direct: date (and possibly description if @Column present).
    // Inherited: id.
    expect(byEntity.Visit).toEqual(expect.arrayContaining(['id', 'date']));
  });
});
