# main-routes

- **Source**: https://github.com/miguelgrinberg/microblog @ a975ef64864354867c88e0ed3a17ba7d17dca752
- **License**: MIT
- **Original upstream path**: app/main/routes.py
- **Category**: happy path (blueprint route handlers)

## Why this fixture

Canonical Flask blueprint with a dozen-ish `@bp.route` /
`@bp.before_request` / `@login_required`-decorated handlers covering
the HTTP surface of the microblog's main page, profile edit, follow,
and search actions. 13 candidates emitted.

## Notes

- Potential LLM gap-fill targets: `@bp.before_request` is invisible
  to the route-focused adapter; `@login_required` on each handler is
  authz wiring the adapter does not surface; language-switch locale
  logic is a cross-cutting concern. See
  `prompts/frameworks/flask.md`.
