# Initialization

## Spec Name
discovery-run-model-and-orchestration

## Summary
Increment 5 of 16 -- Legacy / Current-State Discovery capability. Introduces a discovery run model for explicit, trackable Phase 1 execution. After Phase 0 framing is complete (persisted anchors, config, and brief from Increment 4), Phase 1 needs a run entity to track execution state, step progression, and results across the multi-step code-repo analysis pipeline (steps 1a, 1b, 1c, 1d).

## Context
- Increment 1: discovery-service skeleton (discovery-service/ with Phase 0/1 stub routes, analyzer-pack extension, gateway awareness)
- Increment 2: Phase 0 persistence contract (discovery_config table + MCP save tool + DISCOVERY_BRIEF_MD artifact type)
- Increment 3: Phase 0 discovery framing conversation (architect--discovery-framing task)
- Increment 4: Phase 0 completion and handoff (3 sequential saves: anchors, config w/ COMPLETE status, brief artifact)
- This increment: discovery run model and orchestration for Phase 1 execution tracking
