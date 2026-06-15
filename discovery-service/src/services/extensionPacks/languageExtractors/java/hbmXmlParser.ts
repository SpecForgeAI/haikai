/**
 * Hibernate HBM XML parser.
 *
 * Bug 17 fix (2026-04-22): classic Spring + Hibernate projects (e.g. OpenMRS)
 * declare persisted entities via `*.hbm.xml` resource files rather than
 * JPA annotations. The Java source for those classes is plain POJOs with
 * no `@Entity`, so the spring-classic framework pack previously missed
 * them entirely (OpenMRS: 20 HBM-mapped entities invisible to the pack).
 *
 * This module performs a minimal, dependency-free parse of HBM XML files
 * to extract:
 *  - `<class name="X" table="t">` — entity class name + DB table
 *  - `<property name="y" column="c" type="T">` — scalar attribute
 *  - `<id name="z" type="..">` — primary key attribute
 *  - `<many-to-one name="w">`, `<one-to-many>`, `<one-to-one>` — relationships
 *
 * We do NOT use an XML library — HBM XML is simple enough to parse with
 * regex for our needs, avoiding a new dependency. The parser is tolerant
 * of comments, CDATA, and the Hibernate DOCTYPE.
 *
 * The extracted information is later injected into the corresponding
 * Java class's `ClassIR` (via a post-processing pass in the Java
 * language pack) as synthetic `@Entity`, `@Column`, `@OneToMany`,
 * `@ManyToOne`, `@OneToOne` annotations. The framework pack then
 * consumes those synthetic annotations exactly as it would real ones,
 * so no adapter changes are needed.
 */

/**
 * Structured result of parsing a single `*.hbm.xml` file.
 *
 * One file may declare multiple `<class>` blocks; each becomes a
 * `HbmClassMapping` entry.
 */
export interface HbmClassMapping {
  /** Simple class name as declared in `<class name="...">`. May include a
   * package prefix when the mapping uses fully-qualified names; the Java
   * class merge step strips the prefix and matches on the simple name. */
  className: string;
  /** DB table name — NULL when `<class>` has no `table` attribute. */
  tableName: string | null;
  /** Scalar properties (including `<id>` — marked via `isPrimaryKey`). */
  properties: HbmProperty[];
  /** Associations (`many-to-one`, `one-to-many`, `one-to-one`). */
  relationships: HbmRelationship[];
  /**
   * Inheritance form. Distinguishes plain `<class>` from
   * `<joined-subclass>` / `<subclass>` / `<union-subclass>`. Used by the
   * merge step to decide whether the entity should pick up parent fields
   * (joined-subclass = own table; subclass = parent table; union-subclass
   * = own table without FK).
   */
  mappingForm: 'class' | 'joined-subclass' | 'subclass' | 'union-subclass';
  /** Parent class name when `mappingForm !== 'class'`, from `extends="..."`. */
  extendsClass: string | null;
}

export interface HbmProperty {
  name: string;
  /** Hibernate type (e.g. `java.lang.Integer`, `string`). Null when absent. */
  type: string | null;
  /** DB column name. Null when absent (Hibernate would default to property name). */
  column: string | null;
  isPrimaryKey: boolean;
}

export interface HbmRelationship {
  /** Relationship field name. */
  name: string;
  /** Java type of the other end (from `class="..."` attribute). Null when absent. */
  targetClass: string | null;
  /** Relationship flavour. */
  kind: 'ManyToOne' | 'OneToMany' | 'OneToOne';
}

/**
 * Strip XML comments and CDATA to simplify downstream regex matching.
 */
function stripComments(xml: string): string {
  return xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
}

/**
 * Extract the value of an XML attribute from a tag-open fragment. Tolerant
 * of single / double quotes and arbitrary whitespace.
 */
function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`);
  const m = tag.match(re);
  if (!m) return null;
  return m[1] ?? m[2] ?? null;
}

/**
 * Normalise a possibly package-qualified class name down to the simple
 * name used on the Java side of the merge (`org.openmrs.Concept` →
 * `Concept`).
 */
function simpleName(qualified: string | null): string | null {
  if (!qualified) return qualified;
  const dot = qualified.lastIndexOf('.');
  return dot >= 0 ? qualified.slice(dot + 1) : qualified;
}

/**
 * Parse a single `*.hbm.xml` file's contents and return one entry per
 * top-level `<class>` block.
 *
 * The implementation uses a streaming-style regex scan over the stripped
 * XML. It walks `<class>` openers and, for each, gathers every
 * `<property>`/`<id>`/`<many-to-one>`/`<one-to-many>`/`<one-to-one>`
 * element up to the matching `</class>` close. This handles `<set>`
 * wrappers too (their inner `<one-to-many>` becomes a relationship on
 * the enclosing class).
 */
export function parseHbmXml(xmlContent: string): HbmClassMapping[] {
  const xml = stripComments(xmlContent);
  const results: HbmClassMapping[] = [];

  // Match all four Hibernate class-mapping forms. OpenMRS uses
  // `<joined-subclass>` at the file root for entities that inherit from a
  // base entity (Patient extends Person, Provider extends Person). It also
  // nests `<joined-subclass>` blocks inside a `<class>` (Concept has
  // ConceptComplex and ConceptNumeric as joined subclasses). Both shapes
  // need their own HbmClassMapping; the per-form opener regex iterates
  // independently so neither shape is missed.
  type Form = 'class' | 'joined-subclass' | 'subclass' | 'union-subclass';
  const FORM_RES: Array<{ form: Form; re: RegExp }> = [
    { form: 'class', re: /<class\b([^>]*)>/g },
    { form: 'joined-subclass', re: /<joined-subclass\b([^>]*)>/g },
    { form: 'subclass', re: /<subclass\b([^>]*)>/g },
    { form: 'union-subclass', re: /<union-subclass\b([^>]*)>/g },
  ];

  for (const { form, re } of FORM_RES) {
    re.lastIndex = 0;
    let openMatch: RegExpExecArray | null;
    while ((openMatch = re.exec(xml)) !== null) {
      const openTag = openMatch[0];
      const className = simpleName(attr(openTag, 'name'));
      if (!className) continue;
      const tableName = attr(openTag, 'table');
      const extendsClass = simpleName(attr(openTag, 'extends'));
      const closeTag = `</${form}>`;
      const closeIdx = xml.indexOf(closeTag, re.lastIndex);
      const bodyEnd = closeIdx >= 0 ? closeIdx : xml.length;
      // Strip any nested subclass blocks from this body so their property /
      // id / relationship elements don't leak onto this entity. Each nested
      // subclass will be picked up by its own form's iteration.
      const body = stripNestedSubclassBlocks(
        xml.slice(re.lastIndex, bodyEnd),
      );

    const properties: HbmProperty[] = [];
    const relationships: HbmRelationship[] = [];

    // <id> — primary key scalar
    const idRe = /<id\b([^/>]*)(?:\/\s*>|>[\s\S]*?<\/id\s*>)/g;
    let m: RegExpExecArray | null;
    while ((m = idRe.exec(body)) !== null) {
      const name = attr(m[1], 'name');
      if (!name) continue;
      properties.push({
        name,
        type: attr(m[1], 'type'),
        column: attr(m[1], 'column'),
        isPrimaryKey: true,
      });
    }

    // <property> — scalar, plus optional nested <column>
    const propRe = /<property\b([^/>]*)(?:\/\s*>|>[\s\S]*?<\/property\s*>)/g;
    while ((m = propRe.exec(body)) !== null) {
      const name = attr(m[1], 'name');
      if (!name) continue;
      properties.push({
        name,
        type: attr(m[1], 'type'),
        column: attr(m[1], 'column'),
        isPrimaryKey: false,
      });
    }

    // <many-to-one>
    const m2oRe = /<many-to-one\b([^/>]*)(?:\/\s*>|>[\s\S]*?<\/many-to-one\s*>)/g;
    while ((m = m2oRe.exec(body)) !== null) {
      const name = attr(m[1], 'name');
      if (!name) continue;
      relationships.push({
        name,
        targetClass: simpleName(attr(m[1], 'class')),
        kind: 'ManyToOne',
      });
    }

    // <one-to-one>
    const o2oRe = /<one-to-one\b([^/>]*)(?:\/\s*>|>[\s\S]*?<\/one-to-one\s*>)/g;
    while ((m = o2oRe.exec(body)) !== null) {
      const name = attr(m[1], 'name');
      if (!name) continue;
      relationships.push({
        name,
        targetClass: simpleName(attr(m[1], 'class')),
        kind: 'OneToOne',
      });
    }

    // <set> / <list> / <bag> / <map> containing <one-to-many> — the
    // collection's `name=` is the property on the owning entity.
    const collectionRe =
      /<(set|list|bag|map|array)\b([^>]*)>([\s\S]*?)<\/\1\s*>/g;
    while ((m = collectionRe.exec(body)) !== null) {
      const collName = attr(m[2], 'name');
      if (!collName) continue;
      const collBody = m[3];
      const o2mMatch = collBody.match(/<one-to-many\b([^/>]*)(?:\/\s*>|>)/);
      const m2mMatch = collBody.match(/<many-to-many\b([^/>]*)(?:\/\s*>|>)/);
      if (o2mMatch) {
        relationships.push({
          name: collName,
          targetClass: simpleName(attr(o2mMatch[1], 'class')),
          kind: 'OneToMany',
        });
      } else if (m2mMatch) {
        // Treat HBM many-to-many as OneToMany for relationship emission
        // (meta-model relationship types are ONE_TO_MANY / MANY_TO_ONE /
        // MANY_TO_MANY at the candidate level; the framework pack's
        // emitter treats OneToMany as the annotation-agnostic flavour).
        relationships.push({
          name: collName,
          targetClass: simpleName(attr(m2mMatch[1], 'class')),
          kind: 'OneToMany',
        });
      }
    }

      results.push({
        className,
        tableName,
        properties,
        relationships,
        mappingForm: form,
        extendsClass,
      });

      // Advance the iterator past this block's closer so we don't re-scan
      // it. Each form has its own regex instance with its own lastIndex.
      if (closeIdx >= 0) {
        re.lastIndex = closeIdx + closeTag.length;
      }
    }
  }

  return results;
}

/**
 * Strip nested subclass blocks (`<joined-subclass>`, `<subclass>`,
 * `<union-subclass>`) from a class body so their inner property / id /
 * relationship elements don't leak onto the parent class's mapping. Each
 * nested subclass will be picked up by its own form's iteration in
 * `parseHbmXml`.
 *
 * Conservative: handles one level of nesting via a non-greedy match. A
 * subclass inside a subclass would partially leak into the outermost
 * parent — rare enough in practice that we accept the limitation rather
 * than implement a full XML balancer here.
 */
function stripNestedSubclassBlocks(body: string): string {
  return body.replace(
    /<(joined-subclass|subclass|union-subclass)\b[^>]*>[\s\S]*?<\/\1\s*>/g,
    '',
  );
}

/**
 * Filename test — `*.hbm.xml` anywhere in the scanned tree.
 */
export function isHbmXmlFile(filePath: string): boolean {
  return /\.hbm\.xml$/i.test(filePath);
}
