# crash-controller

- **Source**: https://github.com/spring-projects/spring-petclinic @ edf4db28affcc4741c79850a3d95bc3f177b5ff9
- **License**: Apache-2.0
- **Original upstream path**: src/main/java/org/springframework/samples/petclinic/system/CrashController.java
- **Category**: happy path (minimal single-endpoint controller)

## Why this fixture

Smallest controller in the codebase: one `@GetMapping("/oups")` handler.
Useful as a floor check — the adapter should still emit `interface` +
`endpoint` candidates even when the controller has no request body, path
variables, or return-type unwrapping.

## Notes

- 1 interface + 1 endpoint candidate.
- `CrashController` is package-private (no `public` modifier) — verifies
  that the adapter does not filter out non-public controller classes.
