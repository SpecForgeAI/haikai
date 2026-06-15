# core-models

- **Source**: https://github.com/saleor/saleor @ b40f4635e155ecfe07bd914dad53f1cd304c4c5d
- **License**: BSD-3-Clause
- **Original upstream path**: saleor/core/models.py
- **Category**: happy path (base models + event delivery infrastructure)

## Why this fixture

Saleor's core module — contains the `SortableModel`,
`PublishableModel`, `ModelWithMetadata`, `ModelWithExternalReference`
abstract base classes plus the `Job`, `EventPayload`,
`EventDelivery`, `EventDeliveryAttempt` concrete entities used to
implement the webhook / event-delivery subsystem. 35 candidates
emitted (8 entities, 24 attributes, 3 relationships). Highest-emission
django fixture — exercises the full adapter surface for declared-base
inheritance plus a concrete event-delivery data model.

## Notes

- Potential LLM gap-fill targets: the base classes (ModelWithMetadata,
  PublishableModel, SortableModel) are emitted as physical_entity
  today, but they are architecturally base classes — the LLM layer
  could re-tag them or emit them as "base model" metadata on their
  descendants elsewhere in the codebase.
