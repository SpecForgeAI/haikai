# Requirements: Diagram Generation Enrichment

## Problem

Diagrams are generated at Step 2 of the pipeline (inside `write_snapshot()`), before tree-sitter, LLM classification, endpoint discovery, interaction discovery, and enrichment. They only see ctags data. `_endpoints.txt` and `_interactions.txt` exist in the store but no builder reads them.

## Goal

1. Move diagram generation to the final pipeline step so all data is available
2. Add new diagram types that use endpoint and interaction data
3. Existing 8 diagram types remain unchanged

## New Diagram Types

### From endpoints:
- **API Surface** — endpoints grouped by controller/service, showing path, method, protocol

### From interactions:
- **Interaction Flow** — services → external systems (DB, MQ, HTTP, cache) with mechanism and direction
- **Data Entity Flow** — which entity types flow where (Order → DB, Kafka, cache)

### From endpoints + interactions + calls:
- **Full Sequence** — HTTP request → endpoint → internal calls → external interactions → response
- **Internal Data Flow** — enriched version of existing DataFlowBuilder with real interaction targets
- **Blast Radius** — reverse dependency: if X goes down, what endpoints/services are affected

## Constraints

- New builders produce DiagramModel (same as existing)
- All 4 serialisers (Mermaid, PlantUML, Graphviz, Metamodel) must render new types
- Builders return None on empty data (no endpoints = no API surface diagram)
- Existing 8 builders unchanged
