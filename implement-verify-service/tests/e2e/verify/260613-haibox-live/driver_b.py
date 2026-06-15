"""Live driver B — a real Flask repo whose deps are NOT installed, exercising the
setup/build step (G5) with a real `pip install` before serving."""
import sys
import httpx

sys.path.insert(0, "D:/Work/Gary/standards-extractor")
from src.haibox.client import HaiboxClient  # noqa: E402

PY = "D:/Work/Gary/standards-extractor/.venv/Scripts/python.exe"
FLASK_CMD = [PY, "-c",
             "import os; from app import app; app.run(host='127.0.0.1', port=int(os.environ['PORT']))"]

c = HaiboxClient(base_url="http://127.0.0.1:8785", api_key="live-haibox-key")

print("=== TARGET B: digitalocean/sample-flask (real repo, deps via setup) ===")
box = c.serve(
    FLASK_CMD,
    setup=[PY, "-m", "pip", "install", "flask"],   # real dependency install (G5)
    setup_timeout=180,
    source_dir="C:/Users/ozzie/AppData/Local/Temp/real-flask",
    health_path="/", readiness_timeout=40, name="real-flask",
)
print("SERVED:", box["box_id"], box["base_url"], box["state"])
r = httpx.get(box["base_url"] + "/", timeout=10)
print("GET / ->", r.status_code, "| html bytes:", len(r.text), "| has <html>:", "<html" in r.text.lower())
logs = c.logs(box["box_id"])
print("SETUP RAN (pip in log):", ("Successfully installed" in logs) or ("already satisfied" in logs))
print("LOGS tail:", repr(logs[-160:]))
c.release(box["box_id"])
print("RELEASED B")
print("FINAL LIST:", [(b["name"], b["state"]) for b in c.list()])
