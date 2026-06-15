"""Diagram builders — read structural store index files and produce DiagramModels.

One builder per diagram type. Each reads tab-separated index files
from a snapshot directory and returns a DiagramModel instance.

Builder list:
  ClassDiagramBuilder      — _index.txt + _inheritance.txt
  InheritanceTreeBuilder   — _inheritance.txt
  DependencyGraphBuilder   — _imports.txt
  ComponentDiagramBuilder  — _imports.txt (grouped by directory)
  PackageStructureBuilder  — _index.txt (grouped by path)
  PatternMapBuilder        — _patterns.txt + _index.txt
  SequenceDiagramBuilder   — _calls.txt (control flow)
  DataFlowBuilder          — _calls.txt + _imports.txt + _index.txt (data flow)
"""
import logging
from pathlib import Path
from typing import Optional

from src.ast.diagram_model import DiagramEntity, DiagramRelationship, DiagramModel

logger = logging.getLogger(__name__)


# --- File readers (shared by all builders) ---

def read_index(snapshot_path: Path) -> list[dict]:
    """Read _index.txt and return list of entry dicts."""
    index_file = snapshot_path / "_index.txt"
    if not index_file.exists():
        return []

    entries = []
    headers = None
    for line in index_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            # Parse header line to get column names
            headers = [h.strip() for h in line.lstrip("#").split("\t")]
            continue
        if headers is None:
            continue

        parts = line.split("\t")
        entry = {}
        for i, header in enumerate(headers):
            entry[header] = parts[i] if i < len(parts) else ""
        entries.append(entry)
    return entries


def read_inheritance(snapshot_path: Path) -> list[dict]:
    """Read _inheritance.txt and return list of relationship dicts."""
    inh_file = snapshot_path / "_inheritance.txt"
    if not inh_file.exists():
        return []

    entries = []
    headers = None
    for line in inh_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            headers = [h.strip() for h in line.lstrip("#").split("\t")]
            continue
        if headers is None:
            continue

        parts = line.split("\t")
        entry = {}
        for i, header in enumerate(headers):
            entry[header] = parts[i] if i < len(parts) else ""
        entries.append(entry)
    return entries


def read_imports(snapshot_path: Path) -> list[dict]:
    """Read _imports.txt and return list of import dicts."""
    imp_file = snapshot_path / "_imports.txt"
    if not imp_file.exists():
        return []

    entries = []
    headers = None
    for line in imp_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            headers = [h.strip() for h in line.lstrip("#").split("\t")]
            continue
        if headers is None:
            continue

        parts = line.split("\t")
        entry = {}
        for i, header in enumerate(headers):
            entry[header] = parts[i] if i < len(parts) else ""
        entries.append(entry)
    return entries


def read_patterns(snapshot_path: Path) -> list[dict]:
    """Read _patterns.txt and return list of pattern dicts."""
    pat_file = snapshot_path / "_patterns.txt"
    if not pat_file.exists():
        return []

    entries = []
    headers = None
    for line in pat_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            headers = [h.strip() for h in line.lstrip("#").split("\t")]
            continue
        if headers is None:
            continue

        parts = line.split("\t")
        entry = {}
        for i, header in enumerate(headers):
            entry[header] = parts[i] if i < len(parts) else ""
        entries.append(entry)
    return entries


def read_calls(snapshot_path: Path) -> list[dict]:
    """Read _calls.txt and return list of call edge dicts."""
    calls_file = snapshot_path / "_calls.txt"
    if not calls_file.exists():
        return []

    entries = []
    headers = None
    for line in calls_file.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("#"):
            headers = [h.strip() for h in line.lstrip("#").split("\t")]
            continue
        if headers is None:
            continue

        parts = line.split("\t")
        entry = {}
        for i, header in enumerate(headers):
            entry[header] = parts[i] if i < len(parts) else ""
        entries.append(entry)
    return entries


# --- Helpers ---

def _sanitize_id(name: str) -> str:
    """Sanitize a name for use as an entity ID."""
    return name.replace("-", "_").replace(".", "_").replace("/", "_").replace(" ", "_")


# --- Builders ---

class ClassDiagramBuilder:
    """Build class diagram from _index.txt and _inheritance.txt.

    Produces a DiagramModel with class entities (including members)
    and inheritance relationships.
    """

    def build(self, snapshot_path: Path) -> DiagramModel | None:
        """Build class diagram model from index files."""
        index = read_index(snapshot_path)
        inheritance = read_inheritance(snapshot_path)

        if not index:
            return None

        # Collect classes and their members
        classes: dict[str, DiagramEntity] = {}
        for entry in index:
            if entry.get("kind") == "class":
                name = entry["name"]
                entity_id = _sanitize_id(name)
                classes[name] = DiagramEntity(
                    id=entity_id,
                    name=name,
                    entity_type="class",
                    properties={"members": [], "flags": entry.get("flags", "")},
                )

        # Add members to their parent classes
        for entry in index:
            scope = entry.get("scope", "-")
            if scope != "-" and scope in classes:
                member = {
                    "name": entry["name"],
                    "kind": entry["kind"],
                    "signature": entry.get("signature", ""),
                }
                classes[scope].properties["members"].append(member)

        if not classes:
            return None

        # Build relationships from inheritance
        relationships = []
        for inh in inheritance:
            child = inh.get("child", "")
            parent = inh.get("parent", "")
            rel_type = inh.get("rel", "extends")

            # Ensure both entities exist
            if child not in classes:
                classes[child] = DiagramEntity(
                    id=_sanitize_id(child), name=child,
                    entity_type="class", properties={"members": []},
                )
            if parent not in classes:
                classes[parent] = DiagramEntity(
                    id=_sanitize_id(parent), name=parent,
                    entity_type="class", properties={"members": []},
                )

            relationships.append(DiagramRelationship(
                source_id=_sanitize_id(parent),
                target_id=_sanitize_id(child),
                rel_type=rel_type,
            ))

        return DiagramModel(
            diagram_type="class",
            title="Class Diagram",
            entities=list(classes.values()),
            relationships=relationships,
        )


class InheritanceTreeBuilder:
    """Build inheritance tree from _inheritance.txt."""

    def build(self, snapshot_path: Path) -> DiagramModel | None:
        """Build inheritance tree model."""
        inheritance = read_inheritance(snapshot_path)
        if not inheritance:
            return None

        entities: dict[str, DiagramEntity] = {}
        relationships = []

        for inh in inheritance:
            child = inh.get("child", "")
            parent = inh.get("parent", "")
            rel_type = inh.get("rel", "extends")

            for name in (child, parent):
                if name and name not in entities:
                    entities[name] = DiagramEntity(
                        id=_sanitize_id(name), name=name,
                        entity_type="class",
                    )

            relationships.append(DiagramRelationship(
                source_id=_sanitize_id(parent),
                target_id=_sanitize_id(child),
                rel_type=rel_type,
            ))

        return DiagramModel(
            diagram_type="inheritance",
            title="Inheritance Tree",
            entities=list(entities.values()),
            relationships=relationships,
        )


class DependencyGraphBuilder:
    """Build module dependency graph from _imports.txt."""

    def build(self, snapshot_path: Path) -> DiagramModel | None:
        """Build dependency graph model."""
        imports = read_imports(snapshot_path)
        if not imports:
            return None

        entities: dict[str, DiagramEntity] = {}
        relationships = []

        for imp in imports:
            source_file = imp.get("file", "")
            target_module = imp.get("imports", "")

            source_id = _sanitize_id(source_file)
            target_id = _sanitize_id(target_module)

            if source_file and source_file not in entities:
                entities[source_file] = DiagramEntity(
                    id=source_id, name=source_file,
                    entity_type="module",
                )
            if target_module and target_module not in entities:
                entities[target_module] = DiagramEntity(
                    id=target_id, name=target_module,
                    entity_type="module",
                )

            if source_file and target_module:
                relationships.append(DiagramRelationship(
                    source_id=source_id,
                    target_id=target_id,
                    rel_type="imports",
                ))

        return DiagramModel(
            diagram_type="dependency",
            title="Dependency Graph",
            entities=list(entities.values()),
            relationships=relationships,
        )


class ComponentDiagramBuilder:
    """Build component diagram from _imports.txt grouped by directory."""

    def build(self, snapshot_path: Path) -> DiagramModel | None:
        """Build component diagram model."""
        imports = read_imports(snapshot_path)
        if not imports:
            return None

        # Group files by top-level directory
        entities: dict[str, DiagramEntity] = {}
        relationships = []

        for imp in imports:
            source_file = imp.get("file", "")
            target_module = imp.get("imports", "")

            source_dir = self._top_dir(source_file)
            target_dir = self._top_dir(target_module)

            for dir_name in (source_dir, target_dir):
                if dir_name and dir_name not in entities:
                    entities[dir_name] = DiagramEntity(
                        id=_sanitize_id(dir_name), name=dir_name,
                        entity_type="module",
                    )

            if source_dir and target_dir and source_dir != target_dir:
                relationships.append(DiagramRelationship(
                    source_id=_sanitize_id(source_dir),
                    target_id=_sanitize_id(target_dir),
                    rel_type="imports",
                ))

        if not entities:
            return None

        return DiagramModel(
            diagram_type="component",
            title="Component Diagram",
            entities=list(entities.values()),
            relationships=relationships,
        )

    def _top_dir(self, path_str: str) -> str:
        """Extract top-level directory or module root."""
        parts = path_str.replace("\\", "/").replace(".", "/").split("/")
        return parts[0] if parts else path_str


class PackageStructureBuilder:
    """Build package/directory structure from _index.txt grouped by path.

    Shows the directory breakdown of the codebase with file counts
    and symbol counts per package.
    """

    def build(self, snapshot_path: Path) -> DiagramModel | None:
        """Build package structure model."""
        index = read_index(snapshot_path)
        if not index:
            return None

        # Group by directory path
        packages: dict[str, list[str]] = {}
        for entry in index:
            file_path = entry.get("file", "")
            parts = file_path.replace("\\", "/").split("/")
            if len(parts) > 1:
                pkg = "/".join(parts[:-1])
            else:
                pkg = "."
            packages.setdefault(pkg, []).append(entry.get("name", ""))

        if not packages:
            return None

        entities: dict[str, DiagramEntity] = {}
        relationships = []

        # Create package entities
        for pkg_path, symbols in packages.items():
            pkg_id = _sanitize_id(pkg_path)
            entities[pkg_path] = DiagramEntity(
                id=pkg_id,
                name=pkg_path,
                entity_type="package",
                properties={"symbol_count": len(symbols)},
            )

        # Create parent-child relationships between nested packages
        sorted_pkgs = sorted(packages.keys())
        for pkg in sorted_pkgs:
            parts = pkg.split("/")
            if len(parts) > 1:
                parent_pkg = "/".join(parts[:-1])
                if parent_pkg in entities:
                    relationships.append(DiagramRelationship(
                        source_id=_sanitize_id(parent_pkg),
                        target_id=_sanitize_id(pkg),
                        rel_type="contains",
                    ))

        return DiagramModel(
            diagram_type="package",
            title="Package Structure",
            entities=list(entities.values()),
            relationships=relationships,
        )


class PatternMapBuilder:
    """Build pattern map from _patterns.txt and _index.txt."""

    def build(self, snapshot_path: Path) -> DiagramModel | None:
        """Build pattern map model."""
        patterns = read_patterns(snapshot_path)
        if not patterns:
            return None

        entities: dict[str, DiagramEntity] = {}
        relationships = []

        # Group patterns by type
        pattern_types: dict[str, list[dict]] = {}
        for pat in patterns:
            ptype = pat.get("pattern", "unknown")
            pattern_types.setdefault(ptype, []).append(pat)

        for ptype, instances in pattern_types.items():
            # Create pattern type entity
            type_id = _sanitize_id(ptype)
            entities[ptype] = DiagramEntity(
                id=type_id, name=ptype,
                entity_type="pattern",
                properties={"instance_count": len(instances)},
            )

            # Create instance entities
            for inst in instances:
                symbol = inst.get("symbol", "")
                inst_id = _sanitize_id(f"{ptype}_{symbol}")
                entities[inst_id] = DiagramEntity(
                    id=inst_id, name=symbol,
                    entity_type="instance",
                    parent_id=type_id,
                    properties={
                        "confidence": inst.get("confidence", ""),
                        "file": inst.get("file", ""),
                        "evidence": inst.get("evidence", ""),
                    },
                )
                relationships.append(DiagramRelationship(
                    source_id=type_id,
                    target_id=inst_id,
                    rel_type="has_instance",
                ))

        return DiagramModel(
            diagram_type="pattern_map",
            title="Design Pattern Map",
            entities=list(entities.values()),
            relationships=relationships,
        )


_BUILTIN_NAMES = frozenset({
    "len", "print", "str", "int", "float", "list", "dict", "set", "tuple",
    "bool", "type", "isinstance", "issubclass", "enumerate", "range", "zip",
    "map", "filter", "sorted", "reversed", "any", "all", "min", "max", "sum",
    "abs", "round", "hash", "id", "repr", "super", "next", "iter", "open",
    "getattr", "setattr", "hasattr", "delattr", "callable", "vars", "dir",
    "logging", "logger", "field", "dataclass",
})


class SequenceDiagramBuilder:
    """Build sequence diagram models from _calls.txt.

    Traces call chains from entry points, producing a sequence of
    caller→callee interactions as a DiagramModel.
    """

    def __init__(self, max_depth: int = 10, min_confidence: float = 0.40):
        self.max_depth = max_depth
        self.min_confidence = min_confidence

    def _filter_calls(self, calls: list[dict]) -> list[dict]:
        """Filter out low-confidence and builtin calls."""
        filtered = []
        for call in calls:
            # Skip low-confidence calls
            try:
                conf = float(call.get("confidence", "1.0"))
            except (ValueError, TypeError):
                conf = 1.0
            if conf < self.min_confidence:
                continue

            # Skip builtin callees
            callee = call.get("callee", "")
            callee_base = callee.split(".")[0] if "." in callee else callee
            if callee_base.lower() in _BUILTIN_NAMES or callee in _BUILTIN_NAMES:
                continue

            # Skip callees that look like expressions (contain parens, brackets)
            if "(" in callee or "[" in callee:
                continue

            filtered.append(call)
        return filtered

    def build(self, snapshot_path: Path) -> Optional[DiagramModel]:
        """Build a combined sequence diagram from all call data."""
        calls = self._filter_calls(read_calls(snapshot_path))
        if not calls:
            return None

        # Build call graph adjacency list
        graph: dict[str, list[dict]] = {}
        for call in calls:
            caller = call.get("caller", "")
            if caller:
                graph.setdefault(caller, []).append(call)

        # Find entry points and trace from each
        entry_points = self.discover_entry_points(snapshot_path)
        if not entry_points:
            # Fall back to all callers
            entry_points = list(graph.keys())[:5]

        participants: dict[str, DiagramEntity] = {}
        relationships: list[DiagramRelationship] = []
        seq_num = [0]

        for entry in entry_points:
            self._trace_calls(
                graph, entry, 0, set(), participants, relationships, seq_num
            )

        if not participants:
            return None

        return DiagramModel(
            diagram_type="sequence",
            title="Sequence Diagram",
            entities=list(participants.values()),
            relationships=relationships,
            metadata={"entry_points": entry_points, "max_depth": self.max_depth},
        )

    def build_for_entry(
        self, snapshot_path: Path, entry_function: str
    ) -> Optional[DiagramModel]:
        """Build a sequence diagram starting from a specific entry point."""
        calls = self._filter_calls(read_calls(snapshot_path))
        if not calls:
            return None

        graph: dict[str, list[dict]] = {}
        for call in calls:
            caller = call.get("caller", "")
            if caller:
                graph.setdefault(caller, []).append(call)

        if entry_function not in graph:
            return None

        participants: dict[str, DiagramEntity] = {}
        relationships: list[DiagramRelationship] = []
        seq_num = [0]

        self._trace_calls(
            graph, entry_function, 0, set(), participants, relationships, seq_num
        )

        if not participants:
            return None

        return DiagramModel(
            diagram_type="sequence",
            title=f"Sequence: {entry_function}",
            entities=list(participants.values()),
            relationships=relationships,
            metadata={"entry_point": entry_function, "depth": self.max_depth},
        )

    def discover_entry_points(self, snapshot_path: Path) -> list[str]:
        """Find functions that are callers but never callees (top of call chain)."""
        calls = read_calls(snapshot_path)
        if not calls:
            return []

        callers = {c.get("caller", "") for c in calls if c.get("caller")}
        callees = {c.get("callee", "") for c in calls if c.get("callee")}

        # Functions that call others but are not called by anyone
        entry_points = callers - callees

        # Also look for common entry point patterns
        entry_patterns = ("handle_", "process_", "on_", "api_", "main", "run")
        for caller in callers:
            func_name = caller.split(".")[-1] if "." in caller else caller
            if any(func_name.startswith(p) for p in entry_patterns):
                entry_points.add(caller)

        return sorted(entry_points)

    def _trace_calls(
        self,
        graph: dict[str, list[dict]],
        current: str,
        depth: int,
        visited: set,
        participants: dict[str, DiagramEntity],
        relationships: list[DiagramRelationship],
        seq_num: list[int],
    ):
        """Recursively trace call chain with cycle detection."""
        if depth >= self.max_depth:
            return
        if current in visited:
            return
        visited.add(current)

        # Ensure caller participant exists
        caller_module = self._extract_module(current)
        if caller_module not in participants:
            participants[caller_module] = DiagramEntity(
                id=_sanitize_id(caller_module),
                name=caller_module,
                entity_type="participant",
            )

        for call in graph.get(current, []):
            callee = call.get("callee", "")
            if not callee:
                continue

            callee_module = self._extract_module(callee)
            if callee_module not in participants:
                participants[callee_module] = DiagramEntity(
                    id=_sanitize_id(callee_module),
                    name=callee_module,
                    entity_type="participant",
                )

            seq_num[0] += 1
            callee_method = callee.split(".")[-1] if "." in callee else callee
            relationships.append(DiagramRelationship(
                source_id=_sanitize_id(caller_module),
                target_id=_sanitize_id(callee_module),
                rel_type="calls",
                label=f"{callee_method}()",
            ))

            # Recurse into callee
            self._trace_calls(
                graph, callee, depth + 1, visited.copy(),
                participants, relationships, seq_num
            )

    def _extract_module(self, qualified_name: str) -> str:
        """Extract module/class from qualified name.

        'ClassName.method' → 'ClassName'
        'function_name' → 'function_name'
        """
        if "." in qualified_name:
            return qualified_name.rsplit(".", 1)[0]
        return qualified_name


class DataFlowBuilder:
    """Build data flow diagrams from _calls.txt + _imports.txt + _index.txt.

    Shows how data moves through the system: external inputs → processing
    functions → data stores → outputs. Unlike sequence diagrams (control flow),
    this focuses on data transformation paths.

    Node types:
      - external   — entry points, API endpoints, CLI handlers
      - process    — functions/methods that transform data
      - store      — repositories, databases, caches, file I/O
      - output     — return values, responses, logged results

    Edges show data flowing between nodes with the variable/type as label.
    """

    # Keywords that indicate data stores
    _STORE_KEYWORDS = {
        "repository", "repo", "cache", "store", "database", "db",
        "redis", "mongo", "postgres", "sql", "queue", "bucket",
        "persist", "save", "write", "insert", "update", "delete",
        "fetch", "load", "read", "get",
    }

    # Keywords that indicate external entry points
    _ENTRY_KEYWORDS = {
        "main", "handle", "handler", "controller", "endpoint",
        "api", "route", "grpc", "rpc", "on_", "process",
        "execute", "run", "start", "serve",
    }

    # Keywords that indicate output/sink
    _OUTPUT_KEYWORDS = {
        "log", "logger", "print", "send", "emit", "publish",
        "notify", "response", "reply", "return", "render",
        "write", "export", "report",
    }

    def __init__(self, min_confidence: float = 0.20):
        self.min_confidence = min_confidence

    def build(self, snapshot_path: Path) -> Optional[DiagramModel]:
        """Build a data flow diagram from structural store files."""
        calls = read_calls(snapshot_path)
        imports = read_imports(snapshot_path)
        index = read_index(snapshot_path)

        if not calls:
            return None

        # Filter calls
        calls = self._filter_calls(calls)
        if not calls:
            return None

        # Classify all symbols we encounter
        store_symbols = self._identify_stores(calls, imports, index)
        entry_symbols = self._identify_entries(calls, index)
        output_symbols = self._identify_outputs(calls)

        # Build nodes and edges
        entities: dict[str, DiagramEntity] = {}
        relationships: list[DiagramRelationship] = []

        for call in calls:
            caller = call.get("caller", "")
            callee = call.get("callee", "")
            if not caller or not callee:
                continue

            # Classify caller
            caller_class = self._extract_class(caller)
            callee_class = self._extract_class(callee)
            callee_method = callee.rsplit(".", 1)[-1] if "." in callee else callee

            # Determine node types
            caller_type = self._classify_node(
                caller, caller_class, entry_symbols, store_symbols, output_symbols
            )
            callee_type = self._classify_node(
                callee, callee_class, entry_symbols, store_symbols, output_symbols
            )

            # Create entities
            caller_id = _sanitize_id(caller_class or caller)
            callee_id = _sanitize_id(callee_class or callee)

            if caller_id not in entities:
                entities[caller_id] = DiagramEntity(
                    id=caller_id,
                    name=caller_class or caller,
                    entity_type=caller_type,
                    properties={"methods": set()},
                )
            entities[caller_id].properties["methods"].add(
                caller.rsplit(".", 1)[-1] if "." in caller else caller
            )

            if callee_id not in entities:
                entities[callee_id] = DiagramEntity(
                    id=callee_id,
                    name=callee_class or callee,
                    entity_type=callee_type,
                    properties={"methods": set()},
                )
            entities[callee_id].properties["methods"].add(callee_method)

            # Create data flow edge
            edge_label = callee_method
            relationships.append(DiagramRelationship(
                source_id=caller_id,
                target_id=callee_id,
                rel_type="data_flow",
                label=edge_label,
            ))

        if not entities:
            return None

        # Deduplicate relationships
        seen_edges: set[tuple] = set()
        deduped: list[DiagramRelationship] = []
        for rel in relationships:
            key = (rel.source_id, rel.target_id, rel.label)
            if key not in seen_edges:
                seen_edges.add(key)
                deduped.append(rel)

        # Convert method sets to sorted lists for serialisation
        for entity in entities.values():
            methods = entity.properties.get("methods", set())
            entity.properties["methods"] = sorted(methods) if methods else []

        return DiagramModel(
            diagram_type="data_flow",
            title="Data Flow Diagram",
            entities=list(entities.values()),
            relationships=deduped,
            metadata={"node_types": {
                "external": len([e for e in entities.values() if e.entity_type == "external"]),
                "process": len([e for e in entities.values() if e.entity_type == "process"]),
                "store": len([e for e in entities.values() if e.entity_type == "store"]),
                "output": len([e for e in entities.values() if e.entity_type == "output"]),
            }},
        )

    def _filter_calls(self, calls: list[dict]) -> list[dict]:
        """Filter low-confidence and expression-based calls."""
        filtered = []
        for call in calls:
            try:
                conf = float(call.get("confidence", "1.0"))
            except (ValueError, TypeError):
                conf = 1.0
            if conf < self.min_confidence:
                continue
            callee = call.get("callee", "")
            # Skip expression-like callees (contain parens, newlines)
            if "(" in callee or "\n" in callee:
                continue
            filtered.append(call)
        return filtered

    def _extract_class(self, qualified_name: str) -> str:
        """Extract class/module from qualified name."""
        if "." in qualified_name:
            return qualified_name.rsplit(".", 1)[0]
        return qualified_name

    def _classify_node(
        self,
        full_name: str,
        class_name: str,
        entries: set[str],
        stores: set[str],
        outputs: set[str],
    ) -> str:
        """Classify a node as external, store, output, or process."""
        lower = (class_name or full_name).lower()
        if class_name in entries or full_name in entries:
            return "external"
        if class_name in stores or full_name in stores:
            return "store"
        if class_name in outputs or full_name in outputs:
            return "output"
        # Keyword heuristics
        for kw in self._STORE_KEYWORDS:
            if kw in lower:
                return "store"
        for kw in self._OUTPUT_KEYWORDS:
            if kw in lower:
                return "output"
        for kw in self._ENTRY_KEYWORDS:
            if kw in lower:
                return "external"
        return "process"

    def _identify_stores(
        self, calls: list[dict], imports: list[dict], index: list[dict]
    ) -> set[str]:
        """Identify data store symbols from names and patterns."""
        stores: set[str] = set()
        all_names = set()
        for call in calls:
            all_names.add(call.get("caller", ""))
            all_names.add(call.get("callee", ""))

        for name in all_names:
            lower = name.lower()
            for kw in self._STORE_KEYWORDS:
                if kw in lower:
                    stores.add(name)
                    # Also add the class
                    if "." in name:
                        stores.add(name.rsplit(".", 1)[0])
                    break
        return stores

    def _identify_entries(self, calls: list[dict], index: list[dict]) -> set[str]:
        """Identify entry point symbols."""
        entries: set[str] = set()
        # Callers that are never callees are potential entry points
        callers = {c.get("caller", "") for c in calls}
        callees = {c.get("callee", "") for c in calls}
        roots = callers - callees

        for name in roots:
            entries.add(name)
            if "." in name:
                entries.add(name.rsplit(".", 1)[0])

        # Also add anything matching entry keywords from index
        for entry in index:
            name = entry.get("name", "")
            lower = name.lower()
            for kw in self._ENTRY_KEYWORDS:
                if kw in lower:
                    scope = entry.get("scope", "")
                    if scope and scope != "-":
                        entries.add(f"{scope}.{name}")
                        entries.add(scope)
                    else:
                        entries.add(name)
                    break
        return entries

    def _identify_outputs(self, calls: list[dict]) -> set[str]:
        """Identify output/sink symbols."""
        outputs: set[str] = set()
        for call in calls:
            callee = call.get("callee", "")
            lower = callee.lower()
            for kw in self._OUTPUT_KEYWORDS:
                if kw in lower:
                    outputs.add(callee)
                    if "." in callee:
                        outputs.add(callee.rsplit(".", 1)[0])
                    break
        return outputs
