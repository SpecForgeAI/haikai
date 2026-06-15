"""Live driver — a REAL Spring Boot app (spring-guides/gs-rest-service).

Stress-tests haibox's heavy path: a Maven build in `setup` (bounded by
setup_timeout), slow JVM startup (readiness_timeout), and Spring Boot's
non-standard port env (SERVER_PORT, via port_env). The jar is run directly so
the JVM is the box's tracked child.
"""
import sys
import time
import httpx

sys.path.insert(0, "D:/Work/Gary/standards-extractor")
from src.haibox.client import HaiboxClient  # noqa: E402

SRC = "C:/Users/ozzie/AppData/Local/Temp/gs-rest/complete"
JAR = "target/rest-service-complete-0.0.1-SNAPSHOT.jar"

c = HaiboxClient(base_url="http://127.0.0.1:8785", api_key="live-haibox-key")
print("HEALTHZ:", c.healthz())

print("\n=== TARGET: spring-guides/gs-rest-service (real Spring Boot, Maven build) ===")
t0 = time.time()
box = c.serve(
    ["java", "-jar", JAR],
    setup=".\\mvnw.cmd -q -DskipTests package",   # wrapper (pins Maven for Boot 4); .\ so cmd finds it in cwd
    setup_timeout=900,
    source_dir=SRC,
    port_env="SERVER_PORT",                     # Spring Boot binds SERVER_PORT, not PORT
    health_path="/greeting",
    readiness_timeout=120,                      # JVM + Spring boot time
    name="spring-rest",
)
print(f"SERVED in {time.time()-t0:.0f}s:", box["box_id"], box["base_url"], box["state"])
r = httpx.get(box["base_url"] + "/greeting?name=Live", timeout=15)
print("GET /greeting?name=Live ->", r.status_code, r.text[:160])
logs = c.logs(box["box_id"])
print("BUILD+BOOT in log:", "BUILD SUCCESS" in logs or "Started" in logs or "Tomcat started" in logs)
print("LOGS tail:", repr(logs[-220:]))
c.release(box["box_id"])
print("RELEASED")
print("FINAL LIST:", [(b["name"], b["state"]) for b in c.list()])
