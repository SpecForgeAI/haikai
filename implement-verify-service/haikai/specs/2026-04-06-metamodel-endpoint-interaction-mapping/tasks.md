# Tasks: Metamodel Endpoint & Interaction Mapping

> **Note (2026-04-07):** Extraction data now comes from agentic LLM discovery,
> not AST pattern matching. The data format (EndpointInfo, InteractionInfo) is
> unchanged — the engine reads the same fields regardless of how they were populated.

## Phase 1: Engine Update

- [ ] T1.1: Add `EndpointInfo, InteractionInfo` import to `metamodel_engine.py`
- [ ] T1.2: Implement `_apply_endpoint_mappings()` — read `analysis.endpoints`, create Endpoint entities, dedup by path+method
- [ ] T1.3: Implement `_apply_interaction_mappings()` — read `analysis.interactions`, create DataMovement entities, dedup by source+target+type
- [ ] T1.4: Wire both into `populate()` — call after heuristics, before relationship mappings
- [ ] T1.5: Unit tests — verify endpoint entities created from EndpointInfo, interaction entities from InteractionInfo

## Phase 2: Config Extension

- [ ] T2.1: Add `extraction_mappings` section to `config/metamodel_mappings.yaml`
- [ ] T2.2: Verify existing config loading still works (no regression)

## Phase 3: Verification

- [ ] T3.1: Run on this repo — verify 59+ endpoints and 200+ interactions in architecture.json
- [ ] T3.2: Run on yas (Java Spring) — verify 145+ endpoints and 280+ interactions
- [ ] T3.3: Existing metamodel tests pass (no regressions)
- [ ] T3.4: Heuristic detection (services, components) unchanged
- [ ] T3.5: Deduplication works — no duplicate endpoints or interactions
