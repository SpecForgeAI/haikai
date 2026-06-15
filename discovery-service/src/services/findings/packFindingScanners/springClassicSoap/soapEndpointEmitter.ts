/**
 * SOAP endpoint emitter -- merge, precedence, candidate build (Group 4).
 *
 * Spec: 2026-05-17 SOAP Discovery -- Spring Classic Phase 1, Task Group 4.
 *
 * Merges the three SOAP signal streams into discovery candidates:
 *  - Signal A: Spring-WS annotations (`@Endpoint` + `@PayloadRoot`)
 *  - Signal B: JAX-WS annotations  (`@WebService` + `@WebMethod`)
 *  - Signal C: WSDL (`wsdl:portType` / `wsdl:operation` etc.)
 *
 * Applies two cross-cutting rules:
 *
 *  D-1 (Layered naming, top-down, first match wins):
 *    1. `@WebService(name=...)` attribute on the class, when present
 *    2. `@Endpoint` / `@WebService`-annotated class's SIMPLE Java name
 *       (no package prefix)
 *    3. Package + namespace-derived names as TIEBREAKERS ONLY -- used to
 *       disambiguate when two candidates would otherwise collide on the
 *       same display name
 *
 *  D-2 (Split-source precedence, applied per field, never per signal):
 *    - WSDL wins for: operation list, `request_root_element`,
 *      `request_namespace`, `response_root_element`
 *    - Annotations win for: `request_dto_class`, `response_dto_class`
 *      (annotations are the only source for fully-qualified Java class names)
 *
 * Candidate shape (mirrors the existing REST emit path in
 * `springClassicFindingScanner.ts` -- type `'endpoints'` rows for each
 * operation; one type `'interfaces'` parent row per logical SOAP interface):
 *  - `operation_verb` is the literal `'POST'` per D-3 (SOAP-over-HTTP is POST
 *    on the wire; the SOAP kind signal is carried by `soap_action` plus the
 *    parent's `interface_type='SOAP_API'`)
 *  - `path_or_address` is the servlet endpoint URL where the SOAP message
 *    lands; NULLABLE -- when the URL cannot be inferred from `web.xml` /
 *    `WebApplicationInitializer`, leave it null and the caller (Group 7)
 *    emits a `soap_endpoint_url_unknown` `evidence_gap` finding
 *  - Seven new `data` fields: `soap_action`, `request_root_element`,
 *    `request_namespace`, `response_root_element`, `request_dto_class`,
 *    `response_dto_class`, `wsdl_source`
 *  - (Phase 2, Group 3 -- spec 2026-05-17-soap-llm-extraction-and-payload-
 *    enrichment-phase-2): every emitted candidate (parent interface AND
 *    child endpoint) additionally carries `data.discovery_method =
 *    'framework_scanner'`. The field rides inside the existing
 *    `protocol_metadata_json` JSONB blob via the unchanged save-back arm;
 *    Workstream A's LLM-extracted candidates will set
 *    `'llm_extraction'` in the same key.
 *
 * Diagnostics: the emitter records `DiagLine` entries with the per-signal
 * emit shape (`signal=A|B|C`, `interface=<short-id>`, `operations=<N>`) AND
 * (Group 6) emits the matching structured `[diag-pack] scanner=spring_classic_soap`
 * log line directly to the scanner runner's diagnostic sink (`console.log`)
 * for every per-signal contribution. The orchestrator in
 * `springClassicSoap/index.ts` owns the `start`, `wsdl_parse=ok|fail`, and
 * `servlet_path=unknown` lines so they sit alongside the signal lines in the
 * run log.
 *
 * Pure (except for the diagnostic sink writes): no I/O. Caller (Group 5 /
 * `springClassicSoap/index.ts`) discovers `.wsdl` files and runs `parseWsdl`
 * / `scanSpringWsSources` / `scanJaxWsSources` before invoking
 * `emitSoapCandidates`.
 *
 * ---------------------------------------------------------------------------
 * Phase 3 (2026-05-17 Spec File Auto-Linking, Task Group 5 -- Workstream B):
 *
 * In addition to the merge + precedence work above, the emitter now also
 * promotes WSDL repo-relative paths onto parent SOAP interface candidates as
 * `data.spec_link`, so the capture wizard's `parse-oas` action sees a
 * pre-populated `spec_link` for SOAP services that ship their `service.wsdl`
 * alongside the code. The endpoint-level `data.wsdl_source` from Phase 1
 * stays as-is for per-operation context -- both fields coexist (P-6).
 *
 * Match strategy (P-3): EXACT, byte-for-byte WSDL `definitions.targetNamespace`
 * match against the namespace recorded on the parent interface candidate
 * (Phase 1 captures this on `data.wsdlTargetNamespace`, which is the same
 * namespace each endpoint sees as `data.request_namespace`). NO fuzzy /
 * case-insensitive / trailing-slash-tolerant matching -- false positives are
 * unacceptable on namespace identifiers.
 *
 * Outcomes per WSDL:
 *  - Unique match (1 interface) AND interface has no pre-existing
 *    `data.spec_link` -> set `data.spec_link = wsdl.sourcePath` + log
 *    `[diag-pack] scanner=spring_classic_soap wsdl_spec_link=set
 *    interface=<short-id> path=<rel>`.
 *  - Unique match AND interface already has a non-null `data.spec_link` ->
 *    SKIP (P-8: user's manual choice always wins) + log
 *    `[diag-pack] scanner=spring_classic_soap wsdl_spec_link_skipped
 *    pre_existing=<existing> path=<discovered>`.
 *  - Multiple matches (>=2) -> emit a single
 *    `oas_spec_ambiguous_match` `evidence_gap` finding via
 *    `buildOasSpecAmbiguousGap`; leave `spec_link` null on ALL involved
 *    candidates; log `[diag-pack] scanner=spring_classic_soap
 *    wsdl_spec_link=ambiguous candidates=[<id>,<id>,...] path=<rel>`.
 *  - Zero matches -> emit an `oas_spec_orphan` finding via
 *    `buildOasSpecOrphanGap`; log `[diag-pack] scanner=spring_classic_soap
 *    wsdl_spec_link=orphan path=<rel>`.
 *
 * Inverse-direction ambiguity (one interface matched by >=2 WSDLs) -- per the
 * tasks.md "5.2 ambiguous (one WSDL -> >=2 interfaces, OR one interface ->
 * >=2 WSDLs)" rule -- is also surfaced: the same builder is invoked once per
 * affected interface, and `spec_link` is left null on that interface.
 *
 * Findings flow upstream on `SoapEmitOutput.findings` (new array, additive
 * to the existing `interfaceCandidates` / `endpointCandidates` / `diagnostics`
 * fields) so the orchestrator in `springClassicSoap/index.ts` can pass them
 * to the existing `FindingEmitter` alongside the Phase 1 SOAP evidence-gap
 * findings. No parallel emitter pipeline.
 */

import type { DiscoveryCandidate, CandidateType } from '../../../../types/candidate';
import type { SpringWsSignal } from './springWsScanner';
import type { JaxWsSignal } from './jaxWsScanner';
import type { WsdlParseResult, WsdlOperation } from './wsdlParser';
import type { FindingEmitInput } from '../../FindingEmitter';
import {
  buildOasSpecAmbiguousGap,
  buildOasSpecOrphanGap,
} from '../../emissionSources';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/**
 * Diagnostic line shape captured by the emitter. The emitter mirrors each
 * entry to a `[diag-pack] scanner=spring_classic_soap signal=<A|B|C> ...`
 * log line via `console.log` (Group 6); callers may still inspect the
 * structured form on the return value.
 */
export interface DiagLine {
  /** Which signal contributed this emit -- A (Spring-WS), B (JAX-WS), C (WSDL) */
  signal: 'A' | 'B' | 'C';
  /** Parent SOAP interface candidate's short id (the candidate's `id`) */
  interface: string;
  /** Number of endpoint candidates emitted for this interface by this signal */
  operations: number;
}

export interface SoapEmitInput {
  springWs: SpringWsSignal[];
  jaxWs: JaxWsSignal[];
  wsdl: WsdlParseResult[];
  /**
   * Map keyed on the post-D-1 interface display name -> servlet path for that
   * interface. Caller (Group 5) populates this from `web.xml` /
   * `WebApplicationInitializer` parse output. Use `null` when the path is
   * unknown -- the emitter forwards the null straight through onto the
   * candidate's `path_or_address`, and Group 7 emits the
   * `soap_endpoint_url_unknown` `evidence_gap` finding.
   */
  servletPaths: Map<string, string | null>;
  /**
   * Phase 3 (Workstream B): pre-existing `spec_link` values keyed on the
   * post-D-1 interface display name. When present and non-null, the WSDL
   * `spec_link` promotion step SKIPS that interface and logs
   * `wsdl_spec_link_skipped pre_existing=<existing> path=<discovered>` --
   * the user's manual choice always wins (P-8).
   *
   * Optional. Callers (e.g. Phase 1's `index.ts`) that have no pre-existing
   * `spec_link` data may omit this field entirely. Empty map equivalent.
   */
  preExistingSpecLinks?: Map<string, string | null>;
}

export interface SoapEmitOutput {
  interfaceCandidates: DiscoveryCandidate[];
  endpointCandidates: DiscoveryCandidate[];
  diagnostics: DiagLine[];
  /**
   * Phase 3 (Workstream B): evidence-gap findings produced by the WSDL
   * `spec_link` promotion pass. Two sentinel `gapType` values flow through
   * this array:
   *  - `oas_spec_ambiguous_match` -- one WSDL matches >=2 interfaces, OR
   *    one interface matches >=2 WSDLs.
   *  - `oas_spec_orphan` -- a WSDL with a `targetNamespace` matches no
   *    in-scope interface candidate.
   *
   * Empty array when no spec-link gaps were detected. The caller
   * (`springClassicSoap/index.ts`) forwards these to the existing
   * `FindingEmitter` alongside the Phase 1 SOAP evidence-gap findings.
   */
  findings: FindingEmitInput[];
}

// ----------------------------------------------------------------------------
// Internal -- normalised merge records
// ----------------------------------------------------------------------------

/**
 * Per-operation merge slot. Fields are pulled from each signal independently;
 * the final candidate is built from these slots via D-2 precedence.
 */
interface OperationSlot {
  /** Operation identifier used for cross-signal merging */
  operationKey: string;

  // From annotations (Signal A or B) -- precedence target for DTO classes.
  ann_methodName: string | null;
  ann_requestRootElement: string | null;
  ann_responseRootElement: string | null;
  ann_namespace: string | null;
  ann_requestDtoClass: string | null;
  ann_responseDtoClass: string | null;
  ann_soapAction: string | null;

  // From WSDL (Signal C) -- precedence target for operation list + XML shapes.
  wsdl_operationName: string | null;
  wsdl_portName: string | null;
  wsdl_requestRootElement: string | null;
  wsdl_requestNamespace: string | null;
  wsdl_responseRootElement: string | null;
  wsdl_soapAction: string | null;
  wsdl_source: string | null;

  /** True when this slot has WSDL data -- WSDL contributed the operation */
  hasWsdl: boolean;
  /** True when this slot has annotation data */
  hasAnnotation: boolean;
}

/**
 * Per-interface merge record. Holds the raw D-1 inputs from each contributing
 * signal so the centralised naming pass can resolve the display name AFTER
 * all interfaces have been gathered (the tiebreaker rule needs the full
 * candidate set to detect collisions).
 */
interface InterfaceRecord {
  /** Internal merge key -- typically `package + simpleClassName` or `portTypeName` */
  mergeKey: string;

  // D-1 raw inputs
  webServiceNameAttribute: string | null;
  simpleClassName: string | null;
  packageName: string | null;
  /** WSDL `wsdl:portType` `name=`, when contributed by Signal C */
  wsdlPortTypeName: string | null;
  /** WSDL `wsdl:definitions` `targetNamespace=`, when present */
  wsdlTargetNamespace: string | null;

  // Provenance flags -- which signals contributed
  hasSignalA: boolean;
  hasSignalB: boolean;
  hasSignalC: boolean;

  /** Source files that fed this record (used for `sourceClusterIds`) */
  sourcePaths: Set<string>;

  /** Operation slots keyed by `operationKey` */
  operations: Map<string, OperationSlot>;

  /** Operation count contributed by each signal, for diagnostic lines */
  signalAOpCount: number;
  signalBOpCount: number;
  signalCOpCount: number;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Stable ID generator -- monotonic counter per call. */
function makeIdFactory(prefix: string): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n.toString().padStart(4, '0')}`;
  };
}

/** Pick the first non-null / non-empty value from the arguments. */
function firstNonNull<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) {
    if (v != null && v !== '') return v;
  }
  return null;
}

/**
 * Compute the D-1 layered-naming "candidate display name" given raw inputs.
 * Returns BOTH the rule-1/rule-2 base name AND a rule-3 tiebreaker form (for
 * use when collisions are detected across all interfaces).
 */
function computeBaseName(rec: InterfaceRecord): string {
  // Rule 1: @WebService(name=...) on the class.
  if (rec.webServiceNameAttribute) return rec.webServiceNameAttribute;
  // Rule 2: simple Java class name (no package prefix).
  if (rec.simpleClassName) return rec.simpleClassName;
  // Fallback for WSDL-only interfaces: use the portType name as the rule-2
  // analogue.
  if (rec.wsdlPortTypeName) return rec.wsdlPortTypeName;
  // Last resort: namespace-derived stub.
  if (rec.wsdlTargetNamespace) return rec.wsdlTargetNamespace;
  return 'UnknownSoapInterface';
}

/**
 * Tiebreaker form per D-1 rule 3: package + simple-name, falling back to
 * namespace-derived names when no package is available.
 */
function computeTiebreakerName(rec: InterfaceRecord, baseName: string): string {
  if (rec.packageName && rec.simpleClassName) {
    // Use the FQN to disambiguate.
    return `${rec.simpleClassName} (${rec.packageName})`;
  }
  if (rec.wsdlTargetNamespace) {
    return `${baseName} (${rec.wsdlTargetNamespace})`;
  }
  if (rec.packageName) {
    return `${baseName} (${rec.packageName})`;
  }
  return baseName;
}

/**
 * Build / fetch the interface record for a given merge key.
 */
function getOrCreateRecord(
  records: Map<string, InterfaceRecord>,
  mergeKey: string,
): InterfaceRecord {
  let rec = records.get(mergeKey);
  if (!rec) {
    rec = {
      mergeKey,
      webServiceNameAttribute: null,
      simpleClassName: null,
      packageName: null,
      wsdlPortTypeName: null,
      wsdlTargetNamespace: null,
      hasSignalA: false,
      hasSignalB: false,
      hasSignalC: false,
      sourcePaths: new Set<string>(),
      operations: new Map<string, OperationSlot>(),
      signalAOpCount: 0,
      signalBOpCount: 0,
      signalCOpCount: 0,
    };
    records.set(mergeKey, rec);
  }
  return rec;
}

/**
 * Build / fetch the operation slot for a given operation key.
 */
function getOrCreateOperationSlot(
  rec: InterfaceRecord,
  operationKey: string,
): OperationSlot {
  let slot = rec.operations.get(operationKey);
  if (!slot) {
    slot = {
      operationKey,
      ann_methodName: null,
      ann_requestRootElement: null,
      ann_responseRootElement: null,
      ann_namespace: null,
      ann_requestDtoClass: null,
      ann_responseDtoClass: null,
      ann_soapAction: null,
      wsdl_operationName: null,
      wsdl_portName: null,
      wsdl_requestRootElement: null,
      wsdl_requestNamespace: null,
      wsdl_responseRootElement: null,
      wsdl_soapAction: null,
      wsdl_source: null,
      hasWsdl: false,
      hasAnnotation: false,
    };
    rec.operations.set(operationKey, slot);
  }
  return slot;
}

/**
 * Compute the merge key for a Spring-WS or JAX-WS signal. The key MUST
 * align with the WSDL-side merge key so that an annotation describing the
 * same logical interface as a WSDL `wsdl:portType` collapses into a single
 * `InterfaceRecord`.
 *
 * Strategy (top-down):
 *  1. `@WebService(name=...)` attribute -- aligns with WSDL `portType` name
 *     when the developer wired the two manually (common case).
 *  2. Simple class name -- a weaker but still deterministic key for
 *     annotation-only signals (Signal A in isolation, Signal B in isolation).
 */
function annotationMergeKey(
  webServiceName: string | null,
  simpleClassName: string,
  packageName: string | null,
): string {
  if (webServiceName) return `name:${webServiceName}`;
  // Include the package in the class-based key so two classes with the same
  // simple name in different packages stay as distinct records (D-1 rule 3
  // tiebreaker is applied later when collisions need disambiguation).
  if (packageName) return `class:${packageName}.${simpleClassName}`;
  return `class:${simpleClassName}`;
}

/** Symmetric WSDL-side merge key -- prefers portType name over service name. */
function wsdlMergeKey(portTypeName: string): string {
  return `name:${portTypeName}`;
}

// ----------------------------------------------------------------------------
// Signal ingestion
// ----------------------------------------------------------------------------

function ingestSpringWs(
  signals: SpringWsSignal[],
  records: Map<string, InterfaceRecord>,
): void {
  for (const sig of signals) {
    const key = annotationMergeKey(sig.webServiceNameAttribute, sig.simpleClassName, sig.packageName);
    const rec = getOrCreateRecord(records, key);
    rec.hasSignalA = true;
    rec.webServiceNameAttribute = firstNonNull(
      rec.webServiceNameAttribute,
      sig.webServiceNameAttribute,
    );
    rec.simpleClassName = firstNonNull(rec.simpleClassName, sig.simpleClassName);
    rec.packageName = firstNonNull(rec.packageName, sig.packageName);
    rec.sourcePaths.add(sig.sourcePath);

    for (const op of sig.operations) {
      // Annotation operation key: prefer method name; fall back to localPart.
      const opKey = op.methodName || op.localPart;
      const slot = getOrCreateOperationSlot(rec, opKey);
      slot.hasAnnotation = true;
      slot.ann_methodName = firstNonNull(slot.ann_methodName, op.methodName);
      slot.ann_requestRootElement = firstNonNull(
        slot.ann_requestRootElement,
        op.localPart,
      );
      slot.ann_namespace = firstNonNull(slot.ann_namespace, op.namespace);
      slot.ann_requestDtoClass = firstNonNull(
        slot.ann_requestDtoClass,
        op.requestDtoClass,
      );
      slot.ann_responseDtoClass = firstNonNull(
        slot.ann_responseDtoClass,
        op.responseDtoClass,
      );
      // Spring-WS does not carry a soap_action -- @SoapAction is rare; leave null.
      rec.signalAOpCount += 1;
    }
  }
}

function ingestJaxWs(signals: JaxWsSignal[], records: Map<string, InterfaceRecord>): void {
  for (const sig of signals) {
    const key = annotationMergeKey(sig.webServiceNameAttribute, sig.simpleClassName, sig.packageName);
    const rec = getOrCreateRecord(records, key);
    rec.hasSignalB = true;
    rec.webServiceNameAttribute = firstNonNull(
      rec.webServiceNameAttribute,
      sig.webServiceNameAttribute,
    );
    rec.simpleClassName = firstNonNull(rec.simpleClassName, sig.simpleClassName);
    rec.packageName = firstNonNull(rec.packageName, sig.packageName);
    rec.sourcePaths.add(sig.sourcePath);

    for (const op of sig.operations) {
      const opKey = op.operationName || op.methodName;
      const slot = getOrCreateOperationSlot(rec, opKey);
      slot.hasAnnotation = true;
      slot.ann_methodName = firstNonNull(slot.ann_methodName, op.methodName);
      slot.ann_requestRootElement = firstNonNull(
        slot.ann_requestRootElement,
        op.requestRootElement,
      );
      slot.ann_responseRootElement = firstNonNull(
        slot.ann_responseRootElement,
        op.responseRootElement,
      );
      slot.ann_namespace = firstNonNull(slot.ann_namespace, sig.targetNamespace);
      slot.ann_requestDtoClass = firstNonNull(
        slot.ann_requestDtoClass,
        op.requestDtoClass,
      );
      slot.ann_responseDtoClass = firstNonNull(
        slot.ann_responseDtoClass,
        op.responseDtoClass,
      );
      // JAX-WS soap_action: synthesised from the operation name (target NS + op).
      // Leave null -- the WSDL signal owns the canonical soap_action.
      slot.ann_soapAction = firstNonNull(slot.ann_soapAction, op.operationName);
      rec.signalBOpCount += 1;
    }
  }
}

function ingestWsdl(
  wsdls: WsdlParseResult[],
  records: Map<string, InterfaceRecord>,
): void {
  for (const wsdl of wsdls) {
    // A single WSDL may declare multiple portTypes; group its operations by
    // portTypeName so each becomes its own logical SOAP interface.
    const byPortType = new Map<string, WsdlOperation[]>();
    for (const op of wsdl.operations) {
      const ptName = op.portTypeName || '__no_porttype__';
      const arr = byPortType.get(ptName) ?? [];
      arr.push(op);
      byPortType.set(ptName, arr);
    }

    for (const [portTypeName, ops] of byPortType) {
      const key = wsdlMergeKey(portTypeName);
      const rec = getOrCreateRecord(records, key);
      rec.hasSignalC = true;
      rec.wsdlPortTypeName = firstNonNull(rec.wsdlPortTypeName, portTypeName);
      rec.wsdlTargetNamespace = firstNonNull(
        rec.wsdlTargetNamespace,
        wsdl.targetNamespace,
      );
      rec.sourcePaths.add(wsdl.sourcePath);

      for (const op of ops) {
        // Multi-port WSDLs: each (port x operation) pair is its own endpoint.
        // Encode the port into the operation key so duplicate operation names
        // across ports do NOT collapse.
        const opKey = op.portName
          ? `${op.operationName}@${op.portName}`
          : op.operationName;
        const slot = getOrCreateOperationSlot(rec, opKey);
        slot.hasWsdl = true;
        slot.wsdl_operationName = firstNonNull(
          slot.wsdl_operationName,
          op.operationName,
        );
        slot.wsdl_portName = firstNonNull(slot.wsdl_portName, op.portName);
        slot.wsdl_requestRootElement = firstNonNull(
          slot.wsdl_requestRootElement,
          op.requestRootElement,
        );
        slot.wsdl_requestNamespace = firstNonNull(
          slot.wsdl_requestNamespace,
          op.requestNamespace,
        );
        slot.wsdl_responseRootElement = firstNonNull(
          slot.wsdl_responseRootElement,
          op.responseRootElement,
        );
        slot.wsdl_soapAction = firstNonNull(slot.wsdl_soapAction, op.soapAction);
        slot.wsdl_source = firstNonNull(slot.wsdl_source, wsdl.sourcePath);
        rec.signalCOpCount += 1;
      }
    }
  }
}

/**
 * Merge two interface records that should be combined post-ingest. Used when
 * an annotation-only record (keyed by class name) has a `@WebService(name=X)`
 * that matches a WSDL-only record keyed by portType `name:X`, OR when the
 * `simpleClassName` matches the WSDL portType name verbatim.
 *
 * We only attempt heuristic re-merging when the keys do NOT already match.
 * The primary path (annotation `name:X` + WSDL `name:X`) collapses
 * automatically because they share the same key.
 */
function crossMergeAnnotationsToWsdl(records: Map<string, InterfaceRecord>): void {
  // Build a lookup by portTypeName -> WSDL record.
  const wsdlRecsByPortType = new Map<string, InterfaceRecord>();
  for (const rec of records.values()) {
    if (rec.hasSignalC && rec.wsdlPortTypeName) {
      wsdlRecsByPortType.set(rec.wsdlPortTypeName, rec);
    }
  }
  if (wsdlRecsByPortType.size === 0) return;

  const toDelete: string[] = [];
  for (const [key, rec] of records) {
    if (!(rec.hasSignalA || rec.hasSignalB) || rec.hasSignalC) continue;
    // Determine whether this annotation record matches a WSDL portType.
    const candidatePortTypeName =
      rec.webServiceNameAttribute ?? rec.simpleClassName ?? null;
    if (!candidatePortTypeName) continue;
    const wsdlRec = wsdlRecsByPortType.get(candidatePortTypeName);
    if (!wsdlRec) continue;
    if (wsdlRec === rec) continue;

    // Merge `rec` (annotation-only) into `wsdlRec`.
    wsdlRec.hasSignalA = wsdlRec.hasSignalA || rec.hasSignalA;
    wsdlRec.hasSignalB = wsdlRec.hasSignalB || rec.hasSignalB;
    wsdlRec.webServiceNameAttribute = firstNonNull(
      wsdlRec.webServiceNameAttribute,
      rec.webServiceNameAttribute,
    );
    wsdlRec.simpleClassName = firstNonNull(
      wsdlRec.simpleClassName,
      rec.simpleClassName,
    );
    wsdlRec.packageName = firstNonNull(wsdlRec.packageName, rec.packageName);
    for (const p of rec.sourcePaths) wsdlRec.sourcePaths.add(p);
    wsdlRec.signalAOpCount += rec.signalAOpCount;
    wsdlRec.signalBOpCount += rec.signalBOpCount;

    // Re-key operation slots. The annotation key is typically the method name;
    // map onto WSDL slots when the method name matches an operation name.
    for (const [opKey, annSlot] of rec.operations) {
      // First try direct WSDL key match (same opKey).
      let target: OperationSlot | undefined = wsdlRec.operations.get(opKey);
      // Otherwise try matching by operationName (without the port suffix).
      if (!target) {
        for (const [wKey, wSlot] of wsdlRec.operations) {
          if (
            wSlot.wsdl_operationName === opKey ||
            wSlot.wsdl_operationName === annSlot.ann_methodName ||
            wKey === opKey
          ) {
            target = wSlot;
            break;
          }
        }
      }
      if (target) {
        // Merge annotation fields into the WSDL slot (annotations supplement).
        target.hasAnnotation = true;
        target.ann_methodName = firstNonNull(target.ann_methodName, annSlot.ann_methodName);
        target.ann_requestRootElement = firstNonNull(
          target.ann_requestRootElement,
          annSlot.ann_requestRootElement,
        );
        target.ann_responseRootElement = firstNonNull(
          target.ann_responseRootElement,
          annSlot.ann_responseRootElement,
        );
        target.ann_namespace = firstNonNull(target.ann_namespace, annSlot.ann_namespace);
        target.ann_requestDtoClass = firstNonNull(
          target.ann_requestDtoClass,
          annSlot.ann_requestDtoClass,
        );
        target.ann_responseDtoClass = firstNonNull(
          target.ann_responseDtoClass,
          annSlot.ann_responseDtoClass,
        );
        target.ann_soapAction = firstNonNull(
          target.ann_soapAction,
          annSlot.ann_soapAction,
        );
      } else {
        // Annotation describes an operation absent from the WSDL -- keep it.
        wsdlRec.operations.set(opKey, annSlot);
      }
    }

    toDelete.push(key);
  }
  for (const k of toDelete) records.delete(k);
}

/**
 * Within a single `InterfaceRecord`, merge annotation-only operation slots
 * onto matching WSDL operation slots. This handles the case where Signal A/B
 * and Signal C both describe the same logical interface AND were keyed onto
 * the same record during ingestion (`name:X` from `@WebService(name=X)` plus
 * WSDL `portType` `name="X"`), but their operation slots were keyed
 * differently (annotation by method name, WSDL by `operationName@portName`).
 *
 * Matching rule for a pair of slots:
 *  - annotation `ann_methodName` equals WSDL `wsdl_operationName`
 *  - OR annotation operation-key equals WSDL `wsdl_operationName`
 *
 * The result is one slot per WSDL operation, with annotation fields folded in.
 * Annotation-only slots that do NOT match any WSDL operation are KEPT verbatim
 * (the annotation describes an operation absent from the WSDL).
 */
function consolidateOperationsWithinRecord(rec: InterfaceRecord): void {
  // Only relevant when both annotation and WSDL contributed slots.
  if (!(rec.hasSignalA || rec.hasSignalB)) return;
  if (!rec.hasSignalC) return;

  // Partition slots into "annotation-only" and "wsdl-bearing".
  const annOnly: Array<[string, OperationSlot]> = [];
  const wsdlSlots: Array<[string, OperationSlot]> = [];
  for (const [k, slot] of rec.operations) {
    if (slot.hasWsdl) {
      wsdlSlots.push([k, slot]);
    } else if (slot.hasAnnotation) {
      annOnly.push([k, slot]);
    }
  }
  if (wsdlSlots.length === 0 || annOnly.length === 0) return;

  for (const [annKey, annSlot] of annOnly) {
    // Locate a matching WSDL slot.
    let matched: OperationSlot | undefined;
    for (const [, wSlot] of wsdlSlots) {
      const wsdlOpName = wSlot.wsdl_operationName;
      if (!wsdlOpName) continue;
      if (
        wsdlOpName === annSlot.ann_methodName ||
        wsdlOpName === annKey ||
        // Spring-WS pattern: `@PayloadRoot.localPart` (stored as the
        // annotation's `ann_requestRootElement`) commonly equals the WSDL
        // operation name (both describe the request root element).
        wsdlOpName === annSlot.ann_requestRootElement
      ) {
        matched = wSlot;
        break;
      }
    }
    if (!matched) continue; // Keep annotation slot as-is (no WSDL counterpart).
    // Fold annotation fields into the WSDL slot. WSDL fields are NOT
    // overwritten -- D-2 precedence is applied later in `buildEndpointData`.
    matched.hasAnnotation = true;
    matched.ann_methodName = firstNonNull(matched.ann_methodName, annSlot.ann_methodName);
    matched.ann_requestRootElement = firstNonNull(
      matched.ann_requestRootElement,
      annSlot.ann_requestRootElement,
    );
    matched.ann_responseRootElement = firstNonNull(
      matched.ann_responseRootElement,
      annSlot.ann_responseRootElement,
    );
    matched.ann_namespace = firstNonNull(matched.ann_namespace, annSlot.ann_namespace);
    matched.ann_requestDtoClass = firstNonNull(
      matched.ann_requestDtoClass,
      annSlot.ann_requestDtoClass,
    );
    matched.ann_responseDtoClass = firstNonNull(
      matched.ann_responseDtoClass,
      annSlot.ann_responseDtoClass,
    );
    matched.ann_soapAction = firstNonNull(matched.ann_soapAction, annSlot.ann_soapAction);
    // Drop the annotation-only slot now that its fields are folded in.
    rec.operations.delete(annKey);
  }
}

// ----------------------------------------------------------------------------
// Candidate building
// ----------------------------------------------------------------------------

const ISO_NOW = (): string => new Date().toISOString();
const DEFAULT_RUN_ID = 'pending'; // Caller (Group 5) re-stamps runId before persistence.

/**
 * D-2 precedence: build the per-operation `data` blob.
 *
 * Phase 2 Group 3 (spec 2026-05-17-soap-llm-extraction-and-payload-
 * enrichment-phase-2): the `data` blob also carries
 * `discovery_method: 'framework_scanner'` so downstream consumers
 * (candidate-review UI chip, AMS save-back JSONB blob) can distinguish
 * deterministic-scanner candidates from LLM-extracted ones. The
 * Workstream A LLM emit path (Group 7) sets `'llm_extraction'` in the
 * same key.
 */
function buildEndpointData(
  slot: OperationSlot,
  parentInterfaceId: string,
  servletPath: string | null,
): Record<string, unknown> {
  // WSDL wins for XML signatures; annotations win for DTOs.
  const requestRootElement = firstNonNull(
    slot.wsdl_requestRootElement,
    slot.ann_requestRootElement,
  );
  const requestNamespace = firstNonNull(
    slot.wsdl_requestNamespace,
    slot.ann_namespace,
  );
  const responseRootElement = firstNonNull(
    slot.wsdl_responseRootElement,
    slot.ann_responseRootElement,
  );
  // DTO classes only ever come from annotations.
  const requestDtoClass = slot.ann_requestDtoClass;
  const responseDtoClass = slot.ann_responseDtoClass;
  // soap_action: WSDL ground truth; fall back to annotation-synthesised name.
  const soapAction = firstNonNull(slot.wsdl_soapAction, slot.ann_soapAction);
  // wsdl_source only populated when Signal C contributed.
  const wsdlSource = slot.wsdl_source;

  return {
    interface_id: parentInterfaceId,
    operation_verb: 'POST', // D-3
    path_or_address: servletPath,
    soap_action: soapAction,
    request_root_element: requestRootElement,
    request_namespace: requestNamespace,
    response_root_element: responseRootElement,
    request_dto_class: requestDtoClass,
    response_dto_class: responseDtoClass,
    wsdl_source: wsdlSource,
    // Phase 2 Group 3: trace metadata so the UI chip can render
    // "Framework scan" vs "LLM extracted" without an additional API call.
    discovery_method: 'framework_scanner',
    _addedBy: 'spring-classic-soap',
  };
}

/**
 * Compute the display name for each `InterfaceRecord` after applying D-1:
 *  - Step 1: compute the rule-1 / rule-2 base name for every record.
 *  - Step 2: detect collisions across the full record set. For every group of
 *    records sharing the same base name, apply rule 3 to produce a unique
 *    tiebreaker form for each one.
 */
function resolveDisplayNames(
  records: InterfaceRecord[],
): Map<InterfaceRecord, string> {
  const baseNames = new Map<InterfaceRecord, string>();
  const byBaseName = new Map<string, InterfaceRecord[]>();
  for (const rec of records) {
    const base = computeBaseName(rec);
    baseNames.set(rec, base);
    const list = byBaseName.get(base) ?? [];
    list.push(rec);
    byBaseName.set(base, list);
  }
  const out = new Map<InterfaceRecord, string>();
  for (const [base, group] of byBaseName) {
    if (group.length === 1) {
      out.set(group[0], base);
      continue;
    }
    // Collision -- apply rule 3 tiebreaker per record.
    const seen = new Set<string>();
    for (const rec of group) {
      let tb = computeTiebreakerName(rec, base);
      // Belt-and-braces: if rule 3 still collides (e.g. same package + same
      // namespace), suffix with the merge key so display names remain unique.
      let attempt = tb;
      let suffix = 1;
      while (seen.has(attempt)) {
        attempt = `${tb}#${suffix}`;
        suffix += 1;
      }
      tb = attempt;
      seen.add(tb);
      out.set(rec, tb);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Phase 3 -- Workstream B: WSDL `spec_link` promotion
// ----------------------------------------------------------------------------

/**
 * Promote WSDL repo-relative paths onto parent SOAP interface candidates as
 * `data.spec_link`. Pure transformation over the already-built candidates +
 * the input WSDL list; mutates candidate `data.spec_link` in place when a
 * unique exact namespace match is found.
 *
 * Returns the list of `evidence_gap` findings produced (ambiguous / orphan
 * cases); side-effect: writes `[diag-pack] scanner=spring_classic_soap
 * wsdl_spec_link=...` log lines for every outcome.
 *
 * Match strategy (P-3): EXACT byte-for-byte `targetNamespace` against the
 * interface's `data.wsdlTargetNamespace`. No fuzzy / case-insensitive /
 * trailing-slash-tolerant matching.
 */
function promoteWsdlSpecLinks(
  interfaceCandidates: DiscoveryCandidate[],
  wsdls: WsdlParseResult[],
  preExistingByDisplayName: Map<string, string | null>,
): FindingEmitInput[] {
  const findings: FindingEmitInput[] = [];

  // Filter to WSDLs that have a non-null targetNamespace -- WSDLs without a
  // namespace cannot be matched and would always be reported as orphan; the
  // sensible behaviour is to skip them entirely (they will already have been
  // surfaced via `wsdl_parse_failed` if malformed).
  const wsdlsForMatch = wsdls.filter(
    (w) =>
      typeof w.targetNamespace === 'string' &&
      w.targetNamespace.length > 0 &&
      typeof w.sourcePath === 'string' &&
      w.sourcePath.length > 0,
  );
  if (wsdlsForMatch.length === 0) return findings;

  // Build per-WSDL match lists, AND track the inverse map
  // (interface -> WSDLs that match it) so we can flag "one interface matched
  // by >=2 WSDLs" as ambiguous too.
  const matchesByWsdl = new Map<WsdlParseResult, DiscoveryCandidate[]>();
  const wsdlsByInterface = new Map<DiscoveryCandidate, WsdlParseResult[]>();

  for (const wsdl of wsdlsForMatch) {
    const ns = wsdl.targetNamespace as string;
    const matches: DiscoveryCandidate[] = [];
    for (const iface of interfaceCandidates) {
      const ifaceNs =
        (iface.data as Record<string, unknown> | undefined)?.wsdlTargetNamespace;
      if (typeof ifaceNs !== 'string') continue;
      if (ifaceNs !== ns) continue; // EXACT byte-for-byte match (P-3)
      matches.push(iface);
      const arr = wsdlsByInterface.get(iface) ?? [];
      arr.push(wsdl);
      wsdlsByInterface.set(iface, arr);
    }
    matchesByWsdl.set(wsdl, matches);
  }

  // Track which interfaces are involved in ANY ambiguous case so that on the
  // unique-match branch below we still skip them (their `spec_link` must
  // remain null per P-4).
  const ambiguousInterfaces = new Set<DiscoveryCandidate>();
  for (const [iface, wsdlList] of wsdlsByInterface) {
    if (wsdlList.length >= 2) ambiguousInterfaces.add(iface);
  }

  // Pass 1: per-WSDL outcomes -- orphan / ambiguous / unique.
  for (const wsdl of wsdlsForMatch) {
    const matches = matchesByWsdl.get(wsdl) ?? [];
    const wsdlPath = wsdl.sourcePath;

    if (matches.length === 0) {
      // Orphan WSDL.
      console.warn(
        `[diag-pack] scanner=spring_classic_soap wsdl_spec_link=orphan path=${wsdlPath}`,
      );
      findings.push(
        buildOasSpecOrphanGap({
          specFilePath: wsdlPath,
          reason:
            `WSDL targetNamespace '${wsdl.targetNamespace}' did not match any in-scope SOAP interface candidate's request_namespace.`,
        }),
      );
      continue;
    }

    if (matches.length >= 2) {
      // Ambiguous: one WSDL matched >=2 interfaces.
      const candidateIds = matches.map((m) => m.id);
      console.warn(
        `[diag-pack] scanner=spring_classic_soap wsdl_spec_link=ambiguous candidates=[${candidateIds.join(',')}] path=${wsdlPath}`,
      );
      findings.push(
        buildOasSpecAmbiguousGap({
          specFilePath: wsdlPath,
          candidateInterfaceIds: candidateIds,
          reason:
            `WSDL targetNamespace '${wsdl.targetNamespace}' matched ${matches.length} SOAP interface candidates; spec_link left null on all involved candidates.`,
        }),
      );
      continue;
    }

    // Unique match (matches.length === 1).
    const iface = matches[0];

    // If this interface is also matched by a different WSDL (inverse
    // ambiguity), the ambiguous-interface pass below will flag it; leave its
    // `spec_link` null here too. Per-WSDL log line still useful for diagnostics
    // so operators can correlate which WSDL contributed which candidate set;
    // emit the ambiguous-interface line in pass 2 (single line per affected
    // interface) so each interface gets one finding rather than N.
    if (ambiguousInterfaces.has(iface)) {
      continue;
    }

    // Pre-existing `spec_link` check (P-8) -- user's manual choice always wins.
    // Two sources of "pre-existing":
    //  (a) the interface candidate's `data.spec_link` is already non-null
    //      (e.g. set upstream by Phase 3 Workstream A's specFileLinker pass
    //      running on a project that ships BOTH an OAS YAML and a sibling
    //      WSDL).
    //  (b) the caller (`springClassicSoap/index.ts`) supplied a
    //      `preExistingSpecLinks` map keyed on the post-D-1 interface
    //      display name. This is the path for AMS-side stored values
    //      threaded back into the run.
    const dataMap = iface.data as Record<string, unknown>;
    const existingOnCandidate = dataMap.spec_link;
    const existingFromCaller = preExistingByDisplayName.get(iface.name) ?? null;
    const existing =
      typeof existingOnCandidate === 'string' && existingOnCandidate.length > 0
        ? existingOnCandidate
        : typeof existingFromCaller === 'string' && existingFromCaller.length > 0
          ? existingFromCaller
          : null;
    if (existing != null) {
      console.warn(
        `[diag-pack] scanner=spring_classic_soap wsdl_spec_link_skipped pre_existing=${existing} path=${wsdlPath}`,
      );
      continue;
    }

    // Set the spec_link.
    dataMap.spec_link = wsdlPath;
    console.log(
      `[diag-pack] scanner=spring_classic_soap wsdl_spec_link=set interface=${iface.id} path=${wsdlPath}`,
    );
  }

  // Pass 2: inverse-ambiguity -- one interface matched by >=2 WSDLs. Emit a
  // single finding listing the interface id and ALL matched WSDL paths.
  for (const [iface, wsdlList] of wsdlsByInterface) {
    if (wsdlList.length < 2) continue;
    const pathsList = wsdlList.map((w) => w.sourcePath).join(',');
    console.warn(
      `[diag-pack] scanner=spring_classic_soap wsdl_spec_link=ambiguous candidates=[${iface.id}] paths=[${pathsList}]`,
    );
    findings.push(
      buildOasSpecAmbiguousGap({
        // Use the first WSDL path as the gap's `specFilePath` anchor; the
        // reason carries the full list of paths for the reviewer.
        specFilePath: wsdlList[0].sourcePath,
        candidateInterfaceIds: [iface.id],
        reason:
          `SOAP interface '${iface.name}' matched ${wsdlList.length} WSDLs by targetNamespace (${pathsList}); spec_link left null.`,
      }),
    );
  }

  return findings;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function emitSoapCandidates(input: SoapEmitInput): SoapEmitOutput {
  const records = new Map<string, InterfaceRecord>();

  // 1) Ingest each signal stream into the per-interface merge records.
  ingestSpringWs(input.springWs, records);
  ingestJaxWs(input.jaxWs, records);
  ingestWsdl(input.wsdl, records);

  // 2) Cross-merge: collapse annotation-only records onto matching WSDL
  // portType records when the keys disagree but the names align.
  crossMergeAnnotationsToWsdl(records);

  // 2b) Within each merged record, fold annotation-only operation slots
  // onto matching WSDL operation slots so a single endpoint candidate is
  // emitted per `(port x operation)` pair when both signals describe it.
  for (const rec of records.values()) {
    consolidateOperationsWithinRecord(rec);
  }

  // 3) Apply D-1 layered naming across the full record set (so collisions
  // can be detected and tiebroken).
  const allRecords = Array.from(records.values());
  const displayNames = resolveDisplayNames(allRecords);

  // 4) Build the candidate rows.
  const ifaceIds = makeIdFactory('cand-soap-iface');
  const epIds = makeIdFactory('cand-soap-ep');

  const interfaceCandidates: DiscoveryCandidate[] = [];
  const endpointCandidates: DiscoveryCandidate[] = [];
  const diagnostics: DiagLine[] = [];
  const now = ISO_NOW();

  for (const rec of allRecords) {
    const name = displayNames.get(rec) ?? rec.mergeKey;
    const ifaceId = ifaceIds();

    // Parent SOAP interface candidate.
    interfaceCandidates.push({
      id: ifaceId,
      runId: DEFAULT_RUN_ID,
      candidateType: 'interfaces' as CandidateType,
      name,
      confidence: 0.9,
      status: 'proposed',
      sourceClusterIds: Array.from(rec.sourcePaths),
      data: {
        interface_type: 'SOAP_API',
        simpleClassName: rec.simpleClassName,
        packageName: rec.packageName,
        wsdlPortTypeName: rec.wsdlPortTypeName,
        wsdlTargetNamespace: rec.wsdlTargetNamespace,
        webServiceNameAttribute: rec.webServiceNameAttribute,
        // Phase 2 Group 3: trace metadata also lives on the parent
        // interface candidate so the chip renders next to the interface
        // name in the candidate-review UI.
        discovery_method: 'framework_scanner',
        _addedBy: 'spring-classic-soap',
      },
      synthesizedAt: now,
    });

    // Resolve servlet path -- caller-supplied via display name.
    const servletPath = input.servletPaths.has(name)
      ? input.servletPaths.get(name) ?? null
      : null;

    // Endpoint candidates -- one per operation slot (post-merge, deduped).
    for (const slot of rec.operations.values()) {
      const epId = epIds();
      endpointCandidates.push({
        id: epId,
        runId: DEFAULT_RUN_ID,
        candidateType: 'endpoints' as CandidateType,
        name:
          slot.wsdl_operationName ??
          slot.ann_methodName ??
          slot.operationKey,
        confidence: 0.9,
        status: 'proposed',
        sourceClusterIds: Array.from(rec.sourcePaths),
        data: buildEndpointData(slot, ifaceId, servletPath),
        synthesizedAt: now,
        parentCandidateId: ifaceId,
      });
    }

    // Per-signal diagnostic lines (one per signal x interface contribution).
    // Group 6: also mirror each entry to the scanner runner's diagnostic
    // sink as a `[diag-pack] scanner=spring_classic_soap signal=<A|B|C> ...`
    // line. The structured `DiagLine` value remains on the return for
    // downstream consumers (tests, callers wiring evidence-gap findings).
    if (rec.hasSignalA && rec.signalAOpCount > 0) {
      diagnostics.push({
        signal: 'A',
        interface: ifaceId,
        operations: rec.signalAOpCount,
      });
      console.log(
        `[diag-pack] scanner=spring_classic_soap signal=A interface=${ifaceId} operations=${rec.signalAOpCount}`,
      );
    }
    if (rec.hasSignalB && rec.signalBOpCount > 0) {
      diagnostics.push({
        signal: 'B',
        interface: ifaceId,
        operations: rec.signalBOpCount,
      });
      console.log(
        `[diag-pack] scanner=spring_classic_soap signal=B interface=${ifaceId} operations=${rec.signalBOpCount}`,
      );
    }
    if (rec.hasSignalC && rec.signalCOpCount > 0) {
      diagnostics.push({
        signal: 'C',
        interface: ifaceId,
        operations: rec.signalCOpCount,
      });
      console.log(
        `[diag-pack] scanner=spring_classic_soap signal=C interface=${ifaceId} operations=${rec.signalCOpCount}`,
      );
    }
  }

  // 5) Phase 3 Workstream B: promote WSDL repo-relative paths onto parent
  // SOAP interface candidates as `data.spec_link` via exact-only
  // `targetNamespace` matching. Returns the evidence-gap findings produced
  // by ambiguous / orphan WSDL cases; the caller forwards these to the
  // existing `FindingEmitter` alongside the Phase 1 SOAP evidence-gap
  // findings.
  const preExisting = input.preExistingSpecLinks ?? new Map<string, string | null>();
  const specLinkFindings = promoteWsdlSpecLinks(
    interfaceCandidates,
    input.wsdl,
    preExisting,
  );

  return {
    interfaceCandidates,
    endpointCandidates,
    diagnostics,
    findings: specLinkFindings,
  };
}
