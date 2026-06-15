/**
 * Derived-from-context binding resolver.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 2.
 *
 * When a task carries `saveTargetResolution: 'derived-from-context'`, the
 * conversation does not know which architecture it should write to until
 * the LLM identifies the target entity. The chatV2 response handler (Group
 * 6) intercepts a `contextBinding` block of shape
 *   { contextBinding: { entityType: 'interface', entityId: '<uuid>' } }
 * and calls `resolve(projectId, entityType, entityId)` here to translate
 * the entity identifier into an architecture binding it can persist on
 * `Thread.metadata` (see `ThreadArchitectureBindingMetadata` in
 * `gateway/src/types/chatV2.ts`).
 *
 * V1 scope: only `entityType: 'interface'` is supported. Any other type is
 * a {@link DerivedBindingError} with code `'unsupported_binding_type'`.
 * Rationale: only `architect--oas-spec` uses `derived-from-context` in V1
 * and OAS specs only target interfaces (YAGNI for other entity types). V2
 * may extend this resolver (and add `lookupServiceArchitecture`,
 * `lookupApplicationArchitecture`, etc. helpers in
 * `architectureModelClient.ts`) as needed.
 *
 * Archived-architecture refusal: if the resolved entity belongs to an
 * archived architecture, the resolver throws
 * {@link DerivedBindingError} with code `'archived_architecture'` so the
 * chatV2 handler can surface a 422 to the LLM. The thread is NOT bound;
 * the user must pick a different entity.
 *
 * Network / 404 failures from the upstream lookup are surfaced as
 * {@link DerivedBindingError} with code `'lookup_failed'` so the handler
 * can refuse the bind without leaking upstream details to the LLM.
 */

import {
  lookupInterfaceArchitecture,
  InterfaceArchitectureLookupError,
  InterfaceArchitectureBinding,
} from './architectureModelClient';
import { logger } from './logger';

/**
 * Discriminated set of failure codes the chatV2 handler maps to HTTP 422
 * responses (and the LLM surfaces back to the user).
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 2.
 *
 *   - `'unsupported_binding_type'`: the LLM emitted a `contextBinding`
 *     block with an `entityType` other than `'interface'`. V1 only
 *     supports interfaces.
 *   - `'archived_architecture'`: the resolved entity lives in an archived
 *     architecture; binding to archived architectures is refused.
 *   - `'lookup_failed'`: the upstream architecture-model-service returned
 *     a non-2xx response (e.g. 404 interface not found, or a 5xx).
 */
export type DerivedBindingErrorCode =
  | 'unsupported_binding_type'
  | 'archived_architecture'
  | 'lookup_failed';

/**
 * Typed error thrown by {@link resolve}. Carries a machine-readable
 * {@link DerivedBindingErrorCode} so the chatV2 response handler (Group 6)
 * can map directly to a 422 JSON payload of shape
 *   { code: <DerivedBindingErrorCode>, message: <human-readable> }
 * without further branching.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 2.
 */
export class DerivedBindingError extends Error {
  readonly code: DerivedBindingErrorCode;

  constructor(code: DerivedBindingErrorCode, message: string) {
    super(message);
    this.name = 'DerivedBindingError';
    this.code = code;
  }
}

/**
 * Successful binding payload returned by {@link resolve}.
 *
 * Mirrors {@link InterfaceArchitectureBinding} from the client helper. The
 * chatV2 handler (Group 6) spreads these fields onto `Thread.metadata` as
 * `{boundArchitectureId, boundArchitectureName, boundEntityType,
 * boundEntityId}` (see {@link
 * ../types/chatV2.ThreadArchitectureBindingMetadata}).
 */
export interface DerivedBindingResult {
  /** UUID of the architecture the entity belongs to. */
  architectureId: string;
  /** Human-readable architecture display name. */
  architectureName: string;
  /**
   * Whether the architecture is archived. Always `false` on a successful
   * resolve -- {@link resolve} throws {@link DerivedBindingError} with
   * code `'archived_architecture'` rather than returning `archived: true`.
   * Field kept on the type so callers see the same shape as the underlying
   * lookup.
   */
  archived: boolean;
}

/**
 * Resolves a `contextBinding` block (entityType + entityId) to the
 * architecture the conversation should bind to.
 *
 * V1 supports only `entityType: 'interface'`. The resolver:
 *   1. Validates `entityType === 'interface'` (else throws
 *      `unsupported_binding_type`).
 *   2. Calls {@link lookupInterfaceArchitecture} on
 *      `architectureModelClient`.
 *   3. If the resolved architecture is archived, throws
 *      `archived_architecture` with a message identifying the
 *      architecture name.
 *   4. Otherwise returns {@link DerivedBindingResult} for the chatV2
 *      handler to persist on `Thread.metadata`.
 *
 * Network / 404 failures from the upstream lookup are mapped to
 * `lookup_failed`.
 *
 * Spec: 2026-05-01 Multi-Architecture Save-Target Resolution (Spec #5) --
 * Task Group 2.
 *
 * @param projectId   - Project UUID
 * @param entityType  - Entity type from the LLM's `contextBinding` block;
 *                      V1 must be `'interface'`
 * @param entityId    - Entity id (interface UUID for V1)
 * @returns Architecture binding payload to persist on `Thread.metadata`
 * @throws DerivedBindingError on unsupported type, archived architecture,
 *         or upstream lookup failure
 */
export async function resolve(
  projectId: string,
  entityType: string,
  entityId: string
): Promise<DerivedBindingResult> {
  // ----- V1 supports only entityType === 'interface' -----
  if (entityType !== 'interface') {
    logger.debug('derivedBindingResolver: unsupported entityType', {
      projectId,
      entityType,
      entityId,
    });
    throw new DerivedBindingError(
      'unsupported_binding_type',
      `derived-from-context V1 only supports entityType 'interface' (received '${entityType}')`
    );
  }

  // ----- Look up the interface's architecture -----
  let binding: InterfaceArchitectureBinding;
  try {
    binding = await lookupInterfaceArchitecture(projectId, entityId);
  } catch (error) {
    // Map upstream lookup failures (404, 5xx, network) to a generic
    // 'lookup_failed' so the chatV2 handler doesn't leak upstream HTTP
    // details to the LLM. The original error is logged at warn level by
    // the client helper.
    const status =
      error instanceof InterfaceArchitectureLookupError ? error.status : -1;
    logger.debug('derivedBindingResolver: upstream lookup failed', {
      projectId,
      entityType,
      entityId,
      upstreamStatus: status,
    });
    throw new DerivedBindingError(
      'lookup_failed',
      `Could not resolve architecture for ${entityType} ${entityId} (upstream status=${status})`
    );
  }

  // ----- Refuse archived architectures -----
  if (binding.archived) {
    logger.debug('derivedBindingResolver: refusing bind to archived architecture', {
      projectId,
      entityType,
      entityId,
      architectureId: binding.architectureId,
      architectureName: binding.architectureName,
    });
    throw new DerivedBindingError(
      'archived_architecture',
      `Cannot bind to archived architecture: ${binding.architectureName}`
    );
  }

  logger.debug('derivedBindingResolver: bound conversation to architecture', {
    projectId,
    entityType,
    entityId,
    architectureId: binding.architectureId,
    architectureName: binding.architectureName,
  });

  return {
    architectureId: binding.architectureId,
    architectureName: binding.architectureName,
    archived: binding.archived,
  };
}
