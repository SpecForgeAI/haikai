# Specification: Fix PUT /api/model Missing Filename Response

## 1. Overview

### 1.1 Problem Statement

The PUT /api/model endpoint returns HTTP 500 (Internal Server Error) when the `filename` query parameter is missing. It should return HTTP 400 (Bad Request) to indicate a client error.

### 1.2 Root Cause

In `ModelController.java`, the `saveModel` method signature is:

```java
@PutMapping
public ResponseEntity<ModelFileSummaryDto> saveModel(
        @RequestParam String filename,  // required=true by default
        @RequestBody ArchitectureModelDto model) {
```

When `@RequestParam` is used without `required = false`, Spring treats the parameter as mandatory. If the client sends a request without the `filename` parameter, Spring throws `MissingServletRequestParameterException` **before** the controller method is invoked.

The existing validation logic inside the method:
```java
if (filename == null || filename.isBlank()) {
    return ResponseEntity.badRequest().build();
}
```

...is never reached because Spring intercepts the request first.

### 1.3 Goals

1. Return HTTP 400 when filename is missing or blank
2. Handle the validation locally in the controller (not via global exception handler)
3. Maintain existing behavior when a valid filename is provided

### 1.4 Non-Goals

- Adding global exception handling for this specific case
- Changing DELETE /api/model behavior (though it has the same issue)

## 2. Technical Design

### 2.1 Controller Fix

**File:** `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java`

**Current Code (line 60-61):**
```java
@PutMapping
public ResponseEntity<ModelFileSummaryDto> saveModel(
        @RequestParam String filename,
        @RequestBody ArchitectureModelDto model) {
```

**Fixed Code:**
```java
@PutMapping
public ResponseEntity<ModelFileSummaryDto> saveModel(
        @RequestParam(required = false) String filename,
        @RequestBody ArchitectureModelDto model) {
```

The only change is adding `required = false` to the `@RequestParam` annotation.

### 2.2 Validation Logic (Already Exists)

The existing validation logic at lines 65-68 already handles the missing/blank case correctly:

```java
if (filename == null || filename.isBlank()) {
    return ResponseEntity.badRequest().build();
}
```

No changes needed to the validation logic.

### 2.3 Test Verification

**File:** `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerTest.java`

The test at lines 107-116 already expects HTTP 400:

```java
@Test
void saveModel_missingFilename_returns400() throws Exception {
    ArchitectureModelDto model = createEmptyModel();
    String json = objectMapper.writeValueAsString(model);

    mockMvc.perform(put("/api/model")
            .contentType(MediaType.APPLICATION_JSON)
            .content(json))
        .andExpect(status().isBadRequest());
}
```

This test is currently failing (getting 400 from Spring's default handling but via a different path). After the fix, it will pass with the correct behavior.

### 2.4 Optional: Test for Blank Filename

Optionally add a test to cover the blank filename case:

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

## 3. Acceptance Criteria

### AC1 - Missing Filename Returns 400
- Request: `PUT /api/model` with valid JSON body, no `filename` parameter
- Expected: HTTP 400 Bad Request

### AC2 - Blank Filename Returns 400
- Request: `PUT /api/model?filename=` with valid JSON body
- Expected: HTTP 400 Bad Request

### AC3 - Valid Filename Works
- Request: `PUT /api/model?filename=my-file` with valid JSON body
- Expected: HTTP 200 OK with ModelFileSummary response

### AC4 - Existing Test Passes
- `ModelControllerTest.saveModel_missingFilename_returns400()` passes

## 4. Files Summary

### Files to Modify

| File | Change |
|------|--------|
| `architecture-model-service/src/main/java/com/example/architecturemodel/controller/ModelController.java` | Add `required = false` to `@RequestParam` on saveModel method (line 61) |

### Files to Verify

| File | Verification |
|------|-------------|
| `architecture-model-service/src/test/java/com/example/architecturemodel/controller/ModelControllerTest.java` | Existing test should now pass |

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing functionality | Very Low | Low | Only changes parameter requirement; validation logic unchanged |
| Test still fails | Very Low | Low | Run test after change to verify |

## 6. Implementation Notes

This is a one-line fix. The change from:
```java
@RequestParam String filename
```
to:
```java
@RequestParam(required = false) String filename
```

allows Spring to pass `null` to the method when the parameter is missing, rather than throwing an exception. The existing `if (filename == null || filename.isBlank())` check then handles this case and returns 400.
