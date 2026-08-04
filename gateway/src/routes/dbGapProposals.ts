/**
 * DB Gap-Proposal routes (Spec 4 — LLM gap-proposal queue, 2026-08-04).
 *
 * The gateway surface for LLM-DRAFTED structural-metadata proposals: when a
 * pack structural finding says "relationships carry no fk_columns join
 * metadata" or "no primary keys", the LLM drafts the missing metadata FROM the
 * committed model (naming-convention inference — see
 * `services/dbGapProposalGeneration.ts`, the only resolution oracle) and every
 * draft lands in the AMS `db_gap_proposals` review queue. Nothing touches the
 * model until a human APPROVES a row; approval routes the write through the
 * MCP server's `apply_gap_metadata` tool (the model-write owner) which applies
 * additively — populated slots are never overwritten, they come back as
 * honest skip notes surfaced verbatim in the review response.
 *
 * Routes (mounted under /api/v1):
 *   POST   /projects/:projectId/db-gap-proposals/generate
 *   GET    /projects/:projectId/db-gap-proposals              (AMS pass-through)
 *   POST   /projects/:projectId/db-gap-proposals/:proposalId/review
 *   POST   /projects/:projectId/db-gap-proposals/manual
 *
 * AMS queue contract coded against (built in parallel — snake_case wire):
 *   GET    /api/projects/{pid}/db-gap-proposals?finding_key=
 *   PUT    /api/projects/{pid}/db-gap-proposals        (bulk upsert by proposal_key)
 *   PATCH  /api/projects/{pid}/db-gap-proposals/{id}   {review_status, reviewer_notes, applied_at}
 *   DELETE /api/projects/{pid}/db-gap-proposals/{id}
 */

import { Router, Request, Response } from 'express';
import { getConfig } from '../config';
import { logger } from '../services/logger';
import {
  CommittedPhysicalModel,
  defaultFetchModel,
} from '../services/dbMigrationPack/inputs';
import {
  GapLlmCaller,
  GapProposalRow,
  parseFkProposals,
  parsePkProposals,
  runGapProposalGeneration,
} from '../services/dbGapProposalGeneration';

const BASE = '/projects/:projectId/db-gap-proposals';

// ---------------------------------------------------------------------------
// Dependency seams (production defaults below; tests inject via the factory)
// ---------------------------------------------------------------------------

export interface DbGapProposalRouteDeps {
  /** Committed-model fetch — shared with the pack generator so "what the LLM
   * saw" and "what the pack reads" are the same snapshot function. */
  fetchModel: (projectId: string, architectureId: string) => Promise<CommittedPhysicalModel>;
  /** The injected LLM caller runGapProposalGeneration expects. */
  callLlm: GapLlmCaller;
  /** fetch used for AMS + MCP round trips (tests inject a router mock). */
  fetchImpl: typeof fetch;
}

/**
 * Default LLM caller — modelled EXACTLY on the DB-translation pipeline's
 * `defaultCallLlm` (services/dbMigrationPack/translations.ts): lazy require
 * keeps tests cleanly mockable, jsonMode forces strict-JSON responses.
 */
const defaultCallLlm: GapLlmCaller = async ({ systemPrompt, userPrompt, projectId }) => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getLlmClient } = require('../services/llmClient');
  const client = getLlmClient();
  const response = await client.sendChatRequest(
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    `db-gap-proposal-${Date.now()}`,
    `db-gap-proposal-${projectId}`,
    { jsonMode: true }
  );
  return { content: response.content ?? '' };
};

const defaultDeps: DbGapProposalRouteDeps = {
  fetchModel: defaultFetchModel,
  callLlm: defaultCallLlm,
  // Bind at call time so tests that swap global fetch still intercept.
  fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
};

// ---------------------------------------------------------------------------
// Error mapping (simplified mirror of dbMigrationPack.ts's mapError /
// AmsRoundTripError — those helpers aren't exported, so small local ones)
// ---------------------------------------------------------------------------

/** AMS answered non-2xx: round-trip its status + body verbatim. */
class GapAmsError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`AMS db-gap-proposals request failed: HTTP ${status}`);
    this.name = 'GapAmsError';
  }
}

function mapError(
  error: unknown,
  res: Response,
  routeName: string,
  context: Record<string, unknown>
): void {
  if (error instanceof GapAmsError) {
    logger.warn(`db-gap-proposals ${routeName}: AMS error round-trip`, {
      ...context,
      status: error.status,
    });
    res.status(error.status);
    res.setHeader('content-type', 'application/json');
    res.send(
      error.body || JSON.stringify({ error: { code: error.status, message: error.message } })
    );
    return;
  }
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error(`db-gap-proposals ${routeName}: unexpected error`, { ...context, error: message });
  res.status(500).json({
    error: { code: 500, message: `db-gap-proposals ${routeName} failed`, details: message },
  });
}

// ---------------------------------------------------------------------------
// Wire-shape helpers
// ---------------------------------------------------------------------------

/** AMS bulk-upsert row: the generator's row + provenance origin. */
interface GapProposalUpsertRow extends GapProposalRow {
  origin: 'llm' | 'manual';
}

/** Shape of a queue row read back from AMS (snake_case wire). */
interface AmsGapProposalRow {
  id: string;
  proposal_key: string;
  finding_key: string;
  kind: string;
  payload_json: Record<string, unknown> | null;
  rationale?: string | null;
  confidence?: string | null;
  origin?: string | null;
  review_status?: string | null;
  reviewer_notes?: string | null;
  applied_at?: string | null;
}

// ---------------------------------------------------------------------------
// Router factory (deps-seam pattern so route tests inject fetch/model/LLM)
// ---------------------------------------------------------------------------

export function createDbGapProposalsRouter(
  overrides: Partial<DbGapProposalRouteDeps> = {}
): Router {
  const deps: DbGapProposalRouteDeps = { ...defaultDeps, ...overrides };
  const router = Router();

  const amsBase = (): string => getConfig().architectureModelServiceBaseUrl;
  const queueUrl = (projectId: string): string =>
    `${amsBase()}/api/projects/${encodeURIComponent(projectId)}/db-gap-proposals`;

  /** JSON round trip to AMS; non-2xx -> GapAmsError (status+body verbatim). */
  async function amsJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await deps.fetchImpl(url, init);
    const text = await response.text().catch(() => '');
    if (!response.ok) throw new GapAmsError(response.status, text);
    return (text ? JSON.parse(text) : null) as T;
  }

  /** PUT the bulk upsert (by proposal_key) with the provenance origin. */
  async function upsertProposals(
    projectId: string,
    rows: GapProposalRow[],
    origin: 'llm' | 'manual'
  ): Promise<unknown> {
    const body: GapProposalUpsertRow[] = rows.map((row) => ({ ...row, origin }));
    return amsJson(queueUrl(projectId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
  }

  // -------------------------------------------------------------------------
  // POST /generate — LLM drafts proposals for one structural finding
  // -------------------------------------------------------------------------
  router.post(`${BASE}/generate`, async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const body = (req.body ?? {}) as {
      architecture_id?: string;
      finding_kind?: string;
      finding_key?: string;
    };
    for (const field of ['architecture_id', 'finding_kind', 'finding_key'] as const) {
      if (!body[field] || typeof body[field] !== 'string') {
        res.status(400).json({ error: { code: 400, message: `${field} is required.` } });
        return;
      }
    }
    const start = Date.now();
    try {
      const model = await deps.fetchModel(projectId, body.architecture_id as string);
      const result = await runGapProposalGeneration({
        projectId,
        findingKind: body.finding_kind as string,
        findingKey: body.finding_key as string,
        model,
        callLlm: deps.callLlm,
      });

      // Persist ONLY real drafts; an unsupported kind (or an empty draft set)
      // writes nothing — the queue never carries rows the user can't act on.
      if (result.supported && result.proposals.length > 0) {
        await upsertProposals(projectId, result.proposals, 'llm');
      }

      console.log(
        `[diag-gw] route=db-gap-proposals-generate status=200 supported=${result.supported} ` +
          `proposals=${result.proposals.length} warnings=${result.warnings.length} ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(200).json({
        supported: result.supported,
        unsupportedReason: result.unsupportedReason,
        proposals: result.proposals,
        warnings: result.warnings,
      });
    } catch (error) {
      console.warn(
        `[diag-gw] route=db-gap-proposals-generate status=err elapsed_ms=${Date.now() - start}`
      );
      mapError(error, res, 'generate', { projectId, findingKey: body.finding_key });
    }
  });

  // -------------------------------------------------------------------------
  // GET / — AMS pass-through list (optional ?finding_key= filter)
  // -------------------------------------------------------------------------
  router.get(BASE, async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const findingKey = typeof req.query.finding_key === 'string' ? req.query.finding_key : null;
    const url =
      queueUrl(projectId) +
      (findingKey ? `?finding_key=${encodeURIComponent(findingKey)}` : '');
    const start = Date.now();
    try {
      const upstream = await deps.fetchImpl(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const text = await upstream.text();
      console.log(
        `[diag-gw] route=db-gap-proposals-list status=${upstream.status} ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(upstream.status);
      const contentType = upstream.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);
      res.send(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('db-gap-proposals list proxy: upstream fetch failed', { url, error: message });
      res.status(503).json({
        error: { code: 503, message: 'Architecture model service unavailable', details: message },
      });
    }
  });

  // -------------------------------------------------------------------------
  // POST /:proposalId/review — approve | reject | needs_rework
  // -------------------------------------------------------------------------
  router.post(`${BASE}/:proposalId/review`, async (req: Request, res: Response) => {
    const { projectId, proposalId } = req.params;
    const body = (req.body ?? {}) as {
      action?: string;
      reviewer_notes?: string;
      architecture_id?: string;
    };
    const action = body.action;
    if (action !== 'approve' && action !== 'reject' && action !== 'needs_rework') {
      res.status(400).json({
        error: { code: 400, message: "action must be 'approve', 'reject' or 'needs_rework'." },
      });
      return;
    }
    // The MCP apply needs the architecture the proposal was drafted against —
    // required up front for approve so we never PATCH approved and then
    // discover we can't apply.
    if (action === 'approve' && (!body.architecture_id || typeof body.architecture_id !== 'string')) {
      res.status(400).json({
        error: { code: 400, message: 'architecture_id is required for approve.' },
      });
      return;
    }
    const start = Date.now();
    try {
      // The AMS contract has no GET-by-id — list and pick the row.
      const rows = await amsJson<AmsGapProposalRow[]>(queueUrl(projectId), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const row = (rows ?? []).find((r) => r.id === proposalId);
      if (!row) {
        res.status(404).json({
          error: { code: 404, message: `proposal "${proposalId}" not found.` },
        });
        return;
      }

      // Native 4-state pass-through: the AMS queue enum carries needs_rework
      // (chk_dgp_review_status), mirroring the pack-translation vocabulary.
      const reviewStatus =
        action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'needs_rework';
      const patchBody: Record<string, unknown> = { review_status: reviewStatus };
      if (typeof body.reviewer_notes === 'string' && body.reviewer_notes.length > 0) {
        patchBody.reviewer_notes = body.reviewer_notes;
      }
      await amsJson(`${queueUrl(projectId)}/${encodeURIComponent(proposalId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(patchBody),
      });

      if (action !== 'approve') {
        console.log(
          `[diag-gw] route=db-gap-proposals-review status=200 action=${action} ` +
            `elapsed_ms=${Date.now() - start}`
        );
        res.status(200).json({ review_status: reviewStatus });
        return;
      }

      // ---- APPROVE: build the delta from payload_json and call MCP apply ----
      const delta = buildApplyDelta(row);
      if (!delta) {
        // Approved stands (the human's verdict is recorded) but the apply
        // cannot be built — report honestly rather than 500-ing after PATCH.
        res.status(422).json({
          review_status: 'approved',
          apply_error:
            `proposal "${proposalId}" carries kind "${row.kind}" with a malformed payload_json — ` +
            'nothing was applied to the model.',
        });
        return;
      }

      // Reach the MCP server the same way the discovery save-approved proxy
      // does: getConfig().mcpBaseUrl + fetch (routes/discovery.ts).
      const { mcpBaseUrl } = getConfig();
      const mcpResponse = await deps.fetchImpl(`${mcpBaseUrl}/mcp/tools/apply_gap_metadata`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          sessionId: 'gateway',
          projectId,
          architectureId: body.architecture_id,
          deltas: [delta],
        }),
      });
      const mcpText = await mcpResponse.text().catch(() => '');
      if (!mcpResponse.ok) {
        logger.error('db-gap-proposals review: MCP apply failed', {
          projectId,
          proposalId,
          status: mcpResponse.status,
        });
        // The approval PATCH already landed (the human's decision is real);
        // the apply failing is an infrastructure fact, surfaced as 502.
        res.status(502).json({
          review_status: 'approved',
          apply_error: `MCP apply_gap_metadata failed: HTTP ${mcpResponse.status} ${mcpText.slice(0, 300)}`,
        });
        return;
      }
      const applyResult = (mcpText ? JSON.parse(mcpText) : { applied: 0, skipped: [] }) as {
        applied: number;
        skipped: Array<{ delta: unknown; reason: string }>;
      };

      // applied_at is stamped ONLY when the model actually changed. A skip
      // (slot already populated) still leaves the row approved — the honest
      // skip note rides back in the response instead of being swallowed.
      let appliedAt: string | null = null;
      if (applyResult.applied > 0) {
        appliedAt = new Date().toISOString();
        await amsJson(`${queueUrl(projectId)}/${encodeURIComponent(proposalId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ applied_at: appliedAt }),
        });
      }

      console.log(
        `[diag-gw] route=db-gap-proposals-review status=200 action=approve ` +
          `applied=${applyResult.applied} skipped=${applyResult.skipped?.length ?? 0} ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(200).json({
        review_status: 'approved',
        apply: applyResult,
        applied_at: appliedAt,
      });
    } catch (error) {
      console.warn(
        `[diag-gw] route=db-gap-proposals-review status=err elapsed_ms=${Date.now() - start}`
      );
      mapError(error, res, 'review', { projectId, proposalId, action });
    }
  });

  // -------------------------------------------------------------------------
  // POST /manual — a human-authored proposal, validated against the model
  // -------------------------------------------------------------------------
  router.post(`${BASE}/manual`, async (req: Request, res: Response) => {
    const { projectId } = req.params;
    const body = (req.body ?? {}) as {
      architecture_id?: string;
      finding_key?: string;
      kind?: string;
      payload_json?: Record<string, unknown>;
      rationale?: string;
    };
    if (!body.architecture_id || typeof body.architecture_id !== 'string') {
      // Needed to fetch the committed model the payload is validated against.
      res.status(400).json({ error: { code: 400, message: 'architecture_id is required.' } });
      return;
    }
    if (!body.finding_key || typeof body.finding_key !== 'string') {
      res.status(400).json({ error: { code: 400, message: 'finding_key is required.' } });
      return;
    }
    if (body.kind !== 'fk_join' && body.kind !== 'primary_key') {
      res.status(400).json({
        error: { code: 400, message: "kind must be 'fk_join' or 'primary_key'." },
      });
      return;
    }
    const payload = body.payload_json;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      res.status(400).json({ error: { code: 400, message: 'payload_json must be an object.' } });
      return;
    }
    const start = Date.now();
    try {
      const model = await deps.fetchModel(projectId, body.architecture_id);

      // Validate by ROUND-TRIPPING through the generator's own parsers — the
      // exact hallucination guards (unknown relationship/table, columns not
      // on the entity, mismatched lists) and the exact proposal_key
      // derivation (fk--<relationship_id> / pk--<table lowercased>) the LLM
      // path uses, so manual and LLM rows are held to the SAME bar.
      const synthesized = JSON.stringify({
        proposals: [
          {
            ...payload,
            rationale: body.rationale ?? 'manually captured',
            // Human-authored: confidence is a review aid, not an inference
            // grade — a human asserting the fact is 'high' by definition.
            confidence: 'high',
          },
        ],
      });
      const parsed =
        body.kind === 'fk_join'
          ? parseFkProposals(synthesized, body.finding_key, model)
          : parsePkProposals(synthesized, body.finding_key, model);

      if (parsed.proposals.length === 0) {
        // Every drop reason is an honest validation failure (hallucinated
        // column, unknown/already-joined relationship, ...) -> caller error.
        res.status(400).json({
          error: {
            code: 400,
            message: 'payload_json failed validation against the committed model.',
            warnings: parsed.warnings,
          },
        });
        return;
      }

      const row = parsed.proposals[0];
      await upsertProposals(projectId, [row], 'manual');

      console.log(
        `[diag-gw] route=db-gap-proposals-manual status=200 key=${row.proposal_key} ` +
          `elapsed_ms=${Date.now() - start}`
      );
      res.status(200).json({ proposal: row, warnings: parsed.warnings });
    } catch (error) {
      console.warn(
        `[diag-gw] route=db-gap-proposals-manual status=err elapsed_ms=${Date.now() - start}`
      );
      mapError(error, res, 'manual', { projectId, findingKey: body.finding_key });
    }
  });

  return router;
}

/**
 * Build the MCP apply delta from a queue row's payload_json. Returns null on
 * a malformed payload (the review route reports that honestly as 422 instead
 * of forwarding garbage to the model-write owner).
 */
function buildApplyDelta(row: AmsGapProposalRow): Record<string, unknown> | null {
  const payload = row.payload_json ?? {};
  if (row.kind === 'fk_join') {
    const relationshipId = payload.relationship_id;
    const join = payload.join_columns;
    const referenced = payload.referenced_columns;
    if (
      typeof relationshipId !== 'string' ||
      !Array.isArray(join) ||
      !Array.isArray(referenced) ||
      join.length === 0 ||
      join.length !== referenced.length
    ) {
      return null;
    }
    return {
      kind: 'fk_join',
      relationship_id: relationshipId,
      fk_columns: {
        join_columns: join.map(String),
        referenced_columns: referenced.map(String),
        // Proposals never carry referential actions — explicit nulls so the
        // MCP-side additive write records "unspecified", not "absent".
        on_delete: null,
        on_update: null,
      },
    };
  }
  if (row.kind === 'primary_key') {
    const entityId = payload.entity_id;
    const columns = payload.columns;
    if (typeof entityId !== 'string' || !Array.isArray(columns) || columns.length === 0) {
      return null;
    }
    return { kind: 'primary_key', entity_id: entityId, columns: columns.map(String) };
  }
  return null;
}

/** Production router instance (default deps). */
export const dbGapProposalsRouter = createDbGapProposalsRouter();
