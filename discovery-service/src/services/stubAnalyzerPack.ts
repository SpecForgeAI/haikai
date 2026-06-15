import { AnalyzerPack, AnalyzerInput, AnalyzerResult } from '../types';

/**
 * Stub No-Op Analyzer Pack
 *
 * Reference stub implementation for analyzer packs. Implements the AnalyzerPack
 * interface with no-op behavior -- returns empty findings and stub metadata.
 * Serves as the template for future real analyzer pack implementations.
 */
export const stubAnalyzerPack: AnalyzerPack = {
  id: 'stub-noop',
  name: 'Stub No-Op Analyzer',
  description: 'Reference stub implementation for analyzer packs',
  supportedPhases: ['phase0', 'phase1'],

  async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
    return {
      analyzerId: 'stub-noop',
      phase: input.phase,
      step: input.step,
      findings: [],
      metadata: { stub: true },
    };
  },
};
