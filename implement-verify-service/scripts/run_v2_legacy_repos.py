#!/usr/bin/env python3
"""Run V2 discovery on a curated set of LEGACY repos using sonnet.

Mirrors `run_v2_50_repos.py` exactly — reuses its `_run_one_subprocess`,
the same env knobs (FALLBACK_MODEL=claude-sonnet-4-6 by default), and
the same per-repo row schema. Writes rows into `temp/v2_50_results/`
(so they're indistinguishable from the canonical 50) plus a combined
`temp/v2_legacy_results/all_<TS>.json` and `LEGACY_SUMMARY.md`.
"""
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.run_v2_50_repos import _run_one_subprocess, RESULTS_DIR

# (repo_name, extensions) — legacy/older codebases NOT in the 50-set.
# Each cron firing rotates this list to a fresh 5; prior runs:
#   2026-04-25 19:54: trac, roundcubemail, dokuwiki, silverstripe-framework, diaspora
#   2026-04-25 21:00: moin, typo3, chamilo-lms, publify, fat_free_crm
#   2026-04-25 23:08: ckan, horde-base, onebody, etherpad-lite, ofbiz-framework
#   2026-04-26 00:54: bottle, e107, errbit, gogs, jspwiki
#   2026-04-26 03:15: web2py, dotclear, huginn, drone, roller
#   2026-04-26 04:53: pyramid, textpattern, gollum, caddy, wicket
#   2026-04-26 06:53: zope, getsimple, chiliproject, revel, struts
LEGACY_REPOS = [
    ("cherrypy",   (".py",)),
    ("gitlist",    (".php",)),
    ("ruby-china", (".rb",)),
    ("beego",      (".go",)),
    ("archiva",    (".java",)),
]

LEGACY_RESULTS_DIR = Path(__file__).parent.parent / "temp" / "v2_legacy_results"
LEGACY_RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def main():
    rows: list[dict] = []
    print(f"Running V2 (sonnet) on {len(LEGACY_REPOS)} legacy repos sequentially")
    print(f"Rows in:    {RESULTS_DIR}")
    print(f"Combined:   {LEGACY_RESULTS_DIR}\n")

    for i, (name, exts) in enumerate(LEGACY_REPOS, 1):
        print(f"[{i:2d}/{len(LEGACY_REPOS)}] {name:24s} ", end="", flush=True)
        t0 = time.time()
        r = _run_one_subprocess(name, exts)
        # No v1_sonnet / real_grep baseline for new legacy entries.
        r["v1_sonnet"] = None
        r["real_grep"] = None
        elapsed = time.time() - t0
        if "error" in r:
            print(f"ERROR ({elapsed:.0f}s): {r['error']}")
        else:
            print(f"{r.get('endpoints', 0):>5} ep ({r.get('unique', 0):>4} unique) | "
                  f"frameworks={r.get('frameworks', [])} | {elapsed:.0f}s")
        rows.append(r)
        # Save row immediately
        with open(RESULTS_DIR / f"row_{name}.json", "w", encoding="utf-8") as f:
            json.dump(r, f, indent=2)

    ts = time.strftime("%Y%m%d_%H%M%S")
    combined = LEGACY_RESULTS_DIR / f"all_{ts}.json"
    with open(combined, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=2)
    print(f"\nWrote: {combined}")

    # Box-drawing table — same column shape as the 50-repo runner.
    print("\n" + "=" * 110)
    print(f"{'#':>3} {'Repo':<24} {'V2':>6} {'V1 Sonnet':>10} {'Real Grep':>10} {'Diff vs grep':>13} {'Frameworks':<25}")
    print("-" * 110)
    for i, r in enumerate(rows, 1):
        ep = r.get("endpoints", 0)
        v1 = r.get("v1_sonnet")
        grep = r.get("real_grep")
        delta = (ep - grep) if grep is not None else None
        delta_str = f"{delta:+d}" if delta is not None else "—"
        v1_str = f"{v1}" if v1 is not None else "—"
        grep_str = f"{grep}" if grep is not None else "—"
        fw = ",".join(r.get("frameworks", [])) or "(none)"
        print(f"{i:>3} {r['name']:<24} {ep:>6} {v1_str:>10} "
              f"{grep_str:>10} {delta_str:>10} {fw:<25}")
    print("=" * 110)

    # Append a dated section to LEGACY_SUMMARY.md (3-cause format per convention).
    summary = LEGACY_RESULTS_DIR / "LEGACY_SUMMARY.md"
    with open(summary, "a", encoding="utf-8") as f:
        f.write(f"\n\n## Run {ts}\n\n")
        f.write("Model: claude-sonnet-4-6 (fallback)\n\n")
        f.write("| # | Repo | V2 endpoints | Unique | Frameworks | Used LLM | Runtime |\n")
        f.write("|---|------|-------------:|-------:|------------|----------|--------:|\n")
        for i, r in enumerate(rows, 1):
            ep = r.get("endpoints", 0)
            uq = r.get("unique", 0)
            fw = ",".join(r.get("frameworks", [])) or "(none)"
            llm = "yes" if r.get("used_llm_fallback") else "no"
            t = r.get("t_disc", 0) or 0
            err = r.get("error", "")
            if err:
                f.write(f"| {i} | {r['name']} | — | — | — | — | ERROR: {err} |\n")
            else:
                f.write(f"| {i} | {r['name']} | {ep} | {uq} | {fw} | {llm} | {t}s |\n")

    print(f"\nAppended summary to: {summary}")


if __name__ == "__main__":
    main()
