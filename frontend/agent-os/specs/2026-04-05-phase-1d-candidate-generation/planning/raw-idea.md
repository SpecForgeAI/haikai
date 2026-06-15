# Raw Idea: Phase 1d Candidate Generation

## Name
phase-1d-candidate-generation

## Summary
Implement Phase 1d candidate generation — deterministic conversion of 1c clusters into typed discovery candidates aligned to the architecture meta-model, with parent/relationship assignment, ambiguity resolution via DecisionTasks, candidate filtering/rejection, and internal persistence — as increment 10 of 16 for the legacy/current-state discovery capability.

## Full Description

# Increment 10 of 16 — Phase 1d candidate generation (v1)

## Delivery context
This is increment 10 of 16 for the new legacy / current-state discovery capability.

Previous increments established:
- discovery capability skeleton,
- Phase 0 framing and persistence,
- discovery run orchestration,
- Phase 1a evidence extraction,
- Phase 1b evidence linking + DecisionTask engine,
- Phase 1c clustering.

This increment introduces Phase 1d: transforming evidence clusters into discovery candidates aligned to the architecture meta-model.

## Goal
Implement Phase 1d — candidate generation, so the system can:
- take 1c clusters,
- produce structured candidate entities,
- prepare them for later controlled save into the canonical architecture model.

## In scope
1. Deterministic candidate generation (service, interface, endpoint, ui_screen, ui_action, physical_data_entity, package/package_set)
2. Candidate structure (type, name, description, evidence refs, source clusters, confidence, discovery method, review status)
3. Parent/relationship assignment (service→application, interface→service, endpoint→interface, ui_action→ui_screen)
4. DecisionTask expansion for 1d (candidate_type_classification, candidate_parent_assignment, candidate_name_generation, endpoint_grouping_decision, candidate_rejection_decision)
5. Candidate filtering and rejection
6. Candidate storage (internal, associated with run)
7. Phase completion and progression (Phase 1 complete marker)

## Out of scope
- save-back into canonical architecture model
- frontend review UX
- advanced multi-pass refinement
- log-based/AST/language-specific enrichment
