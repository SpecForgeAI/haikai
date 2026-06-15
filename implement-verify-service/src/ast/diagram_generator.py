"""Diagram generation orchestrator.

Reads structural store index files via builders, produces DiagramModels,
and converts to output format via serialisers. Supports Mermaid, PlantUML,
Graphviz, and metamodel output formats.
"""
import json
import logging
from pathlib import Path
from typing import Optional

from src.ast.diagram_builders import (
    ClassDiagramBuilder,
    InheritanceTreeBuilder,
    DependencyGraphBuilder,
    ComponentDiagramBuilder,
    PackageStructureBuilder,
    PatternMapBuilder,
    SequenceDiagramBuilder,
    DataFlowBuilder,
)
from src.ast.mermaid_serialiser import MermaidSerialiser
from src.ast.plantuml_serialiser import PlantUMLSerialiser
from src.ast.graphviz_serialiser import GraphvizSerialiser
from src.ast.metamodel_serialiser import MetamodelSerialiser

logger = logging.getLogger(__name__)

# Format → (serialiser instance, file extension)
_SERIALISER_MAP = {
    "mermaid": (MermaidSerialiser(), ".mmd"),
    "plantuml": (PlantUMLSerialiser(), ".puml"),
    "graphviz": (GraphvizSerialiser(), ".dot"),
    "metamodel": (MetamodelSerialiser(), ".json"),
}


class DiagramGenerator:
    """Generate diagrams from structural store index files.

    Orchestrates builders (index files → DiagramModel) and serialisers
    (DiagramModel → output format). External interface unchanged:
    DiagramGenerator().generate_all(snapshot_path) still works.
    """

    def __init__(self):
        self._builders = [
            ("class-diagram", ClassDiagramBuilder()),
            ("inheritance-tree", InheritanceTreeBuilder()),
            ("dependency-graph", DependencyGraphBuilder()),
            ("component-diagram", ComponentDiagramBuilder()),
            ("package-structure", PackageStructureBuilder()),
            ("pattern-map", PatternMapBuilder()),
            ("sequence-overview", SequenceDiagramBuilder()),
            ("data-flow", DataFlowBuilder()),
        ]

    def generate_all(
        self,
        snapshot_path: Path,
        formats: Optional[list[str]] = None,
        versions: Optional[dict[str, str]] = None,
    ):
        """Generate all diagram types for a snapshot.

        Args:
            snapshot_path: Path to the structural store snapshot directory.
            formats: List of output formats. Defaults to ["mermaid"].
            versions: Dict of format→version. Used for config validation.
                      Currently informational — serialisers don't vary by version yet.
        """
        if formats is None:
            formats = ["mermaid"]

        diagrams_dir = snapshot_path / "diagrams"
        diagrams_dir.mkdir(exist_ok=True)

        for fmt in formats:
            if fmt not in _SERIALISER_MAP:
                logger.warning(f"Unknown format '{fmt}', skipping")
                continue

            serialiser, ext = _SERIALISER_MAP[fmt]

            for filename, builder in self._builders:
                model = builder.build(snapshot_path)
                if model is None:
                    continue
                output = serialiser.serialise(model)
                if output:
                    out_path = diagrams_dir / f"{filename}{ext}"
                    self._write_diagram(out_path, output, fmt)

        logger.info(f"Diagrams generated in {diagrams_dir} (formats: {formats})")

    def serialise_models(
        self,
        models: list,
        snapshot_path: Path,
        formats: Optional[list[str]] = None,
    ):
        """Serialise agentic DiagramModels to output files.

        Handles merge logic: if an agentic model has diagram_type
        'enriched_data_flow', it replaces the mechanical 'data-flow'
        output file.

        Args:
            models: List of DiagramModel from agentic discovery.
            snapshot_path: Path to the structural store snapshot.
            formats: Output formats. Defaults to ["mermaid"].
        """
        if not models:
            return

        if formats is None:
            formats = ["mermaid"]

        diagrams_dir = snapshot_path / "diagrams"
        diagrams_dir.mkdir(exist_ok=True)

        for fmt in formats:
            if fmt not in _SERIALISER_MAP:
                continue

            serialiser, ext = _SERIALISER_MAP[fmt]

            for model in models:
                # Merge: enriched_data_flow replaces mechanical data-flow
                if model.diagram_type == "enriched_data_flow":
                    old_path = diagrams_dir / f"data-flow{ext}"
                    if old_path.exists():
                        old_path.unlink()
                        logger.info(f"Replaced mechanical data-flow with enriched_data_flow ({fmt})")

                output = serialiser.serialise(model)
                if output:
                    filename = model.diagram_type.replace("_", "-")
                    out_path = diagrams_dir / f"{filename}{ext}"
                    self._write_diagram(out_path, output, fmt)

        logger.info(f"Agentic diagrams serialised: {len(models)} models (formats: {formats})")

    def _write_diagram(self, path: Path, content, fmt: str):
        """Write diagram content to file."""
        if fmt == "metamodel" and isinstance(content, dict):
            path.write_text(
                json.dumps(content, indent=2) + "\n", encoding="utf-8"
            )
        elif isinstance(content, str):
            path.write_text(content + "\n", encoding="utf-8")
        logger.debug(f"Wrote diagram: {path}")
