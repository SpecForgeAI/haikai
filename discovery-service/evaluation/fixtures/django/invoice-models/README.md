# invoice-models

- **Source**: https://github.com/saleor/saleor @ b40f4635e155ecfe07bd914dad53f1cd304c4c5d
- **License**: BSD-3-Clause
- **Original upstream path**: saleor/invoice/models.py
- **Category**: happy path (invoice persistence with job inheritance)

## Why this fixture

Single-model file where `Invoice` extends `Job` (cross-file base);
exercises `JSONField`, `FileField`, plus multiple `ForeignKey`
relationships to Order / App / User. 8 candidates emitted (1
entity, 3 attributes, 4 relationships).
