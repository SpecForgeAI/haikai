# visit

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/Visit.java
- **Category**: happy path + gap-fill opportunity

## Why this fixture

Rich JPA entity with five `@ManyToOne` relationships and one `@OneToMany` (`Visit → Encounter`). Pack should surface all nine structural candidates. The fixture also includes one `'gap-fill'` expected entry (`addEncounter`) — a real business-logic method the deterministic pack misses but which an LLM reading the Javadoc and method body should recover.

## Notes

Exercises the `Visit` aggregation pattern central to the OpenMRS domain. The `'gap-fill'` entry gives the gap-fill-recall metric something meaningful to measure once LLM fixtures are recorded. Demonstrates how a happy-path entity can still have pack-unreachable method-level candidates.
