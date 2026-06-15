"""PlantUML serialiser — converts DiagramModel to PlantUML syntax.

Produces .puml source files renderable by PlantUML server, IDE plugins,
or the PlantUML CLI (plantuml.jar).
"""
import logging

from src.ast.diagram_model import DiagramModel, DiagramEntity

logger = logging.getLogger(__name__)


class PlantUMLSerialiser:
    """Convert DiagramModel to PlantUML syntax string."""

    def serialise(self, model: DiagramModel) -> str:
        """Convert a DiagramModel to PlantUML syntax.

        Dispatches to the appropriate format method based on diagram_type.
        Returns empty string if model is None or has no entities.
        """
        if model is None or not model.entities:
            return ""

        if model.diagram_type == "class":
            return self._serialise_class_diagram(model)
        elif model.diagram_type == "inheritance":
            return self._serialise_inheritance(model)
        elif model.diagram_type == "dependency":
            return self._serialise_graph(model)
        elif model.diagram_type == "component":
            return self._serialise_graph(model)
        elif model.diagram_type == "package":
            return self._serialise_graph(model)
        elif model.diagram_type == "pattern_map":
            return self._serialise_graph(model)
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
        """Produce PlantUML class diagram syntax."""
        lines = ["@startuml"]

        if model.title:
            lines.append(f"title {model.title}")
            lines.append("")

        for entity in model.entities:
            if entity.entity_type != "class":
                continue

            stereotype = self._get_stereotype(entity)
            keyword = "abstract class" if "abstract" in entity.properties.get("flags", "") else "class"
            if entity.properties.get("flags", "") == "interface" or entity.entity_type == "interface":
                keyword = "interface"

            lines.append(f"{keyword} {_sanitize_id(entity.name)} {stereotype}{{")
            members = entity.properties.get("members", [])
            for m in members:
                vis = _plantuml_visibility(m.get("name", ""))
                sig = m.get("signature", "")
                if m["kind"] == "method":
                    lines.append(f"    {vis}{m['name']}{sig}")
                elif m["kind"] in ("property", "variable", "constant"):
                    lines.append(f"    {vis}{m['name']}")
            lines.append("}")
            lines.append("")

        # Relationships
        for rel in model.relationships:
            parent = _sanitize_id(rel.source_id)
            child = _sanitize_id(rel.target_id)
            if rel.rel_type == "extends":
                lines.append(f"{parent} <|-- {child}")
            elif rel.rel_type == "implements":
                lines.append(f"{parent} <|.. {child}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)

    def _serialise_inheritance(self, model: DiagramModel) -> str:
        """Produce PlantUML inheritance diagram."""
        lines = ["@startuml"]

        if model.title:
            lines.append(f"title {model.title}")
            lines.append("")

        # Declare entities
        for entity in model.entities:
            lines.append(f"class {_sanitize_id(entity.name)}")

        lines.append("")

        # Relationships
        for rel in model.relationships:
            parent = _sanitize_id(rel.source_id)
            child = _sanitize_id(rel.target_id)
            if rel.rel_type == "implements":
                lines.append(f"{parent} <|.. {child}")
            else:
                lines.append(f"{parent} <|-- {child}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)

    def _serialise_graph(self, model: DiagramModel) -> str:
        """Produce PlantUML component/dependency/pattern diagram."""
        lines = ["@startuml"]

        if model.title:
            lines.append(f"title {model.title}")
            lines.append("")

        seen_edges = set()
        for rel in model.relationships:
            source = _sanitize_id(rel.source_id)
            target = _sanitize_id(rel.target_id)
            edge_key = f"{source}->{target}"
            if edge_key not in seen_edges:
                source_name = self._find_entity_name(model, rel.source_id)
                target_name = self._find_entity_name(model, rel.target_id)
                lines.append(f'[{source_name}] --> [{target_name}]')
                seen_edges.add(edge_key)

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)

    def _serialise_sequence(self, model: DiagramModel) -> str:
        """Produce PlantUML sequence diagram syntax."""
        lines = ["@startuml"]

        if model.title:
            lines.append(f"title {model.title}")
            lines.append("")

        # Participants
        for entity in model.entities:
            alias = _sanitize_id(entity.id)
            lines.append(f'participant "{entity.name}" as {alias}')

        lines.append("")

        # Call edges
        for rel in model.relationships:
            source = _sanitize_id(rel.source_id)
            target = _sanitize_id(rel.target_id)
            label = rel.label or "call()"
            if source == target:
                lines.append(f"{source} -> {source} : {label}")
            else:
                lines.append(f"{source} -> {target} : {label}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)

    def _get_stereotype(self, entity: DiagramEntity) -> str:
        """Return PlantUML stereotype string if applicable."""
        flags = entity.properties.get("flags", "")
        if "abstract" in flags:
            return "<<abstract>> "
        if "interface" in flags:
            return "<<interface>> "
        return ""

    def _find_entity_name(self, model: DiagramModel, entity_id: str) -> str:
        """Look up entity name by ID."""
        for entity in model.entities:
            if entity.id == entity_id:
                return entity.name
        return entity_id

    def _serialise_data_flow(self, model: DiagramModel) -> str:
        """Produce PlantUML data flow diagram using activity/component syntax."""
        lines = ["@startuml", f"title {model.title}", ""]
        lines.append("skinparam componentStyle rectangle")
        lines.append("")

        # Node shape by type
        for entity in model.entities:
            eid = _sanitize_id(entity.id)
            etype = entity.entity_type or "process"
            if etype == "external":
                lines.append(f'actor "{entity.name}" as {eid}')
            elif etype == "store":
                lines.append(f'database "{entity.name}" as {eid}')
            elif etype == "output":
                lines.append(f'cloud "{entity.name}" as {eid}')
            else:
                lines.append(f'component "{entity.name}" as {eid}')

        lines.append("")

        # Deduplicated edges
        seen: set[tuple] = set()
        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            key = (src, tgt, rel.label)
            if key in seen:
                continue
            seen.add(key)
            label = f" : {rel.label}" if rel.label else ""
            lines.append(f"{src} --> {tgt}{label}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines) + "\n"


    def _serialise_uml_component(self, model: DiagramModel) -> str:
        """Produce PlantUML component diagram with interfaces."""
        lines = ["@startuml"]
        if model.title:
            lines.append(f"title {model.title}")
        lines.append("")

        children: dict[str, list] = {}
        standalone = []
        for entity in model.entities:
            if entity.parent_id:
                children.setdefault(entity.parent_id, []).append(entity)
            else:
                standalone.append(entity)

        for entity in standalone:
            eid = _sanitize_id(entity.id)
            if entity.id in children:
                lines.append(f'package "{entity.name}" as {eid} {{')
                for child in children[entity.id]:
                    cid = _sanitize_id(child.id)
                    kind = _plantuml_component_kind(child.entity_type)
                    lines.append(f'    {kind} "{child.name}" as {cid}')
                lines.append("}")
            else:
                kind = _plantuml_component_kind(entity.entity_type)
                lines.append(f'{kind} "{entity.name}" as {eid}')
        lines.append("")

        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            label = f" : {rel.label}" if rel.label else ""
            lines.append(f"{src} --> {tgt}{label}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)

    def _serialise_erd(self, model: DiagramModel) -> str:
        """Produce PlantUML entity-relationship diagram."""
        lines = ["@startuml"]
        if model.title:
            lines.append(f"title {model.title}")
        lines.append("")

        for entity in model.entities:
            eid = _sanitize_id(entity.name)
            lines.append(f'entity "{entity.name}" as {eid} {{')
            attrs = entity.properties.get("attributes", [])
            for attr in attrs:
                pk = " <<PK>>" if attr.get("primary_key") else ""
                fk = " <<FK>>" if attr.get("foreign_key") else ""
                lines.append(f"    {attr.get('name', 'unknown')} : {attr.get('type', 'string')}{pk}{fk}")
            if not attrs:
                lines.append(f"    ...")
            lines.append("}")
        lines.append("")

        cardinality = {
            "has_many": '"1" -- "*"', "belongs_to": '"*" -- "1"',
            "has_one": '"1" -- "1"', "many_to_many": '"*" -- "*"',
        }
        for rel in model.relationships:
            src = _sanitize_id(self._find_entity_name(model, rel.source_id))
            tgt = _sanitize_id(self._find_entity_name(model, rel.target_id))
            card = cardinality.get(rel.rel_type, '--')
            label = f" : {rel.label}" if rel.label else ""
            lines.append(f"{src} {card} {tgt}{label}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)

    def _serialise_api_surface(self, model: DiagramModel) -> str:
        """Produce PlantUML API surface with packages for controllers."""
        lines = ["@startuml"]
        if model.title:
            lines.append(f"title {model.title}")
        lines.append("")

        children: dict[str, list] = {}
        standalone = []
        for entity in model.entities:
            if entity.parent_id:
                children.setdefault(entity.parent_id, []).append(entity)
            else:
                standalone.append(entity)

        for entity in standalone:
            eid = _sanitize_id(entity.id)
            if entity.id in children:
                lines.append(f'package "{entity.name}" as {eid} {{')
                for child in children[entity.id]:
                    cid = _sanitize_id(child.id)
                    method = child.properties.get("method", "")
                    path = child.properties.get("path", child.name)
                    label = f"{method} {path}" if method else path
                    lines.append(f'    rectangle "{label}" as {cid}')
                lines.append("}")
            else:
                lines.append(f'rectangle "{entity.name}" as {eid}')
        lines.append("")

        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            label = f" : {rel.label}" if rel.label else ""
            lines.append(f"{src} --> {tgt}{label}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)

    def _serialise_interaction_flow(self, model: DiagramModel) -> str:
        """Produce interaction flow diagram."""
        lines = ["@startuml"]
        if model.title:
            lines.append(f"title {model.title}")
        lines.append("skinparam componentStyle rectangle")
        lines.append("")

        for entity in model.entities:
            eid = _sanitize_id(entity.id)
            kind = _plantuml_component_kind(entity.entity_type)
            lines.append(f'{kind} "{entity.name}" as {eid}')
        lines.append("")

        seen: set[tuple] = set()
        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            key = (src, tgt, rel.label)
            if key in seen:
                continue
            seen.add(key)
            label = f" : {rel.label}" if rel.label else ""
            lines.append(f"{src} --> {tgt}{label}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)

    def _serialise_blast_radius(self, model: DiagramModel) -> str:
        """Produce blast radius reverse dependency diagram."""
        lines = ["@startuml"]
        if model.title:
            lines.append(f"title {model.title}")
        lines.append("")

        for entity in model.entities:
            eid = _sanitize_id(entity.id)
            kind = _plantuml_component_kind(entity.entity_type)
            lines.append(f'{kind} "{entity.name}" as {eid}')
        lines.append("")

        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            label = f" : {rel.label}" if rel.label else ""
            lines.append(f"{src} --> {tgt}{label}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)

    def _serialise_generic_graph(self, model: DiagramModel) -> str:
        """Generic fallback — render any DiagramModel as PlantUML component diagram."""
        lines = ["@startuml"]
        if model.title:
            lines.append(f"title {model.title}")
        lines.append("")

        for entity in model.entities:
            eid = _sanitize_id(entity.id)
            kind = _plantuml_component_kind(entity.entity_type)
            lines.append(f'{kind} "{entity.name}" as {eid}')
        lines.append("")

        seen: set[tuple] = set()
        for rel in model.relationships:
            src = _sanitize_id(rel.source_id)
            tgt = _sanitize_id(rel.target_id)
            key = (src, tgt)
            if key in seen:
                continue
            seen.add(key)
            label = f" : {rel.label}" if rel.label else ""
            lines.append(f"{src} --> {tgt}{label}")

        lines.append("")
        lines.append("@enduml")
        return "\n".join(lines)


def _plantuml_component_kind(entity_type: str) -> str:
    """Map entity type to PlantUML component keyword."""
    kind_map = {
        "database": "database", "message_queue": "queue",
        "cache": "cloud", "external_api": "cloud",
        "service": "component", "controller": "component",
        "endpoint": "rectangle", "interface": "interface",
    }
    return kind_map.get(entity_type, "component")


def _sanitize_id(name: str) -> str:
    """Sanitize a name for use as a PlantUML identifier."""
    return name.replace("-", "_").replace(".", "_").replace("/", "_").replace(" ", "_")


def _plantuml_visibility(name: str) -> str:
    """Return PlantUML visibility prefix based on naming convention."""
    if name.startswith("__"):
        return "-"  # private
    elif name.startswith("_"):
        return "#"  # protected
    return "+"  # public
