"""Polyrepo orchestration arc, end-to-end, on REAL git repos + REAL haibox.

The multispec e2e proves N specs into ONE repo. This proves the OTHER axis —
a polyrepo product (coordination.yaml at the product root, N sibling repos) —
exercising the real orchestration git + deploy code paths:

  PHASE 1  topology      _resolve_repo_targets(product_root) -> one (folder, repo)
                         target per repo in coordination.yaml (the polyrepo branch
                         of the resolver; legacy single-repo returns folder=None).
  PHASE 2  git matrix    TWO specs x TWO repos through the REAL _git_one_spec
                         (run_workflow's on_spec_complete callback) -> 4 per-(spec,
                         repo) branches `feature/<spec>--<folder>`, each carrying
                         ONLY its spec's file (B2 isolation), none collapsed (C1/L3).
  PHASE 3  N services    each repo consolidated + deployed on its own haibox box ->
                         N live base_urls, each serving its repo's MERGED specs.
                         (Polyrepo product = N independently-served boxes — the same
                         per-box model the remote-ssh backend routes per host.)

Fidelity: git, _git_one_spec, consolidate_and_deploy, haibox deploy are all REAL.
Only the LLM implement-tasks leg is stood in for — a per-spec `feat_<spec>.txt`
file represents that spec's generated code in each repo. Each repo's app.py serves
the sorted list of feat_*.txt it finds, so the LIVE body reflects exactly which
specs landed in the deployed artifact.

KNOWN Phase-2 boundary (honest): the production single-call deploy path
(_maybe_deploy_orchestration) deploys only the FIRST repo target and logs the
rest as Phase-2 (tasks.py). This e2e deploys EACH repo directly via
consolidate_and_deploy to show the building block serves all N — i.e. the gap is
orchestration wiring, not a backend limit.

Harness OWNS the haiboxd lifecycle: boots it, and ALWAYS shuts it down (releasing
every box) in a finally — when the test finishes, haibox is down. Self-contained:
builds its own throwaway repos under a temp product root; no pre-existing app.
"""
import contextlib
import glob
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import types
import urllib.request
from pathlib import Path

sys.path.insert(0, "D:/Work/Gary/standards-extractor")

HAIBOX_PORT = "8790"
os.environ["HAIBOX_URL"] = f"http://127.0.0.1:{HAIBOX_PORT}"
os.environ["STANDARDS_API_KEY"] = "poly-key"

from src.git.coordination import write_coordination  # noqa: E402
from src.haibox.client import HaiboxClient  # noqa: E402
from src.job_queue.tasks import (  # noqa: E402
    _git_one_spec, _resolve_repo_targets, consolidate_and_deploy,
)

VENV_PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
PRODUCT_ROOT = os.path.join(tempfile.gettempdir(), "polyrepo-e2e", "acme", "shop")
REPOS = ["backend", "frontend"]          # folder labels in coordination.yaml
SPECS = ["add-health", "add-metrics"]    # two specs, each touches both repos
PASS, FAIL = [], []

# Each repo's app: serve "<repo>:<sorted feat names>" so the LIVE body is exactly
# the set of specs whose feat_*.txt landed in the deployed (merged) tree.
APP_PY = (
    "import os, glob, http.server, socketserver\n"
    "HERE = os.path.dirname(os.path.abspath(__file__))\n"
    "REPO = {repo!r}\n"
    "class H(http.server.BaseHTTPRequestHandler):\n"
    "    def do_GET(self):\n"
    "        feats = sorted(os.path.basename(p)[5:-4]\n"
    "                       for p in glob.glob(os.path.join(HERE, 'feat_*.txt')))\n"
    "        body = (REPO + ':' + ','.join(feats)).encode()\n"
    "        self.send_response(200); self.send_header('Content-Length', str(len(body)))\n"
    "        self.end_headers(); self.wfile.write(body)\n"
    "    def log_message(self, *a):\n"
    "        pass\n"
    "p = int(os.environ['PORT'])\n"
    "socketserver.TCPServer(('127.0.0.1', p), H).serve_forever()\n"
)

# Local-only git config (no push/PR), same shape GitManager/apply_git_workflow read.
CFG = types.SimpleNamespace(provider="github", default_branch="main",
                            github_token=None, bitbucket_username=None,
                            bitbucket_app_password=None, auto_push=False, auto_pr=False)


def chk(label, cond):
    (PASS if cond else FAIL).append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")


def git(repo, *a):
    return subprocess.run(["git", "-C", repo, *a], capture_output=True, text=True)


def http_get(url, timeout=10):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read().decode().strip()
    except Exception as exc:  # noqa: BLE001
        return None, f"ERR {exc}"


def _port_free(port, host="127.0.0.1"):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, int(port))) != 0


def _force_kill(proc):
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)


def start_haiboxd():
    env = {**os.environ, "HAIBOX_HOST": "127.0.0.1", "HAIBOX_PORT": HAIBOX_PORT,
           "STANDARDS_API_KEY": "poly-key"}
    kw = {"cwd": "D:/Work/Gary/standards-extractor", "env": env,
          "stdout": subprocess.DEVNULL, "stderr": subprocess.STDOUT}
    if sys.platform == "win32":
        kw["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP
    else:
        kw["start_new_session"] = True
    proc = subprocess.Popen([VENV_PY, "-m", "src.haibox.service"], **kw)
    for _ in range(60):
        try:
            if HaiboxClient().healthz().get("status") == "ok":
                print(f"  haiboxd up (pid {proc.pid})")
                return proc
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.5)
    _force_kill(proc)
    raise RuntimeError("haiboxd did not become healthy within 30s")


def stop_haiboxd(proc):
    if proc is None:
        return
    try:
        if sys.platform == "win32":
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=15)
        print("  haiboxd stopped gracefully (boxes released + workdirs cleaned)")
    except subprocess.TimeoutExpired:
        print("  haiboxd did not exit gracefully — force tree-kill")
        _force_kill(proc)
        with contextlib.suppress(Exception):
            proc.wait(timeout=10)
    except Exception as exc:  # noqa: BLE001
        print("  graceful signal failed (%s) — force tree-kill" % exc)
        _force_kill(proc)
    for _ in range(10):
        if _port_free(HAIBOX_PORT):
            print(f"  port {HAIBOX_PORT} free — haibox fully down")
            return
        time.sleep(0.5)
    print(f"  WARNING: port {HAIBOX_PORT} still bound after shutdown — force-killing")
    _force_kill(proc)


@contextlib.contextmanager
def haiboxd_running():
    proc = None
    try:
        proc = start_haiboxd()
        yield proc
    finally:
        stop_haiboxd(proc)


def build_product():
    """A throwaway polyrepo product: <root>/{backend,frontend} real git repos +
    coordination.yaml at the root. Each repo starts with a base app.py on main."""
    if os.path.exists(PRODUCT_ROOT):
        shutil.rmtree(PRODUCT_ROOT, ignore_errors=True)
    os.makedirs(PRODUCT_ROOT, exist_ok=True)
    for repo in REPOS:
        rd = os.path.join(PRODUCT_ROOT, repo)
        os.makedirs(rd, exist_ok=True)
        with open(os.path.join(rd, "app.py"), "w", encoding="utf-8") as f:
            f.write(APP_PY.format(repo=repo))
        git(rd, "init", "-q", "-b", "main")
        git(rd, "config", "user.email", "e2e@local")
        git(rd, "config", "user.name", "e2e")
        git(rd, "add", "-A")
        git(rd, "commit", "-q", "-m", "base app")
    # coordination.yaml — folder -> url (urls are placeholders; local-only run)
    write_coordination(PRODUCT_ROOT,
                       {r: f"git@local:acme/{r}.git" for r in REPOS})
    print(f"  product root: {PRODUCT_ROOT}")
    print(f"  repos: {REPOS}  coordination.yaml written")


def run_arc():
    boxes = []

    print("=== PHASE 1: topology — coordination.yaml -> per-repo targets ===")
    targets = _resolve_repo_targets(Path(PRODUCT_ROOT))
    print(f"  targets: {[(f, os.path.basename(str(d))) for f, d in targets]}")
    chk("two repo targets resolved", len(targets) == 2)
    chk("folder labels come from coordination.yaml",
        sorted(f for f, _ in targets) == sorted(REPOS))
    chk("no legacy folder=None (this is polyrepo, not single-repo)",
        all(f is not None for f, _ in targets))

    print("\n=== PHASE 2: git matrix — 2 specs x 2 repos, interleaved per spec ===")
    git_results = []  # C1/L3: per-(spec, repo) records — must be 4, none collapsed
    for spec in SPECS:
        # implement-tasks stand-in: this spec drops its feat file into EACH repo
        for folder, repo_dir in targets:
            with open(os.path.join(repo_dir, f"feat_{spec[4:]}.txt"), "w", encoding="utf-8") as f:
                f.write(spec)
        _git_one_spec(CFG, targets, git_results, spec)  # REAL per-spec, per-repo commit
        print(f"  committed spec {spec} across {len(targets)} repos")

    chk("per-(spec,repo) git produced no errors", all(r["error"] is None for r in git_results))
    chk("4 records, none collapsed (C1/L3: 2 specs x 2 repos)", len(git_results) == 4)
    got = {(r["spec"], r["repo"], r["branch"]) for r in git_results}
    want = {(s, r, f"feature/{s}--{r}") for s in SPECS for r in REPOS}
    chk("every branch is feature/<spec>--<folder>", got == want)

    # B2 isolation, polyrepo flavour: each branch carries ONLY its spec's feat file.
    for folder, repo_dir in targets:
        for spec in SPECS:
            files = git(repo_dir, "ls-tree", "-r", "--name-only", f"feature/{spec}--{folder}").stdout
            mine = f"feat_{spec[4:]}.txt"
            others = [f"feat_{s[4:]}.txt" for s in SPECS if s != spec]
            ok = mine in files and all(o not in files for o in others)
            chk(f"{folder}:feature/{spec}--{folder} has only {mine} (B2)", ok)
        # live tree back on main + clean after the interleaved run
        head = git(repo_dir, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip()
        dirty = git(repo_dir, "status", "--porcelain").stdout.strip()
        chk(f"{folder}: live repo back on main, clean", head == "main" and dirty == "")

    print("\n=== PHASE 3: N services — each repo consolidated + deployed on its own box ===")
    serve_spec = {"command": f"{VENV_PY} app.py", "health_path": "/",
                  "port_env": "PORT", "readiness_timeout": 30.0}
    deployed = {}
    for folder, repo_dir in targets:
        branches = [f"feature/{s}--{folder}" for s in SPECS]
        dep = consolidate_and_deploy(repo_dir, branches, serve_spec, default_branch="main")
        deployed[folder] = dep
        boxes.append(dep["box_id"])
        print(f"  {folder}: box={dep['box_id']} url={dep['base_url']} merged={dep['merged']}")
        chk(f"{folder}: merged both spec branches", dep["merged"] == branches)
        chk(f"{folder}: deploy worktree reclaimed (L1)", not os.path.exists(dep["worktree"]))
        chk(f"{folder}: live repo still on main",
            git(repo_dir, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() == "main")

    chk("two distinct boxes, distinct base_urls",
        deployed["backend"]["box_id"] != deployed["frontend"]["box_id"]
        and deployed["backend"]["base_url"] != deployed["frontend"]["base_url"])

    print("\n=== PHASE 3b: both services live, each serving its repo's MERGED specs ===")
    # app reports each feat file's stem (feat_<stem>.txt); spec "add-health" -> "health"
    want_body = ":" + ",".join(sorted(s[4:] for s in SPECS))   # ":health,metrics"
    for folder in REPOS:
        status, body = http_get(deployed[folder]["base_url"] + "/")
        print(f"  GET {folder} / -> {status} {body!r}")
        # body == "<repo>:health,metrics" — proves BOTH specs reached the deployed tree
        chk(f"{folder} live + serves both merged specs",
            status == 200 and body == folder + want_body)

    return boxes


def main():
    print("=== build a throwaway polyrepo product (2 real git repos) ===")
    build_product()
    print("\n=== boot haiboxd (flow-scoped; shutdown guaranteed on exit) ===")
    with haiboxd_running():
        boxes = []
        try:
            boxes = run_arc()
        finally:
            for bid in boxes:
                with contextlib.suppress(Exception):
                    HaiboxClient().release(bid)
                    print("  released", bid)

    print(f"\n=== RESULT: {len(PASS)} passed, {len(FAIL)} failed ===")
    for f in FAIL:
        print("  FAILED:", f)
    print("POLYREPO_OK" if not FAIL else "POLYREPO_FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
