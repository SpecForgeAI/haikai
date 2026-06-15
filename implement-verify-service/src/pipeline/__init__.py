"""Pipeline orchestration — deterministic checks + tools around the batch extractor.

Design: haikai/specs/2026-06-09-pipeline-orchestration/ (D1-D13).
The AST index here IS the existing structural store snapshot (D9);
checks follow the stdin=json / stdout=json / exit-code=verdict contract.
"""
