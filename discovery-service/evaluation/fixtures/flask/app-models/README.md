# app-models

- **Source**: https://github.com/miguelgrinberg/microblog @ a975ef64864354867c88e0ed3a17ba7d17dca752
- **License**: MIT
- **Original upstream path**: app/models.py
- **Category**: happy path (SQLAlchemy ORM models + mixin)

## Why this fixture

Canonical Flask + SQLAlchemy persistence file from the Flask
Mega-Tutorial microblog. Exercises `db.Model` inheritance, declarative
`db.Column(...)` attributes, `db.relationship(...)` associations
(followers, posts, messages), plus the `SearchableMixin`
cross-cutting base used to wire up Elasticsearch indexing. 17
candidates emitted.

## Notes

- Potential LLM gap-fill targets: the file includes `UserMixin` from
  Flask-Login (auth integration), `ua_parsers`-style helpers, JWT
  password-reset token logic, and Elasticsearch `reindex` methods —
  all business logic the pure-SQLAlchemy adapter does not surface.
