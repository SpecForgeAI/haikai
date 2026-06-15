# account-signals

- **Source**: https://github.com/saleor/saleor @ b40f4635e155ecfe07bd914dad53f1cd304c4c5d
- **License**: BSD-3-Clause
- **Original upstream path**: saleor/account/signals.py
- **Category**: edge case — signals wire-up module

## Why this fixture

Tiny (6-line) signals registration helper. Canonical Django "signals"
pattern: a module-level receiver function connected up in `apps.py`
`ready()`. The deterministic pack correctly emits zero candidates on
this file — the receiver is not `@receiver`-decorated inline (that's
done elsewhere), and the bare helper function does not match the
adapter's services/utils heuristic. This is a negative-recall
correctness check.

## Notes

- `expected: []` — no candidates from the deterministic adapter.
- Potential LLM gap-fill target: signal handler / event-driven
  wire-up discovery (see `prompts/frameworks/django.md` "Django
  signals and `@receiver` handlers" bullet).
