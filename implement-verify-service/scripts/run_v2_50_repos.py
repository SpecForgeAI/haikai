#!/usr/bin/env python3
"""Run V2 discovery sequentially across the 50-repo benchmark set.

For each cached repo in TEMP/, build a structural snapshot, run V2 discover(),
and emit a results row. At the end, print a canonical box-drawing table comparing
V1 sonnet baseline vs V2 mechanical.
"""
import json
import logging
import os
import sys
import tempfile
import time
import traceback
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")

sys.path.insert(0, str(Path(__file__).parent.parent))
logging.basicConfig(level=logging.WARNING)

from src.ast.ctags_provider import CtagsProvider
from src.ast.store import FileStore
from src.ast.pipeline import run_structural_pipeline
from src.ast.provider import ProviderRegistry
from src.ast.v2.discovery_agent import discover
from src.llm_client import LLMClient

USE_LLM_FALLBACK = os.environ.get("USE_LLM_FALLBACK", "1") == "1"
LLM_MODEL = os.environ.get("FALLBACK_MODEL", "claude-sonnet-4-6")
LLM_BASE_URL = os.environ.get("PROXY_URL", "http://localhost:3456/v1")
LLM_STREAM_INACTIVITY = float(os.environ.get("LLM_STREAM_INACTIVITY", "60"))
LLM_STREAM_WALL = float(os.environ.get("LLM_STREAM_WALL", "600"))

TEMP = Path(tempfile.gettempdir())

# (repo_name, extensions, V1_sonnet_count, real_grep_count)
REPOS = [
    ("BroadleafCommerce",  (".java",),         98,   101),
    ("akeneo-pim",         (".php",),          376,  141),
    ("alfresco",           (".java",),         532,  482),
    ("ampache",            (".php",),          353,  442),
    ("beer-shop-go",       (".go",),           82,   82),
    ("bonita-engine",      (".java",),         206,  206),
    ("camunda-bpm",        (".java",),         379,  398),
    ("directus",           (".ts", ".js"),     138,  251),
    ("discourse",          (".rb",),           1106, 1156),
    ("dolibarr",           (".php",),          603,  600),
    ("dotcms-core",        (".java",),         670,  724),
    ("drupal",             (".php",),          664,  865),
    ("espocrm",            (".php",),          99,   180),
    ("fineract",           (".java",),         561,  919),
    ("firefly-iii",        (".php",),          547,  670),
    ("flarum",             (".php",),          52,   52),
    ("gerrit",             (".java",),         246,  339),
    ("gitea",              (".go",),           752,  843),
    ("invoiceninja",       (".php",),          521,  402),
    ("jenkins",            (".java",),         274,  362),
    ("kanboard",           (".php",),          160,  174),
    ("keycloak",           (".java",),         589,  551),
    ("kibana",             (".ts", ".js"),     1323, 925),
    ("mantisbt",           (".php",),          328,  364),
    ("mastodon",           (".rb",),           559,  591),
    ("mautic",             (".php",),          352,  716),
    ("mediawiki",          (".php",),          150,  150),
    ("monica",             (".php",),          234,  326),
    ("moodle",             (".php",),          791,  836),
    ("nestjs-realworld",   (".ts",),           21,   21),
    ("oatpp-crud",         (".cpp", ".hpp"),   6,    6),
    ("odoo",               (".py",),           1506, 1514),
    ("opencart",           (".php",),          2150, 1057),
    ("openmrs-core",       (".java",),         21,   33),
    ("opensearch",         (".java",),         256,  205),
    ("orangehrm",          (".php",),          785,  547),
    ("owncloud-core",      (".php",),          367,  None),
    ("passbolt",           (".php",),          126,  176),
    ("phpbb",              (".php",),          411,  163),
    ("piwigo",             (".php",),          96,   23),
    ("prestashop",         (".php",),          1375, 782),
    ("redmine",            (".rb",),           482,  480),
    ("saleor",             (".py",),           11,   10),
    ("shopware",           (".php",),          442,  659),
    ("sonarqube",          (".java",),         298,  298),
    ("spring-petclinic",   (".java",),         17,   17),
    ("strapi",             (".ts", ".js"),     188,  196),
    ("suitecrm",           (".php",),          179,  287),
    ("wordpress",          (".php",),          276,  219),
    ("xwiki-platform",     (".java",),         92,   122),
]

MAX_FILES_PER_REPO = 1500          # cap for tier-2 (general source files)
TIER1_HARD_CAP = 3000              # safety cap for tier-1 (route-suspect) files
                                   # was 8000 — caused ctags timeouts on alfresco/keycloak/kibana/moodle
PER_REPO_TIMEOUT_SEC = int(os.environ.get("PER_REPO_TIMEOUT_SEC", "900"))
                                   # default 15 min; kibana sits ~600-900s, override for headroom
SNAPSHOT_PARENT = TEMP / "v2_50run_snapshots"
RESULTS_DIR = Path(__file__).parent.parent / "temp" / "v2_50_results"
RESULTS_DIR.mkdir(parents=True, exist_ok=True)


# Tier-1 (route-suspect) markers: scanned WITHOUT the per-repo cap so multi-
# module Java repos and big Symfony bundles aren't clipped. Tier-2 = the rest.
ROUTING_SUSPECT_MARKERS = (
    "controller", "resource", "endpoint", "router", "handler",
    "/routes/", "/route/", "routing.yml", "/api/", "/web.xml",
    "urls.py", "routes.rb", "routes.php",
)
EXCLUDE_MARKERS = ("test/", "tests/", "/spec/", "node_modules", "/vendor/",
                    "/target/", "/build/", "/dist/", "__pycache__")


def _resolve_head_sha(repo_path: Path) -> str:
    """Return `git rev-parse HEAD` for repo_path, or empty string on failure."""
    import subprocess
    if not (repo_path / ".git").exists():
        return ""
    try:
        out = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=repo_path,
            capture_output=True, text=True, timeout=10, check=True,
        )
        return out.stdout.strip()
    except Exception:
        return ""


def run_one(name: str, exts: tuple) -> dict:
    repo = TEMP / name
    if not repo.exists():
        return {"name": name, "error": "not_cloned", "endpoints": 0}

    t0 = time.time()
    tier1: list[str] = []
    tier2: list[str] = []
    for p in repo.rglob("*"):
        if not p.is_file():
            continue
        if p.suffix not in exts:
            continue
        s = str(p).lower().replace("\\", "/")
        if any(x in s for x in EXCLUDE_MARKERS):
            continue
        if any(m in s for m in ROUTING_SUSPECT_MARKERS):
            if len(tier1) < TIER1_HARD_CAP:
                tier1.append(str(p))
        else:
            if len(tier2) < MAX_FILES_PER_REPO:
                tier2.append(str(p))
    files = tier1 + tier2
    t_walk = time.time() - t0

    if not files:
        return {"name": name, "error": "no_source_files", "endpoints": 0, "t_walk": round(t_walk, 1)}

    try:
        snap_root = SNAPSHOT_PARENT / name
        snap_root.mkdir(parents=True, exist_ok=True)
        store = FileStore(snap_root)
        ctags = CtagsProvider().analyze_batch(files)
        # Resolve the actual commit SHA so downstream tools (refactoring
        # staleness, dep-graph builder) can pin snapshots precisely.
        # See haikai/specs/2026-04-27-depgraph-commit-sha/
        commit_sha = _resolve_head_sha(repo)
        short_sha = commit_sha[:7] if commit_sha else "head"
        run_structural_pipeline(files, ctags, store, ProviderRegistry(),
                                repo_name=name, commit_sha=commit_sha or "head",
                                branch="main", project_root=str(repo))
        snap = snap_root / name / short_sha
        t_snap = time.time() - t0 - t_walk

        llm_client = None
        if USE_LLM_FALLBACK:
            try:
                llm_client = LLMClient(
                    provider="custom",
                    model=LLM_MODEL,
                    base_url=LLM_BASE_URL,
                    stream_inactivity_timeout=LLM_STREAM_INACTIVITY,
                    stream_wall_timeout=LLM_STREAM_WALL,
                    max_retries=0,
                )
            except Exception:
                llm_client = None
        result = discover(project_root=str(repo), snapshot_path=str(snap),
                          llm_client=llm_client,
                          allow_llm_fallback=USE_LLM_FALLBACK)
        t_disc = time.time() - t0 - t_walk - t_snap
        unique = len({(str(e.operation), str(e.path)) for e in result.endpoints})
        return {
            "name": name,
            "files_scanned": len(files),
            "files_tier1": len(tier1),
            "files_tier2": len(tier2),
            "frameworks": result.detected_frameworks,
            "endpoints": len(result.endpoints),
            "unique": unique,
            "t_walk": round(t_walk, 1),
            "t_snap": round(t_snap, 1),
            "t_disc": round(t_disc, 1),
            "merge_in":  result.merge_report.total_input  if result.merge_report else 0,
            "merge_out": result.merge_report.total_output if result.merge_report else 0,
            "deduped":   result.merge_report.deduplicated if result.merge_report else 0,
            "used_llm_fallback": result.used_llm_fallback,
            "proposed_playbook": result.proposed_playbook_path,
            "verifier_handler_check": (
                result.verifier_report.handler_check
                if result.verifier_report else {}
            ),
            "llm_call_log": result.llm_call_log,
        }
    except Exception as e:
        return {
            "name": name,
            "error": f"{type(e).__name__}: {e}",
            "trace": traceback.format_exc()[-500:],
            "endpoints": 0,
        }


def _run_one_subprocess(name: str, exts: tuple) -> dict:
    """Run a single repo in a subprocess with timeout, so a hang doesn't block the run."""
    import subprocess
    out_file = RESULTS_DIR / f"row_{name}.json"
    if out_file.exists():
        out_file.unlink()
    cmd = [
        sys.executable, str(Path(__file__).resolve()),
        "--single", name, ",".join(exts),
    ]
    env = os.environ.copy()
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    try:
        subprocess.run(cmd, env=env, timeout=PER_REPO_TIMEOUT_SEC,
                       cwd=str(Path(__file__).parent.parent))
    except subprocess.TimeoutExpired:
        return {"name": name, "error": f"timeout_after_{PER_REPO_TIMEOUT_SEC}s", "endpoints": 0}
    if out_file.exists():
        try:
            return json.loads(out_file.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            return {"name": name, "error": f"bad_json: {e}", "endpoints": 0}
    return {"name": name, "error": "no_row_written", "endpoints": 0}


def _single_mode():
    """Subprocess entrypoint: run one repo, write row JSON, exit."""
    name = sys.argv[2]
    exts = tuple(sys.argv[3].split(","))
    r = run_one(name, exts)
    out_file = RESULTS_DIR / f"row_{name}.json"
    out_file.write_text(json.dumps(r, indent=2), encoding="utf-8")


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--single":
        _single_mode()
        return

    only = sys.argv[1:] if len(sys.argv) > 1 else None
    rows: list[dict] = []
    print(f"Running V2 on {len(REPOS) if not only else len(only)} repos sequentially")
    print(f"  MAX_FILES_PER_REPO={MAX_FILES_PER_REPO}, PER_REPO_TIMEOUT={PER_REPO_TIMEOUT_SEC}s")
    print(f"Snapshots in: {SNAPSHOT_PARENT}")
    print(f"Results in:   {RESULTS_DIR}\n")

    for name, exts, v1, grep in REPOS:
        if only and name not in only:
            continue
        print(f"[{len(rows)+1:2d}/{len(REPOS)}] {name:22s} ", end="", flush=True)
        t0 = time.time()
        r = _run_one_subprocess(name, exts)
        r["v1_sonnet"] = v1
        r["real_grep"] = grep
        elapsed = time.time() - t0
        if "error" in r:
            print(f"ERROR ({elapsed:.0f}s): {r['error']}")
        else:
            print(f"{r.get('endpoints', 0):>5} ep ({r.get('unique', 0):>4} unique) | "
                  f"v1={v1:>4} grep={grep if grep is not None else '?':>4} | "
                  f"frameworks={r.get('frameworks', [])} | {elapsed:.0f}s")
        rows.append(r)

        # Save row immediately so we have results even if we crash
        with open(RESULTS_DIR / f"row_{name}.json", "w", encoding="utf-8") as f:
            json.dump(r, f, indent=2)

    # Save full results
    out = RESULTS_DIR / f"all_{time.strftime('%Y%m%d_%H%M%S')}.json"
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
    print(f"\nWrote: {out}")

    # Final box-drawing table
    print("\n" + "=" * 110)
    print(f"{'#':>3} {'Repo':<22} {'V2':>6} {'V1 Sonnet':>10} {'Real Grep':>10} {'Δ vs grep':>10} {'Frameworks':<25}")
    print("-" * 110)
    for i, r in enumerate(rows, 1):
        ep = r.get("endpoints", 0)
        v1 = r.get("v1_sonnet")
        grep = r.get("real_grep")
        delta = (ep - grep) if grep is not None else None
        delta_str = f"{delta:+d}" if delta is not None else "—"
        fw = ",".join(r.get("frameworks", [])) or "(none)"
        print(f"{i:>3} {r['name']:<22} {ep:>6} {v1:>10} "
              f"{grep if grep is not None else '—':>10} {delta_str:>10} {fw:<25}")
    print("=" * 110)


if __name__ == "__main__":
    main()
