"""Mermaid serialiser — converts DiagramModel to Mermaid syntax.

Produces .mmd source files that render in markdown viewers, GitHub,
VS Code, and the Mermaid Live Editor.
"""
import logging

from src.ast.diagram_model import DiagramModel

logger = logging.getLogger(__name__)


class MermaidSerialiser:
    """Convert DiagramModel to Mermaid syntax string."""

    def serialise(self, model: DiagramModel) -> str:
        """Convert a DiagramModel to Mermaid syntax.

        Dispatches to the appropriate format method based on diagram_type.
        Returns empty string if model is None or has no entities.
        """
        if model is None or not model.entities:
            return ""

        if model.diagram_type == "class":
            return self._serialise_class_diagram(model)
        elif model.diagram_type == "inheritance":
            return self._serialise_graph(model, direction="TD")
        elif model.diagram_type == "dependency":
            return self._serialise_graph(model, direction="LR")
        elif model.diagram_type == "component":
            return self._serialise_graph(model, direction="LR")
        elif model.diagram_type == "package":
            return self._serialise_graph(model, direction="TD")
        elif model.diagram_type == "pattern_map":
            return self._serialise_pattern_map(model)
        elif model.diagram_type == "sequence":
            return self._serialise_sequence(model)
        elif model.diagram_type == "data_flow":
            return self._serialise_data_flow(model)
        elif model.diagram_type == "enriched_data_flow":
            return self._serialise_data_flow(model)
        elif model.diagram_type == "uml_component":
            return self._serialise_uml_component(model)
        elif model.diagram_type == "erd":
            return self._serialise_erd(model)
        elif model.diagram_type == "api_surface":
            return self._serialise_api_surface(model)
        elif model.diagram_type == "interaction_flow":
            return self._serialise_interaction_flow(model)
        elif model.diagram_type == "blast_radius":
            return self._serialise_blast_radius(model)
        else:
            return self._serialise_generic_graph(model)

    def _serialise_class_diagram(self, model: DiagramModel) -> str:
        """Produce classDiagram syntax with members, visibility, inheritance."""
        lines = ["classDiagram"]

        # Emit class definitions
        for entity in model.entities:
            if entity.entity_type != "class":
                continue
            lines.append(f"    class {sanitize_id(entity.name)} {{")
            members = entity.properties.get("members", [])
            for m in members:
                vis = mermaid_visibility(m.get("name", ""))
                sig = m.get("signature", "")
                if m["kind"] == "method":
                    lines.append(f"        {vis}{m['name']}{sig}")
                elif m["kind"] in ("property", "variable", "constant"):
                    lines.append(f"        {vis}{m['name']}")
            lines.append("    }")

        # Emit relationships
        for rel in model.relationships:
            parent_id = sanitize_id(rel.source_id)
            child_id = sanitize_id(rel.target_id)
            if rel.rel_type == "extends":
                lines.append(f"    {parent_id} <|-- {child_id}")
            elif rel.rel_type == "implements":
                lines.append(f"    {parent_id} <|.. {child_id}")

        if len(lines) > 1:
            return "\n".join(lines)
        return ""

    def _serialise_graph(self, model: DiagramModel, direction: str = "TD") -> str:
        """Produce graph TD/LR syntax for trees, dependencies, components."""
        lines = [f"graph {direction}"]

        seen_edges = set()
        for rel in model.relationships:
            source = sanitize_id(rel.source_id)
            target = sanitize_id(rel.target_id)
            edge_key = f"{source}->{target}"
            if edge_key not in seen_edges:
                # Find entity names for labels
                source_name = self._find_entity_name(model, rel.source_id)
                target_name = self._find_entity_name(model, rel.target_id)
                lines.append(f"    {source}[\"{source_name}\"] --> {target}[\"{target_name}\"]")
                seen_edges.add(edge_key)

        if len(lines) > 1:
            return "\n".join(lines)
        return ""

    def _serialise_pattern_map(self, model: DiagramModel) -> str:
        """Produce pattern map with stadium-shaped pattern type nodes."""
        lines = ["graph TD"]

        for rel in model.relationships:
            source = sanitize_id(rel.source_id)
            target = sanitize_id(rel.target_id)
            source_name = self._find_entity_name(model, rel.source_id)
            target_name = self._find_entity_name(model, rel.target_id)
            lines.append(f"    {source}[(\"{source_name}\")] --> {target}[\"{target_name}\"]")

        if len(lines) > 1:
            return "\n".join(lines)
        return ""

    def _serialise_sequence(self, model: DiagramModel) -> str:
        """Produce sequenceDiagram syntax with participants and call arrows."""
        lines = ["sequenceDiagram"]

        # Emit participants
        for entity in model.entities:
            alias = sanitize_id(entity.id)
            lines.append(f"    participant {alias} as {entity.name}")

        # Emit call edges
        for rel in model.relationships:
            source = sanitize_id(rel.source_id)
            target = sanitize_id(rel.target_id)
            label = rel.label or "call()"
            if source == target:
                lines.append(f"    {source}->>{source}: {label}")
            else:
                lines.append(f"    {source}->>{target}: {label}")

        if len(lines) > 1:
            return "\n".join(lines)
        return ""

    def _find_entity_name(self, model: DiagramModel, entity_id: str) -> str:
        """Look up entity name by ID."""
        for entity in model.entities:
            if entity.id == entity_id:
                return entity.name
        return entity_id

    def _serialise_data_flow(self, model: DiagramModel) -> str:
        """Produce flowchart with DFD-style shapes.

        Node shapes by type:
          external  — stadium shape (([name]))  — entry points
          process   — rectangle ([name])        — transformations
          store     — cylinder [(name)]         — data stores
          output    — hexagon {{name}}          — outputs/sinks
        """
        lines = ["flowchart LR"]

        # Shape mapping
        shape_map = {
            "external": ('([["', '"]])', ':::external'),
            "store": ('[(', ')]', ':::store'),
            "output": ('{{', '}}', ':::output'),
            "process": ('["', '"]', ':::process'),
        }

        # Emit nodes
        for entity in model.entities:
            eid = sanitize_id(entity.id)
            etype = entity.entity_type or "process"
            open_b, close_b, style = shape_map.get(etype, shape_map["process"])
            label = entity.name
            methods = entity.properties.get("methods", [])
            if methods and len(methods) <= 4:
                label += "\\n" + ", ".join(methods)
            lines.append(f"    {eid}{open_b}{label}{close_b}")

        # Emit edges
        seen: set[tuple] = set()
        for rel in model.relationships:
            src = sanitize_id(rel.source_id)
            tgt = sanitize_id(rel.target_id)
            key = (src, tgt, rel.label)
            if key in seen:
                continue
            seen.add(key)
            label_part = f"|{rel.label}|" if rel.label else ""
            lines.append(f"    {src} -->{label_part} {tgt}")

        # Style classes
        lines.append("")
        lines.append("    classDef external fill:#e1f5fe,stroke:#0288d1,stroke-width:2px")
        lines.append("    classDef store fill:#fff3e0,stroke:#ef6c00,stroke-width:2px")
        lines.append("    classDef output fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px")
        lines.append("    classDef process fill:#e8f5e9,stroke:#388e3c,stroke-width:2px")

        return "\n".join(lines) + "\n"


    def _serialise_uml_component(self, model: DiagramModel) -> str:
        """Produce Mermaid component diagram with interfaces."""
        lines = ["graph LR"]

        # Group children under parents
        children: dict[str, list] = {}
        standalone = []
        for entity in model.entities:
            if entity.parent_id:
                children.setdefault(entity.parent_id, []).append(entity)
            else:
                standalone.append(entity)

        for entity in standalone:
            eid = sanitize_id(entity.id)
            if entity.id in children:
                lines.append(f"    subgraph {eid}[\"{entity.name}\"]")
                for child in children[entity.id]:
                    cid = sanitize_id(child.id)
                    lines.append(f"        {cid}[\"{child.name}\"]")
                lines.append("    end")
            else:
                shape = _MERMAID_SHAPE_MAP.get(entity.entity_type, ('["', '"]'))
                lines.append(f"    {eid}{shape[0]}{entity.name}{shape[1]}")

        for rel in model.relationships:
            src = sanitize_id(rel.source_id)
            tgt = sanitize_id(rel.target_id)
            label = f"|{rel.label}|" if rel.label else ""
            lines.append(f"    {src} -->{label} {tgt}")

        return "\n".join(lines) + "\n" if len(lines) > 1 else ""

    def _serialise_erd(self, model: DiagramModel) -> str:
        """Produce Mermaid ER diagram."""
        lines = ["erDiagram"]

        # Entity declarations with attributes
        for entity in model.entities:
            eid = sanitize_id(entity.name)
            attrs = entity.properties.get("attributes", [])
            if attrs:
                lines.append(f"    {eid} {{")
                for attr in attrs:
                    attr_type = attr.get("type", "string")
                    attr_name = sanitize_id(attr.get("name", "unknown"))
                    pk = ' PK' if attr.get("primary_key") else ''
                    fk = ' FK' if attr.get("foreign_key") else ''
                    lines.append(f"        {attr_type} {attr_name}{pk}{fk}")
                lines.append("    }")
            else:
                lines.append(f"    {eid}")

        # Relationships with cardinality
        cardinality_map = {
            "has_many": "||", "belongs_to": "}o",
            "has_one": "||", "many_to_many": "}o",
        }
        for rel in model.relationships:
            src = sanitize_id(self._find_entity_name(model, rel.source_id))
            tgt = sanitize_id(self._find_entity_name(model, rel.target_id))
            left = cardinality_map.get(rel.rel_type, "||")
            right = "o{" if rel.rel_type in ("has_many", "many_to_many") else "||"
            label = rel.label or rel.rel_type
            lines.append(f'    {src} {left}--{right} {tgt} : "{label}"')

        return "\n".join(lines) + "\n" if len(lines) > 1 else ""

    def _serialise_api_surface(self, model: DiagramModel) -> str:
        """Produce API surface diagram with endpoints grouped by controller."""
        lines = ["graph LR"]

        children: dict[str, list] = {}
        standalone = []
        for entity in model.entities:
            if entity.parent_id:
                children.setdefault(entity.parent_id, []).append(entity)
            else:
                standalone.append(entity)

        for entity in standalone:
            eid = sanitize_id(entity.id)
            if entity.id in children:
                lines.append(f"    subgraph {eid}[\"{entity.name}\"]")
                for child in children[entity.id]:
                    cid = sanitize_id(child.id)
                    method = child.properties.get("method", "")
                    path = child.properties.get("path", child.name)
                    label = f"{method} {path}" if method else path
                    lines.append(f"        {cid}[\"{label}\"]")
                lines.append("    end")
            else:
                lines.append(f"    {eid}[\"{entity.name}\"]")

        for rel in model.relationships:
            src = sanitize_id(rel.source_id)
            tgt = sanitize_id(rel.target_id)
            label = f"|{rel.label}|" if rel.label else ""
            lines.append(f"    {src} -->{label} {tgt}")

        return "\n".join(lines) + "\n" if len(lines) > 1 else ""

    def _serialise_interaction_flow(self, model: DiagramModel) -> str:
        """Produce interaction flow — services to external systems."""
        lines = ["flowchart LR"]

        for entity in model.entities:
            eid = sanitize_id(entity.id)
            shape = _MERMAID_SHAPE_MAP.get(entity.entity_type, ('["', '"]'))
            lines.append(f"    {eid}{shape[0]}{entity.name}{shape[1]}")

        seen: set[tuple] = set()
        for rel in model.relationships:
            src = sanitize_id(rel.source_id)
            tgt = sanitize_id(rel.target_id)
            key = (src, tgt, rel.label)
            if key in seen:
                continue
            seen.add(key)
            label = f"|{rel.label}|" if rel.label else ""
            lines.append(f"    {src} -->{label} {tgt}")

        return "\n".join(lines) + "\n" if len(lines) > 1 else ""

    def _serialise_blast_radius(self, model: DiagramModel) -> str:
        """Produce blast radius — reverse dependency from external systems."""
        lines = ["graph TD"]

        for entity in model.entities:
            eid = sanitize_id(entity.id)
            shape = _MERMAID_SHAPE_MAP.get(entity.entity_type, ('["', '"]'))
            lines.append(f"    {eid}{shape[0]}{entity.name}{shape[1]}")

        for rel in model.relationships:
            src = sanitize_id(rel.source_id)
            tgt = sanitize_id(rel.target_id)
            label = f"|{rel.label}|" if rel.label else ""
            lines.append(f"    {src} -->{label} {tgt}")

        # Style external systems
        lines.append("")
        lines.append("    classDef external fill:#ffcdd2,stroke:#c62828,stroke-width:2px")
        lines.append("    classDef service fill:#e8f5e9,stroke:#388e3c")
        lines.append("    classDef endpoint fill:#e3f2fd,stroke:#1565c0")
        for entity in model.entities:
            eid = sanitize_id(entity.id)
            if entity.entity_type in ("database", "message_queue", "cache", "external_api"):
                lines.append(f"    class {eid} external")
            elif entity.entity_type == "endpoint":
                lines.append(f"    class {eid} endpoint")
            elif entity.entity_type == "service":
                lines.append(f"    class {eid} service")

        return "\n".join(lines) + "\n" if len(lines) > 1 else ""

    def _serialise_generic_graph(self, model: DiagramModel) -> str:
        """Generic fallback — render any DiagramModel as a directed graph."""
        lines = ["flowchart LR"]

        # Group children under parents
        children: dict[str, list] = {}
        standalone = []
        for entity in model.entities:
            if entity.parent_id:
                children.setdefault(entity.parent_id, []).append(entity)
            else:
                standalone.append(entity)

        for entity in standalone:
            eid = sanitize_id(entity.id)
            if entity.id in children:
                lines.append(f"    subgraph {eid}[\"{entity.name}\"]")
                for child in children[entity.id]:
                    cid = sanitize_id(child.id)
                    shape = _MERMAID_SHAPE_MAP.get(child.entity_type, ('["', '"]'))
                    lines.append(f"        {cid}{shape[0]}{child.name}{shape[1]}")
                lines.append("    end")
            else:
                shape = _MERMAID_SHAPE_MAP.get(entity.entity_type, ('["', '"]'))
                lines.append(f"    {eid}{shape[0]}{entity.name}{shape[1]}")

        seen: set[tuple] = set()
        for rel in model.relationships:
            src = sanitize_id(rel.source_id)
            tgt = sanitize_id(rel.target_id)
            key = (src, tgt)
            if key in seen:
                continue
            seen.add(key)
            label = f"|{rel.label}|" if rel.label else ""
            lines.append(f"    {src} -->{label} {tgt}")

        return "\n".join(lines) + "\n" if len(lines) > 1 else ""


# Entity type → Mermaid shape mapping
_MERMAID_SHAPE_MAP = {
    "controller": ('["', '"]'),      # rectangle
    "endpoint": ('("', '")'),        # rounded
    "service": ('("', '")'),         # rounded
    "database": ('[(', ')]'),        # cylinder
    "message_queue": ('([', '])'),   # stadium
    "cache": ('{{', '}}'),           # hexagon
    "external_api": ('[/', '/]'),    # parallelogram
    "topic": ('([', '])'),           # stadium
    "entity": ('["', '"]'),          # rectangle
    "component": ('["', '"]'),       # rectangle
    "interface": ('("', '")'),       # rounded
}


def sanitize_id(name: str) -> str:
    """Sanitize a name for use as a Mermaid node ID."""
    return name.replace("-", "_").replace(".", "_").replace("/", "_").replace(" ", "_")


def mermaid_visibility(name: str) -> str:
    """Return Mermaid visibility prefix based on naming convention."""
    if name.startswith("__"):
        return "-"  # private
    elif name.startswith("_"):
        return "#"  # protected
    return "+"  # public
