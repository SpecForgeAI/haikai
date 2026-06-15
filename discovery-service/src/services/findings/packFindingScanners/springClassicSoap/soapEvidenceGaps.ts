/**
 * SOAP evidence-gap finding builder (Task Group 7).
 *
 * Spec: 2026-05-17 SOAP Discovery -- Spring Classic Phase 1, Task Group 7 (Q-9).
 *
 * Pure helper that translates two soft-fail conditions in the SOAP scanner
 * subtree into `FindingEmitInput`s for the existing `FindingEmitter`. Lives
 * inside the springClassicSoap subtree so the call site (Group 5's
 * `index.ts` once it lands) only needs a single import.
 *
 * Two sentinel `gapType` values emitted:
 *
 *  1. `soap_endpoint_url_unknown`
 *     Triggered when an emitted SOAP interface candidate has at least one
 *     endpoint candidate with `path_or_address === null`. The candidate is
 *     still emitted -- the finding flags the inability to infer the
 *     servlet path (e.g. `MessageDispatcherServlet` mapping from `web.xml`
 *     / `WebApplicationInitializer`). One finding per interface, NOT per
 *     endpoint candidate (the gap is "the URL for this interface is
 *     unknown", which applies uniformly to every operation on it).
 *
 *  2. `wsdl_parse_failed`
 *     Triggered when `parseWsdl` returns a `parseError` populated. No
 *     candidate is produced by the failing parse, so the finding has no
 *     `candidateId` link -- the WSDL `sourcePath` and parser `reason`
 *     ride inside `detailJson`. One finding per failed WSDL.
 *
 * The helper is pure; the caller (Group 5 / `springClassicSoap/index.ts`)
 * passes the result to `FindingEmitter.emitFindings`.
 *
 * Standing-constraint compliance:
 *  - Uses the existing centralised builder `buildSoapEvidenceGapFinding`
 *    in `emissionSources.ts` -- NO parallel emitter pipeline.
 *  - `gapType` strings are the two new sentinels registered in the
 *    centralised `EvidenceGapType` union (per Group 7 task 7.2).
 */

import type { FindingEmitInput } from '../../FindingEmitter';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { buildSoapEvidenceGapFinding } from '../../emissionSources';
import type { WsdlParseResult } from './wsdlParser';
import type { SoapEmitOutput } from './soapEndpointEmitter';

/**
 * Input shape for the helper -- the caller (Group 5) supplies these:
 *  - `emitterOutput`: the result from `emitSoapCandidates`, used to walk
 *    interface candidates whose child endpoints have `path_or_address=null`.
 *  - `wsdlResults`: the full list of `WsdlParseResult`s the caller produced
 *    by running `parseWsdl` over each discovered `.wsdl` file. Any result
 *    with `parseError` populated produces a finding.
 */
export interface BuildSoapEvidenceGapsInput {
  emitterOutput: SoapEmitOutput;
  wsdlResults: WsdlParseResult[];
}

/**
 * Inspect emitter output + WSDL parse results, return one
 * `FindingEmitInput` per detected gap. Pure; no I/O.
 */
export function buildSoapEvidenceGapFindings(
  input: BuildSoapEvidenceGapsInput,
): FindingEmitInput[] {
  const out: FindingEmitInput[] = [];

  // Pass 1: `soap_endpoint_url_unknown` -- one per interface that owns at
  // least one endpoint candidate with `path_or_address === null`. We dedupe
  // at the interface level because the URL gap is uniform across an
  // interface's operations (a single servlet mapping covers all ops on a
  // SOAP interface).
  const interfacesWithNullPath = new Set<string>();
  for (const ep of input.emitterOutput.endpointCandidates) {
    const data = ep.data as Record<string, unknown> | undefined;
    if (!data) continue;
    if (data.path_or_address === null || data.path_or_address === undefined) {
      const ifaceId = typeof data.interface_id === 'string' ? data.interface_id : null;
      if (ifaceId) interfacesWithNullPath.add(ifaceId);
    }
  }
  for (const iface of input.emitterOutput.interfaceCandidates) {
    if (!interfacesWithNullPath.has(iface.id)) continue;
    out.push(
      buildSoapEvidenceGapFinding({
        gapType: 'soap_endpoint_url_unknown',
        candidateId: iface.id,
        candidateName: iface.name,
        gapDescription:
          `SOAP interface '${iface.name}' has endpoint candidate(s) with no resolved ` +
          `servlet path. The MessageDispatcherServlet mapping (or equivalent) could not ` +
          `be inferred from web.xml / WebApplicationInitializer. The candidate(s) are ` +
          `still emitted with path_or_address=null.`,
        sourcePath: iface.id,
      }),
    );
  }

  // Pass 2: `wsdl_parse_failed` -- one per WSDL whose `parseError` is set.
  for (const w of input.wsdlResults) {
    if (!w.parseError) continue;
    out.push(
      buildSoapEvidenceGapFinding({
        gapType: 'wsdl_parse_failed',
        candidateName: w.parseError.sourcePath,
        gapDescription:
          `WSDL parse failed for '${w.parseError.sourcePath}': ${w.parseError.reason}. ` +
          `No SOAP candidates were emitted from this WSDL.`,
        reason: w.parseError.reason,
        sourcePath: w.parseError.sourcePath,
      }),
    );
  }

  return out;
}

/**
 * Helper consumed by tests + Group 5: pick the candidate-side endpoint
 * rows whose `path_or_address` is null. Returned for diagnostic / log
 * pairing convenience. Pure.
 */
export function findEndpointsWithUnknownUrl(
  emitterOutput: SoapEmitOutput,
): DiscoveryCandidate[] {
  const out: DiscoveryCandidate[] = [];
  for (const ep of emitterOutput.endpointCandidates) {
    const data = ep.data as Record<string, unknown> | undefined;
    if (!data) continue;
    if (data.path_or_address === null || data.path_or_address === undefined) {
      out.push(ep);
    }
  }
  return out;
}
