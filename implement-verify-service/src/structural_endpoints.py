"""Structural analysis API endpoints.

Five use-case-driven POST endpoints for structural data:
1. POST /api/v1/structural/analyze — trigger analysis + store
2. POST /api/v1/structural/{repo}/raw — read raw index files
3. POST /api/v1/structural/{repo}/query — query structural data
4. POST /api/v1/structural/{repo}/metamodel/populate — populate metamodel
5. POST /api/v1/structural/{repo}/diagrams/generate — generate diagrams
"""
import json
import logging
import os
import shutil
import stat
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from src.ast.store import FileStore as StructuralFileStore
from src.ast.diagram_generator import DiagramGenerator
from src.ast.metamodel_engine import MetamodelEngine
from src.ast.kind_mapping_loader import VersionNotFoundError
from src.ast.provider import ProviderRegistry
from src.path_safety import safe_segment
from src.repo_fetcher import RepositoryFetcher

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/structural", tags=["structural"])

# Auth is shared across the FastAPI surface — see src/api_auth.py.
from src.api_auth import verify_api_key  # noqa: E402, F401


# --- Request/Response Models ---

class AnalyzeRequest(BaseModel):
    """Request to analyze a repository.

    Supply either ``repo_url`` (a GitHub / GitLab / Bitbucket URL that will be
    shallow-cloned automatically) **or** ``local_path`` (an already-cloned
    directory on disk).  If both are provided, ``repo_url`` takes precedence.
    """
    repo_url: Optional[str] = None
    local_path: Optional[str] = None
    branch: Optional[str] = None
    commit_sha: Optional[str] = None
    providers: Optional[list[str]] = None

class AnalyzeResponse(BaseModel):
    snapshot_id: str
    repo: str
    branch: str
    # `input_file_count` is what the analyzer was *given*; `file_count` is
    # what survived the pipeline. A drop ratio (input > file_count) is the
    # primary signal that a stage silently lost rows.
    input_file_count: int = 0
    file_count: int
    symbol_count: int
    store_path: str
    # Stages whose `except` block fired during this run. Empty = clean run.
    # Pipeline is best-effort by design (see commit 7af0c83), so a 200 with
    # a non-empty failed_stages is the documented partial-success shape.
    failed_stages: list[str] = Field(default_factory=list)

class RawRequest(BaseModel):
    """Request to read raw index files."""
    snapshot: str = "latest"
    include: Optional[list[str]] = None  # index, inheritance, imports, patterns, stats

class QueryRequest(BaseModel):
    """Request to query structural data."""
    question: str
    snapshot: str = "latest"

class QueryResponse(BaseModel):
    answer: str
    evidence: list[str]
    method: str  # direct_lookup or llm_assisted

class MetamodelPopulateRequest(BaseModel):
    """Request to populate metamodel from structural data."""
    metamodel_id: Optional[str] = None
    metamodel: Optional[dict] = None  # inline metamodel or fetch by ID
    snapshot: str = "latest"

class DiagramsGenerateRequest(BaseModel):
    """Request to generate diagrams."""
    snapshot: str = "latest"
    types: Optional[list[str]] = None  # class-diagram, inheritance-tree, etc.
    formats: Optional[list[str]] = None  # mermaid, plantuml, graphviz, metamodel
    versions: Optional[dict[str, str]] = None


# --- Helpers ---

def _clone_root() -> Path:
    """Where shallow clones live. Anchored to the project root unless the
    operator overrides AST_STORE_PATH (matches _get_store(), so the snapshot
    tree and the clone tree always share one parent).
    """
    env_override = os.getenv("AST_STORE_PATH")
    if env_override:
        base = Path(env_override).parent
    else:
        # src/structural_endpoints.py → parents[1] = repo root
        base = Path(__file__).resolve().parents[1] / ".specforge"
    return base / "repos"


def _clone_repo(repo_url: str, branch: Optional[str] = None) -> Path:
    """Shallow-clone a remote repo into a temp directory under .specforge/repos/.

    Returns the Path to the cloned directory.  Re-uses RepositoryFetcher to
    parse the URL so we get platform, owner, repo, and optional branch.
    """
    fetcher = RepositoryFetcher(
        github_token=os.getenv("GITHUB_TOKEN"),
    )
    # parse_repo_url raises ValueError on unparseable URLs. That's a
    # client-side bad-input case, so map to 400 instead of letting it
    # bubble up to the analyze handler's catch-all `except Exception`
    # which would mis-classify it as a 500.
    try:
        platform, owner, repo, url_branch, _path, _is_file = fetcher.parse_repo_url(repo_url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    effective_branch = branch or url_branch  # caller override > URL-embedded

    # Validate URL-derived segments BEFORE joining into a filesystem path.
    # parse_repo_url's regex permits `..` (and a URL like
    # `https://github.com/x/...git` yields `repo='..'`); without these
    # checks the rmtree below escapes via `Path/foo/..` → parent dir.
    try:
        safe_owner = safe_segment(owner, "owner")
        safe_repo = safe_segment(repo, "repo")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    clone_root = _clone_root()
    clone_dir = clone_root / safe_owner / safe_repo

    # Defense-in-depth: even with safe_segment in place, assert the resolved
    # path stays under clone_root before we rmtree anything.
    try:
        clone_dir.resolve().relative_to(clone_root.resolve())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"resolved clone_dir escapes clone_root: {clone_dir}",
        )

    if clone_dir.exists():
        def _remove_readonly(func, path, _exc):
            os.chmod(path, stat.S_IWRITE)
            func(path)
        shutil.rmtree(clone_dir, onerror=_remove_readonly)
    clone_dir.parent.mkdir(parents=True, exist_ok=True)

    github_token = os.getenv("GITHUB_TOKEN")
    # Only attach the server's token to allowlisted owners — see
    # autoresearch:debug 260504-1448 finding M2 + standards_orchestrator
    # ._owner_in_allowlist for the contract.
    from src.standards_orchestrator import _owner_in_allowlist
    if platform == "github" and github_token and _owner_in_allowlist(safe_owner):
        clone_url = f"https://{github_token}@github.com/{safe_owner}/{safe_repo}.git"
    elif platform == "github":
        clone_url = f"https://github.com/{owner}/{repo}.git"
    elif platform == "gitlab":
        clone_url = f"https://gitlab.com/{owner}/{repo}.git"
    elif platform == "bitbucket":
        clone_url = f"https://bitbucket.org/{owner}/{repo}.git"
    else:
        clone_url = repo_url

    cmd = ["git", "clone", "--depth", "1"]
    if effective_branch:
        cmd.extend(["--branch", effective_branch])
    # `--` blocks argv-injection if clone_url ever starts with `-` (the
    # `else: clone_url = repo_url` fallback above is theoretically reachable
    # for unusual URL shapes that pass parse_repo_url).
    cmd.extend(["--", clone_url, str(clone_dir)])

    # Catch TimeoutExpired explicitly so the cmd argv (which embeds the
    # token in clone_url) can never leak via the default exception repr.
    # See autoresearch:debug 260504-1448 finding M1.
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(
            status_code=504,
            detail=f"git clone timed out after 300s for {repo_url}",
        )
    if result.returncode != 0:
        # Defensive scrub in case git's stderr ever echoes the auth_url.
        stderr = result.stderr.strip()
        if github_token:
            stderr = stderr.replace(github_token, "<REDACTED>")
        raise HTTPException(
            status_code=400,
            detail=f"git clone failed: {stderr}",
        )

    logger.info(f"Cloned {repo_url} -> {clone_dir}")
    return clone_dir


def _get_repo_name(local_path: Path) -> str:
    """Derive repo name from git root or walk up from src/."""
    import subprocess
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, encoding="utf-8",
            errors="replace",
            cwd=str(local_path), timeout=5,
        )
        if result.returncode == 0:
            return Path(result.stdout.strip()).name
    except Exception:
        pass
    # Fallback: if path ends with "src", use parent
    if local_path.name == "src":
        return local_path.parent.name
    return local_path.name


def _get_llm_client():
    """Create LLM client from environment config, or None if not configured.

    Routes through `build_llm_client` so the env-var contract (including
    LLM_BASE_URL for provider=custom) stays identical to the discovery
    routes — historically this site duplicated the LLMClient kwargs and
    silently dropped LLM_BASE_URL, so the user's preferred custom proxy
    never engaged on /analyze.

    Returns None silently when LLM_PROVIDER / LLM_MODEL are simply not set
    (the documented "no LLM configured" path). Returns None with an ERROR
    log when the config IS attempted but invalid (missing key, missing
    base_url for custom, unknown provider). Unexpected exceptions propagate
    to the caller's 500 handler.
    """
    # Silent path: nothing configured at all. Avoid noisy logs in the
    # common no-LLM case.
    if not os.getenv("LLM_PROVIDER") or not os.getenv("LLM_MODEL"):
        return None

    from src.llm_client_factory import build_llm_client

    try:
        return build_llm_client(provider=None, model=None, log_dir=None)
    except ValueError as e:
        logger.error("LLM enrichment disabled: %s", e)
        return None


def _get_store() -> StructuralFileStore:
    """Get configured StructuralFileStore.

    Default anchored to the project root, NOT cwd, so the store still works
    when uvicorn is launched from a different directory (a previous version
    silently created `.specforge/structural` next to wherever the process
    happened to start). Same pattern as PROPOSED_DIR in playbook_writer.py.
    """
    env_override = os.getenv("AST_STORE_PATH")
    if env_override:
        store_path: str | Path = env_override
    else:
        # src/structural_endpoints.py → parents[1] = repo root
        store_path = Path(__file__).resolve().parents[1] / ".specforge" / "structural"
    return StructuralFileStore(base_path=str(store_path))


def _resolve_snapshot(store: StructuralFileStore, repo: str, snapshot: str) -> Path:
    """Resolve snapshot path from 'latest' or short SHA.

    Validates `repo` and `snapshot` segments before joining — without
    these checks `/diagrams/generate` would write a `diagrams/` subdir
    under any path the attacker could reach via `..` traversal in either
    field. See autoresearch:debug 260504-1301 finding #2.
    """
    # safe_segment rejects bare `..`, separators, and anything outside
    # [A-Za-z0-9_.-]. It's strict enough for both repo names and short SHAs.
    try:
        repo = safe_segment(repo, "repo")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if snapshot == "latest":
        latest = store.get_latest_path(repo)
        if latest is None:
            raise HTTPException(status_code=404, detail=f"No snapshots found for repo '{repo}'")
        return Path(latest)

    try:
        snapshot = safe_segment(snapshot, "snapshot")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    candidate = store.base_path / repo / snapshot
    # Defense in depth: even with safe_segment in place, assert the
    # resolved path stays under store.base_path before any caller writes
    # to it (e.g. /diagrams/generate creates `diagrams/` here).
    try:
        candidate.resolve().relative_to(store.base_path.resolve())
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"resolved snapshot path escapes store base: {candidate}",
        )

    if not candidate.exists():
        raise HTTPException(status_code=404, detail=f"Snapshot '{snapshot}' not found for repo '{repo}'")
    return candidate


# --- Endpoints ---

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze(
    request: AnalyzeRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Trigger structural analysis and write to file store.

    Accepts either a ``repo_url`` (cloned automatically) or a ``local_path``.
    """
    try:
        if request.repo_url:
            local_path = _clone_repo(request.repo_url, request.branch)
        elif request.local_path:
            local_path = Path(request.local_path)
        else:
            raise HTTPException(
                status_code=400,
                detail="Provide either repo_url or local_path",
            )

        if not local_path.exists():
            raise HTTPException(status_code=400, detail=f"Path not found: {local_path}")

        # Discover source files — extensions determined dynamically by ctags
        from src.ast.ctags_provider import CtagsProvider
        supported = CtagsProvider.get_supported_extensions()
        file_paths = []
        for f in local_path.rglob("*"):
            if f.is_file() and f.suffix in supported and ".git" not in f.parts:
                file_paths.append(str(f))

        if not file_paths:
            raise HTTPException(status_code=400, detail="No source files found")

        # Step 1: Ctags analysis (symbols, inheritance)
        from src.ast.ctags_provider import CtagsProvider
        registry = ProviderRegistry()
        ctags = CtagsProvider()
        # Fail loud if ctags is missing — without it we cannot register any
        # provider and the previous behavior was a confusing 500 "Analysis
        # produced no results". 503 communicates "operator action needed".
        if not ctags.is_available():
            raise HTTPException(
                status_code=503,
                detail="ctags binary not available — install universal-ctags",
            )
        registry.register(ctags)
        analyses = registry.analyze_batch(file_paths)

        if not analyses:
            raise HTTPException(status_code=500, detail="Analysis produced no results")

        # Step 2: Store + tree-sitter enrichment + interaction classification
        from src.ast.pipeline import run_structural_pipeline
        store = _get_store()
        repo_name = _get_repo_name(local_path)

        # Create LLM client for interaction classification (if configured)
        llm_client = _get_llm_client()

        # Resolve branch: explicit request > git detection > fallback
        from src.ast.store import get_git_info
        git_info = get_git_info(str(local_path))
        effective_branch = request.branch or git_info.get("branch") or "main"

        # Pre-allocated stats dict — pipeline mutates in place so we can
        # surface partial failures (and the input/output file ratio) on the
        # response without piggybacking on logger output.
        pipeline_stats: dict = {}
        analyses = run_structural_pipeline(
            file_paths=file_paths,
            ctags_results=analyses,
            store=store,
            registry=registry,
            repo_name=repo_name,
            commit_sha=request.commit_sha or git_info.get("commit_sha") or "nocommit",
            branch=effective_branch,
            project_root=str(local_path),
            llm_client=llm_client,
            discovery_stats=pipeline_stats,
        )

        total_symbols = sum(len(a.symbols) for a in analyses.values())

        # Get snapshot path for response. If the pipeline ran but no snapshot
        # landed on disk, that's a server-side failure — don't paper over it
        # with snapshot_id="unknown" + 200.
        snapshot_path = store.get_latest_path(repo_name)
        if not snapshot_path:
            raise HTTPException(
                status_code=500,
                detail="Pipeline ran but snapshot was not written — see server logs",
            )

        return AnalyzeResponse(
            snapshot_id=Path(snapshot_path).name,
            repo=repo_name,
            branch=effective_branch,
            input_file_count=len(file_paths),
            file_count=len(analyses),
            symbol_count=total_symbols,
            store_path=snapshot_path,
            failed_stages=list(pipeline_stats.get("failed_stages", [])),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{repo}/raw")
async def raw(
    repo: str,
    request: RawRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Read raw index files from a snapshot."""
    try:
        store = _get_store()
        snapshot_path = _resolve_snapshot(store, repo, request.snapshot)

        # Default: return all index files
        include = request.include or ["index", "inheritance", "imports", "patterns", "stats"]

        file_map = {
            "index": "_index.txt",
            "inheritance": "_inheritance.txt",
            "imports": "_imports.txt",
            "patterns": "_patterns.txt",
            "stats": "_stats.txt",
            "meta": "_meta.yaml",
        }

        result = {}
        for name in include:
            filename = file_map.get(name)
            if filename:
                file_path = snapshot_path / filename
                if file_path.exists():
                    result[name] = file_path.read_text(encoding="utf-8")
                else:
                    result[name] = None

        return {"snapshot": snapshot_path.name, "repo": repo, "files": result}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Raw read failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{repo}/query")
async def query(
    repo: str,
    request: QueryRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Query structural data with a question."""
    try:
        store = _get_store()
        snapshot_path = _resolve_snapshot(store, repo, request.snapshot)

        question = request.question.lower()
        evidence = []
        answer = ""
        method = "direct_lookup"

        # Direct lookup patterns
        index_path = snapshot_path / "_index.txt"
        if not index_path.exists():
            raise HTTPException(status_code=404, detail="No index file in snapshot")

        index_content = index_path.read_text(encoding="utf-8")

        if any(kw in question for kw in ["class", "classes"]):
            matches = [
                line for line in index_content.split("\n")
                if "\tclass\t" in line and not line.startswith("#")
            ]
            evidence = matches[:20]
            answer = f"Found {len(matches)} classes"

        elif any(kw in question for kw in ["function", "functions", "method", "methods"]):
            matches = [
                line for line in index_content.split("\n")
                if ("\tfunction\t" in line or "\tmethod\t" in line) and not line.startswith("#")
            ]
            evidence = matches[:20]
            answer = f"Found {len(matches)} functions/methods"

        elif any(kw in question for kw in ["inherit", "extends", "hierarchy"]):
            inh_path = snapshot_path / "_inheritance.txt"
            if inh_path.exists():
                inh_content = inh_path.read_text(encoding="utf-8")
                matches = [l for l in inh_content.split("\n") if l.strip() and not l.startswith("#")]
                evidence = matches[:20]
                answer = f"Found {len(matches)} inheritance relationships"
            else:
                answer = "No inheritance data available"

        elif any(kw in question for kw in ["import", "dependency", "dependencies"]):
            imp_path = snapshot_path / "_imports.txt"
            if imp_path.exists():
                imp_content = imp_path.read_text(encoding="utf-8")
                matches = [l for l in imp_content.split("\n") if l.strip() and not l.startswith("#")]
                evidence = matches[:20]
                answer = f"Found {len(matches)} import entries"
            else:
                answer = "No import data available"

        elif any(kw in question for kw in ["pattern", "patterns"]):
            pat_path = snapshot_path / "_patterns.txt"
            if pat_path.exists():
                pat_content = pat_path.read_text(encoding="utf-8")
                matches = [l for l in pat_content.split("\n") if l.strip() and not l.startswith("#")]
                evidence = matches[:20]
                answer = f"Found {len(matches)} pattern detections"
            else:
                answer = "No pattern data available"

        else:
            # Fallback: grep the question terms across index
            terms = [t for t in question.split() if len(t) > 2]
            matches = []
            for line in index_content.split("\n"):
                if any(t in line.lower() for t in terms) and not line.startswith("#"):
                    matches.append(line)
            evidence = matches[:20]
            answer = f"Found {len(matches)} matching entries for '{request.question}'"
            method = "direct_lookup"

        return QueryResponse(answer=answer, evidence=evidence, method=method)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Query failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{repo}/metamodel/populate")
async def metamodel_populate(
    repo: str,
    request: MetamodelPopulateRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Populate metamodel entities from structural data."""
    try:
        store = _get_store()
        snapshot_path = _resolve_snapshot(store, repo, request.snapshot)

        # Get or create metamodel
        metamodel = request.metamodel or {"version_id": 1}

        # Read analyses from snapshot index files
        from src.ast.diagram_builders import read_index
        index_entries = read_index(snapshot_path)

        if not index_entries:
            raise HTTPException(status_code=404, detail="No structural data in snapshot")

        # Convert index entries to lightweight StructuralAnalysis objects
        from src.ast.models import StructuralAnalysis, SymbolInfo, SymbolKind
        file_analyses = {}
        kind_map = {
            "class": SymbolKind.CLASS,
            "function": SymbolKind.FUNCTION,
            "method": SymbolKind.METHOD,
            "variable": SymbolKind.VARIABLE,
            "interface": SymbolKind.INTERFACE,
            "property": SymbolKind.PROPERTY,
            "constant": SymbolKind.CONSTANT,
            "module": SymbolKind.MODULE,
            "decorator": SymbolKind.DECORATOR,
        }

        for entry in index_entries:
            fp = entry.get("file", "")
            if fp not in file_analyses:
                file_analyses[fp] = StructuralAnalysis(
                    file_path=fp,
                    language="unknown",
                    symbols=[],
                    provider_used="store",
                )
            kind_str = entry.get("kind", "unknown")
            kind = kind_map.get(kind_str, SymbolKind.UNKNOWN)
            file_analyses[fp].symbols.append(SymbolInfo(
                name=entry.get("name", ""),
                kind=kind,
                scope=entry.get("scope"),
                line_start=int(entry.get("line", 0)),
                signature=entry.get("signature"),
            ))

        engine = MetamodelEngine()
        enriched = engine.populate(metamodel, file_analyses, project_root=str(snapshot_path))

        return {"repo": repo, "snapshot": snapshot_path.name, "metamodel": enriched}

    except VersionNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Metamodel populate failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{repo}/diagrams/generate")
async def diagrams_generate(
    repo: str,
    request: DiagramsGenerateRequest,
    authenticated: bool = Depends(verify_api_key),
):
    """Generate diagrams from structural data."""
    try:
        store = _get_store()
        snapshot_path = _resolve_snapshot(store, repo, request.snapshot)

        formats = request.formats or ["mermaid"]
        generator = DiagramGenerator()
        generator.generate_all(
            snapshot_path=snapshot_path,
            formats=formats,
            versions=request.versions,
        )

        # Read generated diagram files
        diagrams_dir = snapshot_path / "diagrams"
        results = {}
        if diagrams_dir.exists():
            for f in sorted(diagrams_dir.iterdir()):
                if f.is_file():
                    content = f.read_text(encoding="utf-8")
                    # For JSON files (metamodel), parse back
                    if f.suffix == ".json":
                        try:
                            content = json.loads(content)
                        except json.JSONDecodeError:
                            pass
                    results[f.name] = content

        files_written = list(results.keys())

        return {
            "repo": repo,
            "snapshot": snapshot_path.name,
            "formats": formats,
            "diagrams": results,
            "files_written": files_written,
        }

    except VersionNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Diagram generation failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
