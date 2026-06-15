import { Router, Request, Response } from 'express';
import { promises as fs } from 'fs';
import { archModelClient } from '../services/archModelClient';
import { parseLogContent } from '../services/logParsing';
import { runAllLogExtractors } from '../services/logExtractors';
import { executeStep1b, executeStepLlmAnalysis } from '../services/runManager';
import {
  LOG_MAX_CONTENT_SIZE_BYTES,
  LOG_MAX_LINE_COUNT,
} from '../constants/logEnrichmentDefaults';

/**
 * Batch size for bulk evidence persistence HTTP calls.
 * Matches the value used in runManager.ts for consistency.
 */
const BULK_SAVE_BATCH_SIZE = 500;

/**
 * Log Enrichment Route Handler
 *
 * Provides endpoints for log-based discovery enrichment:
 * - POST /  (mounted at /discovery/log-enrichment): Ingest log content,
 *   extract evidence atoms, and persist them.
 *
 * Spec: Log-based Discovery Enrichment (Increment 14)
 */
const logEnrichmentRouter = Router();

/**
 * Reprocess Route Handler
 *
 * Provides the reprocessing endpoint:
 * - POST /  (mounted at /discovery/reprocess): Trigger downstream
 *   reprocessing of steps 1b and 1c-llm-analysis in sequence.
 *
 * Pipeline note (2026-05-05): the original endpoint sequenced steps
 * 1b -> 1c (clustering) -> 1d (candidate generation). Steps 1c and 1d
 * were superseded by a single LLM-driven analysis step
 * (`executeStepLlmAnalysis`, current_step `1c-llm-analysis`) which
 * produces typed candidates directly from the cloned repo + atoms +
 * relationships. The reprocess flow now mirrors the live pipeline:
 * 1b followed by 1c-llm-analysis.
 */
const reprocessRouter = Router();

// =============================================================================
// POST /discovery/log-enrichment
// =============================================================================

/**
 * POST /
 *
 * Ingests log content into a completed discovery run.
 * Accepts { projectId, runId, logFilePath?, logContent? } in the request body.
 *
 * Validates:
 * - At least one of logFilePath or logContent is provided
 * - Content size does not exceed LOG_MAX_CONTENT_SIZE_BYTES
 * - Line count does not exceed LOG_MAX_LINE_COUNT
 * - Referenced run exists and is in COMPLETED status
 *
 * Orchestration:
 * - Read content (from logFilePath via fs.readFile or from logContent)
 * - Detect format and parse entries via parseLogContent
 * - Run all log extractors via runAllLogExtractors
 * - Persist atoms via archModelClient.bulkSaveEvidence in BULK_SAVE_BATCH_SIZE batches
 *
 * Returns summary: { atomsExtracted, atomsByType, formatDetected, linesProcessed }
 */
logEnrichmentRouter.post('/', async (req: Request, res: Response) => {
  const { projectId, runId, logFilePath, logContent } = req.body;

  // Validate required fields
  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    res.status(400).json({
      error: { code: 400, message: 'projectId is required' },
    });
    return;
  }

  if (!runId || typeof runId !== 'string' || runId.trim() === '') {
    res.status(400).json({
      error: { code: 400, message: 'runId is required' },
    });
    return;
  }

  // Validate at least one of logFilePath or logContent is provided
  if (!logFilePath && !logContent) {
    res.status(400).json({
      error: {
        code: 400,
        message: 'Either logFilePath or logContent must be provided',
      },
    });
    return;
  }

  // Resolve content: read from file path or use inline content
  let content: string;
  try {
    if (logContent) {
      content = logContent;
    } else {
      content = await fs.readFile(logFilePath, 'utf-8');
    }
  } catch (err: any) {
    res.status(400).json({
      error: {
        code: 400,
        message: `Failed to read log file: ${err?.message || String(err)}`,
      },
    });
    return;
  }

  // Validate content size
  const contentSizeBytes = Buffer.byteLength(content, 'utf-8');
  if (contentSizeBytes > LOG_MAX_CONTENT_SIZE_BYTES) {
    res.status(413).json({
      error: {
        code: 413,
        message: `Log content size (${contentSizeBytes} bytes) exceeds maximum allowed size (${LOG_MAX_CONTENT_SIZE_BYTES} bytes)`,
      },
    });
    return;
  }

  // Validate line count
  const lines = content.split('\n');
  if (lines.length > LOG_MAX_LINE_COUNT) {
    res.status(413).json({
      error: {
        code: 413,
        message: `Log content line count (${lines.length}) exceeds maximum allowed line count (${LOG_MAX_LINE_COUNT})`,
      },
    });
    return;
  }

  try {
    // Validate run exists and is in COMPLETED status
    const run = await archModelClient.getDiscoveryRun(projectId, runId);

    if (!run) {
      res.status(404).json({
        error: { code: 404, message: 'Discovery run not found' },
      });
      return;
    }

    if (run.status !== 'COMPLETED') {
      res.status(400).json({
        error: {
          code: 400,
          message: `Discovery run must be in COMPLETED status for log enrichment (current status: ${run.status})`,
        },
      });
      return;
    }

    // Parse log content: auto-detect format and produce ParsedLogEntry[]
    const { format, entries } = parseLogContent(content);

    // Extract the repoUrl from the run's config_snapshot
    const configSnapshot = (run.config_snapshot || {}) as Record<string, unknown>;
    const repoUrl = (configSnapshot.repoUrl as string) || '';
    const effectiveLogFilePath = logFilePath || 'inline-content';

    // Run all log extractors
    const atoms = runAllLogExtractors(entries, runId, repoUrl, effectiveLogFilePath);

    // Persist atoms in BULK_SAVE_BATCH_SIZE batches
    if (atoms.length > 0) {
      for (let i = 0; i < atoms.length; i += BULK_SAVE_BATCH_SIZE) {
        const batch = atoms.slice(i, i + BULK_SAVE_BATCH_SIZE);
        await archModelClient.bulkSaveEvidence(projectId, runId, batch);
      }
    }

    // Compute atomsByType summary
    const atomsByType: Record<string, number> = {};
    for (const atom of atoms) {
      const patternName =
        (atom.data as { patternName?: string }).patternName || atom.type;
      atomsByType[patternName] = (atomsByType[patternName] || 0) + 1;
    }

    // Return summary
    res.json({
      atomsExtracted: atoms.length,
      atomsByType,
      formatDetected: format,
      linesProcessed: entries.length,
    });
  } catch (error: any) {
    console.error('[log-enrichment] Error during log ingestion:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message: error?.response?.data?.message || error?.message || 'Failed to process log enrichment',
      },
    });
  }
});

// =============================================================================
// POST /discovery/reprocess
// =============================================================================

/**
 * POST /
 *
 * Triggers downstream reprocessing of steps 1b and 1c-llm-analysis in sequence
 * for a completed discovery run. Uses fire-and-forget pattern (matching startRun):
 * returns 202 Accepted immediately, processes in background.
 *
 * Accepts { projectId, runId } in the request body.
 *
 * Validates:
 * - Run exists (404 if not found)
 * - Run is in COMPLETED status (409 if RUNNING, 400 for other non-COMPLETED states)
 *
 * Background processing:
 * - Sets run status to RUNNING with current_step: '1b'
 * - Executes executeStep1b followed by executeStepLlmAnalysis
 *   (the latter, identified as `1c-llm-analysis` in current_step, replaces
 *   the legacy 1c clustering + 1d candidate generation steps)
 * - On success: sets status to COMPLETED with current_step: null
 * - On failure: sets status to FAILED with error_message
 */
reprocessRouter.post('/', async (req: Request, res: Response) => {
  const { projectId, runId } = req.body;

  // Validate required fields
  if (!projectId || typeof projectId !== 'string' || projectId.trim() === '') {
    res.status(400).json({
      error: { code: 400, message: 'projectId is required' },
    });
    return;
  }

  if (!runId || typeof runId !== 'string' || runId.trim() === '') {
    res.status(400).json({
      error: { code: 400, message: 'runId is required' },
    });
    return;
  }

  try {
    // Validate run exists
    const run = await archModelClient.getDiscoveryRun(projectId, runId);

    if (!run) {
      res.status(404).json({
        error: { code: 404, message: 'Discovery run not found' },
      });
      return;
    }

    // Validate run status
    if (run.status === 'RUNNING') {
      res.status(409).json({
        error: {
          code: 409,
          message: 'Discovery run is currently RUNNING and cannot be reprocessed',
        },
      });
      return;
    }

    if (run.status !== 'COMPLETED') {
      res.status(400).json({
        error: {
          code: 400,
          message: `Discovery run must be in COMPLETED status for reprocessing (current status: ${run.status})`,
        },
      });
      return;
    }

    // Fire-and-forget: kick off reprocessing asynchronously
    (async () => {
      try {
        // Set run status to RUNNING with current_step: '1b'
        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'RUNNING',
          current_step: '1b',
        });

        // Execute step 1b followed by 1c-llm-analysis (the latter replaces
        // the legacy 1c clustering + 1d candidate generation steps).
        await executeStep1b(projectId, runId);

        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'RUNNING',
          current_step: '1c-llm-analysis',
        });
        await executeStepLlmAnalysis(projectId, runId);

        // On success: set status to COMPLETED with current_step: null
        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'COMPLETED',
          current_step: null,
        });
      } catch (error) {
        // On failure: set status to FAILED with error_message
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[reprocess] Error reprocessing run ${runId} for project ${projectId}:`, errorMessage);

        await archModelClient.updateDiscoveryRun(projectId, runId, {
          status: 'FAILED',
          current_step: null,
          error_message: errorMessage,
        }).catch((updateErr) => {
          console.error(`[reprocess] Failed to update run status to FAILED:`, updateErr);
        });
      }
    })().catch((err) => {
      console.error(`[reprocess] Unhandled error in background reprocessing:`, err);
    });

    // Return 202 Accepted immediately
    res.status(202).json({
      status: 'accepted',
      message: 'Reprocessing started',
    });
  } catch (error: any) {
    console.error('[reprocess] Error initiating reprocessing:', error?.message || error);
    const statusCode = error?.response?.status || 500;
    res.status(statusCode).json({
      error: {
        code: statusCode,
        message: error?.response?.data?.message || error?.message || 'Failed to initiate reprocessing',
      },
    });
  }
});

export { logEnrichmentRouter, reprocessRouter };
