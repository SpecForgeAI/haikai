# Initialization

## Spec Name
phase-1b-linker-and-decision-task-engine

## Summary
Increment 8 of 16 -- Legacy / Current-State Discovery capability. Implements Phase 1b evidence relationship linking with real logic (replacing the current backbone stub), plus introduces the DecisionTask engine for LLM-assisted ambiguity resolution.

Phase 1b takes the Phase 1a evidence atoms (file_structure, symbol, string_pattern) and infers relationships between them. The linking process has two tiers:

1. **Deterministic linking rules**: Pattern-matching on atom data fields to produce high-confidence relationships (e.g., import statements matching symbol names, directory containment from file paths, class extension patterns)
2. **DecisionTask engine**: When deterministic rules produce ambiguous or low-confidence results, a DecisionTask is created. The DecisionTask engine uses LLM calls to resolve ambiguity -- confirming relationships, choosing between competing candidates, or discarding false positives.

## Context
- Increment 1: discovery-service skeleton (Express/TypeScript micro-service, port 8091)
- Increment 2: Phase 0 persistence contract
- Increment 3: Phase 0 discovery framing conversation
- Increment 4: Phase 0 completion and handoff
- Increment 5: Discovery run model and orchestration (run manager with step sequencing 1a-1d)
- Increment 6: Phase 1a universal evidence extraction (real extractors, discovery_evidence table, bulk save)
- Increment 7: Phase 1 evidence schema backbone (discovery_relationship, discovery_cluster, discovery_cluster_member, discovery_candidate tables with full JPA stacks)
- This increment: Replace 1b stub with real deterministic linker + DecisionTask engine with LLM integration

## Existing State
- discovery_relationship table exists with: id, run_id, source_atom_id, target_atom_id, relationship_type, confidence, data (JSONB), inferred_at
- EvidenceRelationship TypeScript interface with types: 'imports' | 'calls' | 'extends' | 'contains' | 'uses_data' | 'defines' | 'references'
- archModelClient has: bulkSaveRelationships, getRelationshipsByRun, getRelationshipCount
- Run manager executeStep1b currently queries upstream atom count and returns { relationshipCount: 0, upstreamAtomCount }
- AnalyzerResult has optional relationships field
- Phase 1a extractors produce: file_structure atoms (relativePath, extension, sizeBytes, lineCount), symbol atoms (name, kind, line, scope, language), string_pattern atoms (patternName, matchedText, line, contextSnippet)
- Gateway has LLM client (llmClient.ts) with provider-agnostic interface supporting OpenAI and Azure OpenAI
- Gateway chatV2 routes handle LLM calls -- this is the established pattern for how LLM calls are made in this system
