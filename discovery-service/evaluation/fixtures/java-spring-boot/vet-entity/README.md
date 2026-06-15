# vet-entity

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/vet/Vet.java
- **Category**: happy path (`@Entity` with `@ManyToMany` + `@JoinTable`)

## Why this fixture

Exercises the `@ManyToMany` cardinality path plus the less-common case of
a relationship using `@JoinTable` metadata. The `specialties` field is a
`Set<Specialty>` — generic-argument parsing must extract `Specialty` as
the target entity name, not `Set`.

## Notes

- 1 physical_entity + 1 entity_relationship.
- No scalar physical_attributes in this single-file view. First / last
  name are inherited from Vet's `Person` `@MappedSuperclass` ancestor and
  are surfaced via the per-codebase inheritance walk in a full run, not
  the single-file fixture.
