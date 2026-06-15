# Specification: Agentic Diagram Generation

## Summary

Move diagram generation to the final pipeline step. Existing 8 mechanical builders stay. New enrichment-dependent diagrams are produced by an **agentic discoverer** — same pattern as `discover-endpoints` and `discover-interactions`. The LLM reads the structural store, decides what diagrams are worth generating, and outputs `DiagramModel` JSON. Serialisers are mechanical.

## Core Principle

> AST = mechanical extraction. LLM = interpretation.

The existing 8 builders are mechanical: they read index files and produce deterministic output. That's correct. But grouping endpoints by controller, deciding what blast radius matters, or choosing which interaction flows to highlight — that's interpretation. It belongs in the agentic loop.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Pipeline                          │
│                                                      │
│  Step 1: ctags → write_snapshot()                    │
│  Step 2: tree-sitter (imports, calls, inheritance)   │
│  Step 3: interaction classification (YAML + LLM)     │
│  Step 4: agentic endpoint discovery                  │
│  Step 5: agentic interaction discovery               │
│  Step 6: interaction enrichment                      │
│  Step 7: write final outputs                         │
│                                                      │
│  Step 8: DIAGRAM GENERATION (final)                  │
│    ├── 8a: Mechanical builders (existing 8)          │
│    │   └── _index, _calls, _imports, _inheritance,   │
│    │       _patterns → DiagramModel → serialise      │
│    │                                                  │
│    └── 8b: Agentic diagram discoverer (NEW)          │
│        └── LLM + tools reads ALL store files         │
│            (_endpoints, _interactions, _calls,        │
│             _index, _imports, _inheritance)           │
│            → DiagramModel JSON → serialise           │
└──────────────────────────────────────────────────────┘
```

## Step 8a: Mechanical Pass (existing)

No changes. `DiagramGenerator` runs all 8 builders as today:
- class-diagram, inheritance-tree, dependency-graph, component-diagram
- package-structure, pattern-map, sequence-overview, data-flow

Currently called inside `store.py:write_snapshot()`. Moved to end of `pipeline.py`.

## Step 8b: Agentic Pass (new)

### Pattern

Follows the exact same pattern as `endpoint_discoverer.py` and `interaction_discoverer.py`:

```python
# src/ast/diagram_discoverer.py

SKILL_FILE = "haikai-profiles/default/commands/discover-diagrams/single-agent/discover-diagrams.md"

def discover_diagrams(
    llm_client,
    project_root: str,
    snapshot_path: str,
) -> list[DiagramModel]:
    """Agentic diagram discovery.

    LLM reads the structural store and decides which
    enrichment-dependent diagrams to generate. Returns
    DiagramModel instances ready for serialisation.
    """
```

### Tools

Same tool set as other discoverers, plus two new readers:

| Tool | Reads | Purpose |
|------|-------|---------|
| `read_calls(file_pattern)` | `_calls.txt` | Call graph |
| `read_index(file_pattern)` | `_index.txt` | Symbol index |
| `read_imports(file_pattern)` | `_imports.txt` | Import graph |
| `read_inheritance(file_pattern)` | `_inheritance.txt` | Type hierarchy |
| `read_source(file_path, ...)` | source files | Raw code |
| **`read_endpoints(file_pattern)`** | `_endpoints.txt` | Discovered endpoints |
| **`read_interactions(file_pattern)`** | `_interactions.txt` | Discovered interactions |

### Output

The LLM produces `FINAL_ANSWER` as a JSON array of `DiagramModel` objects:

```json
[
  {
    "diagram_type": "api_surface",
    "title": "API Surface — OrderController, UserController",
    "entities": [
      {"id": "ctrl-order", "name": "OrderController", "entity_type": "controller"},
      {"id": "ep-get-orders", "name": "GET /api/orders", "entity_type": "endpoint", "parent_id": "ctrl-order", "properties": {"method": "GET", "path": "/api/orders", "protocol": "REST"}}
    ],
    "relationships": []
  },
  {
    "diagram_type": "interaction_flow",
    "title": "External Interactions — OrderService ↔ Kafka, PostgreSQL",
    "entities": [
      {"id": "svc-order", "name": "OrderService", "entity_type": "service"},
      {"id": "ext-kafka", "name": "order.created", "entity_type": "message_queue"},
      {"id": "ext-pg", "name": "orders", "entity_type": "database"}
    ],
    "relationships": [
      {"source_id": "svc-order", "target_id": "ext-kafka", "rel_type": "publishes", "label": "Kafka PUB — Order"},
      {"source_id": "svc-order", "target_id": "ext-pg", "rel_type": "writes", "label": "JPA WRITE — Order"}
    ]
  }
]
```

### Diagram Tiers

Three tiers control which diagrams the LLM generates:

**Required — always attempt, skip only on zero data:**

| Type | What It Shows |
|------|---------------|
| `enriched_data_flow` | Services → data stores/queues/APIs with real interaction targets + data entities on edges. Replaces mechanical `data-flow`. |
| `uml_component` | Services, controllers, repositories as UML components with provided/required interfaces |
| `erd` | Entity types with attributes, relationships (has_many, belongs_to, etc.). Built from `data_hint` + entity/model class inspection |

**Standard — generate when data meets threshold:**

| Type | Threshold |
|------|----------|
| `api_surface` | ≥3 endpoints spanning ≥2 controllers |
| `interaction_flow` | ≥2 interactions with ≥2 distinct external targets |
| `blast_radius` | Both endpoints AND interactions exist, ≥2 external systems |

**Opportunistic — LLM decides based on data:**
- `kafka_topology`, `database_access_map`, per-service sub-diagrams, etc.
- Any diagram type the LLM identifies as genuinely useful for the specific codebase

Serialisers handle unknown `diagram_type` values via a generic graph rendering fallback.

### Skill File

`haikai-profiles/default/commands/discover-diagrams/single-agent/discover-diagrams.md`

Defines the strategy — same structure as `discover-endpoints.md`:
1. **Survey phase:** Read `_endpoints.txt`, `_interactions.txt`, `_index.txt` to understand what data exists
2. **Decision phase:** Based on the data, decide which diagram types are worth generating (skip empty/sparse ones)
3. **Build phase:** For each diagram, read the relevant store files, construct entities and relationships
4. **Output:** `FINAL_ANSWER` as JSON array of `DiagramModel`

### Upgrading DataFlowBuilder

The existing `DataFlowBuilder` (mechanical) infers data stores from keywords in call names (`save`, `find`, `write`). When interaction data exists, the agentic pass produces an `enriched_data_flow` diagram with real interaction targets. The `DiagramGenerator` merges these: if an agentic `enriched_data_flow` exists, it replaces the mechanical `data-flow`. One diagram, best available data.

## Pipeline Integration

```python
# In pipeline.py — after all enrichment steps

# Step 8a: Mechanical diagrams
if store.auto_generate_diagrams:
    from src.ast.diagram_generator import DiagramGenerator
    generator = DiagramGenerator()
    generator.generate_all(Path(snapshot_path))

# Step 8b: Agentic diagrams (requires LLM)
if llm_client and store.auto_generate_diagrams:
    from src.ast.diagram_discoverer import discover_diagrams
    agentic_models = discover_diagrams(
        llm_client=llm_client,
        project_root=project_root,
        snapshot_path=snapshot_path,
    )
    if agentic_models:
        generator.serialise_models(agentic_models, Path(snapshot_path))
```

## Serialiser Changes

### New: Generic fallback for unknown diagram types

For any `diagram_type` not explicitly handled by a serialiser, render as a directed graph:
- Entities → nodes (labeled with name, shaped by entity_type)
- Relationships → edges (labeled with label or rel_type)

This means the LLM can invent diagram types without requiring serialiser changes.

### Entity type → shape mapping (new)

| Entity Type | Mermaid | PlantUML | Graphviz |
|------------|---------|----------|----------|
| `controller` | subgraph | package | cluster |
| `endpoint` | node (rounded) | rectangle | rectangle |
| `service` | node (rounded) | component | oval |
| `database` | node (cylinder) | database | cylinder |
| `message_queue` | node (stadium) | queue | parallelogram |
| `cache` | node (hexagon) | cloud | diamond |
| `external_api` | node (trapezoid) | cloud | house |

### Explicit rendering for known types

For these types, each serialiser has a dedicated render method that produces cleaner output than the generic fallback:
- `enriched_data_flow` — DFD-style with data stores, processes, flows
- `uml_component` — UML component notation with interfaces (provided/required)
- `erd` — entity-relationship with cardinality on edges, attributes in entity boxes
- `api_surface` — controllers as groups, endpoints as children
- `interaction_flow` — services → external systems with mechanism labels
- `blast_radius` — reverse dependency with sized nodes by impact

These are purely presentational — they read the same `DiagramModel`, they just lay it out better.

## File Changes

| File | Change |
|------|--------|
| `src/ast/store.py` | Remove `_generate_diagrams()` call from `write_snapshot()` |
| `src/ast/pipeline.py` | Add Step 8a (mechanical) + Step 8b (agentic) at end |
| `src/ast/diagram_discoverer.py` | **NEW** — agentic diagram discovery (same pattern as endpoint_discoverer.py) |
| `src/ast/enrichment_tools.py` | Add `read_endpoints()` and `read_interactions()` tool functions |
| `src/ast/diagram_generator.py` | Add `serialise_models()` method + merge logic for data-flow replacement |
| `src/ast/mermaid_serialiser.py` | Generic fallback + entity type shape mapping + 4 known type renderers |
| `src/ast/plantuml_serialiser.py` | Same |
| `src/ast/graphviz_serialiser.py` | Same |
| `src/ast/metamodel_serialiser.py` | Entity type mappings |
| `haikai-profiles/.../discover-diagrams.md` | **NEW** — skill file for diagram discovery strategy |

## Future Extensions (not in scope — documented for design continuity)

### On-Demand Diagram Generation

Users request specific diagrams: "generate a Kafka topology" or "show me an ERD for the auth domain". The same `diagram_discoverer` runs with a user-supplied prompt instead of the default survey-all prompt. Scoped by service, domain, or external system. No new plumbing — `DiagramModel` + serialisers already handle arbitrary types.

### Custom Metamodel Schemas

Users define metamodel types (C4 context, threat model, domain boundary map). The LLM receives the schema definition + store tools and produces conformant `DiagramModel` output. Metamodel serialiser gets new entity type mappings — everything else unchanged.

### Interactive Refinement

User sees a generated diagram, says "split the OrderService node into sub-components" or "add the auth flow". The LLM receives the existing `DiagramModel` JSON as context + the refinement instruction, produces an updated model. Same tools, same output contract.

All three extensions are enabled by the current design: `DiagramModel` is the universal contract, the LLM is the builder, serialisers are dumb renderers. New use case = new prompt, not new code.

## Verification

1. **Regression:** Existing 8 diagram types produce identical output (no LLM → same diagrams as before)
2. **Agentic:** Pipeline on piggymetrics with LLM → mechanical diagrams + agentic diagrams generated
3. **Selective generation:** LLM skips diagram types when data is sparse (e.g. no interactions → no interaction_flow)
4. **Data flow merge:** When agentic `enriched_data_flow` exists, mechanical `data-flow` is replaced
5. **Generic fallback:** LLM-invented diagram types render via generic graph in all serialisers
6. **No LLM, no crash:** Without `llm_client`, Step 8b is skipped, Step 8a runs normally
