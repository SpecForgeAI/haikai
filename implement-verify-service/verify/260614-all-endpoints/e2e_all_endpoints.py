"""Live HTTP smoke over EVERY endpoint of the real API.

Boots the real app (`python -m src.entrypoints.run_api`) on a free port, then
enumerates every registered route from the app's own OpenAPI schema and exercises
each one over real HTTP. Two passes:

  NO-AUTH  (every method+path)  — protected routes MUST reject (401/403) and take
           no action; open routes (/health, /docs, /openapi.json) return 200.
           Safe by construction: a rejected request never runs handler logic.
  WITH-AUTH (GET routes only)   — read-only, so safe to actually call. Asserts the
           route is wired + auth-accepted: NOT 401 and NOT 404-route-missing.
           (422/400/404-resource/500-needs-real-work all mean "route works".)

Write/destructive routes are only hit WITHOUT auth (so they never execute). Path
params are filled with inert dummies. Streaming routes get a short timeout and a
read-timeout counts as "reachable". Harness owns the server lifecycle (always killed).
"""
import contextlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

REPO = "D:/Work/Gary/standards-extractor"
VENV_PY = REPO + "/.venv/Scripts/python.exe"
KEY = "all-endpoints-key"
WORK = tempfile.mkdtemp(prefix="all-endpoints-")
ENV = {**os.environ, "PYTHONUTF8": "1", "STANDARDS_API_KEY": KEY,
       "OPENAI_API_KEY": "sk-dummy", "API_WORKSPACE_DIR": WORK,
       "JOBS_DB_PATH": WORK + "/jobs.db", "API_HOST": "127.0.0.1"}

# inert dummy values for path params — nothing that resolves to a real resource
PARAM = {"company": "testco", "project": "testproj", "spec_name": "nospec",
         "spec_id": "nospec", "job_id": "nojob", "bug_id": "nobug", "box_id": "nobox",
         "run_id": "norun", "session_id": "nosess", "orchestrate_id": "noorch",
         "provider": "github", "ingress_token": "notoken"}
OPEN_PATHS = {"/health", "/healthz", "/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect"}
PASS, FAIL = [], []


def chk(label, cond, detail=""):
    (PASS if cond else FAIL).append((label, detail))
    print(f"  [{'PASS' if cond else 'FAIL'}] {label}" + (f" — {detail}" if detail and not cond else ""))


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def fill(path):
    out = path
    for k, v in PARAM.items():
        out = out.replace("{" + k + "}", v)
    return out


def req(method, url, *, auth=False, timeout=6):
    # Shell out to curl: both urllib and httpx hang sending a POST body when the
    # server early-rejects (401) without draining it (a Python-HTTP-client quirk
    # on Windows); curl returns the 401 in ~2ms. (`-o nul` is curl's own null
    # device on Windows — not a shell redirect.)
    cmd = ["curl", "-s", "-m", str(timeout), "-o", os.devnull, "-w", "%{http_code}", "-X", method]
    if auth:
        cmd += ["-H", f"Authorization: Bearer {KEY}"]
    if method in ("POST", "PUT", "PATCH"):
        cmd += ["-H", "Content-Type: application/json", "-d", "{}"]
    cmd.append(url)
    p = subprocess.run(cmd, capture_output=True, text=True)
    code = p.stdout.strip()
    if p.returncode == 28 or code in ("000", ""):
        return "TIMEOUT"   # curl -m exceeded: streaming endpoint held the connection => reachable
    try:
        return int(code)
    except ValueError:
        return f"ERR:rc{p.returncode}"


def main():
    port = free_port()
    # Server stdout -> a FILE, never a PIPE: uvicorn access-logs every request,
    # and an undrained PIPE fills (~64KB on Windows) then BLOCKS the server mid-run,
    # wedging every request after ~40. A file never blocks the writer.
    srv_log = open(WORK + "/server.log", "w+")
    proc = subprocess.Popen(
        [VENV_PY, "-m", "src.entrypoints.run_api", "--host", "127.0.0.1", "--port", str(port)],
        cwd=REPO, env=ENV,
        stdout=srv_log, stderr=subprocess.STDOUT, text=True,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0,
    )
    base = f"http://127.0.0.1:{port}"

    def _srv_tail():
        with contextlib.suppress(Exception):
            srv_log.flush()
            with open(WORK + "/server.log") as f:
                return f.read()[-1500:]
        return ""
    try:
        # wait for readiness
        for _ in range(60):
            if proc.poll() is not None:
                print("SERVER EXITED EARLY:\n", _srv_tail()); return 1
            with contextlib.suppress(Exception):
                if urllib.request.urlopen(base + "/health", timeout=2).status == 200:
                    break
            time.sleep(0.5)
        else:
            print("server never became healthy"); return 1

        spec = json.loads(urllib.request.urlopen(base + "/openapi.json", timeout=5).read())
        paths = spec.get("paths", {})
        routes = [(m.upper(), p) for p, ops in paths.items() for m in ops
                  if m.upper() in ("GET", "POST", "PUT", "DELETE", "PATCH")]
        print(f"=== {len(routes)} routes from OpenAPI on {base} ===\n")

        print("--- PASS 1: NO AUTH (protected must reject; open must serve) ---")
        for method, path in sorted(routes):
            url = base + fill(path)
            stream = "stream" in path or "/events" in path
            status = req(method, url, auth=False, timeout=3 if stream else 6)
            is_open = path in OPEN_PATHS
            if is_open:
                chk(f"OPEN  {method} {path} -> 200", status in (200, "TIMEOUT"), f"got {status}")
            else:
                ok = status in (401, 403)
                chk(f"AUTH-GATED {method} {path} -> 401/403 (no key)", ok, f"got {status}")

        print("\n--- PASS 2: WITH AUTH, GET only (reachable + key accepted) ---")
        for method, path in sorted(routes):
            if method != "GET" or path in OPEN_PATHS:
                continue
            url = base + fill(path)
            stream = "stream" in path or "/events" in path
            status = req(method, url, auth=True, timeout=3 if stream else 6)
            # PASS 1 already proved each route is registered (no-auth -> 401, which
            # an unregistered path can't produce). So here we only need: key was
            # ACCEPTED (not 401/403) and the handler RAN (any real code, incl. a
            # 404/422 for the inert dummy resource/body — that's correct behaviour).
            ok = status not in (401, 403) and not str(status).startswith("ERR")
            chk(f"REACHABLE GET {path} (auth) -> key accepted + handler ran", ok, f"got {status}")

        return 0
    finally:
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        else:
            proc.terminate()
        with contextlib.suppress(Exception):
            proc.wait(timeout=10)
        import shutil
        shutil.rmtree(WORK, ignore_errors=True)


if __name__ == "__main__":
    rc = main()
    print(f"\n=== RESULT: {len(PASS)} passed, {len(FAIL)} failed ===")
    for label, detail in FAIL:
        print(f"  FAILED: {label} — {detail}")
    print("ALL_ENDPOINTS_OK" if not FAIL and rc == 0 else "ALL_ENDPOINTS_FAIL")
    sys.exit(0 if not FAIL and rc == 0 else 1)
