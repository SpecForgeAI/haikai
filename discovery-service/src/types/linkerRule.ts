/**
 * Linker Rule and Candidate Relationship Types (Phase 1b)
 *
 * Defines the LinkerRule interface and the CandidateRelationship interface
 * used during Phase 1b relationship inference.
 *
 * Data flow position: 1a atoms -> **1b linker rules produce candidates** -> triage -> relationships/DecisionTasks
 *
 * LinkerRule is the extension-point contract for deterministic linking rules.
 * Each rule pattern-matches evidence atoms and produces candidate relationships
 * with confidence scores. CandidateRelationship is internal to the
 * discovery-service -- never persisted directly; it is converted to either
 * an EvidenceRelationship (accepted) or a DecisionTask (ambiguous).
 */

import { EvidenceAtom } from './evidenceAtom';
import { RelationshipType, RelationshipData } from './relationship';

/**
 * A candidate relationship proposed by a linker rule.
 *
 * Internal to discovery-service -- not persisted to the database.
 * Exists only during the triage phase and is converted to either
 * an EvidenceRelationship (if accepted) or a DecisionTask (if ambiguous).
 */
export interface CandidateRelationship {
  /** ID of the source evidence atom */
  sourceAtomId: string;

  /** ID of the target evidence atom */
  targetAtomId: string;

  /** The type of relationship being proposed */
  relationshipType: RelationshipType;

  /** Confidence score from 0.0 (lowest) to 1.0 (highest) */
  confidence: number;

  /** Type-specific relationship data payload */
  data: RelationshipData;

  /** ID of the linker rule that produced this candidate (for traceability) */
  ruleId: string;
}

/**
 * Linker Rule extension-point interface.
 *
 * Each linker rule provides metadata (id, name, description,
 * targetRelationshipType) and a match() method that accepts the full
 * set of 1a evidence atoms and returns candidate relationships with
 * confidence scores.
 *
 * Rules are registered in the linker rule registry at startup and
 * invoked during Phase 1b execution.
 */
export interface LinkerRule {
  /** Unique rule identifier (e.g., 'contains-by-path', 'imports-by-pattern') */
  id: string;

  /** Human-readable name */
  name: string;

  /** Description of what the rule detects */
  description: string;

  /** Which relationship type this rule produces */
  targetRelationshipType: RelationshipType;

  /**
   * Pattern-matches evidence atoms and returns candidate relationships.
   *
   * @param atoms - The full set of Phase 1a evidence atoms for the run
   * @returns Array of candidate relationships with confidence scores
   */
  match(atoms: EvidenceAtom[]): CandidateRelationship[];
}
