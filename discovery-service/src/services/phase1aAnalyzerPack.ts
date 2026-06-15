import { AnalyzerPack, AnalyzerInput, AnalyzerResult } from '../types';
import { EvidenceAtom } from '../types/evidenceAtom';
import { extractFileStructure } from './extractors/fileStructureExtractor';
import { extractSymbols } from './extractors/symbolExtractor';
import { extractStringPatterns } from './extractors/stringPatternExtractor';
import { gitCloneRepoAccess, buildTempDir, RepoAccessProvider } from './repoAccess';

/**
 * Phase 1a Universal Extraction Analyzer Pack
 *
 * Orchestrates the three sub-extractors (file structure, symbol, string pattern)
 * across all repositories configured in Phase 0. For each repo:
 *   1. Clone via RepoAccessProvider
 *   2. Run all three sub-extractors
 *   3. Collect evidence atoms
 *   4. Cleanup the cloned directory
 *
 * Returns an AnalyzerResult with collected atoms on the `evidenceAtoms` field
 * and atom counts by type in the metadata.
 *
 * Error handling: if clone fails for a repo, logs the error, marks the repo
 * as failed in metadata, and continues with remaining repos.
 */

/**
 * Shape of a repo entry from the Phase 0 config snapshot.
 */
interface RepoConfig {
  url: string;
  branch?: string;
}

/**
 * Repo access provider used by the analyzer pack.
 * Exported for test overriding.
 */
export let repoAccessProvider: RepoAccessProvider = gitCloneRepoAccess;

/**
 * Allows tests to inject a mock repo access provider.
 */
export function setRepoAccessProvider(provider: RepoAccessProvider): void {
  repoAccessProvider = provider;
}

export const phase1aAnalyzerPack: AnalyzerPack = {
  id: 'phase-1a-universal-extraction',
  name: 'Phase 1a Universal Extraction',
  description: 'Extracts file structure, symbols, and string patterns from configured repositories',
  supportedPhases: ['phase1'],

  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    const configSnapshot = input.context as Record<string, unknown>;
    const repos = (configSnapshot.repos || []) as RepoConfig[];
    const includePaths = configSnapshot.includePaths as string[] | undefined;
    const excludePaths = configSnapshot.excludePaths as string[] | undefined;
    const runId = (configSnapshot.runId as string) || 'unknown';

    const allAtoms: EvidenceAtom[] = [];
    const failedRepos: string[] = [];

    for (const repo of repos) {
      const repoUrl = repo.url;
      const branch = repo.branch || 'main';
      const targetDir = buildTempDir(runId, repoUrl);

      try {
        // Clone the repository
        await repoAccessProvider.cloneRepo(repoUrl, branch, targetDir);

        // Run all three sub-extractors in parallel
        const [fileStructureAtoms, symbolAtoms, stringPatternAtoms] = await Promise.all([
          extractFileStructure({
            repoDir: targetDir,
            runId,
            repoUrl,
            includePaths,
            excludePaths,
          }),
          extractSymbols({
            repoDir: targetDir,
            runId,
            repoUrl,
          }),
          extractStringPatterns({
            repoDir: targetDir,
            runId,
            repoUrl,
            includePaths,
            excludePaths,
          }),
        ]);

        allAtoms.push(...fileStructureAtoms, ...symbolAtoms, ...stringPatternAtoms);
      } catch (error) {
        console.error(
          `[Phase1aAnalyzerPack] Failed to process repo ${repoUrl}:`,
          error instanceof Error ? error.message : String(error)
        );
        failedRepos.push(repoUrl);
      } finally {
        // Always attempt cleanup
        try {
          await repoAccessProvider.cleanup(targetDir);
        } catch (cleanupError) {
          console.warn(
            `[Phase1aAnalyzerPack] Failed to clean up ${targetDir}:`,
            cleanupError
          );
        }
      }
    }

    // Calculate atom counts by type
    const atomCounts: Record<string, number> = {
      file_structure: 0,
      symbol: 0,
      string_pattern: 0,
    };
    for (const atom of allAtoms) {
      atomCounts[atom.type] = (atomCounts[atom.type] || 0) + 1;
    }

    return {
      analyzerId: 'phase-1a-universal-extraction',
      phase: input.phase,
      step: input.step,
      findings: [],
      evidenceAtoms: allAtoms,
      metadata: {
        atomCounts,
        totalAtoms: allAtoms.length,
        reposProcessed: repos.length - failedRepos.length,
        reposFailed: failedRepos.length,
        failedRepos: failedRepos.length > 0 ? failedRepos : undefined,
      },
    };
  },
};
