/**
 * CLI: score a discovery run by ID.
 *
 * Spec: Discovery Performance Scoring (2026-04-25), Phase 1.
 *
 * Usage:
 *   npx tsx scripts/score-discovery-run.ts <projectId> <runId>
 *
 * The CLI invokes the same `performancePostRun.scoreRun` entry point
 * the auto-trigger uses, so manual scoring and auto-scoring produce
 * identical artifacts.
 *
 * Exit codes:
 *   0 — scored successfully (or skipped because zero candidates)
 *   1 — scoring failed (LLM call failed, file write failed, etc.)
 *   2 — usage error (missing args)
 */

import { scoreRun } from '../src/services/performancePostRun';

async function main(): Promise<void> {
  const [projectId, runId] = process.argv.slice(2);
  if (!projectId || !runId) {
    console.error(
      'Usage: npx tsx scripts/score-discovery-run.ts <projectId> <runId>',
    );
    process.exit(2);
  }

  console.log(`Scoring run ${runId} (project ${projectId})...`);
  const result = await scoreRun({ projectId, runId });

  console.log('\n=== Result ===');
  console.log(`Status: ${result.status}`);
  if (result.score) {
    console.log(`Overall: ${result.score.overall.toFixed(1)} / 5.0`);
    console.log(`Confidence: ${result.score.confidence}`);
    console.log(`Pack: ${result.score.packCombo.language} / ${result.score.packCombo.frameworks.join(', ')}`);
    console.log(`Promoted to golden: ${result.promotedToGolden ? 'yes' : 'no'}`);
  }
  if (result.perRunPath) {
    console.log(`Per-run MD: ${result.perRunPath}`);
  }
  if (result.reason) {
    console.log(`Reason: ${result.reason}`);
  }

  process.exit(result.status === 'failed' ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
