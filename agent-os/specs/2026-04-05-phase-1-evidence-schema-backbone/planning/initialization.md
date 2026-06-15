# Initialization

## Spec Name
phase-1-evidence-schema-backbone

## Summary
Increment 7 of 16 -- Legacy / Current-State Discovery capability. Formalizes the Phase 1 evidence schema backbone covering all four sub-phases (1a through 1d). Phase 1a already has a working extraction pipeline producing evidence atoms (file_structure, symbol, string_pattern) persisted to the discovery_evidence table. This increment defines the TypeScript type contracts and (where needed) persistence schemas for the remaining three layers of the Phase 1 pipeline:

- **1b Relationship Inference**: Produces relationship evidence linking pairs of 1a atoms (e.g., "file X imports symbol Y", "service A calls service B")
- **1c Cluster Formation**: Groups related atoms and relationships into coherent clusters (e.g., "these files + symbols + relationships form a service boundary")
- **1d Candidate Synthesis**: Synthesizes clusters into discovery candidates that map to meta-model element types (e.g., "this cluster is likely an Application named X")

## Context
- Increment 1: discovery-service skeleton (Express/TypeScript micro-service)
- Increment 2: Phase 0 persistence contract (discovery_config table, MCP save tool, DISCOVERY_BRIEF_MD artifact type)
- Increment 3: Phase 0 discovery framing conversation (architect--discovery-framing task)
- Increment 4: Phase 0 completion and handoff (3 sequential saves: anchors, config w/ COMPLETE status, brief artifact)
- Increment 5: Discovery run model and orchestration (discovery_run table, run manager with step sequencing 1a-1d)
- Increment 6: Phase 1a universal evidence extraction (Phase 1a analyzer pack with real extractors, discovery_evidence table, bulk save, archModelClient evidence methods)
- This increment: Formalize the evidence schema backbone for 1b, 1c, 1d layers

## Existing State
- discovery_evidence table exists with columns: id, run_id, repo_url, file_path, type, data (JSONB), extracted_at
- EvidenceAtom TypeScript interface in discovery-service/src/types/evidenceAtom.ts with types: file_structure, symbol, string_pattern
- AnalyzerResult has optional evidenceAtoms field
- Run manager in discovery-service/src/services/runManager.ts sequences 1a-1d steps; 1b/1c/1d are stubs returning { phase, step, status: 'stub', projectId }
- archModelClient has bulkSaveEvidence, getEvidenceByRun, getEvidenceCount methods for 1a atoms
