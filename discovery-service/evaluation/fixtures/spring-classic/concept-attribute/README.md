# concept-attribute

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/ConceptAttribute.java
- **Category**: edge case (generic-parameter @AssociationOverride)

## Why this fixture

Small entity that inherits its owner relationship from a generic `BaseAttribute<ConceptAttributeType, Concept>` supertype. The `Concept` relationship is only visible via `@AssociationOverride(name = "owner", ...)` — the pack's relationship detector inspects direct `@ManyToOne` / `@OneToMany` annotations and misses the generic-parameter form. Pack recall here is 2/3 at best; gap-fill is responsible for recovering the `ConceptAttribute → Concept` relationship.

## Notes

Exercises the "inherited-via-generics" blind spot. Small enough to be fast (61 lines) but substantive enough to demonstrate a real pack limitation that gap-fill should address.
