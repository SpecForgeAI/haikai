# Analyzer Pack Authoring Guide

Internal developer documentation for creating and registering new analyzer
packs in the discovery pipeline.

## Overview

An **analyzer pack** is the primary extension point for adding new extraction
or analysis capabilities to the discovery pipeline. Each pack conforms to the
`AnalyzerPack` interface, is registered in the analyzer registry at startup,
and can be invoked during pipeline execution.

## AnalyzerPack Interface

**File**: `discovery-service/src/types/analyzerPack.ts`

```typescript
interface AnalyzerPack {
  id: string;
  name: string;
  description: string;
  supportedPhases: string[];
  analyze(input: AnalyzerInput): Promise<AnalyzerResult>;
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Unique identifier used as the registry key (e.g., `'phase-1a-universal-extraction'`, `'stub-noop'`). |
| `name` | `string` | Human-readable display name. |
| `description` | `string` | Brief description of what the pack does. |
| `supportedPhases` | `string[]` | Array of phase identifiers the pack supports (e.g., `['phase0', 'phase1']`). |
| `analyze` | `(input: AnalyzerInput) => Promise<AnalyzerResult>` | The core analysis method. Receives input context and returns structured results. |

## AnalyzerInput

**File**: `discovery-service/src/types/analyzerPack.ts`

```typescript
interface AnalyzerInput {
  projectId: string;
  phase: string;
  step: string;
  context: Record<string, unknown>;
}
```

| Field | Type | Description |
|---|---|---|
| `projectId` | `string` | UUID of the project being analyzed. |
| `phase` | `string` | Current phase identifier (e.g., `'phase1'`). |
| `step` | `string` | Current step identifier (e.g., `'1a'`). |
| `context` | `Record<string, unknown>` | Flexible context object. For Phase 1a, this contains the `config_snapshot` with fields like `repos` (array of `{ url, branch }`), `includePaths`, `excludePaths`, and `runId`. |

## AnalyzerResult

**File**: `discovery-service/src/types/analyzerPack.ts`

```typescript
interface AnalyzerResult {
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
```

| Field | Type | Required | Description |
|---|---|---|---|
| `analyzerId` | `string` | Yes | The `id` of the analyzer pack that produced this result. |
| `phase` | `string` | Yes | Echoes the `phase` from the input. |
| `step` | `string` | Yes | Echoes the `step` from the input. |
| `findings` | `AnalyzerFinding[]` | Yes | Traditional finding items (can be empty `[]`). |
| `metadata` | `Record<string, unknown>` | Yes | Arbitrary metadata (counts, timing, error info, etc.). |
| `evidenceAtoms` | `EvidenceAtom[]` | No | Evidence atoms produced by extraction packs (Phase 1a). |
| `relationships` | `EvidenceRelationship[]` | No | Relationships (Phase 1b). |
| `clusters` | `EvidenceCluster[]` | No | Clusters (Phase 1c). |
| `candidates` | `DiscoveryCandidate[]` | No | Candidates (Phase 1d). |

The optional fields (`evidenceAtoms`, `relationships`, `clusters`,
`candidates`) are backward-compatible extensions. Packs that do not produce
outputs for a given layer simply omit the corresponding field.

### AnalyzerFinding

```typescript
interface AnalyzerFinding {
  id: string;
  category: string;
  summary: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
}
```

## Analyzer Registry

**File**: `discovery-service/src/services/analyzerRegistry.ts`

The analyzer registry is an in-memory `Map<string, AnalyzerPack>` that
maps pack IDs to their implementations.

### Initialization

The registry is initialized at startup via `initializeAnalyzerRegistry()`,
which creates a fresh map and registers the built-in packs:

```typescript
import { initializeAnalyzerRegistry } from './services/analyzerRegistry';

initializeAnalyzerRegistry();
```

Built-in packs registered at initialization:
1. `stubAnalyzerPack` (id: `'stub-noop'`)
2. `phase1aAnalyzerPack` (id: `'phase-1a-universal-extraction'`)

### Registering a New Pack

To register a new pack after initialization:

```typescript
import { registerAnalyzerPack } from './services/analyzerRegistry';

registerAnalyzerPack(myNewPack);
```

This calls `analyzerRegistry.set(pack.id, pack)` internally.

### Retrieving the Registry

```typescript
import { getAnalyzerRegistry } from './services/analyzerRegistry';

const registry = getAnalyzerRegistry();
const pack = registry.get('my-pack-id');
```

## Extractor Pattern

Phase 1a extraction uses a sub-extractor pattern where the analyzer pack
orchestrates multiple specialized extractors. Each extractor is a standalone
module that accepts repository context and returns evidence atoms.

**Extractor directory**: `discovery-service/src/services/extractors/`

### Existing Extractors

| File | Function | Atom Type |
|---|---|---|
| `fileStructureExtractor.ts` | `extractFileStructure(...)` | `file_structure` |
| `symbolExtractor.ts` | `extractSymbols(...)` | `symbol` |
| `stringPatternExtractor.ts` | `extractStringPatterns(...)` | `string_pattern` |

### Extractor Input Pattern

Each extractor receives a parameter object with repository context:

```typescript
{
  repoDir: string;       // Path to the cloned repository directory
  runId: string;         // Discovery run UUID (for ID generation)
  repoUrl: string;       // Repository URL (for ID generation)
  includePaths?: string[];  // Optional include path filters
  excludePaths?: string[];  // Optional exclude path filters
}
```

### Extractor Output

Each extractor returns `Promise<EvidenceAtom[]>` -- an array of fully
populated evidence atoms with deterministic IDs generated via
`generateEvidenceId`.

### Adding a New Extractor

1. Create a new file in `discovery-service/src/services/extractors/`
   (e.g., `dependencyManifestExtractor.ts`).
2. Export an async extraction function that accepts the standard parameter
   object and returns `EvidenceAtom[]`.
3. Import and invoke the new extractor in the analyzer pack's `analyze`
   method alongside the existing extractors.

## Example Packs

### `stubAnalyzerPack` (Reference Implementation)

**File**: `discovery-service/src/services/stubAnalyzerPack.ts`

Minimal no-op implementation. Useful as a template and for testing:

```typescript
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
```

### `phase1aAnalyzerPack` (Production Implementation)

**File**: `discovery-service/src/services/phase1aAnalyzerPack.ts`

Full extraction pack that orchestrates sub-extractors:

- **ID**: `'phase-1a-universal-extraction'`
- **Supported phases**: `['phase1']`
- **Behavior**:
  1. Reads `repos`, `includePaths`, `excludePaths`, and `runId` from
     `input.context`.
  2. For each repository: clones via `RepoAccessProvider`, runs all three
     sub-extractors in parallel (`Promise.all`), collects atoms, cleans up.
  3. If a repo clone fails, logs the error and continues with remaining repos.
  4. Returns atoms on the `evidenceAtoms` field and metadata with atom counts
     by type, total count, repos processed/failed.

- **Test override**: The `repoAccessProvider` can be replaced in tests via
  `setRepoAccessProvider(mockProvider)` for unit testing without actual
  git clone operations.

## Step-by-Step: Creating a New Analyzer Pack

1. **Define the pack object** implementing the `AnalyzerPack` interface:
   ```typescript
   import { AnalyzerPack, AnalyzerInput, AnalyzerResult } from '../types';

   export const myAnalyzerPack: AnalyzerPack = {
     id: 'my-custom-analyzer',
     name: 'My Custom Analyzer',
     description: 'Extracts custom evidence from repositories',
     supportedPhases: ['phase1'],

     async analyze(input: AnalyzerInput): Promise<AnalyzerResult> {
       // Your extraction/analysis logic here
       return {
         analyzerId: 'my-custom-analyzer',
         phase: input.phase,
         step: input.step,
         findings: [],
         metadata: { /* your metadata */ },
         evidenceAtoms: [ /* your atoms */ ],
       };
     },
   };
   ```

2. **Register the pack** in `analyzerRegistry.ts` by adding it to the
   `initializeAnalyzerRegistry` function or calling `registerAnalyzerPack`
   at startup:
   ```typescript
   import { myAnalyzerPack } from './myAnalyzerPack';

   // In initializeAnalyzerRegistry():
   analyzerRegistry.set(myAnalyzerPack.id, myAnalyzerPack);
   ```

3. **Wire into the pipeline** if the pack should execute during a specific
   step (e.g., modifying `executeStep1a` in `runManager.ts` to invoke the
   new pack, or creating a new step execution function for a future phase).

4. **Write tests** covering the pack's `analyze` method, verifying correct
   atom generation, metadata, and error handling.

## Key Source Files

| File | Responsibility |
|---|---|
| `discovery-service/src/types/analyzerPack.ts` | `AnalyzerPack`, `AnalyzerInput`, `AnalyzerResult`, `AnalyzerFinding` interfaces |
| `discovery-service/src/services/analyzerRegistry.ts` | Registry initialization, registration, and retrieval |
| `discovery-service/src/services/phase1aAnalyzerPack.ts` | Production Phase 1a analyzer pack |
| `discovery-service/src/services/stubAnalyzerPack.ts` | Reference no-op analyzer pack |
| `discovery-service/src/services/extractors/fileStructureExtractor.ts` | File structure sub-extractor |
| `discovery-service/src/services/extractors/symbolExtractor.ts` | Symbol sub-extractor |
| `discovery-service/src/services/extractors/stringPatternExtractor.ts` | String pattern sub-extractor |
