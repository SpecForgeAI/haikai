/**
 * Architecture Routes for the Gateway API
 *
 * Provides proxy routes for the new architectures list endpoint and for the
 * Bucket A architecture-scoped endpoints (meta-model summary, model entities,
 * temporary diagrams, user journey diagrams, user journey overview diagrams,
 * user journey sync, model load).
 *
 * Every Bucket A proxy route embeds `:architectureId` as a path segment between
 * `:projectId` and the rest of the path. Forgetting the segment in the URL
 * results in a 404 at this Express layer (no silent fallback) -- matching the
 * 404 safety property enforced at the architecture-model-service layer.
 *
 * Spec: 2026-05-01 Multi-Architecture Plumbing -- Task Group 3
 * Spec: 2026-05-01 Multi-Architecture Selective Cross-Architecture Copy (Spec #7) -- Task Group 5
 * Spec: 2026-05-15 Create Target Baseline from Current State -- Task Group 4
 *   - Added four pass-through proxy routes for /architecture-mappings CRUD/search.
 *   - Existing selective-copy/commit proxy already passes the new optional
 *     `autoMap` request flag and the new `createdMappingCount` response field
 *     through verbatim (no route change).
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import {
  createArchitecture,
  updateArchitecture,
  archiveArchitecture,
  cloneArchitecture,
  getElementsInventory,
  selectiveCopyPreflight,
  selectiveCopyCommit,
  listArchitectureMappings,
  createArchitectureMapping,
  updateArchitectureMapping,
  deleteArchitectureMapping,
  ArchitectureModelHttpError,
  CreateArchitecturePayload,
  UpdateArchitecturePayload,
  CloneArchitecturePayload,
  SelectiveCopyPreflightRequest,
  SelectiveCopyCommitRequest,
  ArchitectureMappingFilters,
  CreateArchitectureMappingRequest,
  UpdateArchitectureMappingRequest,
} from '../services/architectureModelClient';

export const architecturesRouter = Router();

function getModelServiceUrl(): string {
  return getConfig().architectureModelServiceBaseUrl;
}

/**
 * Generic proxy helper for a Bucket A endpoint.
 *
 * Builds the upstream URL, forwards the request method/body, and pipes the
 * status + body back to the caller. Logs failures.
 */
async function proxyToUpstream(
  req: Request,
  res: Response,
  buildUrl: (params: Record<string, string>) => string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' = 'GET'
): Promise<void> {
  const requestId = (req as any).requestId || 'unknown';
  const url = buildUrl(req.params as Record<string, string>);

  // Preserve the upstream querystring verbatim (e.g. ?businessUserId=...).
  const queryIdx = req.originalUrl.indexOf('?');
  const queryString = queryIdx >= 0 ? req.originalUrl.substring(queryIdx) : '';
  const fullUrl = `${url}${queryString}`;

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  };

  if (method !== 'GET' && method !== 'DELETE' && req.body !== undefined) {
    init.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }

  logger.debug('Architecture proxy: forwarding request', {
    requestId,
    method,
    url: fullUrl,
  });

  try {
    const upstream = await fetch(fullUrl, init);
    let body: unknown;
    const contentType = upstream.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        body = await upstream.json();
      } catch {
        body = null;
      }
    } else {
      body = await upstream.text();
    }

    if (!upstream.ok) {
      logger.warn('Architecture proxy: upstream returned non-OK', {
        requestId,
        method,
        url: fullUrl,
        status: upstream.status,
      });
    }

    res.status(upstream.status);
    if (body === null || body === undefined) {
      res.end();
    } else if (typeof body === 'string') {
      res.send(body);
    } else {
      res.json(body);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Architecture proxy: upstream fetch failed', {
      requestId,
      method,
      url: fullUrl,
      error: message,
    });
    res.status(503).json({
      error: {
        code: 503,
        message: 'Architecture model service unavailable',
        details: message,
      },
    });
  }
}

// ============================================================================
// 3.4 -- New endpoint: list architectures for a project
// ============================================================================

/**
 * GET /api/projects/:projectId/architectures
 *
 * Lists all architectures for a project. Returns an array verbatim from the
 * architecture-model-service. Used by the frontend to resolve the project's
 * Default architecture (oldest non-archived) at project-load time.
 */
architecturesRouter.get(
  '/projects/:projectId/architectures',
  async (req, res) => {
    await proxyToUpstream(req, res, (p) =>
      `${getModelServiceUrl()}/api/projects/${encodeURIComponent(p.projectId)}/architectures`
    );
  }
);

// ============================================================================
// Bucket A proxy routes -- every URL embeds :architectureId as a path segment.
// Omitting the :architectureId segment from the URL causes Express to fail to
// match these routes, producing a 404. This is the path-segment safety
// property required by spec.md (no silent fallback).
// ============================================================================

/**
 * GET /api/projects/:projectId/architectures/:architectureId/meta-model-summary
 *
 * Proxies the Bucket A meta-model-summary endpoint.
 */
architecturesRouter.get(
  '/projects/:projectId/architectures/:architectureId/meta-model-summary',
  async (req, res) => {
    await proxyToUpstream(req, res, (p) =>
      `${getModelServiceUrl()}/api/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}/meta-model-summary`
    );
  }
);

/**
 * GET /api/model/projects/:projectId/architectures/:architectureId/entities/:entityType/:entityId
 *
 * Proxies the Bucket A model-entity endpoint (services / applications /
 * app_components only -- see ModelEntityController).
 */
architecturesRouter.get(
  '/model/projects/:projectId/architectures/:architectureId/entities/:entityType/:entityId',
  async (req, res) => {
    await proxyToUpstream(req, res, (p) =>
      `${getModelServiceUrl()}/api/model/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}/entities/${encodeURIComponent(p.entityType)}/${encodeURIComponent(p.entityId)}`
    );
  }
);

/**
 * GET /api/model/projects/:projectId/architectures/:architectureId
 *
 * Proxies the Bucket A model-load endpoint (path-segment form, replaces the
 * removed `/api/model?projectId=...` query-param form).
 */
architecturesRouter.get(
  '/model/projects/:projectId/architectures/:architectureId',
  async (req, res) => {
    await proxyToUpstream(req, res, (p) =>
      `${getModelServiceUrl()}/api/model/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}`
    );
  }
);

/**
 * GET /api/projects/:projectId/architectures/:architectureId/temporary-diagrams/:temporaryDiagramId
 * PUT /api/projects/:projectId/architectures/:architectureId/temporary-diagrams/:temporaryDiagramId
 *
 * Proxies the Bucket A temporary-diagram endpoints.
 */
architecturesRouter.get(
  '/projects/:projectId/architectures/:architectureId/temporary-diagrams/:temporaryDiagramId',
  async (req, res) => {
    await proxyToUpstream(req, res, (p) =>
      `${getModelServiceUrl()}/api/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}/temporary-diagrams/${encodeURIComponent(p.temporaryDiagramId)}`
    );
  }
);

architecturesRouter.put(
  '/projects/:projectId/architectures/:architectureId/temporary-diagrams/:temporaryDiagramId',
  async (req, res) => {
    await proxyToUpstream(
      req,
      res,
      (p) =>
        `${getModelServiceUrl()}/api/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}/temporary-diagrams/${encodeURIComponent(p.temporaryDiagramId)}`,
      'PUT'
    );
  }
);

/**
 * GET /api/projects/:projectId/architectures/:architectureId/user-journey-diagrams/:userJourneyId/temporary
 *
 * Proxies the Bucket A user-journey-diagram temporary endpoint.
 */
architecturesRouter.get(
  '/projects/:projectId/architectures/:architectureId/user-journey-diagrams/:userJourneyId/temporary',
  async (req, res) => {
    await proxyToUpstream(req, res, (p) =>
      `${getModelServiceUrl()}/api/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}/user-journey-diagrams/${encodeURIComponent(p.userJourneyId)}/temporary`
    );
  }
);

/**
 * GET /api/projects/:projectId/architectures/:architectureId/user-journey-diagrams/temporary
 *
 * Proxies the bulk USER_JOURNEY temporary fetch (used by the PDF generator).
 */
architecturesRouter.get(
  '/projects/:projectId/architectures/:architectureId/user-journey-diagrams/temporary',
  async (req, res) => {
    await proxyToUpstream(req, res, (p) =>
      `${getModelServiceUrl()}/api/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}/user-journey-diagrams/temporary`
    );
  }
);

/**
 * GET /api/projects/:projectId/architectures/:architectureId/user-journey-overview-diagrams/temporary?businessUserId=...
 *
 * Proxies the Bucket A user-journey-overview-diagram temporary endpoint.
 */
architecturesRouter.get(
  '/projects/:projectId/architectures/:architectureId/user-journey-overview-diagrams/temporary',
  async (req, res) => {
    await proxyToUpstream(req, res, (p) =>
      `${getModelServiceUrl()}/api/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}/user-journey-overview-diagrams/temporary`
    );
  }
);

/**
 * GET /api/projects/:projectId/architectures/:architectureId/diagrams/:diagramId/user-journey-sync-status
 * POST /api/projects/:projectId/architectures/:architectureId/diagrams/:diagramId/refresh-user-journey-from-model
 *
 * Proxies the Bucket A user-journey-sync endpoints.
 */
architecturesRouter.get(
  '/projects/:projectId/architectures/:architectureId/diagrams/:diagramId/user-journey-sync-status',
  async (req, res) => {
    await proxyToUpstream(req, res, (p) =>
      `${getModelServiceUrl()}/api/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}/diagrams/${encodeURIComponent(p.diagramId)}/user-journey-sync-status`
    );
  }
);

architecturesRouter.post(
  '/projects/:projectId/architectures/:architectureId/diagrams/:diagramId/refresh-user-journey-from-model',
  async (req, res) => {
    await proxyToUpstream(
      req,
      res,
      (p) =>
        `${getModelServiceUrl()}/api/projects/${encodeURIComponent(p.projectId)}/architectures/${encodeURIComponent(p.architectureId)}/diagrams/${encodeURIComponent(p.diagramId)}/refresh-user-journey-from-model`,
      'POST'
    );
  }
);

// ============================================================================
// Multi-Architecture CRUD UI + Tag Management (Spec #3) -- Task Group 2
//
// Three new mutation routes that proxy to the architecture-model service via
// the typed client functions. Status codes and error bodies pass through
// untouched: the frontend reads `body.code` (e.g. "duplicate_name",
// "last_architecture") and `body.field` to render inline validation messages.
// Any transformation here would break the safety properties (a) and (b).
// ============================================================================

/**
 * Helper: re-emit an upstream error byte-for-byte.
 *
 * If the error is an `ArchitectureModelHttpError`, its `status` and `body`
 * are forwarded verbatim. Anything else is treated as an upstream failure
 * (network, JSON parse, etc.) and turned into a 503 with the same envelope
 * the existing `proxyToUpstream` helper uses for parity.
 */
function emitUpstreamError(
  res: Response,
  error: unknown,
  context: { requestId: string; method: string; url: string }
): void {
  if (error instanceof ArchitectureModelHttpError) {
    logger.warn('Architecture proxy: upstream returned non-OK', {
      requestId: context.requestId,
      method: context.method,
      url: context.url,
      status: error.status,
    });
    res.status(error.status);
    if (error.body === null || error.body === undefined) {
      res.end();
    } else if (typeof error.body === 'string') {
      res.send(error.body);
    } else {
      res.json(error.body);
    }
    return;
  }

  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error('Architecture proxy: upstream fetch failed', {
    requestId: context.requestId,
    method: context.method,
    url: context.url,
    error: message,
  });
  res.status(503).json({
    error: {
      code: 503,
      message: 'Architecture model service unavailable',
      details: message,
    },
  });
}

/**
 * POST /api/projects/:projectId/architectures
 *
 * Creates a new architecture. Body: `{name, description?, tags?: string[]}`.
 * Returns 201 + the created Architecture DTO on success.
 *
 * Errors round-trip verbatim:
 *  - 409 `{code: "duplicate_name", field: "name", message: ...}` -- duplicate name in project (case-insensitive)
 *  - 400 -- validation failure (empty name, name >100 chars, description >500 chars, etc.)
 *  - 404 -- project not found
 */
architecturesRouter.post(
  '/projects/:projectId/architectures',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architectures`;
    try {
      const created = await createArchitecture(projectId, (req.body || {}) as CreateArchitecturePayload);
      res.status(201).json(created);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'POST', url });
    }
  }
);

/**
 * PATCH /api/projects/:projectId/architectures/:architectureId
 *
 * Combined edit: replaces name + description + the full tag set atomically.
 * Body: `{name, description?, tags: string[]}` (empty `tags` array clears tags).
 * Returns 200 + the updated Architecture DTO on success.
 *
 * Errors round-trip verbatim:
 *  - 409 `{code: "duplicate_name", field: "name", message: ...}` -- duplicate name in project
 *  - 400 -- validation failure
 *  - 404 -- architecture missing or belongs to a different project
 */
architecturesRouter.patch(
  '/projects/:projectId/architectures/:architectureId',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}`;
    try {
      const updated = await updateArchitecture(
        projectId,
        architectureId,
        (req.body || {}) as UpdateArchitecturePayload
      );
      res.status(200).json(updated);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'PATCH', url });
    }
  }
);

/**
 * POST /api/projects/:projectId/architectures/:architectureId/archive
 *
 * Soft-deletes (archives) an architecture. Returns 200 + the updated
 * Architecture DTO with `archived: true` on success.
 *
 * Errors round-trip verbatim:
 *  - 422 `{code: "last_architecture", message: "A project must have at least one architecture."}`
 *    -- attempt to archive the last non-archived architecture in the project
 *  - 404 -- architecture missing or belongs to a different project
 */
architecturesRouter.post(
  '/projects/:projectId/architectures/:architectureId/archive',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/archive`;
    try {
      const archived = await archiveArchitecture(projectId, architectureId);
      res.status(200).json(archived);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'POST', url });
    }
  }
);


// ============================================================================
// Multi-Architecture Full Clone (Spec #6) -- Task Group 4
//
// Pass-through proxy for the new clone endpoint. The backend performs the
// transactional clone (architecture row + every architecture-scoped meta-model
// row inside one @Transactional boundary). The gateway adds no business
// logic -- it forwards the body upstream and re-emits the response status
// + body byte-for-byte so the frontend modal can branch on body.code
// ("archived_source" / "duplicate_name") to render inline vs footer errors.
// ============================================================================

/**
 * POST /api/projects/:projectId/architectures/:sourceArchitectureId/clone
 *
 * Full-clones an existing architecture into a brand-new architecture within
 * the same project. Body: `{name, description?, tags?: string[]}`. Returns
 * 201 + the new Architecture DTO on success.
 *
 * Errors round-trip verbatim:
 *  - 422 `{code: "archived_source", message: ...}` -- source is archived
 *  - 409 `{code: "duplicate_name", field: "name", message: ...}` -- target name conflicts
 *    with an existing architecture in the project (case-insensitive)
 *  - 404 -- source architecture not found within the project
 *  - 400 -- validation failure (empty name, name >100 chars, description >500 chars, etc.)
 */
architecturesRouter.post(
  '/projects/:projectId/architectures/:sourceArchitectureId/clone',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, sourceArchitectureId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(sourceArchitectureId)}/clone`;
    try {
      const cloned = await cloneArchitecture(
        projectId,
        sourceArchitectureId,
        (req.body || {}) as CloneArchitecturePayload
      );
      res.status(201).json(cloned);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'POST', url });
    }
  }
);


// ============================================================================
// Multi-Architecture Selective Cross-Architecture Copy (Spec #7) -- Task Group 5
//
// Three new pass-through proxy routes for the selective-copy workflow:
//   - GET  .../elements-inventory          -- read-only picker tree data
//   - POST .../selective-copy/preflight    -- conflict + auto-include detection
//   - POST .../selective-copy/commit       -- transactional copy with FK rewiring
//
// All three forward the upstream status + body byte-for-byte via the existing
// emitUpstreamError helper so the frontend wizard can branch on body.code
// (`archived_source` / `same_architecture` / `missing_reference`) to render
// the appropriate footer banners.
// ============================================================================

/**
 * GET /api/projects/:projectId/architectures/:architectureId/elements-inventory
 *
 * Returns the read-only element inventory for an architecture (the picker
 * tree shape: 6 canonical domains -> entity types -> instances). Powers the
 * `SelectiveCopyElementPicker` tree on the frontend.
 *
 * Errors round-trip verbatim:
 *  - 404 -- architecture not found within the project (standard envelope, no `code`)
 */
architecturesRouter.get(
  '/projects/:projectId/architectures/:architectureId/elements-inventory',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, architectureId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(architectureId)}/elements-inventory`;
    try {
      const inventory = await getElementsInventory(projectId, architectureId);
      res.status(200).json(inventory);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'GET', url });
    }
  }
);

/**
 * POST /api/projects/:projectId/architectures/:targetArchitectureId/selective-copy/preflight
 *
 * Runs the read-only preflight (conflict + auto-include detection) for a
 * selective copy from `sourceArchitectureId` (in the body) into the target
 * architecture in the URL. No state mutation.
 *
 * Body: `{sourceArchitectureId, elementIds: string[]}`.
 * Returns 200 + `SelectiveCopyPreflightResponse`.
 *
 * Errors round-trip verbatim:
 *  - 422 `{code: "archived_source"}`   -- source is archived
 *  - 422 `{code: "same_architecture"}` -- source === target
 *  - 404 -- source or target architecture not found within the project
 *  - 400 -- validation failure
 */
architecturesRouter.post(
  '/projects/:projectId/architectures/:targetArchitectureId/selective-copy/preflight',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, targetArchitectureId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(targetArchitectureId)}/selective-copy/preflight`;
    try {
      const result = await selectiveCopyPreflight(
        projectId,
        targetArchitectureId,
        (req.body || {}) as SelectiveCopyPreflightRequest
      );
      res.status(200).json(result);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'POST', url });
    }
  }
);

/**
 * POST /api/projects/:projectId/architectures/:targetArchitectureId/selective-copy/commit
 *
 * Runs the transactional commit for a selective copy. The backend wraps the
 * entire commit in a single `@Transactional` boundary so any per-element
 * insert/update failure rolls back the whole copy (atomic commit safety
 * property).
 *
 * Body: `{sourceArchitectureId, elementIds: string[], resolutions: [...], autoMap?: boolean}`.
 * Returns 200 + `SelectiveCopyCommitResponse` with copied / skipped /
 * overwritten / duplicated / autoIncluded / createdMappingCount counts.
 *
 * The optional `autoMap` request flag and the `createdMappingCount` response
 * field flow through this proxy verbatim because the typed client wrapper
 * `selectiveCopyCommit` JSON.stringify's the body and returns the parsed
 * upstream body unchanged. No body shape transformation happens here; the
 * route was extended in Spec 2026-05-15 (Create Target Baseline) only by
 * widening the `SelectiveCopyCommitRequest` / `SelectiveCopyCommitResponse`
 * TypeScript shapes upstream. See Task Group 4.4 of that spec for the
 * confirmation.
 *
 * Errors round-trip verbatim:
 *  - 422 `{code: "archived_source"}`     -- source is archived (defence in depth)
 *  - 422 `{code: "same_architecture"}`   -- source === target (defence in depth)
 *  - 422 `{code: "missing_reference"}`   -- user un-ticked an auto-included element
 *  - 404 -- source or target architecture not found within the project
 *  - 400 -- validation failure
 */
architecturesRouter.post(
  '/projects/:projectId/architectures/:targetArchitectureId/selective-copy/commit',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, targetArchitectureId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architectures/${encodeURIComponent(targetArchitectureId)}/selective-copy/commit`;
    try {
      const result = await selectiveCopyCommit(
        projectId,
        targetArchitectureId,
        (req.body || {}) as SelectiveCopyCommitRequest
      );
      res.status(200).json(result);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'POST', url });
    }
  }
);


// ============================================================================
// Architecture Element Mappings (Spec: 2026-05-15 Create Target Baseline)
// -- Task Group 4
//
// Four new pass-through proxy routes for cross-architecture element mapping
// CRUD/search. All four delegate to the typed client wrappers in
// `architectureModelClient.ts` and use `emitUpstreamError` so the upstream
// status + body forward byte-for-byte. The frontend Mapping Review UI
// branches on `body.code === "duplicate_mapping"` for the 422 unique-constraint
// envelope on POST.
//
// No business logic in this layer -- mapping list is always fetched fresh
// from AMS in v1 (no source-side cache layer).
// ============================================================================

/**
 * GET /api/projects/:projectId/architecture-mappings
 *
 * Lists architecture element mappings for a project. Forwards every supported
 * query parameter to AMS verbatim:
 *   sourceArchitectureId, targetArchitectureId,
 *   sourceElementType, targetElementType,
 *   mappingType, status, q (free-text search across source/target ids + notes).
 *
 * Returns 200 + `ArchitectureElementMappingDto[]` on success.
 *
 * Errors round-trip verbatim (e.g. 404 when the project does not exist).
 */
architecturesRouter.get(
  '/projects/:projectId/architecture-mappings',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings`;
    try {
      // Coerce req.query into the typed filter shape; only the documented
      // fields are forwarded. Express parses ?key=value into strings (or
      // string[]) so we cast through the filter interface defensively.
      const rawQuery = req.query as Record<string, unknown>;
      const filters: ArchitectureMappingFilters = {};
      const allowed: (keyof ArchitectureMappingFilters)[] = [
        'sourceArchitectureId',
        'targetArchitectureId',
        'sourceElementType',
        'targetElementType',
        'mappingType',
        'status',
        'q',
      ];
      for (const key of allowed) {
        const value = rawQuery[key];
        if (typeof value === 'string' && value.length > 0) {
          filters[key] = value;
        }
      }
      const mappings = await listArchitectureMappings(projectId, filters);
      res.status(200).json(mappings);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'GET', url });
    }
  }
);

/**
 * POST /api/projects/:projectId/architecture-mappings
 *
 * Creates a new architecture element mapping (manual-add path from the
 * Mapping Review modal). Body: `CreateArchitectureMappingRequest`.
 * Returns 201 + the created `ArchitectureElementMappingDto` on success.
 *
 * Errors round-trip verbatim:
 *  - 422 `{code: "duplicate_mapping", message: ...}` -- the unique constraint
 *    `(project_id, source_arch, target_arch, source_type, source_id,
 *     target_type, target_id, mapping_type)` is violated. The frontend
 *     surfaces this as an inline error in the manual-add row.
 *  - 422 -- validation failure (e.g. source_arch == target_arch, mapping_type
 *           or status not in v1 allowed set)
 *  - 404 -- project not found
 *  - 400 -- malformed body
 */
architecturesRouter.post(
  '/projects/:projectId/architecture-mappings',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings`;
    try {
      const created = await createArchitectureMapping(
        projectId,
        (req.body || {}) as CreateArchitectureMappingRequest
      );
      res.status(201).json(created);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'POST', url });
    }
  }
);

/**
 * PUT /api/projects/:projectId/architecture-mappings/:mappingId
 *
 * Updates the four mutable fields on an existing mapping (mappingType,
 * status, notes, confidence). `createdByTask` is set server-side to
 * `mapping-review-modal-edit`; the request DTO ignores any client-supplied
 * value. Returns 200 + the updated `ArchitectureElementMappingDto`.
 *
 * Errors round-trip verbatim (e.g. 404 mapping not found, 422 validation).
 */
architecturesRouter.put(
  '/projects/:projectId/architecture-mappings/:mappingId',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, mappingId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings/${encodeURIComponent(mappingId)}`;
    try {
      const updated = await updateArchitectureMapping(
        projectId,
        mappingId,
        (req.body || {}) as UpdateArchitectureMappingRequest
      );
      res.status(200).json(updated);
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'PUT', url });
    }
  }
);

/**
 * DELETE /api/projects/:projectId/architecture-mappings/:mappingId
 *
 * Hard-deletes a mapping row (v1 has no soft-delete). Returns 204 on success.
 *
 * Errors round-trip verbatim (e.g. 404 mapping not found).
 */
architecturesRouter.delete(
  '/projects/:projectId/architecture-mappings/:mappingId',
  async (req, res) => {
    const requestId = (req as any).requestId || 'unknown';
    const { projectId, mappingId } = req.params;
    const url = `${getModelServiceUrl()}/api/projects/${encodeURIComponent(projectId)}/architecture-mappings/${encodeURIComponent(mappingId)}`;
    try {
      await deleteArchitectureMapping(projectId, mappingId);
      res.status(204).end();
    } catch (error) {
      emitUpstreamError(res, error, { requestId, method: 'DELETE', url });
    }
  }
);
