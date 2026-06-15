/**
 * Tests for the spring-classic adapter improvements landed on 2026-04-28:
 *
 *   P1 — business_logics gate widened to @Component + @Transactional + new
 *        domain-flavoured name suffixes (Processor, Calculator, Engine).
 *        Plumbing classes (Formatter, Converter, …) still excluded by the
 *        deny-list.
 *   P2 — emitLogicalEntities second pass detects DTOs by name suffix
 *        (*View, *Dto, *Request, *Response, *Form, *Command).
 *   P3 — emitLogicalEntityRelationships infers relationships between
 *        emitted logical entities from typed fields.
 *   P4 — Lombok @Data / @Value / @Builder treated as DTO markers.
 *   P6 — JdbcTemplate/SQL-based physical entity detection for non-JPA
 *        classic Spring services.
 */
import { javaLangPack } from '../services/extensionPacks/languagePacks/javaLangPack';
import { springClassicFrameworkPack } from '../services/extensionPacks/frameworkPacks/springClassicFrameworkPack';
import type { TechHints } from '../services/extensionPacks';
import type { DiscoveryCandidate } from '../types/candidate';

const HINTS: TechHints = {
  '0': { language: 'Java' },
  '1': { technology: 'Spring' },
};

function run(files: Map<string, string>, runId: string): DiscoveryCandidate[] {
  const ir = javaLangPack.extract(files, HINTS);
  return springClassicFrameworkPack.adapt(ir, runId, HINTS);
}

// =============================================================================
// P1 — business_logics gate widening
// =============================================================================

describe('spring-classic P1 — business_logics gate widening', () => {
  it('emits a @Component class as business_logics when not on the deny-list', () => {
    const src = `package x;
import org.springframework.stereotype.Component;
@Component
public class TradeRouter {
  public String route(String tradeId) { return null; }
}`;
    const cs = run(new Map([['TradeRouter.java', src]]), 'r');
    const m = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'route');
    expect(m).toBeDefined();
  });

  it('does NOT emit a @Component class on the deny-list (TradeFormatter)', () => {
    const src = `package x;
import org.springframework.stereotype.Component;
@Component
public class TradeFormatter {
  public String format(Object t) { return null; }
}`;
    const cs = run(new Map([['TradeFormatter.java', src]]), 'r');
    const blogics = cs.filter((c) => c.candidateType === 'business_logics');
    expect(blogics.length).toBe(0);
  });

  it('emits a @Transactional class even without a stereotype annotation', () => {
    // The class name `TradeBookingFlow` deliberately doesn't match
    // SERVICE_NAME_SUFFIX_RE — the only thing letting it through the gate
    // is the class-level `@Transactional`.
    const src = `package x;
import org.springframework.transaction.annotation.Transactional;
@Transactional
public class TradeBookingFlow {
  public void book(String tradeId) {}
}`;
    const cs = run(new Map([['TradeBookingFlow.java', src]]), 'r');
    const m = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'book');
    expect(m).toBeDefined();
  });

  it('emits a class whose only @Transactional is on a method, not the class', () => {
    const src = `package x;
import org.springframework.transaction.annotation.Transactional;
public class OrderFlow {
  @Transactional
  public void place(String orderId) {}
  public void preview() {}
}`;
    const cs = run(new Map([['OrderFlow.java', src]]), 'r');
    const names = cs.filter((c) => c.candidateType === 'business_logics').map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['place', 'preview']));
  });

  it.each(['Processor', 'Calculator', 'Engine'])(
    'emits a class with name suffix %s',
    (suffix) => {
      const className = `Trade${suffix}`;
      const src = `package x;\npublic class ${className} {\n  public void run() {}\n}`;
      const cs = run(new Map([[`${className}.java`, src]]), 'r');
      const m = cs.find((c) => c.candidateType === 'business_logics' && c.name === 'run');
      expect(m).toBeDefined();
    },
  );

  it.each(['Builder', 'Factory', 'Helper'])(
    'does NOT emit a class with the deliberately-excluded suffix %s',
    (suffix) => {
      const className = `Trade${suffix}`;
      const src = `package x;\npublic class ${className} {\n  public void build() {}\n}`;
      const cs = run(new Map([[`${className}.java`, src]]), 'r');
      const blogics = cs.filter((c) => c.candidateType === 'business_logics');
      expect(blogics.length).toBe(0);
    },
  );
});

// =============================================================================
// P2 — DTO suffix detection
// =============================================================================

describe('spring-classic P2 — DTO suffix detection', () => {
  it('emits a class ending in *View as logical_data_entities', () => {
    const src = `package x;
public class TradeView {
  private String id;
  private long amount;
}`;
    const cs = run(new Map([['TradeView.java', src]]), 'r');
    const e = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'TradeView');
    expect(e).toBeDefined();
    expect(e!.data.source).toBe('name-suffix');
    const attrs = cs.filter((c) => c.candidateType === 'logical_data_attributes' && c.data.logicalEntityName === 'TradeView');
    expect(attrs.map((a) => a.name).sort()).toEqual(['amount', 'id']);
  });

  it.each(['Dto', 'Request', 'Response', 'Form', 'Command'])(
    'emits a class ending in *%s as logical_data_entities',
    (suffix) => {
      const className = `Order${suffix}`;
      const src = `package x;\npublic class ${className} {\n  private String id;\n}`;
      const cs = run(new Map([[`${className}.java`, src]]), 'r');
      const e = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === className);
      expect(e).toBeDefined();
    },
  );

  it('emits a *View @Entity class as both logical (via JPA mapping) AND physical, linked once', () => {
    // Pre-2026-04-29 behaviour was to emit ONLY a physical row for an
    // @Entity class so the DTO-suffix pass wouldn't double up. With the
    // logical↔physical mapping pass, JPA @Entity classes deliberately emit
    // BOTH a logical and a physical row, joined by the entity-link
    // relationship. The DTO-suffix pass still skips @Entity classes; only
    // the JPA pass owns the logical row, so we expect exactly ONE
    // logical_data_entities row sourced from `jpa-entity`.
    const src = `package x;
import javax.persistence.Entity;
@Entity
public class TradeView {
  private String id;
}`;
    const cs = run(new Map([['TradeView.java', src]]), 'r');
    const logicals = cs.filter((c) => c.candidateType === 'logical_data_entities' && c.name === 'TradeView');
    expect(logicals.length).toBe(1);
    expect(logicals[0].data.source).toBe('jpa-entity');
    const link = cs.find(
      (c) =>
        c.candidateType === 'logical_data_entity_physical_data_entities' &&
        c.data.logicalEntityName === 'TradeView',
    );
    expect(link).toBeDefined();
  });

  it('does NOT emit a *View class with no fields (likely a marker / constants holder)', () => {
    const src = `package x;\npublic class EmptyView { }`;
    const cs = run(new Map([['EmptyView.java', src]]), 'r');
    const e = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'EmptyView');
    expect(e).toBeUndefined();
  });

  it('does NOT emit a name-suggested service class (TradeService) as a logical_data_entity', () => {
    // Service-name suffixes belong to business_logics, not data.
    const src = `package x;
public class TradeService {
  private String name;
  public void run() {}
}`;
    const cs = run(new Map([['TradeService.java', src]]), 'r');
    const e = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'TradeService');
    expect(e).toBeUndefined();
  });
});

// =============================================================================
// P3 — relationships from typed fields
// =============================================================================

describe('spring-classic P3 — logical relationships from typed fields', () => {
  it('emits a ONE_TO_ONE relationship for a plain typed field', () => {
    const files = new Map([
      ['TradeView.java', `package x;
public class TradeView {
  private String id;
  private ClientView client;
}`],
      ['ClientView.java', `package x;
public class ClientView { private String id; }`],
    ]);
    const cs = run(files, 'r');
    const rel = cs.find(
      (c) =>
        c.candidateType === 'logical_data_entity_relationships' &&
        c.data.sourceEntity === 'TradeView' &&
        c.data.targetEntity === 'ClientView',
    );
    expect(rel).toBeDefined();
    expect(rel!.data.cardinality).toBe('ONE_TO_ONE');
    expect(rel!.data.fieldName).toBe('client');
  });

  it('emits a ONE_TO_MANY relationship for a List<X> field', () => {
    const files = new Map([
      ['BasketView.java', `package x;
import java.util.List;
public class BasketView {
  private List<TradeView> trades;
}`],
      ['TradeView.java', `package x;
public class TradeView { private String id; }`],
    ]);
    const cs = run(files, 'r');
    const rel = cs.find(
      (c) =>
        c.candidateType === 'logical_data_entity_relationships' &&
        c.data.sourceEntity === 'BasketView' &&
        c.data.targetEntity === 'TradeView',
    );
    expect(rel).toBeDefined();
    expect(rel!.data.cardinality).toBe('ONE_TO_MANY');
  });

  it('dedupes (source, target) pairs when multiple fields point to the same target', () => {
    const files = new Map([
      ['TradeView.java', `package x;
public class TradeView {
  private ClientView buyer;
  private ClientView seller;
}`],
      ['ClientView.java', `package x;
public class ClientView { private String id; }`],
    ]);
    const cs = run(files, 'r');
    const rels = cs.filter(
      (c) =>
        c.candidateType === 'logical_data_entity_relationships' &&
        c.data.sourceEntity === 'TradeView' &&
        c.data.targetEntity === 'ClientView',
    );
    expect(rels.length).toBe(1);
  });

  it('does not emit relationships to non-emitted entities', () => {
    const files = new Map([
      ['TradeView.java', `package x;
public class TradeView { private SomeUnrelatedType ref; }`],
    ]);
    const cs = run(files, 'r');
    const rels = cs.filter((c) => c.candidateType === 'logical_data_entity_relationships');
    expect(rels.length).toBe(0);
  });

  it('does not emit a self-reference relationship', () => {
    const files = new Map([
      ['TreeView.java', `package x;
public class TreeView {
  private TreeView parent;
  private String name;
}`],
    ]);
    const cs = run(files, 'r');
    const selfRels = cs.filter(
      (c) =>
        c.candidateType === 'logical_data_entity_relationships' &&
        c.data.sourceEntity === 'TreeView' &&
        c.data.targetEntity === 'TreeView',
    );
    expect(selfRels.length).toBe(0);
  });
});

// =============================================================================
// P4 — Lombok DTO detection
// =============================================================================

describe('spring-classic P4 — Lombok DTO detection', () => {
  it('emits a @Data class as a logical_data_entity even without a DTO suffix', () => {
    const src = `package x;
import lombok.Data;
@Data
public class Trade {
  private String id;
  private double amount;
}`;
    const cs = run(new Map([['Trade.java', src]]), 'r');
    const e = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'Trade');
    expect(e).toBeDefined();
    expect(e!.data.source).toBe('lombok');
  });

  it('emits a @Value class as a logical_data_entity', () => {
    const src = `package x;
import lombok.Value;
@Value
public class Money { private long amount; }`;
    const cs = run(new Map([['Money.java', src]]), 'r');
    const e = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'Money');
    expect(e).toBeDefined();
  });

  it('emits a @Builder class as a logical_data_entity', () => {
    const src = `package x;
import lombok.Builder;
@Builder
public class Quote { private String symbol; }`;
    const cs = run(new Map([['Quote.java', src]]), 'r');
    const e = cs.find((c) => c.candidateType === 'logical_data_entities' && c.name === 'Quote');
    expect(e).toBeDefined();
  });
});

// =============================================================================
// P6 — JdbcTemplate / SQL-based physical entity detection
// =============================================================================

describe('spring-classic P6 — JdbcTemplate-based physical entity detection', () => {
  it('emits physical_data_entities for tables in a JdbcTemplate-bearing class', () => {
    const src = `package x;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
public class TradeRepository {
  private JdbcTemplate jdbc;
  public Trade findById(String id) {
    return jdbc.queryForObject("SELECT id, amount FROM trades WHERE id = ?", new Object[]{id}, null);
  }
  public void save(Trade t) {
    jdbc.update("INSERT INTO trades (id, amount) VALUES (?, ?)", t.id, t.amount);
  }
  public void delete(String id) {
    jdbc.update("DELETE FROM trades WHERE id = ?", id);
  }
  public void rename(String id) {
    jdbc.update("UPDATE trade_audit SET note = 'renamed' WHERE trade_id = ?", id);
  }
}`;
    const cs = run(new Map([['TradeRepository.java', src]]), 'r');
    const tables = cs
      .filter((c) => c.candidateType === 'physical_data_entities' && c.data.source === 'jdbc-sql')
      .map((c) => String(c.data.tableName));
    expect(tables).toEqual(expect.arrayContaining(['trades', 'trade_audit']));
  });

  it('does NOT emit JDBC-derived entities from an admin/diagnostic class', () => {
    const src = `package x;
import org.springframework.jdbc.core.JdbcTemplate;
public class CacheStat {
  private JdbcTemplate jdbc;
  public long countCacheRows() {
    return jdbc.queryForObject("SELECT COUNT(*) FROM cache_metadata", Long.class);
  }
}`;
    const cs = run(new Map([['CacheStat.java', src]]), 'r');
    const tables = cs.filter((c) => c.candidateType === 'physical_data_entities' && c.data.source === 'jdbc-sql');
    expect(tables.length).toBe(0);
  });

  it('does NOT double-emit when a JPA @Entity already covers the same table', () => {
    const files = new Map([
      ['Trade.java', `package x;
import javax.persistence.Entity;
import javax.persistence.Table;
@Entity
@Table(name = "trades")
public class Trade { private String id; }`],
      ['TradeRepository.java', `package x;
import org.springframework.jdbc.core.JdbcTemplate;
public class TradeRepository {
  private JdbcTemplate jdbc;
  public void touch() { jdbc.update("UPDATE trades SET amount = 0"); }
}`],
    ]);
    const cs = run(files, 'r');
    const tradesEntities = cs.filter(
      (c) => c.candidateType === 'physical_data_entities' && (c.data.tableName === 'trades' || c.name === 'Trade'),
    );
    // JPA emission is one (the @Entity row); the JDBC pass should skip the
    // "trades" name because it's already covered.
    expect(tradesEntities.length).toBe(1);
    expect(tradesEntities[0].data.source).not.toBe('jdbc-sql');
  });

  it('does NOT emit a class without JdbcTemplate (no false positives from a SELECT-shaped string elsewhere)', () => {
    const src = `package x;
public class Logger {
  public String describe() { return "SELECT something FROM somewhere"; }
}`;
    const cs = run(new Map([['Logger.java', src]]), 'r');
    const tables = cs.filter((c) => c.candidateType === 'physical_data_entities' && c.data.source === 'jdbc-sql');
    expect(tables.length).toBe(0);
  });

  it('rejects SQL reserved words as table names', () => {
    const src = `package x;
import org.springframework.jdbc.core.JdbcTemplate;
public class TradeRepository {
  private JdbcTemplate jdbc;
  public void run() {
    // FROM WHERE is broken SQL but the parser shouldn't emit "WHERE" as a table.
    jdbc.update("DELETE FROM customers WHERE id IS NULL");
  }
}`;
    const cs = run(new Map([['TradeRepository.java', src]]), 'r');
    const names = cs.filter((c) => c.candidateType === 'physical_data_entities').map((c) => c.name);
    expect(names).toContain('customers');
    expect(names).not.toContain('WHERE');
    expect(names).not.toContain('NULL');
  });
});

// =============================================================================
// Logical↔physical mapping emission (item 1, 2026-04-29)
//
// JPA `@Entity` and Hibernate HBM-XML produce both halves of the model:
// the in-memory class (logical) and the persisted table (physical). The
// adapter now emits the paired logical entity + the link relationships.
// =============================================================================

describe('spring-classic — logical↔physical mapping emission', () => {
  it('emits paired logical entity + entity-link for a JPA @Entity', () => {
    const src = `package x;
import javax.persistence.Entity;
import javax.persistence.Table;
import javax.persistence.Id;
import javax.persistence.Column;
@Entity
@Table(name = "customers")
public class Customer {
  @Id
  private Long id;
  @Column(name = "full_name")
  private String fullName;
}`;
    const cs = run(new Map([['Customer.java', src]]), 'r');

    const physicalEntity = cs.find(
      (c) => c.candidateType === 'physical_data_entities' && c.name === 'Customer',
    );
    expect(physicalEntity).toBeDefined();

    const logicalEntity = cs.find(
      (c) => c.candidateType === 'logical_data_entities' && c.name === 'Customer',
    );
    expect(logicalEntity).toBeDefined();
    expect(logicalEntity!.data.source).toBe('jpa-entity');

    const entityLink = cs.find(
      (c) =>
        c.candidateType === 'logical_data_entity_physical_data_entities' &&
        c.data.logicalEntityName === 'Customer' &&
        c.data.physicalEntityName === 'Customer',
    );
    expect(entityLink).toBeDefined();
    expect(entityLink!.data.physicalTableName).toBe('customers');
  });

  it('emits paired logical attributes + attribute-links for each JPA field', () => {
    const src = `package x;
import javax.persistence.Entity;
import javax.persistence.Id;
import javax.persistence.Column;
@Entity
public class Customer {
  @Id
  private Long id;
  @Column(name = "full_name")
  private String fullName;
}`;
    const cs = run(new Map([['Customer.java', src]]), 'r');

    const logicalAttrs = cs.filter(
      (c) =>
        c.candidateType === 'logical_data_attributes' &&
        c.data.logicalEntityName === 'Customer',
    );
    expect(logicalAttrs.map((c) => c.name).sort()).toEqual(['fullName', 'id']);
    for (const a of logicalAttrs) {
      expect(a.data.source).toBe('jpa-entity');
    }

    const attrLinks = cs.filter(
      (c) =>
        c.candidateType === 'logical_data_attribute_physical_data_attributes' &&
        c.data.logicalEntityName === 'Customer',
    );
    expect(attrLinks.length).toBe(2);
    const idLink = attrLinks.find((c) => c.data.logicalAttributeName === 'id');
    expect(idLink).toBeDefined();
    expect(idLink!.data.physicalColumnName).toBe('id'); // no @Column → defaults to field name
    const nameLink = attrLinks.find((c) => c.data.logicalAttributeName === 'fullName');
    expect(nameLink).toBeDefined();
    expect(nameLink!.data.physicalColumnName).toBe('full_name');
  });

  it('emits mapping rows for an HBM-XML mapped POJO (no @Entity annotation)', async () => {
    const POJO = `package org.openmrs;
public class Patient {
  private Integer patientId;
  private String gender;
  private Person person;
}
`;
    const HBM = `<?xml version="1.0"?>
<!DOCTYPE hibernate-mapping PUBLIC "-//Hibernate/Hibernate Mapping DTD 3.1//EN"
 "http://www.hibernate.org/dtd/hibernate-mapping-3.0.dtd">
<hibernate-mapping package="org.openmrs">
  <class name="Patient" table="patient">
    <id name="patientId" type="java.lang.Integer" column="patient_id"/>
    <property name="gender" type="string" column="gender"/>
    <many-to-one name="person" class="Person" column="person_id"/>
  </class>
</hibernate-mapping>`;
    const sourceFiles = new Map<string, string>();
    sourceFiles.set('api/src/main/java/org/openmrs/Patient.java', POJO);
    sourceFiles.set('api/src/main/resources/org/openmrs/Patient.hbm.xml', HBM);
    const cs = run(sourceFiles, 'r');

    const logical = cs.find(
      (c) => c.candidateType === 'logical_data_entities' && c.name === 'Patient',
    );
    expect(logical).toBeDefined();
    expect(logical!.data.source).toBe('jpa-entity');

    const entityLink = cs.find(
      (c) =>
        c.candidateType === 'logical_data_entity_physical_data_entities' &&
        c.data.logicalEntityName === 'Patient',
    );
    expect(entityLink).toBeDefined();
    expect(entityLink!.data.physicalTableName).toBe('patient');

    const idLink = cs.find(
      (c) =>
        c.candidateType === 'logical_data_attribute_physical_data_attributes' &&
        c.data.logicalAttributeName === 'patientId',
    );
    expect(idLink).toBeDefined();
    expect(idLink!.data.physicalColumnName).toBe('patient_id');
  });

  it('emits zero mapping rows for a service with no JPA / HBM (absence-is-correct)', () => {
    const src = `package x;
import org.springframework.stereotype.Service;
@Service
public class GreetingService {
  public String greet(String who) { return "hello " + who; }
}`;
    const cs = run(new Map([['GreetingService.java', src]]), 'r');
    const links = cs.filter(
      (c) =>
        c.candidateType === 'logical_data_entity_physical_data_entities' ||
        c.candidateType === 'logical_data_attribute_physical_data_attributes',
    );
    expect(links.length).toBe(0);
  });

  it('does NOT emit mapping rows for JDBC-derived physical entities (no Java class to source the logical from)', () => {
    const src = `package x;
import org.springframework.jdbc.core.JdbcTemplate;
public class TradeRepository {
  private JdbcTemplate jdbc;
  public void touch() { jdbc.update("UPDATE trades SET amount = 0"); }
}`;
    const cs = run(new Map([['TradeRepository.java', src]]), 'r');
    const jdbcEntity = cs.find(
      (c) => c.candidateType === 'physical_data_entities' && c.data.source === 'jdbc-sql',
    );
    expect(jdbcEntity).toBeDefined();
    const entityLinksForTrades = cs.filter(
      (c) => c.candidateType === 'logical_data_entity_physical_data_entities',
    );
    expect(entityLinksForTrades.length).toBe(0);
  });

  it('reuses an existing logical_data_entities when the JPA class also matched a DTO suffix', () => {
    // Edge case: an @Entity class whose name happens to end with "Dto"
    // (rare but possible). emitLogicalEntities skips @Entity classes, so
    // this should not produce a duplicate logical entity — the JPA pass
    // owns the logical row and emits exactly one of each.
    const src = `package x;
import javax.persistence.Entity;
import javax.persistence.Id;
@Entity
public class CustomerDto {
  @Id
  private Long id;
}`;
    const cs = run(new Map([['CustomerDto.java', src]]), 'r');
    const logicals = cs.filter(
      (c) => c.candidateType === 'logical_data_entities' && c.name === 'CustomerDto',
    );
    expect(logicals.length).toBe(1);
  });
});
