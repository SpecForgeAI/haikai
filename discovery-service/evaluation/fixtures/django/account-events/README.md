# account-events

- **Source**: https://github.com/saleor/saleor @ b40f4635e155ecfe07bd914dad53f1cd304c4c5d
- **License**: BSD-3-Clause
- **Original upstream path**: saleor/account/events.py
- **Category**: edge case — domain-event helper module

## Why this fixture

A module full of `customer_account_*_event(...)` helper functions
that each insert a CustomerEvent row. The file is under
`saleor/account/events.py`, NOT under `services.py` / `utils.py` /
`services/` / `domain/` — so the deterministic adapter's
business-logic heuristic (which gates on the enclosing
directory / filename) correctly emits zero candidates. Captures the
"structured domain events" pattern that's real business logic the
pack does not surface with today's rules.

## Notes

- `expected: []` — no candidates from the deterministic adapter.
- Potential LLM gap-fill target: classify any module whose functions
  share a consistent business-event naming convention as a
  business-logic / domain-event surface, even when the file lives
  outside the `services.py` convention.
