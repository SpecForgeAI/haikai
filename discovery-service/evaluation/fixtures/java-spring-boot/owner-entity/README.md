# owner-entity

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/owner/Owner.java
- **Category**: happy path (`@Entity` with `@MappedSuperclass` inheritance + `@OneToMany` relationship)

## Why this fixture

Exercises the adapter's JPA `@Entity` detection, `@Column`-derived physical
attributes, and `@OneToMany` entity-relationship emission. Owner extends
the `Person` `@MappedSuperclass`. In a full-codebase run the inheritance
walk surfaces `firstName` / `lastName` from Person and `id` from
BaseEntity — but this is a single-file fixture, so the adapter only sees
the directly-declared fields (`address`, `city`, `telephone`). Inherited-
field traversal is covered separately in `springBootAdapter.smoke.test.ts`.

## Notes

- 1 physical_entity + 3 physical_attribute + 1 entity_relationship.
- Fields carrying only `@NotBlank` / `@Digits` (Bean Validation) annotations
  are correctly emitted as attributes — the adapter no longer requires
  `@Column` / `@Id`.
- The `pets` field annotated `@OneToMany` becomes the `Owner → Pet`
  relationship and is deliberately NOT also emitted as a physical_attribute.
