# schedulers-models

- **Source**: https://github.com/saleor/saleor @ b40f4635e155ecfe07bd914dad53f1cd304c4c5d
- **License**: BSD-3-Clause
- **Original upstream path**: saleor/schedulers/models.py
- **Category**: edge case — minimal single-entity module

## Why this fixture

Tiny module carrying a single `CustomSchedule` model. 2 candidates
emitted (1 entity + 1 attribute). Anchors a "smallest
non-zero fixture" case alongside the larger real-world models.

## Notes

- Potential LLM gap-fill target: the `schedulers` module implies a
  Celery-beat-like schedule registry — the module docstring /
  surrounding code likely configures periodic tasks, which are a
  separate runtime surface.
