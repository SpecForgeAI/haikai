/**
 * Cost-preview calculator for the Migration Shape-Spec Batch Generation flow.
 *
 * Spec: 2026-05-20 Cross-Story Context Injection -- Task Group 6
 *
 * The cost-preview endpoint (`POST /api/migration-shape-spec/cost-preview`)
 * reads the existing book-of-work shape and the per-project shape-spec
 * configuration (`per_story_context_token_cap`, `cross_story_context_token_cap`,
 * `auto_run_pass_2`) and returns:
 *
 *   - `estimatedTokens` -- the total tokens we expect the batch to consume,
 *     summed across every saved story in the book of work
 *   - `estimatedWallClockSeconds` -- the wall-clock estimate derived from a
 *     configurable tokens-per-second rate (default 50 t/s)
 *   - `perStoryEstimates[]` -- one entry per story so the dialog can render
 *     a sorted-by-cost breakdown
 *
 * Cost model (deliberately a rough upper-bound -- the UI just needs a
 * defensible "are we burning a lot of tokens?" signal):
 *
 *   pass1PerStoryTokens = perStoryContextTokenCap + OUTPUT_BUFFER_TOKENS
 *   pass2PerStoryTokens = pass1PerStoryTokens + crossStoryContextTokenCap
 *
 *   includePass2 = false -> total = sum(pass1PerStoryTokens)
 *   includePass2 = true  -> total = sum(pass1PerStoryTokens + pass2PerStoryTokens)
 *                         = sum(pass1) + sum(pass1 + crossStoryCap)
 *                         ~= 2 * sum(pass1) + storyCount * crossStoryCap
 *
 *  This is the basis for the "roughly doubles" guard documented in the spec.
 *
 * The service is BFF-style: it never mutates state, only reads. Production
 * wiring loads the book of work via the same AMS endpoint the batch handler
 * uses; tests inject a synthetic loader.
 */

import { getConfig } from '../config';
import {
  fetchProjectConfigWithDefaults as defaultFetchProjectConfigWithDefaults,
  DEFAULT_PER_STORY_TOKEN_CAP,
  DEFAULT_CROSS_STORY_TOKEN_CAP,
  DEFAULT_AUTO_RUN_PASS_2,
} from './architectureModelClient';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CostPreviewRequest {
  projectId: string;
  bookOfWorkId: string;
  /**
   * When omitted, defaults to the project's `auto_run_pass_2` setting (true
   * by default per Task Group 9). The per-batch toggle in the UI overrides
   * this by sending an explicit boolean.
   */
  includePass2?: boolean;
  /**
   * Optional override for the tokens-per-second model. When omitted, reads
   * the env var `SHAPE_SPEC_TOKENS_PER_SECOND` and falls back to
   * {@link DEFAULT_TOKENS_PER_SECOND}.
   */
  tokensPerSecond?: number;
}

export interface PerStoryCostEstimate {
  workItemId: string;
  bookItemId: string;
  title: string;
  /** Pass-1 prompt + output upper-bound for this story. */
  pass1EstimatedTokens: number;
  /** Pass-2 prompt + output upper-bound for this story. 0 when includePass2 is false. */
  pass2EstimatedTokens: number;
  /** Sum of pass-1 + pass-2 tokens, the per-story contribution to the batch total. */
  totalEstimatedTokens: number;
}

export interface CostPreviewResponse {
  /** Sum of every per-story estimate. */
  estimatedTokens: number;
  /** estimatedTokens / tokensPerSecond, rounded to one decimal place. */
  estimatedWallClockSeconds: number;
  perStoryEstimates: PerStoryCostEstimate[];
  /** Echoed back so the UI can show the actual model that was applied. */
  meta: {
    storyCount: number;
    includePass2: boolean;
    perStoryContextTokenCap: number;
    crossStoryContextTokenCap: number;
    tokensPerSecond: number;
    outputBufferTokens: number;
  };
}

/**
 * Story-shaped loader output -- the minimum shape required to estimate cost
 * per story. The default production wiring uses the same AMS endpoint the
 * batch handler reads from; tests inject a synthetic loader.
 */
export interface CostPreviewStory {
  workItemId: string;
  bookItemId: string;
  title: string;
}

export type CostPreviewStoryLoader = (
  projectId: string,
  bookOfWorkId: string
) => Promise<CostPreviewStory[]>;

export type CostPreviewProjectConfigFetcher = (
  projectId: string
) => Promise<{
  perStoryContextTokenCap: number;
  crossStoryContextTokenCap: number;
  autoRunPass2: boolean;
}>;

export interface CostPreviewDeps {
  loadStories?: CostPreviewStoryLoader;
  fetchProjectConfig?: CostPreviewProjectConfigFetcher;
}

// ---------------------------------------------------------------------------
// Tunable constants
// ---------------------------------------------------------------------------

/**
 * Output-side per-story token buffer added on top of the per-story context
 * cap. Represents the spec body the LLM emits plus the structured response
 * envelope. Configurable via env var `SHAPE_SPEC_OUTPUT_TOKENS` for tuning.
 */
export const DEFAULT_OUTPUT_TOKENS_PER_STORY = 4000;

/**
 * Default tokens-per-second throughput for the wall-clock estimate. Mirrors
 * a conservative per-batch budget (single-tenant LLM endpoint, JSON-mode
 * output). Override via env var `SHAPE_SPEC_TOKENS_PER_SECOND`.
 */
export const DEFAULT_TOKENS_PER_SECOND = 50;

function resolveOutputBufferTokens(): number {
  const env = process.env.SHAPE_SPEC_OUTPUT_TOKENS;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_OUTPUT_TOKENS_PER_STORY;
}

function resolveTokensPerSecond(override?: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return override;
  }
  const env = process.env.SHAPE_SPEC_TOKENS_PER_SECOND;
  if (env) {
    const parsed = Number(env);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TOKENS_PER_SECOND;
}

// ---------------------------------------------------------------------------
// Default production wiring -- reads the book of work directly from AMS so we
// do NOT incur an LLM round-trip just to count stories.
// ---------------------------------------------------------------------------

const defaultLoadStories: CostPreviewStoryLoader = async (
  projectId,
  bookOfWorkId
) => {
  const baseUrl = getConfig().architectureModelServiceBaseUrl;
  const url = `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/migration-books-of-work/${encodeURIComponent(bookOfWorkId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `AMS GET /migration-books-of-work/${bookOfWorkId} returned ${response.status}: ${
        text || '<empty body>'
      }`
    );
  }
  const dto = (await response.json()) as {
    book_of_work_json?: { items?: unknown[] } | null;
  };
  const rawItems = (dto.book_of_work_json?.items as unknown[]) || [];
  const stories: CostPreviewStory[] = [];
  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    if (obj.type !== 'story') continue;
    const workItemId = typeof obj.workItemId === 'string' ? obj.workItemId : null;
    if (!workItemId) continue;
    stories.push({
      workItemId,
      bookItemId: typeof obj.id === 'string' ? obj.id : '',
      title: typeof obj.title === 'string' ? obj.title : '',
    });
  }
  return stories;
};

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Compute the cost-preview for a migration shape-spec batch. Pure-ish:
 * reads the book of work + per-project config, returns an estimate. Never
 * mutates state.
 *
 * The wall-clock estimate is intentionally a rough upper-bound; the UI's
 * goal is to surface "are we burning a lot of tokens?" -- not to predict
 * the LLM run-time exactly.
 *
 * `includePass2` -- when omitted, defaults to the project's
 * `auto_run_pass_2` flag so the dialog matches the actual batch posture
 * without the caller having to know the project setting.
 */
export async function computeCostPreview(
  request: CostPreviewRequest,
  deps: CostPreviewDeps = {}
): Promise<CostPreviewResponse> {
  if (!request.projectId || typeof request.projectId !== 'string') {
    throw new Error('cost-preview: projectId is required');
  }
  if (!request.bookOfWorkId || typeof request.bookOfWorkId !== 'string') {
    throw new Error('cost-preview: bookOfWorkId is required');
  }

  const loadStories = deps.loadStories ?? defaultLoadStories;
  const fetchProjectConfig =
    deps.fetchProjectConfig ?? defaultFetchProjectConfigWithDefaults;

  // Load project config first -- determines the budget caps + the
  // includePass2 default. Failure to load falls back to constants so the
  // preview is never blocked on a transient AMS hiccup.
  let cfg: {
    perStoryContextTokenCap: number;
    crossStoryContextTokenCap: number;
    autoRunPass2: boolean;
  };
  try {
    cfg = await fetchProjectConfig(request.projectId);
  } catch {
    cfg = {
      perStoryContextTokenCap: DEFAULT_PER_STORY_TOKEN_CAP,
      crossStoryContextTokenCap: DEFAULT_CROSS_STORY_TOKEN_CAP,
      autoRunPass2: DEFAULT_AUTO_RUN_PASS_2,
    };
  }

  const includePass2 =
    typeof request.includePass2 === 'boolean'
      ? request.includePass2
      : cfg.autoRunPass2;
  const tokensPerSecond = resolveTokensPerSecond(request.tokensPerSecond);
  const outputBufferTokens = resolveOutputBufferTokens();

  const stories = await loadStories(request.projectId, request.bookOfWorkId);

  const pass1PerStoryTokens =
    cfg.perStoryContextTokenCap + outputBufferTokens;
  const pass2PerStoryTokens =
    pass1PerStoryTokens + cfg.crossStoryContextTokenCap;

  const perStoryEstimates: PerStoryCostEstimate[] = stories.map((s) => {
    const pass2 = includePass2 ? pass2PerStoryTokens : 0;
    return {
      workItemId: s.workItemId,
      bookItemId: s.bookItemId,
      title: s.title,
      pass1EstimatedTokens: pass1PerStoryTokens,
      pass2EstimatedTokens: pass2,
      totalEstimatedTokens: pass1PerStoryTokens + pass2,
    };
  });

  const estimatedTokens = perStoryEstimates.reduce(
    (acc, e) => acc + e.totalEstimatedTokens,
    0
  );
  const estimatedWallClockSeconds =
    Math.round((estimatedTokens / tokensPerSecond) * 10) / 10;

  return {
    estimatedTokens,
    estimatedWallClockSeconds,
    perStoryEstimates,
    meta: {
      storyCount: stories.length,
      includePass2,
      perStoryContextTokenCap: cfg.perStoryContextTokenCap,
      crossStoryContextTokenCap: cfg.crossStoryContextTokenCap,
      tokensPerSecond,
      outputBufferTokens,
    },
  };
}
