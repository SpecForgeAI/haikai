#!/usr/bin/env python3
"""Independent triangulation of Kibana's actual route count.

Counts router registrations by directly grepping TS source for the patterns
Kibana uses to declare HTTP routes:

  router.get({ path: '/...', validate: ... }, handler)
  router.post({ path: '/...', ... }, handler)
  router.versioned.get({ path: '/...', access: '...' }).addVersion(...)

Also splits public (/api/) vs internal (/internal/) and reports overlap with
the canonical OpenAPI spec.
"""
from __future__ import annotations

import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.dep.openapi import get_openapi_endpoints

KIBANA = Path(r"C:\Users\ozzie\AppData\Local\Temp\kibana")

VERBS = ("get", "post", "put", "delete", "patch")
# Regex to find router.<verb>({ path: '...'  OR  router.versioned.<verb>({ path: '...'
ROUTE_PATTERN = re.compile(
    r"\brouter(?:\.versioned)?\.(get|post|put|delete|patch)\s*\(\s*\{[^}]*?\bpath\s*:\s*[\"'`]([^\"'`]+)[\"'`]",
    re.DOTALL,
)


def collect_routes() -> list[tuple[str, str, str]]:
    """Return [(verb, path, file)] for every router registration found."""
    out = subprocess.run(
        ["git", "ls-files", "*.ts", "*.tsx"], cwd=KIBANA,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    files = [f for f in out.stdout.splitlines() if f]
    routes: list[tuple[str, str, str]] = []
    for rel in files:
        try:
            text = (KIBANA / rel).read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        for m in ROUTE_PATTERN.finditer(text):
            verb = m.group(1).upper()
            path = m.group(2).strip()
            routes.append((verb, path, rel))
    return routes


def main() -> int:
    print("Scanning Kibana TS files for router.<verb>({ path: ... }) calls …")
    routes = collect_routes()
    print(f"  raw matches: {len(routes)}")

    unique = {(v, p) for v, p, _ in routes}
    print(f"  unique (verb, path): {len(unique)}")

    # Buckets: public /api, internal /internal, other
    api = sorted((v, p) for v, p in unique if p.startswith("/api/"))
    internal = sorted((v, p) for v, p in unique if p.startswith("/internal/"))
    other = sorted((v, p) for v, p in unique if not p.startswith(("/api/", "/internal/")))
    print(f"  /api/...      = {len(api)}")
    print(f"  /internal/... = {len(internal)}")
    print(f"  other         = {len(other)}")

    # Compare to canonical OpenAPI
    print("\nLoading OpenAPI canonical ...")
    canonical = get_openapi_endpoints(str(KIBANA))
    canonical_set = {(e["operation"].upper(), e["path"]) for e in canonical}
    print(f"  canonical (kibana.yaml): {len(canonical_set)}")

    # All canonical paths start with /api or /s in kibana
    grep_set = unique
    overlap = grep_set & canonical_set
    print(f"\nOverlap (grep ∩ canonical):  {len(overlap)}  "
          f"({100*len(overlap)/len(canonical_set):.1f}% of canonical found by grep)")
    print(f"Canonical only (grep missed): {len(canonical_set - grep_set)}")
    print(f"Grep only (not in canonical): {len(grep_set - canonical_set)}")

    # Show samples of grep-only that look real
    print("\n  Sample grep-only paths:")
    for v, p in sorted(grep_set - canonical_set)[:8]:
        print(f"    {v:6} {p}")

    print("\n  Sample canonical-only (grep missed):")
    for v, p in sorted(canonical_set - grep_set)[:8]:
        print(f"    {v:6} {p}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
