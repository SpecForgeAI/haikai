/**
 * formatArchitectureContext.ts
 *
 * Spec: Append Resolved Architecture Context to Shape-Spec Stream Message
 *
 * Resolves architecture context from the expand-resolve endpoint and formats
 * it as a markdown block to be appended to the shape-spec stream message.
 * This gives the Software Architect LLM the same rich entity/diagram/relationship
 * context that the Product Owner planner already receives.
 *
 * Spec 2026-03-15: Meta-Model Explainer for Implement Roles
 * - Added fetchArchitectureExplainer() to load the meta-model reference guide
 * - Updated formatArchitectureContextBlock() to accept and prepend the explainer
 */

import type { ContextState } from './contextStorage';
import {
  expandResolveContext,
  normalizeEntityType,
  type EntitySelectionDto,
  type DiagramSelectionDto,
  type ExpandResolveResponseDto,
} from '../api/implementContextApi';

const GATEWAY_BASE = import.meta.env.VITE_GATEWAY_BASE_URL ?? '';

/**
 * Fetches the static architecture meta-model explainer markdown from the gateway.
 * This document describes all entity types and relationship types in the
 * architecture meta-model, giving the LLM context to interpret the data.
 *
 * @returns The explainer markdown string, or null on error
 */
export async function fetchArchitectureExplainer(): Promise<string | null> {
  try {
    const response = await fetch(`${GATEWAY_BASE}/api/architecture-explainer`);
    if (!response.ok) {
      console.warn('Failed to fetch architecture explainer:', response.status);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.warn('Failed to fetch architecture explainer:', error);
    return null;
  }
}

/**
 * Main orchestrator: resolves architecture context from the backend and
 * returns a formatted markdown block, or null if there is nothing to resolve.
 *
 * @param projectId - The project identifier (filename)
 * @param contextState - The current context state with entity/diagram refs
 * @param explainer - Optional meta-model explainer markdown to prepend
 * @returns Formatted architecture context block, or null
 */
export async function resolveAndFormatArchitectureContext(
  projectId: string,
  contextState: ContextState,
  explainer?: string | null
): Promise<string | null> {
  // Map entity refs → EntitySelectionDto[] with normalised entity types
  const entities: EntitySelectionDto[] = contextState.entity_refs.map((ref) => ({
    entity_type: normalizeEntityType(ref.entity_type),
    entity_id: ref.entity_id,
    bundle_type: ref.bundle_type || 'entity_only',
    depth: ref.depth ?? null,
  }));

  // Map diagram refs → DiagramSelectionDto[]
  const diagrams: DiagramSelectionDto[] = contextState.diagram_refs.map((ref) => ({
    diagram_id: ref.diagram_id,
    bundle_type: ref.bundle_type || 'diagram_only',
  }));

  // Nothing to resolve
  if (entities.length === 0 && diagrams.length === 0) {
    return null;
  }

  const response = await expandResolveContext(projectId, entities, diagrams);
  if (!response) {
    return null;
  }

  return formatArchitectureContextBlock(response, explainer);
}

/**
 * Spec 2026-02-10: Minify architecture context IDs.
 *
 * Collects every unique ID string across entities, diagrams, and relationships,
 * then maps each to a sequential integer (1, 2, 3, ...).  The mapping is
 * applied in-place so the JSON payload sent to the implementation LLM is
 * significantly shorter while preserving referential integrity.
 */
function buildIdMap(response: ExpandResolveResponseDto): Map<string, number> {
  const seen = new Set<string>();

  for (const e of response.resolved_entities ?? []) {
    if (e.id) seen.add(e.id);
  }
  for (const d of response.resolved_diagrams ?? []) {
    if (d.id) seen.add(d.id);
    for (const refId of d.referenced_entity_ids ?? []) {
      if (refId) seen.add(refId);
    }
  }
  for (const r of response.resolved_relationships ?? []) {
    if (r.id) seen.add(r.id);
    if (r.from?.entity_id) seen.add(r.from.entity_id);
    if (r.to?.entity_id) seen.add(r.to.entity_id);
  }

  const idMap = new Map<string, number>();
  let counter = 1;
  for (const id of seen) {
    idMap.set(id, counter++);
  }
  return idMap;
}

/**
 * Spec 2026-02-10: Build a minified architecture context payload.
 *
 * Applies two token-saving techniques:
 * 1. Replace long database IDs with sequential integers (1, 2, 3, ...)
 * 2. Shorten JSON keys (resolved_entities → entities, entity_type → type, etc.)
 * 3. Strip metadata fields (truncated, truncation_reason, category)
 */
function buildMinifiedPayload(response: ExpandResolveResponseDto, idMap: Map<string, number>) {
  const mapId = (id: string): number => idMap.get(id) ?? 0;

  const entities = (response.resolved_entities ?? []).map((e) => ({
    id: mapId(e.id),
    name: e.name,
    type: e.entity_type,
    fields: e.relevant_fields,
  }));

  const diagrams = (response.resolved_diagrams ?? []).map((d) => ({
    id: mapId(d.id),
    name: d.name,
    type: d.diagram_type,
    ref_ids: (d.referenced_entity_ids ?? []).map(mapId),
    ...(d.referenced_entity_names ? { ref_names: d.referenced_entity_names } : {}),
  }));

  const relationships = (response.resolved_relationships ?? []).map((r) => ({
    id: mapId(r.id),
    type: r.type,
    label: r.label,
    from: { type: r.from.entity_type, eid: mapId(r.from.entity_id), name: r.from.name },
    to: { type: r.to.entity_type, eid: mapId(r.to.entity_id), name: r.to.name },
    fields: r.summary_fields,
  }));

  return { entities, diagrams, relationships };
}

/**
 * Formats the expand-resolve response into a markdown block suitable for
 * appending to the shape-spec message.
 *
 * Spec 2026-02-10: Minifies the JSON payload by replacing long database IDs
 * with sequential integers and shortening key names to reduce token usage.
 *
 * Spec 2026-03-15: Accepts optional meta-model explainer to prepend before
 * the JSON data, giving the LLM context to interpret entity/relationship types.
 *
 * @param response - The expand-resolve response DTO
 * @param explainer - Optional meta-model explainer markdown to prepend
 * @returns Formatted markdown block, or null if response has no content
 */
export function formatArchitectureContextBlock(
  response: ExpandResolveResponseDto,
  explainer?: string | null
): string | null {
  const hasEntities = response.resolved_entities && response.resolved_entities.length > 0;
  const hasDiagrams = response.resolved_diagrams && response.resolved_diagrams.length > 0;
  const hasRelationships = response.resolved_relationships && response.resolved_relationships.length > 0;

  if (!hasEntities && !hasDiagrams && !hasRelationships) {
    return null;
  }

  const idMap = buildIdMap(response);
  const payload = buildMinifiedPayload(response, idMap);

  const explainerSection = explainer
    ? explainer + '\n\n'
    : '';

  return (
    explainerSection +
    '## Architecture Context\n' +
    'Here is the part of the architecture that directly applies to this spec ' +
    'and it must be reviewed as part of the spec above. It is expressed as a ' +
    'JSON payload about business, application, data, behavioural and/or UI architecture:\n\n' +
    JSON.stringify(payload)
  );
}

/**
 * Appends an architecture context block to a message string.
 * If contextBlock is null, the message is returned unchanged.
 *
 * @param message - The original message
 * @param contextBlock - The formatted architecture context block, or null
 * @returns The message with appended context, or unchanged
 */
export function appendArchitectureContext(
  message: string,
  contextBlock: string | null
): string {
  if (!contextBlock) {
    return message;
  }
  return message + '\n\n' + contextBlock;
}
