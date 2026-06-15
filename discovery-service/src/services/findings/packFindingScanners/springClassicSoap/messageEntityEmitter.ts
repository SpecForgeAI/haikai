/**
 * SOAP message-shape candidate emitter (Spec 4, Task Group 4.3).
 *
 * Spec: agent-os/specs/2026-05-30-soap-wsdl-message-field-depth/spec.md
 *
 * ===========================================================================
 * Purpose
 * ===========================================================================
 *
 * Given the RECONCILED SOAP message types (`messageReconciler.ts`, 4.2) plus
 * the SOAP interface + endpoint candidates already built by
 * `soapEndpointEmitter.ts`, mint the meta-model message-shape candidates +
 * bindings that SOAP discovery was previously missing:
 *
 *  - `logical_data_entities`  : ONE shared entity per NAMED message type
 *    (referenced by a relationship, NOT inlined per message), each carrying the
 *    Group-1 PROVENANCE on `data.source_provenance` (source namespace /
 *    originating DTO class name).
 *  - `logical_data_attributes`: one per field, carrying the Group-1
 *    `field_metadata` JSONB blob (cardinality + restrictions + XSD source-type)
 *    on `data.field_metadata`, with `data.isNullable` set from the field's
 *    `isNullable` (the REAL `is_nullable` column at save-back). Parent FK is
 *    resolved via `parentCandidateId` (the entity candidate id) -- the existing
 *    save-back parent-FK mechanism.
 *  - `logical_data_entity_relationships`: ONE per field whose `complexTypeRef`
 *    points at a named type -- the message entity -> named-type entity
 *    reference. Carried by NAME (`data.sourceEntity` / `data.targetEntity`) so
 *    save-back resolves both sides to `dep_log_<id>` via the existing arm.
 *  - `interface_logical_entities`: link the SOAP interface to each message type
 *    it exposes (REUSE; not a new type). Carried by NAME
 *    (`data.interfaceClassName` = the interface candidate's display name,
 *    `data.logicalEntityName` = the message type name).
 *  - Endpoint request/response message bindings: NOT a new candidate -- the
 *    SOAP endpoint candidates are MUTATED IN PLACE to carry
 *    `data.requestEntity` / `data.responseEntity` (the request/response message
 *    type names), which the EXISTING save-back Pass 1b resolves to
 *    `request_data_entity_point_id` / `response_data_entity_point_id` via the
 *    `dep_log_<id>` convention. We NEVER create `*_points` here.
 *
 * Findings (genuinely-unmodellable only):
 *  - the deep walker's `fieldDepthFindings` (depth-cap / cycle / multi-part)
 *    are translated to real evidence-gap Findings via the shared
 *    `buildSoapEvidenceGapFinding` sentinels Group 2 added.
 *  - a "no parsable schema AND no parsable Java DTO" Finding is emitted ONLY
 *    when an operation references request/response message(s) for which NEITHER
 *    source yielded fields. It rides on the existing centralised
 *    `interface_missing_contract_detail` evidence-gap sentinel (the message
 *    contract for that interface could not be captured) -- the semantically
 *    correct home, distinct from the three field-walk STOP sentinels.
 *
 * DETERMINISTIC: no LLM, no gateway relay, no I/O. Pure transformation over
 * the reconciled types + the already-built candidates.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  DiscoveryCandidate,
  CandidateType,
} from '../../../../types/candidate';
import type { FindingEmitInput } from '../../FindingEmitter';
import {
  buildSoapEvidenceGapFinding,
  buildEvidenceGapFinding,
} from '../../emissionSources';
import type { WsdlParseResult, WsdlFieldFinding } from './wsdlParser';
import type { MessageType } from './messageFieldModel';
import {
  reconcileMessageTypes,
  normalizeTypeName,
  type ReconciledMessageType,
} from './messageReconciler';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

export interface MessageEntityEmitInput {
  /** WSDL/XSD view -- the deeply-walked message types from every parsed WSDL. */
  wsdlResults: WsdlParseResult[];
  /** Java-DTO view -- message types parsed from annotated DTO classes. */
  javaMessageTypes: MessageType[];
  /**
   * The SOAP interface candidates already built by `soapEndpointEmitter.ts`.
   * Used to wire `interface_logical_entities` (by display name). NOT mutated.
   */
  interfaceCandidates: DiscoveryCandidate[];
  /**
   * The SOAP endpoint candidates already built by `soapEndpointEmitter.ts`.
   * MUTATED IN PLACE to carry `data.requestEntity` / `data.responseEntity` so
   * save-back binds the endpoint request/response point-ids.
   */
  endpointCandidates: DiscoveryCandidate[];
}

export interface MessageEntityEmitOutput {
  /**
   * The new message-shape candidates: `logical_data_entities` +
   * `logical_data_attributes` + `logical_data_entity_relationships` +
   * `interface_logical_entities`. Caller pushes these into the candidate stream.
   */
  candidates: DiscoveryCandidate[];
  /**
   * Field-depth + neither-source Findings. Caller forwards to the existing
   * `FindingEmitter` alongside the Phase 1 SOAP evidence-gap findings.
   */
  findings: FindingEmitInput[];
  /** The reconciled message types (exposed for tests + diagnostics). */
  reconciledTypes: ReconciledMessageType[];
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const ADDED_BY = 'spring-classic-soap-message';
const DEFAULT_RUN_ID = 'pending'; // Caller re-stamps runId before persistence.
const ISO_NOW = (): string => new Date().toISOString();

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/**
 * Build the Group-1 `field_metadata` JSONB blob for an attribute: cardinality
 * + restrictions + the XSD source-type string. Keys are already snake_case on
 * the field model, so they drop straight in. `xsd_source_type` carries the
 * AS-IS source type string (XSD qname or Java type expression).
 */
function buildFieldMetadata(field: ReconciledMessageType['fields'][number]): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    cardinality: {
      min_occurs: field.cardinality.min_occurs,
      max_occurs: field.cardinality.max_occurs,
      is_collection: field.cardinality.is_collection,
    },
    // The source type captured AS-IS (no normalization) -- the migration must
    // re-implement against this exact type.
    xsd_source_type: field.type,
    source: field.source,
  };
  if (field.restrictions && Object.keys(field.restrictions).length > 0) {
    meta.restrictions = field.restrictions;
  }
  if (field.complexTypeRef) {
    meta.complex_type_ref = field.complexTypeRef;
  }
  return meta;
}

/** Provenance string for the entity: namespace + originating DTO class. */
function buildProvenance(type: ReconciledMessageType): string | null {
  const parts: string[] = [];
  if (type.provenanceNamespace) parts.push(`namespace=${type.provenanceNamespace}`);
  if (type.provenanceClass) parts.push(`class=${type.provenanceClass}`);
  return parts.length > 0 ? parts.join('; ') : null;
}

// ----------------------------------------------------------------------------
// Candidate builders
// ----------------------------------------------------------------------------

function buildEntityCandidate(type: ReconciledMessageType): DiscoveryCandidate {
  const provenance = buildProvenance(type);
  return {
    id: uuidv4(),
    runId: DEFAULT_RUN_ID,
    candidateType: 'logical_data_entities' as CandidateType,
    name: type.name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: type.provenanceClass ? [type.provenanceClass] : [],
    data: {
      // Group-1 entity provenance field (save-back passes through additively).
      source_provenance: provenance,
      // Diagnostic / reconciliation context (additive; not load-bearing).
      provenance_namespace: type.provenanceNamespace,
      provenance_class: type.provenanceClass,
      reconciled_sources: type.sources,
      field_count: type.fields.length,
      discovery_method: 'framework_scanner',
      _addedBy: ADDED_BY,
    },
    synthesizedAt: ISO_NOW(),
  };
}

function buildAttributeCandidate(
  field: ReconciledMessageType['fields'][number],
  parentEntityId: string,
  parentEntityName: string,
): DiscoveryCandidate {
  return {
    id: uuidv4(),
    runId: DEFAULT_RUN_ID,
    candidateType: 'logical_data_attributes' as CandidateType,
    name: field.name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    // Parent FK resolved via parentCandidateId -> the entity candidate.
    parentCandidateId: parentEntityId,
    data: {
      // Save-back `logical_data_attributes` arm reads dataType + isNullable.
      dataType: field.type, // AS-IS source type string
      // `is_nullable` (real column) from XSD `nillable` / Java boxed-vs-primitive.
      // DISTINCT from cardinality.min_occurs (optionality), which is in the blob.
      isNullable: field.isNullable,
      // Group-1 on-attribute JSONB metadata blob: cardinality + restrictions +
      // XSD source-type (save-back passes through additively to `field_metadata`).
      field_metadata: buildFieldMetadata(field),
      // Context for diagnostics / name-based parent fallback.
      logicalEntityName: parentEntityName,
      discovery_method: 'framework_scanner',
      _addedBy: ADDED_BY,
    },
    synthesizedAt: ISO_NOW(),
  };
}

/**
 * One `logical_data_entity_relationship` per field whose `complexTypeRef`
 * points at a named type: the message entity -> the shared named-type entity.
 * Carried BY NAME so save-back resolves both sides to `dep_log_<id>`.
 */
function buildSharedTypeRelationship(
  fromEntityName: string,
  toNamedTypeName: string,
  fieldName: string,
): DiscoveryCandidate {
  return {
    id: uuidv4(),
    runId: DEFAULT_RUN_ID,
    candidateType: 'logical_data_entity_relationships' as CandidateType,
    name: `${fromEntityName} → ${toNamedTypeName}`,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: {
      // Save-back relationship arm resolves these names -> dep_log_<id>.
      sourceEntity: fromEntityName,
      targetEntity: toNamedTypeName,
      relationshipType: 'reference',
      cardinality: 'many-to-one',
      description: `Field '${fieldName}' references shared message type '${toNamedTypeName}'.`,
      discovery_method: 'framework_scanner',
      _addedBy: ADDED_BY,
    },
    synthesizedAt: ISO_NOW(),
  };
}

/**
 * One `interface_logical_entities` per (interface, message type) pair the
 * interface exposes. Carried BY NAME (`interfaceClassName` = the interface
 * candidate's display `name`, `logicalEntityName` = the message type name).
 */
function buildInterfaceLink(
  interfaceName: string,
  messageTypeName: string,
): DiscoveryCandidate {
  return {
    id: uuidv4(),
    runId: DEFAULT_RUN_ID,
    candidateType: 'interface_logical_entities' as CandidateType,
    name: `${interfaceName} ↔ ${messageTypeName}`,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [],
    data: {
      // Save-back ILE arm matches interfaceClassName against interfaces[].name
      // and resolves logicalEntityName -> dep_log_<id>.
      interfaceClassName: interfaceName,
      logicalEntityName: messageTypeName,
      direction: 'exposes',
      discovery_method: 'framework_scanner',
      _addedBy: ADDED_BY,
    },
    synthesizedAt: ISO_NOW(),
  };
}

// ----------------------------------------------------------------------------
// Finding translation
// ----------------------------------------------------------------------------

/** Translate one parser field-depth STOP record into an evidence-gap Finding. */
function fieldFindingToEmit(f: WsdlFieldFinding): FindingEmitInput {
  return buildSoapEvidenceGapFinding({
    gapType: f.kind,
    candidateName: f.subject,
    gapDescription: f.reason,
    sourcePath: f.sourcePath,
  });
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Emit the SOAP message-shape candidates + bindings + Findings.
 *
 * Pure + deterministic. Reconciles the two views, mints one entity per message
 * type (named complex types shared, referenced by relationship -- NOT inlined),
 * one attribute per field (carrying the JSONB metadata blob + `is_nullable`),
 * the shared-type relationships, the interface links, and binds endpoint
 * request/response messages in place. Translates field-depth findings and emits
 * the neither-source Finding only when an operation references message(s) for
 * which NEITHER source yielded fields.
 */
export function emitMessageEntities(
  input: MessageEntityEmitInput,
): MessageEntityEmitOutput {
  const candidates: DiscoveryCandidate[] = [];
  const findings: FindingEmitInput[] = [];

  // 1) Reconcile the two source views (XSD spine, Java gap-fill).
  const xsdTypes: MessageType[] = [];
  for (const w of input.wsdlResults) xsdTypes.push(...w.messageTypes);
  const reconciledTypes = reconcileMessageTypes(xsdTypes, input.javaMessageTypes);

  // 2) Mint ONE shared entity per reconciled message type, plus its attributes.
  //    Track the entity id + name by normalized type name so relationships /
  //    interface links / endpoint bindings can resolve to the right entity.
  const entityByNorm = new Map<
    string,
    { id: string; name: string; type: ReconciledMessageType }
  >();
  for (const type of reconciledTypes) {
    if (!type.name) continue;
    const norm = normalizeTypeName(type.name);
    if (entityByNorm.has(norm)) continue; // already minted (shared named type)
    const entityCand = buildEntityCandidate(type);
    candidates.push(entityCand);
    entityByNorm.set(norm, { id: entityCand.id, name: type.name, type });
    for (const field of type.fields) {
      candidates.push(buildAttributeCandidate(field, entityCand.id, type.name));
    }
  }

  // 3) Shared-named-type relationships: ONE per field whose complexTypeRef
  //    resolves to a minted entity (so a named type is shared, referenced by a
  //    relationship -- NOT inlined per message). Dedup by (from,to) pair.
  const seenRel = new Set<string>();
  for (const { name: fromName, type } of entityByNorm.values()) {
    for (const field of type.fields) {
      if (!field.complexTypeRef) continue;
      const target = entityByNorm.get(normalizeTypeName(field.complexTypeRef));
      if (!target) continue; // referenced type not minted (e.g. depth-capped)
      if (target.name === fromName) continue; // self-ref handled as cycle finding
      const relKey = `${normalizeTypeName(fromName)}->${normalizeTypeName(target.name)}`;
      if (seenRel.has(relKey)) continue;
      seenRel.add(relKey);
      candidates.push(buildSharedTypeRelationship(fromName, target.name, field.name));
    }
  }

  // 4) interface_logical_entities + endpoint request/response bindings.
  //    Resolve the operation root-element / DTO names -> minted message types.
  //    The endpoint candidates already carry request/response root-element +
  //    DTO class on their `data` (from `soapEndpointEmitter.ts`).
  const interfaceLinksSeen = new Set<string>();

  for (const ep of input.endpointCandidates) {
    const data = ep.data as Record<string, unknown>;
    const parentIfaceId = ep.parentCandidateId;
    const iface = input.interfaceCandidates.find((i) => i.id === parentIfaceId);
    const interfaceName = iface?.name ?? null;

    // Resolve the request + response message entities for this operation.
    const requestEntity = resolveMessageEntityForRef(
      entityByNorm,
      data.request_root_element,
      data.request_dto_class,
    );
    const responseEntity = resolveMessageEntityForRef(
      entityByNorm,
      data.response_root_element,
      data.response_dto_class,
    );

    // Bind endpoint request/response messages IN PLACE -- save-back Pass 1b
    // resolves `requestEntity` / `responseEntity` -> point-ids. NEVER `*_points`.
    if (requestEntity) data.requestEntity = requestEntity.name;
    if (responseEntity) data.responseEntity = responseEntity.name;

    // interface_logical_entities link (one per interface x message type).
    if (interfaceName) {
      for (const me of [requestEntity, responseEntity]) {
        if (!me) continue;
        const key = `${normalizeTypeName(interfaceName)}::${normalizeTypeName(me.name)}`;
        if (interfaceLinksSeen.has(key)) continue;
        interfaceLinksSeen.add(key);
        candidates.push(buildInterfaceLink(interfaceName, me.name));
      }
    }

    // Neither-source Finding: this operation references request/response
    // messages but NEITHER the schema NOR a Java DTO yielded a parsable type
    // for them. Emit ONLY then (field structure that DID parse is architecture).
    emitNeitherSourceFindingIfNeeded(findings, ep, data, requestEntity, responseEntity);
  }

  // 5) Translate the deep walker's field-depth STOP records into Findings.
  for (const w of input.wsdlResults) {
    for (const f of w.fieldDepthFindings) {
      findings.push(fieldFindingToEmit(f));
    }
  }

  return { candidates, findings, reconciledTypes };
}

// ----------------------------------------------------------------------------
// Resolution helpers
// ----------------------------------------------------------------------------

/**
 * Resolve a minted message entity for an operation's request/response by
 * trying the root-element local name first, then the (simple) DTO class name.
 */
function resolveMessageEntityForRef(
  entityByNorm: Map<string, { id: string; name: string; type: ReconciledMessageType }>,
  rootElement: unknown,
  dtoClass: unknown,
): { id: string; name: string } | null {
  if (typeof rootElement === 'string' && rootElement.length > 0) {
    const m = entityByNorm.get(normalizeTypeName(rootElement));
    if (m) return { id: m.id, name: m.name };
  }
  if (typeof dtoClass === 'string' && dtoClass.length > 0) {
    const simple = dtoClass.split('.').pop() ?? dtoClass;
    const m = entityByNorm.get(normalizeTypeName(simple));
    if (m) return { id: m.id, name: m.name };
  }
  return null;
}

/**
 * Emit the "no parsable schema AND no parsable Java DTO" Finding for an
 * operation when it references request/response messages but NEITHER side
 * yielded a minted message type. Mutates `findings` in place.
 *
 * Guard: only when the operation actually declares request/response root
 * elements or DTO classes (so a genuinely message-less operation does not
 * trigger a false gap), and ONLY when EVERY declared side is unresolved (so a
 * partially-resolved operation is NOT reported -- its captured shape is
 * architecture, not a gap).
 *
 * Rides on the centralised `interface_missing_contract_detail` evidence-gap
 * sentinel linked to the parent SOAP interface candidate -- the message
 * contract for that interface could not be captured.
 */
function emitNeitherSourceFindingIfNeeded(
  findings: FindingEmitInput[],
  ep: DiscoveryCandidate,
  data: Record<string, unknown>,
  requestEntity: { name: string } | null,
  responseEntity: { name: string } | null,
): void {
  const declaresRequest =
    isNonEmptyString(data.request_root_element) ||
    isNonEmptyString(data.request_dto_class);
  const declaresResponse =
    isNonEmptyString(data.response_root_element) ||
    isNonEmptyString(data.response_dto_class);
  if (!declaresRequest && !declaresResponse) return;

  const requestUnresolved = declaresRequest && !requestEntity;
  const responseUnresolved = declaresResponse && !responseEntity;

  // Only emit when EVERY declared side is unresolved (no shape captured at all).
  const allDeclaredUnresolved =
    (!declaresRequest || requestUnresolved) &&
    (!declaresResponse || responseUnresolved);
  if (!allDeclaredUnresolved) return;
  // Defensive: at least one side must be declared+unresolved.
  if (!requestUnresolved && !responseUnresolved) return;

  // A neither-source finding needs the parent interface candidate to link to;
  // `interface_missing_contract_detail` requires a candidateId.
  const interfaceCandidateId = ep.parentCandidateId;
  if (!interfaceCandidateId) return;

  const opName = ep.name;
  const refDesc = [
    isNonEmptyString(data.request_root_element) ? `request '${data.request_root_element}'` : null,
    isNonEmptyString(data.request_dto_class) ? `request DTO '${data.request_dto_class}'` : null,
    isNonEmptyString(data.response_root_element) ? `response '${data.response_root_element}'` : null,
    isNonEmptyString(data.response_dto_class) ? `response DTO '${data.response_dto_class}'` : null,
  ]
    .filter(Boolean)
    .join(', ');

  findings.push(
    buildEvidenceGapFinding({
      candidateId: interfaceCandidateId,
      candidateName: opName,
      gapType: 'interface_missing_contract_detail',
      gapDescription:
        `Operation '${opName}' references message shape(s) (${refDesc}) but NEITHER a ` +
        `parsable WSDL/XSD schema NOR a parsable Java DTO yielded their fields; ` +
        `the message contract could not be captured for this operation.`,
    }),
  );
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
