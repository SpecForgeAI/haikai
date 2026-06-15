# allergen-type

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/AllergenType.java
- **Category**: edge case (enum — small POJO without @Entity)

## Why this fixture

Tiny enum (4 constants, 17 lines). Enums are value types, not entities. The pack correctly emits zero candidates. The `shouldNotEmit` entry guards against a future detector change that starts misclassifying enums as physical entities — a subtle bug that would bloat a real discovery run.

## Notes

Smallest fixture in the set. Runs in milliseconds. Its value is negative-example coverage, not positive recall.
