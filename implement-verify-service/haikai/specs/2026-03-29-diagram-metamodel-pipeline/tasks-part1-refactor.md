# Task Breakdown: Part 1 — Refactor (Prepare for Multi-Format Pipeline)

## Overview
Total Tasks: 3 task groups, 18 sub-tasks

**Goal:** Refactor existing code to introduce the Diagram Model intermediate layer, extract Mermaid into a serialiser, and move ctags kind mappings to versioned YAML. All existing behaviour preserved — 42 existing tests must still pass. No new features added.

**Key Design Principles:**
1. **Zero behaviour change.** Same inputs produce same outputs. All 42 existing tests pass without modification.
2. **Introduce abstraction without changing interfaces.** `DiagramGenerator.generate_all(snapshot_path)` still works — internal wiring changes, external API stays.
3. **Match Agent OS coding style.** One module per concern under `src/ast/`, docstrings, logging, Path objects, defensive file I/O.

**Reference Documents:**
- Spec: `spec.md`
- Requirements: `planning/requirements.md`
- Existing implementation: `src/ast/diagram_generator.py`, `src/ast/ctags_provider.py`

## Task List

### Diagram Model + Builder Extraction

#### Task Group 1: Introduce DiagramModel and Extract Builders
**Dependencies:** Existing `src/ast/diagram_generator.py`

- [x] 1.0 Complete DiagramModel and builder extraction
  - [x] 1.1 Create `src/ast/diagram_model.py`
    - `DiagramEntity` dataclass: id, name, entity_type, parent_id, properties (dict)
    - `DiagramRelationship` dataclass: source_id, target_id, rel_type, label
    - `DiagramModel` dataclass: diagram_type, title, entities, relationships, metadata (dict)
  - [x] 1.2 Create `src/ast/diagram_builders.py`
    - Extract file readers from `DiagramGenerator` into shared module-level functions: `read_index()`, `read_inheritance()`, `read_imports()`, `read_patterns()`
    - `ClassDiagramBuilder.build(snapshot_path) → DiagramModel` — reads `_index.txt` + `_inheritance.txt`, produces DiagramModel with class entities and inheritance relationships
    - `InheritanceTreeBuilder.build(snapshot_path) → DiagramModel` — reads `_inheritance.txt`
    - `DependencyGraphBuilder.build(snapshot_path) → DiagramModel` — reads `_imports.txt`
    - `ComponentDiagramBuilder.build(snapshot_path) → DiagramModel` — reads `_imports.txt`, groups by directory
    - `PatternMapBuilder.build(snapshot_path) → DiagramModel` — reads `_patterns.txt` + `_index.txt`
  - [x] 1.3 Write tests: `tests/ast/test_diagram_model.py`
    - Test DiagramEntity construction with all fields
    - Test DiagramRelationship construction
    - Test DiagramModel construction with entities and relationships
    - Test DiagramModel with empty entities/relationships
  - [x] 1.4 Write tests: `tests/ast/test_diagram_builders.py`
    - Test ClassDiagramBuilder produces DiagramModel with correct entities from known `_index.txt`
    - Test ClassDiagramBuilder includes inheritance relationships from `_inheritance.txt`
    - Test InheritanceTreeBuilder produces edges from known data
    - Test DependencyGraphBuilder produces module dependency edges
    - Test ComponentDiagramBuilder groups by directory
    - Test PatternMapBuilder groups by pattern type
    - Test each builder handles empty/missing files gracefully
  - [x] 1.5 Ensure all new tests pass
    - Run: `pytest tests/ast/test_diagram_model.py tests/ast/test_diagram_builders.py -v`

**Acceptance Criteria:**
- DiagramModel is a clean format-agnostic representation
- Each builder reads from index files (not analysis models)
- Builders handle missing/empty files without crashing
- File reader functions are shared (not duplicated per builder)

---

### Mermaid Serialiser Extraction

#### Task Group 2: Extract MermaidSerialiser + Refactor DiagramGenerator
**Dependencies:** Task Group 1

- [x] 2.0 Complete Mermaid serialiser extraction
  - [x] 2.1 Create `src/ast/mermaid_serialiser.py`
    - `MermaidSerialiser` class
    - `serialise(model: DiagramModel) → str` — converts DiagramModel to Mermaid syntax
    - `_serialise_class_diagram(model) → str` — classDiagram syntax with members, visibility, inheritance
    - `_serialise_graph(model, direction="TD") → str` — graph TD/LR syntax for trees, dependencies, components
    - `_serialise_pattern_map(model) → str` — pattern-specific Mermaid syntax
    - Move `_sanitize_id()` and `_mermaid_visibility()` helpers here
  - [x] 2.2 Refactor `src/ast/diagram_generator.py`
    - Remove all Mermaid syntax generation code
    - Remove `_read_index`, `_read_inheritance`, `_read_imports`, `_read_patterns` (moved to builders)
    - Remove `_sanitize_id`, `_mermaid_visibility` (moved to serialiser)
    - `generate_all(snapshot_path)` now:
      1. Calls each builder to get DiagramModel
      2. Calls MermaidSerialiser to convert to Mermaid string
      3. Writes output to `diagrams/` directory
    - Keep `_write_diagram()` method
    - External interface unchanged: `DiagramGenerator().generate_all(snapshot_path)` still works
  - [x] 2.3 Write tests: `tests/ast/test_mermaid_serialiser.py`
    - Test serialise class diagram produces valid classDiagram syntax
    - Test class members have correct visibility prefixes (+, -, #)
    - Test inheritance relationships produce correct arrows (--|>, ..|>)
    - Test serialise graph produces valid graph TD/LR syntax
    - Test serialise handles empty DiagramModel (returns empty/minimal output)
    - Test sanitize_id handles special characters
  - [x] 2.4 Verify ALL 9 existing diagram tests still pass unchanged
    - Run: `pytest tests/ast/test_diagram_generator.py -v`
    - Zero modifications to existing test file
  - [x] 2.5 Verify ALL 42 existing tests still pass
    - Run: `pytest tests/ast/ -v`

**Acceptance Criteria:**
- `MermaidSerialiser` produces identical output to the original `DiagramGenerator` for all diagram types
- `DiagramGenerator.generate_all()` external interface unchanged
- ALL 9 existing diagram tests pass without modification
- ALL 42 existing tests pass without modification
- No Mermaid-specific code remains in `diagram_generator.py`

---

### Versioned Kind Mappings

#### Task Group 3: Move ctags Kind Map to Versioned YAML
**Dependencies:** Existing `src/ast/ctags_provider.py`

- [x] 3.0 Complete versioned kind mapping
  - [x] 3.1 Create `config/symbol_kind_mappings.yaml`
    - ctags section with current version entry (detect from installed ctags)
    - Copy exact mappings from existing `CTAGS_KIND_MAP` dict
    - Include comment header explaining format and versioning
  - [x] 3.2 Create `src/ast/kind_mapping_loader.py`
    - `load_kind_mappings(provider: str, version: str, config_path: str) → dict`
    - Loads YAML, looks up provider section, looks up version
    - Hard stop (raises `VersionNotFoundError`) if version not in YAML
    - Returns dict mapping tool labels → canonical SymbolKind values
    - `detect_ctags_version() → str` — runs `ctags --version`, parses version string
  - [x] 3.3 Refactor `src/ast/ctags_provider.py`
    - Remove `CTAGS_KIND_MAP` hardcoded dict
    - Load mappings from YAML via `kind_mapping_loader` at init or first use
    - `_map_tag()` uses loaded mappings instead of class constant
    - Fallback behaviour when YAML not found: log warning, use inline defaults (for backward compat during transition)
  - [x] 3.4 Write tests: `tests/ast/test_kind_mapping_loader.py`
    - Test load succeeds for known version in test YAML fixture
    - Test load raises VersionNotFoundError for unknown version
    - Test load returns correct mapping values (member → method, field → variable, etc.)
    - Test detect_ctags_version parses version string correctly
    - Test fallback when YAML file missing
  - [x] 3.5 Verify ALL existing ctags provider tests still pass
    - Run: `pytest tests/ast/test_ctags_provider.py -v`
    - Mapping tests must produce identical results (member→METHOD, function→FUNCTION, etc.)
  - [x] 3.6 Verify ALL 42 existing tests still pass
    - Run: `pytest tests/ast/ -v`

**Acceptance Criteria:**
- `CTAGS_KIND_MAP` no longer hardcoded in Python
- Mappings loaded from `config/symbol_kind_mappings.yaml`
- Version detection works for installed ctags
- Hard stop (`VersionNotFoundError`) on unknown version — with clear error message
- Backward compatible: if YAML missing, falls back to inline defaults with warning
- ALL existing ctags provider tests pass (mapping results identical)
- ALL 42 existing tests pass

---

## Execution Order

1. **Task Group 1: DiagramModel + Builders** — new modules, no changes to existing code
2. **Task Group 2: MermaidSerialiser + Refactor** — replaces internals of DiagramGenerator, preserves external interface
3. **Task Group 3: Versioned Kind Mappings** — refactors CtagsProvider, preserves mapping results

Task Groups 1 and 3 are independent — they could be done in parallel. Task Group 2 depends on Task Group 1.

## Completion Criteria

Part 1 refactor is complete when ALL of the following are true:
- DiagramModel exists as a format-agnostic intermediate representation
- 5 diagram builders produce DiagramModel from index files
- MermaidSerialiser converts DiagramModel to Mermaid syntax
- DiagramGenerator orchestrates builders + serialiser (external interface unchanged)
- ctags kind mappings loaded from versioned YAML
- Hard stop on unknown ctags version
- **ALL 42 existing tests pass without modification**
- New tests added for DiagramModel, builders, serialiser, kind mapping loader
- No new output formats yet — Mermaid only (Part 2 adds PlantUML, Graphviz, metamodel)
