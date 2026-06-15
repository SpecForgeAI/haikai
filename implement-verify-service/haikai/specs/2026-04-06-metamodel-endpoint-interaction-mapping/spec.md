# Specification: Metamodel Endpoint & Interaction Mapping

> **Updated 2026-04-07:** Endpoint/interaction data now comes from agentic LLM
> discovery (not AST pattern matching). The data format is unchanged —
> `analysis.endpoints` and `analysis.interactions` still contain `EndpointInfo`
> and `InteractionInfo` objects, but they're populated by `endpoint_discoverer.py`
> and `interaction_discoverer.py` instead of per-language AST extractors.

## Summary

Update `metamodel_engine.py` to read `analysis.endpoints` and `analysis.interactions` from `StructuralAnalysis`, replacing heuristic detection with real extraction data. The architecture.json goes from empty to fully populated with every API endpoint and external interaction.

## Before / After

```
Same pipeline input (StructuralAnalysis):

  analysis.symbols[]        → engine reads (both)
  analysis.imports[]        → engine reads (both)
  analysis.endpoints[]      → BEFORE: ignored    AFTER: reads
  analysis.interactions[]   → BEFORE: ignored    AFTER: reads

                               BEFORE:              AFTER:
                               services: 1          services: 1
                               endpoints: 0         endpoints: 59
                               interactions: 0      interactions: 227
```

## Code Changes

### 1. `src/ast/metamodel_engine.py`

**Add `_apply_endpoint_mappings()`:**

```python
def _apply_endpoint_mappings(self, metamodel, analyses, mappings):
    """Populate endpoints from EndpointInfo extraction data."""
    entity_type = "endpoints"
    if entity_type not in metamodel:
        metamodel[entity_type] = []

    existing = {e.get("path", "") + e.get("method", "") for e in metamodel[entity_type]}

    for file_path, analysis in analyses.items():
        for ep in analysis.endpoints:
            key = ep.path + ep.operation
            if key in existing:
                continue
            existing.add(key)
            metamodel[entity_type].append({
                "id": _generate_entity_id("ep", f"{ep.handler_method}_{ep.operation}"),
                "name": ep.handler_method,
                "path": ep.path,
                "method": ep.operation,
                "protocol": ep.protocol,
                "framework": ep.framework,
                "handler_class": ep.handler_class,
                "source_file": file_path,
                "line": ep.line,
                "direction": ep.direction,
                "confidence": ep.confidence,
            })
```

**Add `_apply_interaction_mappings()`:**

```python
def _apply_interaction_mappings(self, metamodel, analyses, mappings):
    """Populate data movements from InteractionInfo extraction data."""
    entity_type = "data_movements"
    if entity_type not in metamodel:
        metamodel[entity_type] = []

    existing = {(e.get("source_method", ""), e.get("target", ""), e.get("type", ""))
                for e in metamodel[entity_type]}

    for file_path, analysis in analyses.items():
        for interaction in analysis.interactions:
            key = (interaction.source_method, interaction.target, interaction.target_type)
            if key in existing:
                continue
            existing.add(key)
            metamodel[entity_type].append({
                "id": _generate_entity_id("dm", f"{interaction.source_method}_{interaction.mechanism}"),
                "source_class": interaction.source_class,
                "source_method": interaction.source_method,
                "target": interaction.target,
                "type": interaction.target_type,
                "direction": interaction.direction,
                "mechanism": interaction.mechanism,
                "data_entity": interaction.data_hint,
                "source_file": file_path,
                "line": interaction.line,
                "confidence": interaction.confidence,
            })
```

**Update `populate()` to call both:**

```python
def populate(self, metamodel, analyses, project_root="."):
    version_id = self._check_version(metamodel)
    mappings = self._load_mappings(version_id)

    self._apply_direct_mappings(metamodel, analyses, mappings)
    self._apply_heuristic_mappings(metamodel, analyses, mappings, project_root)
    self._apply_endpoint_mappings(metamodel, analyses, mappings)      # NEW
    self._apply_interaction_mappings(metamodel, analyses, mappings)    # NEW
    self._apply_relationship_mappings(metamodel, analyses, mappings)

    return metamodel
```

### 2. `config/metamodel_mappings.yaml`

Add extraction mapping section (informational — the code reads EndpointInfo/InteractionInfo directly):

```yaml
  # Extraction-based mappings (from tree-sitter endpoint/interaction detection)
  extraction_mappings:
    endpoints:
      source: "analysis.endpoints"
      id_prefix: "ep"
      dedup_by: ["path", "method"]
    data_movements:
      source: "analysis.interactions"
      id_prefix: "dm"
      dedup_by: ["source_method", "target", "type"]
```

### 3. Import update

Add `EndpointInfo, InteractionInfo` to the import in `metamodel_engine.py`.

## Output: architecture.json

```json
{
  "version_id": "1",
  "services": [
    {"id": "svc_src", "name": "src", "detected_by": ["has_api_routes"]}
  ],
  "endpoints": [
    {
      "id": "ep_health_check_get",
      "name": "health_check",
      "path": "/health",
      "method": "GET",
      "protocol": "HTTP",
      "framework": "fastapi",
      "source_file": "src/api.py",
      "line": 512
    }
  ],
  "data_movements": [
    {
      "id": "dm_create_order_jpa",
      "source_class": "OrderService",
      "source_method": "create_order",
      "target": "orders",
      "type": "DATABASE",
      "direction": "WRITE",
      "mechanism": "JPA",
      "data_entity": "Order"
    }
  ]
}
```

## Verification

1. Run on this repo — expect 59 endpoints + 227 interactions in architecture.json
2. Run on yas (Java Spring) — expect 145+ endpoints + 288+ interactions
3. Existing metamodel tests still pass
4. Heuristic detection (services, components) unchanged
