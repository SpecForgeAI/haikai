/**
 * SOAP message-type reconciler (Spec 4, Task Group 4.2).
 *
 * Spec: agent-os/specs/2026-05-30-soap-wsdl-message-field-depth/spec.md
 *
 * ===========================================================================
 * Purpose
 * ===========================================================================
 *
 * A DETERMINISTIC, within-run MERGE of the TWO SOURCE views of the SAME SOAP
 * message type into ONE reconciled `MessageType`:
 *  - the WSDL/XSD view  (`wsdlParser.ts`, Task Group 2, `source:'xsd'`), and
 *  - the Java-DTO view  (`javaDtoFieldParser.ts`, Task Group 3, `source:'java'`).
 *
 * This is the LOCAL two-source merge ONLY. It is NOT the cross-MODEL dedup
 * (don't duplicate an already-persisted entity) -- that is Group 6's job at
 * save-back, reusing Issue 2's model-aware dedup + the save-back identity
 * primitive. Here we only fold two PARSED views of the same message type
 * (from the SAME run) into one entity + its attributes, so the emitter (4.3)
 * mints ONE entity per logical message type rather than two.
 *
 * ===========================================================================
 * Matching + merge rules (deterministic)
 * ===========================================================================
 *
 *  1. Match message TYPES by a small name-normalization (`normalizeTypeName`):
 *     lower-cased, non-alphanumerics stripped. So the WSDL doc-literal wrapper
 *     element `getEmployeeResponse` and the Java wrapper bean
 *     `GetEmployeeResponse` collapse to one type. The normalization is
 *     intentionally conservative (a stable, codebase-consistent fold), and the
 *     load-bearing MODEL dedup is deferred to save-back (Group 6 / Issue 2).
 *
 *  2. When only ONE source is parsable for a type, USE IT verbatim.
 *
 *  3. When BOTH sources describe a type, merge field-for-field (matched by the
 *     same field-name normalization):
 *       - PREFER the XSD view for `type` / `cardinality` / `restrictions`
 *         (the schema is the contract truth for value-domain + occurrence).
 *       - FILL GAPS from the Java view (a field present only in Java is added;
 *         `complexTypeRef` is taken from XSD, else Java).
 *       - `isNullable`: XSD `nillable` wins when the XSD field exists; else the
 *         Java-derived nullability is used.
 *       - Record provenance from BOTH: the reconciled entity carries the XSD
 *         `provenanceNamespace` AND the Java `provenanceClass` when each is
 *         known.
 *
 * The merge is order-stable and side-effect-free (pure): same inputs ->
 * same `ReconciledMessageType[]`.
 */

import {
  type MessageType,
  type MessageField,
  type MessageFieldSource,
  type FieldRestrictions,
} from './messageFieldModel';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/**
 * A message type reconciled from one or both source views. Extends the shared
 * `MessageType` with the set of source views that contributed, so the emitter
 * and diagnostics can see whether a type came from XSD, Java, or both.
 */
export interface ReconciledMessageType extends MessageType {
  /** Which source views contributed to this reconciled type (>=1). */
  sources: MessageFieldSource[];
}

// ----------------------------------------------------------------------------
// Name normalization (small, deterministic, codebase-consistent)
// ----------------------------------------------------------------------------

/**
 * Normalize a type / field name for within-run matching: lower-case + strip
 * any non-alphanumeric character. Deterministic and conservative -- it folds
 * case + separator differences (`GetEmployeeResponse` vs `getEmployeeResponse`
 * vs `get_employee_response`) without collapsing genuinely different names.
 *
 * NOTE: this is the LOCAL match key only. The load-bearing cross-model dedup
 * (Issue 2 / `normalizeNameForMatch` at save-back) is NOT imported here.
 */
export function normalizeTypeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ----------------------------------------------------------------------------
// Field-level merge
// ----------------------------------------------------------------------------

/**
 * Merge two views of the SAME field. XSD wins for `type` / `cardinality` /
 * `restrictions` / `isNullable`; the Java view fills `complexTypeRef` only when
 * the XSD view lacks one. The reconciled field keeps `source` from the XSD view
 * (the canonical contract source) -- a merged field's provenance is recorded at
 * the entity level via `sources`.
 */
function mergeField(xsd: MessageField, java: MessageField): MessageField {
  const restrictions: FieldRestrictions | undefined =
    xsd.restrictions ?? java.restrictions;
  const merged: MessageField = {
    name: xsd.name,
    type: xsd.type, // XSD is the contract truth for the source type string
    isNullable: xsd.isNullable, // XSD `nillable` wins when the XSD field exists
    cardinality: { ...xsd.cardinality }, // XSD cardinality wins
    complexTypeRef: xsd.complexTypeRef ?? java.complexTypeRef,
    source: 'xsd',
  };
  if (restrictions && Object.keys(restrictions).length > 0) {
    merged.restrictions = restrictions;
  }
  return merged;
}

/**
 * Reconcile the field LISTS of two views of the same type. XSD fields are the
 * spine; a Java-only field (no XSD counterpart by normalized name) is appended
 * AFTER the XSD fields so the emitted attribute set is the UNION (XSD-first,
 * then Java-only gaps), with deterministic order.
 */
function reconcileFields(
  xsdFields: MessageField[],
  javaFields: MessageField[],
): MessageField[] {
  const javaByNorm = new Map<string, MessageField>();
  for (const jf of javaFields) javaByNorm.set(normalizeTypeName(jf.name), jf);

  const out: MessageField[] = [];
  const consumedJava = new Set<string>();

  // XSD spine -- merge field-for-field when a Java counterpart exists.
  for (const xf of xsdFields) {
    const norm = normalizeTypeName(xf.name);
    const jf = javaByNorm.get(norm);
    if (jf) {
      out.push(mergeField(xf, jf));
      consumedJava.add(norm);
    } else {
      out.push(xf);
    }
  }

  // Java-only fields (gap-fill) -- appended in document order.
  for (const jf of javaFields) {
    const norm = normalizeTypeName(jf.name);
    if (consumedJava.has(norm)) continue;
    out.push(jf);
  }

  return out;
}

// ----------------------------------------------------------------------------
// Type-level merge
// ----------------------------------------------------------------------------

/**
 * Merge two views of the SAME message type into one reconciled type. Prefer the
 * human-facing XSD name when the two names differ only in case/separators; keep
 * provenance from BOTH sources.
 */
function mergeType(
  xsd: MessageType,
  java: MessageType,
): ReconciledMessageType {
  return {
    // Prefer the XSD type name (schema contract surface) when present.
    name: xsd.name || java.name,
    provenanceNamespace: xsd.provenanceNamespace ?? java.provenanceNamespace,
    provenanceClass: java.provenanceClass ?? xsd.provenanceClass,
    fields: reconcileFields(xsd.fields, java.fields),
    source: 'xsd',
    sources: ['xsd', 'java'],
  };
}

/** Wrap a single-source type as a reconciled type (no merge needed). */
function single(type: MessageType): ReconciledMessageType {
  return { ...type, sources: [type.source] };
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Reconcile the WSDL/XSD view and the Java-DTO view of a run's SOAP message
 * types into ONE list with one entry per logical message type.
 *
 * Deterministic + pure. Matching is by `normalizeTypeName`. When both views
 * have a type, they are merged field-for-field (XSD wins for type/cardinality/
 * restriction; Java fills gaps). A type present in only one view passes through
 * verbatim. Order: XSD types first (in input order), then Java-only types.
 *
 * Within a single source, duplicate normalized names are collapsed onto the
 * FIRST occurrence (so a named complex type reached from two messages -- already
 * deduped by the XSD walker -- and any incidental Java duplicate fold to one).
 */
export function reconcileMessageTypes(
  xsdTypes: MessageType[],
  javaTypes: MessageType[],
): ReconciledMessageType[] {
  // Index each source by normalized name, first-occurrence-wins.
  const xsdByNorm = new Map<string, MessageType>();
  for (const t of xsdTypes) {
    const norm = normalizeTypeName(t.name);
    if (!xsdByNorm.has(norm)) xsdByNorm.set(norm, t);
  }
  const javaByNorm = new Map<string, MessageType>();
  for (const t of javaTypes) {
    const norm = normalizeTypeName(t.name);
    if (!javaByNorm.has(norm)) javaByNorm.set(norm, t);
  }

  const out: ReconciledMessageType[] = [];
  const emitted = new Set<string>();

  // 1) XSD spine -- merge with Java when both present.
  for (const [norm, xt] of xsdByNorm) {
    const jt = javaByNorm.get(norm);
    out.push(jt ? mergeType(xt, jt) : single(xt));
    emitted.add(norm);
  }

  // 2) Java-only types (no XSD counterpart) -- appended in input order.
  for (const [norm, jt] of javaByNorm) {
    if (emitted.has(norm)) continue;
    out.push(single(jt));
    emitted.add(norm);
  }

  return out;
}
