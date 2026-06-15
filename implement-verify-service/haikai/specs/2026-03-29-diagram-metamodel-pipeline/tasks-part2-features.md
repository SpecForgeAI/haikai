# Task Breakdown: Part 2 — New Features (Multi-Format Pipeline + Metamodel + Endpoints)

## Overview
Total Tasks: 6 task groups, 34 sub-tasks

**Goal:** Add PlantUML, Graphviz, and metamodel serialisers. Build the metamodel population engine. Add versioned diagram syntax configs. Implement 5 API endpoints. All built on the refactored base from Part 1.

**Prerequisites:** Part 1 refactor complete — DiagramModel, builders, MermaidSerialiser, versioned kind mappings all in place and tested.

**Key Design Principles:**
1. **One pipeline, multiple outputs.** Builders produce DiagramModel, serialisers convert to target format.
2. **Hard stop on unknown versions.** Every versioned layer refuses to proceed if version not in YAML.
3. **Metamodel population is separate from diagrams.** Populating entities ≠ generating diagram nodes.
4. **Match Agent OS coding style.** One module per concern, docstrings, logging, defensive I/O.

**Reference Documents:**
- Spec: `spec.md`
- Requirements: `planning/requirements.md`
- Part 1 tasks: `tasks-part1-refactor.md`
- Existing metamodel gateway: `src/metamodel_gateway.py`
- Existing API: `src/api.py`

## Task List

### New Serialisers

#### Task Group 1: PlantUML Serialiser
**Dependencies:** Part 1 complete (DiagramModel exists)

- [x] 1.0 Complete PlantUML serialiser
  - [x] 1.1 Create `src/ast/plantuml_serialiser.py`
    - `PlantUMLSerialiser` class
    - `serialise(model: DiagramModel) → str`
    - `_serialise_class_diagram(model) → str` — PlantUML class syntax with members, visibility, stereotypes
    - `_serialise_graph(model) → str` — component/dependency diagram syntax
    - `_serialise_inheritance(model) → str` — inheritance with `--|>` and `..|>` syntax
  - [x] 1.2 Write tests: `tests/ast/test_plantuml_serialiser.py`
    - Test class diagram output starts with `@startuml` / ends with `@enduml`
    - Test class members have correct visibility prefixes
    - Test inheritance relationships produce correct PlantUML arrows
    - Test empty DiagramModel produces minimal valid output
    - Test stereotypes (abstract, interface) rendered correctly
  - [x] 1.3 Ensure tests pass
    - Run: `pytest tests/ast/test_plantuml_serialiser.py -v`

**Acceptance Criteria:**
- Valid PlantUML syntax output for all diagram types
- `@startuml` / `@enduml` wrapping
- Visibility, stereotypes, inheritance all correct

---

#### Task Group 2: Graphviz Serialiser
**Dependencies:** Part 1 complete (DiagramModel exists)

- [x] 2.0 Complete Graphviz serialiser
  - [x] 2.1 Create `src/ast/graphviz_serialiser.py`
    - `GraphvizSerialiser` class
    - `serialise(model: DiagramModel) → str`
    - `_serialise_class_diagram(model) → str` — DOT record shapes for classes with members
    - `_serialise_graph(model, directed=True) → str` — digraph/graph syntax for dependencies, inheritance
    - `_serialise_subgraph(model) → str` — cluster subgraphs for component diagrams
    - Node shape selection based on entity type (record for classes, box for modules, ellipse for interfaces)
  - [x] 2.2 Write tests: `tests/ast/test_graphviz_serialiser.py`
    - Test output starts with `digraph` or `graph` declaration
    - Test nodes have correct shapes per entity type
    - Test edges use `->` for directed graphs
    - Test subgraph clusters for component diagrams
    - Test empty DiagramModel handled gracefully
  - [x] 2.3 Ensure tests pass
    - Run: `pytest tests/ast/test_graphviz_serialiser.py -v`

**Acceptance Criteria:**
- Valid DOT syntax output
- Correct node shapes per entity type
- Cluster subgraphs for component grouping
- Both directed (digraph) and undirected (graph) supported

---

#### Task Group 3: Metamodel Serialiser
**Dependencies:** Part 1 complete (DiagramModel exists)

- [x] 3.0 Complete metamodel serialiser
  - [x] 3.1 Create `src/ast/metamodel_serialiser.py`
    - `MetamodelSerialiser` class
    - `serialise(model: DiagramModel) → dict` — returns diagram_nodes and diagram_edges dicts (not string)
    - `_create_node(entity: DiagramEntity) → dict` — maps to architecture.json node format (id, entity_type, entity_id, pos_x, pos_y, width, height, z_index, parent_node_id)
    - `_create_edge(rel: DiagramRelationship) → dict` — maps to architecture.json edge format
    - Default positions (auto-layout: simple grid or vertical stack)
    - UUID generation for node/edge IDs matching architecture.json pattern
  - [x] 3.2 Write tests: `tests/ast/test_metamodel_serialiser.py`
    - Test output contains diagram_nodes list
    - Test output contains diagram_edges list (if relationships exist)
    - Test node has required fields (id, entity_type, entity_id, pos_x, pos_y, width, height)
    - Test edge has required fields (id, source_node_id, target_node_id)
    - Test parent_node_id set correctly for nested entities
    - Test empty DiagramModel produces empty lists
  - [x] 3.3 Ensure tests pass
    - Run: `pytest tests/ast/test_metamodel_serialiser.py -v`

**Acceptance Criteria:**
- Output matches architecture.json diagram format
- Nodes have all required positional fields
- Parent-child nesting via parent_node_id
- Edge format compatible with existing metamodel structure

---

### Versioned Diagram Syntax Config

#### Task Group 4: Diagram Serialiser Versioning
**Dependencies:** Task Groups 1-3

- [x] 4.0 Complete versioned diagram syntax config
  - [x] 4.1 Create `config/diagram_serialisers.yaml`
    - Mermaid section with at least one version entry
    - PlantUML section with at least one version entry
    - Graphviz section with at least one version entry
    - Metamodel section with version_id "1" entry
    - Comment headers documenting where to find schema sources
  - [x] 4.2 Create `src/ast/serialiser_loader.py`
    - `load_serialiser_config(format: str, version: str, config_path: str) → dict`
    - Hard stop (raises `VersionNotFoundError`) if version not in YAML
    - `get_available_formats() → list[str]`
    - `get_available_versions(format: str) → list[str]`
  - [x] 4.3 Update `DiagramGenerator` to accept format + version params
    - `generate_all(snapshot_path, formats=["mermaid"], versions=None)`
    - Loads serialiser config for requested format+version
    - Selects correct serialiser class
    - Writes output with format-appropriate extension (.mmd, .puml, .dot, .json)
  - [x] 4.4 Write tests: `tests/ast/test_serialiser_loader.py`
    - Test load succeeds for known format+version
    - Test load raises VersionNotFoundError for unknown version
    - Test get_available_formats returns all configured formats
    - Test get_available_versions returns versions for a format
  - [x] 4.5 Verify all existing diagram tests still pass
    - Run: `pytest tests/ast/test_diagram_generator.py -v`
  - [x] 4.6 Verify ALL existing tests still pass
    - Run: `pytest tests/ast/ -v`

**Acceptance Criteria:**
- YAML config covers Mermaid, PlantUML, Graphviz, metamodel with version entries
- Hard stop on unknown format or version
- DiagramGenerator supports multi-format output
- Existing diagram tests unaffected (default format is Mermaid)

---

### Metamodel Population Engine

#### Task Group 5: Metamodel Population
**Dependencies:** Task Group 3 (MetamodelSerialiser), Part 1 (versioned kind mappings)

- [x] 5.0 Complete metamodel population engine
  - [x] 5.1 Create `config/metamodel_mappings.yaml`
    - version_id "1" entry
    - Direct entity_mappings: classes (source_kind: class), methods (source_kind: method), interfaces (source_kind: interface)
    - Detection heuristic mappings: services (detect_by: has_dockerfile, has_main_entrypoint, has_api_routes), app_components (detect_by: top_level_directory_with_sources), endpoints (detect_by: has_route_decorator)
    - Relationship mappings: imports between services → interactions
  - [x] 5.2 Create `src/ast/metamodel_engine.py`
    - `MetamodelEngine` class
    - `populate(metamodel: dict, analyses: dict[str, StructuralAnalysis], snapshot_path: str) → dict`
    - `_check_version(metamodel: dict)` — reads `version_id`, loads matching mappings, hard stop if unknown
    - `_apply_direct_mappings(metamodel, analyses, mappings)` — kind → entity type
    - `_apply_heuristic_mappings(metamodel, analyses, mappings, project_root)` — detection rules for services, components
    - `_apply_relationship_mappings(metamodel, analyses, mappings)` — imports → interactions
    - `_generate_entity_id(entity_type, name) → str` — ID generation matching architecture.json pattern
    - Optionally call MetamodelSerialiser to populate diagrams section
  - [x] 5.3 Integrate with existing `MetamodelGateway`
    - Add `populate_from_structural()` flow: gateway fetches → engine populates → gateway persists
    - Keep existing gateway interface unchanged
  - [x] 5.4 Write tests: `tests/ast/test_metamodel_engine.py`
    - Test version check passes for version_id 1
    - Test version check hard stops for unknown version_id
    - Test direct mapping: class symbols → classes entities
    - Test direct mapping: method symbols → methods entities with parent_ref
    - Test heuristic mapping: directory with Dockerfile → service entity
    - Test relationship mapping: imports between services → interactions
    - Test entity ID format matches architecture.json pattern
    - Test full populate returns enriched metamodel with correct entity counts
    - Test populate with empty structural data returns metamodel unchanged
  - [x] 5.5 Ensure tests pass
    - Run: `pytest tests/ast/test_metamodel_engine.py -v`

**Acceptance Criteria:**
- version_id check with hard stop on unknown version
- Direct mappings populate correct entity types
- Heuristic detection identifies services and components
- Entity IDs match architecture.json format
- Integration with MetamodelGateway preserves existing interface
- Empty structural data doesn't corrupt metamodel

---

### API Endpoints

#### Task Group 6: Five API Endpoints
**Dependencies:** Task Groups 1-5, existing `src/api.py`

- [x] 6.0 Complete API endpoints
  - [x] 6.1 Implement `POST /api/v1/structural/analyze`
    - Accept repo_url/local_path, branch, provider list
    - Trigger analysis via existing pipeline
    - Write to file store
    - Return snapshot metadata (snapshot_id, repo, file_count, symbol_count, store_path)
  - [x] 6.2 Implement `POST /api/v1/structural/{repo}/raw`
    - Accept snapshot param (default "latest")
    - Accept include list (index, inheritance, imports, patterns, stats)
    - Read files from snapshot directory
    - Return file contents as JSON
  - [x] 6.3 Implement `POST /api/v1/structural/{repo}/query`
    - Accept question string, snapshot param
    - Read relevant files based on question
    - Direct lookup for structured questions (grep-equivalent)
    - LLM-assisted for complex questions
    - Return answer, evidence, method (direct_lookup or llm_assisted)
  - [x] 6.4 Implement `POST /api/v1/structural/{repo}/metamodel/populate`
    - Accept metamodel_id, snapshot param
    - Fetch metamodel via MetamodelGateway
    - Populate via MetamodelEngine
    - Return enriched metamodel JSON
  - [x] 6.5 Implement `POST /api/v1/structural/{repo}/diagrams/generate`
    - Accept snapshot, types list, formats list, version per format
    - Run builders + serialisers
    - Return diagram source strings + files_written paths
  - [x] 6.6 Write tests: `tests/api/test_structural_endpoints.py`
    - Test analyze endpoint returns snapshot metadata
    - Test raw endpoint returns requested file contents
    - Test query endpoint returns answer for known question
    - Test metamodel populate returns enriched JSON with version check
    - Test diagrams endpoint returns Mermaid output by default
    - Test diagrams endpoint returns multiple formats when requested
    - Test error responses for missing repo, unknown snapshot
  - [x] 6.7 Ensure all tests pass
    - Run: `pytest tests/ -v --tb=short`

**Acceptance Criteria:**
- All 5 endpoints functional and returning correct responses
- Error handling for missing repos, unknown snapshots, unknown versions
- Metamodel endpoint enforces version_id check (hard stop)
- Diagrams endpoint supports multi-format output
- Consistent with existing api.py patterns (auth, error responses, logging)

---

## Execution Order

Task Groups 1, 2, 3 are **independent** — all three serialisers can be built in parallel since they all consume DiagramModel from Part 1.

1. **Task Groups 1-3: Serialisers** (parallel) — PlantUML, Graphviz, Metamodel
2. **Task Group 4: Versioned Config** — wires serialisers together with version checking
3. **Task Group 5: Metamodel Engine** — population logic + gateway integration
4. **Task Group 6: API Endpoints** — depends on everything above

## Completion Criteria

Part 2 is complete when ALL of the following are true:
- 4 serialisers working (Mermaid from Part 1, plus PlantUML, Graphviz, Metamodel)
- `config/diagram_serialisers.yaml` with versioned entries for all 4 formats
- `config/metamodel_mappings.yaml` with version_id 1 entry
- MetamodelEngine populates metamodel entities from structural data
- Hard stop on unknown versions at all 3 layers (provider, metamodel, diagram format)
- 5 API endpoints functional
- ALL existing tests pass (42 from before + Part 1 additions)
- New tests for each serialiser, loader, engine, and endpoint
- Total test suite green: `pytest tests/ -v`
