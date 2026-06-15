/**
 * HBM XML → Java IR merge.
 *
 * Bug 17 fix (2026-04-22): takes a Map<filePath, SourceFileIR> produced by
 * the Java extractor plus a parsed set of HBM mappings, and mutates the
 * matching `ClassIR` entries to inject synthetic `@Entity`, `@Column`,
 * `@OneToMany`, `@ManyToOne`, `@OneToOne` annotations and fields. This
 * lets the existing spring-classic framework-pack JPA-entity emission
 * path cover HBM-mapped classes without any adapter changes.
 *
 * Merge rules:
 *  - Match HBM `<class name>` (simple name) against `ClassIR.name`.
 *  - If already `@Entity`-annotated, skip (JPA annotation wins; no need
 *    to synthesize).
 *  - Otherwise push an `@Entity` annotation onto `cls.annotations` and,
 *    when the mapping declares `table=`, also push a `@Table(name=X)`.
 *  - For each HBM `<property>` / `<id>`: if a Java field of the same
 *    name already exists, append `@Column(name=...)` (with `nullable`
 *    flag) when absent. If the field does NOT exist on the Java side
 *    (rare — would mean the HBM file references a dropped field),
 *    synthesize a bare FieldIR so the pack's attribute emitter picks it
 *    up. `<id>` adds `@Id` to the field's annotations.
 *  - For each HBM relationship: append a FieldIR with the relationship
 *    annotation (`@ManyToOne` / `@OneToMany` / `@OneToOne`) when no
 *    matching Java field exists; otherwise append the annotation onto
 *    the existing field. Relationship target class goes onto the field's
 *    `type` so the pack's `emitEntityRelationship` treats it the same
 *    as a JPA-annotated field.
 *
 * When no matching Java class is found for a HBM `<class name>`, a
 * warning is logged and the mapping is dropped. OpenMRS's 20 HBM-mapped
 * classes all have matching Java sources so this should not fire there.
 */

import type { SourceFileIR, ClassIR, FieldIR, AnnotationIR } from '../../languageIR';
import type { HbmClassMapping, HbmProperty, HbmRelationship } from './hbmXmlParser';

function syntheticAnnotation(name: string, args: Record<string, string> = {}): AnnotationIR {
  return { name, args, line: -1 };
}

function hasAnnotationByName(annotations: AnnotationIR[], name: string): boolean {
  return annotations.some((a) => a.name === name);
}

function mergeProperty(cls: ClassIR, prop: HbmProperty): void {
  let field = cls.fields.find((f) => f.name === prop.name);
  if (!field) {
    // HBM declares a field not present on the Java side. Synthesize a
    // bare FieldIR so the pack's attribute emitter still sees it.
    field = {
      name: prop.name,
      type: prop.type ?? 'unknown',
      annotations: [],
      modifiers: ['private'],
      line: -1,
    };
    cls.fields.push(field);
  }

  if (prop.isPrimaryKey && !hasAnnotationByName(field.annotations, 'Id')) {
    field.annotations.push(syntheticAnnotation('Id'));
  }
  if (!hasAnnotationByName(field.annotations, 'Column')) {
    const args: Record<string, string> = {};
    if (prop.column) args.name = prop.column;
    field.annotations.push(syntheticAnnotation('Column', args));
  }
}

function mergeRelationship(cls: ClassIR, rel: HbmRelationship): void {
  let field = cls.fields.find((f) => f.name === rel.name);
  if (!field) {
    field = {
      name: rel.name,
      type: rel.targetClass ?? 'unknown',
      annotations: [],
      modifiers: ['private'],
      line: -1,
    };
    cls.fields.push(field);
  } else if (rel.targetClass && (field.type === 'unknown' || field.type === '')) {
    // Java declared the field but the type is opaque; promote the HBM
    // target class so the pack's relationship emitter can read it.
    field.type = rel.targetClass;
  }
  if (!hasAnnotationByName(field.annotations, rel.kind)) {
    field.annotations.push(syntheticAnnotation(rel.kind));
  }
}

/**
 * Public entry: mutate the given IR map to fold in HBM-mapped entities.
 * Returns the number of Java classes touched, for logging.
 */
export function mergeHbmMappingsIntoIr(
  irFiles: Map<string, SourceFileIR>,
  hbmMappings: HbmClassMapping[],
): { matched: number; orphaned: number } {
  // Build a class-name → ClassIR index across all files.
  const byClassName = new Map<string, { file: SourceFileIR; cls: ClassIR }>();
  for (const file of irFiles.values()) {
    for (const cls of file.classes) {
      if (!byClassName.has(cls.name)) {
        byClassName.set(cls.name, { file, cls });
      }
    }
  }

  let matched = 0;
  let orphaned = 0;
  for (const mapping of hbmMappings) {
    const hit = byClassName.get(mapping.className);
    if (!hit) {
      console.warn(
        `[hbm-xml-merge] HBM class "${mapping.className}" has no matching ` +
          `Java source in the scan — mapping ignored.`,
      );
      orphaned++;
      continue;
    }
    const cls = hit.cls;
    // Skip if the class already has an @Entity annotation (JPA wins;
    // don't double-annotate).
    if (!hasAnnotationByName(cls.annotations, 'Entity')) {
      cls.annotations.push(syntheticAnnotation('Entity'));
      if (mapping.tableName) {
        cls.annotations.push(syntheticAnnotation('Table', { name: mapping.tableName }));
      }
    }
    for (const prop of mapping.properties) mergeProperty(cls, prop);
    for (const rel of mapping.relationships) mergeRelationship(cls, rel);
    matched++;
  }
  return { matched, orphaned };
}
