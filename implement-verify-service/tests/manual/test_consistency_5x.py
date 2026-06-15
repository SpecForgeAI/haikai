#!/usr/bin/env python3
"""Run endpoint discovery N times on a repo to measure consistency.

Saves full endpoint details, traces, parser scripts, and metrics per run.
Each run gets an isolated temp directory to avoid cross-contamination.
"""
import sys
import json
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path
from statistics import mean, stdev

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.ast.ctags_provider import CtagsProvider
from src.ast.endpoint_discoverer import discover_endpoints
from src.ast.store import FileStore
from src.ast.pipeline import run_structural_pipeline
from src.ast.provider import ProviderRegistry
from src.llm_client import LLMClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

TEMP = Path(tempfile.gettempdir())
MODEL = os.environ.get("MODEL", "claude-sonnet-4-6")
PROVIDER = os.environ.get("PROVIDER", "custom" if os.environ.get("PROXY_URL") else ("anthropic" if "claude" in os.environ.get("MODEL", "claude") else "openai"))
PROXY_URL = os.environ.get("PROXY_URL", "")
RUNS = int(os.environ.get("RUNS", "5"))
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", str(TEMP / "benchmark_results")))

# Repos to test — path, language extensions, ground truth
REPOS = {
    "spring-petclinic": {
        "path": TEMP / "spring-petclinic",
        "exts": [".java"],
        "expected": 17,
    },
    "nestjs-realworld": {
        "path": TEMP / "nestjs-realworld",
        "exts": [".ts"],
        "expected": 21,
    },
    "oatpp-crud": {
        "path": TEMP / "oatpp-crud",
        "exts": [".cpp", ".hpp"],
        "expected": 6,
    },
    "saleor": {
        "path": TEMP / "saleor",
        "exts": [".py"],
        "expected": 10,
    },
    "beer-shop-go": {
        "path": TEMP / "beer-shop-go",
        "exts": [".go"],
        "expected": 26,  # HTTP routes (excludes gRPC proto)
    },
    "redmine": {
        "path": TEMP / "redmine",
        "exts": [".rb"],
        "expected": None,
    },
    "openmrs-core": {
        "path": TEMP / "openmrs-core",
        "exts": [".java"],
        "expected": None,
    },
    "orangehrm": {
        "path": TEMP / "orangehrm",
        "exts": [".php"],
        "expected": None,
    },
    "BroadleafCommerce": {
        "path": TEMP / "BroadleafCommerce",
        "exts": [".java"],
        "expected": None,
    },
    "mantisbt": {
        "path": TEMP / "mantisbt",
        "exts": [".php"],
        "expected": None,
    },
    "sonarqube": {
        "path": TEMP / "sonarqube",
        "exts": [".java"],
        "expected": None,
    },
    "keycloak": {
        "path": TEMP / "keycloak",
        "exts": [".java"],
        "expected": None,
    },
    "jenkins": {
        "path": TEMP / "jenkins",
        "exts": [".java"],
        "expected": None,
    },
    "dotcms-core": {
        "path": TEMP / "dotcms-core",
        "exts": [".java"],
        "expected": None,
    },
    "kibana": {
        "path": TEMP / "kibana",
        "exts": [".ts"],
        "expected": None,
    },
    "moodle": {
        "path": TEMP / "moodle",
        "exts": [".php"],
        "expected": None,
    },
    "wordpress": {
        "path": TEMP / "wordpress",
        "exts": [".php"],
        "expected": None,
    },
    "gitea": {
        "path": TEMP / "gitea",
        "exts": [".go"],
        "expected": None,
    },
    "owncloud-core": {
        "path": TEMP / "owncloud-core",
        "exts": [".php"],
        "expected": None,
    },
    "phpbb": {
        "path": TEMP / "phpbb",
        "exts": [".php"],
        "expected": None,
    },
    "prestashop": {
        "path": TEMP / "prestashop",
        "exts": [".php"],
        "expected": None,
    },
    "drupal": {
        "path": TEMP / "drupal",
        "exts": [".php"],
        "expected": None,
    },
    "odoo": {
        "path": TEMP / "odoo",
        "exts": [".py"],
        "expected": None,
    },
    "opencart": {
        "path": TEMP / "opencart",
        "exts": [".php"],
        "expected": None,
    },
    "dolibarr": {
        "path": TEMP / "dolibarr",
        "exts": [".php"],
        "expected": None,
    },
    "gerrit": {
        "path": TEMP / "gerrit",
        "exts": [".java"],
        "expected": None,
    },
    "xwiki-platform": {
        "path": TEMP / "xwiki-platform",
        "exts": [".java"],
        "expected": None,
    },
    "mediawiki": {
        "path": TEMP / "mediawiki",
        "exts": [".php"],
        "expected": None,
    },
    "shopware": {
        "path": TEMP / "shopware",
        "exts": [".php"],
        "expected": None,
    },
    "discourse": {
        "path": TEMP / "discourse",
        "exts": [".rb"],
        "expected": None,
    },
    "suitecrm": {
        "path": TEMP / "suitecrm",
        "exts": [".php"],
        "expected": None,
    },
    "camunda-bpm": {
        "path": TEMP / "camunda-bpm",
        "exts": [".java"],
        "expected": None,
    },
    "flarum": {
        "path": TEMP / "flarum",
        "exts": [".php"],
        "expected": None,
    },
    "bonita-engine": {
        "path": TEMP / "bonita-engine",
        "exts": [".java"],
        "expected": None,
    },
    "alfresco": {
        "path": TEMP / "alfresco",
        "exts": [".java"],
        "expected": None,
    },
    "fineract": {
        "path": TEMP / "fineract",
        "exts": [".java"],
        "expected": None,
    },
    "opensearch": {
        "path": TEMP / "opensearch",
        "exts": [".java"],
        "expected": None,
    },
    "piwigo": {
        "path": TEMP / "piwigo",
        "exts": [".php"],
        "expected": None,
    },
    "ampache": {
        "path": TEMP / "ampache",
        "exts": [".php"],
        "expected": None,
    },
    "invoiceninja": {
        "path": TEMP / "invoiceninja",
        "exts": [".php"],
        "expected": None,
    },
    "mautic": {
        "path": TEMP / "mautic",
        "exts": [".php"],
        "expected": None,
    },
    "kanboard": {
        "path": TEMP / "kanboard",
        "exts": [".php"],
        "expected": None,
    },
    "mastodon": {
        "path": TEMP / "mastodon",
        "exts": [".rb"],
        "expected": None,
    },
    "directus": {
        "path": TEMP / "directus",
        "exts": [".ts"],
        "expected": None,
    },
    "firefly-iii": {
        "path": TEMP / "firefly-iii",
        "exts": [".php"],
        "expected": None,
    },
    "passbolt": {
        "path": TEMP / "passbolt",
        "exts": [".php"],
        "expected": None,
    },
    "espocrm": {
        "path": TEMP / "espocrm",
        "exts": [".php"],
        "expected": None,
    },
    "strapi": {
        "path": TEMP / "strapi",
        "exts": [".ts", ".js"],
        "expected": None,
    },
    "monica": {
        "path": TEMP / "monica",
        "exts": [".php"],
        "expected": None,
    },
    "akeneo-pim": {
        "path": TEMP / "akeneo-pim",
        "exts": [".php"],
        "expected": None,
    },
}


def collect_files(repo_path: Path, exts: list[str], max_files: int = 500) -> list[str]:
    """Collect source files, excluding test/vendor dirs."""
    files = []
    for ext in exts:
        for f in repo_path.rglob(f"*{ext}"):
            s = str(f).replace("\\", "/")
            if any(skip in s for skip in [".git", "/test/", "/spec/", "/vendor/", "/target/", "/node_modules/"]):
                continue
            files.append(s)
    return files[:max_files]


def build_snapshot(repo_name: str, repo_path: Path, files: list[str]) -> str:
    """Build structural store snapshot (reused across runs)."""
    ctags = CtagsProvider()
    ctags_results = ctags.analyze_batch(files)
    snap_dir = tempfile.mkdtemp(prefix=f"{repo_name}-bench-")
    store = FileStore(base_path=snap_dir)
    registry = ProviderRegistry()

    run_structural_pipeline(
        file_paths=files,
        ctags_results=ctags_results,
        store=store,
        registry=registry,
        repo_name=repo_name,
        commit_sha="bench",
        branch="main",
        project_root=str(repo_path),
        llm_client=None,
    )
    return str(Path(snap_dir) / repo_name / "bench")


def _snapshot_dir(path: Path) -> dict:
    """Snapshot files in a directory: {relpath: (size, mtime)}."""
    snap = {}
    if not path.exists():
        return snap
    try:
        for p in path.rglob("*"):
            if p.is_file():
                try:
                    rel = str(p.relative_to(path)).replace("\\", "/")
                    snap[rel] = (p.stat().st_size, p.stat().st_mtime)
                except (OSError, ValueError):
                    continue
    except Exception:
        pass
    return snap


def _diff_snapshots(before: dict, after: dict) -> dict:
    """Return new/modified files from before→after."""
    changes = {"new": [], "modified": []}
    for path, after_meta in after.items():
        if path not in before:
            changes["new"].append(path)
        elif before[path] != after_meta:
            changes["modified"].append(path)
    return changes


def run_test(repo_name: str, repo_path: Path, snapshot_path: str, log_dir: Path) -> tuple:
    """Run a single endpoint discovery and return (endpoints, token_usage, fs_changes)."""
    log_dir.mkdir(parents=True, exist_ok=True)

    # Snapshot /tmp before
    tmp = Path(tempfile.gettempdir())
    before = _snapshot_dir(tmp)
    with open(log_dir / "fs_snapshot_before.json", "w") as f:
        json.dump({"file_count": len(before)}, f, indent=2)

    # Capture proxy log offset (so we can extract just this run's slice)
    proxy_log = tmp / "proxy.log"
    proxy_log_offset_before = proxy_log.stat().st_size if proxy_log.exists() else 0

    kwargs = {"timeout": None, "log_dir": str(log_dir)}
    if PROXY_URL:
        kwargs["base_url"] = PROXY_URL
    llm = LLMClient(provider=PROVIDER, model=MODEL, **kwargs)
    endpoints = discover_endpoints(
        llm, project_root=str(repo_path), snapshot_path=snapshot_path
    )

    # Snapshot /tmp after, copy any new files Claude wrote
    after = _snapshot_dir(tmp)
    diff = _diff_snapshots(before, after)
    artifacts_dir = log_dir / "claude_artifacts"
    artifacts_dir.mkdir(parents=True, exist_ok=True)
    copied = []
    for relpath in diff["new"] + diff["modified"]:
        # Only copy small text-like files Claude likely wrote
        if relpath.endswith((".py", ".json", ".sh", ".txt")) and not relpath.startswith("benchmark_results"):
            src = tmp / relpath
            try:
                if src.stat().st_size < 5_000_000:  # 5MB cap
                    dest = artifacts_dir / relpath.replace("/", "__")
                    shutil.copy2(src, dest)
                    copied.append(relpath)
            except Exception:
                continue
    with open(log_dir / "fs_diff.json", "w") as f:
        json.dump({
            "new_files": diff["new"][:200],
            "modified_files": diff["modified"][:200],
            "artifacts_copied": copied,
        }, f, indent=2)

    # Extract just this run's slice of proxy.log
    if proxy_log.exists():
        try:
            with open(proxy_log, "rb") as f:
                f.seek(proxy_log_offset_before)
                slice_bytes = f.read()
            with open(log_dir / "proxy.log", "wb") as f:
                f.write(slice_bytes)
        except Exception as e:
            print(f"WARN: failed to slice proxy.log: {e}")

    return endpoints, llm.token_usage, {"new": len(diff["new"]), "modified": len(diff["modified"]), "copied": copied}


def save_run(run_dir: Path, run_num: int, repo_name: str, repo_path: str,
             endpoints: list, elapsed: float, usage: dict, snapshot_path: str):
    """Save all artifacts for a single run."""
    run_dir.mkdir(parents=True, exist_ok=True)

    # Save endpoint details
    endpoint_data = [
        {
            "operation": e.operation,
            "path": e.path,
            "type": e.type,
            "handler_class": e.handler_class,
            "handler_method": e.handler_method,
            "file": e.file,
            "line": e.line,
            "framework": e.framework,
            "confidence": e.confidence,
        }
        for e in endpoints
    ]
    with open(run_dir / "endpoints.json", "w") as f:
        json.dump(endpoint_data, f, indent=2)

    # Save full run metrics
    with open(run_dir / "metrics.json", "w") as f:
        json.dump({
            "run": run_num,
            "repo": repo_name,
            "repo_path": repo_path,
            "snapshot_path": snapshot_path,
            "model": MODEL,
            "provider": PROVIDER,
            "proxy_url": PROXY_URL or None,
            "endpoint_count": len(endpoints),
            "elapsed_seconds": round(elapsed, 1),
            "token_usage": usage,
            "unique_paths": len(set(f"{e.operation} {e.path}" for e in endpoints)),
            "unique_files": len(set(e.file for e in endpoints if e.file)),
            "frameworks": list(set(e.framework for e in endpoints if e.framework)),
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }, f, indent=2)

    # Copy trace file (use model-specific name to avoid collision)
    trace_path = TEMP / f"endpoint_trace_{MODEL}.json"
    if trace_path.exists():
        shutil.copy2(trace_path, run_dir / "trace.json")

    # Copy parser script if it exists
    parser_path = TEMP / "discovery" / "parser.py"
    if parser_path.exists():
        shutil.copy2(parser_path, run_dir / "parser.py")


def main():
    repo_names = sys.argv[1:] if len(sys.argv) > 1 else list(REPOS.keys())

    for name in repo_names:
        if name not in REPOS:
            print(f"Unknown repo: {name}. Available: {list(REPOS.keys())}")
            continue

        config = REPOS[name]
        repo_path = config["path"]
        if not repo_path.exists():
            print(f"SKIP {name}: {repo_path} not found")
            continue

        # Create output directory for this repo
        repo_out = OUTPUT_DIR / name / time.strftime("%Y%m%d_%H%M%S")
        repo_out.mkdir(parents=True, exist_ok=True)

        print(f"\n{'='*60}")
        print(f"  {name} — {RUNS}x (model: {MODEL}, provider: {PROVIDER})")
        print(f"  Repo: {repo_path}")
        print(f"  Output: {repo_out}")
        if config["expected"]:
            print(f"  Expected: {config['expected']} endpoints")
        print(f"{'='*60}")

        files = collect_files(repo_path, config["exts"])
        print(f"Source files: {len(files)}")

        snapshot_path = build_snapshot(name, repo_path, files)
        print(f"Snapshot: {snapshot_path}")

        results = []
        all_usage = []
        for run in range(1, RUNS + 1):
            print(f"\n--- Run {run}/{RUNS} ---")
            run_dir = repo_out / f"run_{run:02d}"
            t0 = time.time()
            endpoints, usage, fs = run_test(name, repo_path, snapshot_path, run_dir)
            elapsed = time.time() - t0
            count = len(endpoints)
            results.append(count)
            all_usage.append(usage)

            # Save endpoints + metrics (run_dir already created by run_test)
            save_run(run_dir, run, name, str(repo_path), endpoints, elapsed,
                     usage, snapshot_path)

            # Print run metrics
            unique_paths = len(set(f"{e.operation} {e.path}" for e in endpoints))
            unique_files = len(set(e.file for e in endpoints if e.file))
            print(f"  Endpoints: {count} (unique paths: {unique_paths}, files: {unique_files})")
            print(f"  Time: {elapsed:.0f}s | Tokens: {usage['total_tokens']} ({usage['prompt_tokens']}in/{usage['completion_tokens']}out) | Calls: {usage['calls']}")
            print(f"  FS: {fs['new']} new files, {fs['modified']} modified, {len(fs['copied'])} artifacts copied")
            if fs['copied']:
                print(f"    Artifacts: {fs['copied'][:5]}")
            if config["expected"]:
                accuracy = count / config["expected"] * 100 if config["expected"] > 0 else 0
                print(f"  Accuracy: {accuracy:.0f}% (expected {config['expected']})")

            # Show endpoint paths
            paths = sorted(set(f"{e.operation} {e.path}" for e in endpoints))
            for p in paths[:10]:
                print(f"    {p}")
            if len(paths) > 10:
                print(f"    ... and {len(paths) - 10} more")

        # Save overall results
        total_tokens = sum(u["total_tokens"] for u in all_usage)
        total_calls = sum(u["calls"] for u in all_usage)
        overall = {
            "repo": name,
            "model": MODEL,
            "provider": PROVIDER,
            "runs": RUNS,
            "results": results,
            "expected": config["expected"],
            "total_tokens": total_tokens,
            "total_calls": total_calls,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        if results:
            overall["min"] = min(results)
            overall["max"] = max(results)
            overall["spread"] = max(results) - min(results)
            if len(results) > 1:
                overall["mean"] = round(mean(results), 1)
                overall["stdev"] = round(stdev(results), 1)
        with open(repo_out / "results.json", "w") as f:
            json.dump(overall, f, indent=2)

        print(f"\n{'='*60}")
        print(f"  {name} RESULTS: {results}")
        if results:
            print(f"  Min: {min(results)}, Max: {max(results)}, Spread: {max(results)-min(results)}")
            if len(results) > 1:
                print(f"  Mean: {mean(results):.1f}, StdDev: {stdev(results):.1f}")
        if config["expected"]:
            print(f"  Expected: {config['expected']}")
        print(f"  Total tokens: {total_tokens} | Total calls: {total_calls}")
        print(f"  Saved to: {repo_out}")
        print(f"{'='*60}")


if __name__ == "__main__":
    main()
