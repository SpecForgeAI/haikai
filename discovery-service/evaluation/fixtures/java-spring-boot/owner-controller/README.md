# owner-controller

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/owner/OwnerController.java
- **Category**: happy path (MVC controller with mixed GET/POST endpoints and path variables)

## Why this fixture

Canonical Spring MVC controller. Exercises the adapter's controller + endpoint
detection path: class-level `@Controller` + `@RequestMapping`-derived base path,
method-level `@GetMapping` / `@PostMapping`, composed full paths, `@PathVariable`
parameter extraction, and multiple endpoints per controller. One of the
highest-value positive-recall fixtures in the suite.

## Notes

- 7 endpoints + 1 interface candidate emitted by the adapter.
- No relationship / entity / business-logic candidates (controllers are kept
  distinct from the service layer).
- Potential gap-fill targets the adapter does NOT see: form-backing
  `@ModelAttribute` DTOs, `@InitBinder` customisations, and `BindingResult`
  validation wiring. None listed in `expected` because the LLM-fixture
  strategy is `replay` and no LLM responses were recorded during this
  migration.
