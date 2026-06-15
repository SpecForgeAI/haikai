# account-models

- **Source**: https://github.com/saleor/saleor @ b40f4635e155ecfe07bd914dad53f1cd304c4c5d
- **License**: BSD-3-Clause
- **Original upstream path**: saleor/account/models.py
- **Category**: happy path (core authentication + address models)

## Why this fixture

Canonical Django ORM file. Exercises the adapter's full persistence
path: multiple `models.Model` subclasses (Address, User, CustomerNote,
CustomerEvent, StaffNotificationRecipient, Group), `models.*Field()`
column assignments including `CharField`, `EmailField`, `DateTimeField`,
`BooleanField`, `JSONField`, plus `ForeignKey` / `ManyToManyField`
relationships and a `OneToOneField` to the address. 22 candidates
emitted: 4 physical entities, 10 physical attributes, 8 entity
relationships. High-value positive-recall fixture.

## Notes

- Potential LLM gap-fill targets the adapter does NOT see: custom
  `UserManager` (custom manager), Django's `AbstractBaseUser` +
  `PermissionsMixin` inheritance chain, `Meta.permissions`
  tuples, `@cached_property` helpers. See `prompts/frameworks/django.md`.
