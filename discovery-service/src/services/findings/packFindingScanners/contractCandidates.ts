/**
 * Contract candidate passes (WADL / WSDL / XSD -> DiscoveryCandidate[]).
 *
 * Bug-fix 2026-05-22: the WADL pack only emits `FindingEmitInput`s, and the
 * SOAP pack's `DiscoveryCandidate`s were never routed into the V3 candidate
 * stream (they came back on `SpringClassicScannerOutput.soapInterfaceCandidates`
 * / `soapEndpointCandidates` but no caller pushed them into `packCandidates`).
 * Standalone `.xsd` files had no deterministic emitter at all. Net effect:
 * WADL / WSDL / XSD bytes flowed through the scan plan and reached the
 * language pack (after the contract-file admission branch in
 * `javaLangPack/index.ts`), but produced zero architecture meta-model
 * candidates.
 *
 * This module closes that gap with three small passes:
 *   - `runWadlCandidatePass`  -- builds `interfaces` + `endpoints` candidates
 *                                from every `.wadl` IR entry's parsed result.
 *   - `runXsdCandidatePass`   -- builds `logical_data_entities` +
 *                                `logical_data_attributes` candidates from
 *                                every standalone `.xsd` IR entry.
 *   - `runContractCandidatePasses` -- top-level entry that runs all three
 *                                contract passes (SOAP via the existing
 *                                `runSpringClassicSoapPass`, plus WADL and
 *                                XSD here) and returns the merged candidate
 *                                array, with `runId` re-stamped from the
 *                                input. Callers (V3 pipeline) push the
 *                                returned candidates into `filteredPackCandidates`
 *                                BEFORE Stage 3 / Stage 4 so they participate
 *                                in the gap-fill context and persist alongside
 *                                FrameworkPack candidates.
 *
 * Pure: no I/O. Reads `input.irFiles` only. Soft-fail per file -- a single
 * malformed contract file does not abort the pass.
 */

import { v4 as uuidv4 } from 'uuid';
import { XMLParser } from 'fast-xml-parser';
import type { DiscoveryCandidate, CandidateType } from '../../../types/candidate';
import type { SourceFileIR } from '../../extensionPacks';
import type { FindingEmitInput } from '../FindingEmitter';
import type { PackFindingScannerInput } from './index';
import { parseWadl, type WadlParseResult } from './restWadl/wadlParser';
import { runSpringClassicSoapPass } from './springClassicSoap';

const FINDING_SOURCE_WADL = 'rest-wadl-pack';
const FINDING_SOURCE_XSD = 'xsd-schema-pack';

// ---------------------------------------------------------------------------
// Helpers shared with the WADL parser orchestrator (kept local to avoid
// importing the larger orchestrator module).
// ---------------------------------------------------------------------------

function isWadlFile(ir: SourceFileIR): boolean {
  const fp = ir.filePath.toLowerCase();
  return (
    fp.endsWith('.wadl') &&
    typeof ir.rawContent === 'string' &&
    ir.rawContent.length > 0
  );
}

function isXsdFile(ir: SourceFileIR): boolean {
  const fp = ir.filePath.toLowerCase();
  return (
    fp.endsWith('.xsd') &&
    typeof ir.rawContent === 'string' &&
    ir.rawContent.length > 0
  );
}

function dirnameOf(p: string): string {
  if (!p) return '';
  const lastSep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return lastSep >= 0 ? p.slice(0, lastSep) : '';
}

function basenameOf(p: string): string {
  if (!p) return '';
  const lastSep = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return lastSep >= 0 ? p.slice(lastSep + 1) : p;
}

function basenameNoExt(p: string): string {
  const base = basenameOf(p);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function buildRelatedXsdFiles(
  xsdIrs: SourceFileIR[],
  wadlPath: string,
): Map<string, string> {
  const map = new Map<string, string>();
  const wadlDir = dirnameOf(wadlPath);
  for (const xsd of xsdIrs) {
    const content = xsd.rawContent as string;
    map.set(xsd.filePath, content);
    map.set(basenameOf(xsd.filePath), content);
    if (wadlDir) {
      const wadlDirNorm = wadlDir.replace(/\\/g, '/');
      const xsdPathNorm = xsd.filePath.replace(/\\/g, '/');
      const prefix = wadlDirNorm + '/';
      if (xsdPathNorm.startsWith(prefix)) {
        map.set(xsdPathNorm.slice(prefix.length), content);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// WADL -> interfaces + endpoints candidates
// ---------------------------------------------------------------------------

function buildWadlInterfaceCandidate(
  runId: string,
  parseResult: WadlParseResult,
  sourceFilePath: string,
): DiscoveryCandidate {
  const iface = parseResult.interfaces[0];
  const fallbackName = basenameNoExt(sourceFilePath) || 'WadlInterface';
  const name = iface?.applicationTitle?.trim() || fallbackName;
  return {
    id: uuidv4(),
    runId,
    candidateType: 'interfaces' as CandidateType,
    name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [sourceFilePath],
    data: {
      interface_type: 'REST_API',
      spec_link: sourceFilePath,
      wadlSource: sourceFilePath,
      version: iface?.version ?? null,
      doc: iface?.doc ?? null,
      discovery_method: 'framework_scanner',
      _addedBy: 'rest-wadl-pack',
    },
    synthesizedAt: new Date().toISOString(),
  };
}

function buildWadlEndpointCandidate(
  runId: string,
  parentInterfaceId: string,
  sourceFilePath: string,
  op: WadlParseResult['operations'][number],
): DiscoveryCandidate {
  return {
    id: uuidv4(),
    runId,
    candidateType: 'endpoints' as CandidateType,
    name: op.compositeId,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [sourceFilePath],
    parentCandidateId: parentInterfaceId,
    data: {
      operation_verb: op.httpMethod,
      path_or_address: op.path,
      base_url: op.baseUrl,
      method_id: op.methodId,
      params: op.params,
      request_representations: op.request.representations,
      response_representations: op.response.representations,
      doc: op.doc ?? null,
      wadlSource: sourceFilePath,
      discovery_method: 'framework_scanner',
      _addedBy: 'rest-wadl-pack',
    },
    synthesizedAt: new Date().toISOString(),
  };
}

/**
 * Build `interfaces` + `endpoints` candidates from every `.wadl` IR entry.
 * Returns an empty array cleanly when no WADL files are present.
 */
export function runWadlCandidatePass(
  input: PackFindingScannerInput,
): DiscoveryCandidate[] {
  const wadlIrs: SourceFileIR[] = [];
  const xsdIrs: SourceFileIR[] = [];
  for (const ir of input.irFiles.values()) {
    if (isWadlFile(ir)) wadlIrs.push(ir);
    else if (isXsdFile(ir)) xsdIrs.push(ir);
  }
  if (wadlIrs.length === 0) return [];

  const out: DiscoveryCandidate[] = [];
  let interfaces = 0;
  let endpoints = 0;
  for (const ir of wadlIrs) {
    const sourceFilePath = ir.filePath;
    try {
      const relatedFiles = buildRelatedXsdFiles(xsdIrs, sourceFilePath);
      const parsed = parseWadl(ir.rawContent as string, {
        relatedFiles,
        sourceFilePath,
      });
      if (parsed.parseError) continue;
      if (parsed.operations.length === 0 && parsed.interfaces.length === 0) {
        continue;
      }
      const ifaceCandidate = buildWadlInterfaceCandidate(
        input.runId,
        parsed,
        sourceFilePath,
      );
      out.push(ifaceCandidate);
      interfaces += 1;
      for (const op of parsed.operations) {
        out.push(
          buildWadlEndpointCandidate(
            input.runId,
            ifaceCandidate.id,
            sourceFilePath,
            op,
          ),
        );
        endpoints += 1;
      }
    } catch (err) {
      console.warn(
        `[contract-candidates] WADL pass failed on '${sourceFilePath}'; continuing:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  console.log(
    `[diag-pack] scanner=rest_wadl_candidates emitted_interfaces=${interfaces} ` +
      `emitted_endpoints=${endpoints} files=${wadlIrs.length}`,
  );
  return out;
}

// ---------------------------------------------------------------------------
// XSD -> logical_data_entities + logical_data_attributes candidates
// ---------------------------------------------------------------------------

const XSD_NAMESPACE = 'http://www.w3.org/2001/XMLSchema';

interface XsdParsedEntity {
  name: string;
  attributes: { name: string; type: string; required: boolean }[];
}

interface XsdParseSummary {
  targetNamespace: string | null;
  entities: XsdParsedEntity[];
}

/**
 * Minimal XSD walker that emits one logical entity per top-level
 * `<xs:complexType name="X">` plus one logical attribute per child
 * `<xs:element>` declared under its `<xs:sequence>` / `<xs:all>` /
 * `<xs:choice>`. Top-level `<xs:element>` declarations with inline
 * `<xs:complexType>` are also emitted as entities (the element's name
 * becomes the entity name).
 *
 * Deliberately narrow: no inheritance flattening, no group-ref expansion,
 * no simpleType enumeration extraction. Sufficient to surface the data
 * shape of the contract; further enrichment is a follow-up spec.
 */
function parseXsd(source: string): XsdParseSummary {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    parseAttributeValue: false,
    isArray: () => false,
  });
  let doc: any;
  try {
    doc = parser.parse(source);
  } catch {
    return { targetNamespace: null, entities: [] };
  }
  const schema = doc?.schema;
  if (!schema || typeof schema !== 'object') {
    return { targetNamespace: null, entities: [] };
  }
  const targetNamespace =
    typeof schema['@_targetNamespace'] === 'string'
      ? (schema['@_targetNamespace'] as string)
      : null;

  const entities: XsdParsedEntity[] = [];

  const asArray = <T,>(v: T | T[] | undefined): T[] => {
    if (v == null) return [];
    return Array.isArray(v) ? v : [v];
  };

  const extractAttributesFromContainer = (container: any): XsdParsedEntity['attributes'] => {
    if (!container || typeof container !== 'object') return [];
    const attrs: XsdParsedEntity['attributes'] = [];
    // <xs:sequence>, <xs:all>, <xs:choice> all wrap <xs:element> children.
    for (const group of ['sequence', 'all', 'choice']) {
      const wrapper = container[group];
      if (!wrapper) continue;
      const elems = asArray<any>(wrapper.element);
      for (const e of elems) {
        if (!e || typeof e !== 'object') continue;
        const name = typeof e['@_name'] === 'string' ? e['@_name'] : null;
        const ref = typeof e['@_ref'] === 'string' ? e['@_ref'] : null;
        const fieldName = name ?? ref;
        if (!fieldName) continue;
        const type =
          typeof e['@_type'] === 'string'
            ? (e['@_type'] as string)
            : 'unknown';
        const minOccursRaw = e['@_minOccurs'];
        const required =
          minOccursRaw == null
            ? true
            : String(minOccursRaw) !== '0';
        attrs.push({ name: fieldName, type, required });
      }
    }
    return attrs;
  };

  // Top-level <xs:complexType name="X">
  for (const ct of asArray<any>(schema.complexType)) {
    if (!ct || typeof ct !== 'object') continue;
    const name = typeof ct['@_name'] === 'string' ? ct['@_name'] : null;
    if (!name) continue;
    entities.push({
      name,
      attributes: extractAttributesFromContainer(ct),
    });
  }

  // Top-level <xs:element name="X"> with an inline <xs:complexType>.
  for (const el of asArray<any>(schema.element)) {
    if (!el || typeof el !== 'object') continue;
    const name = typeof el['@_name'] === 'string' ? el['@_name'] : null;
    if (!name) continue;
    const inlineCt = el.complexType;
    if (inlineCt && typeof inlineCt === 'object') {
      entities.push({
        name,
        attributes: extractAttributesFromContainer(inlineCt),
      });
    } else if (typeof el['@_type'] === 'string') {
      // Top-level element referencing a named type -- record it as an
      // entity stub so the type binding is captured even when the type
      // lives elsewhere in the same schema.
      entities.push({
        name,
        attributes: [
          { name: 'value', type: el['@_type'], required: true },
        ],
      });
    }
  }

  void XSD_NAMESPACE; // referenced for documentation; not used in the parse
  return { targetNamespace, entities };
}

function buildXsdEntityCandidate(
  runId: string,
  sourceFilePath: string,
  entity: XsdParsedEntity,
  targetNamespace: string | null,
): DiscoveryCandidate {
  return {
    id: uuidv4(),
    runId,
    candidateType: 'logical_data_entities' as CandidateType,
    name: entity.name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [sourceFilePath],
    data: {
      schemaSource: sourceFilePath,
      targetNamespace,
      attributeCount: entity.attributes.length,
      discovery_method: 'framework_scanner',
      _addedBy: 'xsd-schema-pack',
    },
    synthesizedAt: new Date().toISOString(),
  };
}

function buildXsdAttributeCandidate(
  runId: string,
  parentEntityId: string,
  parentEntityName: string,
  sourceFilePath: string,
  attr: XsdParsedEntity['attributes'][number],
): DiscoveryCandidate {
  return {
    id: uuidv4(),
    runId,
    candidateType: 'logical_data_attributes' as CandidateType,
    name: attr.name,
    confidence: 0.9,
    status: 'proposed',
    sourceClusterIds: [sourceFilePath],
    parentCandidateId: parentEntityId,
    data: {
      fieldName: attr.name,
      dataType: attr.type,
      required: attr.required,
      logicalEntityName: parentEntityName,
      schemaSource: sourceFilePath,
      discovery_method: 'framework_scanner',
      _addedBy: 'xsd-schema-pack',
    },
    synthesizedAt: new Date().toISOString(),
  };
}

/**
 * Build `logical_data_entities` + `logical_data_attributes` candidates from
 * every standalone `.xsd` IR entry. Returns an empty array cleanly when no
 * XSD files are present.
 *
 * Standalone here means "the XSD file is admitted to `irFiles`" -- it does
 * NOT prevent emission when the same XSD is also referenced from a WADL's
 * `<grammars><include>`. Both passes therefore emit the SAME entity + its
 * attributes. Duplicate `logical_data_entities` collapse in the Stage-4 merge
 * (a MERGEABLE_TYPE keyed by normalized name), BUT `logical_data_attributes`
 * are NOT a merge type, so they would otherwise reach the review agenda 2-3x.
 * `dedupeContractAttributeCandidates` (applied in `runContractCandidatePasses`)
 * collapses those by `(parent-entity-name, field-name)` before they leave this
 * module.
 */
export function runXsdCandidatePass(
  input: PackFindingScannerInput,
): DiscoveryCandidate[] {
  const xsdIrs: SourceFileIR[] = [];
  for (const ir of input.irFiles.values()) {
    if (isXsdFile(ir)) xsdIrs.push(ir);
  }
  if (xsdIrs.length === 0) return [];

  const out: DiscoveryCandidate[] = [];
  let entities = 0;
  let attributes = 0;
  for (const ir of xsdIrs) {
    const sourceFilePath = ir.filePath;
    try {
      const parsed = parseXsd(ir.rawContent as string);
      for (const entity of parsed.entities) {
        const entityCand = buildXsdEntityCandidate(
          input.runId,
          sourceFilePath,
          entity,
          parsed.targetNamespace,
        );
        out.push(entityCand);
        entities += 1;
        for (const attr of entity.attributes) {
          out.push(
            buildXsdAttributeCandidate(
              input.runId,
              entityCand.id,
              entity.name,
              sourceFilePath,
              attr,
            ),
          );
          attributes += 1;
        }
      }
    } catch (err) {
      console.warn(
        `[contract-candidates] XSD pass failed on '${sourceFilePath}'; continuing:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  console.log(
    `[diag-pack] scanner=xsd_candidates emitted_entities=${entities} ` +
      `emitted_attributes=${attributes} files=${xsdIrs.length}`,
  );
  void FINDING_SOURCE_WADL;
  void FINDING_SOURCE_XSD;
  return out;
}

// ---------------------------------------------------------------------------
// Top-level orchestrator
// ---------------------------------------------------------------------------

/**
 * Output of `runContractCandidatePasses`.
 *
 * `candidates` contains the merged SOAP + WADL + XSD `DiscoveryCandidate`s
 * (caller pushes these into `filteredPackCandidates`). `findings` contains
 * SOAP-pass `FindingEmitInput`s (spec-link gaps from the emitter -- WADL
 * findings are owned by `runPackFindingScanners` via `runRestWadlPass`, NOT
 * duplicated here). Caller pushes these into the V3 findings stream.
 */
export interface ContractCandidatePassOutput {
  candidates: DiscoveryCandidate[];
  findings: FindingEmitInput[];
}

/**
 * Run every contract-driven candidate pass against the same input.
 *
 * Includes:
 *  - SOAP `interfaces` + `endpoints` from `runSpringClassicSoapPass`
 *    (re-stamped with the caller's `runId`; the SOAP emitter uses a
 *    `'pending'` placeholder). Plus SOAP findings (`oas_spec_*` spec-link
 *    gaps) which were previously dropped on the floor.
 *  - WADL `interfaces` + `endpoints` from `runWadlCandidatePass`.
 *  - XSD `logical_data_entities` + `logical_data_attributes` from
 *    `runXsdCandidatePass`.
 *
 * Pure (besides diagnostic logs): reads `input.irFiles` only. Empty IR or
 * inputs without contract files yield an empty output cleanly.
 */
export function runContractCandidatePasses(
  input: PackFindingScannerInput,
): ContractCandidatePassOutput {
  const candidates: DiscoveryCandidate[] = [];
  const findings: FindingEmitInput[] = [];

  // SOAP -- re-stamp runId. The SOAP emitter uses a `'pending'` placeholder.
  try {
    const soap = runSpringClassicSoapPass(input);
    for (const c of soap.interfaceCandidates) {
      candidates.push({ ...c, runId: input.runId });
    }
    for (const c of soap.endpointCandidates) {
      candidates.push({ ...c, runId: input.runId });
    }
    // Spec 4 (Task Group 4): the SOAP pass now also mints message-shape
    // candidates (logical_data_entities / logical_data_attributes /
    // logical_data_entity_relationships / interface_logical_entities) from the
    // reconciled WSDL/XSD + Java-DTO field views. Route them into the same
    // candidate stream so they flow through Stage 4 merge + save-back alongside
    // the interface / endpoint candidates. (The endpoint request/response
    // bindings were applied IN PLACE on the endpoint candidates above.)
    for (const c of soap.messageCandidates) {
      candidates.push({ ...c, runId: input.runId });
    }
    findings.push(...soap.findings);
  } catch (err) {
    console.warn(
      `[contract-candidates] SOAP pass threw; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    candidates.push(...runWadlCandidatePass(input));
  } catch (err) {
    console.warn(
      `[contract-candidates] WADL pass threw; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  try {
    candidates.push(...runXsdCandidatePass(input));
  } catch (err) {
    console.warn(
      `[contract-candidates] XSD pass threw; continuing:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return { candidates: dedupeContractAttributeCandidates(candidates), findings };
}

/**
 * Collapse duplicate `logical_data_attributes` emitted by more than one contract
 * sub-pass for the SAME field of the SAME entity.
 *
 * Why this is needed: when an XSD type is BOTH admitted as a standalone IR file
 * AND referenced from a WADL's `<grammars><include>` (and/or reconciled by the
 * SOAP message pass), each pass independently emits the entity and ALL its
 * attribute candidates. Duplicate `logical_data_entities` collapse later in the
 * Stage-4 merge (a MERGEABLE_TYPE keyed by normalized name), but
 * `logical_data_attributes` are NOT a merge type, so without this step the same
 * field (e.g. `FilterRequest.shortName`) reaches the review agenda 2-3 times,
 * inflating the candidate count.
 *
 * Identity = `(parent-entity-name, field-name)`, both normalized. The parent
 * entity NAME (`data.logicalEntityName`, set by every attribute emitter) is the
 * stable cross-pass key -- the duplicate parents carry DIFFERENT
 * `parentCandidateId`s, so the id cannot be used to match them. Same field name
 * under a DIFFERENT parent is a genuinely distinct attribute and is preserved
 * (no over-merge). First occurrence wins; parent re-pointing is name-based at
 * save-back, so dropping a duplicate is safe. Non-attribute candidates pass
 * through untouched, in order.
 */
export function dedupeContractAttributeCandidates(
  candidates: DiscoveryCandidate[],
): DiscoveryCandidate[] {
  const norm = (s: string): string =>
    s.trim().toLowerCase().replace(/[\s_]+/g, '');
  const seen = new Set<string>();
  const out: DiscoveryCandidate[] = [];
  let dropped = 0;
  for (const cand of candidates) {
    if (cand.candidateType !== 'logical_data_attributes') {
      out.push(cand);
      continue;
    }
    const data = (cand.data || {}) as Record<string, unknown>;
    const parentName = String(data.logicalEntityName ?? '').trim();
    // Stable parent key: the entity NAME when present; else fall back to the
    // (per-pass) parentCandidateId so attributes under an unnamed parent are
    // NOT all collapsed together.
    const parentKey = parentName
      ? norm(parentName)
      : `id:${cand.parentCandidateId ?? ''}`;
    const fieldName = String(data.fieldName ?? cand.name ?? '').trim();
    const key = `${parentKey}::${norm(fieldName)}`;
    if (seen.has(key)) {
      dropped++;
      continue;
    }
    seen.add(key);
    out.push(cand);
  }
  if (dropped > 0) {
    console.log(
      `[contract-candidates] deduped ${dropped} duplicate logical_data_attributes ` +
        `(same parent entity + field emitted by >1 contract sub-pass)`,
    );
  }
  return out;
}
