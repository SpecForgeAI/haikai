# Idea: Fix PUT /api/model Missing Filename Response

## Summary

Fix the PUT /api/model endpoint so that when no filename is provided it returns HTTP 400 (Bad Request) instead of HTTP 500. The controller should handle the absence of the filename parameter explicitly rather than allowing Spring to throw an internal error.

## Current Problem

The `saveModel` method in `ModelController.java` has:
```java
@PutMapping
public ResponseEntity<ModelFileSummaryDto> saveModel(
        @RequestParam String filename,  // <-- required=true by default
        @RequestBody ArchitectureModelDto model) {
```

When `@RequestParam` is used without `required = false`, Spring treats it as required. If the parameter is missing from the request, Spring throws `MissingServletRequestParameterException` BEFORE the controller method is even invoked. This results in HTTP 500 (or whatever the GlobalExceptionHandler returns for that exception).

The validation logic inside the method (`if (filename == null || filename.isBlank())`) is never reached because Spring intercepts first.

## Fix Required

1. Change `@RequestParam String filename` to `@RequestParam(required = false) String filename`
2. The existing validation logic will then handle missing/blank filenames and return 400

## Files Involved

| File | Change |
|------|--------|
| `ModelController.java` | Add `required = false` to `@RequestParam` |
| `ModelControllerTest.java` | Verify test passes (already expects 400) |

## Acceptance Criteria

- PUT /api/model (no query string) → 400 Bad Request
- PUT /api/model?filename= → 400 Bad Request
- PUT /api/model?filename=my-file → 200 OK (with valid body)
