# app-email

- **Source**: https://github.com/miguelgrinberg/microblog @ a975ef64864354867c88e0ed3a17ba7d17dca752
- **License**: MIT
- **Original upstream path**: app/email.py
- **Category**: edge case — pure helper module (no routes, models, schemas)

## Why this fixture

A minimal Flask-Mail helper that defines a single `send_async_email`
Celery-like task plus a `send_email` convenience wrapper. The file
contains no `@app.route` / `@bp.route` decorators, no `db.Model`
subclasses, and no Marshmallow / WTForms classes — so the
deterministic adapter correctly emits zero candidates. Validates the
"correctly emit nothing" path for a module that's purely an
outbound-integration helper.

## Notes

- `expected: []` — no candidates from the deterministic adapter.
- Potential LLM gap-fill target: detect Flask-Mail setup / outbound
  email integration as a distinct architectural element (see
  `prompts/frameworks/flask.md` "Flask-Mail / email-sending
  integrations" bullet).
