#!/usr/bin/env python3
"""Review proposed playbooks staged by Phase 11.

Lists everything in playbooks/proposed/. For a chosen proposal, prints the
YAML, validates it against the schema, and lets the human PROMOTE (move to
playbooks/frameworks/) or REJECT (delete).

Usage:
  python scripts/review_playbook.py             # list proposals
  python scripts/review_playbook.py <name>      # show one
  python scripts/review_playbook.py <name> --promote
  python scripts/review_playbook.py <name> --reject
"""
import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
PROPOSED = ROOT / "playbooks" / "proposed"
FRAMEWORKS = ROOT / "playbooks" / "frameworks"

sys.path.insert(0, str(ROOT))


def list_proposals():
    if not PROPOSED.exists():
        print(f"(no proposals dir at {PROPOSED})")
        return
    proposals = sorted(PROPOSED.glob("*.yaml"))
    if not proposals:
        print("(no proposed playbooks)")
        return
    print(f"{len(proposals)} proposal(s) staged in {PROPOSED}:\n")
    for p in proposals:
        existing = (FRAMEWORKS / p.name).exists()
        marker = "  (would overwrite existing)" if existing else ""
        print(f"  - {p.stem}{marker}")
    print(f"\nReview a proposal: python scripts/review_playbook.py <name>")


def show(name: str):
    src = PROPOSED / f"{name}.yaml"
    if not src.exists():
        print(f"No proposal at {src}")
        return False

    print(f"--- {src} ---")
    print(src.read_text(encoding="utf-8"))
    print(f"--- end ---")

    # Schema-validate
    import yaml as _yaml
    from src.ast.v2.playbook_schema import validate_playbook
    try:
        data = _yaml.safe_load(src.read_text(encoding="utf-8"))
        _, errors = validate_playbook(data or {})
    except Exception as e:
        print(f"\nSCHEMA: PARSE ERROR — {e}")
        return False
    if errors:
        print(f"\nSCHEMA: INVALID")
        for e in errors:
            print(f"  - {e}")
        return False
    print(f"\nSCHEMA: ok")

    target = FRAMEWORKS / f"{name}.yaml"
    if target.exists():
        print(f"\nNote: {target.relative_to(ROOT)} already exists; --promote will overwrite.")
    return True


def promote(name: str):
    src = PROPOSED / f"{name}.yaml"
    if not src.exists():
        print(f"No proposal at {src}")
        return 1
    if not show(name):
        print("\nRefusing to promote: schema validation failed.")
        return 1
    target = FRAMEWORKS / f"{name}.yaml"
    target.write_text(src.read_text(encoding="utf-8"), encoding="utf-8")
    src.unlink()
    print(f"\nPromoted: proposed/{name}.yaml → frameworks/{name}.yaml")
    return 0


def reject(name: str):
    src = PROPOSED / f"{name}.yaml"
    if not src.exists():
        print(f"No proposal at {src}")
        return 1
    src.unlink()
    print(f"Rejected: deleted {src.relative_to(ROOT)}")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name", nargs="?", help="proposal name (filename without .yaml)")
    ap.add_argument("--promote", action="store_true", help="move proposal into frameworks/")
    ap.add_argument("--reject",  action="store_true", help="delete the proposal")
    args = ap.parse_args()

    if not args.name:
        list_proposals()
        return 0

    if args.promote and args.reject:
        print("Pick one of --promote or --reject")
        return 1
    if args.promote:
        return promote(args.name)
    if args.reject:
        return reject(args.name)
    show(args.name)
    return 0


if __name__ == "__main__":
    sys.exit(main())
