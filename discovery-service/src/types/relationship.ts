/**
 * Relationship Evidence Types (Layer 1b)
 *
 * Defines the core relationship interface and type-specific data shapes
 * produced by Phase 1b relationship inference.
 *
 * Data flow position: 1a atoms -> **1b relationships** -> 1c clusters -> 1d candidates
 *
 * Each evidence relationship represents an inferred connection between two
 * Phase 1a evidence atoms. For example, "file X imports symbol Y" or
 * "service A calls service B". Relationships are inferred from the raw
 * evidence atoms and carry a confidence score indicating inference certainty.
 */

/**
 * The types of relationships that can be inferred between evidence atoms.
 *
 * - `imports`: One atom imports or depends on another (e.g., file imports a module)
 * - `calls`: One atom invokes functionality in another (e.g., function call across files)
 * - `extends`: One atom extends or inherits from another (e.g., class inheritance)
 * - `contains`: One atom structurally contains another (e.g., directory contains file)
 * - `uses_data`: One atom reads or writes data owned by another (e.g., service accesses a DB table)
 * - `defines`: One atom defines an interface, type, or contract used by another
 * - `references`: A general reference from one atom to another that does not fit the above categories
 */
export type RelationshipType =
  | 'imports'
  | 'calls'
  | 'extends'
  | 'contains'
  | 'uses_data'
  | 'defines'
  | 'references';

/**
 * Data payload for an `imports` relationship.
 * Captures details about an import/dependency between two atoms.
 */
export interface ImportsRelationshipData {
  importStatement: string;
  line: number;
  isDefault: boolean;
}

/**
 * Data payload for a `calls` relationship.
 * Captures details about a function or method invocation between two atoms.
 */
export interface CallsRelationshipData {
  callerSignature: string;
  calleeSignature: string;
  line: number;
}

/**
 * Data payload for an `extends` relationship.
 * Captures details about inheritance or extension between two atoms.
 */
export interface ExtendsRelationshipData {
  parentName: string;
  childName: string;
  mechanism: string;
}

/**
 * Data payload for a `contains` relationship.
 * Captures structural containment details between two atoms.
 */
export interface ContainsRelationshipData {
  containerPath: string;
  containedPath: string;
}

/**
 * Data payload for a `uses_data` relationship.
 * Captures details about data access between two atoms.
 */
export interface UsesDataRelationshipData {
  accessType: string;
  dataIdentifier: string;
}

/**
 * Data payload for a `defines` relationship.
 * Captures details about a definition/contract between two atoms.
 */
export interface DefinesRelationshipData {
  definitionName: string;
  definitionKind: string;
}

/**
 * Data payload for a `references` relationship.
 * Captures general reference details between two atoms.
 */
export interface ReferencesRelationshipData {
  referenceContext: string;
  line: number;
}

/**
 * Union of all type-specific relationship data payloads.
 */
export type RelationshipData =
  | ImportsRelationshipData
  | CallsRelationshipData
  | ExtendsRelationshipData
  | ContainsRelationshipData
  | UsesDataRelationshipData
  | DefinesRelationshipData
  | ReferencesRelationshipData;

/**
 * Core evidence relationship interface (Layer 1b).
 *
 * Each relationship links a source evidence atom to a target evidence atom,
 * carries a type discriminator, a confidence score (0.0 to 1.0), and a
 * type-specific data payload with inference details.
 *
 * Persisted to the `discovery_relationship` table via the architecture-model-service.
 */
export interface EvidenceRelationship {
  id: string;
  runId: string;
  sourceAtomId: string;
  targetAtomId: string;
  relationshipType: RelationshipType;
  confidence: number;
  data: RelationshipData;
  inferredAt: string;
}
