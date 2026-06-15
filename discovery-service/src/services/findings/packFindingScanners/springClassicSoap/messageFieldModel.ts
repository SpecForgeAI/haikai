/**
 * Shared SOAP message-field model (Spec 4, Task Groups 2 + 3).
 *
 * Spec: agent-os/specs/2026-05-30-soap-wsdl-message-field-depth/spec.md
 *
 * ===========================================================================
 * Purpose
 * ===========================================================================
 *
 * This module defines the SINGLE per-field shape produced by BOTH:
 *  - the deepened WSDL/XSD field walker (`wsdlParser.ts`, Task Group 2), and
 *  - the new Java-DTO field parser (`javaDtoFieldParser.ts`, Task Group 3).
 *
 * Group 4's reconciliation pass compares the WSDL/XSD view and the Java view
 * field-for-field, so both sources MUST emit the identical shape. This module
 * is that shared contract -- neither parser defines its own field type.
 *
 * ===========================================================================
 * Field shape rationale (maps 1:1 onto the Group 1 AMS schema)
 * ===========================================================================
 *
 * Each `MessageField` carries the facts a migration must re-implement:
 *
 *  - `name`        : the field / element local name.
 *  - `type`        : the SOURCE type string captured AS-IS, NO normalization
 *                    (XSD `xsd:string` / `tns:Address` from the schema view;
 *                    the Java type `String` / `List<Address>` from the Java
 *                    view). Group 4 normalizes/reconciles; the parsers do not.
 *  - `isNullable`  : present-but-null fact. XSD `nillable="true"`, OR the Java
 *                    `@XmlElement(nillable=true)` flag, OR (Java fallback) a
 *                    BOXED type (`Integer`) vs a primitive (`int`). This is the
 *                    REAL `is_nullable` column at save-back -- kept DISTINCT
 *                    from optionality (`minOccurs=0`), which is cardinality.
 *  - `cardinality` : `{ min_occurs, max_occurs, is_collection }` -- the exact
 *                    key names the Group 1 on-attribute JSONB metadata blob
 *                    expects. `minOccurs=0` => optional; `maxOccurs>1` /
 *                    `unbounded` => `is_collection=true`.
 *  - `restrictions`: value-domain facets (`enumeration`, `pattern`,
 *                    `min_length`/`max_length`, `min_inclusive`/
 *                    `max_inclusive`, `total_digits`/`fraction_digits`) -- the
 *                    same key names the Group 1 JSONB blob expects. Only the
 *                    XSD view populates these in v1 (the Java view has no
 *                    value-domain facets); the field is OPTIONAL so the Java
 *                    parser simply omits it.
 *  - `complexTypeRef` : when the field's type is a NAMED complex type, the
 *                    local name of that type. Group 4 uses this to emit ONE
 *                    SHARED `logical_data_entity` per named type referenced by
 *                    a `logical_data_entity_relationship` (NOT inlined). Null
 *                    for simple/built-in types.
 *  - `source`      : which view produced this field (`'xsd'` | `'java'`) --
 *                    provenance for reconciliation + diagnostics.
 *
 * The keys inside `cardinality` and `restrictions` are deliberately
 * snake_case so they drop STRAIGHT into the Group 1 `field_metadata` JSONB
 * blob with no remapping at emission time.
 */

// ----------------------------------------------------------------------------
// Cardinality
// ----------------------------------------------------------------------------

/**
 * Cardinality facts for a field. Key names match the Group 1 on-attribute
 * JSONB metadata blob exactly (`min_occurs` / `max_occurs` / `is_collection`).
 *
 *  - `min_occurs` : XSD `minOccurs` (default 1). `0` => the field is optional
 *    (may be absent). For Java, 0 when the field is a boxed/`@XmlElement(
 *    required=false)` field, else 1 (best-effort; the WSDL view is canonical
 *    for optionality when both are present, resolved in Group 4).
 *  - `max_occurs` : XSD `maxOccurs` (default 1). The literal string is
 *    preserved when it is `'unbounded'`; numeric values are kept as numbers.
 *  - `is_collection` : true when `maxOccurs` is `'unbounded'` or any value > 1
 *    (XSD), or when the Java type is `List<T>` / `T[]`.
 */
export interface FieldCardinality {
  min_occurs: number;
  /** Either a finite count or the literal `'unbounded'`. */
  max_occurs: number | 'unbounded';
  is_collection: boolean;
}

// ----------------------------------------------------------------------------
// Value-domain restrictions
// ----------------------------------------------------------------------------

/**
 * Value-domain restrictions captured from an XSD `xsd:restriction` facet set.
 * Key names match the Group 1 on-attribute JSONB metadata blob. Every field
 * is optional -- only the facets actually present in the schema are populated,
 * and the whole object is omitted when no facets apply (e.g. the Java view).
 *
 * Numeric facets are captured AS-IS from the schema text (string-preserving
 * where the XSD allows non-integer bounds, e.g. `minInclusive="0.00"`).
 */
export interface FieldRestrictions {
  /** `xsd:enumeration value=` list, in document order. */
  enumeration?: string[];
  /** `xsd:pattern value=` regular-expression string. */
  pattern?: string;
  /** `xsd:minLength value=`. */
  min_length?: number;
  /** `xsd:maxLength value=`. */
  max_length?: number;
  /** `xsd:minInclusive value=` (kept as the raw string to preserve scale). */
  min_inclusive?: string;
  /** `xsd:maxInclusive value=` (kept as the raw string to preserve scale). */
  max_inclusive?: string;
  /** `xsd:totalDigits value=`. */
  total_digits?: number;
  /** `xsd:fractionDigits value=`. */
  fraction_digits?: number;
}

// ----------------------------------------------------------------------------
// Field
// ----------------------------------------------------------------------------

/** Which view produced a `MessageField`. */
export type MessageFieldSource = 'xsd' | 'java';

/**
 * One field on a SOAP message type. The SHARED shape produced by both the
 * WSDL/XSD walker (Group 2) and the Java-DTO parser (Group 3); reconciled
 * field-for-field by Group 4.
 */
export interface MessageField {
  /** Field / element local name. */
  name: string;
  /**
   * SOURCE type string, captured AS-IS with NO normalization. From the schema
   * view this is the XSD type qname (`xsd:string`, `tns:Address`); from the
   * Java view this is the Java type expression (`String`, `List<Address>`).
   */
  type: string;
  /**
   * Present-but-null fact. XSD `nillable="true"`, OR Java
   * `@XmlElement(nillable=true)`, OR (Java fallback) a boxed reference type.
   * This becomes the REAL `is_nullable` column at save-back -- DISTINCT from
   * `cardinality.min_occurs === 0` (optionality).
   */
  isNullable: boolean;
  /** `{ min_occurs, max_occurs, is_collection }` -- Group 1 JSONB key names. */
  cardinality: FieldCardinality;
  /**
   * Value-domain restrictions, when any facet applies. OMITTED entirely when
   * none apply (e.g. the Java view, or a field with no `xsd:restriction`).
   */
  restrictions?: FieldRestrictions;
  /**
   * Local name of the NAMED complex type this field's type resolves to, when
   * the field is itself a complex type (Group 4 emits a shared entity +
   * relationship for it). Null for simple / built-in types.
   */
  complexTypeRef: string | null;
  /** Which view produced this field. */
  source: MessageFieldSource;
}

// ----------------------------------------------------------------------------
// Message type (entity-level)
// ----------------------------------------------------------------------------

/**
 * A SOAP message type (an XSD complex type / doc-literal wrapper element, or
 * an annotated Java DTO class) with its fields. Maps to a
 * `logical_data_entity` in Group 4; `provenanceNamespace` /
 * `provenanceClass` feed the Group 1 entity provenance field.
 */
export interface MessageType {
  /** Local name of the complex type / wrapper element / Java class. */
  name: string;
  /** Source namespace (XSD `targetNamespace`), when known. */
  provenanceNamespace: string | null;
  /** Originating Java DTO fully-qualified class name, when known. */
  provenanceClass: string | null;
  /** Fields on this message type, in document order. */
  fields: MessageField[];
  /** Which view produced this type. */
  source: MessageFieldSource;
}

// ----------------------------------------------------------------------------
// Factory helpers -- shared so both parsers build identical defaults
// ----------------------------------------------------------------------------

/** Default cardinality (`minOccurs=1`, `maxOccurs=1`, not a collection). */
export function defaultCardinality(): FieldCardinality {
  return { min_occurs: 1, max_occurs: 1, is_collection: false };
}

/**
 * Build a `MessageField` with shared defaults, so both parsers produce the
 * identical shape (and Group 4 can reconcile field-for-field). Callers
 * override only the facts their view actually carries.
 */
export function makeField(args: {
  name: string;
  type: string;
  source: MessageFieldSource;
  isNullable?: boolean;
  cardinality?: Partial<FieldCardinality>;
  restrictions?: FieldRestrictions;
  complexTypeRef?: string | null;
}): MessageField {
  const field: MessageField = {
    name: args.name,
    type: args.type,
    isNullable: args.isNullable ?? false,
    cardinality: { ...defaultCardinality(), ...(args.cardinality ?? {}) },
    complexTypeRef: args.complexTypeRef ?? null,
    source: args.source,
  };
  if (args.restrictions && Object.keys(args.restrictions).length > 0) {
    field.restrictions = args.restrictions;
  }
  return field;
}
