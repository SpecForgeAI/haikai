# visit-entity

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/owner/Visit.java
- **Category**: happy path (`@Entity` with a `@Column`-renamed date + Bean Validation-only description)

## Why this fixture

Exercises two scalar-attribute paths:
  - `date` is a `LocalDate` annotated `@Column(name = "visit_date")` +
    `@DateTimeFormat` — tests column-name override.
  - `description` is a `String` annotated only with `@NotBlank` (no
    `@Column`) — tests that validation-only-annotated fields still emit
    as physical_attribute with the field name as the column name.

## Notes

- 1 physical_entity + 2 physical_attribute.
- The entity extends BaseEntity (`@MappedSuperclass`), so `id` is inherited
  in a whole-codebase run but not in this single-file fixture.
