# Increment 9 of 16 — Phase 1c clustering + cluster adjudication (v1)

## Delivery context

This is increment **9 of 16** for the new **legacy / current-state discovery** capability.

Previous increments established:
- discovery capability skeleton,
- Phase 0 framing and persistence,
- discovery run orchestration,
- Phase 1a universal evidence extraction,
- Phase 1 evidence schema backbone (1a–1d),
- Phase 1b evidence linking and initial DecisionTask engine.

This increment introduces **Phase 1c**:
- grouping linked evidence into coherent clusters,
- and using bounded DecisionTasks to resolve ambiguous clustering outcomes.

## Goal

Implement **Phase 1c — evidence clustering**, so the system can:
- take the 1a + 1b evidence graph,
- group evidence into meaningful technical bundles,
- classify those bundles at a pre-architecture level,
- and prepare them for later candidate generation in 1d.

At the end of this increment:
- the system can produce **evidence clusters (1c)**,
- and selectively use LLM adjudication for ambiguous merge/split/type decisions.

## In scope

### 1. Deterministic clustering
Implement the first pass of deterministic clustering over the evidence graph, using signals such as:
- shared directory/package structure
- naming similarity
- shared references/relationship density
- shared route prefixes
- shared SQL/table usage
- shared UI labels/titles
- Phase 0 anchor hints where applicable

This clustering should be broad and heuristic, not framework-specific.

### 2. Cluster creation
Create 1c Evidence Clusters that:
- group related atoms/relationships,
- have cluster type/classification at a preliminary level,
- have confidence,
- have formation reason / provenance.

Clusters are still discovery-side structures, not canonical architecture entities.

### 3. Initial cluster types
Support an initial useful set of cluster types such as:
- service-like cluster
- interface-like cluster
- ui-screen-like cluster
- physical-data-like cluster
- package/module-like cluster
- shared-library/noise/unknown cluster

Exact naming can follow the internal schema, but the intent should remain at this level.

### 4. Cluster ambiguity detection
Deterministic clustering must identify ambiguous cases such as:
- two clusters may need merging
- one cluster may need splitting
- cluster type is unclear
- cluster should be marked as noise/generated/shared support code
- cluster anchor assignment is uncertain

These cases should produce DecisionTasks.

### 5. DecisionTask expansion for 1c
Extend the DecisionTask engine to support the minimal 1c task set, such as:
- `cluster_merge_decision`
- `cluster_type_classification`
- `cluster_anchor_assignment`
- `cluster_noise_decision`

Each task must:
- operate on bounded cluster/evidence bundles
- have constrained allowed decisions
- return structured results only

### 6. Cluster graph update
After deterministic and task-based adjudication:
- clusters must be updated consistently
- merge/split/type outcomes must be reflected in the stored cluster state
- provenance/confidence must be preserved

### 7. Phase completion and progression
Update the discovery run so:
- Phase 1c runs after 1b
- Phase 1c completes when:
  - clustering passes have run,
  - high-priority cluster ambiguities are resolved,
  - clusters are in a stable state for candidate generation
- run progresses to Phase 1d placeholder

## Out of scope

Do **not** implement:
- Phase 1d candidate generation
- canonical architecture save-back
- frontend visualization of clusters
- advanced iterative clustering rounds
- AST enrichment
- language/version-specific analyzer packs
- log-based enrichment

## Required design constraints

### Clusters are not architecture yet
Clusters remain discovery-side groupings and must not be treated as canonical architecture entities.

### Deterministic-first clustering
Clustering must be rule/heuristic driven first; LLM only resolves ambiguity.

### Bounded LLM interaction
All LLM use must go through explicit DecisionTasks over bounded cluster/evidence bundles.

### Traceability
Each cluster must preserve:
- source evidence references
- formation reason/provenance
- confidence
- any adjudication history

### Stable handoff into 1d
The cluster output must be structured so candidate generation in 1d can operate cleanly over it.

## Acceptance criteria

1. Deterministic logic produces 1c Evidence Clusters from the 1a + 1b evidence graph.
2. Clusters have:
   - members
   - type/classification
   - confidence
   - provenance/formation reason
3. Ambiguous clustering outcomes generate DecisionTasks.
4. The DecisionTask engine supports the initial 1c task set.
5. Cluster state is updated consistently after adjudication.
6. Phase 1c completes and the run progresses to 1d.
7. No candidate generation or canonical save-back is implemented yet.
