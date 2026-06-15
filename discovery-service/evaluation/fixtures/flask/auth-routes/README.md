# auth-routes

- **Source**: https://github.com/miguelgrinberg/microblog @ a975ef64864354867c88e0ed3a17ba7d17dca752
- **License**: MIT
- **Original upstream path**: app/auth/routes.py
- **Category**: happy path (auth blueprint: login / logout / register / reset)

## Why this fixture

Flask blueprint carrying the full authentication flow —
login / logout / register / reset_password_request / reset_password —
all via `@bp.route` decorators. 5 endpoint candidates emitted.

## Notes

- Potential LLM gap-fill targets: the Flask-Login `login_user` /
  `logout_user` call sites, `current_user.is_authenticated` checks,
  token-based reset (`User.verify_reset_password_token`) all encode
  authz architecture the deterministic route adapter does not surface.
