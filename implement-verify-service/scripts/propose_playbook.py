#!/usr/bin/env python3
"""CLI for the Phase 11 playbook writer.

Usage:
  python scripts/propose_playbook.py <repo_path> [--model gpt-5.4-mini]

Writes a proposal to playbooks/proposed/<name>.yaml. Human reviews and
moves to playbooks/frameworks/<name>.yaml when ready.
"""
import argparse
import os
import sys
from pathlib import Path

os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")

sys.path.insert(0, str(Path(__file__).parent.parent))

from src.ast.v2.playbook_writer import propose
from src.llm_client import LLMClient


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo", help="Path to the codebase to inspect")
    ap.add_argument("--model", default=os.environ.get("MODEL", "gpt-5.4-mini"))
    ap.add_argument("--provider", default=os.environ.get("PROVIDER", "openai"))
    args = ap.parse_args()

    if args.provider == "openai":
        llm = LLMClient(provider="openai", model=args.model)
    elif args.provider == "custom":
        llm = LLMClient(provider="custom", model=args.model,
                        base_url=os.environ.get("PROXY_URL", "http://localhost:3456/v1"))
    else:
        llm = LLMClient(provider=args.provider, model=args.model)

    result = propose(args.repo, llm)
    for n in result.notes:
        print(f"  {n}")
    if result.error:
        print(f"\nERROR: {result.error}")
        if result.playbook:
            print(f"(partial playbook captured: name={result.playbook.get('name')!r})")
        sys.exit(1)
    print(f"\nProposed playbook: {result.proposed_yaml_path}")
    print(f"Name: {result.playbook.get('name')}")
    print(f"Language: {result.playbook.get('language')}")
    print(f"Extract steps: {len(result.playbook.get('extract', []))}")


if __name__ == "__main__":
    main()
