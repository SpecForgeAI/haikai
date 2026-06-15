# location-service

- **Source**: https://github.com/openmrs/openmrs-core @ f5fb77253598acde24e0c6eccb1bff781d7e5e37
- **License**: MPL-2.0
- **Original upstream path**: api/src/main/java/org/openmrs/api/LocationService.java
- **Category**: service interface + pack blind spot on save/get methods + negative example

## Why this fixture

Service interface with 20+ methods. The pack's business-logic detector recognises the `retire*` / `unretire*` / `purge*` vocabulary (6 candidates) but misses the `save*` / `get*` / `getLocations*` forms even when they carry `@Authorized` — that's a detector gap gap-fill should close.

Three representative gap-fill expectations (`saveLocation`, `getDefaultLocation`, `getLocationsHavingAllTags`) cover the mutation / lookup / query idioms respectively, without making the fixture's expected list exhaustive.

The `shouldNotEmit` entry (`setLocationDAO`) is a Spring DI setter — it must never be classified as business logic. Any candidate matching it counts as a hallucination.

## Notes

One of two service-tier fixtures in the initial set (alongside any future `location-service-impl`). Exercises the business-logic detector's vocabulary filter and provides a clear negative example for DI plumbing.
