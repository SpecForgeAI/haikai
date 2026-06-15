# Specification: Diagram & Metamodel Pipeline

## Summary

A unified pipeline that transforms structural analysis data (ctags/LSP) into multiple output formats: Mermaid, PlantUML, Graphviz (DOT), and external metamodel diagram definitions (e.g., architecture.json). Uses an internal Diagram Model as a format-agnostic intermediate representation, with pluggable serialisers per output format. All mappings are version-controlled via YAML configs — provider kind mappings, metamodel entity mappings, and diagram syntax definitions. Hard stop on unknown versions at every layer.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Structural Data (ctags/LSP)                   │
│              symbols, inheritance, imports, calls                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │  Symbol Kind Mappings    │  config/symbol_kind_mappings.yaml
              │  (versioned per tool)    │  ctags 6.1 "member" → METHOD
              │  HARD STOP on unknown   │  LSP pyright 1.1.380 "Class" → CLASS
              └────────────┬────────────┘
                           │
              ┌────────────▼────────────┐
              │  Canonical SymbolKind    │  class, method, function, variable...
              │  (internal contract)     │
              └─────┬──────────┬────────┘
                    │          │
       ┌────────────▼──┐  ┌───▼──────────────┐
       │ Metamodel      │  │ Diagram Model    │
       │ Mapping Engine │  │ (format-agnostic)│
       │                │  │ entities +       │
       │ config/        │  │ relationships    │
       │ metamodel_     │  │                  │
       │ mappings.yaml  │  │                  │
       │ (versioned per │  │                  │
       │  version_id)   │  │                  │
       │ HARD STOP      │  │                  │
       └───────┬────────┘  └──┬───┬───┬───┬──┘
               │              │   │   │   │
               ▼              ▼   ▼   ▼   ▼
        Populated        Mermaid  PUML DOT Metamodel
        architecture.json         serialisers
        (entities)                (config/diagram_serialisers.yaml)
                                  (versioned per format)
                                  HARD STOP on unknown
```

---

## Three Versioned Mapping Layers

Every mapping layer follows the same rules:
- **Explicit per-version entries** — no fallback, no guessing
- **Hard stop on unknown version** — refuse to run, clear error message
- **YAML-based** — editable without code changes

### Layer 1: Provider → Canonical SymbolKind

Maps tool-specific kind labels to our canonical vocabulary.

**File:** `config/symbol_kind_mappings.yaml`

```yaml
ctags:
  "6.1.0":
    class: class
    function: function
    member: method
    method: method
    field: variable
    variable: variable
    property: property
    constant: constant
    interface: interface
    enum: class
    struct: class
    module: module
    namespace: module
    package: module
    decorator: decorator
    generator: function
    local: variable

lsp:
  pyright:
    "1.1.380":
      Class: class
      Method: method
      Function: function
      Field: variable
      Property: property
      Interface: interface
      Variable: variable
      Constant: constant
      Module: module
      Enum: class

  typescript-language-server:
    "4.3.0":
      Class: class
      Method: method
      Function: function
      Field: variable
      Property: property
      Interface: interface
      Variable: variable
      Constant: constant
      Module: module
      Enum: class
```

**Behaviour:**
1. Provider starts → runs `ctags --version` or queries LSP `initialize` response for server version
2. Looks up version in YAML
3. If found → loads mappings, proceeds
4. If NOT found → hard stop, error: `"ctags version 6.3.0 not found in symbol_kind_mappings.yaml. Add version entry before running."`

### Layer 2: Canonical SymbolKind → Metamodel Entities

Maps our canonical kinds to metamodel entity types. Versioned against the metamodel's `version_id`.

**File:** `config/metamodel_mappings.yaml`

```yaml
"1":    # matches version_id from architecture.json
  entity_mappings:
    # Direct kind → entity mappings
    classes:
      source_kind: class

    methods:
      source_kind: method
      parent_ref: scope → classes

    interfaces:
      source_kind: interface

    # Detection heuristic mappings
    services:
      detect_by:
        - has_dockerfile
        - has_main_entrypoint
        - has_api_routes
      core_tech_from: primary_language

    app_components:
      detect_by:
        - top_level_directory_with_sources

    endpoints:
      detect_by:
        - has_route_decorator
      extract:
        - route_path
        - http_method

    physical_data_entities:
      detect_by:
        - extends_orm_base
        - has_entity_decorator

    logical_data_entities:
      detect_by:
        - is_pydantic_model
        - is_dto_class

  relationship_mappings:
    interactions:
      source: imports
      between: services

    inheritance:
      source: inheritance
      maps_to: class_hierarchy
```

**Behaviour:**
1. Read `version_id` from the metamodel JSON provided by the external provider
2. Look up version in YAML
3. If found → load entity and relationship mappings, proceed
4. If NOT found → hard stop, error: `"Metamodel version_id 3 not found in metamodel_mappings.yaml. Add version entry before running."`

### Layer 3: Diagram Model → Output Format

Versioned syntax definitions per output format. Bundled and maintained in our codebase.

**File:** `config/diagram_serialisers.yaml`

```yaml
mermaid:
  "10.6":
    supported_diagrams:
      - classDiagram
      - graph
      - sequenceDiagram
      - stateDiagram
      - flowchart
    syntax:
      class_declaration: "class {name}"
      class_with_members: "class {name} {\n  {members}\n}"
      member_visibility:
        public: "+"
        private: "-"
        protected: "#"
      inheritance: "{child} --|> {parent}"
      composition: "{whole} *-- {part}"
      dependency: "{source} ..> {target}"
      note: "note for {class} \"{text}\""

  "11.0":
    supported_diagrams:
      - classDiagram
      - graph
      - sequenceDiagram
      - stateDiagram
      - flowchart
      - mindmap
    syntax:
      class_declaration: "class {name}"
      class_with_members: "class {name} {\n  {members}\n}"
      member_visibility:
        public: "+"
        private: "-"
        protected: "#"
        package: "~"
      inheritance: "{child} --|> {parent}"
      composition: "{whole} *-- {part}"
      dependency: "{source} ..> {target}"
      note: "note for {class} \"{text}\""

plantuml:
  "2024.0":
    supported_diagrams:
      - class
      - sequence
      - component
      - state
      - activity
      - object
    syntax:
      class_declaration: "class {name}"
      class_with_members: "class {name} {{\n  {members}\n}}"
      member_visibility:
        public: "+"
        private: "-"
        protected: "#"
        package: "~"
      inheritance: "{child} --|> {parent}"
      composition: "{whole} *-- {part}"
      dependency: "{source} ..> {target}"
      note: "note right of {class} : {text}"
      stereotype: "<<{name}>>"

graphviz:
  "2.43":
    supported_diagrams:
      - digraph
      - graph
    syntax:
      node: '"{name}" [label="{label}", shape={shape}]'
      edge: '"{source}" -> "{target}"'
      subgraph: "subgraph cluster_{name} {{\n  label=\"{label}\"\n  {children}\n}}"
      class_shape: "record"
      module_shape: "box"
      interface_shape: "ellipse"
      rankdir: "TB"

  "12.0":
    supported_diagrams:
      - digraph
      - graph
    syntax:
      node: '"{name}" [label="{label}", shape={shape}]'
      edge: '"{source}" -> "{target}"'
      subgraph: "subgraph cluster_{name} {{\n  label=\"{label}\"\n  {children}\n}}"
      class_shape: "record"
      module_shape: "box"
      interface_shape: "ellipse"
      rankdir: "TB"

metamodel:
  "1":    # matches version_id
    supported_diagrams:
      - General
      - ClassDiagram
      - ComponentDiagram
    node_template:
      id: "node-{uuid}"
      entity_type: "{type}"
      entity_id: "{entity_id}"
      pos_x: 0.0
      pos_y: 0.0
      width: 120.0
      height: 32.0
      auto_size: false
      z_index: 0
      parent_node_id: null
    edge_template:
      id: "edge-{uuid}"
      source_node_id: "{source}"
      target_node_id: "{target}"
      edge_type: "{type}"
```

**Behaviour:**
1. Caller specifies target format and version (e.g., `mermaid 10.6`)
2. Look up in YAML
3. If found → load syntax rules, serialise Diagram Model using those rules
4. If NOT found → hard stop, error: `"Mermaid version 12.0 not found in diagram_serialisers.yaml. Add version entry before running."`

---

## Internal Diagram Model

Format-agnostic intermediate representation. All serialisers consume this — they never touch structural data directly.

```python
@dataclass
class DiagramEntity:
    id: str
    name: str
    entity_type: str          # class, method, service, component, etc.
    parent_id: Optional[str]  # for nesting (methods in classes, services in components)
    properties: dict          # signatures, visibility, flags, etc.

@dataclass  
class DiagramRelationship:
    source_id: str
    target_id: str
    rel_type: str             # extends, implements, imports, calls, etc.
    label: Optional[str]

@dataclass
class DiagramModel:
    diagram_type: str         # class, inheritance, dependency, component, sequence, etc.
    title: str
    entities: list[DiagramEntity]
    relationships: list[DiagramRelationship]
    metadata: dict            # language, repo, snapshot info
```

### Diagram Model Builders

One builder per diagram type. Each reads from the structural file store and produces a `DiagramModel`:

| Builder | Reads From | Produces |
|---------|-----------|----------|
| `ClassDiagramBuilder` | `_index.txt` + `_inheritance.txt` | classes with members + inheritance relationships |
| `InheritanceTreeBuilder` | `_inheritance.txt` | class hierarchy |
| `DependencyGraphBuilder` | `_imports.txt` | file/module dependency graph |
| `ComponentDiagramBuilder` | `_imports.txt` (grouped by directory) | high-level component relationships |
| `PackageStructureBuilder` | `_index.txt` (grouped by path) | package/directory breakdown |
| `PatternMapBuilder` | `_patterns.txt` + `_index.txt` | patterns overlaid on structure |
| `SequenceDiagramBuilder` | `_calls.txt` (LSP tier) | call chain from entry point |
| `DataFlowBuilder` | `_calls.txt` + `_imports.txt` (LSP tier) | data movement through system |
| `ArchitectureBuilder` | all files + LLM | inferred architectural layers |
| `StateMachineBuilder` | `_index.txt` + `_patterns.txt` + LLM | state transitions |

---

## Serialisers

Each serialiser takes a `DiagramModel` + syntax rules from the YAML and outputs the target format.

```python
class DiagramSerialiser(ABC):
    @abstractmethod
    def serialise(self, model: DiagramModel, syntax: dict) -> str:
        """Convert DiagramModel to output format string."""
        pass

class MermaidSerialiser(DiagramSerialiser):
    """Outputs Mermaid syntax."""

class PlantUMLSerialiser(DiagramSerialiser):
    """Outputs PlantUML syntax."""

class GraphvizSerialiser(DiagramSerialiser):
    """Outputs DOT syntax."""

class MetamodelSerialiser(DiagramSerialiser):
    """Outputs metamodel diagram_nodes and diagram_edges JSON."""
```

---

## Metamodel Population Engine

Separate from diagrams — this populates the metamodel's **entities** section (applications, services, classes, etc.), not just diagrams.

### Flow

```
1. External metamodel provider → MetamodelGateway.get_from_endpoint()
   → architecture.json with version_id

2. Read version_id → load metamodel_mappings.yaml for that version
   → hard stop if unknown version

3. Read structural file store (_index.txt, _inheritance.txt, _imports.txt, etc.)

4. Apply entity mappings:
   - Direct: kind "class" → metamodel entity "classes"
   - Heuristic: directory with Dockerfile → metamodel entity "services"
   - LLM: ambiguous cases → ask LLM to classify

5. Apply relationship mappings:
   - imports between services → "interactions"
   - inheritance → "class hierarchy"

6. Populate metamodel JSON with mapped entities and relationships

7. Optionally: run Diagram Model builders + MetamodelSerialiser
   → populate diagrams section with nodes and edges

8. Return enriched architecture.json
```

---

## API Endpoints

Five use-case-driven endpoints:

### 1. `POST /api/v1/structural/analyze`

Trigger structural analysis on a repo. Writes results to file store.

**Request:**
```json
{
  "repo_url": "https://github.com/SpecForgeAI/deepagent-bot",
  "branch": "main",
  "providers": ["ctags"]
}
```

**Response:**
```json
{
  "snapshot_id": "abc1234",
  "repo": "deepagent-bot",
  "file_count": 72,
  "symbol_count": 2156,
  "store_path": ".specforge/structural/deepagent-bot/abc1234/"
}
```

### 2. `POST /api/v1/structural/{repo}/raw`

Return the raw structural data from the file store.

**Request:**
```json
{
  "snapshot": "latest",
  "include": ["index", "inheritance", "imports", "patterns", "stats"]
}
```

**Response:**
```json
{
  "snapshot_id": "abc1234",
  "index": "file\tkind\tname\tscope\tsignature\tline\tflags\n...",
  "inheritance": "child\trel\tparent\tfile\n...",
  "imports": "file\timports\tnames\n...",
  "patterns": "pattern\tconfidence\tsymbol\tfile\tevidence\n...",
  "stats": "Repository: deepagent-bot\n..."
}
```

### 3. `POST /api/v1/structural/{repo}/query`

Ask a natural language question about the codebase.

**Request:**
```json
{
  "question": "What classes extend BaseService?",
  "snapshot": "latest"
}
```

**Response:**
```json
{
  "answer": "3 classes extend BaseService: UserService (src/services/user.py), PaymentService (src/services/payment.py), OrderService (src/services/order.py)",
  "evidence": ["_inheritance.txt lines matching BaseService"],
  "method": "direct_lookup"
}
```

### 4. `POST /api/v1/structural/{repo}/metamodel/populate`

Populate a metamodel with structural data.

**Request:**
```json
{
  "metamodel_id": "arch-model-v2",
  "snapshot": "latest"
}
```

**Response:** Enriched architecture.json with populated entities and optionally diagrams.

### 5. `POST /api/v1/structural/{repo}/diagrams/generate`

Generate diagrams from structural data.

**Request:**
```json
{
  "snapshot": "latest",
  "types": ["class", "inheritance", "dependency", "component"],
  "formats": ["mermaid", "graphviz"],
  "mermaid_version": "10.6",
  "graphviz_version": "2.43"
}
```

**Response:**
```json
{
  "diagrams": {
    "class": {
      "mermaid": "classDiagram\n  class UserService {\n    +get_user()\n  }\n  ...",
      "graphviz": "digraph class_diagram {\n  ..."
    },
    "inheritance": {
      "mermaid": "graph TD\n  UserService --> BaseService\n  ...",
      "graphviz": "digraph inheritance {\n  ..."
    }
  },
  "files_written": [
    ".specforge/structural/deepagent-bot/latest/diagrams/class-diagram.mmd",
    ".specforge/structural/deepagent-bot/latest/diagrams/class-diagram.dot"
  ]
}
```

---

## YAML Config Files

| File | Purpose | Versioned Against |
|------|---------|-------------------|
| `config/symbol_kind_mappings.yaml` | Provider kind labels → canonical SymbolKind | ctags version, LSP server+version |
| `config/metamodel_mappings.yaml` | Canonical SymbolKind → metamodel entity types | metamodel `version_id` |
| `config/diagram_serialisers.yaml` | Diagram Model → output format syntax | Mermaid/PlantUML/Graphviz/metamodel version |
| `config/structural_store.yaml` | Store paths, snapshot retention, auto-generate | N/A (operational config) |
| `config/analysis_providers.yaml` | Provider toggles (ctags/LSP/LLM enabled) | N/A (operational config) |

---

## Implementation Plan

### Phase 1: Versioned Mapping Layer
1. Create `config/symbol_kind_mappings.yaml` with ctags 6.x entries
2. Refactor `CtagsProvider` to load mappings from YAML instead of hardcoded dict
3. Version detection: `ctags --version` parsing
4. Hard stop logic on unknown version
5. Tests: known version loads, unknown version stops

### Phase 2: Diagram Model + Builders
1. `src/ast/diagram_model.py` — DiagramEntity, DiagramRelationship, DiagramModel
2. Builders: ClassDiagramBuilder, InheritanceTreeBuilder, DependencyGraphBuilder, ComponentDiagramBuilder, PackageStructureBuilder, PatternMapBuilder
3. Builders read from file store (not from in-memory models)
4. Tests: each builder produces valid DiagramModel from known file store data

### Phase 3: Serialisers
1. `src/ast/serialisers/` — MermaidSerialiser, PlantUMLSerialiser, GraphvizSerialiser, MetamodelSerialiser
2. Create `config/diagram_serialisers.yaml` with version entries
3. Each serialiser loads syntax rules from YAML
4. Hard stop on unknown format version
5. Tests: each serialiser produces valid output for known DiagramModel

### Phase 4: Metamodel Population Engine
1. `src/ast/metamodel_engine.py` — mapping engine
2. Create `config/metamodel_mappings.yaml` with version_id 1 entries
3. Direct mappings (kind → entity)
4. Detection heuristics (services, components, endpoints)
5. LLM fallback for ambiguous cases
6. Integration with existing MetamodelGateway
7. Hard stop on unknown version_id
8. Tests: known structural data produces correct metamodel entities

### Phase 5: API Endpoints
1. `POST /api/v1/structural/analyze`
2. `POST /api/v1/structural/{repo}/raw`
3. `POST /api/v1/structural/{repo}/query`
4. `POST /api/v1/structural/{repo}/metamodel/populate`
5. `POST /api/v1/structural/{repo}/diagrams/generate`
6. Tests: endpoint integration tests

### Phase 6: LSP-Dependent Diagrams
1. Requires LSP provider implementation
2. SequenceDiagramBuilder, DataFlowBuilder
3. Read from `_calls.txt`

### Phase 7: LLM-Assisted Diagrams
1. ArchitectureBuilder, StateMachineBuilder
2. Feed structural data + LLM interpretation
3. Tests: LLM-mocked tests for deterministic validation

---

## Relationship to Other Specs

| Spec | Relationship |
|------|-------------|
| **AST Code Analysis** | Provides the structural data this pipeline consumes |
| **Persistent Structural Store** | Provides the file store this pipeline reads from |
| **Metamodel Validation** | This pipeline populates the metamodel that validation checks |

---

## Obtaining & Maintaining Diagram Format Schemas

None of the diagram format providers (Mermaid, PlantUML, Graphviz) offer a REST API to fetch their syntax schemas. We bundle versioned syntax definitions in `config/diagram_serialisers.yaml` and maintain them ourselves. Here's how to obtain the schema information for each format and for older versions:

### Mermaid

**Source:** GitHub repo `mermaid-js/mermaid` — https://github.com/mermaid-js/mermaid

**Where to find syntax definitions:**
- Official docs: https://mermaid.js.org/intro/ — each diagram type has a syntax page
- Grammar files: `packages/mermaid/src/diagrams/*/parser/` in the repo — JISON/Langium grammars define exact syntax
- Changelog: https://github.com/mermaid-js/mermaid/blob/develop/CHANGELOG.md — documents syntax changes per version
- npm releases: `npm view mermaid versions` — list all published versions

**How to get older versions:**
- `git checkout v10.6.0` on the repo — browse grammar files for that version
- npm: `npm pack mermaid@10.6.0` — download specific version's package
- Docs are versioned on the website (version selector in sidebar)

**Change frequency:** High — Mermaid adds new diagram types and syntax features across minor versions. Class diagram syntax has been mostly stable since v10, but new features (e.g., notes, namespaces, styles) get added.

**What to capture per version:**
- Supported diagram types (classDiagram, flowchart, sequenceDiagram, stateDiagram, etc.)
- Class member syntax (visibility markers: `+`, `-`, `#`, `~`)
- Relationship syntax (inheritance `--|>`, composition `*--`, dependency `..>`, etc.)
- Note syntax
- Styling/theming syntax if relevant

### PlantUML

**Source:** GitHub repo `plantuml/plantuml` — https://github.com/plantuml/plantuml

**Where to find syntax definitions:**
- Official docs: https://plantuml.com/ — comprehensive reference per diagram type
- Language specification: https://plantuml.com/sitemap-language-specification
- Grammar: PlantUML uses an internal ANTLR-like parser — syntax rules are in Java source under `src/net/sourceforge/plantuml/`
- Changelog: https://plantuml.com/changes — documents changes per version
- Releases: https://github.com/plantuml/plantuml/releases — versioned JARs

**How to get older versions:**
- GitHub releases page — download specific version JAR
- Maven Central: `plantuml:<version>` — all published versions available
- Docs site has a version selector for older syntax references
- `java -jar plantuml-<version>.jar -language` — outputs supported diagram types and keywords for that version

**Change frequency:** Low-moderate — PlantUML is mature. Core class/sequence/component syntax has been stable for years. New features (e.g., JSON diagrams, YAML diagrams, Gantt improvements) are additive and don't break existing syntax.

**What to capture per version:**
- Supported diagram types (class, sequence, component, state, activity, object, etc.)
- Class member syntax (visibility: `+`, `-`, `#`, `~`)
- Relationship syntax (`--|>`, `*--`, `o--`, `..>`, `..|>`, etc.)
- Stereotype syntax (`<<abstract>>`, `<<interface>>`, custom)
- Note syntax (`note right of`, `note left of`, `note on link`)
- Skinparam/styling if relevant

### Graphviz (DOT)

**Source:** GitLab repo `graphviz/graphviz` — https://gitlab.com/graphviz/graphviz

**Where to find syntax definitions:**
- Official docs: https://graphviz.org/doc/info/lang.html — the DOT language specification
- Attribute reference: https://graphviz.org/doc/info/attrs.html — all node/edge/graph attributes
- Shapes: https://graphviz.org/doc/info/shapes.html — all available node shapes
- Changelog: https://gitlab.com/graphviz/graphviz/-/blob/main/CHANGELOG.md

**How to get older versions:**
- GitLab tags — `git checkout <version>` for any historical release
- Package managers: `apt-cache showpkg graphviz` (Debian/Ubuntu), `brew info graphviz` (macOS)
- `dot -V` — reports installed version
- The DOT language itself is extremely stable — the grammar has barely changed since the 2.x series

**Change frequency:** Very low — the DOT language specification has been essentially frozen for years. New versions of Graphviz add rendering improvements, new output formats, and bug fixes, but the DOT syntax itself doesn't change. Node shapes and attributes accumulate slowly.

**What to capture per version:**
- Graph declaration syntax (`digraph`, `graph`, `subgraph`)
- Node declaration and attribute syntax
- Edge declaration (`->` for directed, `--` for undirected)
- Available shapes (record, box, ellipse, diamond, etc.)
- Subgraph/cluster syntax
- Layout engines (dot, neato, fdp, sfdp, circo, twopi)
- `rankdir`, `label`, `fontsize`, `color` and other key attributes

### Metamodel (External Provider)

**Source:** REST endpoint via existing `MetamodelGateway`

**Where to find schema:**
- Fetched from `METAMODEL_ENDPOINT_URL/{metamodel_id}`
- Schema version identified by `version_id` field in the JSON
- Schema structure defined by the external provider — we map to it, not define it

**How to get older versions:**
- The external provider manages versioning
- Request specific versions via the gateway endpoint if supported
- Store previously fetched schemas locally for reference

**Change frequency:** Controlled by the external provider — we have no control over this, which is why the hard stop on unknown `version_id` is critical.

### Maintenance Process

When adding support for a new version of any format:

1. **Identify changes** — read the changelog/release notes for the new version
2. **Update YAML** — add a new version entry to `config/diagram_serialisers.yaml`
3. **Test** — generate diagrams using the new syntax, validate they render correctly
4. **Commit** — version entry is now part of the codebase

When a version is NOT in the YAML, the system refuses to generate for that version — it never guesses syntax. This ensures every supported version has been explicitly verified.

---

## Out of Scope

- Rendering diagrams to images (we generate source; rendering is external)
- Interactive diagram editing
- Auto-layout for metamodel diagram nodes (positions are either default or from the external app)
- Live/streaming updates to diagrams as code changes
- Custom diagram types beyond the 10 defined
