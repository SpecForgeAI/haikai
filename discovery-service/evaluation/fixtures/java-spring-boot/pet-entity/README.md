# pet-entity

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/owner/Pet.java
- **Category**: happy path (`@Entity` with two distinct relationship cardinalities)

## Why this fixture

Exercises the adapter's ability to emit multiple relationships from a single
entity: `Pet → PetType` (`@ManyToOne`) and `Pet → Visit` (`@OneToMany`).
Also verifies that a single scalar field (`birthDate` annotated
`@Column(name = "birth_date")`) coexists with relationship fields without
being miscategorised.

## Notes

- 1 physical_entity + 1 physical_attribute + 2 entity_relationships.
- `name` is inherited from `NamedEntity` (`@MappedSuperclass`). Inherited-
  field traversal is a whole-codebase behaviour — NOT expected to fire
  in a single-file fixture (the parent class is not in scope). Covered
  separately by `springBootAdapter.smoke.test.ts`.
