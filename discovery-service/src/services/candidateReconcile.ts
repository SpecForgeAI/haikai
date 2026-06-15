/**
 * Interface + logical-data-entity RECONCILIATION for the universal merge
 * (Spec 0 — Unique, Aggregate Discovery Candidates, Task Group 3).
 *
 * Runs AFTER `mergeCandidates` on the merged candidate set and performs the
 * relationship-rebuild the entity merge implies:
 *
 *   1. RE-PARENT a merged endpoint to its SPECIFIC controller interface when
 *      sources disagreed on the parent. The merge survivor reuses the
 *      highest-precedence source's object, so a structural JAX-RS source usually
 *      already carries the controller `parentCandidateId`; but when a WADL source
 *      won survivor identity (e.g. an endpoint only WADL emitted, later folded a
 *      JAX-RS view), the endpoint folded the JAX-RS `controllerClassName` into
 *      its `data` and we re-point its parent to the matching controller
 *      interface here. A SINGLE-source endpoint keeps its own parent untouched.
 *
 *   2. DROP a generic WADL interface once it has ZERO remaining endpoint
 *      children after re-parenting. A generic WADL interface NEVER key-matches a
 *      specific controller (Q8) — it collapses ONLY by being emptied.
 *
 *   3. CONSOLIDATE request/response `logical_data_entities` by identity (the
 *      merge already produced one survivor per identity key) and REBUILD the
 *      `interface_logical_entities` / `endpoint_data_effects` relationship rows
 *      (which resolve their entities BY NAME at save-back) so their entity-name
 *      references point at the surviving DTO's canonical name. A row whose
 *      logical-entity reference has NO surviving entity of that identity (a
 *      consolidated-away / never-emitted entity) is DROPPED as orphaned.
 *
 *   4. RE-PARENT `logical_data_attributes` to their surviving owning entity by
 *      resolving the recorded `data.logicalEntityName` to the surviving
 *      `logical_data_entities` id and setting `parentCandidateId`. This closes the
 *      orphaned-attribute gap: LLM-gap-fill attributes carry the parent NAME but
 *      no id, and a pack attribute whose parent merged to a different survivor id
 *      is left dangling (and later NULLed by `sortCandidatesParentsFirst`). Only a
 *      MISSING or DANGLING link is fixed; an attribute whose recorded entity has
 *      no survivor stays a genuine orphan.
 *
 * The backend-managed polymorphic `*_points` rows are NEVER touched. The output
 * still satisfies `sortCandidatesParentsFirst` (the re-parented endpoint's
 * parent interface still EXISTS in the set, so it is not orphan-cleared).
 *
 * Pure / NO I/O — operates on (and mutates in place) the merged array's objects,
 * returning a NEW array with the dropped candidates removed.
 */

import type { DiscoveryCandidate, CandidateType } from '../types/candidate';
import { normalizeName } from './prompts/dedup';

// ---------------------------------------------------------------------------
// Small readers (mirror candidateIdentity's dual-shape reads)
// ---------------------------------------------------------------------------

function readControllerFqn(data: Record<string, unknown>): string {
  return String(
    (data.controllerClassName as string | undefined) ??
      (data.className as string | undefined) ??
      '',
  ).trim();
}

/** A "specific" interface = one keyed on a controller/resource class FQN. */
function isSpecificControllerInterface(c: DiscoveryCandidate): boolean {
  const data = (c.data || {}) as Record<string, unknown>;
  return readControllerFqn(data).length > 0;
}

/** A "generic WADL" interface = `interface_type` + `spec_link`, NO controller FQN. */
function isGenericWadlInterface(c: DiscoveryCandidate): boolean {
  const data = (c.data || {}) as Record<string, unknown>;
  if (readControllerFqn(data).length > 0) return false;
  const interfaceType = String((data.interface_type as string | undefined) ?? '').trim();
  const specLink = String((data.spec_link as string | undefined) ?? '').trim();
  return interfaceType.length > 0 && specLink.length > 0;
}

/** The logical-data-entity identity key for a NAME (mirrors `buildIdentityKey`). */
function ldeIdentityKeyForName(name: string): string {
  return `logical_data_entities ${normalizeName(name)}`;
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/**
 * Reconcile the merged candidate set: re-parent endpoints to specific
 * controller interfaces, drop emptied generic interfaces, and rebuild
 * relationship rows around the consolidated entities. Returns a new array.
 */
export function reconcileMergedCandidates(
  merged: readonly DiscoveryCandidate[],
): DiscoveryCandidate[] {
  // --- Index interfaces by controller FQN (specific) ---------------------
  const interfaceByFqn = new Map<string, DiscoveryCandidate>();
  for (const c of merged) {
    if (c.candidateType !== 'interfaces') continue;
    if (!isSpecificControllerInterface(c)) continue;
    const fqn = normalizeName(readControllerFqn((c.data || {}) as Record<string, unknown>));
    // First specific interface for an FQN wins (stable; survivors are unique by identity).
    if (!interfaceByFqn.has(fqn)) interfaceByFqn.set(fqn, c);
  }

  // --- (1) Re-parent merged endpoints to the specific controller ---------
  // Only endpoints that MERGED >1 source (have a controllerClassName folded in)
  // and whose current parent is NOT already the matching specific interface.
  for (const c of merged) {
    if (c.candidateType !== 'endpoints') continue;
    const data = (c.data || {}) as Record<string, unknown>;
    const mergedFrom = Array.isArray(data._mergedFrom) ? (data._mergedFrom as unknown[]) : [];
    const isMultiSource = mergedFrom.length >= 2;
    const fqn = normalizeName(readControllerFqn(data));
    if (!fqn) continue;
    const specificIface = interfaceByFqn.get(fqn);
    if (!specificIface) continue;
    if (c.parentCandidateId === specificIface.id) continue;
    // Re-parent ONLY when this endpoint actually folded multiple sources (a
    // single-source endpoint keeps its own parent untouched per Q8).
    if (isMultiSource) {
      c.parentCandidateId = specificIface.id;
    }
  }

  // --- (2) Drop generic WADL interfaces emptied to zero endpoints --------
  const endpointChildCounts = new Map<string, number>();
  for (const c of merged) {
    if (c.candidateType !== 'endpoints') continue;
    if (!c.parentCandidateId) continue;
    endpointChildCounts.set(
      c.parentCandidateId,
      (endpointChildCounts.get(c.parentCandidateId) ?? 0) + 1,
    );
  }
  const droppedInterfaceIds = new Set<string>();
  for (const c of merged) {
    if (c.candidateType !== 'interfaces') continue;
    if (!isGenericWadlInterface(c)) continue;
    if ((endpointChildCounts.get(c.id) ?? 0) === 0) {
      droppedInterfaceIds.add(c.id);
    }
  }

  // --- (3) Consolidate DTOs (already done by merge) + remap relationship rows
  // Index surviving logical_data_entities by identity key -> canonical name AND
  // -> surviving id, plus the set of surviving entity ids (for the attribute
  // re-parent in step (4)).
  const ldeSurvivorNameByKey = new Map<string, string>();
  const ldeSurvivorIdByKey = new Map<string, string>();
  const ldeSurvivorIds = new Set<string>();
  for (const c of merged) {
    if (c.candidateType !== 'logical_data_entities') continue;
    const key = ldeIdentityKeyForName(c.name);
    ldeSurvivorNameByKey.set(key, c.name);
    // First survivor for an identity key wins (survivors are unique by identity).
    if (!ldeSurvivorIdByKey.has(key)) ldeSurvivorIdByKey.set(key, c.id);
    ldeSurvivorIds.add(c.id);
  }

  // --- (4) Re-parent logical_data_attributes to their surviving entity -------
  // An attribute records its owning entity BY NAME (`data.logicalEntityName`),
  // but the structural `parent_child` link is an ID (`parentCandidateId`). Two
  // gaps leave attributes orphaned:
  //   - LLM-gap-fill attributes are emitted with the parent NAME only and NO
  //     `parentCandidateId` (the id is meant to be resolved late — it never was);
  //   - a pack attribute whose parent entity merged to a DIFFERENT survivor id
  //     (e.g. the same DTO declared in two files) is left pointing at the folded,
  //     non-surviving id, which `sortCandidatesParentsFirst` later NULLS.
  // Resolve the recorded name to the surviving entity id and set the structural
  // link, so the attribute persists under its real parent AND the review model
  // groups it in the entity's family. ONLY fixes a MISSING or DANGLING link (an
  // attribute already pointing at a surviving entity is left untouched); an
  // attribute with no recorded name, or a name with no surviving entity, stays a
  // genuine orphan (its entity truly was not discovered).
  for (const c of merged) {
    if (c.candidateType !== 'logical_data_attributes') continue;
    // Already correctly linked to a surviving entity → nothing to do.
    if (c.parentCandidateId && ldeSurvivorIds.has(c.parentCandidateId)) continue;
    const data = (c.data || {}) as Record<string, unknown>;
    const refName =
      typeof data.logicalEntityName === 'string' ? data.logicalEntityName.trim() : '';
    if (!refName) continue; // no recorded parent name → genuine orphan
    const survivorId = ldeSurvivorIdByKey.get(ldeIdentityKeyForName(refName));
    if (survivorId) c.parentCandidateId = survivorId;
  }

  // The relationship-row name fields that reference a logical entity.
  const ENTITY_NAME_FIELDS = ['logicalEntityName', 'dataEntityName'] as const;
  const RELATIONSHIP_TYPES = new Set<CandidateType>([
    'interface_logical_entities',
    'endpoint_data_effects',
  ]);

  const out: DiscoveryCandidate[] = [];
  for (const c of merged) {
    // Drop emptied generic interfaces.
    if (c.candidateType === 'interfaces' && droppedInterfaceIds.has(c.id)) {
      continue;
    }

    if (RELATIONSHIP_TYPES.has(c.candidateType)) {
      const data = (c.data || {}) as Record<string, unknown>;
      let orphaned = false;
      for (const field of ENTITY_NAME_FIELDS) {
        const refName = data[field];
        if (typeof refName !== 'string' || refName.trim() === '') continue;
        const key = ldeIdentityKeyForName(refName);
        const survivorName = ldeSurvivorNameByKey.get(key);
        if (survivorName) {
          // Re-point to the surviving DTO's canonical name.
          if (survivorName !== refName) data[field] = survivorName;
        } else {
          // Referenced logical entity has NO surviving entity of that identity:
          // a consolidated-away / never-emitted entity -> the row is orphaned.
          orphaned = true;
        }
      }
      c.data = data;
      if (orphaned) continue; // drop the orphaned relationship row
    }

    out.push(c);
  }

  return out;
}
