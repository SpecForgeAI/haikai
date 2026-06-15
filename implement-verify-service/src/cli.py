"""Command-line interface for standards extraction."""
import click
import json
import time
import yaml
from pathlib import Path
from dotenv import load_dotenv
import os

from .models import (
    GetMetamodelRequest,
    GenerateProductStandardsRequest,
    GenerateGlobalStandardsRequest
)
from .operation_executor import OperationExecutor


# Directories to exclude from file discovery
EXCLUDED_DIRS = {
    'node_modules', '.git', '__pycache__', 'venv', '.venv',
    'dist', 'build', '.tox', '.mypy_cache', '.pytest_cache',
    'target', 'bin', 'obj',
}


def discover_files(project_dir: Path, pattern: str = None) -> list[str]:
    """Find all source files in project directory.

    Supported extensions are determined dynamically by querying ctags
    (``ctags --list-maps``).  No hardcoded language list — new language
    support comes for free when ctags supports it.

    Args:
        project_dir: Root directory to scan.
        pattern: Optional glob pattern override (e.g. "**/*.py").

    Returns:
        List of absolute file path strings.
    """
    if pattern:
        return [str(f) for f in project_dir.rglob(pattern) if f.is_file() and not _is_excluded(f)]

    from .ast.ctags_provider import CtagsProvider
    supported = CtagsProvider.get_supported_extensions()

    files = []
    for f in project_dir.rglob("*"):
        if f.is_file() and f.suffix in supported and not _is_excluded(f):
            files.append(str(f))
    return sorted(files)


def _is_excluded(path: Path) -> bool:
    """Check if path is in an excluded directory."""
    return any(part in EXCLUDED_DIRS for part in path.parts)


@click.group()
@click.version_option(version='2.0.0')
def cli():
    """Standards Extractor - Extract coding standards from your codebase."""
    pass


@cli.command("get-metamodel")
@click.option('--metamodel-id', required=True, help='External metamodel identifier')
@click.option('--project-dir', required=True, type=click.Path(path_type=Path), 
              help='Project workspace directory (absolute path)')
@click.option('--env-file', default='.env', type=click.Path(), help='Environment file path')
def get_metamodel_cmd(metamodel_id: str, project_dir: Path, env_file: str):
    """
    Get architectural metamodel from external system.
    
    Example:
        standards-extractor get-metamodel --metamodel-id proj_123 --project-dir /workspace/my-project
    """
    load_dotenv(env_file)
    
    try:
        request = GetMetamodelRequest(
            metamodel_id=metamodel_id,
            project_dir=project_dir
        )
        
        executor = OperationExecutor(_load_env_config())
        response = executor.execute(request)
        
        if response.success:
            click.secho(f"✓ {response.message}", fg='green')
            click.echo(f"Output: {response.outputs[0]}")
        else:
            click.secho(f"✗ Operation failed", fg='red')
            for error in response.errors or []:
                click.echo(f"  - {error}")
            raise click.Abort()
                
    except ValueError as e:
        click.secho(f"✗ Validation error: {e}", fg='red')
        raise click.Abort()
    except Exception as e:
        click.secho(f"✗ Error: {e}", fg='red')
        raise click.Abort()


@cli.command("generate-product-standards")
@click.option('--project-dir', required=True, type=click.Path(path_type=Path),
              help='Project workspace directory (absolute path)')
@click.option('--global-dir', required=True, type=click.Path(path_type=Path),
              help='Global standards directory (absolute path)')
@click.option('--sources', '-s', multiple=True, help='Optional source paths/URLs')
@click.option('--recursive/--no-recursive', default=True, help='Recursively scan directories')
@click.option('--env-file', default='.env', type=click.Path(), help='Environment file path')
def create_product_standards_cmd(project_dir: Path, global_dir: Path, sources: tuple, 
                                  recursive: bool, env_file: str):
    """
    Create product-level technical standards.
    
    Example:
        standards-extractor generate-product-standards \\
            --project-dir /workspace/my-project \\
            --global-dir /workspace/global-standards
    """
    load_dotenv(env_file)
    
    try:
        request = GenerateProductStandardsRequest(
            project_dir=project_dir,
            global_dir=global_dir,
            sources=list(sources) if sources else None,
            recursive=recursive
        )
        
        executor = OperationExecutor(_load_env_config())
        response = executor.execute(request)
        
        if response.success:
            click.secho(f"✓ {response.message}", fg='green')
            for output in response.outputs:
                click.echo(f"  - {output}")
        else:
            click.secho(f"✗ Operation failed", fg='red')
            for error in response.errors or []:
                click.echo(f"  - {error}")
            raise click.Abort()
            
    except ValueError as e:
        click.secho(f"✗ Validation error: {e}", fg='red')
        raise click.Abort()
    except Exception as e:
        click.secho(f"✗ Error: {e}", fg='red')
        raise click.Abort()


@cli.command("generate-global-standards")
@click.option('--global-dir', required=True, type=click.Path(path_type=Path),
              help='Global standards directory (absolute path)')
@click.option('--sources', '-s', multiple=True, 
              help='Source paths/URLs to analyze (optional if technical documents provided)')
@click.option('--recursive/--no-recursive', default=True, help='Recursively scan directories')
@click.option('--tech-stack', multiple=True, help='Technical documents for tech stack')
@click.option('--coding-style', multiple=True, help='Technical documents for coding style')
@click.option('--conventions', multiple=True, help='Technical documents for conventions')
@click.option('--error-handling', multiple=True, help='Technical documents for error handling')
@click.option('--validation', multiple=True, help='Technical documents for validation')
@click.option('--env-file', default='.env', type=click.Path(), help='Environment file path')
def create_global_standards_cmd(global_dir: Path, sources: tuple, recursive: bool,
                                tech_stack: tuple, coding_style: tuple, conventions: tuple,
                                error_handling: tuple, validation: tuple, env_file: str):
    """
    Create global baseline standards from source code.
    
    Example:
        standards-extractor generate-global-standards \\
            --global-dir /workspace/global-standards \\
            --sources ./my-codebase \\
            --sources https://github.com/org/repo
    """
    load_dotenv(env_file)
    
    try:
        # Build technical documents dict
        technical_documents = {}
        if tech_stack:
            technical_documents['tech_stack'] = list(tech_stack)
        if coding_style:
            technical_documents['coding_style'] = list(coding_style)
        if conventions:
            technical_documents['conventions'] = list(conventions)
        if error_handling:
            technical_documents['error_handling'] = list(error_handling)
        if validation:
            technical_documents['validation'] = list(validation)
        
        request = GenerateGlobalStandardsRequest(
            global_dir=global_dir,
            sources=list(sources) if sources else None,
            recursive=recursive,
            technical_documents=technical_documents if technical_documents else None
        )
        
        executor = OperationExecutor(_load_env_config())
        response = executor.execute(request)
        
        if response.success:
            click.secho(f"✓ {response.message}", fg='green')
            click.echo(f"Generated {len(response.outputs)} standard files")
        else:
            click.secho(f"✗ Operation failed", fg='red')
            for error in response.errors or []:
                click.echo(f"  - {error}")
            raise click.Abort()
            
    except ValueError as e:
        click.secho(f"✗ Validation error: {e}", fg='red')
        raise click.Abort()
    except Exception as e:
        click.secho(f"✗ Error: {e}", fg='red')
        raise click.Abort()


# =============================================================================
# Structural Analysis Commands
# =============================================================================

@cli.command("analyze")
@click.option('--project-dir', required=True, type=click.Path(exists=True, path_type=Path),
              help='Path to the codebase to analyze')
@click.option('--store-dir', type=click.Path(path_type=Path), default=None,
              help='Override output directory (default: <project-dir>/.specforge/structural)')
@click.option('--repo-name', default=None, help='Override repo name (default: auto-detect from git)')
@click.option('--no-treesitter', is_flag=True, help='Skip tree-sitter enrichment (ctags only)')
@click.option('--file-pattern', default=None, help='Glob pattern to filter files (e.g. "**/*.py")')
@click.option('--env-file', default='.env', type=click.Path(), help='Environment file path')
def analyze_cmd(project_dir: Path, store_dir: Path, repo_name: str,
                no_treesitter: bool, file_pattern: str, env_file: str):
    """Run structural analysis pipeline on a codebase.

    Runs ctags + tree-sitter to produce a structural store with symbols,
    call graph, imports, and inheritance data.

    Example:
        standards-extractor analyze --project-dir /path/to/repo
    """
    load_dotenv(env_file)

    # Capture before the try block so the `finally` restore is always safe,
    # even if an early step raises before we'd otherwise mutate the env.
    _prior_treesitter = os.environ.get("AST_TREESITTER_ENABLED")

    try:
        # Step 1: Discover files
        click.echo(f"Analyzing {project_dir}...", err=True)
        files = discover_files(project_dir, file_pattern)
        if not files:
            click.secho("No supported source files found.", fg='red')
            raise SystemExit(1)
        click.echo(f"  Files discovered: {len(files)}", err=True)

        # Step 2: Run ctags
        click.echo("  Running ctags...", err=True)
        from .ast.ctags_provider import CtagsProvider
        from .ast.provider import ProviderRegistry
        from .ast.store import FileStore, get_git_info
        from .ast.pipeline import run_structural_pipeline

        ctags = CtagsProvider()
        if not ctags.is_available():
            click.secho(
                "ctags binary not found. Install via:\n"
                "  Ubuntu/Debian: sudo apt install universal-ctags\n"
                "  macOS: brew install universal-ctags\n"
                "  Windows: choco install universal-ctags",
                fg='red',
            )
            raise SystemExit(1)

        registry = ProviderRegistry()
        registry.register(ctags)
        ctags_results = registry.analyze_batch(files)

        if not ctags_results:
            click.secho("ctags produced no results.", fg='red')
            raise SystemExit(1)

        # Step 3: Store + tree-sitter enrichment.
        # The env var is restored in the `finally` below so this invocation
        # doesn't leak AST_TREESITTER_ENABLED=false to subsequent ones in the
        # same process (matters for tests/wrappers, not the CLI itself).
        if no_treesitter:
            os.environ["AST_TREESITTER_ENABLED"] = "false"

        store_path = str(store_dir) if store_dir else str(project_dir / ".specforge" / "structural")
        store = FileStore(base_path=store_path)

        git_info = get_git_info(str(project_dir))
        effective_repo = repo_name or git_info["repo_name"]

        click.echo("  Running tree-sitter enrichment...", err=True) if not no_treesitter else None

        results = run_structural_pipeline(
            file_paths=files,
            ctags_results=ctags_results,
            store=store,
            registry=registry,
            repo_name=effective_repo,
            commit_sha=git_info["commit_sha"] or "nocommit",
            branch=git_info["branch"] or "unknown",
            project_root=str(project_dir),
        )

        # Step 4: Print summary
        snapshot_path = store.get_latest_path(effective_repo) or "unknown"
        click.echo(f"  Snapshot written: {snapshot_path}", err=True)

        total_symbols = sum(len(a.symbols) for a in results.values())
        total_imports = sum(len(a.imports) for a in results.values())
        total_calls = sum(len(a.calls) for a in results.values())
        total_inheritance = sum(len(a.inheritance) for a in results.values())

        click.echo("")
        click.secho("Summary:", bold=True)
        click.echo(f"  Symbols:     {total_symbols:,}")
        click.echo(f"  Imports:     {total_imports:,}")
        click.echo(f"  Calls:       {total_calls:,}")
        click.echo(f"  Inheritance: {total_inheritance:,}")
        click.echo(f"\n{snapshot_path}")

    except SystemExit:
        raise
    except Exception as e:
        click.secho(f"Error: {e}", fg='red')
        raise SystemExit(1)
    finally:
        # Restore the env var to whatever it was before this invocation
        if no_treesitter:
            if _prior_treesitter is None:
                os.environ.pop("AST_TREESITTER_ENABLED", None)
            else:
                os.environ["AST_TREESITTER_ENABLED"] = _prior_treesitter


@cli.command("extract-endpoints")
@click.option('--store-path', required=True, type=click.Path(exists=True, path_type=Path),
              help='Path to structural store snapshot directory')
@click.option('--format', 'output_format', type=click.Choice(['tsv', 'json']), default='tsv',
              help='Output format (default: tsv)')
@click.option('--endpoints-only', is_flag=True, help='Skip interaction extraction')
@click.option('--interactions-only', is_flag=True, help='Skip endpoint extraction')
@click.option('--env-file', default='.env', type=click.Path(), help='Environment file path')
def extract_endpoints_cmd(store_path: Path, output_format: str,
                          endpoints_only: bool, interactions_only: bool, env_file: str):
    """Extract endpoints and interactions from a structural store snapshot.

    Reads _index.txt, _calls.txt, _imports.txt, _inheritance.txt from the
    snapshot and detects REST, WebSocket, MQ, gRPC, and scheduled endpoints
    plus data movements (HTTP, DB, MQ, cache, file I/O).

    Example:
        standards-extractor extract-endpoints --store-path .specforge/structural/my-repo/abc1234
    """
    load_dotenv(env_file)

    if endpoints_only and interactions_only:
        click.secho(
            "--endpoints-only and --interactions-only are mutually exclusive "
            "(passing both would skip everything).",
            fg='red',
        )
        raise SystemExit(1)

    try:
        # Validate store path
        index_file = store_path / "_index.txt"
        calls_file = store_path / "_calls.txt"

        if not index_file.exists() or not calls_file.exists():
            click.secho(
                f"Invalid store path: {store_path}\n"
                f"Expected _index.txt and _calls.txt in the directory.\n"
                f"Run 'standards-extractor analyze' first to create a structural store.",
                fg='red',
            )
            raise SystemExit(1)

        click.echo(f"Extracting from {store_path}...", err=True)

        # Read store files
        index_content = index_file.read_text(encoding="utf-8")
        calls_content = calls_file.read_text(encoding="utf-8")

        imports_file = store_path / "_imports.txt"
        imports_content = imports_file.read_text(encoding="utf-8") if imports_file.exists() else ""

        inheritance_file = store_path / "_inheritance.txt"
        inheritance_content = inheritance_file.read_text(encoding="utf-8") if inheritance_file.exists() else ""

        # Detect frameworks from imports
        frameworks_detected = _detect_frameworks(imports_content)
        if frameworks_detected:
            fw_str = ", ".join(f"{fw} ({conf:.2f})" for fw, conf in frameworks_detected[:5])
            click.echo(f"  Frameworks detected: {fw_str}", err=True)

        # Extract endpoints
        endpoints = []
        if not interactions_only:
            endpoints = _extract_endpoints_from_store(index_content, calls_content, imports_content)

        # Extract interactions
        interactions = []
        if not endpoints_only:
            interactions = _extract_interactions_from_store(calls_content, imports_content, inheritance_content)

        # Write output files
        if endpoints:
            _write_endpoints_file(store_path, endpoints, output_format)
        if interactions:
            _write_interactions_file(store_path, interactions, output_format)

        # Write extraction metadata
        meta = {
            "extraction": {
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "store_path": str(store_path),
                "frameworks_detected": [
                    {"name": fw, "confidence": round(conf, 2)}
                    for fw, conf in (frameworks_detected or [])
                ],
                "stats": {
                    "endpoints_found": len(endpoints),
                    "interactions_found": len(interactions),
                },
                # extract-endpoints is always pattern-only — for LLM-driven
                # discovery use the discover-endpoints / discover-interactions
                # commands.
                "classification": "yaml_only",
            }
        }
        with open(store_path / "_extraction_meta.yaml", "w", encoding="utf-8") as f:
            yaml.dump(meta, f, default_flow_style=False, sort_keys=False, allow_unicode=True)

        # Print summary
        click.echo("")
        if endpoints:
            ep_types = {}
            for ep in endpoints:
                ep_types[ep["type"]] = ep_types.get(ep["type"], 0) + 1
            type_str = ", ".join(f"{c} {t}" for t, c in sorted(ep_types.items(), key=lambda x: -x[1]))
            click.echo(f"  Endpoints:     {len(endpoints)} ({type_str})")

        if interactions:
            int_types = {}
            for ia in interactions:
                int_types[ia["target_type"]] = int_types.get(ia["target_type"], 0) + 1
            type_str = ", ".join(f"{c} {t}" for t, c in sorted(int_types.items(), key=lambda x: -x[1]))
            click.echo(f"  Interactions:  {len(interactions)} ({type_str})")

        written = []
        if endpoints:
            written.append(f"_endpoints.{'json' if output_format == 'json' else 'txt'}")
        if interactions:
            written.append(f"_interactions.{'json' if output_format == 'json' else 'txt'}")
        written.append("_extraction_meta.yaml")
        click.echo(f"\n  Written: {', '.join(written)}")

    except SystemExit:
        raise
    except Exception as e:
        click.secho(f"Error: {e}", fg='red')
        raise SystemExit(1)


@cli.command("list-stores")
@click.option('--project-dir', required=True, type=click.Path(exists=True, path_type=Path),
              help='Path to the project')
@click.option('--repo-name', default=None, help='Override repo name (default: auto-detect from git)')
@click.option('--store-dir', type=click.Path(path_type=Path), default=None,
              help='Override store directory (default: <project-dir>/.specforge/structural)')
def list_stores_cmd(project_dir: Path, repo_name: str, store_dir: Path):
    """List available structural store snapshots for a project.

    Example:
        standards-extractor list-stores --project-dir /path/to/repo
    """
    try:
        from .ast.store import FileStore, get_git_info

        store_path = str(store_dir) if store_dir else str(project_dir / ".specforge" / "structural")
        store = FileStore(base_path=store_path)

        effective_repo = repo_name
        if not effective_repo:
            git_info = get_git_info(str(project_dir))
            effective_repo = git_info["repo_name"]

        snapshots = store.list_snapshots(effective_repo)
        if not snapshots:
            click.echo(f"No snapshots found for '{effective_repo}' in {store_path}")
            return

        latest_path = store.get_latest_path(effective_repo)
        latest_name = Path(latest_path).name if latest_path else None

        click.secho(f"Snapshots for {effective_repo}:", bold=True)
        for snap in reversed(snapshots):
            commit = snap.get("commit", "?")[:7]
            analyzed_at = snap.get("analyzed_at", "?")
            branch = snap.get("branch", "?")
            file_count = snap.get("file_count", "?")

            # Check if this is the latest
            is_latest = (commit.startswith(latest_name[:7]) if latest_name else False)
            marker = "* " if is_latest else "  "
            suffix = "  (latest)" if is_latest else ""

            click.echo(f"  {marker}{commit}  {analyzed_at}  {branch}  {file_count} files{suffix}")

    except Exception as e:
        click.secho(f"Error: {e}", fg='red')
        raise SystemExit(1)


@cli.command("discover-endpoints")
@click.option('--project-dir', required=True, type=click.Path(exists=True, path_type=Path),
              help='Path to the codebase root')
@click.option('--snapshot-path', type=click.Path(path_type=Path), default=None,
              help='Structural store snapshot dir (default: latest under <project-dir>/.specforge/structural)')
@click.option('--repo-name', default=None, help='Override repo name (default: auto-detect from git)')
@click.option('--store-dir', type=click.Path(path_type=Path), default=None,
              help='Override store directory (default: <project-dir>/.specforge/structural)')
@click.option('--provider', default=None,
              help='LLM provider (env LLM_PROVIDER if unset; required, no default)')
@click.option('--model', default=None, help='LLM model (env LLM_MODEL if unset; required, no default)')
@click.option('--log-dir', type=click.Path(path_type=Path), default=None,
              help='Where Claude CLI ("custom" provider) writes its endpoints JSON')
@click.option('--format', 'output_format', type=click.Choice(['json', 'tsv']), default='json',
              help='Output format (default: json)')
@click.option('--env-file', default='.env', type=click.Path(), help='Environment file path')
def discover_endpoints_cmd(project_dir: Path, snapshot_path: Path, repo_name: str,
                           store_dir: Path, provider: str, model: str, log_dir: Path,
                           output_format: str, env_file: str):
    """V1 LLM-driven endpoint discovery against a structural store snapshot.

    Requires an existing snapshot. Run `analyze` first to create one.

    Example:
        standards-extractor discover-endpoints --project-dir /path/to/repo
    """
    load_dotenv(env_file)

    try:
        # Resolve snapshot path: explicit > latest under store-dir
        if snapshot_path is None:
            from .ast.store import FileStore, get_git_info
            base = str(store_dir) if store_dir else str(project_dir / ".specforge" / "structural")
            store = FileStore(base_path=base)
            effective_repo = repo_name or get_git_info(str(project_dir))["repo_name"]
            latest = store.get_latest_path(effective_repo)
            if not latest:
                click.secho(
                    f"No snapshot found for '{effective_repo}' under {base}.\n"
                    f"Run 'standards-extractor analyze --project-dir {project_dir}' first.",
                    fg='red',
                )
                raise SystemExit(1)
            snapshot_path = Path(latest)

        if not (snapshot_path / "_index.txt").exists():
            click.secho(
                f"Invalid snapshot path: {snapshot_path}\n"
                f"Expected _index.txt in the directory.",
                fg='red',
            )
            raise SystemExit(1)

        # Build LLM client from env + flags. Use the factory directly (not the
        # web wrapper) so we don't drag in src.api's import-time side effects.
        from .llm_client_factory import build_llm_client
        from .ast.endpoint_discoverer import discover_endpoints
        from dataclasses import asdict

        try:
            llm_client = build_llm_client(
                provider=provider,
                model=model,
                log_dir=str(log_dir) if log_dir else None,
            )
        except ValueError as e:
            click.secho(f"Failed to construct LLM client: {e}", fg='red')
            raise SystemExit(1)

        click.echo(f"Discovering endpoints in {project_dir}", err=True)
        click.echo(f"  snapshot: {snapshot_path}", err=True)
        click.echo(f"  llm:      {llm_client.provider}/{llm_client.model}", err=True)

        endpoints = discover_endpoints(
            llm_client=llm_client,
            project_root=str(project_dir),
            snapshot_path=str(snapshot_path),
        )

        if output_format == 'json':
            click.echo(json.dumps([asdict(ep) for ep in endpoints], indent=2))
        else:
            click.echo("type\tpath\toperation\thandler\tfile\tline\tframework", err=False)
            for ep in endpoints:
                handler = f"{ep.handler_class}.{ep.handler_method}".lstrip(".")
                click.echo(
                    f"{ep.type}\t{ep.path}\t{ep.operation}\t{handler}\t"
                    f"{ep.file}\t{ep.line}\t{ep.framework}"
                )

        click.echo(f"\nFound {len(endpoints)} endpoint(s).", err=True)

    except SystemExit:
        raise
    except Exception as e:
        click.secho(f"Error: {e}", fg='red')
        raise SystemExit(1)


@cli.command("discover-diagrams")
@click.option('--project-dir', required=True, type=click.Path(exists=True, path_type=Path),
              help='Path to the codebase root')
@click.option('--snapshot-path', type=click.Path(path_type=Path), default=None,
              help='Structural store snapshot dir (default: latest under <project-dir>/.specforge/structural)')
@click.option('--repo-name', default=None, help='Override repo name (default: auto-detect from git)')
@click.option('--store-dir', type=click.Path(path_type=Path), default=None,
              help='Override store directory (default: <project-dir>/.specforge/structural)')
@click.option('--provider', default=None,
              help='LLM provider (env LLM_PROVIDER if unset; required, no default)')
@click.option('--model', default=None,
              help='LLM model (env LLM_MODEL if unset; required, no default)')
@click.option('--log-dir', type=click.Path(path_type=Path), default=None,
              help='Where Claude CLI ("custom" provider) writes its output')
@click.option('--format', 'output_format', type=click.Choice(['json', 'tsv']), default='json',
              help='Output format (default: json)')
@click.option('--env-file', default='.env', type=click.Path(), help='Environment file path')
def discover_diagrams_cmd(project_dir: Path, snapshot_path: Path, repo_name: str,
                          store_dir: Path, provider: str, model: str, log_dir: Path,
                          output_format: str, env_file: str):
    """V1 LLM-driven diagram discovery on a structural store snapshot.

    Requires endpoint and/or interaction data in the snapshot (otherwise
    no diagrams are generated). Run `extract-endpoints` and
    `discover-endpoints` first.

    Example:
        standards-extractor discover-diagrams --project-dir /path/to/repo
    """
    load_dotenv(env_file)

    try:
        if snapshot_path is None:
            from .ast.store import FileStore, get_git_info
            base = str(store_dir) if store_dir else str(project_dir / ".specforge" / "structural")
            store = FileStore(base_path=base)
            effective_repo = repo_name or get_git_info(str(project_dir))["repo_name"]
            latest = store.get_latest_path(effective_repo)
            if not latest:
                click.secho(
                    f"No snapshot found for '{effective_repo}' under {base}.\n"
                    f"Run 'standards-extractor analyze --project-dir {project_dir}' first.",
                    fg='red',
                )
                raise SystemExit(1)
            snapshot_path = Path(latest)

        if not (snapshot_path / "_index.txt").exists():
            click.secho(f"Invalid snapshot path: {snapshot_path} (missing _index.txt)", fg='red')
            raise SystemExit(1)

        from .llm_client_factory import build_llm_client
        from .ast.diagram_discoverer import discover_diagrams
        from dataclasses import asdict

        try:
            llm_client = build_llm_client(
                provider=provider, model=model,
                log_dir=str(log_dir) if log_dir else None,
            )
        except ValueError as e:
            click.secho(f"Failed to construct LLM client: {e}", fg='red')
            raise SystemExit(1)

        click.echo(f"Discovering diagrams in {project_dir}", err=True)
        click.echo(f"  snapshot: {snapshot_path}", err=True)
        click.echo(f"  llm:      {llm_client.provider}/{llm_client.model}", err=True)

        diagrams = discover_diagrams(
            llm_client=llm_client,
            project_root=str(project_dir),
            snapshot_path=str(snapshot_path),
        )

        if output_format == 'json':
            click.echo(json.dumps([asdict(d) for d in diagrams], indent=2))
        else:
            click.echo("diagram_type\ttitle\tentities\trelationships", err=False)
            for d in diagrams:
                click.echo(f"{d.diagram_type}\t{d.title}\t{len(d.entities)}\t{len(d.relationships)}")

        click.echo(f"\nFound {len(diagrams)} diagram(s).", err=True)

    except SystemExit:
        raise
    except Exception as e:
        click.secho(f"Error: {e}", fg='red')
        raise SystemExit(1)


@cli.command("show-trace")
@click.option('--discovery', type=click.Choice(['endpoint', 'interaction', 'diagram']),
              default='endpoint', help='Which discovery trace to show (default: endpoint)')
@click.option('--model', required=True, help='Model identifier used during the run')
@click.option('--turns', type=int, default=0,
              help='Show only the last N turns (0 = all)')
def show_trace_cmd(discovery: str, model: str, turns: int):
    """Print the conversation trace from the most recent V1 discovery run.

    Trace files are written to the system temp dir as
    `<discovery>_trace_<model>.json` after each V1 run.

    Example:
        standards-extractor show-trace --model claude-sonnet-4-6
    """
    import re, tempfile
    if not re.match(r"^(?!.*\.\.)[A-Za-z0-9._-]+$", model):
        click.secho("Invalid model identifier (only [A-Za-z0-9._-], no '..').", fg='red')
        raise SystemExit(1)
    trace_path = Path(tempfile.gettempdir()) / f"{discovery}_trace_{model}.json"
    if not trace_path.exists():
        click.secho(f"Trace not found: {trace_path}", fg='red')
        raise SystemExit(1)

    try:
        trace = json.loads(trace_path.read_text(encoding="utf-8"))
    except Exception as e:
        click.secho(f"Failed to read trace: {e}", fg='red')
        raise SystemExit(1)

    items = trace if isinstance(trace, list) else []
    click.echo(f"# {trace_path}", err=True)
    click.echo(f"# {len(items)} turn(s)", err=True)
    if turns > 0:
        items = items[-turns:]
    # ensure_ascii=True: trace files may contain non-ASCII characters that the
    # Windows console (cp1252) can't render. Escape sequences are fine for a
    # debug surface — readers can decode if they care about the actual chars.
    click.echo(json.dumps(items, indent=2, ensure_ascii=True))


# =============================================================================
# Endpoint/Interaction Extraction Helpers
# =============================================================================

# Framework detection patterns keyed by import substring
_FRAMEWORK_IMPORTS = {
    "spring-web": ["org.springframework.web", "org.springframework.boot"],
    "spring-kafka": ["org.springframework.kafka"],
    "spring-data": ["org.springframework.data"],
    "fastapi": ["fastapi"],
    "flask": ["flask"],
    "django": ["django"],
    "express": ["express"],
    "gin": ["github.com/gin-gonic/gin"],
    "aspnet": ["Microsoft.AspNetCore"],
    "grpc-java": ["io.grpc"],
    "grpc-go": ["google.golang.org/grpc"],
    "kafka-node": ["kafkajs", "kafka-node"],
    "rabbitmq": ["amqplib", "org.springframework.amqp"],
    "prisma": ["@prisma/client"],
    "sqlalchemy": ["sqlalchemy"],
    "redis": ["redis", "ioredis"],
}

# Endpoint detection patterns: (call_pattern, endpoint_type, operation, direction, protocol)
_ENDPOINT_CALL_PATTERNS = [
    # FastAPI / Flask
    ("app.get", "REST", "GET", "INBOUND", "HTTP"),
    ("app.post", "REST", "POST", "INBOUND", "HTTP"),
    ("app.put", "REST", "PUT", "INBOUND", "HTTP"),
    ("app.delete", "REST", "DELETE", "INBOUND", "HTTP"),
    ("app.patch", "REST", "PATCH", "INBOUND", "HTTP"),
    ("router.get", "REST", "GET", "INBOUND", "HTTP"),
    ("router.post", "REST", "POST", "INBOUND", "HTTP"),
    ("router.put", "REST", "PUT", "INBOUND", "HTTP"),
    ("router.delete", "REST", "DELETE", "INBOUND", "HTTP"),
    # Express
    ("app.use", "REST", "MIDDLEWARE", "INBOUND", "HTTP"),
    # Go
    ("http.HandleFunc", "REST", "DYNAMIC", "INBOUND", "HTTP"),
    ("mux.Handle", "REST", "DYNAMIC", "INBOUND", "HTTP"),
    ("gin.GET", "REST", "GET", "INBOUND", "HTTP"),
    ("gin.POST", "REST", "POST", "INBOUND", "HTTP"),
    # WebSocket
    ("io.on", "WEBSOCKET", "SUBSCRIBE", "INBOUND", "WS"),
    ("WebSocketServer", "WEBSOCKET", "SUBSCRIBE", "INBOUND", "WS"),
    # MQ
    ("KafkaTemplate.send", "MQ_PRODUCER", "PUBLISH", "OUTBOUND", "KAFKA"),
    ("rabbitTemplate.convertAndSend", "MQ_PRODUCER", "PUBLISH", "OUTBOUND", "AMQP"),
]

# Annotation patterns for index-based detection
_ENDPOINT_INDEX_PATTERNS = [
    ("@GetMapping", "REST", "GET", "INBOUND", "HTTP"),
    ("@PostMapping", "REST", "POST", "INBOUND", "HTTP"),
    ("@PutMapping", "REST", "PUT", "INBOUND", "HTTP"),
    ("@DeleteMapping", "REST", "DELETE", "INBOUND", "HTTP"),
    ("@PatchMapping", "REST", "PATCH", "INBOUND", "HTTP"),
    ("@RequestMapping", "REST", "DYNAMIC", "INBOUND", "HTTP"),
    ("@KafkaListener", "MQ_CONSUMER", "SUBSCRIBE", "INBOUND", "KAFKA"),
    ("@RabbitListener", "MQ_CONSUMER", "SUBSCRIBE", "INBOUND", "AMQP"),
    ("@Scheduled", "SCHEDULED", "CRON", "INTERNAL", "CRON"),
    ("@ServerEndpoint", "WEBSOCKET", "SUBSCRIBE", "INBOUND", "WS"),
    ("[HttpGet]", "REST", "GET", "INBOUND", "HTTP"),
    ("[HttpPost]", "REST", "POST", "INBOUND", "HTTP"),
    ("[HttpPut]", "REST", "PUT", "INBOUND", "HTTP"),
    ("[HttpDelete]", "REST", "DELETE", "INBOUND", "HTTP"),
    ("[Route]", "REST", "DYNAMIC", "INBOUND", "HTTP"),
]

# Interaction detection patterns: (call_pattern, target_type, direction, mechanism)
_INTERACTION_CALL_PATTERNS = [
    # Outbound HTTP
    ("RestTemplate", "HTTP_SERVICE", "REQUEST_RESPONSE", "RestTemplate"),
    ("WebClient", "HTTP_SERVICE", "REQUEST_RESPONSE", "WebClient"),
    ("requests.get", "HTTP_SERVICE", "READ", "requests"),
    ("requests.post", "HTTP_SERVICE", "WRITE", "requests"),
    ("httpx.", "HTTP_SERVICE", "REQUEST_RESPONSE", "httpx"),
    ("aiohttp", "HTTP_SERVICE", "REQUEST_RESPONSE", "aiohttp"),
    ("fetch(", "HTTP_SERVICE", "REQUEST_RESPONSE", "fetch"),
    ("axios.", "HTTP_SERVICE", "REQUEST_RESPONSE", "axios"),
    ("http.Get", "HTTP_SERVICE", "READ", "net/http"),
    ("http.Post", "HTTP_SERVICE", "WRITE", "net/http"),
    ("HttpClient", "HTTP_SERVICE", "REQUEST_RESPONSE", "HttpClient"),
    # Database
    ("Repository.find", "DATABASE", "READ", "JPA"),
    ("Repository.save", "DATABASE", "WRITE", "JPA"),
    ("Repository.delete", "DATABASE", "WRITE", "JPA"),
    ("session.query", "DATABASE", "READ", "SQLAlchemy"),
    ("session.add", "DATABASE", "WRITE", "SQLAlchemy"),
    ("session.execute", "DATABASE", "READ", "SQLAlchemy"),
    ("prisma.", "DATABASE", "REQUEST_RESPONSE", "Prisma"),
    ("jdbcTemplate", "DATABASE", "REQUEST_RESPONSE", "JDBC"),
    # MQ
    ("KafkaTemplate.send", "MESSAGE_QUEUE", "PUBLISH", "Kafka"),
    ("rabbitTemplate", "MESSAGE_QUEUE", "PUBLISH", "RabbitMQ"),
    # Cache
    ("RedisTemplate", "CACHE", "REQUEST_RESPONSE", "Redis"),
    ("redis.get", "CACHE", "READ", "Redis"),
    ("redis.set", "CACHE", "WRITE", "Redis"),
    # File I/O
    ("s3Client", "FILE_SYSTEM", "REQUEST_RESPONSE", "S3"),
    ("s3.putObject", "FILE_SYSTEM", "WRITE", "S3"),
    ("s3.getObject", "FILE_SYSTEM", "READ", "S3"),
    ("FileOutputStream", "FILE_SYSTEM", "WRITE", "java.io"),
    ("fs.writeFile", "FILE_SYSTEM", "WRITE", "fs"),
    ("fs.readFile", "FILE_SYSTEM", "READ", "fs"),
]


def _detect_frameworks(imports_content: str) -> list[tuple[str, float]]:
    """Detect frameworks from _imports.txt content. Returns [(name, confidence)]."""
    if not imports_content:
        return []

    results = []
    lines = imports_content.split("\n")
    for fw_name, patterns in _FRAMEWORK_IMPORTS.items():
        count = sum(1 for line in lines if any(p in line for p in patterns))
        if count > 0:
            confidence = min(0.95, 0.5 + count * 0.05)
            results.append((fw_name, confidence))

    return sorted(results, key=lambda x: -x[1])


def _extract_endpoints_from_store(index_content: str, calls_content: str,
                                   imports_content: str) -> list[dict]:
    """Extract endpoints from store file contents."""
    endpoints = []

    # Call-pattern-based detection from _calls.txt
    for line in calls_content.split("\n"):
        if line.startswith("#") or not line.strip():
            continue
        for pattern, ep_type, operation, direction, protocol in _ENDPOINT_CALL_PATTERNS:
            if pattern.lower() in line.lower():
                parts = line.split("\t")
                endpoints.append({
                    "type": ep_type,
                    "path_or_address": "-",
                    "operation": operation,
                    "handler_class": parts[0] if len(parts) > 0 else "-",
                    "handler_method": parts[1] if len(parts) > 1 else "-",
                    "file": parts[2] if len(parts) > 2 else "-",
                    "line": parts[3] if len(parts) > 3 else "0",
                    "direction": direction,
                    "protocol": protocol,
                    "framework": "-",
                    "confidence": "0.75",
                })
                break

    # Annotation-based detection from _index.txt
    for line in index_content.split("\n"):
        if line.startswith("#") or not line.strip():
            continue
        for pattern, ep_type, operation, direction, protocol in _ENDPOINT_INDEX_PATTERNS:
            if pattern in line:
                parts = line.split("\t")
                endpoints.append({
                    "type": ep_type,
                    "path_or_address": "-",
                    "operation": operation,
                    "handler_class": parts[3] if len(parts) > 3 else "-",
                    "handler_method": parts[2] if len(parts) > 2 else "-",
                    "file": parts[0] if len(parts) > 0 else "-",
                    "line": parts[5] if len(parts) > 5 else "0",
                    "direction": direction,
                    "protocol": protocol,
                    "framework": "-",
                    "confidence": "0.85",
                })
                break

    return endpoints


def _extract_interactions_from_store(calls_content: str, imports_content: str,
                                      inheritance_content: str) -> list[dict]:
    """Extract data movement interactions from store file contents."""
    interactions = []

    for line in calls_content.split("\n"):
        if line.startswith("#") or not line.strip():
            continue
        for pattern, target_type, direction, mechanism in _INTERACTION_CALL_PATTERNS:
            if pattern.lower() in line.lower():
                parts = line.split("\t")
                interactions.append({
                    "source_class": parts[0] if len(parts) > 0 else "-",
                    "source_method": parts[1] if len(parts) > 1 else "-",
                    "target": parts[4] if len(parts) > 4 else "-",
                    "target_type": target_type,
                    "direction": direction,
                    "mechanism": mechanism,
                    "data_hint": "-",
                    "file": parts[2] if len(parts) > 2 else "-",
                    "line": parts[3] if len(parts) > 3 else "0",
                    "confidence": "0.75",
                })
                break

    return interactions


def _write_endpoints_file(store_path: Path, endpoints: list[dict], fmt: str):
    """Write endpoints to _endpoints.txt (TSV) or _endpoints.json."""
    if fmt == "json":
        with open(store_path / "_endpoints.json", "w", encoding="utf-8") as f:
            json.dump(endpoints, f, indent=2, ensure_ascii=False)
    else:
        header = "# type\tpath_or_address\toperation\thandler_class\thandler_method\tfile\tline\tdirection\tprotocol\tframework\tconfidence"
        lines = [header]
        for ep in endpoints:
            lines.append("\t".join(str(ep.get(k, "-")) for k in [
                "type", "path_or_address", "operation", "handler_class",
                "handler_method", "file", "line", "direction", "protocol",
                "framework", "confidence",
            ]))
        (store_path / "_endpoints.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_interactions_file(store_path: Path, interactions: list[dict], fmt: str):
    """Write interactions to _interactions.txt (TSV) or _interactions.json."""
    if fmt == "json":
        with open(store_path / "_interactions.json", "w", encoding="utf-8") as f:
            json.dump(interactions, f, indent=2, ensure_ascii=False)
    else:
        header = "# source_class\tsource_method\ttarget\ttarget_type\tdirection\tmechanism\tdata_hint\tfile\tline\tconfidence"
        lines = [header]
        for ia in interactions:
            lines.append("\t".join(str(ia.get(k, "-")) for k in [
                "source_class", "source_method", "target", "target_type",
                "direction", "mechanism", "data_hint", "file", "line", "confidence",
            ]))
        (store_path / "_interactions.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")


# =============================================================================
# Standards Generation Commands
# =============================================================================

def _load_env_config() -> dict:
    """Load environment configuration from .env file."""
    return {
        # Defaults must be an internally consistent pair — see api/__init__.py B3.
        'llm_provider': os.getenv('LLM_PROVIDER', 'anthropic'),
        'llm_model': os.getenv('LLM_MODEL', 'claude-sonnet-4-6'),
        'llm_api_key': _get_llm_api_key(),
        'github_token': os.getenv('GITHUB_TOKEN'),
        'gitlab_token': os.getenv('GITLAB_TOKEN'),
        'bitbucket_username': os.getenv('BITBUCKET_USERNAME'),
        'bitbucket_password': os.getenv('BITBUCKET_APP_PASSWORD'),
        'config_dir': 'config',
        'templates_dir': 'templates/standards',
        'max_file_size_kb': 500,
        'standard_extraction_max_files': _parse_int_or_none(os.getenv('STANDARD_EXTRACTION_MAX_FILES'))
    }


def _get_llm_api_key():
    """Get LLM API key based on provider."""
    provider = os.getenv('LLM_PROVIDER', 'anthropic').lower()
    
    if provider == 'openai':
        return os.getenv('OPENAI_API_KEY')
    elif provider == 'anthropic':
        return os.getenv('ANTHROPIC_API_KEY')
    elif provider == 'azure':
        return os.getenv('AZURE_OPENAI_API_KEY')
    else:
        return os.getenv('CUSTOM_API_KEY')


def _parse_int_or_none(value):
    """Parse integer or return None."""
    if not value or value == '':
        return None
    try:
        return int(value)
    except ValueError:
        return None


@cli.command("run-pipeline")
@click.option('--project-dir', required=True, type=click.Path(exists=True, path_type=Path),
              help='Path to the codebase root')
@click.option('--snapshot-path', type=click.Path(path_type=Path), default=None,
              help='Structural store snapshot dir (default: latest under <project-dir>/.specforge/structural)')
@click.option('--repo-name', default=None, help='Override repo name (default: auto-detect from git)')
@click.option('--out-dir', type=click.Path(path_type=Path), default=None,
              help='Pipeline output dir (default: <snapshot>/pipeline)')
@click.option('--kinds', default='endpoints,data_movements,queries',
              help='Comma-separated record kinds (default: all three)')
@click.option('--max-attempts', default=3, type=int)
@click.option('--parallelism', default=4, type=int)
def run_pipeline_cmd(project_dir: Path, snapshot_path: Path, repo_name: str,
                     out_dir: Path, kinds: str, max_attempts: int, parallelism: int):
    """Preflight the extraction pipeline: bootstrap + batch plan.

    The pipeline itself is agent-driven (the orchestrator is an agent —
    pipeline spec D2): this command resolves the snapshot, runs
    bootstrap_check, plans the batches, writes config.json + batches.json
    under --out-dir, and prints the /run-pipeline handoff. Requires an
    existing snapshot — run `analyze` first.
    """
    import json as _json

    # Resolve snapshot path: explicit > latest under the project store
    if snapshot_path is None:
        from .ast.store import FileStore, get_git_info
        base = str(project_dir / ".specforge" / "structural")
        store = FileStore(base_path=base)
        effective_repo = repo_name or get_git_info(str(project_dir))["repo_name"]
        latest = store.get_latest_path(effective_repo)
        if not latest:
            click.secho(
                f"No snapshot found for '{effective_repo}' under {base}.\n"
                f"Run 'standards-extractor analyze --project-dir {project_dir}' first.",
                fg='red',
            )
            raise SystemExit(1)
        snapshot_path = Path(latest)

    out_dir = out_dir or (snapshot_path / "pipeline")
    kind_list = [k.strip() for k in kinds.split(",") if k.strip()]
    config = {
        "snapshot_path": str(snapshot_path),
        "out_dir": str(out_dir),
        "kinds": kind_list,
        "max_attempts": max_attempts,
        "parallelism": parallelism,
    }

    from .pipeline.checks.bootstrap_check import run as bootstrap_run
    code, payload = bootstrap_run(config)
    if code != 0:
        click.secho(f"bootstrap_check: abort — {payload.get('problems')}", fg='red')
        raise SystemExit(1)

    from .pipeline.tools.plan_batches import plan
    batches = plan(str(snapshot_path), kind_list)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "config.json").write_text(_json.dumps(config, indent=2), encoding='utf-8')
    (out_dir / "batches.json").write_text(_json.dumps(batches, indent=2), encoding='utf-8')

    per_kind = {}
    for b in batches:
        per_kind[b["kind"]] = per_kind.get(b["kind"], 0) + 1
    click.secho(f"bootstrap: proceed · {len(batches)} batches planned {per_kind}", fg='green')
    click.echo(f"config:  {out_dir / 'config.json'}")
    click.echo(f"batches: {out_dir / 'batches.json'}")
    click.echo(
        f"\nHand off to the agent (pipeline spec D2/D12):\n"
        f"  claude \"/run-pipeline config={out_dir / 'config.json'}\""
    )


if __name__ == '__main__':
    cli()
