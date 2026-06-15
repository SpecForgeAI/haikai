# Tasks: Diagram Generation Enrichment

## Phase 1: Move Diagram Generation to Final Step

- [ ] T1.1: Remove `_generate_diagrams()` call from `store.py` `write_snapshot()` (line 96-97)
- [ ] T1.2: Add `DiagramGenerator().generate_all()` as final step in `pipeline.py` (after step 8)
- [ ] T1.3: Respect `auto_generate_diagrams` config from store
- [ ] T1.4: Verify existing 8 diagram types still generate correctly
- [ ] T1.5: Verify diagrams now include tree-sitter data (calls in sequence diagrams)

## Phase 2: File Readers

- [ ] T2.1: Add `read_endpoints(snapshot_path)` to `diagram_builders.py` — parses `_endpoints.txt` TSV
- [ ] T2.2: Add `read_interactions(snapshot_path)` to `diagram_builders.py` — parses `_interactions.txt` TSV
- [ ] T2.3: Unit tests for both readers

## Phase 3: New Builders

- [ ] T3.1: `APISurfaceBuilder` — endpoints grouped by controller, operation + path + protocol
- [ ] T3.2: `InteractionFlowBuilder` — services → external systems with mechanism + direction
- [ ] T3.3: `DataEntityFlowBuilder` — entity types flowing between services and targets
- [ ] T3.4: `FullSequenceBuilder` — endpoint → call chain → external interactions
- [ ] T3.5: `InternalDataFlowBuilder` — enriched DataFlowBuilder with real interaction targets
- [ ] T3.6: `BlastRadiusBuilder` — reverse dependency: external system → affected services → endpoints
- [ ] T3.7: Unit tests per builder with synthetic fixture data

## Phase 4: Serialiser Support

- [ ] T4.1: Mermaid — add rendering for 6 new diagram types (reuse sequence + data_flow where compatible)
- [ ] T4.2: PlantUML — same
- [ ] T4.3: Graphviz — same
- [ ] T4.4: Metamodel — add entity type mappings
- [ ] T4.5: Unit tests per serialiser for new diagram types

## Phase 5: Registration + Integration

- [ ] T5.1: Register 6 new builders in `DiagramGenerator.__init__()`
- [ ] T5.2: End-to-end: pipeline on piggymetrics with LLM → 14 diagram files
- [ ] T5.3: Regression: pipeline without LLM → only 8 original diagrams
- [ ] T5.4: All existing diagram tests pass
