# api-exception

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/api/APIException.java
- **Category**: pure negative example (RuntimeException subclass)

## Why this fixture

A pure negative example: `APIException extends RuntimeException`. It is not an entity, not a service, not a controller — just an exception type. The deterministic pack correctly ignores it (0 candidates). This fixture's job is to guard against a future prompt or detector change that starts misclassifying exception subclasses as entities or business logic.

## Notes

Both `physical_entity::APIException` and `business_logic::APIException` are listed in `shouldNotEmit` so the hallucination-rate metric flags any regression. No positive `expected` entries.
