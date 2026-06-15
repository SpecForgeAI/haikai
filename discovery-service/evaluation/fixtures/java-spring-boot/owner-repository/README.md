# owner-repository

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/owner/OwnerRepository.java
- **Category**: blind spot (Spring Data repository interface — pack emits nothing)

## Why this fixture

Spring Data `Repository` interfaces are not emitted by the spring-boot
adapter in its Chunk 1 form. They lack `@Controller` / `@Service` /
`@Component` / `@Entity` stereotypes, and `@Repository` on an interface
is not in the adapter's extraction set. This fixture locks in the current
(deliberate) zero-emit behaviour and flags the gap as a target for the
framework prompt's "Misses" surface — the LLM gap-fill stage is expected
to surface Spring Data repository interfaces plus their derived query
methods as business-logic candidates.

## Notes

- 0 pack candidates. Negative example — baseline recall is unaffected
  because `expected` is empty.
- The framework prompt (`prompts/frameworks/java-spring-boot.md`) explicitly
  calls out "Spring Data custom repositories" as a Miss.
- `@Query`-annotated methods with native / JPQL bodies would be interesting
  gap-fill targets when LLM fixtures are recorded.
