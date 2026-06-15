# encounter-provider

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/EncounterProvider.java
- **Category**: happy path + tier-ambiguous business-logic detection

## Why this fixture

Join-entity pattern (`Encounter` × `Provider` × `EncounterRole`) that exercises three `@ManyToOne` relationships on a single entity. Also includes a `copy()` method that the pack classifies as `business_logic`; this is arguable ground truth — the LLM gap-fill stage could legitimately reclassify it as a shallow clone rather than domain logic. The `'either'` tag on that entry credits whichever tier surfaces it.

## Notes

Good for exercising the pack's method-detection heuristic: the pack emits `copy` as `business_logic`; a smarter gap-fill classifier might correctly label it as plumbing. Demonstrates how the `'either'` tier tag handles overlap between pack output and gap-fill classification. No `shouldNotEmit` entries — the entity is well-behaved.
