"""Live driver — spring-projects/spring-petclinic, the canonical real Spring Boot
app (templates, embedded DB, many deps). A heavier build/boot than gs-rest."""
import sys
import time
import httpx

sys.path.insert(0, "D:/Work/Gary/standards-extractor")
from src.haibox.client import HaiboxClient  # noqa: E402

SRC = "C:/Users/ozzie/AppData/Local/Temp/petclinic"
JAR = "target/spring-petclinic-4.0.0-SNAPSHOT.jar"

c = HaiboxClient(base_url="http://127.0.0.1:8785", api_key="live-haibox-key")
print("HEALTHZ:", c.healthz())

print("\n=== TARGET: spring-projects/spring-petclinic (canonical real Spring Boot) ===")
t0 = time.time()
box = c.serve(
    ["java", "-jar", JAR],
    setup=".\\mvnw.cmd -q -DskipTests package",
    setup_timeout=900,
    source_dir=SRC,
    port_env="SERVER_PORT",
    health_path="/",
    readiness_timeout=150,
    name="petclinic",
)
print(f"SERVED in {time.time()-t0:.0f}s:", box["box_id"], box["base_url"], box["state"])
r = httpx.get(box["base_url"] + "/", timeout=15)
print("GET / ->", r.status_code, "| html bytes:", len(r.text), "| petclinic in page:",
      "petclinic" in r.text.lower())
ro = httpx.get(box["base_url"] + "/owners/find", timeout=15)
print("GET /owners/find ->", ro.status_code)
logs = c.logs(box["box_id"])
print("Tomcat started in log:", "Tomcat started" in logs or "Started PetClinic" in logs)
c.release(box["box_id"])
print("RELEASED")
print("FINAL LIST:", [(b["name"], b["state"]) for b in c.list()])
