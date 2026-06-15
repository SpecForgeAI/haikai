# allergy-reaction

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/AllergyReaction.java
- **Category**: happy path

## Why this fixture

Classic small JPA entity with 3 concerns exercised together: `@Entity` + `@Table` + `@Id` primary key, two `@ManyToOne` relationships (to `Allergy` and `Concept`), and a free-text `@Column`. Pack should have full recall here; any miss indicates a detector regression on the Jakarta-Persistence entity-detection path.

## Notes

No gap-fill items expected — all five candidates are pack-reachable via Jakarta Persistence annotations. No `shouldNotEmit` entries — the entity has no method calls the pack would misclassify as business logic.
