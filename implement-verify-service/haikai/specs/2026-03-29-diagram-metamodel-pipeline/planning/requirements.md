# Requirements: Diagram & Metamodel Pipeline

## Feature Description

A unified pipeline transforming structural analysis data (ctags/LSP) into multiple output formats via an internal Diagram Model and pluggable serialisers. Supports Mermaid, PlantUML, Graphviz (DOT), and external metamodel diagram definitions. All mappings are version-controlled via YAML — provider kind mappings, metamodel entity mappings, and diagram syntax definitions. Hard stop on unknown versions at every layer. Includes metamodel population engine for enriching architecture.json with structural data.

## Technology Stack

- Python 3.11+ (FastAPI backend)
- Existing `src/ast/` module (models, providers, file store)
- Existing `src/metamodel_gateway.py` (metamodel fetch from external provider)
- YAML config files for all versioned mappings
- Mermaid, PlantUML, Graphviz DOT as output formats

## Requirements

### Versioned Mapping Layer (3 layers, all YAML, all hard stop)

**Layer 1 — Provider → Canonical SymbolKind:**
- Move ctags kind mappings from `CtagsProvider.CTAGS_KIND_MAP` dict to `config/symbol_kind_mappings.yaml`
- Explicit per-version entries for ctags (keyed by `ctags --version` output)
- Explicit per-server per-version entries for LSP (keyed by server name + version)
- Provider detects installed tool version at startup
- Hard stop if version not found in YAML — refuse to run, clear error message
- No fallback between versions — prevents silent mislabelling if a kind label is repurposed

**Layer 2 — Canonical SymbolKind → Metamodel Entities:**
- `config/metamodel_mappings.yaml` keyed by metamodel `version_id` (integer, provided by external metamodel)
- Direct kind-to-entity mappings (class→classes, method→methods, interface→interfaces)
- Detection heuristic mappings for higher-level entities (services, app_components, endpoints, data entities)
- Relationship mappings (imports between services → interactions, inheritance → class hierarchy)
- LLM fallback for ambiguous entity classification
- Hard stop if `version_id` not found in YAML

**Layer 3 — Diagram Model → Output Format:**
- `config/diagram_serialisers.yaml` with per-format per-version syntax definitions
- Bundled and maintained in our codebase (not fetched from providers — no APIs available)
- Four formats: Mermaid, PlantUML, Graphviz (DOT), external metamodel
- Each format versioned independently
- Hard stop if requested format version not found in YAML

### Internal Diagram Model
- Format-agnostic intermediate representation: `DiagramModel` with `DiagramEntity` and `DiagramRelationship`
- All serialisers consume this model — they never touch structural data directly
- 10 diagram type builders, each reading from the structural file store:
  - Tier 1 (ctags): class, inheritance, dependency, component, package structure, pattern map
  - Tier 2 (LSP): sequence, data flow
  - Tier 3 (LLM-assisted): architecture, state machine

### Serialisers
- Abstract `DiagramSerialiser` interface with `serialise(model, syntax) → str`
- Four concrete implementations: Mermaid, PlantUML, Graphviz, Metamodel
- Each loads syntax rules from YAML config for the requested version
- Mermaid serialiser outputs `.mmd` files
- PlantUML serialiser outputs `.puml` files
- Graphviz serialiser outputs `.dot` files
- Metamodel serialiser outputs `diagram_nodes` and `diagram_edges` JSON matching architecture.json format

### Metamodel Population Engine
- Separate from diagram generation — populates metamodel **entities** (applications, services, classes, etc.)
- Integrates with existing `MetamodelGateway` (fetch from external provider)
- Flow: fetch metamodel → check version_id → load mappings → apply to structural data → return enriched JSON
- Direct mappings for deterministic kind-to-entity translations
- Detection heuristics for higher-level entities (services via Dockerfile/entrypoint, components via directory structure)
- LLM for ambiguous classification
- Does NOT store metamodels — caller provides theirs, we populate and return

### API Endpoints (5, use-case driven)
1. `POST /api/v1/structural/analyze` — trigger analysis, write to file store
2. `POST /api/v1/structural/{repo}/raw` — return raw structural data from file store
3. `POST /api/v1/structural/{repo}/query` — Q&A: natural language question → answer from file store + LLM
4. `POST /api/v1/structural/{repo}/metamodel/populate` — populate metamodel with structural data
5. `POST /api/v1/structural/{repo}/diagrams/generate` — generate diagrams in specified formats and versions

### YAML Config Files (5 total)
1. `config/symbol_kind_mappings.yaml` — provider kind → canonical SymbolKind (versioned per tool)
2. `config/metamodel_mappings.yaml` — canonical → metamodel entities (versioned per version_id)
3. `config/diagram_serialisers.yaml` — diagram model → output format syntax (versioned per format)
4. `config/structural_store.yaml` — store paths, snapshot retention (operational)
5. `config/analysis_providers.yaml` — provider toggles (operational)

## Constraints

- Diagram syntax definitions are bundled — Mermaid/PlantUML/Graphviz don't provide schema APIs
- Metamodel diagram node positions default to 0,0 — the external app handles layout unless positions are provided
- Sequence diagrams require LSP call graph data (not available with ctags only)
- LLM-assisted diagrams are non-deterministic — same input may produce different architectural interpretations
- Detection heuristics for services/components are language/framework-dependent — may need tuning per project

## Out of Scope

- Rendering diagrams to images (generate source only; rendering is external)
- Interactive diagram editing
- Auto-layout algorithms for metamodel diagram nodes
- Live/streaming diagram updates
- Custom diagram types beyond the 10 defined
- Fetching diagram format schemas from external APIs (bundled only)
