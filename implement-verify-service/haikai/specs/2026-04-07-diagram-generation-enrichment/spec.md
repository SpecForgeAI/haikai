# Specification: Diagram Generation Enrichment

## Summary

Move diagram generation to the final pipeline step and add 6 new diagram types that consume endpoint and interaction data. Existing 8 diagram types unchanged.

## Pipeline Change

```
BEFORE:                              AFTER:

Step 1: ctags                        Step 1: ctags
Step 2: write_snapshot()             Step 2: write_snapshot()
  └── generate diagrams ← HERE         (no diagrams)
Step 3: tree-sitter                  Step 3: tree-sitter
Step 4: classification               Step 4: classification
Step 5: endpoint discovery            Step 5: endpoint discovery
Step 6: interaction discovery         Step 6: interaction discovery
Step 7: enrichment                    Step 7: enrichment
Step 8: write final outputs           Step 8: write final outputs
                                      Step 9: generate diagrams ← HERE
                                        (sees ALL data)
```

## New Builders

### 1. APISurfaceBuilder (`diagram_type = "api_surface"`)

Reads: `_endpoints.txt`

```
┌─────────────────────────────┐
│ OrderController             │
│  ├── GET /api/orders        │
│  ├── POST /api/orders       │
│  └── DELETE /api/orders/{id}│
├─────────────────────────────┤
│ UserController              │
│  ├── GET /api/users/{id}    │
│  └── PUT /api/users/{id}    │
└─────────────────────────────┘
```

Entities: controllers (group), endpoints (child with parent_id)
Properties: operation, path, protocol, framework

### 2. InteractionFlowBuilder (`diagram_type = "interaction_flow"`)

Reads: `_interactions.txt` + `_index.txt`

```
OrderService ──JPA WRITE──→ [orders DB]
OrderService ──Kafka PUB──→ [order.created]
OrderService ──HTTP GET───→ [user-service]
AuthService  ──Redis GET──→ [session cache]
```

Entities: services (source_class), external systems (target grouped by target_type)
Relationships: mechanism + direction as label
Dedup: same source→target→mechanism = one edge

### 3. DataEntityFlowBuilder (`diagram_type = "data_entity_flow"`)

Reads: `_interactions.txt` + `_endpoints.txt`

```
[Order] ──→ orders DB
[Order] ──→ order.created topic
[UserDTO] ←── user-service HTTP
[Session] ←── redis cache
```

Entities: data types (from data_hint), external targets
Relationships: produces/consumes with direction
Skips interactions with empty data_hint

### 4. FullSequenceBuilder (`diagram_type = "full_sequence"`)

Reads: `_endpoints.txt` + `_calls.txt` + `_interactions.txt`

```
Client → OrderController.create()
  OrderController → OrderService.createOrder()
    OrderService → OrderRepository.save()  [→ orders DB]
    OrderService → KafkaTemplate.send()    [→ order.created]
  OrderController → Response 201
```

Entities: participants (clients, internal classes, external systems)
Reuses call-tracing from SequenceDiagramBuilder
Adds interaction targets as final participants

### 5. InternalDataFlowBuilder (`diagram_type = "internal_data_flow"`)

Reads: `_calls.txt` + `_interactions.txt` + `_index.txt`

Enriched version of existing DataFlowBuilder. Instead of inferring stores from keywords, uses real interaction targets. When an interaction exists for a call, annotates the edge with data_hint.

### 6. BlastRadiusBuilder (`diagram_type = "blast_radius"`)

Reads: `_calls.txt` + `_imports.txt` + `_interactions.txt` + `_endpoints.txt`

```
[orders DB] ← OrderService, ReportService, InventoryService
  └── affects endpoints: POST /orders, GET /reports, PUT /inventory
[user-service] ← OrderService, AuthService
  └── affects endpoints: POST /orders, POST /login
```

Reverse dependency graph. For each external system, shows what depends on it and which endpoints are affected.

## File Changes

| File | Change |
|------|--------|
| `src/ast/store.py` | Remove `_generate_diagrams()` call from `write_snapshot()` |
| `src/ast/pipeline.py` | Add diagram generation as final step |
| `src/ast/diagram_builders.py` | Add `read_endpoints()`, `read_interactions()`, 6 new builder classes |
| `src/ast/diagram_generator.py` | Register 6 new builders |
| `src/ast/mermaid_serialiser.py` | Add rendering for 6 new diagram types |
| `src/ast/plantuml_serialiser.py` | Same |
| `src/ast/graphviz_serialiser.py` | Same |
| `src/ast/metamodel_serialiser.py` | Add entity type mappings |

## Serialiser Rendering

| Diagram Type | Mermaid | PlantUML | Graphviz |
|-------------|---------|----------|----------|
| api_surface | `graph LR` with subgraphs per controller | Component with packages | Cluster subgraphs |
| interaction_flow | `flowchart LR` with DFD shapes | Component with actors/DB/cloud | Digraph with typed shapes |
| data_entity_flow | `flowchart TD` | Component | Digraph |
| full_sequence | Reuse `_serialise_sequence()` | Reuse `_serialise_sequence()` | Reuse |
| internal_data_flow | Reuse `_serialise_data_flow()` | Reuse `_serialise_data_flow()` | Reuse |
| blast_radius | `graph TD` with sized nodes | Component with colors | Digraph with sized nodes |

## Verification

1. Existing 8 diagram types produce identical output (regression)
2. New diagrams generated only when endpoint/interaction data exists
3. End-to-end: run pipeline on piggymetrics with LLM → verify 14 diagram files produced
4. Empty data: run without LLM → only 8 original diagrams produced
