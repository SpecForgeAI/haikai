# Requirements: Metamodel Endpoint & Interaction Mapping

## Context

The structural analysis pipeline now produces rich extraction data on every `StructuralAnalysis`:
- `endpoints: list[EndpointInfo]` — 59 detected on this repo (path, method, protocol, handler, framework)
- `interactions: list[InteractionInfo]` — 227 detected (target_type, direction, mechanism, target, data_hint)

The metamodel engine (`metamodel_engine.py`) exists but reads only `analysis.symbols` and `analysis.imports`. It uses heuristics ("if 'route' in name") that produce 0 endpoints and 0 interactions on real data.

## Goal

Update the metamodel engine to read `analysis.endpoints` and `analysis.interactions` directly, populating architecture.json with real data instead of heuristics.

## Functional Requirements

### FR-1: Endpoint Mapping
- Read `analysis.endpoints` for each file
- Create Endpoint entities in architecture.json with: id, name (handler), path, method, protocol, framework
- Group endpoints by handler class into Interface entities
- Link Interfaces to Services (by source file / directory)

### FR-2: Interaction Mapping
- Read `analysis.interactions` for each file
- Create DataMovement entities in architecture.json with: id, source, target, type, direction, mechanism, data_entity
- Link to source Service (by file path)
- Deduplicate: same source→target→type = one entity

### FR-3: Backward Compatibility
- Existing heuristic mappings (Dockerfile detection, directory scanning) remain
- New extraction-based mappings take precedence when data is available
- No changes to metamodel_mappings.yaml schema (extend, don't break)

### FR-4: Config Extension
- Add `extraction_mappings` section to metamodel_mappings.yaml
- Map EndpointInfo fields → architecture.json entity fields
- Map InteractionInfo fields → architecture.json DataMovement fields

## Non-Functional Requirements

- Populate must complete in < 1 second for repos under 1,000 files
- No additional dependencies
- Existing metamodel tests must pass
