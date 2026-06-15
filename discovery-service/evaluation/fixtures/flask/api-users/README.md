# api-users

- **Source**: https://github.com/miguelgrinberg/microblog @ a975ef64864354867c88e0ed3a17ba7d17dca752
- **License**: MIT
- **Original upstream path**: app/api/users.py
- **Category**: happy path (JSON REST-style blueprint endpoints)

## Why this fixture

Flask API blueprint with GET / POST / PUT handlers for users
(`/users/<id>`, `/users`, `/users/<id>/followers`, `/users/<id>/
following`). Exercises the blueprint-style route detection with
`@bp.route` + `@token_auth.login_required`. 6 candidates emitted.

## Notes

- Potential LLM gap-fill targets: the `@token_auth.login_required`
  decorator (Flask-HTTPAuth) is an authz integration the adapter
  does not surface; the `request.get_json()` payload shape is an
  implicit DTO the adapter ignores; the responses are constructed
  via `User.to_dict()` serialization which could be surfaced as
  logical entities.
