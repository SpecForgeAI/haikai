/**
 * SCL shape extractor — `[S-...]` shape contracts from a Java project index.
 *
 * Deterministic (no LLM). One shape contract per project data type:
 *
 *   - Candidates: project CLASSES with >= 1 instance field, plus ALL enums
 *     (representation 'enum', fields = the constants, kind 'enum-constant').
 *     Interfaces are never shapes. Static fields are neither shape fields nor
 *     candidacy evidence (a constants-only holder is not a data shape).
 *   - Field kinds are NEUTRAL SEMANTIC KINDS ('string', 'int64', 'date',
 *     'list<...>', ...); the verbatim legacy carrier is retained as evidence
 *     in `sourceCarrier` where the kind abstracts it (dates, opaque
 *     third-party types).
 *   - References to OTHER project shapes resolve to their S-keys in a second
 *     pass; the content hash is computed AFTER resolution (hash input uses
 *     the referenced keys), so a change in a referenced shape ripples into
 *     the referencing shape's key — reference integrity by construction.
 *   - Deterministic flags: 'mutated_in_flight' (a setter of this shape is
 *     called OUTSIDE the shape's own class and outside any constructor —
 *     record-conversion hazard, note cites file:line), and
 *     'sealed_variant_candidate' (project subclasses exist; discriminator
 *     read from @JsonTypeInfo(property=...) when present).
 *   - Inheritance: project-superclass fields are FLATTENED into the subclass
 *     shape (base-most first, declaration order) with an
 *     'inherited from <Super>' note.
 *
 * Design doc: agent-os/planning/2026-08-18-scl-pipeline-design.md ("SCL",
 * `[S-...]` shape contracts).
 */

import {
  collectNodesOfType,
  type JavaClassInfo,
  type JavaFieldInfo,
  type JavaMethodInfo,
  type JavaProjectIndex,
} from './javaProjectIndex';
import {
  contentHashOf,
  contractKey,
  type SclShapeContract,
  type SclShapeField,
} from './sclTypes';

// ---------------------------------------------------------------------------
// Type resolution
// ---------------------------------------------------------------------------

function stripGenerics(t: string): string {
  const i = t.indexOf('<');
  return (i >= 0 ? t.slice(0, i) : t).trim();
}

function lastSegment(t: string): string {
  const s = stripGenerics(t);
  return s.includes('.') ? s.slice(s.lastIndexOf('.') + 1) : s;
}

function packageOf(fqn: string): string {
  const i = fqn.lastIndexOf('.');
  return i >= 0 ? fqn.slice(0, i) : '';
}

/**
 * Resolves a declared type text to a project class, using (in order): exact
 * FQN, the owner's imports, the owner's own package, then a UNIQUE
 * simple-name match across the project. Null when not a project type.
 */
function resolveProjectType(
  typeText: string,
  owner: JavaClassInfo,
  index: JavaProjectIndex
): JavaClassInfo | null {
  const bare = stripGenerics(typeText);
  if (bare.includes('.')) {
    return index.classesByFqn.get(bare) || null;
  }
  for (const imp of owner.imports) {
    if (imp.endsWith(`.${bare}`)) {
      return index.classesByFqn.get(imp) || null;
    }
  }
  const samePackage = index.classesByFqn.get(`${packageOf(owner.fqn)}.${bare}`);
  if (samePackage) return samePackage;
  const bySimple = index.classesBySimpleName.get(bare) || [];
  return bySimple.length === 1 ? bySimple[0] : null;
}

// ---------------------------------------------------------------------------
// Neutral semantic kind mapping
// ---------------------------------------------------------------------------

interface KindMapping {
  kind: string;
  nullable: boolean | null;
  sourceCarrier: string | null;
  /** Set when the kind is a project-shape reference pending key resolution. */
  refFqn: string | null;
}

const PRIMITIVE_KINDS: Record<string, string> = {
  int: 'int64', long: 'int64', short: 'int64', byte: 'int64',
  boolean: 'boolean',
  double: 'float64', float: 'float64',
};

const BOXED_KINDS: Record<string, string> = {
  String: 'string', CharSequence: 'string',
  Integer: 'int64', Long: 'int64', Short: 'int64', Byte: 'int64',
  Boolean: 'boolean',
  Double: 'float64', Float: 'float64',
  BigDecimal: 'decimal',
  BigInteger: 'integer-wide',
};

/** Legacy date/time carriers → 'date' or 'timestamp' (carrier retained as evidence). */
const DATE_KINDS: Record<string, 'date' | 'timestamp'> = {
  LocalDate: 'date', Date: 'date',
  DateTime: 'timestamp', Calendar: 'timestamp', XMLGregorianCalendar: 'timestamp',
};

/** Splits generic type arguments on TOP-LEVEL commas only (`Map<String, List<X>>`). */
function splitTopLevel(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of args) {
    if (ch === '<') depth++;
    if (ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out;
}

/**
 * Resolves a declared carrier type to its qualified form via the file's
 * imports (e.g. `LocalDate` + `import org.joda.time.LocalDate;` →
 * 'org.joda.time.LocalDate'); already-qualified or unimported names stay
 * verbatim.
 */
function resolveCarrierName(typeText: string, owner: JavaClassInfo): string {
  const bare = stripGenerics(typeText);
  if (bare.includes('.')) return typeText;
  for (const imp of owner.imports) {
    if (imp.endsWith(`.${bare}`)) return imp;
  }
  return typeText;
}

function mapFieldKind(typeText: string, owner: JavaClassInfo, index: JavaProjectIndex): KindMapping {
  const t = typeText.trim();
  const bare = stripGenerics(t);
  const simple = lastSegment(t);

  if (bare in PRIMITIVE_KINDS && bare === t) {
    return { kind: PRIMITIVE_KINDS[bare], nullable: false, sourceCarrier: null, refFqn: null };
  }
  if (simple in BOXED_KINDS && bare === t) {
    return { kind: BOXED_KINDS[simple], nullable: null, sourceCarrier: null, refFqn: null };
  }
  if (simple in DATE_KINDS && bare === t) {
    return { kind: DATE_KINDS[simple], nullable: null, sourceCarrier: resolveCarrierName(t, owner), refFqn: null };
  }

  // List<X> / Set<X> → list<KIND> (recursively neutral)
  const listMatch = t.match(/^(?:java\.util\.)?(?:List|Set|Collection)<(.+)>$/);
  if (listMatch) {
    const inner = mapFieldKind(listMatch[1], owner, index);
    return {
      kind: `list<${inner.kind}>`,
      nullable: null,
      sourceCarrier: inner.sourceCarrier ? t : null,
      refFqn: inner.refFqn,
    };
  }

  // Map<K,V> → map<KIND,KIND>
  const mapMatch = t.match(/^(?:java\.util\.)?Map<(.+)>$/);
  if (mapMatch) {
    const parts = splitTopLevel(mapMatch[1]);
    if (parts.length === 2) {
      const k = mapFieldKind(parts[0], owner, index);
      const v = mapFieldKind(parts[1], owner, index);
      return {
        kind: `map<${k.kind},${v.kind}>`,
        nullable: null,
        sourceCarrier: null,
        // A map can only carry ONE pending ref in this simple model; prefer the value side.
        refFqn: v.refFqn || k.refFqn,
      };
    }
  }

  // Another PROJECT class → shape reference, resolved to an S-key in pass 2.
  const project = resolveProjectType(t, owner, index);
  if (project && bare === t) {
    return { kind: `ref:${project.fqn}`, nullable: null, sourceCarrier: null, refFqn: project.fqn };
  }

  // Anything else third-party → opaque, verbatim carrier retained.
  return { kind: `opaque:${t}`, nullable: null, sourceCarrier: t, refFqn: null };
}

// ---------------------------------------------------------------------------
// Wire-name / annotation argument helpers (verbatim annotation strings)
// ---------------------------------------------------------------------------

/** `@JsonProperty("x")` / `@JsonProperty(value = "x")` → 'x'. */
function jsonPropertyName(annotations: string[]): string | null {
  for (const a of annotations) {
    const m = a.match(/^@JsonProperty\s*\(\s*(?:value\s*=\s*)?"([^"]*)"/);
    if (m) return m[1];
  }
  return null;
}

/** `@XmlElement(name = "x")` → 'x'. */
function xmlElementName(annotations: string[]): string | null {
  for (const a of annotations) {
    const m = a.match(/^@XmlElement\s*\([^)]*name\s*=\s*"([^"]*)"/);
    if (m) return m[1];
  }
  return null;
}

function xmlRootName(annotations: string[]): string | null {
  for (const a of annotations) {
    const m = a.match(/^@XmlRootElement\s*\([^)]*name\s*=\s*"([^"]*)"/);
    if (m) return m[1];
  }
  return null;
}

function jsonTypeInfoDiscriminator(annotations: string[]): string | null {
  for (const a of annotations) {
    const m = a.match(/^@JsonTypeInfo\s*\([^)]*property\s*=\s*"([^"]*)"/);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mutation scan ('mutated_in_flight')
// ---------------------------------------------------------------------------

interface MutationSite { shapeFqn: string; fieldName: string; note: string }

function setterToFieldName(setterName: string): string {
  const rest = setterName.slice(3);
  return rest.charAt(0).toLowerCase() + rest.slice(1);
}

/**
 * The simple deterministic mutated-in-flight scan: any `x.setFoo(...)` where
 * `x`'s DECLARED type (method param, local variable declaration, or field of
 * the calling class) resolves to a shape candidate, the call site is outside
 * that shape's own class, and outside any constructor (we only walk
 * `method_declaration` bodies, so constructors are structurally excluded).
 */
function scanMutations(
  index: JavaProjectIndex,
  candidateFqns: Set<string>
): MutationSite[] {
  const sites: MutationSite[] = [];
  for (const cls of index.classesByFqn.values()) {
    for (const method of cls.methods) {
      if (!method.bodyNode) continue;
      const declaredTypeOf = buildDeclaredTypeLookup(cls, method);
      for (const inv of collectNodesOfType(method.bodyNode, 'method_invocation')) {
        const nameNode = inv.childForFieldName('name');
        const objectNode = inv.childForFieldName('object');
        if (!nameNode || !objectNode) continue;
        if (objectNode.type !== 'identifier') continue;
        const setterName: string = nameNode.text;
        if (!/^set[A-Z]/.test(setterName)) continue;
        const declaredType = declaredTypeOf(objectNode.text);
        if (!declaredType) continue;
        const target = resolveProjectType(declaredType, cls, index);
        if (!target || target.fqn === cls.fqn || !candidateFqns.has(target.fqn)) continue;
        sites.push({
          shapeFqn: target.fqn,
          fieldName: setterToFieldName(setterName),
          note: `mutated in flight: ${setterName} called at ${method.filePath}:${inv.startPosition.row + 1} (${cls.simpleName}.${method.name})`,
        });
      }
    }
  }
  // Deterministic order regardless of discovery order.
  sites.sort((a, b) => (a.note < b.note ? -1 : a.note > b.note ? 1 : 0));
  return sites;
}

/** Declared-type lookup for an identifier: params, then locals, then class fields. */
function buildDeclaredTypeLookup(
  cls: JavaClassInfo,
  method: JavaMethodInfo
): (identifier: string) => string | null {
  const localTypes = new Map<string, string>();
  if (method.bodyNode) {
    for (const local of collectNodesOfType(method.bodyNode, 'local_variable_declaration')) {
      const typeNode = local.childForFieldName('type');
      if (!typeNode) continue;
      for (let i = 0; i < local.namedChildCount; i++) {
        const decl = local.namedChild(i);
        if (!decl || decl.type !== 'variable_declarator') continue;
        const nm = decl.childForFieldName('name');
        if (nm) localTypes.set(nm.text, typeNode.text);
      }
    }
  }
  return (identifier: string): string | null => {
    const paramIdx = method.paramNames.indexOf(identifier);
    if (paramIdx >= 0) return method.paramTypes[paramIdx];
    const local = localTypes.get(identifier);
    if (local) return local;
    const field = cls.fields.find((f) => f.name === identifier);
    return field ? field.type : null;
  };
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

interface PendingShape {
  cls: JavaClassInfo;
  representation: string;
  fields: SclShapeField[];
  /** Per-field pending project-shape reference (parallel to `fields`). */
  fieldRefFqns: Array<string | null>;
  wireFacts: { xmlRootName: string | null; discriminator: string | null };
  flags: string[];
}

function isInstanceField(f: JavaFieldInfo): boolean {
  return !f.modifiers.includes('static') && f.type !== 'enum-constant';
}

/** Project superclass chain, base-most first (for field flattening). */
function projectSuperChain(cls: JavaClassInfo, index: JavaProjectIndex): JavaClassInfo[] {
  const chain: JavaClassInfo[] = [];
  const seen = new Set<string>([cls.fqn]);
  let current: JavaClassInfo | null = cls;
  while (current && current.superClass) {
    const parent: JavaClassInfo | null = resolveProjectType(current.superClass, current, index);
    if (!parent || seen.has(parent.fqn)) break;
    seen.add(parent.fqn);
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

function buildPendingShape(
  cls: JavaClassInfo,
  index: JavaProjectIndex,
  subclassesBySuperFqn: Map<string, string[]>
): PendingShape {
  const fields: SclShapeField[] = [];
  const fieldRefFqns: Array<string | null> = [];

  if (cls.kind === 'enum') {
    for (const constant of cls.fields.filter((f) => f.type === 'enum-constant')) {
      fields.push({
        name: constant.name,
        kind: 'enum-constant',
        nullable: null,
        wireName: null,
        sourceCarrier: null,
        notes: [],
      });
      fieldRefFqns.push(null);
    }
  } else {
    // Flatten project-superclass fields first (base-most first, declaration order).
    const contributors: Array<{ owner: JavaClassInfo; inheritedFrom: string | null }> = [
      ...projectSuperChain(cls, index).map((sup) => ({ owner: sup, inheritedFrom: sup.simpleName })),
      { owner: cls, inheritedFrom: null },
    ];
    for (const { owner, inheritedFrom } of contributors) {
      for (const f of owner.fields.filter(isInstanceField)) {
        const mapping = mapFieldKind(f.type, owner, index);
        const notes: string[] = [];
        if (inheritedFrom) notes.push(`inherited from ${inheritedFrom}`);
        fields.push({
          name: f.name,
          kind: mapping.kind,
          nullable: mapping.nullable,
          wireName: jsonPropertyName(f.annotations) ?? xmlElementName(f.annotations),
          sourceCarrier: mapping.sourceCarrier,
          notes,
        });
        fieldRefFqns.push(mapping.refFqn);
      }
    }
  }

  const hasSetter = cls.methods.some((m) => /^set[A-Z]/.test(m.name));
  const representation = cls.kind === 'enum' ? 'enum' : hasSetter ? 'pojo' : 'immutable';

  const flags: string[] = [];
  const subclasses = subclassesBySuperFqn.get(cls.fqn) || [];
  if (subclasses.length > 0) flags.push('sealed_variant_candidate');

  return {
    cls,
    representation,
    fields,
    fieldRefFqns,
    wireFacts: {
      xmlRootName: xmlRootName(cls.annotations),
      discriminator: jsonTypeInfoDiscriminator(cls.annotations),
    },
    flags,
  };
}

export interface ShapeExtractionResult {
  /** Sorted by symbol (FQN). */
  shapes: SclShapeContract[];
  /** symbol (FQN) → S-key. */
  keyBySymbol: Map<string, string>;
}

/**
 * Extracts all `[S-...]` shape contracts from the project index.
 *
 * Two-pass: pass 1 builds each shape with `ref:<fqn>` placeholder kinds;
 * pass 2 resolves placeholders to actual S-keys in dependency (topological)
 * order and hashes AFTER resolution. Reference cycles (mutually-referencing
 * shapes) fall back to hashing with the stable `ref:<fqn>` placeholder for
 * the cycle-internal edges, then still resolve the OUTPUT kinds/references
 * to keys — deterministic either way.
 */
export function extractShapes(index: JavaProjectIndex): ShapeExtractionResult {
  // Candidates: classes with >=1 instance field, plus all enums. Never interfaces.
  const candidates: JavaClassInfo[] = [];
  for (const cls of index.classesByFqn.values()) {
    if (cls.kind === 'enum') candidates.push(cls);
    else if (cls.kind === 'class' && cls.fields.some(isInstanceField)) candidates.push(cls);
  }
  candidates.sort((a, b) => (a.fqn < b.fqn ? -1 : a.fqn > b.fqn ? 1 : 0));
  const candidateFqns = new Set(candidates.map((c) => c.fqn));

  // Project subclass map (sealed-variant detection).
  const subclassesBySuperFqn = new Map<string, string[]>();
  for (const cls of index.classesByFqn.values()) {
    if (cls.kind !== 'class' || !cls.superClass) continue;
    const parent = resolveProjectType(cls.superClass, cls, index);
    if (!parent) continue;
    const list = subclassesBySuperFqn.get(parent.fqn) || [];
    list.push(cls.fqn);
    subclassesBySuperFqn.set(parent.fqn, list);
  }

  // Pass 1: build pending shapes with ref:<fqn> placeholders.
  const pending = new Map<string, PendingShape>();
  for (const cls of candidates) {
    pending.set(cls.fqn, buildPendingShape(cls, index, subclassesBySuperFqn));
  }

  // Global mutation scan → flags + per-field notes.
  for (const site of scanMutations(index, candidateFqns)) {
    const shape = pending.get(site.shapeFqn);
    if (!shape) continue;
    if (!shape.flags.includes('mutated_in_flight')) shape.flags.push('mutated_in_flight');
    const field = shape.fields.find((f) => f.name === site.fieldName);
    if (field && !field.notes.includes(site.note)) field.notes.push(site.note);
  }
  for (const shape of pending.values()) shape.flags.sort();

  // Pass 2: resolve ref:<fqn> → S-keys in dependency order; hash after
  // resolution. Shapes whose references are all resolved are finalized each
  // wave; a wave with no progress = a reference cycle → finalize the
  // remainder with stable fqn placeholders in the HASH input.
  const keyBySymbol = new Map<string, string>();
  const finalized = new Map<string, SclShapeContract>();

  const finalize = (shape: PendingShape, allowPlaceholders: boolean): void => {
    const referencedKeys = new Set<string>();
    const resolvedFields: SclShapeField[] = shape.fields.map((f, i) => {
      const refFqn = shape.fieldRefFqns[i];
      if (!refFqn) return f;
      const refKey = keyBySymbol.get(refFqn);
      if (refKey) {
        referencedKeys.add(refKey);
        return { ...f, kind: f.kind.replace(`ref:${refFqn}`, `ref:${refKey}`) };
      }
      if (!allowPlaceholders) {
        throw new Error(`shapeExtractor: unresolved reference ${refFqn} outside cycle fallback`);
      }
      // Cycle member (or reference to a non-candidate project type): the
      // stable fqn placeholder stays in the hash input; note the situation.
      return f;
    });
    const canonicalBody = {
      kind: 'shape' as const,
      symbol: shape.cls.fqn,
      sourcePath: shape.cls.filePath,
      representation: shape.representation,
      fields: resolvedFields,
      wireFacts: shape.wireFacts,
      flags: shape.flags,
      references: Array.from(referencedKeys).sort(),
    };
    const key = contractKey('S', canonicalBody);
    keyBySymbol.set(shape.cls.fqn, key);
    finalized.set(shape.cls.fqn, {
      key,
      ...canonicalBody,
      contentHash: contentHashOf(canonicalBody),
    });
  };

  let remaining = Array.from(pending.values());
  while (remaining.length > 0) {
    const ready = remaining.filter((s) =>
      s.fieldRefFqns.every((fqn) => fqn === null || keyBySymbol.has(fqn) || !pending.has(fqn))
    );
    if (ready.length === 0) {
      // Reference cycle: finalize everything left with fqn placeholders in
      // the hash input (still deterministic — fqns are stable).
      for (const s of remaining) finalize(s, true);
      remaining = [];
      break;
    }
    for (const s of ready) finalize(s, true);
    const readyFqns = new Set(ready.map((s) => s.cls.fqn));
    remaining = remaining.filter((s) => !readyFqns.has(s.cls.fqn));
  }

  const shapes = Array.from(finalized.values()).sort((a, b) =>
    a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0
  );
  return { shapes, keyBySymbol };
}
