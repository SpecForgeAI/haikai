"""
One-off helper to mechanically fix UUID/String and constructor signature
drift in AMS test files. Used during the 2026-05-19 test-compile-rot fix.
Run from architecture-model-service/.
"""
from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).parent


def patch(path: str, replacements: list[tuple[str, str]]) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    original = text
    for old, new in replacements:
        if old not in text:
            print(f"  WARN: pattern not found in {path}: {old[:60]!r}")
        text = text.replace(old, new)
    if text != original:
        p.write_text(text, encoding="utf-8")
        print(f"  patched {path}")
    else:
        print(f"  no change {path}")


def patch_regex(path: str, replacements: list[tuple[str, str]]) -> None:
    p = ROOT / path
    text = p.read_text(encoding="utf-8")
    original = text
    for pattern, repl in replacements:
        new_text, n = re.subn(pattern, repl, text)
        text = new_text
        print(f"  {path}: pattern {pattern[:60]!r} -> {n} hits")
    if text != original:
        p.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    print("Run individual functions or import.")
