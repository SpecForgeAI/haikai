"""Multi-spec orchestration arc, end-to-end, on a REAL Spring Boot app.

Proves the campaign's deploy/git fixes against a real running Spring Boot server:
  Unit 7 (B2)  two specs -> two feature branches, each carrying ONLY its files
               (driven through the REAL _git_one_spec — the function run_workflow's
               on_spec_complete callback calls, interleaved per spec)
  Unit 6 (L3)  consolidate_and_deploy merges both branches into an ISOLATED git
               worktree (live repo untouched), builds + serves the integrated app
  deploy       haibox actually runs the Spring Boot jar; BOTH features respond live
  Unit 2 (C5)  _emit_orchestration_callback -> outcome=deployed + target_base_url

Fidelity: same as verify/260613-full-arc — every code path I changed is REAL
(git, consolidate, haibox deploy, callback). Only the LLM implement-tasks leg is
stood in for: two real Java @RestControllers represent the per-spec generated code.

The harness OWNS the haiboxd lifecycle: it boots haiboxd at the start and ALWAYS
shuts it down (and releases any box) in a finally — when the tests finish, haibox
is down. Only the msb Spring Boot app needs to pre-exist (see overview.md).
"""
import contextlib
import os
import signal
import socket
import subprocess
import sys
import time
import types
import urllib.request

sys.path.insert(0, "D:/Work/Gary/standards-extractor")

HAIBOX_PORT = "8785"
os.environ["HAIBOX_URL"] = f"http://127.0.0.1:{HAIBOX_PORT}"
os.environ["STANDARDS_API_KEY"] = "msb-key"

from src.job_queue.tasks import (  # noqa: E402
    _git_one_spec, consolidate_and_deploy, _emit_orchestration_callback,
)
from src.haibox.client import HaiboxClient  # noqa: E402

VENV_PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
REPO = "C:/Users/ozzie/AppData/Local/Temp/msb-springboot"
PKG = os.path.join(REPO, "src", "main", "java", "com", "example", "msb")
SPECS = ["add-greeting", "add-farewell"]
PASS, FAIL = [], []


def chk(label, cond):
    (PASS if cond else FAIL).append(label)
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}")


def git(*a):
    return subprocess.run(["git", "-C", REPO, *a], capture_output=True, text=True)


def http_get(url, timeout=10):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, r.read().decode().strip()
    except Exception as exc:  # noqa: BLE001
        return None, f"ERR {exc}"


def _port_free(port, host="127.0.0.1"):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.5)
        return s.connect_ex((host, int(port))) != 0  # non-zero => nothing listening


def _force_kill(proc):
    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)


def start_haiboxd():
    """Boot haiboxd in its OWN process group and block until healthy. On failure
    the just-spawned process is killed before raising — no leaked daemon."""
    env = {**os.environ, "HAIBOX_HOST": "127.0.0.1", "HAIBOX_PORT": HAIBOX_PORT,
           "STANDARDS_API_KEY": "msb-key"}
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
    _force_kill(proc)  # don't leak the spawned-but-unhealthy daemon
    raise RuntimeError("haiboxd did not become healthy within 30s")


def stop_haiboxd(proc):
    """Shut haiboxd down CLEANLY: a graceful signal first so its own lifespan
    runs registry.shutdown() — which releases every box AND removes its workdir.
    Force tree-kill only as a fallback if it doesn't exit. Verifies the port is
    actually free at the end and escalates if not."""
    if proc is None:
        return
    try:
        if sys.platform == "win32":
            proc.send_signal(signal.CTRL_BREAK_EVENT)  # own group -> uvicorn graceful shutdown
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
    # Guarantee the listener is gone; escalate once if a stray process holds it.
    for _ in range(10):
        if _port_free(HAIBOX_PORT):
            print(f"  port {HAIBOX_PORT} free — haibox fully down")
            return
        time.sleep(0.5)
    print(f"  WARNING: port {HAIBOX_PORT} still bound after shutdown — force-killing")
    _force_kill(proc)


@contextlib.contextmanager
def haiboxd_running():
    """haiboxd as a flow-scoped resource: started on enter, ALWAYS shut down
    cleanly on exit (success, exception, or KeyboardInterrupt). Shutdown is part
    of the flow — it can't be forgotten."""
    proc = None
    try:
        proc = start_haiboxd()
        yield proc
    finally:
        stop_haiboxd(proc)


# git_config stand-in: local-only (no push/PR), same shape GitManager/apply_git_workflow read.
CFG = types.SimpleNamespace(provider="github", default_branch="main",
                            github_token=None, bitbucket_username=None,
                            bitbucket_app_password=None, auto_push=False, auto_pr=False)
TARGETS = [(None, REPO)]

CONTROLLERS = {
    "add-greeting": ("GreetingController", "/api/one", "feature-one"),
    "add-farewell": ("FarewellController", "/api/two", "feature-two"),
}


def write_controller(spec):
    cls, path, body = CONTROLLERS[spec]
    src = (
        "package com.example.msb;\n\n"
        "import org.springframework.web.bind.annotation.GetMapping;\n"
        "import org.springframework.web.bind.annotation.RestController;\n\n"
        f"@RestController\npublic class {cls} {{\n"
        f"    @GetMapping(\"{path}\")\n"
        f"    public String handle() {{ return \"{body}\"; }}\n"
        "}\n"
    )
    with open(os.path.join(PKG, f"{cls}.java"), "w", encoding="utf-8") as f:
        f.write(src)


def run_arc():
    """The arc. Returns the box_id it provisioned (for finally-release) or None."""
    box_id = None

    print("=== PHASE 0: clean slate (idempotent reruns) ===")
    # Clear any stale haibox-deploy worktree registrations (debris from earlier
    # runs predating the L1 teardown fix), so the repo starts clean.
    for ln in git("worktree", "list", "--porcelain").stdout.splitlines():
        if ln.startswith("worktree ") and "haibox-deploy-" in ln:
            git("worktree", "remove", "--force", ln.split(" ", 1)[1].strip())
    git("worktree", "prune")
    git("checkout", "-q", "main")
    for s in SPECS:
        git("branch", "-D", f"feature/{s}")  # ignore failure if absent
    for cls, _, _ in CONTROLLERS.values():
        try:
            os.remove(os.path.join(PKG, f"{cls}.java"))
        except FileNotFoundError:
            pass
    git("checkout", "-q", "--", ".")
    print("  on branch:", git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip())

    print("\n=== PHASE 1: B2 — each spec commits to its OWN branch, interleaved ===")
    git_results = []  # C1/L3: per-(spec, repo) records
    for s in SPECS:
        write_controller(s)                          # implement-tasks output for THIS spec
        _git_one_spec(CFG, TARGETS, git_results, s)  # REAL per-spec commit (run_workflow's callback)
        print(f"  committed feature/{s}")
    chk("per-spec git produced no errors", all(r["error"] is None for r in git_results))
    chk("both specs recorded (C1: not collapsed)",
        [r["branch"] for r in git_results] == [f"feature/{s}" for s in SPECS])
    g_files = git("ls-tree", "-r", "--name-only", "feature/add-greeting").stdout
    f_files = git("ls-tree", "-r", "--name-only", "feature/add-farewell").stdout
    chk("feature/add-greeting has GreetingController", "GreetingController.java" in g_files)
    chk("feature/add-greeting does NOT have FarewellController (B2)", "FarewellController.java" not in g_files)
    chk("feature/add-farewell has FarewellController", "FarewellController.java" in f_files)
    chk("feature/add-farewell does NOT have GreetingController (B2)", "GreetingController.java" not in f_files)

    print("\n=== PHASE 2: Unit 6 — consolidate both branches into an isolated worktree + deploy ===")
    serve_spec = {
        "command": "java -jar target/msb.jar",
        "setup": "mvn -q -B package -DskipTests",
        "setup_timeout": 300.0,
        "health_path": "/api/one",   # readiness proves feature one is live
        "port_env": "PORT",
        "readiness_timeout": 120.0,
    }
    deploy = consolidate_and_deploy(REPO, [f"feature/{s}" for s in SPECS], serve_spec, default_branch="main")
    base_url, box_id, wt = deploy["base_url"], deploy["box_id"], deploy["worktree"]
    print(f"  base_url={base_url}  box={box_id}")
    print(f"  worktree={wt}")
    chk("deploy returned a base_url + box_id", bool(base_url) and bool(box_id))
    chk("merged both spec branches", deploy["merged"] == [f"feature/{s}" for s in SPECS])
    chk("no integration_branch lie (C2)", "integration_branch" not in deploy)
    # L1: the worktree is reclaimed once the box has its copy (both-features proof
    # is Phase 3's live HTTP). The build location no longer leaks.
    chk("deploy worktree reclaimed (L1)", not os.path.exists(wt))
    chk("this deploy's worktree registration removed (L1)",
        wt not in git("worktree", "list").stdout)
    chk("LIVE repo untouched: still on main", git("rev-parse", "--abbrev-ref", "HEAD").stdout.strip() == "main")
    chk("LIVE repo working tree clean (no feature files)",
        not os.path.exists(os.path.join(PKG, "GreetingController.java")))

    print("\n=== PHASE 3: the real Spring Boot server serves BOTH features ===")
    s1, b1 = http_get(base_url + "/api/one")
    s2, b2 = http_get(base_url + "/api/two")
    print(f"  GET /api/one -> {s1} {b1!r}")
    print(f"  GET /api/two -> {s2} {b2!r}")
    chk("feature one live (GET /api/one == 200 feature-one)", s1 == 200 and b1 == "feature-one")
    chk("feature two live (GET /api/two == 200 feature-two)", s2 == 200 and b2 == "feature-two")

    print("\n=== PHASE 4: Unit 2 — build-results callback outcome=deployed ===")
    sent = {}
    import src.job_queue.tasks as tasks
    _orig_post = tasks._post_callback
    tasks._post_callback = lambda url, payload: sent.update(payload) or True
    try:
        req = types.SimpleNamespace(company="acme", project="msb",
                                    callback_url="http://127.0.0.1:9/build-results")
        response = types.SimpleNamespace(errors=[], success=True, pr_url=None,
                                         spec_names=[f"feature/{s}" for s in SPECS])
        rec = _emit_orchestration_callback(req, "job-msb", response, deploy)
    finally:
        tasks._post_callback = _orig_post
    chk("build-results outcome=deployed", rec["outcome"] == "deployed")
    chk("build-results carries target_base_url", rec.get("target_base_url") == base_url)
    chk("callback was delivered (bool captured)", rec.get("callback_delivered") is True)
    return box_id


def main():
    print("=== boot haiboxd (flow-scoped; shutdown guaranteed on exit) ===")
    # The `with` makes haiboxd shutdown a structural part of the flow: whatever
    # happens inside (pass, fail, raise, Ctrl-C), stop_haiboxd runs cleanly.
    # graceful signal -> registry.shutdown() releases every box + cleans workdirs.
    with haiboxd_running():
        box_id = None
        try:
            box_id = run_arc()
        finally:
            if box_id:  # explicit release too (graceful shutdown also covers it)
                with contextlib.suppress(Exception):
                    HaiboxClient().release(box_id)
                    print("  released", box_id)

    print(f"\n=== RESULT: {len(PASS)} passed, {len(FAIL)} failed ===")
    if FAIL:
        for f in FAIL:
            print("  FAILED:", f)
    print("MULTISPEC_OK" if not FAIL else "MULTISPEC_FAIL")
    return 0 if not FAIL else 1


if __name__ == "__main__":
    sys.exit(main())
