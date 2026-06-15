import { AnalyzerPack } from '../types';
import { stubAnalyzerPack } from './stubAnalyzerPack';
import { phase1aAnalyzerPack } from './phase1aAnalyzerPack';

/**
 * Analyzer Pack Registry
 *
 * Follows the gateway/src/services/contextResolvers.ts registry pattern.
 * Maintains an in-memory Map of analyzer packs keyed by their id.
 * Initialized at startup with the stub analyzer pack and the Phase 1a
 * universal extraction analyzer pack; additional packs can be registered
 * via registerAnalyzerPack().
 */

/**
 * In-memory registry mapping analyzer pack IDs to AnalyzerPack implementations.
 */
let analyzerRegistry: Map<string, AnalyzerPack> = new Map();

/**
 * Initializes the analyzer registry with built-in analyzer packs.
 * Creates a fresh Map and registers:
 * - stub-noop analyzer (used for other phases / testing)
 * - phase-1a-universal-extraction analyzer (Phase 1a extraction)
 */
export function initializeAnalyzerRegistry(): void {
  analyzerRegistry = new Map();

  // Register the stub/no-op analyzer pack
  analyzerRegistry.set(stubAnalyzerPack.id, stubAnalyzerPack);

  // Register the Phase 1a universal extraction analyzer pack
  analyzerRegistry.set(phase1aAnalyzerPack.id, phase1aAnalyzerPack);

  console.log(`[Discovery] Analyzer registry initialized with ${analyzerRegistry.size} packs`);
}

/**
 * Returns the analyzer registry.
 *
 * @returns Map of analyzer pack IDs to AnalyzerPack implementations
 */
export function getAnalyzerRegistry(): Map<string, AnalyzerPack> {
  return analyzerRegistry;
}

/**
 * Registers a new analyzer pack in the registry.
 *
 * @param pack - The analyzer pack to register
 */
export function registerAnalyzerPack(pack: AnalyzerPack): void {
  analyzerRegistry.set(pack.id, pack);
}
