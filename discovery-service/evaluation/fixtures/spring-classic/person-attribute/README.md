# person-attribute

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/PersonAttribute.java
- **Category**: happy path + gap-fill + negative example

## Why this fixture

Typed key-value attribute entity with two gap-fill expectations AND the spec-mandated negative-example coverage. The pack correctly emits the structural candidates (entity, PK, two relationships, the `value` column). Two domain methods (`equalsContent` — content-based equality, `getHydratedObject` — lazy hydration of the stringified value) are legitimate business logic the pack misses — both tagged `'gap-fill'`. The `shouldNotEmit` block lists two framework plumbing methods (`toString`, `hashCode`) that must never be classified as business logic.

## Notes

This fixture is the spec's mandated negative-example carrier for the framework: any candidate matching the `shouldNotEmit` entries counts as a hallucination and drags down the hallucination-rate metric. Exercises all five metrics meaningfully.
