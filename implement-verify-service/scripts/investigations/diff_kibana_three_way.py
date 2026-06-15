#!/usr/bin/env python3
"""Three-way diff: V1 vs V2 vs OpenAPI canonical for kibana."""
import json
import sys
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.dep.openapi import get_openapi_endpoints

V1_FILE = "C:/Users/ozzie/AppData/Local/Temp/benchmark_results/kibana/20260426_134530/run_01/claude_endpoints.json"
V2_FILE = "D:/Work/Gary/standards-extractor/temp/v2_50_results/endpoints_kibana.json"
KIBANA = "C:/Users/ozzie/AppData/Local/Temp/kibana"


def normalize_path(p: str) -> str:
    """Lowercase + strip query/anchor + normalize trailing slash."""
    p = p.strip()
    if "?" in p: p = p.split("?")[0]
    if "#" in p: p = p.split("#")[0]
    if len(p) > 1 and p.endswith("/"): p = p[:-1]
    return p.lower()


def normalize_op(op: str) -> str:
    return (op or "").upper().strip()


def load_v1() -> list[tuple[str, str]]:
    data = json.loads(Path(V1_FILE).read_text(encoding="utf-8-sig"))
    return [(normalize_op(e["operation"]), normalize_path(e["path"])) for e in data]


def load_v2() -> list[tuple[str, str]]:
    data = json.loads(Path(V2_FILE).read_text(encoding="utf-8"))
    return [(normalize_op(e["operation"]), normalize_path(e["path"])) for e in data]


def load_openapi() -> list[tuple[str, str]]:
    eps = get_openapi_endpoints(KIBANA)
    return [(normalize_op(e["operation"]), normalize_path(e["path"])) for e in eps]


print("Loading V1...")
v1 = load_v1()
print(f"  {len(v1)} entries, {len(set(v1))} unique\n")

print("Loading V2...")
v2 = load_v2()
print(f"  {len(v2)} entries, {len(set(v2))} unique\n")

print("Loading OpenAPI canonical...")
oa = load_openapi()
print(f"  {len(oa)} entries, {len(set(oa))} unique\n")

V1, V2, OA = set(v1), set(v2), set(oa)

def pct(num, denom): return f"{100*num/denom:.1f}%" if denom else "—"

print("=" * 80)
print("THREE-WAY OVERLAP")
print("=" * 80)
print(f"V1 ^ V2 ^ OA  = {len(V1 & V2 & OA):>5}")
print(f"V1 ^ V2 only  = {len(V1 & V2 - OA):>5}")
print(f"V1 ^ OA only  = {len(V1 & OA - V2):>5}")
print(f"V2 ^ OA only  = {len(V2 & OA - V1):>5}")
print(f"V1 only       = {len(V1 - V2 - OA):>5}")
print(f"V2 only       = {len(V2 - V1 - OA):>5}")
print(f"OA only       = {len(OA - V1 - V2):>5}  (truth missed by both)")
print()

print("=" * 80)
print("RECALL vs OPENAPI CANONICAL (truth)")
print("=" * 80)
print(f"V1 recall: {len(V1 & OA):>4}/{len(OA)} = {pct(len(V1 & OA), len(OA))}")
print(f"V2 recall: {len(V2 & OA):>4}/{len(OA)} = {pct(len(V2 & OA), len(OA))}")
print()

print("=" * 80)
print("PRECISION vs OPENAPI CANONICAL")
print("=" * 80)
print(f"V1 precision: {len(V1 & OA):>4}/{len(V1)} unique = {pct(len(V1 & OA), len(V1))}")
print(f"V2 precision: {len(V2 & OA):>4}/{len(V2)} unique = {pct(len(V2 & OA), len(V2))}")
print()

print("=" * 80)
print("F1 score")
print("=" * 80)
def f1(found, truth):
    p = len(found & truth) / len(found) if found else 0
    r = len(found & truth) / len(truth) if truth else 0
    return 2 * p * r / (p + r) if (p + r) else 0
print(f"V1 F1: {f1(V1, OA):.3f}")
print(f"V2 F1: {f1(V2, OA):.3f}")
print()

print("=" * 80)
print("V1 over-extraction examples (in V1 but not in canonical)")
print("=" * 80)
for op, p in sorted(V1 - OA)[:8]:
    print(f"  {op:6} {p}")
print()

print("=" * 80)
print("V2 over-extraction examples (in V2 but not in canonical)")
print("=" * 80)
for op, p in sorted(V2 - OA)[:8]:
    print(f"  {op:6} {p}")
print()

print("=" * 80)
print("OpenAPI truth missed by BOTH V1 and V2 (samples)")
print("=" * 80)
missed = sorted(OA - V1 - V2)
for op, p in missed[:10]:
    print(f"  {op:6} {p}")
print(f"  ...{len(missed)} total")
print()

print("=" * 80)
print("PATH PREFIX DISTRIBUTION")
print("=" * 80)
def top_prefix(paths, n=10):
    prefixes = [p.split("/")[1] if p.startswith("/") and "/" in p[1:] else p[:20] for _, p in paths]
    return Counter(prefixes).most_common(n)
print("V1 top path roots:")
for prefix, n in top_prefix(V1):
    print(f"  /{prefix:30} {n}")
print()
print("V2 top path roots:")
for prefix, n in top_prefix(V2):
    print(f"  /{prefix:30} {n}")
print()
print("OpenAPI top path roots:")
for prefix, n in top_prefix(OA):
    print(f"  /{prefix:30} {n}")
