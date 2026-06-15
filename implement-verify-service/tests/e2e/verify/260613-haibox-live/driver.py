"""Live end-to-end driver for haibox against REAL projects.

Talks to a running haiboxd over HTTP (the real service, not TestClient), serves
real cloned GitHub repos as targets, replays HTTP against the returned base_url,
retrieves logs, and exercises failure + capacity paths. Prints a transcript.
"""
import sys
import httpx

sys.path.insert(0, "D:/Work/Gary/standards-extractor")
from src.haibox.client import HaiboxClient, HaiboxError  # noqa: E402

PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
UVICORN = [PY, "-c",
           "import os,uvicorn; uvicorn.run('main:app', host='127.0.0.1', port=int(os.environ['PORT']))"]

c = HaiboxClient(base_url="http://127.0.0.1:8785", api_key="live-haibox-key")
print("HEALTHZ:", c.healthz())

# ── Target A: a real FastAPI repo (render-examples/fastapi) ──────────────────
print("\n=== TARGET A: render-examples/fastapi (real repo) ===")
box = c.serve(UVICORN, source_dir="C:/Users/ozzie/AppData/Local/Temp/real-fastapi",
              health_path="/", readiness_timeout=40, name="real-fastapi")
print("SERVED:", box["box_id"], box["base_url"], box["state"])
r1 = httpx.get(box["base_url"] + "/", timeout=10)
print("GET / ->", r1.status_code, r1.text[:120])
r2 = httpx.get(box["base_url"] + "/items/42?q=live", timeout=10)
print("GET /items/42?q=live ->", r2.status_code, r2.text[:160])
print("LOGS (tail):", repr(c.logs(box["box_id"])[-200:]))
print("INSPECT:", c.inspect(box["box_id"])["state"])
c.release(box["box_id"])
print("RELEASED A")

# ── Failure path (G1): a target that never serves; log must be retrievable ───
print("\n=== FAILURE PATH (G1 live): bad target ===")
try:
    c.serve([PY, "-c", "print('FATAL: cannot bind, aborting'); import sys; sys.exit(1)"],
            health_path="/", readiness_timeout=6, name="doomed")
    print("UNEXPECTED: serve succeeded")
except HaiboxError as e:
    msg = str(e)
    print("EXPECTED 502:", "FATAL: cannot bind" in msg, "->", msg[-180:].replace("\n", " | "))

print("\nFINAL LIST:", [(b["name"], b["state"]) for b in c.list()])
print("DONE")
