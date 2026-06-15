# Tasks: Agentic Diagram Generation

## Phase 1: Move Diagram Generation to Final Step

- [ ] T1.1: Remove `_generate_diagrams()` call from `store.py` `write_snapshot()`
- [ ] T1.2: Add mechanical diagram generation (Step 8a) as final step in `pipeline.py`
- [ ] T1.3: Pass `snapshot_path` to `DiagramGenerator().generate_all()` from pipeline context
- [ ] T1.4: Respect `auto_generate_diagrams` config
- [ ] T1.5: Verify existing 8 diagram types still generate identically (regression)

## Phase 2: New Store Tools

- [ ] T2.1: Add `read_endpoints(snapshot_path, file_pattern)` to `enrichment_tools.py` — reads `_endpoints.txt` TSV, filters by pattern
- [ ] T2.2: Add `read_interactions(snapshot_path, file_pattern)` to `enrichment_tools.py` — reads `_interactions.txt` TSV, filters by pattern
- [ ] T2.3: Register both in `TOOLS` dict
- [ ] T2.4: Unit tests for both readers (empty file, populated file, pattern filtering)

## Phase 3: Agentic Diagram Discoverer

- [ ] T3.1: Create `src/ast/diagram_discoverer.py` — same pattern as `endpoint_discoverer.py`
  - Loads skill file from `haikai-profiles/default/commands/discover-diagrams/single-agent/discover-diagrams.md`
  - Runs LLM agent loop with tools
  - Parses `FINAL_ANSWER` JSON into `list[DiagramModel]`
  - Returns empty list on no LLM / no snapshot / no enrichment data
- [ ] T3.2: Create skill file `discover-diagrams.md` — discovery strategy:
  - Survey: read endpoints + interactions + index to understand data shape
  - Decide: which diagram types have enough data to be useful
  - Build: construct DiagramModel JSON (entities, relationships, metadata)
  - Output: FINAL_ANSWER as JSON array
- [ ] T3.3: Add `serialise_models(models, snapshot_path)` to `DiagramGenerator` — takes agentic DiagramModels and runs them through serialisers
- [ ] T3.4: Add merge logic: if agentic produces `enriched_data_flow`, replace mechanical `data-flow`
- [ ] T3.5: Wire Step 8b into `pipeline.py` — after Step 8a, if `llm_client` available

## Phase 4: Serialiser Support

- [ ] T4.1: Add generic fallback renderer to all 3 serialisers — any unknown `diagram_type` renders as directed graph (entities → nodes, relationships → edges)
- [ ] T4.2: Add entity type → shape mapping (controller=subgraph, database=cylinder, message_queue=stadium, etc.)
- [ ] T4.3: Add dedicated renderers for `enriched_data_flow` in Mermaid/PlantUML/Graphviz — DFD-style with data stores, processes, flows
- [ ] T4.4: Add dedicated renderers for `uml_component` in Mermaid/PlantUML/Graphviz — UML component notation with provided/required interfaces
- [ ] T4.5: Add dedicated renderers for `erd` in Mermaid/PlantUML/Graphviz — entity boxes with attributes, cardinality on edges
- [ ] T4.6: Add dedicated renderers for `api_surface` in Mermaid/PlantUML/Graphviz
- [ ] T4.7: Add dedicated renderers for `interaction_flow` in Mermaid/PlantUML/Graphviz
- [ ] T4.8: Add dedicated renderers for `blast_radius` in Mermaid/PlantUML/Graphviz
- [ ] T4.9: Add entity type mappings to `metamodel_serialiser.py`
- [ ] T4.10: Unit tests per serialiser — all known types + generic fallback

## Phase 5: Integration & Verification

- [ ] T5.1: Regression: pipeline without LLM → only 8 mechanical diagrams, identical to current output
- [ ] T5.2: Agentic: pipeline on piggymetrics with LLM → mechanical + agentic diagrams generated
- [ ] T5.3: Selective: verify LLM skips diagram types when data is sparse
- [ ] T5.4: Merge: verify `enriched_data_flow` replaces `data-flow` when both exist
- [ ] T5.5: Fallback: verify LLM-invented diagram type renders via generic graph
- [ ] T5.6: All existing diagram tests pass
