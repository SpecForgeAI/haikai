# Diagram generation

8 builders × 4 serialisers, with a `DiagramModel` in between. Lives in `src/ast/diagram_*.py`. Reads the [[structural-store]] index files and produces visual artifacts.

## The shape of the system

```
┌────────────────────────────────────────────────────────────┐
│ Snapshot (the structural store)                            │
│   _index.txt _calls.txt _imports.txt _inheritance.txt …    │
└──────────────────────┬─────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
       (8 builders)       — read tab-separated index files
              │
              ▼
       DiagramModel       — entities + relationships, format-agnostic
              │
              ▼
       (4 serialisers)    — render to specific output format
              │
              ▼
       .mmd / .puml / .dot / .json
```

The `DiagramModel` middle layer is the load-bearing decoupling: builders don't know about Mermaid syntax, serialisers don't know about ctags index files. Adding a new diagram type = new builder. Adding a new output format = new serialiser. Both extend independently.

## The 8 builders

From `src/ast/diagram_builders.py`:

| Builder | Inputs (from store) | Output |
|---|---|---|
| `ClassDiagramBuilder` | `_index.txt` + `_inheritance.txt` | Class relationships (composition + inheritance) |
| `InheritanceTreeBuilder` | `_inheritance.txt` | Class hierarchy (extends/implements only) |
| `DependencyGraphBuilder` | `_imports.txt` | Module-to-module imports |
| `ComponentDiagramBuilder` | `_imports.txt` (grouped by directory) | Package-level dependencies |
| `PackageStructureBuilder` | `_index.txt` (grouped by path) | Directory layout as boxes |
| `PatternMapBuilder` | `_patterns.txt` + `_index.txt` | Detected design patterns by location |
| `SequenceDiagramBuilder` | `_calls.txt` | Call chains (control flow) |
| `DataFlowBuilder` | `_calls.txt` + `_imports.txt` + `_index.txt` | Data movement paths across symbols |

Each builder reads tab-separated lines via shared helpers (`read_index`, `read_calls`, etc. in `diagram_builders.py`) and emits a `DiagramModel(entities=[...], relationships=[...])`.

## The 4 serialisers

From `src/ast/diagram_generator.py`:

| Format | Serialiser | Extension | Use case |
|---|---|---|---|
| `mermaid` | `MermaidSerialiser` | `.mmd` | Markdown-embeddable, GitHub-rendered |
| `plantuml` | `PlantUMLSerialiser` | `.puml` | Detailed enterprise architecture diagrams |
| `graphviz` | `GraphvizSerialiser` | `.dot` | Algorithmic layouts, large graphs |
| `metamodel` | `MetamodelSerialiser` | `.json` | Machine-readable handoff to other tools |

The `_SERIALISER_MAP` is the source of truth for format → (instance, extension). One pass through it produces all four formats from a single `DiagramModel`.

## Where outputs land

`ast-reports/<job>/structural/<repo>/<commit-sha>/diagrams/`:

```
diagrams/
  class-diagram.{mmd,puml,dot,json}
  inheritance-tree.{mmd,puml,dot,json}
  dependency-graph.{mmd,puml,dot,json}
  component-diagram.{mmd,puml,dot,json}
  package-structure.{mmd,puml,dot,json}
  pattern-map.{mmd,puml,dot,json}
  sequence-overview.{mmd,puml,dot,json}
  data-flow.{mmd,puml,dot,json}
```

8 × 4 = 32 files per snapshot when running `generate_all`.

## Read-only on the structural store

Builders never write to the store, never re-extract, never call ctags or tree-sitter directly. They consume what's already there. This is what makes diagram generation **fast** (read tab-separated text, produce diagrams) and **idempotent** (same snapshot → same diagrams).

If the store doesn't have the data a builder needs (e.g. `_inheritance.txt` is missing), the builder returns an empty `DiagramModel` rather than crashing.

## diagram-discoverer is something different

`src/ast/diagram_discoverer.py` is **not** part of this layer. It's an LLM-driven skill that decides *which diagrams to generate* and *what to focus them on* — a higher-level skill that calls into this layer for the mechanical render. Treat the two as separate concerns.

## Cross-references

- [[structural-store]] — the input layer
- [[v2-extraction-pipeline]] — produces the snapshots that diagrams render
- [[ast-vs-llm-split]] — diagrams are firmly on the AST/mechanical side; LLM only enters via `diagram_discoverer.py` for *picking* diagrams, not for drawing them.

## Sources

- `src/ast/diagram_generator.py`, `src/ast/diagram_builders.py`, `src/ast/diagram_model.py`
- `src/ast/{mermaid,plantuml,graphviz,metamodel}_serialiser.py`
- `docs/ARCHITECTURE.md` § "Diagram Generation"
- [[../../raw/2026-05-04_codebase-walk]]
