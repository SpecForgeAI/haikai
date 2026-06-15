/**
 * Tests for the HBM XML parser (Bug 17 fix — 2026-04-22).
 *
 * Covers `<class>` / `<id>` / `<property>` / `<many-to-one>` /
 * `<one-to-many>` / `<one-to-one>` / `<set><one-to-many>` + the
 * Java IR merge that converts mappings to synthetic annotations.
 */

import { parseHbmXml, isHbmXmlFile } from '../services/extensionPacks/languageExtractors/java/hbmXmlParser';
import { mergeHbmMappingsIntoIr } from '../services/extensionPacks/languageExtractors/java/hbmXmlMerge';
import { extractJavaIR } from '../services/extensionPacks/languageExtractors/java';
import type { SourceFileIR } from '../services/extensionPacks/languageIR';

describe('hbmXmlParser.parseHbmXml', () => {
  it('extracts class, table, id, properties, many-to-one, one-to-many', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE hibernate-mapping PUBLIC "-//Hibernate/Hibernate Mapping DTD 3.1//EN"
 "http://www.hibernate.org/dtd/hibernate-mapping-3.0.dtd">
<hibernate-mapping package="org.openmrs">
  <class name="Concept" table="concept" batch-size="25">
    <id name="conceptId" type="java.lang.Integer" column="concept_id">
      <generator class="native"/>
    </id>
    <property name="uuid" type="java.lang.String" column="uuid"/>
    <property name="version" type="java.lang.String" column="version" length="50"/>
    <many-to-one name="datatype" class="ConceptDatatype" column="datatype_id"/>
    <set name="answers" lazy="true" cascade="all-delete-orphan" inverse="true">
      <key column="concept_id"/>
      <one-to-many class="ConceptAnswer"/>
    </set>
  </class>
</hibernate-mapping>
`;
    const [mapping] = parseHbmXml(xml);
    expect(mapping.className).toBe('Concept');
    expect(mapping.tableName).toBe('concept');
    // id + 2 properties = 3
    expect(mapping.properties.map((p) => p.name).sort()).toEqual(['conceptId', 'uuid', 'version']);
    const id = mapping.properties.find((p) => p.name === 'conceptId')!;
    expect(id.isPrimaryKey).toBe(true);
    expect(id.column).toBe('concept_id');
    // Relationships: 1 many-to-one + 1 one-to-many (via set)
    expect(mapping.relationships).toEqual([
      { name: 'datatype', targetClass: 'ConceptDatatype', kind: 'ManyToOne' },
      { name: 'answers', targetClass: 'ConceptAnswer', kind: 'OneToMany' },
    ]);
  });

  it('tolerates DOCTYPE, comments, CDATA', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE hibernate-mapping PUBLIC "-//foo" "bar">
<!-- a top-level comment -->
<hibernate-mapping>
  <!-- a nested comment -->
  <class name="Simple" table="simple">
    <id name="id" column="id" type="java.lang.Long"/>
    <!-- <property name="ignored"/> -->
  </class>
</hibernate-mapping>`;
    const [mapping] = parseHbmXml(xml);
    expect(mapping.className).toBe('Simple');
    expect(mapping.properties).toHaveLength(1);
    expect(mapping.properties[0].name).toBe('id');
  });

  it('strips package prefix on class=org.pkg.Target references', () => {
    const xml = `<?xml version="1.0"?>
<hibernate-mapping>
  <class name="org.pkg.Foo" table="foo">
    <id name="id" type="long"/>
    <many-to-one name="parent" class="org.pkg.Bar"/>
  </class>
</hibernate-mapping>`;
    const [mapping] = parseHbmXml(xml);
    expect(mapping.className).toBe('Foo');
    expect(mapping.relationships[0].targetClass).toBe('Bar');
  });

  it('returns [] for a file with no <class> blocks', () => {
    expect(parseHbmXml('<?xml version="1.0"?><hibernate-mapping></hibernate-mapping>')).toEqual([]);
  });

  it('extracts a root-level <joined-subclass> with extends + table (Patient.hbm.xml shape)', () => {
    // 2026-04-25: regression cover for the OpenMRS HBM merge bug. The
    // Patient.hbm.xml file uses `<joined-subclass extends="Person">` at the
    // root — the previous parser only matched `<class>` and missed it.
    const xml = `<?xml version="1.0"?>
<!DOCTYPE hibernate-mapping PUBLIC "-//Hibernate/Hibernate Mapping DTD 3.0//EN"
 "http://www.hibernate.org/dtd/hibernate-mapping-3.0.dtd">
<hibernate-mapping package="org.openmrs">
  <joined-subclass name="Patient" table="patient" extends="Person">
    <key column="patient_id" not-null="true"/>
    <property name="patientId" type="int" column="patient_id" update="false" insert="false"/>
    <many-to-one name="creator" class="User" column="creator"/>
    <set name="identifiers" lazy="true" cascade="all-delete-orphan" inverse="true">
      <key column="patient_id"/>
      <one-to-many class="PatientIdentifier"/>
    </set>
  </joined-subclass>
</hibernate-mapping>`;
    const mappings = parseHbmXml(xml);
    expect(mappings).toHaveLength(1);
    const [m] = mappings;
    expect(m.className).toBe('Patient');
    expect(m.tableName).toBe('patient');
    expect(m.mappingForm).toBe('joined-subclass');
    expect(m.extendsClass).toBe('Person');
    expect(m.properties.map((p) => p.name).sort()).toEqual(['patientId']);
    expect(m.relationships.find((r) => r.name === 'creator')!.kind).toBe('ManyToOne');
    expect(m.relationships.find((r) => r.name === 'identifiers')!.kind).toBe('OneToMany');
    expect(m.relationships.find((r) => r.name === 'identifiers')!.targetClass).toBe('PatientIdentifier');
  });

  it('extracts nested <joined-subclass> blocks inside a <class> as separate mappings — and does NOT leak their properties to the parent (Concept.hbm.xml shape)', () => {
    // 2026-04-25: regression cover for the second half of the bug. When
    // `<joined-subclass>` is nested inside `<class>`, the parent's body
    // textually includes the subclass content; prior to the fix, the
    // parent's <property> regex would scrape `handler` and `hiAbsolute`
    // from the inner subclasses and attribute them to Concept itself.
    const xml = `<?xml version="1.0"?>
<hibernate-mapping package="org.openmrs">
  <class name="Concept" table="concept">
    <id name="conceptId" type="java.lang.Integer" column="concept_id"/>
    <property name="uuid" type="java.lang.String" column="uuid"/>
    <joined-subclass name="ConceptComplex" table="concept_complex" extends="Concept">
      <key column="concept_id"/>
      <property name="handler" type="java.lang.String" column="handler"/>
    </joined-subclass>
    <joined-subclass name="ConceptNumeric" table="concept_numeric" extends="Concept">
      <key column="concept_id"/>
      <property name="hiAbsolute" type="java.lang.Double" column="hi_absolute"/>
      <property name="lowAbsolute" type="java.lang.Double" column="low_absolute"/>
    </joined-subclass>
  </class>
</hibernate-mapping>`;
    const mappings = parseHbmXml(xml);
    const byName = new Map(mappings.map((m) => [m.className, m]));
    expect(Array.from(byName.keys()).sort()).toEqual(['Concept', 'ConceptComplex', 'ConceptNumeric']);

    // Concept must NOT include `handler` / `hiAbsolute` / `lowAbsolute`.
    const concept = byName.get('Concept')!;
    expect(concept.mappingForm).toBe('class');
    expect(concept.extendsClass).toBeNull();
    const conceptProps = concept.properties.map((p) => p.name).sort();
    expect(conceptProps).toEqual(['conceptId', 'uuid']);

    // ConceptComplex carries only its own `handler` field, with `extends=Concept`.
    const cc = byName.get('ConceptComplex')!;
    expect(cc.mappingForm).toBe('joined-subclass');
    expect(cc.extendsClass).toBe('Concept');
    expect(cc.tableName).toBe('concept_complex');
    expect(cc.properties.map((p) => p.name)).toEqual(['handler']);

    // ConceptNumeric — same shape, with two of its own properties.
    const cn = byName.get('ConceptNumeric')!;
    expect(cn.mappingForm).toBe('joined-subclass');
    expect(cn.extendsClass).toBe('Concept');
    expect(cn.properties.map((p) => p.name).sort()).toEqual(['hiAbsolute', 'lowAbsolute']);
  });
});

describe('isHbmXmlFile', () => {
  it('matches *.hbm.xml', () => {
    expect(isHbmXmlFile('api/src/main/resources/Concept.hbm.xml')).toBe(true);
    expect(isHbmXmlFile('x/Foo.HBM.XML')).toBe(true);
  });
  it('does not match other xml files', () => {
    expect(isHbmXmlFile('web.xml')).toBe(false);
    expect(isHbmXmlFile('Foo.java')).toBe(false);
  });
});

describe('mergeHbmMappingsIntoIr', () => {
  const JAVA_POJO = `
package org.openmrs;
public class Concept {
  private Integer conceptId;
  private String uuid;
  private ConceptDatatype datatype;
}
`;

  function buildIrMap(): Map<string, SourceFileIR> {
    const ir = extractJavaIR('api/org/openmrs/Concept.java', JAVA_POJO)!;
    const m = new Map<string, SourceFileIR>();
    m.set(ir.filePath, ir);
    return m;
  }

  it('adds synthetic @Entity, @Table, @Column, @Id to matching Java class + fields', () => {
    const irs = buildIrMap();
    const { matched, orphaned } = mergeHbmMappingsIntoIr(irs, [
      {
        className: 'Concept',
        tableName: 'concept',
        properties: [
          { name: 'conceptId', type: 'java.lang.Integer', column: 'concept_id', isPrimaryKey: true },
          { name: 'uuid', type: 'java.lang.String', column: 'uuid', isPrimaryKey: false },
        ],
        relationships: [
          { name: 'datatype', targetClass: 'ConceptDatatype', kind: 'ManyToOne' },
        ],
        mappingForm: 'class',
        extendsClass: null,
      },
    ]);
    expect(matched).toBe(1);
    expect(orphaned).toBe(0);

    const cls = Array.from(irs.values())[0].classes[0];
    // Class-level annotations
    const clsAnns = cls.annotations.map((a) => a.name);
    expect(clsAnns).toContain('Entity');
    expect(clsAnns).toContain('Table');

    // Field-level annotations — conceptId gets @Id + @Column
    const pk = cls.fields.find((f) => f.name === 'conceptId')!;
    expect(pk.annotations.map((a) => a.name).sort()).toEqual(['Column', 'Id']);

    // uuid gets @Column
    const uuid = cls.fields.find((f) => f.name === 'uuid')!;
    expect(uuid.annotations.map((a) => a.name)).toContain('Column');

    // datatype gets @ManyToOne
    const dt = cls.fields.find((f) => f.name === 'datatype')!;
    expect(dt.annotations.map((a) => a.name)).toContain('ManyToOne');
  });

  it('does NOT double-annotate classes that already have @Entity', () => {
    const ANNOTATED = `
package org.openmrs;
import jakarta.persistence.Entity;
@Entity
public class Scenario {
  private Integer id;
}
`;
    const ir = extractJavaIR('api/Scenario.java', ANNOTATED)!;
    const m = new Map<string, SourceFileIR>();
    m.set(ir.filePath, ir);
    mergeHbmMappingsIntoIr(m, [
      {
        className: 'Scenario',
        tableName: 'scenario',
        properties: [{ name: 'id', type: 'long', column: 'id', isPrimaryKey: true }],
        relationships: [],
        mappingForm: 'class',
        extendsClass: null,
      },
    ]);
    const cls = Array.from(m.values())[0].classes[0];
    const entityCount = cls.annotations.filter((a) => a.name === 'Entity').length;
    expect(entityCount).toBe(1); // no duplicate @Entity synthesized
  });

  it('records orphaned mappings when the Java class is not in the scan', () => {
    const irs = buildIrMap();
    const { matched, orphaned } = mergeHbmMappingsIntoIr(irs, [
      { className: 'NotInScan', tableName: null, properties: [], relationships: [], mappingForm: 'class', extendsClass: null },
    ]);
    expect(matched).toBe(0);
    expect(orphaned).toBe(1);
  });
});
