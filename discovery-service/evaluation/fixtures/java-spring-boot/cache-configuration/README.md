# cache-configuration

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/system/CacheConfiguration.java
- **Category**: blind spot (`@Configuration` + `@EnableCaching` — pack emits nothing)

## Why this fixture

`@Configuration` classes that declare `@Bean` methods are a known blind
spot for the Chunk 1 spring-boot adapter — the adapter only emits
`@Controller` / `@Service` / `@Entity` stereotypes. A CacheConfiguration
class wiring a caching subsystem via `@EnableCaching` encodes real
architectural intent (the presence of a cache layer) that would be
visible to the LLM gap-fill stage via the framework-prompt's "Config
classes with semantic content" Miss list.

## Notes

- 0 pack candidates. Negative example.
- Framework-prompt target: emit an infrastructure / integration candidate
  for the cache layer itself, even though the class is not annotated with
  any of the adapter's detected stereotypes.
