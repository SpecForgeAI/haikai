/**
 * Spring Classic SOAP sub-module -- public orchestrator entry point.
 *
 * Spec: agent-os/specs/2026-05-17-soap-discovery-spring-classic-phase-1/spec.md
 * Spec 4 (message-field depth): agent-os/specs/2026-05-30-soap-wsdl-message-field-depth/spec.md
 *
 * ===========================================================================
 * MODULE HEADER (Task Group 13)
 * ===========================================================================
 *
 * Purpose
 * -------
 * Discover SOAP services in a Spring Classic codebase by merging three
 * deterministic signals into a single stream of interface + endpoint
 * `DiscoveryCandidate` rows. Sits alongside the existing REST emit path in
 * `springClassicFindingScanner.ts` as a peer pass (one call site, no parallel
 * pipeline).
 *
 * The three signals
 * -----------------
 *  - Signal A: Spring-WS annotations (`@Endpoint` + `@PayloadRoot`) scanned
 *    by `springWsScanner.ts`. Pure regex/AST over Java source strings.
 *  - Signal B: JAX-WS annotations (`@WebService` + `@WebMethod`, plus
 *    `@RequestWrapper` / `@ResponseWrapper`) scanned by `jaxWsScanner.ts`.
 *    Hand-written `@WebService` classes only; Apache CXF generated sources
 *    under `target/generated-sources/cxf/` are out of scope per Q-10.
 *  - Signal C: WSDL files (`*.wsdl`) parsed by `wsdlParser.ts`. Pure XML
 *    walk via `fast-xml-parser`; soft-fails on malformed XML (returns an
 *    empty operations list with a `parseError` for Group 7 to translate
 *    into a `wsdl_parse_failed` `evidence_gap` finding). No network access;
 *    only relative `xsd:import` / `xsd:include` resolved (absolute URLs
 *    silently skipped per D-4).
 *
 * ===========================================================================
 * Spec 4 (Task Group 4) -- message-shape emission downstream of detection
 * ===========================================================================
 * The three scanners above stay AS-IS for operation/interface detection. Spec 4
 * adds a downstream message-shape pass:
 *  - `wsdlParser.ts` now also returns the deeply-walked `messageTypes` (the
 *    WSDL/XSD view) + `fieldDepthFindings` (depth-cap / cycle / multi-part).
 *  - `javaDtoFieldParser.ts` parses the annotated `@XmlType` / `@RequestWrapper`
 *    / `@ResponseWrapper` DTO classes into the SAME `MessageType` shape (the
 *    Java view) -- the only field source for annotation-only / no-WSDL services.
 *  - `messageReconciler.ts` MERGES the two source views of the same message
 *    type into one (within-run, deterministic; the cross-MODEL dedup stays at
 *    save-back / Group 6).
 *  - `messageEntityEmitter.ts` mints the `logical_data_entities` /
 *    `logical_data_attributes` / `logical_data_entity_relationships` /
 *    `interface_logical_entities` candidates, binds the endpoint request/
 *    response messages in place (`data.requestEntity` / `data.responseEntity`),
 *    and translates the field-depth + neither-source Findings.
 * The new candidates ride on `SpringClassicSoapPassOutput.messageCandidates`;
 * the new Findings are concatenated onto `findings`.
 *
 * D-1 layered naming rule (applied centrally in `soapEndpointEmitter.ts`)
 * ----------------------------------------------------------------------
 * Top-down, first match wins:
 *   1. `@WebService(name=...)` attribute on the class, when present.
 *   2. The `@Endpoint` / `@WebService`-annotated class's **simple Java
 *      name** (no package prefix).
 *   3. Package name + namespace-derived names as **tiebreakers only** --
 *      used to disambiguate when two candidates collide on the same
 *      display name from rules 1 or 2.
 *
 * D-2 split-source precedence (per field, not per signal)
 * -------------------------------------------------------
 * When both annotations (A or B) and WSDL (C) describe the same operation,
 * merge per field. Never duplicate operations.
 *   - **WSDL wins** for the operation list itself and for the XML signature
 *     fields: `request_root_element`, `request_namespace`,
 *     `response_root_element`.
 *   - **Annotations win** for fully-qualified Java class names:
 *     `request_dto_class`, `response_dto_class` (the WSDL has no Java
 *     class binding, so annotations are the only source).
 *
 * D-3 `operation_verb='POST'` rationale
 * -------------------------------------
 * Every emitted endpoint candidate carries `operation_verb='POST'`. SOAP
 * over HTTP is always POST -- the verb field carries no SOAP-specific
 * information. The kind signal lives on `soap_action` plus the parent
 * interface candidate's `interface_type='SOAP_API'`.
 *
 * D-5 storage shape -- `protocol_metadata_json` JSONB
 * ---------------------------------------------------
 * All seven new SOAP fields ride inside the AMS `endpoints` table's
 * `protocol_metadata_json` JSONB column (Liquibase changeset 138). The
 * seven fields are:
 *   - `soap_action`
 *   - `request_root_element`
 *   - `request_namespace`
 *   - `response_root_element`
 *   - `request_dto_class`
 *   - `response_dto_class`
 *   - `wsdl_source`
 * Promotion of any of these to explicit columns is deferred to a future
 * spec. The candidate-side `data` field set here MUST match the AMVS-side
 * enumeration in `synthesiseInventoryFromEndpoints` exactly (that contract
 * is what lets Step 4 pre-populate without manual entry).
 *
 * Group 8 interface-type vocab audit outcome
 * ------------------------------------------
 * Confirmed end-to-end: 'SOAP_API' flows through discovery -> AMS ->
 * frontend without coercion.
 *
 * ===========================================================================
 * Task Group: 5 (Wire SOAP Sub-Module into Spring Classic Scanner).
 * Task Group: 6 (Diagnostic Logging).
 *
 * The three signal streams flow into `soapEndpointEmitter.emitSoapCandidates`
 * which applies the D-1 and D-2 rules described above.
 *
 * This orchestrator is pure (besides the diagnostic-sink writes added by
 * Group 6): it only reads the supplied IR file map. WSDL sources are
 * discovered by walking the IR for files whose `filePath` ends with `.wsdl`
 * and that carry `rawContent`. Annotation sources are picked up from any
 * Java IR entry with `rawContent`.
 *
 * Diagnostics (Group 6): structured `[diag-pack] scanner=spring_classic_soap`
 * log lines are written to the scanner runner's diagnostic sink (`console.log`
 * / `console.warn`) at the following points:
 *  - Start of pass: `start files=<N>` (N = count of Java + WSDL files).
 *  - Per WSDL parse: `wsdl_parse=ok path=<rel> operations=<N> ports=<N>` on
 *    success or `wsdl_parse=fail path=<rel> reason=<...>` on soft-fail.
 *  - Per-signal contribution: `signal=<A|B|C> interface=<short-id> operations=<N>`
 *    -- these lines are written by `emitSoapCandidates` itself, alongside the
 *    structured `DiagLine` array returned on `SoapEmitOutput.diagnostics`.
 *  - Per interface lacking a servlet-path inference: `servlet_path=unknown
 *    interface=<short-id>` (paired with a `soap_endpoint_url_unknown`
 *    `evidence_gap` finding emitted by Group 7).
 *  - Spec 4 message-shape pass: `message_shape emitted_candidates=<N>
 *    reconciled_types=<N> field_findings=<N>`.
 *
 * ===========================================================================
 * Phase 3 (2026-05-17 Spec File Auto-Linking, Task Group 4 / 5 -- Workstream B)
 * ===========================================================================
 *
 * The emitter (`soapEndpointEmitter.ts`) now also promotes WSDL repo-relative
 * paths onto parent SOAP interface candidates as `data.spec_link`. The
 * emitter exposes the resulting evidence-gap findings on `SoapEmitOutput.findings`
 * and accepts an optional `preExistingSpecLinks` map keyed on the post-D-1
 * interface display name. This orchestrator's responsibilities are:
 *
 *   - Build the `preExistingSpecLinks` map from any pre-existing interface
 *     candidates the caller threads in (e.g. Workstream A's `specFileLinker`
 *     ran first and produced `spec_link` on an interface that the SOAP pass
 *     would now consider promoting). Display name = `candidate.name`.
 *   - Forward `emitOutput.findings` to the caller on the new
 *     `SpringClassicSoapPassOutput.findings` field so the surrounding
 *     pipeline can fold them into the existing `FindingEmitter` batch (no
 *     parallel emitter -- P-1 / P-12 contract).
 */

import type { DiscoveryCandidate } from '../../../../types/candidate';
import type { SourceFileIR } from '../../../extensionPacks';
import type { FindingEmitInput } from '../../FindingEmitter';
import type { PackFindingScannerInput } from '../index';
import { scanSpringWsSources } from './springWsScanner';
import { scanJaxWsSources } from './jaxWsScanner';
import { parseWsdl, type WsdlParseResult } from './wsdlParser';
import {
  emitSoapCandidates,
  type DiagLine,
  type SoapEmitOutput,
} from './soapEndpointEmitter';
import { buildSoapEvidenceGapFindings } from './soapEvidenceGaps';
import { parseJavaDtoFields } from './javaDtoFieldParser';
import {
  emitMessageEntities,
  type MessageEntityEmitOutput,
} from './messageEntityEmitter';
import { emitSoapDataEffects } from './soapDataEffectEmitter';

// ----------------------------------------------------------------------------
// Public types
// ----------------------------------------------------------------------------

/**
 * Output of the orchestrated SOAP pass. Mirrors `SoapEmitOutput` from the
 * emitter (so the caller can fold it directly into the scanner's return) and
 * forwards the emitter's diagnostic stream.
 *
 * Phase 3 Workstream B addition: `findings` carries the
 * `oas_spec_ambiguous_match` / `oas_spec_orphan` evidence-gap findings
 * produced by the WSDL `spec_link` promotion step inside the emitter. The
 * caller forwards these to the existing `FindingEmitter` alongside the
 * Phase 1 SOAP evidence-gap findings.
 *
 * Spec 4 addition: `messageCandidates` carries the message-shape candidates
 * (`logical_data_entities` / `logical_data_attributes` /
 * `logical_data_entity_relationships` / `interface_logical_entities`) minted by
 * the downstream `messageEntityEmitter.ts`. The endpoint request/response
 * bindings are applied IN PLACE on `endpointCandidates` (`data.requestEntity` /
 * `data.responseEntity`); the field-depth + neither-source Findings are folded
 * into `findings`.
 */
export interface SpringClassicSoapPassOutput {
  interfaceCandidates: DiscoveryCandidate[];
  endpointCandidates: DiscoveryCandidate[];
  /**
   * Spec 4 message-shape candidates (entities + attributes + shared-type
   * relationships + interface links). Empty array when no message fields parse.
   */
  messageCandidates: DiscoveryCandidate[];
  diagnostics: DiagLine[];
  /**
   * Evidence-gap findings produced by the emitter's WSDL `spec_link`
   * promotion step PLUS (Spec 4) the message-shape field-depth + neither-source
   * findings. Empty array when none were detected.
   */
  findings: FindingEmitInput[];
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

/** Detect WSDL-bearing IR entries by file extension + rawContent presence. */
function isWsdlFile(ir: SourceFileIR): boolean {
  const fp = ir.filePath.toLowerCase();
  return fp.endsWith('.wsdl') && typeof ir.rawContent === 'string' && ir.rawContent.length > 0;
}

/** Detect Java IR entries carrying `rawContent` (the annotation scanners
 *  operate on raw source strings, not class-level AST). */
function isJavaSourceFile(ir: SourceFileIR): boolean {
  return (
    ir.language === 'java' &&
    typeof ir.rawContent === 'string' &&
    ir.rawContent.length > 0
  );
}

/**
 * Build the emitter's `preExistingSpecLinks` map (keyed by post-D-1
 * interface display name, value = pre-existing `spec_link` or null) from
 * any interface candidates the caller threaded in (e.g. produced by
 * upstream framework adapters or by Workstream A's specFileLinker running
 * first).
 *
 * Annotation-only interfaces typically have no `spec_link`, so they pass
 * through cleanly (no entry written to the map, or the entry is null).
 * Only string + non-empty values count as pre-existing -- anything else is
 * treated as "no prior value" so the emitter's promotion path is free to
 * set a fresh value.
 */
function buildPreExistingSpecLinks(
  existing: DiscoveryCandidate[] | undefined,
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!existing) return out;
  for (const cand of existing) {
    if (cand.candidateType !== 'interfaces') continue;
    const data = cand.data as Record<string, unknown> | undefined;
    const link = data?.spec_link;
    if (typeof link === 'string' && link.length > 0) {
      out.set(cand.name, link);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/**
 * Optional Phase 3 input: existing interface candidates (e.g. from upstream
 * Workstream A) used to seed the emitter's `preExistingSpecLinks` map so
 * the WSDL promotion step honours P-8 (never overwrite a pre-existing
 * `spec_link`).
 */
export interface SpringClassicSoapPassExtraInput {
  existingInterfaceCandidates?: DiscoveryCandidate[];
}

/**
 * Run the Spring Classic SOAP pass over a `PackFindingScannerInput`.
 *
 * Pure (besides diagnostic-sink writes): reads only `input.irFiles`. Returns
 * the emitter's interface and endpoint candidates plus the diagnostic stream.
 *
 * Graceful behaviour:
 *  - Empty IR (no Java files, no `.wsdl` files) yields empty arrays cleanly.
 *  - A WSDL with a `parseError` is included in the merge with an empty
 *    operations list -- Group 7 translates the parse-error into a
 *    `wsdl_parse_failed` `evidence_gap` finding via the same `WsdlParseResult`.
 *  - REST-only inputs produce zero SOAP candidates (no false positives).
 *
 * Phase 3 Workstream B: when `extra.existingInterfaceCandidates` is
 * supplied, the emitter's `preExistingSpecLinks` map is seeded from those
 * candidates so the WSDL `spec_link` promotion respects pre-existing
 * values (P-8: user / upstream manual choice always wins).
 */
export function runSpringClassicSoapPass(
  input: PackFindingScannerInput,
  extra?: SpringClassicSoapPassExtraInput,
): SpringClassicSoapPassOutput {
  // Collect Java source strings for the annotation scanners.
  const javaSources: { path: string; content: string }[] = [];
  // Collect WSDL source strings keyed by repo-relative path -- shared with
  // the parser as the `relatedFiles` map (for relative `xsd:import` /
  // `xsd:include` resolution against sibling files in the same scan).
  const wsdlIrs: SourceFileIR[] = [];
  const relatedFiles = new Map<string, string>();

  for (const ir of input.irFiles.values()) {
    if (isJavaSourceFile(ir)) {
      javaSources.push({ path: ir.filePath, content: ir.rawContent as string });
    }
    if (isWsdlFile(ir)) {
      wsdlIrs.push(ir);
      // Populate `relatedFiles` with every WSDL/XSD-bearing entry so the
      // parser can resolve relative `xsd:import` / `xsd:include` references
      // (relative paths only -- absolute URLs are silently skipped per D-4).
      relatedFiles.set(ir.filePath, ir.rawContent as string);
    } else if (ir.filePath.toLowerCase().endsWith('.xsd') && typeof ir.rawContent === 'string') {
      relatedFiles.set(ir.filePath, ir.rawContent);
    }
  }

  // Group 6: structured start line -- count both Java and WSDL files so the
  // run log records the total set of inputs the SOAP pass considered. Empty
  // inputs still produce this line (files=0) so the operator can confirm the
  // pass ran.
  const startFileCount = javaSources.length + wsdlIrs.length;
  console.log(
    `[diag-pack] scanner=spring_classic_soap start files=${startFileCount}`,
  );

  // Signal A + B (annotation scanners) -- pure regex/AST work over source strings.
  const springWs = scanSpringWsSources(javaSources);
  const jaxWs = scanJaxWsSources(javaSources);

  // Signal C -- parse every discovered `.wsdl` file. Soft-fail per file:
  // a malformed WSDL produces a `WsdlParseResult` with empty `operations`
  // and `parseError` populated; the emitter handles that cleanly.
  //
  // Spec 4: read the env-tunable nested complex-type depth cap once and thread
  // it into each parse so the deep walker honours the same configurable cap as
  // the rest of discovery (Spec 2 precedent).
  const maxDepth = readSoapXsdMaxDepth();
  const wsdl: WsdlParseResult[] = [];
  for (const ir of wsdlIrs) {
    const result = parseWsdl(ir.rawContent as string, {
      sourcePath: ir.filePath,
      relatedFiles,
      maxDepth,
    });
    wsdl.push(result);

    // Group 6: per-WSDL parse diagnostic.
    if (result.parseError) {
      // `console.warn` mirrors `springClassicFindingScanner.ts`'s convention
      // for soft-fail diagnostics (parse errors / cap-hit notices); paired
      // with a `wsdl_parse_failed` `evidence_gap` finding emitted by Group 7.
      console.warn(
        `[diag-pack] scanner=spring_classic_soap wsdl_parse=fail path=${result.parseError.sourcePath} reason=${result.parseError.reason}`,
      );
    } else {
      console.log(
        `[diag-pack] scanner=spring_classic_soap wsdl_parse=ok path=${result.sourcePath} operations=${result.operations.length} ports=${result.ports.length}`,
      );
    }
  }

  // Phase 3 Workstream B: seed `preExistingSpecLinks` from any interface
  // candidates the caller threaded in (e.g. produced by upstream Workstream
  // A's specFileLinker so the SOAP pass honours an OAS-YAML `spec_link`
  // value that landed first). Empty when the caller did not pass any
  // upstream candidates -- the emitter treats an empty map identically to
  // an absent map.
  const preExistingSpecLinks = buildPreExistingSpecLinks(
    extra?.existingInterfaceCandidates,
  );

  // Merge + emit. Servlet path inference (web.xml / WebApplicationInitializer)
  // is intentionally left to a follow-up wave -- pass an empty map so every
  // endpoint candidate's `path_or_address` is null and Group 7 pairs each
  // emission with a `soap_endpoint_url_unknown` `evidence_gap` finding.
  const emitOutput: SoapEmitOutput = emitSoapCandidates({
    springWs,
    jaxWs,
    wsdl,
    servletPaths: new Map(),
    preExistingSpecLinks,
  });

  // Group 6: per-interface `servlet_path=unknown` diagnostic. We emit one
  // line per interface candidate whose endpoint set has any null
  // `path_or_address` (one line per interface, not per endpoint, to avoid
  // spam in projects with many operations on a single SOAP service).
  // Group 7 emits the matching `soap_endpoint_url_unknown` `evidence_gap`
  // finding for each affected candidate.
  for (const iface of emitOutput.interfaceCandidates) {
    const endpointsForIface = emitOutput.endpointCandidates.filter(
      (ep) => ep.parentCandidateId === iface.id,
    );
    const anyUnknownPath = endpointsForIface.some(
      (ep) => ep.data.path_or_address == null,
    );
    if (anyUnknownPath) {
      console.warn(
        `[diag-pack] scanner=spring_classic_soap servlet_path=unknown interface=${iface.id}`,
      );
    }
  }

  // Bug-fix 2026-05-28: wire `buildSoapEvidenceGapFindings` into the SOAP
  // pass output. The helper has existed since the 2026-05-17 SOAP spec
  // (Task Group 7) but had NO call site in production. It emits two gap
  // findings the deterministic SOAP path otherwise loses:
  //   - `soap_endpoint_url_unknown` per interface whose endpoints have no
  //     resolved servlet path (MessageDispatcherServlet mapping unknown).
  //   - `wsdl_parse_failed` per WSDL whose `parseError` is populated.
  // Concat to the emitter's own spec-link findings; the parent shim
  // (`runSpringClassicScannerWithSoap`) propagates the merged list.
  const gapFindings = buildSoapEvidenceGapFindings({
    emitterOutput: emitOutput,
    wsdlResults: wsdl,
  });

  // ==========================================================================
  // Spec 4 (Task Group 4): downstream message-shape emission.
  //
  // The detection above (interfaces / endpoints) is unchanged. Here we parse
  // the Java DTO field view, reconcile it with the WSDL/XSD view, and mint the
  // message-shape candidates + bindings + Findings. Soft-fail as a whole so a
  // message-shape failure can NEVER regress the existing operation detection.
  // ==========================================================================
  let messageOutput: MessageEntityEmitOutput = {
    candidates: [],
    findings: [],
    reconciledTypes: [],
  };
  try {
    // Java DTO field view (the only field source for annotation-only services).
    const javaMessageTypes = parseJavaDtoFields(
      javaSources.map((s) => ({ path: s.path, content: s.content })),
    );
    messageOutput = emitMessageEntities({
      wsdlResults: wsdl,
      javaMessageTypes,
      interfaceCandidates: emitOutput.interfaceCandidates,
      // NB: emitMessageEntities MUTATES the endpoint candidates in place to
      // carry `data.requestEntity` / `data.responseEntity` bindings.
      endpointCandidates: emitOutput.endpointCandidates,
    });
    const fieldFindingCount = wsdl.reduce(
      (n, w) => n + w.fieldDepthFindings.length,
      0,
    );
    console.log(
      `[diag-pack] scanner=spring_classic_soap message_shape ` +
        `emitted_candidates=${messageOutput.candidates.length} ` +
        `reconciled_types=${messageOutput.reconciledTypes.length} ` +
        `field_findings=${fieldFindingCount}`,
    );
  } catch (err) {
    console.warn(
      `[diag-pack] scanner=spring_classic_soap message_shape soft_fail=true reason=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  // ==========================================================================
  // Spec 4 (Task Group 5): SOAP operation -> DB data-effect emission.
  //
  // Give SOAP operations the SAME operation->DB data-effect chain Spec 1 built
  // for REST. The ONLY new logic is detecting the SOAP entry-point
  // (`@Endpoint`/`@PayloadRoot` Spring-WS or `@WebMethod` JAX-WS handler); the
  // downstream handler->service->repository->entity walk is REUSED VERBATIM from
  // Spec 1's `endpointDataEffectResolver` (via `emitSoapDataEffects`). Resolved
  // edges ride on `messageCandidates` (same `endpoint_data_effects` candidate
  // shape as REST); unresolved chains become Findings (never fabricated edges).
  // Soft-fail as a whole so a data-effect failure can NEVER regress detection.
  // ==========================================================================
  const soapDataEffectCandidates: DiscoveryCandidate[] = [];
  const soapDataEffectFindings: FindingEmitInput[] = [];
  try {
    const dataEffectOutput = emitSoapDataEffects({
      files: Array.from(input.irFiles.values()),
      springWs,
      jaxWs,
      // The SOAP emitter uses a 'pending' placeholder runId here; the caller
      // (`contractCandidates.ts`) re-stamps every candidate with the real runId,
      // exactly as it does for the interface / endpoint / message candidates.
      runId: 'pending',
    });
    soapDataEffectCandidates.push(...dataEffectOutput.candidates);
    soapDataEffectFindings.push(...dataEffectOutput.findings);
  } catch (err) {
    console.warn(
      `[diag-pack] scanner=spring_classic_soap soap_data_effect soft_fail=true reason=${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    interfaceCandidates: emitOutput.interfaceCandidates,
    endpointCandidates: emitOutput.endpointCandidates,
    // Spec 4: message-shape candidates (Group 4) + SOAP data-effect edge
    // candidates (Group 5) ride on the same `messageCandidates` channel so the
    // caller routes them all into the candidate stream + save-back.
    messageCandidates: [
      ...messageOutput.candidates,
      ...soapDataEffectCandidates,
    ],
    diagnostics: emitOutput.diagnostics,
    findings: [
      ...emitOutput.findings,
      ...gapFindings,
      ...messageOutput.findings,
      ...soapDataEffectFindings,
    ],
  };
}

/**
 * Read the env-tunable nested complex-type walk depth cap
 * (`DISCOVERY_SOAP_XSD_MAX_DEPTH`). Falls back to the parser's
 * `DEFAULT_XSD_MAX_DEPTH` (via `undefined`) when unset / non-numeric, so the
 * pure parser remains the single source of the default. Mirrors the Spec 2
 * env-tunable-cap pattern.
 */
function readSoapXsdMaxDepth(): number | undefined {
  const raw = process.env.DISCOVERY_SOAP_XSD_MAX_DEPTH;
  if (raw == null || raw === '') return undefined;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? undefined : n;
}
