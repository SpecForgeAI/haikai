"""Test adaptive agentic discovery on Discourse (Ruby/Rails).

Validates that the discovery pipeline works on a language where
tree-sitter can't parse (Ruby). Uses ctags-only structural data.
"""
import logging
import sys
import tempfile
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.ast.ctags_provider import CtagsProvider
from src.ast.store import FileStore


def build_snapshot(project_root: str) -> str:
    """Build a ctags-only snapshot of Discourse."""
    files = []
    for f in Path(project_root).rglob("*.rb"):
        s = str(f).replace("\\", "/")
        if ".git" not in s and "vendor" not in s and "/spec/" not in s and "/test/" not in s:
            files.append(s)
    files = files[:500]
    logger.info(f"Found {len(files)} Ruby files")

    ctags = CtagsProvider()
    ctags_results = ctags.analyze_batch(files)
    logger.info(f"Ctags analyzed {len(ctags_results)} files")

    snap_dir = tempfile.mkdtemp(prefix="discourse-snap-")
    store = FileStore(base_path=snap_dir)
    snapshot_path = store.write_snapshot(
        repo_name="discourse",
        commit_sha="test",
        branch="main",
        provider="ctags",
        analyses=ctags_results,
        project_root=project_root,
    )
    logger.info(f"Snapshot at: {snapshot_path}")

    for f in ["_index.txt", "_imports.txt", "_calls.txt", "_inheritance.txt"]:
        p = Path(snapshot_path) / f
        if p.exists():
            lines = [l for l in p.read_text(errors="replace").splitlines()
                     if not l.startswith("#") and l.strip()]
            logger.info(f"  {f}: {len(lines)} entries")
        else:
            logger.info(f"  {f}: missing")

    return str(snapshot_path)


def test_endpoint_discovery(project_root: str, snapshot_path: str, model: str):
    """Run endpoint discovery and report results."""
    from src.llm_client import LLMClient
    from src.ast.endpoint_discoverer import discover_endpoints

    logger.info(f"\n{'='*60}")
    logger.info(f"ENDPOINT DISCOVERY — model={model}")
    logger.info(f"{'='*60}")

    client = LLMClient("openai", model=model)
    endpoints = discover_endpoints(
        client,
        project_root=project_root,
        snapshot_path=snapshot_path,
    )

    logger.info(f"Found {len(endpoints)} endpoints")
    for ep in endpoints[:30]:
        logger.info(f"  {ep.operation} {ep.path} -> {ep.file}:{ep.line}")

    return endpoints


def test_interaction_discovery(project_root: str, snapshot_path: str, model: str):
    """Run interaction discovery and report results."""
    from src.llm_client import LLMClient
    from src.ast.interaction_discoverer import discover_interactions

    logger.info(f"\n{'='*60}")
    logger.info(f"INTERACTION DISCOVERY — model={model}")
    logger.info(f"{'='*60}")

    client = LLMClient("openai", model=model)
    interactions = discover_interactions(
        client,
        project_root=project_root,
        snapshot_path=snapshot_path,
    )

    logger.info(f"Found {len(interactions)} interactions")
    for ix in interactions[:20]:
        logger.info(f"  {ix.target_type} {ix.target} ({ix.mechanism})")

    return interactions


if __name__ == "__main__":
    project_root = sys.argv[1] if len(sys.argv) > 1 else "/tmp/discourse"
    model = sys.argv[2] if len(sys.argv) > 2 else "gpt-5.4-mini"

    if not Path(project_root).exists():
        logger.error(f"Discourse not found at {project_root}")
        logger.error("Clone it: git clone --depth 1 https://github.com/discourse/discourse.git /tmp/discourse")
        sys.exit(1)

    snapshot_path = build_snapshot(project_root)
    endpoints = test_endpoint_discovery(project_root, snapshot_path, model)
    interactions = test_interaction_discovery(project_root, snapshot_path, model)

    print(f"\n{'='*60}")
    print(f"SUMMARY (model={model})")
    print(f"  Endpoints: {len(endpoints)}")
    print(f"  Interactions: {len(interactions)}")
    print(f"{'='*60}")
