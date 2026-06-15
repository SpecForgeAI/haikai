# Raw Idea: Phase 1d Candidate Generation

Build the real Phase 1d candidate generation logic to replace the current backbone stub in `executeStep1d` (runManager.ts). This step synthesizes discovery candidates from Phase 1c clusters, mapping each cluster to one or more meta-model element proposals (applications, services, components, interfaces, data entities, etc.).

The candidate generation step should:
- Read finalized 1c clusters and upstream evidence (atoms, relationships)
- Apply deterministic generation rules to produce candidate proposals from clusters
- Handle parent/child relationship assignment between candidates
- Use the existing DiscoveryCandidate interface and persistence infrastructure
- Create DecisionTasks for ambiguous cases (following the 1b/1c pattern)
- Persist final candidates via the existing bulkSaveCandidates API
- Signal Phase 1 completion on the discovery run

Key areas to design:
- Candidate generation rule structure (similar to ClusteringRule / LinkerRule?)
- CandidateType usage from the existing union
- Confidence model for candidates
- DecisionTask types for 1d ambiguity resolution
- Gateway prompt templates for 1d decision tasks
- Candidate naming strategy
- Parent/relationship assignment logic
- Filtering/rejection criteria
