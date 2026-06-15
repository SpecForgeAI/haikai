# pet-type-repository

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/owner/PetTypeRepository.java
- **Category**: blind spot (second Spring Data repository variant — pack emits nothing)

## Why this fixture

Second Spring Data repository fixture, kept separate from owner-repository
because the file contains a single custom finder method without `@Query`
— a different shape than owner-repository's plain-extend-interface pattern.
Confirms the zero-emit behaviour across both repository variants.

## Notes

- 0 pack candidates. Negative example — same gap-fill target as
  owner-repository.
- Useful as a second zero-emit data point for the per-pack 98% gate: if
  the adapter starts emitting repository candidates in a future change,
  BOTH fixtures would flip together, making the regression hard to miss.
