# Task Breakdown: Fix PUT /api/model Missing Filename Response

## Overview
Total Tasks: 4
Estimated Complexity: Very Low (one-line fix)

## Context

### Current State
- PUT /api/model returns HTTP 500 when filename parameter is missing
- `@RequestParam String filename` is required by default in Spring
- Spring throws `MissingServletRequestParameterException` before controller method is called
- Existing validation logic inside method is never reached

### What Needs to Change
- Add `required = false` to `@RequestParam` annotation
- This allows the controller method to be invoked with `filename = null`
- Existing validation logic then returns HTTP 400

---

## Task List

### Task Group 1: Fix Controller and Verify Tests
**Dependencies:** None

- [x] 1.0 Complete controller fix
  - [x] 1.1 Update saveModel method signature
    - File: `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java`
    - Location: Line 61
    - Change: `@RequestParam String filename` → `@RequestParam(required = false) String filename`
  - [x] 1.2 Verify existing validation logic is correct
    - Lines 65-68 should have:
      ```java
      if (filename == null || filename.isBlank()) {
          return ResponseEntity.badRequest().build();
      }
      ```
    - If it still has `throw new IllegalArgumentException`, change to `return ResponseEntity.badRequest().build();`
  - [x] 1.3 Run existing test
    - Run: `cd architecture-model-service && mvn test -Dtest=ModelControllerTest#saveModel_missingFilename_returns400`
    - Verify test passes (expects HTTP 400)
  - [x] 1.4 Optionally add blank filename test
    - File: `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerTest.java`
    - Add test:
      ```java
      @Test
      void saveModel_blankFilename_returns400() throws Exception {
          ArchitectureModelDto model = createEmptyModel();
          String json = objectMapper.writeValueAsString(model);

          mockMvc.perform(put("/api/model")
                  .param("filename", "")
                  .contentType(MediaType.APPLICATION_JSON)
                  .content(json))
              .andExpect(status().isBadRequest());
      }
      ```

**Acceptance Criteria:**
- PUT /api/model (no filename) returns 400 Bad Request
- PUT /api/model?filename= returns 400 Bad Request
- PUT /api/model?filename=valid-name returns 200 OK
- Test `saveModel_missingFilename_returns400` passes

**Files to Modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java`
- `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerTest.java` (optional)

---

## Execution Order

```
Single Phase:
  - Task Group 1: Fix Controller and Verify Tests
```

---

## Success Criteria

1. **HTTP 400 for missing filename**: Controller returns Bad Request, not Internal Server Error
2. **HTTP 400 for blank filename**: Same behavior for empty string
3. **No regression**: Valid filename still works (200 OK)
4. **Test passes**: `saveModel_missingFilename_returns400` test passes

---

## Implementation Notes

This is a one-line fix:

**Before:**
```java
@RequestParam String filename
```

**After:**
```java
@RequestParam(required = false) String filename
```

The existing validation logic already handles `null` and blank values correctly by returning `ResponseEntity.badRequest().build()`.
