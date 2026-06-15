# Task Breakdown: Fix Hibernate JSONB Schema Validation Mismatch

## Overview
Total Tasks: 8

## Problem Summary
The `MethodEntity` class has three JSON columns (`parametersJson`, `returnsJson`, `throwsJson`) that are defined as `jsonb` in PostgreSQL but mapped as plain `String` in JPA. This causes Hibernate schema validation to fail on startup with:
```
Schema-validation: wrong column type encountered in column [parameters_json] in table [methods];
found [jsonb], but expecting [varchar(255)]
```

## Task List

### JPA Entity Layer

#### Task Group 1: Update MethodEntity JSONB Mappings
**Dependencies:** None

- [x] 1.0 Complete MethodEntity JSONB mapping fix
  - [x] 1.1 Add required imports to MethodEntity.java
    - Add `import io.hypersistence.utils.hibernate.type.json.JsonType;`
    - Add `import org.hibernate.annotations.Type;`
    - Follow established pattern from `DiagramNodeEntity.java`
  - [x] 1.2 Update parametersJson field mapping
    - Add `@Type(JsonType.class)` annotation
    - Update `@Column` to include `columnDefinition = "jsonb"`
    - Keep field type as `String`
  - [x] 1.3 Update returnsJson field mapping
    - Add `@Type(JsonType.class)` annotation
    - Update `@Column` to include `columnDefinition = "jsonb"`
    - Keep field type as `String`
  - [x] 1.4 Update throwsJson field mapping
    - Add `@Type(JsonType.class)` annotation
    - Update `@Column` to include `columnDefinition = "jsonb"`
    - Keep field type as `String`

**File to modify:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/MethodEntity.java`

**Reference pattern from:**
- `architecture-model-service/src/main/java/com/example/architecturemodel/model/entity/DiagramNodeEntity.java`

**Acceptance Criteria:**
- All three JSON fields have `@Type(JsonType.class)` annotation
- All three JSON fields have `columnDefinition = "jsonb"` in `@Column`
- Required imports are present
- Code follows established codebase pattern

---

### Verification Layer

#### Task Group 2: Verify Application Startup
**Dependencies:** Task Group 1

- [x] 2.0 Complete startup verification
  - [x] 2.1 Build the architecture-model-service
    - Run `mvn clean compile` in architecture-model-service directory
    - Verify no compilation errors
  - [ ] 2.2 Start the service with Docker Compose (DEFERRED - requires manual verification)
    - Run `docker compose up --build arch-model-service`
    - Verify no `EntityManagerFactory` or `SchemaManagementException` errors
    - Confirm Hibernate schema validation passes
  - [ ] 2.3 Smoke test API functionality (DEFERRED - requires manual verification)
    - Call model load endpoint to verify JSON fields serialize/deserialize correctly
    - Confirm existing API behavior is unchanged

**Acceptance Criteria:**
- Service compiles without errors
- `docker compose up` starts successfully
- No Hibernate schema-validation errors in logs
- Existing API endpoints function correctly
- JSON fields serialize/deserialize as raw JSON text strings

---

## Execution Order

Recommended implementation sequence:
1. **JPA Entity Layer (Task Group 1)** - Update MethodEntity annotations
2. **Verification Layer (Task Group 2)** - Confirm fix resolves startup issue

## Code Changes Summary

### Before (MethodEntity.java)
```java
@Column(name = "parameters_json")
private String parametersJson;

@Column(name = "returns_json")
private String returnsJson;

@Column(name = "throws_json")
private String throwsJson;
```

### After (MethodEntity.java)
```java
import io.hypersistence.utils.hibernate.type.json.JsonType;
import org.hibernate.annotations.Type;

// ... in class body:

@Type(JsonType.class)
@Column(name = "parameters_json", columnDefinition = "jsonb")
private String parametersJson;

@Type(JsonType.class)
@Column(name = "returns_json", columnDefinition = "jsonb")
private String returnsJson;

@Type(JsonType.class)
@Column(name = "throws_json", columnDefinition = "jsonb")
private String throwsJson;
```

## Notes

- **No database migration changes required** - The Liquibase migration `002-classes-methods.sql` already defines columns as JSONB type
- **No test changes required** - This is a JPA mapping alignment fix; existing tests remain valid
- **Dependency already present** - `io.hypersistence:hypersistence-utils-hibernate-63:3.7.3` is in pom.xml
- **PostgreSQL dialect already configured** - `spring.jpa.properties.hibernate.dialect` is set in application.yml
