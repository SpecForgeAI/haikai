/**
 * Analyzer Pack Interface and Related Types
 *
 * Defines the extension-point contract for analyzer packs.
 * Each analyzer pack conforms to this interface and is registered
 * in the analyzer registry at startup.
 */

import { EvidenceAtom } from './evidenceAtom';
import { EvidenceRelationship } from './relationship';
import { EvidenceCluster } from './cluster';
import { DiscoveryCandidate } from './candidate';

/**
 * A single finding produced by an analyzer pack.
 */
export interface AnalyzerFinding {
  id: string;
  category: string;
  summary: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
}

/**
 * Input provided to an analyzer pack's analyze() method.
 */
export interface AnalyzerInput {
  projectId: string;
  phase: string;
  step: string;
  context: Record<string, unknown>;
}

/**
 * Result returned by an analyzer pack's analyze() method.
 *
 * The `findings` field carries traditional AnalyzerFinding items.
 * The optional `evidenceAtoms` field carries structured evidence atoms
 * produced by extraction-based analyzer packs (e.g., Phase 1a).
 *
 * The optional `relationships`, `clusters`, and `candidates` fields
 * carry outputs from later pipeline layers:
 * - `relationships` (1b): inferred connections between evidence atoms
 * - `clusters` (1c): groups of related atoms and relationships
 * - `candidates` (1d): synthesized meta-model element proposals
 *
 * These extensions are backward-compatible -- packs that do not produce
 * outputs for a given layer simply omit the corresponding field.
 */
export interface AnalyzerResult {
  analyzerId: string;
  phase: string;
  step: string;
  findings: AnalyzerFinding[];
  metadata: Record<string, unknown>;
  evidenceAtoms?: EvidenceAtom[];
  relationships?: EvidenceRelationship[];
  clusters?: EvidenceCluster[];
  candidates?: DiscoveryCandidate[];
}

/**
 * Analyzer pack extension-point interface.
 *
 * Each analyzer pack provides metadata (id, name, description, supportedPhases)
 * and an analyze() method that accepts an AnalyzerInput and returns an AnalyzerResult.
 */
export interface AnalyzerPack {
  id: string;
  name: string;
  description: string;
  supportedPhases: string[];
  analyze(input: AnalyzerInput): Promise<AnalyzerResult>;
}
