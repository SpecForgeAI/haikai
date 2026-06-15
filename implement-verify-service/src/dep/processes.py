"""Process / API-flow discovery.

For each endpoint, run a flow trace from its handler. Cluster endpoints whose
flows share ≥SIMILARITY_THRESHOLD of their internal symbols. Each cluster
becomes one logical "process" — typically maps to a feature or controller.

Uses Jaccard similarity directly (no networkx Louvain needed for our scale).
Deterministic: same DB → same processes.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from src.dep.db import DepGraph
from src.dep.flow import trace_from

SIMILARITY_THRESHOLD = 0.6   # Jaccard ≥ 0.6 → same process
DEFAULT_FLOW_DEPTH = 4
DEFAULT_MIN_SIZE = 1


@dataclass
class Process:
    name: str
    endpoints: list[dict] = field(default_factory=list)   # {operation, path, framework}
    key_symbols: list[str] = field(default_factory=list)  # most common symbols across the cluster's flows
    interactions: list[dict] = field(default_factory=list)  # mechanisms used
    notes: list[str] = field(default_factory=list)


# ─── public API ───────────────────────────────────────────────────────────

def processes_in(graph: DepGraph,
                  min_size: int = DEFAULT_MIN_SIZE,
                  framework_filter: Optional[str] = None,
                  flow_depth: int = DEFAULT_FLOW_DEPTH) -> list[Process]:
    """Discover logical processes by clustering endpoint flows."""
    # Pull endpoints
    sql = "SELECT id, operation, path, framework, handler_symbol_id FROM endpoints"
    args: list = []
    if framework_filter:
        sql += " WHERE framework = ?"
        args.append(framework_filter)
    rows = graph.query(sql, args)

    if not rows:
        return []

    # Compute flow symbol-set for each endpoint
    flows: list[tuple[dict, set[str]]] = []
    for r in rows:
        ep = {
            "id": r["id"],
            "operation": r["operation"],
            "path": r["path"],
            "framework": r["framework"] or "",
            "handler_id": r["handler_symbol_id"],
        }
        seed = f"{ep['operation']} {ep['path']}"
        fg = trace_from(graph, seed, max_depth=flow_depth)
        symbols = {n.qualified_name for n in fg.nodes if n.kind == "symbol"}
        if symbols:
            flows.append((ep, symbols))

    # Greedy clustering by Jaccard similarity
    clusters: list[list[tuple[dict, set[str]]]] = []
    for ep, sym_set in flows:
        placed = False
        for cluster in clusters:
            # Compare against the cluster's first flow (representative)
            ref_syms = cluster[0][1]
            if _jaccard(sym_set, ref_syms) >= SIMILARITY_THRESHOLD:
                cluster.append((ep, sym_set))
                placed = True
                break
        if not placed:
            clusters.append([(ep, sym_set)])

    # Build Process objects
    processes: list[Process] = []
    for cluster in clusters:
        if len(cluster) < min_size:
            continue
        proc = _build_process(graph, cluster)
        processes.append(proc)
    # Order by member count desc for stable output
    processes.sort(key=lambda p: -len(p.endpoints))
    return processes


# ─── helpers ───────────────────────────────────────────────────────────────

def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    inter = len(a & b)
    union = len(a | b)
    return inter / union if union else 0.0


def _build_process(graph: DepGraph,
                    cluster: list[tuple[dict, set[str]]]) -> Process:
    """Aggregate a cluster into a Process."""
    proc = Process(name="(unnamed)")

    # Endpoints in this cluster
    for ep, _ in cluster:
        proc.endpoints.append({
            "operation": ep["operation"],
            "path": ep["path"],
            "framework": ep["framework"],
        })

    # Key symbols = symbols appearing in ≥half the cluster's flows
    threshold = max(1, len(cluster) // 2)
    counts: dict[str, int] = {}
    for _, syms in cluster:
        for s in syms:
            counts[s] = counts.get(s, 0) + 1
    key = sorted(
        (s for s, c in counts.items() if c >= threshold),
        key=lambda s: -counts[s],
    )[:20]
    proc.key_symbols = key

    # Interactions across all flows in cluster
    union_syms: set[str] = set()
    for _, syms in cluster:
        union_syms |= syms
    if union_syms:
        placeholders = ",".join("?" * len(union_syms))
        rows = graph.query(
            f"""SELECT DISTINCT i.mechanism, i.target, i.direction
                FROM interactions i
                JOIN symbols s ON i.source_symbol_id = s.id
                WHERE s.qualified_name IN ({placeholders})""",
            list(union_syms),
        )
        proc.interactions = [
            {"mechanism": r["mechanism"], "target": r["target"] or "",
             "direction": r["direction"]}
            for r in rows
        ]

    # Heuristic name: most-common controller class among handler symbols
    proc.name = _name_from_handlers(graph, cluster)
    return proc


def _name_from_handlers(graph: DepGraph,
                          cluster: list[tuple[dict, set[str]]]) -> str:
    """Best-guess name: most common Class.* prefix of handler qnames."""
    handler_ids = [ep["handler_id"] for ep, _ in cluster if ep["handler_id"]]
    if not handler_ids:
        # Fall back to first endpoint's path stem
        first_path = cluster[0][0]["path"]
        return first_path.strip("/").split("/")[0] or "root"

    placeholders = ",".join("?" * len(handler_ids))
    rows = graph.query(
        f"SELECT qualified_name FROM symbols WHERE id IN ({placeholders})",
        handler_ids,
    )
    classes: dict[str, int] = {}
    for r in rows:
        q = r["qualified_name"] or ""
        cls = q.rsplit(".", 1)[0] if "." in q else q
        classes[cls] = classes.get(cls, 0) + 1
    if not classes:
        return "(unknown)"
    return max(classes.items(), key=lambda x: x[1])[0]
