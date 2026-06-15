/**
 * LLM Fixture Replay / Live / Record strategy — Task Group 3.
 *
 * Spec: `agent-os/specs/2026-04-19-v3-evaluation-harness`.
 *
 * This module supplies the three LLM-stage strategies the evaluation harness
 * can install around each fixture's pipeline invocation:
 *
 *   - `'replay'` (default) — load a recorded `<case>.llm-response.json` from
 *     `discovery-service/evaluation/llm-fixtures/<framework>/` and return its
 *     `response` body whenever the pipeline calls `gatewayClient.gapFill`.
 *     Supports either a single recorded response OR an array of recorded
 *     responses (FIFO) for fixtures that trigger multiple gap-fill calls.
 *
 *   - `'live'` — do not intercept. The pipeline calls the real
 *     `gatewayClient.gapFill` and the network travels to the gateway. Useful
 *     for prompt iteration and for `--live --record` regeneration runs.
 *
 *   - `'record'` — pass through to the real `gatewayClient.gapFill`, capture
 *     each `(request, response)` pair, and on `session.end()` persist the
 *     capture to the fixture's `llmFixturePath`. Used only when
 *     `--live --record` is passed on the CLI.
 *
 * -------------------------------------------------------------------------
 * Injection technique
 * -------------------------------------------------------------------------
 *
 * `gatewayClient` in `src/services/gatewayClient.ts` is exported as a
 * singleton instance: `export const gatewayClient = new GatewayClient()`.
 * `gapFill` is a method on the prototype. Assigning a fresh function to
 * `gatewayClient.gapFill` creates an own-property override that shadows the
 * prototype method — exactly the same mechanism the existing test suites
 * (`llmGapFillStep.test.ts`, `gatewayClientGapFill.test.ts`, etc.) rely on
 * when they swap the method via `jest.mock` or `jest.spyOn`.
 *
 * Because the pipeline resolves `gatewayClient.gapFill` at CALL time (not at
 * import time), the runtime swap is picked up as long as the patch is
 * installed before the pipeline invocation begins. `beginFixture` installs
 * the patch; `session.end()` restores the original method in a finally-safe
 * way.
 *
 * We intentionally do NOT use `jest.spyOn` here. This module runs under the
 * Jest test harness AND under `npx tsx scripts/run-evaluation.ts`, where Jest
 * globals are absent. Plain property assignment works in both contexts.
 *
 * -------------------------------------------------------------------------
 * Recorded-fixture file format
 * -------------------------------------------------------------------------
 *
 * `evaluation/llm-fixtures/<framework>/<case>.llm-response.json` is a JSON
 * file with the following shape:
 *
 *   {
 *     "capturedAt": "2026-04-19T...",
 *     "request":  { "prompt": "...", "filePath": "...", "runId": "..." },
 *     "response": { "content": "..." }
 *   }
 *
 * For fixtures that trigger multiple gap-fill calls (e.g. pipelines that
 * process more than one file), the file may instead contain an array of
 * records. The replay session feeds them out in FIFO order.
 *
 * -------------------------------------------------------------------------
 * Missing-fixture behaviour
 * -------------------------------------------------------------------------
 *
 * Per spec: "Missing replay fixtures fail the run with a clear 'regenerate
 * via `--live --record`' message rather than silently skipping." Replay-mode
 * `beginFixture` DOES NOT pre-load or validate the file — the absence of a
 * file is only an error if the pipeline actually attempts a gap-fill call.
 * When it does, we throw an `Error` with the actionable message. A fixture
 * whose pipeline never reaches the gap-fill stage (e.g. because the pack
 * already produced enough candidates and the skip heuristic short-circuits)
 * runs successfully without a recorded fixture on disk.
 */

import * as fs from 'fs';
import * as path from 'path';

import { gatewayClient, type GapFillResponse } from '../services/gatewayClient';

import type {
  FixtureCase,
  LlmFixtureSession,
  LlmFixtureStrategy,
  LlmMode,
} from './types';

// ---------------------------------------------------------------------------
// Recorded-fixture file format.
// ---------------------------------------------------------------------------

/**
 * The JSON shape written to `evaluation/llm-fixtures/<framework>/<case>.llm-response.json`.
 *
 * The runner may persist either a single record (single gap-fill call) or an
 * array of records (multiple gap-fill calls per fixture, FIFO-replayed).
 */
export interface RecordedLlmCall {
  capturedAt: string;
  request: {
    prompt: string;
    filePath: string;
    runId: string;
  };
  response: GapFillResponse;
}

/**
 * Canonical on-disk payload: either a single record or an array of records.
 *
 * Both shapes are accepted by the replay loader — the array form is the
 * general case and the single-record form is syntactic sugar for fixtures
 * that only trigger one gap-fill call.
 */
export type RecordedLlmFixturePayload = RecordedLlmCall | RecordedLlmCall[];

// ---------------------------------------------------------------------------
// Factory.
// ---------------------------------------------------------------------------

/**
 * Build a strategy for the requested mode.
 *
 * The runner calls this once before the evaluation loop begins. Each
 * strategy returns a per-fixture session (installed + restored around the
 * pipeline invocation) so cross-fixture state never leaks.
 */
export function createLlmStrategy(mode: LlmMode): LlmFixtureStrategy {
  switch (mode) {
    case 'replay':
      return new ReplayStrategy();
    case 'live':
      return new LiveStrategy();
    case 'record':
      return new RecordStrategy();
    default: {
      // Exhaustiveness guard; TypeScript catches missing cases at compile time.
      const exhaustive: never = mode;
      throw new Error(`[evaluation] unknown LLM mode: ${String(exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers.
// ---------------------------------------------------------------------------

/**
 * The original prototype `gapFill` method. Captured once at module-load so we
 * can always restore to the genuine implementation even if previous sessions
 * left an override in place (e.g. after a crash in a test).
 */
type GapFillFn = (
  prompt: string,
  filePath: string,
  runId: string,
) => Promise<GapFillResponse>;

const ORIGINAL_GAP_FILL: GapFillFn = gatewayClient.gapFill.bind(gatewayClient);

/**
 * Install `replacement` as the current `gatewayClient.gapFill` and return a
 * restorer that puts back the previous value. We remember the previous value
 * (not just the prototype original) so nested / chained patches behave.
 */
function patchGapFill(replacement: GapFillFn): () => void {
  const previous = gatewayClient.gapFill.bind(gatewayClient);
  (gatewayClient as { gapFill: GapFillFn }).gapFill = replacement;
  return () => {
    (gatewayClient as { gapFill: GapFillFn }).gapFill = previous;
  };
}

/**
 * Load and parse a recorded LLM fixture file.
 *
 * Returns a FIFO queue of records. The caller checks `queue.length === 0`
 * and throws the "regenerate via --live --record" error only when a
 * gap-fill call actually demands a record.
 */
function loadRecordedFixture(filePath: string): RecordedLlmCall[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed: unknown = JSON.parse(raw);
  if (Array.isArray(parsed)) return parsed as RecordedLlmCall[];
  return [parsed as RecordedLlmCall];
}

// ---------------------------------------------------------------------------
// ReplayStrategy — the default.
// ---------------------------------------------------------------------------

class ReplayStrategy implements LlmFixtureStrategy {
  readonly mode: LlmMode = 'replay';

  async beginFixture(fixture: FixtureCase): Promise<LlmFixtureSession> {
    // Lazily load the recorded fixture; absence is tolerated at install time
    // and only becomes an error if the pipeline actually calls `gapFill`.
    const queue = loadRecordedFixture(fixture.llmFixturePath);
    const fixtureExists = queue.length > 0;

    const replay: GapFillFn = async (prompt, filePath, runId) => {
      if (!fixtureExists || queue.length === 0) {
        throw new Error(
          `[evaluation] no recorded LLM fixture for ${fixture.frameworkId}/${fixture.caseId} ` +
            `at ${fixture.llmFixturePath}. Regenerate via ` +
            `\`npx tsx scripts/run-evaluation.ts --framework ${fixture.frameworkId} --live --record\`.`,
        );
      }
      // FIFO: consume one recorded response per gap-fill call.
      const next = queue.shift() as RecordedLlmCall;
      // We intentionally ignore `prompt`/`filePath`/`runId` mismatch here —
      // the recorded fixture was captured against the same fixture source
      // and re-matching against mutating prompts would make the replay
      // layer brittle under prompt iteration. The caller-side schema
      // validation still runs on the returned `content`.
      void prompt;
      void filePath;
      void runId;
      return next.response;
    };

    const restore = patchGapFill(replay);
    return {
      async end() {
        restore();
      },
    };
  }
}

// ---------------------------------------------------------------------------
// LiveStrategy — pass-through to the real gateway.
// ---------------------------------------------------------------------------

class LiveStrategy implements LlmFixtureStrategy {
  readonly mode: LlmMode = 'live';

  async beginFixture(_fixture: FixtureCase): Promise<LlmFixtureSession> {
    // No patching. We deliberately reassert the original method so that a
    // previous session that failed to restore (e.g. mid-pipeline crash)
    // can't leave a stale replay in place for the live run.
    const restore = patchGapFill(ORIGINAL_GAP_FILL);
    return {
      async end() {
        restore();
      },
    };
  }
}

// ---------------------------------------------------------------------------
// RecordStrategy — pass-through + on-disk capture.
// ---------------------------------------------------------------------------

class RecordStrategy implements LlmFixtureStrategy {
  readonly mode: LlmMode = 'record';

  async beginFixture(fixture: FixtureCase): Promise<LlmFixtureSession> {
    const captured: RecordedLlmCall[] = [];

    const recordingWrapper: GapFillFn = async (prompt, filePath, runId) => {
      const response = await ORIGINAL_GAP_FILL(prompt, filePath, runId);
      captured.push({
        capturedAt: new Date().toISOString(),
        request: { prompt, filePath, runId },
        response,
      });
      return response;
    };

    const restore = patchGapFill(recordingWrapper);

    return {
      async end() {
        try {
          if (captured.length === 0) {
            // Nothing captured — likely the pipeline skipped the gap-fill
            // stage for this fixture (e.g. high-confidence pack output).
            // Don't write an empty file; the operator can re-run with a
            // different fixture if they expected a call.
            return;
          }
          const outPath = fixture.llmFixturePath;
          await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
          // Write a single record as an object (not an array) when there was
          // exactly one call; otherwise write the full array. Both shapes
          // are accepted by the replay loader.
          const payload: RecordedLlmFixturePayload =
            captured.length === 1 ? captured[0] : captured;
          await fs.promises.writeFile(
            outPath,
            JSON.stringify(payload, null, 2),
            'utf-8',
          );
        } finally {
          restore();
        }
      },
    };
  }
}
