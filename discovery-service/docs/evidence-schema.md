# Evidence Schema Reference

Internal developer documentation for the core data types produced by the
discovery pipeline: `EvidenceAtom`, `EvidenceRelationship`, `EvidenceCluster`,
and `DiscoveryCandidate`.

All types are defined in `discovery-service/src/types/` and exported via
the barrel file `discovery-service/src/types/index.ts`.

---

## EvidenceAtom

**File**: `discovery-service/src/types/evidenceAtom.ts`

**Data flow position**: Phase 1a output. Consumed by Phases 1b, 1c, and 1d.

Each evidence atom represents a single piece of language-agnostic evidence
extracted from a repository file. Atoms are the foundational building blocks
of the entire pipeline.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Deterministic SHA-256 hash. See [Stable ID Generation](#stable-id-generation-patterns). |
| `runId` | `string` | Yes | UUID of the discovery run that produced this atom. |
| `repoUrl` | `string` | Yes | Source repository URL. |
| `filePath` | `string` | Yes | Relative path within the repository. |
| `type` | `EvidenceAtomType` | Yes | Discriminator: `'file_structure'`, `'symbol'`, or `'string_pattern'`. |
| `data` | `EvidenceAtomData` | Yes | Type-specific payload (see below). |
| `extractedAt` | `string` | Yes | ISO 8601 timestamp of extraction. |
| `source` | `'code' \| 'log' \| 'human_qa'` | No | Origin of the atom. Defaults to `'code'` when absent. |
| `logOrigin` | `LogOrigin` | No | Present only when `source: 'log'`. Traceability to log file and line range. |
| `qaOrigin` | `QaOrigin` | No | Present only when `source: 'human_qa'`. Traceability to hypothesis and user verdict. |

### Type-Specific Data Payloads

#### `FileStructureData` (type: `'file_structure'`)

Produced by `discovery-service/src/services/extractors/fileStructureExtractor.ts`.

| Field | Type | Description |
|---|---|---|
| `relativePath` | `string` | File path relative to repository root |
| `extension` | `string` | File extension (e.g., `.ts`, `.java`) |
| `sizeBytes` | `number` | File size in bytes |
| `lineCount` | `number` | Number of lines in the file |

#### `SymbolData` (type: `'symbol'`)

Produced by `discovery-service/src/services/extractors/symbolExtractor.ts`.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Symbol name (class, function, variable, etc.) |
| `kind` | `string` | Symbol kind (e.g., `'class'`, `'function'`, `'interface'`) |
| `line` | `number` | Line number where the symbol is defined |
| `scope` | `string \| null` | Enclosing scope (e.g., parent class name), or `null` if top-level |
| `language` | `string` | Programming language of the source file |

#### `StringPatternData` (type: `'string_pattern'`)

Produced by `discovery-service/src/services/extractors/stringPatternExtractor.ts`.

| Field | Type | Description |
|---|---|---|
| `patternName` | `string` | Name of the matched pattern rule |
| `matchedText` | `string` | The text that matched the pattern |
| `line` | `number` | Line number of the match |
| `contextSnippet` | `string` | Surrounding code context for the match |

### Source Origin Metadata

#### `LogOrigin` (for `source: 'log'`)

| Field | Type | Required | Description |
|---|---|---|---|
| `filePath` | `string` | Yes | Path to the source log file |
| `lineStart` | `number` | Yes | Starting line number in the log file |
| `lineEnd` | `number` | Yes | Ending line number in the log file |
| `timestamp` | `string` | No | Timestamp from the log entry |
| `occurrenceCount` | `number` | No | Count when multiple log lines contribute to the same aggregated atom |

#### `QaOrigin` (for `source: 'human_qa'`)

| Field | Type | Required | Description |
|---|---|---|---|
| `hypothesisId` | `string` | Yes | ID of the hypothesis that was answered |
| `verdict` | `string` | Yes | User's verdict on the hypothesis |
| `freeTextNotes` | `string` | No | Optional free-text notes from the user |
| `answeredAt` | `string` | Yes | ISO 8601 timestamp when the answer was provided |

---

## EvidenceRelationship

**File**: `discovery-service/src/types/relationship.ts`

**Data flow position**: Phase 1b output. Consumed by Phases 1c and 1d.

Each evidence relationship represents an inferred connection between two
Phase 1a evidence atoms.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Deterministic SHA-256 hash. See [Stable ID Generation](#stable-id-generation-patterns). |
| `runId` | `string` | Yes | UUID of the discovery run. |
| `sourceAtomId` | `string` | Yes | ID of the source evidence atom. |
| `targetAtomId` | `string` | Yes | ID of the target evidence atom. |
| `relationshipType` | `RelationshipType` | Yes | Type discriminator (see below). |
| `confidence` | `number` | Yes | Confidence score from 0.0 to 1.0. |
| `data` | `RelationshipData` | Yes | Type-specific payload (see below). |
| `inferredAt` | `string` | Yes | ISO 8601 timestamp of inference. |

### RelationshipType Values

| Type | Description |
|---|---|
| `'imports'` | One atom imports or depends on another (e.g., file imports a module) |
| `'calls'` | One atom invokes functionality in another (e.g., function call across files) |
| `'extends'` | One atom extends or inherits from another (e.g., class inheritance) |
| `'contains'` | One atom structurally contains another (e.g., directory contains file) |
| `'uses_data'` | One atom reads or writes data owned by another (e.g., service accesses a DB table) |
| `'defines'` | One atom defines an interface, type, or contract used by another |
| `'references'` | A general reference that does not fit the above categories |

### Type-Specific Relationship Data Payloads

| Type | Interface | Fields |
|---|---|---|
| `imports` | `ImportsRelationshipData` | `importStatement: string`, `line: number`, `isDefault: boolean` |
| `calls` | `CallsRelationshipData` | `callerSignature: string`, `calleeSignature: string`, `line: number` |
| `extends` | `ExtendsRelationshipData` | `parentName: string`, `childName: string`, `mechanism: string` |
| `contains` | `ContainsRelationshipData` | `containerPath: string`, `containedPath: string` |
| `uses_data` | `UsesDataRelationshipData` | `accessType: string`, `dataIdentifier: string` |
| `defines` | `DefinesRelationshipData` | `definitionName: string`, `definitionKind: string` |
| `references` | `ReferencesRelationshipData` | `referenceContext: string`, `line: number` |

---

## EvidenceCluster

**File**: `discovery-service/src/types/cluster.ts`

**Data flow position**: Phase 1c output. Consumed by Phase 1d.

Each evidence cluster groups related atoms and/or relationships into a
coherent unit representing an architectural boundary.

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Deterministic SHA-256 hash. See [Stable ID Generation](#stable-id-generation-patterns). |
| `runId` | `string` | Yes | UUID of the discovery run. |
| `clusterType` | `ClusterType` | Yes | Architectural type of the cluster (see below). |
| `name` | `string` | No | Optional human-readable cluster name. |
| `confidence` | `number` | Yes | Confidence score from 0.0 to 1.0. |
| `members` | `ClusterMember[]` | Yes | Array of member references (atoms and/or relationships). |
| `data` | `Record<string, unknown>` | Yes | Metadata payload. |
| `formedAt` | `string` | Yes | ISO 8601 timestamp of cluster formation. |

### ClusterType Values

| Type | Description |
|---|---|
| `'service_boundary'` | Atoms and relationships forming a logical service |
| `'data_domain'` | Data-related atoms forming a coherent data domain |
| `'shared_library'` | Atoms representing shared/utility code |
| `'api_layer'` | Atoms and relationships forming an API surface |
| `'ui_module'` | Atoms forming a user interface module |
| `'package_module'` | Atoms forming a package or module boundary (e.g., directory-based grouping) |
| `'unknown'` | Cluster whose type could not be determined deterministically |

### ClusterMember

| Field | Type | Description |
|---|---|---|
| `memberType` | `ClusterMemberType` | `'atom'` or `'relationship'` |
| `memberId` | `string` | ID referencing the evidence atom or relationship |

Persistence: Clusters are stored in `discovery_cluster` with members in a
separate `discovery_cluster_member` table.

---

## DiscoveryCandidate

**File**: `discovery-service/src/types/candidate.ts`

**Data flow position**: Phase 1d output. Consumed by the review workflow
and save-back process.

Each discovery candidate represents a synthesized proposal that maps to a
meta-model element type (e.g., "this cluster is likely an Application named X").

### Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Deterministic SHA-256 hash. See [Stable ID Generation](#stable-id-generation-patterns). |
| `runId` | `string` | Yes | UUID of the discovery run. |
| `candidateType` | `CandidateType` | Yes | Meta-model element type (see below). |
| `name` | `string` | Yes | Proposed name for the candidate. |
| `confidence` | `number` | Yes | Confidence score from 0.0 to 1.0. |
| `status` | `CandidateStatus` | Yes | Lifecycle status (see below). |
| `sourceClusterIds` | `string[]` | Yes | IDs of the source clusters that contributed to this candidate. |
| `data` | `Record<string, unknown>` | Yes | Metadata payload with proposed properties and evidence summaries. |
| `synthesizedAt` | `string` | Yes | ISO 8601 timestamp of candidate synthesis. |
| `parentCandidateId` | `string` | No | ID of the parent candidate within the same run (hierarchical relationship). |
| `logEnrichment` | `LogEnrichmentMetadata` | No | Log enrichment metadata when source clusters contain log-derived atoms. |

### CandidateType Values

| Type | Description |
|---|---|
| `'application'` | A top-level application or system |
| `'app_component'` | A component within an application |
| `'service'` | A service (microservice, API service, background job, etc.) |
| `'logical_entity'` | A logical data entity or concept |
| `'physical_entity'` | A physical data store or table |
| `'interface'` | An API interface, protocol, or contract |
| `'business_process'` | A business process or workflow |
| `'data_entity'` | A data entity in the architecture model |

### CandidateStatus Values

| Status | Description |
|---|---|
| `'proposed'` | Initial status; candidate awaits review |
| `'pending_review'` | Pending user review (equivalent to `proposed` for review purposes) |
| `'accepted'` | Reviewed and accepted into the model |
| `'rejected'` | Reviewed and rejected |
| `'merged'` | Merged with another candidate |
| `'deferred'` | Review deferred to a later time (run-scoped, does not carry forward) |
| `'committed'` | Promoted to the canonical model via save-back |

### LogEnrichmentMetadata

| Field | Type | Description |
|---|---|---|
| `enriched` | `boolean` | Whether log-derived evidence contributed to this candidate |
| `logAtomCount` | `number` | Count of atoms with `source: 'log'` in the candidate's source clusters |
| `signalSummary` | `string` | Human-readable summary of log signal contributions |

---

## Stable ID Generation Patterns

All four entity types use deterministic SHA-256 hashing for stable,
idempotent IDs. Defined in `discovery-service/src/utils/evidenceId.ts`.

### `generateEvidenceId`

```typescript
generateEvidenceId(runId, repoUrl, filePath, type, distinguishingKey): string
```

Input concatenation: `runId|repoUrl|filePath|type|distinguishingKey`

The `distinguishingKey` differentiates atoms of the same type within the same
file (e.g., symbol name + line number, pattern name + line number).

### `generateRelationshipId`

```typescript
generateRelationshipId(runId, sourceAtomId, targetAtomId, relationshipType): string
```

Input concatenation: `runId|sourceAtomId|targetAtomId|relationshipType`

### `generateClusterId`

```typescript
generateClusterId(runId, clusterLabel, clusterType): string
```

Input concatenation: `runId|clusterLabel|clusterType`

### `generateCandidateId`

```typescript
generateCandidateId(runId, candidateName, candidateType, parentCandidateId): string
```

Input concatenation: `runId|candidateName|candidateType|parentCandidateId`

The `parentCandidateId` parameter should be an empty string when the candidate
has no parent.

### Idempotency Guarantee

Because these IDs are deterministic, re-running the pipeline with the same
inputs produces the same IDs. The Java-side bulk save endpoints use upsert
semantics (ON CONFLICT DO UPDATE keyed on the stable identifier), making
re-persistence a no-op for unchanged records.
