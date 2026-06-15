"""Graphviz (DOT) serialiser — converts DiagramModel to DOT syntax.

Produces .dot source files renderable by Graphviz CLI (dot, neato, fdp),
VS Code Graphviz extensions, and online viewers.
"""
import logging

from src.ast.diagram_model import DiagramModel, DiagramEntity

logger = logging.getLogger(__name__)

# Node shape based on entity type
_SHAPE_MAP = {
    "class": "record",
    "interface": "ellipse",
    "module": "box",
    "package": "box3d",
    "pattern": "hexagon",
    "instance": "box",
}

# Shape/color maps for agentic diagram types
_AGENTIC_SHAPE_MAP = {
    "controller": "box3d", "endpoint": "box", "service": "oval",
    "database": "cylinder", "message_queue": "parallelogram",
    "cache": "diamond", "external_api": "house",
    "topic": "parallelogram", "entity": "record",
    "component": "box3d", "interface": "ellipse",
}

_AGENTIC_COLOR_MAP = {
    "database": "#fff3e0", "message_queue": "#e8eaf6",
    "cache": "#fce4ec", "external_api": "#e0f2f1",
    "service": "#e8f5e9", "controller": "#e3f2fd",
    "endpoint": "#f3e5f5",
}


class GraphvizSerialiser:
    """Convert DiagramModel to Graphviz DOT syntax string."""

    def serialise(self, model: DiagramModel) -> str:
        """Convert a DiagramModel to DOT syntax.

        Dispatches to the appropriate format method based on diagram_type.
        Returns empty string if model is None or has no entities.
        """
        if model is None or not model.entities:
            return ""

        if model.diagram_type == "class":
            return self._serialise_class_diagram(model)
        elif model.diagram_type == "inheritance":
            return self._serialise_graph(model, directed=True)
        elif model.diagram_type == "dependency":
            return self._serialise_graph(model, directed=True)
        elif model.diagram_type == "component":
            return self._serialise_subgraph(model)
        elif model.diagram_type == "package":
            return self._serialise_subgraph(model)
        elif model.diagram_type == "pattern_map":
            return self._serialise_graph(model, directed=True)
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
        """Produce DOT record-based class diagram."""
        lines = ["digraph ClassDiagram {"]
        lines.append("    rankdir=TB;")
        lines.append("    node [shape=record, fontsize=10];")
        lines.append("")

        for entity in model.entities:
            if entity.entity_type != "class":
                continue
            node_id = _sanitize_id(entity.name)
            label = self._build_record_label(entity)
            lines.append(f'    {node_id} [label="{label}"];')

        lines.append("")

        for rel in model.relationships:
            source = _sanitize_id(rel.source_id)
            target = _sanitize_id(rel.target_id)
            if rel.rel_type == "extends":
                lines.append(f"    {target} -> {source} [arrowhead=empty];")
            elif rel.rel_type == "implements":
                lines.append(f"    {target} -> {source} [arrowhead=empty, style=dashed];")

        lines.append("}")
        return "\n".join(lines)

    def _serialise_graph(self, model: DiagramModel, directed: bool = True) -> str:
        """Produce digraph or graph for dependencies, inheritance, patterns."""
        keyword = "digraph" if directed else "graph"
        edge_op = "->" if directed else "--"
        title = _sanitize_id(model.title) if model.title else "G"

        lines = [f"{keyword} {title} {{"]
        lines.append("    rankdir=TB;")
        lines.append("")

        # Declare nodes
        for entity in model.entities:
            node_id = _sanitize_id(entity.id)
            shape = _SHAPE_MAP.get(entity.entity_type, "box")
            lines.append(f'    {node_id} [label="{entity.name}", shape={shape}];')

        lines.append("")

        # Edges
        seen_edges = set()
        for rel in model.relationships:
            source = _sanitize_id(rel.source_id)
            target = _sanitize_id(rel.target_id)
            edge_key = f"{source}{edge_op}{target}"
            if edge_key not in seen_edges:
                label_attr = f', label="{rel.label}"' if rel.label else ""
                lines.append(f"    {source} {edge_op} {target} [{label_attr}];".replace("[ ];", ";").replace("[, ", "["))
                seen_edges.add(edge_key)

        lines.append("}")
        return "\n".join(lines)

    def _serialise_subgraph(self, model: DiagramModel) -> str:
        """Produce DOT with cluster subgraphs for component diagrams."""
        lines = ["digraph Components {"]
        lines.append("    rankdir=LR;")
        lines.append("    compound=true;")
        lines.append("")

        # Group entities by parent_id for clustering
        clusters: dict[str, list[DiagramEntity]] = {}
        standalone: list[DiagramEntity] = []
        for entity in model.entities:
            if entity.parent_id:
                clusters.setdefault(entity.parent_id, []).append(entity)
            else:
                standalone.append(entity)

        # If no parent_id grouping, try grouping by first path segment of name
        if not clusters and standalone:
            for entity in standalone:
                parts = entity.name.replace("\\", "/").split("/")
                if len(parts) > 1:
                    group = parts[0]
                    clusters.setdefault(group, []).append(entity)
                else:
                    clusters.setdefault("_root", []).append(entity)
            standalone = []

        cluster_idx = 0
        for group_name, entities in clusters.items():
            lines.append(f"    subgraph cluster_{cluster_idx} {{")
            lines.append(f'        label="{group_name}";')
            for entity in entities:
                node_id = _sanitize_id(entity.id)
                shape = _SHAPE_MAP.get(entity.entity_type, "box")
                lines.append(f'        {node_id} [label="{entity.name}", shape={shape}];')
            lines.append("    }")
            lines.append("")
            cluster_idx += 1

        for entity in standalone:
            node_id = _sanitize_id(entity.id)
            shape = _SHAPE_MAP.get(entity.entity_type, "box")
            lines.append(f'    {node_id} [label="{entity.name}", shape={shape}];')

        lines.append("")

        # Edges
        for rel in model.relationships:
            source = _sanitize_id(rel.source_id)
            target = _sanitize_id(rel.target_id)
            lines.append(f"    {source} -> {target};")

        lines.append("}")
        return "\n".join(lines)

    def _serialise_sequence(self, model: DiagramModel) -> str:
        """Produce directed graph approximation of sequence diagram.

        Graphviz has no native sequence diagram support. We produce
        a digraph with labeled edges representing the call sequence.
        """
        lines = ["digraph Sequence {"]
        lines.append("    rankdir=LR;")
        lines.append("    node [shape=box, fontsize=10];")
        lines.append("")

        # Declare participants
        for entity in model.entities:
            node_id = _sanitize_id(entity.id)
            lines.append(f'    {node_id} [label="{entity.name}"];')

        lines.append("")

        # Call edges
        for rel in model.relationships:
            source = _sanitize_id(rel.source_id)
            target = _sanitize_id(rel.target_id)
            label = rel.label or ""
            if label:
                lines.append(f'    {source} -> {target} [label="{label}"];')
            else:
                lines.append(f"    {source} -> {target};")

        lines.append("}")
        return "\n".join(lines)

    def _serialise_data_flow(self, model: DiagramModel) -> str:
        """Produce Graphviz data flow diagram with DFD-style shapes."""
        lines = ["digraph DataFlow {"]
        lines.append("    rankdir=LR;")
        lines.append("    node [fontsize=10];")
        lines.append("")

        # Shape mapping
        shape_map = {
            "external": ("doubleoctagon", "#e1f5fe"),
            "store": ("cylinder", "#fff3e0"),
            "output": ("hexagon", "#f3e5f5"),
            "process": ("box", "#e8f5e9"),
        }

        for entity in model.entities:
            eid = _sanitize_id(entity.id)
            etype = entity.entity_type or "process"
            shape, color = shape_map.get(etype, shape_map["process"])
            lines.append(
                f'    {eid} [label="{entity.name}", shape={shape}, '
                f'style=filled, fillcolor="{color}"];'
            )

        lines.append("")

        seen: set[tuple] = set()
        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            key = (src, tgt, rel.label)
            if key in seen:
                continue
            seen.add(key)
            label = f' [label="{rel.label}"]' if rel.label else ""
            lines.append(f"    {src} -> {tgt}{label};")

        lines.append("}")
        return "\n".join(lines) + "\n"

    def _serialise_uml_component(self, model: DiagramModel) -> str:
        """Produce DOT component diagram with clusters."""
        lines = ["digraph Components {"]
        lines.append("    rankdir=LR;")
        lines.append("    compound=true;")
        lines.append("")

        children: dict[str, list] = {}
        standalone = []
        for entity in model.entities:
            if entity.parent_id:
                children.setdefault(entity.parent_id, []).append(entity)
            else:
                standalone.append(entity)

        idx = 0
        for entity in standalone:
            eid = _sanitize_id(entity.id)
            if entity.id in children:
                lines.append(f"    subgraph cluster_{idx} {{")
                lines.append(f'        label="{entity.name}";')
                for child in children[entity.id]:
                    cid = _sanitize_id(child.id)
                    shape = _AGENTIC_SHAPE_MAP.get(child.entity_type, "box")
                    lines.append(f'        {cid} [label="{child.name}", shape={shape}];')
                lines.append("    }")
                idx += 1
            else:
                shape = _AGENTIC_SHAPE_MAP.get(entity.entity_type, "box")
                lines.append(f'    {eid} [label="{entity.name}", shape={shape}];')
        lines.append("")

        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            label = f', label="{rel.label}"' if rel.label else ""
            lines.append(f"    {src} -> {tgt} [{label}];".replace("[ ]", "").replace("[, ", "["))

        lines.append("}")
        return "\n".join(lines)

    def _serialise_erd(self, model: DiagramModel) -> str:
        """Produce DOT ER diagram with record nodes."""
        lines = ["digraph ERD {"]
        lines.append("    rankdir=LR;")
        lines.append('    node [shape=record, fontsize=10];')
        lines.append("")

        for entity in model.entities:
            eid = _sanitize_id(entity.id)
            attrs = entity.properties.get("attributes", [])
            if attrs:
                attr_labels = []
                for a in attrs:
                    pk = " (PK)" if a.get("primary_key") else ""
                    fk = " (FK)" if a.get("foreign_key") else ""
                    attr_labels.append(f"{a.get('name', '?')}: {a.get('type', 'string')}{pk}{fk}")
                body = "\\l".join(attr_labels) + "\\l"
                lines.append(f'    {eid} [label="{{{entity.name}|{body}}}"];')
            else:
                lines.append(f'    {eid} [label="{entity.name}"];')
        lines.append("")

        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            label = rel.label or rel.rel_type
            lines.append(f'    {src} -> {tgt} [label="{label}"];')

        lines.append("}")
        return "\n".join(lines)

    def _serialise_api_surface(self, model: DiagramModel) -> str:
        """Produce DOT API surface with clusters for controllers."""
        lines = ["digraph APISurface {"]
        lines.append("    rankdir=LR;")
        lines.append("")

        children: dict[str, list] = {}
        standalone = []
        for entity in model.entities:
            if entity.parent_id:
                children.setdefault(entity.parent_id, []).append(entity)
            else:
                standalone.append(entity)

        idx = 0
        for entity in standalone:
            eid = _sanitize_id(entity.id)
            if entity.id in children:
                lines.append(f"    subgraph cluster_{idx} {{")
                lines.append(f'        label="{entity.name}";')
                for child in children[entity.id]:
                    cid = _sanitize_id(child.id)
                    method = child.properties.get("method", "")
                    path = child.properties.get("path", child.name)
                    label = f"{method} {path}" if method else path
                    lines.append(f'        {cid} [label="{label}", shape=box];')
                lines.append("    }")
                idx += 1
            else:
                lines.append(f'    {eid} [label="{entity.name}", shape=box];')
        lines.append("")

        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            label = f', label="{rel.label}"' if rel.label else ""
            lines.append(f"    {src} -> {tgt} [{label}];".replace("[ ]", "").replace("[, ", "["))

        lines.append("}")
        return "\n".join(lines)

    def _serialise_interaction_flow(self, model: DiagramModel) -> str:
        """Produce DOT interaction flow diagram."""
        lines = ["digraph InteractionFlow {"]
        lines.append("    rankdir=LR;")
        lines.append("")

        for entity in model.entities:
            eid = _sanitize_id(entity.id)
            shape = _AGENTIC_SHAPE_MAP.get(entity.entity_type, "box")
            color = _AGENTIC_COLOR_MAP.get(entity.entity_type, "#ffffff")
            lines.append(f'    {eid} [label="{entity.name}", shape={shape}, style=filled, fillcolor="{color}"];')
        lines.append("")

        seen: set[tuple] = set()
        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            key = (src, tgt, rel.label)
            if key in seen:
                continue
            seen.add(key)
            label = f' [label="{rel.label}"]' if rel.label else ""
            lines.append(f"    {src} -> {tgt}{label};")

        lines.append("}")
        return "\n".join(lines)

    def _serialise_blast_radius(self, model: DiagramModel) -> str:
        """Produce DOT blast radius diagram."""
        lines = ["digraph BlastRadius {"]
        lines.append("    rankdir=TD;")
        lines.append("")

        for entity in model.entities:
            eid = _sanitize_id(entity.id)
            shape = _AGENTIC_SHAPE_MAP.get(entity.entity_type, "box")
            color = _AGENTIC_COLOR_MAP.get(entity.entity_type, "#ffffff")
            lines.append(f'    {eid} [label="{entity.name}", shape={shape}, style=filled, fillcolor="{color}"];')
        lines.append("")

        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            label = f' [label="{rel.label}"]' if rel.label else ""
            lines.append(f"    {src} -> {tgt}{label};")

        lines.append("}")
        return "\n".join(lines)

    def _serialise_generic_graph(self, model: DiagramModel) -> str:
        """Generic fallback — render any DiagramModel as a DOT digraph."""
        lines = ["digraph G {"]
        lines.append("    rankdir=LR;")
        lines.append("")

        children: dict[str, list] = {}
        standalone = []
        for entity in model.entities:
            if entity.parent_id:
                children.setdefault(entity.parent_id, []).append(entity)
            else:
                standalone.append(entity)

        idx = 0
        for entity in standalone:
            eid = _sanitize_id(entity.id)
            if entity.id in children:
                lines.append(f"    subgraph cluster_{idx} {{")
                lines.append(f'        label="{entity.name}";')
                for child in children[entity.id]:
                    cid = _sanitize_id(child.id)
                    shape = _AGENTIC_SHAPE_MAP.get(child.entity_type, "box")
                    lines.append(f'        {cid} [label="{child.name}", shape={shape}];')
                lines.append("    }")
                idx += 1
            else:
                shape = _AGENTIC_SHAPE_MAP.get(entity.entity_type, "box")
                lines.append(f'    {eid} [label="{entity.name}", shape={shape}];')
        lines.append("")

        seen: set[tuple] = set()
        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            key = (src, tgt)
            if key in seen:
                continue
            seen.add(key)
            label = f' [label="{rel.label}"]' if rel.label else ""
            lines.append(f"    {src} -> {tgt}{label};")

        lines.append("}")
        return "\n".join(lines)


    def _build_record_label(self, entity: DiagramEntity) -> str:
        """Build DOT record label with class name + members."""
        name = entity.name
        members = entity.properties.get("members", [])

        fields = []
        methods = []
        for m in members:
            vis = _dot_visibility(m.get("name", ""))
            if m["kind"] == "method":
                sig = m.get("signature", "()")
                methods.append(f"{vis} {m['name']}{sig}")
            elif m["kind"] in ("property", "variable", "constant"):
                fields.append(f"{vis} {m['name']}")

        sections = [name]
        if fields:
            sections.append("\\l".join(fields) + "\\l")
        else:
            sections.append("")
        if methods:
            sections.append("\\l".join(methods) + "\\l")
        else:
            sections.append("")

        return "{" + "|".join(sections) + "}"


def _sanitize_id(name: str) -> str:
    """Sanitize a name for use as a DOT node ID."""
    sanitized = name.replace("-", "_").replace(".", "_").replace("/", "_").replace(" ", "_")
    # DOT IDs can't start with a digit
    if sanitized and sanitized[0].isdigit():
        sanitized = "n_" + sanitized
    return sanitized


def _dot_visibility(name: str) -> str:
    """Return DOT/UML visibility prefix based on naming convention."""
    if name.startswith("__"):
        return "-"
    elif name.startswith("_"):
        return "#"
    return "+"
