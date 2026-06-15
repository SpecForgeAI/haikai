/**
 * runtimeEvidenceContextBuilder.ts
 *
 * Spec 6 (2026-05-11): Log Evidence in Candidate Details UI — Task Group 2.
 *
 * Pure module (no React, no CSS, no API imports). Cross-candidate
 * aggregator that walks a `DiscoveryCandidateDto[]` once and emits a
 * `RuntimeEvidenceContext` containing four pre-indexed maps:
 *
 *   - `byCandidateId`: per-`endpoints`-candidate slice with the strict
 *     `LogEnrichmentRuntimeBlock` (matched OR noUsageObserved).
 *   - `interfaceRollupByCandidateId`: per-`interfaces`-candidate rollup
 *     of related endpoints (`controllerClassName ↔ className`).
 *   - `logicalDataEntityRollupByCandidateId`: per-`logical_data_entities`-
 *     candidate rollup walked via the `interface_logical_entities`
 *     chain, with read-like vs write-like split by HTTP method.
 *   - `interfaceLogicalEntityRollupByCandidateId`: per-`interface_logical_entities`-
 *     candidate rollup with role classification against the related
 *     endpoint's `requestBodyType` / `responseType` /
 *     `unwrappedReturnType` / `returnType`.
 *
 * The function is invoked exactly once per candidate-list reference at
 * the `DiscoveryCandidateTable` level via `useMemo`, then threaded
 * through `<CandidateDetailsPanel>` into the per-section builders.
 * Per-row render reads from the precomputed context — never aggregates
 * per row.
 *
 * Cross-reference logic mirrors the Spring Boot adapter chain:
 *   interfaces.className           ↔ endpoints.controllerClassName
 *   interface_logical_entities.interfaceClassName ↔ endpoints.controllerClassName
 *   interface_logical_entities.logicalEntityName ↔ logical_data_entities.className
 *
 * Defensive degradation: missing `controllerClassName`,
 * `requestBodyType`, or `responseType` falls into the Unknown role
 * bucket; rollups still emit (with zero counts where applicable) when
 * the parent candidate has no related endpoints.
 */

import type { DiscoveryCandidateDto } from '../../api/discoveryApi';
import type {
  InterfaceLogicalEntityRuntimeRollup,
  InterfaceRuntimeRollup,
  LogEnrichmentRuntimeBlock,
  LogicalDataEntityRuntimeRollup,
  MatchedRuntimeEvidence,
  RuntimeEvidenceContext,
  RuntimeEvidenceForCandidate,
} from './candidateEvidenceTypes';

// ---------------------------------------------------------------------------
// HTTP method classification
// ---------------------------------------------------------------------------

const READ_LIKE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const WRITE_LIKE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

/**
 * Narrow the wide `Record<string, unknown>` `logEnrichment` envelope to a
 * strict `LogEnrichmentRuntimeBlock`. Returns `undefined` when no runtime
 * block is present or when the runtime block does not satisfy either
 * variant of the union (matched OR noUsageObserved).
 */
function readRuntimeBlock(
  candidate: DiscoveryCandidateDto
): LogEnrichmentRuntimeBlock | undefined {
  const runtime = candidate.log_enrichment?.runtime;
  if (!runtime || typeof runtime !== 'object') {
    return undefined;
  }
  const asRecord = runtime as Record<string, unknown>;
  if (asRecord.noUsageObserved === true) {
    return runtime as unknown as LogEnrichmentRuntimeBlock;
  }
  if (asRecord.matched && typeof asRecord.matched === 'object') {
    return runtime as unknown as LogEnrichmentRuntimeBlock;
  }
  return undefined;
}

/**
 * Extract the `MatchedRuntimeEvidence` if present. Returns `undefined`
 * for noUsageObserved blocks.
 */
function readMatched(
  candidate: DiscoveryCandidateDto
): MatchedRuntimeEvidence | undefined {
  const block = readRuntimeBlock(candidate);
  if (block && 'matched' in block) {
    return block.matched;
  }
  return undefined;
}

function readString(
  data: Record<string, unknown>,
  key: string
): string | undefined {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Choose the lexicographically-min ISO timestamp. Works correctly for
 * full ISO-8601 strings. `undefined` inputs are skipped.
 */
function minIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function maxIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

// ---------------------------------------------------------------------------
// Public entrypoint
// ---------------------------------------------------------------------------

/**
 * Walk the candidate list once and emit the precomputed
 * `RuntimeEvidenceContext`. Pure: no React, no API, no side effects.
 */
export function buildRuntimeEvidenceContext(
  candidates: DiscoveryCandidateDto[]
): RuntimeEvidenceContext {
  const byCandidateId = new Map<string, RuntimeEvidenceForCandidate>();
  const interfaceRollupByCandidateId = new Map<string, InterfaceRuntimeRollup>();
  const logicalDataEntityRollupByCandidateId = new Map<
    string,
    LogicalDataEntityRuntimeRollup
  >();
  const interfaceLogicalEntityRollupByCandidateId = new Map<
    string,
    InterfaceLogicalEntityRuntimeRollup
  >();

  // ---- Pass 1: bucket candidates by type and populate byCandidateId. ----
  const endpointsByControllerClassName = new Map<string, DiscoveryCandidateDto[]>();
  const interfaceCandidates: DiscoveryCandidateDto[] = [];
  const logicalDataEntityCandidates: DiscoveryCandidateDto[] = [];
  const interfaceLogicalEntityCandidates: DiscoveryCandidateDto[] = [];

  for (const candidate of candidates) {
    if (candidate.candidate_type === 'endpoints') {
      const block = readRuntimeBlock(candidate);
      if (block) {
        byCandidateId.set(candidate.id, { runtime: block });
      }
      const controllerClassName = readString(candidate.data, 'controllerClassName');
      if (controllerClassName) {
        const list = endpointsByControllerClassName.get(controllerClassName);
        if (list) {
          list.push(candidate);
        } else {
          endpointsByControllerClassName.set(controllerClassName, [candidate]);
        }
      }
    } else if (candidate.candidate_type === 'interfaces') {
      interfaceCandidates.push(candidate);
    } else if (candidate.candidate_type === 'logical_data_entities') {
      logicalDataEntityCandidates.push(candidate);
    } else if (candidate.candidate_type === 'interface_logical_entities') {
      interfaceLogicalEntityCandidates.push(candidate);
    }
  }

  // ---- Pass 2: interface rollups. ----
  for (const iface of interfaceCandidates) {
    const className = readString(iface.data, 'className');
    const related = className
      ? endpointsByControllerClassName.get(className) ?? []
      : [];
    interfaceRollupByCandidateId.set(iface.id, buildInterfaceRollup(related));
  }

  // ---- Pass 3: interface_logical_entities rollups. ----
  for (const ile of interfaceLogicalEntityCandidates) {
    const interfaceClassName = readString(ile.data, 'interfaceClassName');
    const logicalEntityName = readString(ile.data, 'logicalEntityName');
    const related = interfaceClassName
      ? endpointsByControllerClassName.get(interfaceClassName) ?? []
      : [];
    interfaceLogicalEntityRollupByCandidateId.set(
      ile.id,
      buildInterfaceLogicalEntityRollup(related, logicalEntityName)
    );
  }

  // ---- Pass 4: logical_data_entities rollups (chain via ILEs). ----
  // Index ILEs by logicalEntityName for O(1) lookup.
  const ilesByLogicalEntityName = new Map<string, DiscoveryCandidateDto[]>();
  for (const ile of interfaceLogicalEntityCandidates) {
    const logicalEntityName = readString(ile.data, 'logicalEntityName');
    if (!logicalEntityName) continue;
    const list = ilesByLogicalEntityName.get(logicalEntityName);
    if (list) {
      list.push(ile);
    } else {
      ilesByLogicalEntityName.set(logicalEntityName, [ile]);
    }
  }

  for (const entity of logicalDataEntityCandidates) {
    const className = readString(entity.data, 'className');
    const ilesForEntity = className
      ? ilesByLogicalEntityName.get(className) ?? []
      : [];

    // Collect related endpoints across all linked ILEs, deduplicating by
    // candidate id so the same endpoint isn't double-counted when two
    // ILEs both point at the same controller.
    const relatedEndpointsById = new Map<string, DiscoveryCandidateDto>();
    for (const ile of ilesForEntity) {
      const interfaceClassName = readString(ile.data, 'interfaceClassName');
      if (!interfaceClassName) continue;
      const eps = endpointsByControllerClassName.get(interfaceClassName) ?? [];
      for (const ep of eps) {
        if (!relatedEndpointsById.has(ep.id)) {
          relatedEndpointsById.set(ep.id, ep);
        }
      }
    }

    logicalDataEntityRollupByCandidateId.set(
      entity.id,
      buildLogicalDataEntityRollup(Array.from(relatedEndpointsById.values()))
    );
  }

  return {
    byCandidateId,
    interfaceRollupByCandidateId,
    logicalDataEntityRollupByCandidateId,
    interfaceLogicalEntityRollupByCandidateId,
  };
}

// ---------------------------------------------------------------------------
// Per-rollup builders (internal)
// ---------------------------------------------------------------------------

function buildInterfaceRollup(
  relatedEndpoints: DiscoveryCandidateDto[]
): InterfaceRuntimeRollup {
  let totalObservedCalls = 0;
  let observedEndpointCount = 0;
  let status2xxCount = 0;
  let status3xxCount = 0;
  let status4xxCount = 0;
  let status5xxCount = 0;
  let firstSeen: string | undefined;
  let lastSeen: string | undefined;

  let topMethod: string | undefined;
  let topPath: string | undefined;
  let topCount = -1;

  for (const ep of relatedEndpoints) {
    const matched = readMatched(ep);
    if (!matched) continue;

    totalObservedCalls += matched.observedUsageCount;
    if (matched.observedUsageCount > 0) {
      observedEndpointCount += 1;
    }
    status2xxCount += matched.status2xxCount;
    status3xxCount += matched.status3xxCount;
    status4xxCount += matched.status4xxCount;
    status5xxCount += matched.status5xxCount;
    firstSeen = minIso(firstSeen, matched.firstSeen);
    lastSeen = maxIso(lastSeen, matched.lastSeen);

    if (matched.observedUsageCount > topCount) {
      topCount = matched.observedUsageCount;
      // Prefer the candidate's own pathTemplate when present; otherwise
      // fall back to the matched evidence's codePathTemplate.
      topMethod =
        readString(ep.data, 'httpMethod') ?? matched.method;
      topPath =
        readString(ep.data, 'pathTemplate') ?? matched.codePathTemplate;
    }
  }

  const topEndpoints =
    topCount >= 0 && topMethod !== undefined && topPath !== undefined
      ? [
          {
            method: topMethod,
            pathTemplate: topPath,
            observedUsageCount: topCount,
          },
        ]
      : [];

  const rollup: InterfaceRuntimeRollup = {
    totalObservedCalls,
    observedEndpointCount,
    totalEndpointCount: relatedEndpoints.length,
    topEndpoints,
    statusBreakdown: {
      status2xxCount,
      status3xxCount,
      status4xxCount,
      status5xxCount,
    },
  };
  if (firstSeen !== undefined) rollup.firstSeen = firstSeen;
  if (lastSeen !== undefined) rollup.lastSeen = lastSeen;
  return rollup;
}

function buildLogicalDataEntityRollup(
  relatedEndpoints: DiscoveryCandidateDto[]
): LogicalDataEntityRuntimeRollup {
  let totalObservedCalls = 0;
  let readLikeCount = 0;
  let writeLikeCount = 0;
  let firstSeen: string | undefined;
  let lastSeen: string | undefined;

  for (const ep of relatedEndpoints) {
    const matched = readMatched(ep);
    if (!matched) continue;

    totalObservedCalls += matched.observedUsageCount;

    const method = (readString(ep.data, 'httpMethod') ?? '').toUpperCase();
    if (READ_LIKE_METHODS.has(method)) {
      readLikeCount += matched.observedUsageCount;
    } else if (WRITE_LIKE_METHODS.has(method)) {
      writeLikeCount += matched.observedUsageCount;
    }

    firstSeen = minIso(firstSeen, matched.firstSeen);
    lastSeen = maxIso(lastSeen, matched.lastSeen);
  }

  const rollup: LogicalDataEntityRuntimeRollup = {
    totalObservedCalls,
    relatedEndpointCount: relatedEndpoints.length,
    readLikeCount,
    writeLikeCount,
  };
  if (firstSeen !== undefined) rollup.firstSeen = firstSeen;
  if (lastSeen !== undefined) rollup.lastSeen = lastSeen;
  return rollup;
}

function buildInterfaceLogicalEntityRollup(
  relatedEndpoints: DiscoveryCandidateDto[],
  logicalEntityName: string | undefined
): InterfaceLogicalEntityRuntimeRollup {
  let supportingEndpointCount = 0;
  let requestBodyUsageCount = 0;
  let responseBodyUsageCount = 0;
  let unknownRoleUsageCount = 0;
  let status2xxCount = 0;
  let status3xxCount = 0;
  let status4xxCount = 0;
  let status5xxCount = 0;
  let firstSeen: string | undefined;
  let lastSeen: string | undefined;

  for (const ep of relatedEndpoints) {
    const matched = readMatched(ep);
    if (!matched) continue;

    supportingEndpointCount += 1;

    const requestBodyType = readString(ep.data, 'requestBodyType');
    const responseType =
      readString(ep.data, 'responseType') ??
      readString(ep.data, 'unwrappedReturnType') ??
      readString(ep.data, 'returnType');

    const isRequestMatch =
      logicalEntityName !== undefined && requestBodyType === logicalEntityName;
    const isResponseMatch =
      logicalEntityName !== undefined && responseType === logicalEntityName;

    if (isRequestMatch) {
      requestBodyUsageCount += matched.observedUsageCount;
    }
    if (isResponseMatch) {
      responseBodyUsageCount += matched.observedUsageCount;
    }
    if (!isRequestMatch && !isResponseMatch) {
      unknownRoleUsageCount += matched.observedUsageCount;
    }

    status2xxCount += matched.status2xxCount;
    status3xxCount += matched.status3xxCount;
    status4xxCount += matched.status4xxCount;
    status5xxCount += matched.status5xxCount;
    firstSeen = minIso(firstSeen, matched.firstSeen);
    lastSeen = maxIso(lastSeen, matched.lastSeen);
  }

  const rollup: InterfaceLogicalEntityRuntimeRollup = {
    supportingEndpointCount,
    requestBodyUsageCount,
    responseBodyUsageCount,
    unknownRoleUsageCount,
    totalObservedContractUsage:
      requestBodyUsageCount + responseBodyUsageCount + unknownRoleUsageCount,
  };
  if (supportingEndpointCount > 0) {
    rollup.statusBreakdown = {
      status2xxCount,
      status3xxCount,
      status4xxCount,
      status5xxCount,
    };
  }
  if (firstSeen !== undefined) rollup.firstSeen = firstSeen;
  if (lastSeen !== undefined) rollup.lastSeen = lastSeen;
  return rollup;
}
