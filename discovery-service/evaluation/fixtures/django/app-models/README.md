# app-models

- **Source**: https://github.com/saleor/saleor @ b40f4635e155ecfe07bd914dad53f1cd304c4c5d
- **License**: BSD-3-Clause
- **Original upstream path**: saleor/app/models.py
- **Category**: happy path (OAuth app registration + token models)

## Why this fixture

Saleor's App / AppInstallation / AppToken / AppExtension entities
cover the OAuth-app integration surface — a rich mix of
`CharField`, `URLField`, `JSONField`, `TextField`, and relational
wiring (ForeignKey to Group + Permission, ManyToManyField through
permissions). 25 candidates emitted (3 entities, 17 attributes, 5
relationships).
