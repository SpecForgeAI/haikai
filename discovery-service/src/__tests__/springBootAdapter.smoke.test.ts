/**
 * Smoke test for the V3 Spring Boot pack pair.
 *
 * Spec: V3 Pack Migration Batch (Task Group 2)
 *
 * Migrated from direct `extractJavaIR` + `runSpringBootAdapter` invocation
 * to the V3 pack shape: `javaLangPack.extract` + `springBootFrameworkPack.adapt`.
 * All assertions are preserved verbatim — only the invocation shape changes.
 *
 * This is the first migrated smoke test of Spec V3 Pack Migration Batch and
 * establishes the find-and-replace pattern the remaining ~15 smoke suites
 * follow:
 *   - Build a `Map<filePath, source>` source-file map instead of raw IR.
 *   - Call `javaLangPack.extract(sourceFiles, springBootHints)` to get the
 *     IR map.
 *   - Call `springBootFrameworkPack.adapt(irMap, runId, springBootHints)`
 *     to get candidates.
 *
 * Parses synthetic PetClinic-shaped Java files and asserts the V3 pack pair
 * emits candidates of the expected core types: interface, endpoint,
 * physical_entity, physical_attribute, entity_relationship, logical_entity,
 * logical_data_attribute.
 */
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { springBootFrameworkPack } from '../services/extensionPacks/frameworkPacks/springBootFrameworkPack';
import type { SourceFileIR, TechHints } from '../services/extensionPacks';

const SPRING_BOOT_HINTS: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring Boot' },
};

const CONTROLLER_SRC = `
package org.example.owner;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.http.ResponseEntity;

@Controller
@RequestMapping("/owners")
public class OwnerController {

    @GetMapping("/{id}")
    public ResponseEntity<OwnerDto> showOwner(@PathVariable int id) {
        return null;
    }

    @PostMapping
    public String createOwner(@RequestBody CreateOwnerDto dto) {
        return "redirect:/owners";
    }
}
`;

const ENTITY_SRC = `
package org.example.owner;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Column;
import jakarta.persistence.Table;
import jakarta.persistence.OneToMany;
import java.util.List;

@Entity
@Table(name = "owners")
public class Owner {

    @Id
    private Integer id;

    @Column(name = "first_name", nullable = false)
    private String firstName;

    @OneToMany
    private List<Pet> pets;
}
`;

const DTO_SRC = `
package org.example.owner;

public class OwnerDto {
    private Integer id;
    private String firstName;
}
`;

const CREATE_DTO_SRC = `
package org.example.owner;

public class CreateOwnerDto {
    private String firstName;
    private String lastName;
}
`;

/**
 * Helper: run the full V3 pipeline (extract + adapt) for a set of file
 * sources. Mirrors the earlier "build IR list, then run adapter" two-step
 * shape but goes through `javaLangPack` + `springBootFrameworkPack`.
 */
function runV3Pipeline(
  files: Map<string, string>,
  runId: string,
) {
  const irFiles = javaLangPack.extract(files, SPRING_BOOT_HINTS);
  return springBootFrameworkPack.adapt(irFiles, runId, SPRING_BOOT_HINTS);
}

describe('Spring Boot V3 pack pair smoke test', () => {
  const files = new Map<string, string>([
    ['src/main/java/org/example/owner/OwnerController.java', CONTROLLER_SRC],
    ['src/main/java/org/example/owner/Owner.java', ENTITY_SRC],
    ['src/main/java/org/example/owner/OwnerDto.java', DTO_SRC],
    ['src/main/java/org/example/owner/CreateOwnerDto.java', CREATE_DTO_SRC],
  ]);

  let irFiles: Map<string, SourceFileIR>;
  beforeAll(() => {
    irFiles = javaLangPack.extract(files, SPRING_BOOT_HINTS);
    expect(irFiles.size).toBe(4);
  });

  it('parses controller to IR with endpoint methods', () => {
    const controllerIR = irFiles.get('src/main/java/org/example/owner/OwnerController.java')!;
    expect(controllerIR.classes).toHaveLength(1);
    const cls = controllerIR.classes[0];
    expect(cls.name).toBe('OwnerController');
    expect(cls.annotations.some((a) => a.name === 'Controller')).toBe(true);
    expect(cls.methods).toHaveLength(2);
  });

  it('parses JPA entity to IR with fields', () => {
    const entityIR = irFiles.get('src/main/java/org/example/owner/Owner.java')!;
    const cls = entityIR.classes[0];
    expect(cls.name).toBe('Owner');
    expect(cls.annotations.some((a) => a.name === 'Entity')).toBe(true);
    expect(cls.fields.map((f) => f.name)).toEqual(expect.arrayContaining(['id', 'firstName', 'pets']));
  });

  it('adapter emits controller → interface and endpoint candidates', () => {
    const candidates = runV3Pipeline(files, 'test-run');

    const interfaces = candidates.filter((c) => c.candidateType === 'interfaces');
    expect(interfaces).toHaveLength(1);
    expect(interfaces[0].name).toBe('OwnerController');

    const endpoints = candidates.filter((c) => c.candidateType === 'endpoints');
    expect(endpoints).toHaveLength(2);
    const names = endpoints.map((e) => e.name).sort();
    expect(names).toContain('GET /owners/{id}');
    expect(names).toContain('POST /owners');
  });

  it('adapter emits physical_entity + physical_attribute candidates from @Entity', () => {
    const candidates = runV3Pipeline(files, 'test-run');

    const entities = candidates.filter((c) => c.candidateType === 'physical_data_entities');
    expect(entities).toHaveLength(1);
    expect(entities[0].name).toBe('Owner');
    expect(entities[0].data.tableName).toBe('owners');

    const attrs = candidates.filter((c) => c.candidateType === 'physical_data_attributes');
    // id (with @Id) + firstName (with @Column) — pets is a relationship, should be excluded
    expect(attrs.map((a) => a.name).sort()).toEqual(['firstName', 'id']);
    const firstName = attrs.find((a) => a.name === 'firstName')!;
    expect(firstName.data.columnName).toBe('first_name');
    expect(firstName.data.isNullable).toBe(false);
    const id = attrs.find((a) => a.name === 'id')!;
    expect(id.data.isPrimaryKey).toBe(true);
  });

  it('adapter emits entity_relationship from @OneToMany', () => {
    const candidates = runV3Pipeline(files, 'test-run');
    const rels = candidates.filter((c) => c.candidateType === 'logical_data_entity_relationships');
    expect(rels).toHaveLength(1);
    expect(rels[0].name).toBe('Owner → Pet');
    expect(rels[0].data.cardinality).toBe('ONE_TO_MANY');
  });

  it('adapter emits logical_entity + logical_data_attribute for DTOs referenced by endpoints', () => {
    const candidates = runV3Pipeline(files, 'test-run');

    const logicals = candidates.filter((c) => c.candidateType === 'logical_data_entities');
    expect(logicals.map((l) => l.name).sort()).toEqual(['CreateOwnerDto', 'OwnerDto']);

    const lattrs = candidates.filter((c) => c.candidateType === 'logical_data_attributes');
    // OwnerDto: id, firstName / CreateOwnerDto: firstName, lastName
    expect(lattrs).toHaveLength(4);
    expect(lattrs.map((a) => a.name).sort()).toEqual(['firstName', 'firstName', 'id', 'lastName']);
  });

  it('logical_entity is not emitted for @Entity classes (they are physical_entity)', () => {
    // Owner is a JPA @Entity — even though it could match a DTO name pattern,
    // it should not be emitted as logical_entity.
    const candidates = runV3Pipeline(files, 'test-run');
    const logicalNames = candidates
      .filter((c) => c.candidateType === 'logical_data_entities')
      .map((c) => c.name);
    expect(logicalNames).not.toContain('Owner');
  });
});

// ---------------------------------------------------------------------------
// @MappedSuperclass inheritance traversal
// ---------------------------------------------------------------------------

const BASE_ENTITY_SRC = `
package org.example.model;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.Id;
import jakarta.persistence.Column;

@MappedSuperclass
public abstract class BaseEntity {
    @Id
    private Integer id;
}
`;

const NAMED_ENTITY_SRC = `
package org.example.model;
import jakarta.persistence.MappedSuperclass;
import jakarta.persistence.Column;

@MappedSuperclass
public abstract class NamedEntity extends BaseEntity {
    @Column(name = "name", nullable = false)
    private String name;
}
`;

const PET_TYPE_SRC = `
package org.example.owner;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.example.model.NamedEntity;

@Entity
@Table(name = "types")
public class PetType extends NamedEntity {
}
`;

describe('@MappedSuperclass inheritance traversal (V3 pack pair)', () => {
  it('emits inherited physical_attribute candidates from @MappedSuperclass chain', () => {
    const files = new Map<string, string>([
      ['src/main/java/org/example/model/BaseEntity.java', BASE_ENTITY_SRC],
      ['src/main/java/org/example/model/NamedEntity.java', NAMED_ENTITY_SRC],
      ['src/main/java/org/example/owner/PetType.java', PET_TYPE_SRC],
    ]);
    const candidates = runV3Pipeline(files, 'inh-test');

    // PetType is the @Entity. It should inherit `id` from BaseEntity and `name` from NamedEntity.
    const attrs = candidates.filter((c: any) => c.candidateType === 'physical_data_attributes');
    const attrsByName: Record<string, any> = {};
    for (const a of attrs) attrsByName[a.name] = a;

    expect(Object.keys(attrsByName).sort()).toEqual(['id', 'name']);
    expect(attrsByName.id.data.inheritedFrom).toBe('BaseEntity');
    expect(attrsByName.id.data.entityClassName).toBe('PetType');
    expect(attrsByName.id.data.isPrimaryKey).toBe(true);
    expect(attrsByName.name.data.inheritedFrom).toBe('NamedEntity');
    expect(attrsByName.name.data.entityClassName).toBe('PetType');
    expect(attrsByName.name.data.isNullable).toBe(false);
  });

  it('stops walking when the parent is NOT annotated @MappedSuperclass', () => {
    const plainBase = `
      package org.example.model;
      public abstract class PlainBase {
        private Integer id;
      }
    `;
    const entity = `
      package org.example.owner;
      import jakarta.persistence.Entity;
      import org.example.model.PlainBase;
      @Entity
      public class Owner extends PlainBase {
      }
    `;
    const files = new Map<string, string>([
      ['src/main/java/org/example/model/PlainBase.java', plainBase],
      ['src/main/java/org/example/owner/Owner.java', entity],
    ]);
    const candidates = runV3Pipeline(files, 'inh-test');
    const attrs = candidates.filter((c: any) => c.candidateType === 'physical_data_attributes');
    expect(attrs).toHaveLength(0);
  });

  it('child field overrides an inherited field of the same name', () => {
    const parent = `
      package org.example.model;
      import jakarta.persistence.MappedSuperclass;
      import jakarta.persistence.Column;
      @MappedSuperclass
      public abstract class Base {
        @Column(name = "inherited_name")
        protected String name;
      }
    `;
    const child = `
      package org.example.owner;
      import jakarta.persistence.Entity;
      import jakarta.persistence.Column;
      import org.example.model.Base;
      @Entity
      public class Owner extends Base {
        @Column(name = "owner_name")
        private String name;
      }
    `;
    const files = new Map<string, string>([
      ['src/main/java/org/example/model/Base.java', parent],
      ['src/main/java/org/example/owner/Owner.java', child],
    ]);
    const candidates = runV3Pipeline(files, 'inh-test');
    const attrs = candidates.filter((c: any) => c.candidateType === 'physical_data_attributes' && c.name === 'name');
    expect(attrs).toHaveLength(1);
    expect(attrs[0].data.columnName).toBe('owner_name'); // child wins
    expect(attrs[0].data.inheritedFrom).toBeUndefined();
  });
});
