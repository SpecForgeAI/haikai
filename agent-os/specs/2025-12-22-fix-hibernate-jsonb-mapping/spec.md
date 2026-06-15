# Specification: Fix Hibernate JSONB Schema Validation Mismatch

## Goal
Resolve Hibernate schema-validation failure on startup by mapping MethodEntity's JSON String fields to PostgreSQL jsonb type, using the established hypersistence-utils pattern from the codebase.

## User Stories
- As a developer, I want the architecture-model-service to start without schema validation errors so that I can work with the application
- As a DevOps engineer, I want `docker compose up` to succeed so that the system deploys reliably

## Specific Requirements

**Fix MethodEntity JSON column mappings**
- Add `@Type(JsonType.class)` annotation to each JSON field (parametersJson, returnsJson, throwsJson)
- Add `columnDefinition = "jsonb"` to each `@Column` annotation for these fields
- Add required import: `import io.hypersistence.utils.hibernate.type.json.JsonType;`
- Add required import: `import org.hibernate.annotations.Type;`
- Keep field type as `String` since raw JSON text storage is the current design

**No database migration changes**
- Liquibase migration `002-classes-methods.sql` already defines columns as JSONB type
- Do not modify any SQL migration files
- The fix is purely a JPA mapping alignment

**Verify startup succeeds**
- After fix, Hibernate validation should expect JSON/OTHER type instead of VARCHAR(255)
- No EntityManagerFactory exceptions on startup
- Existing API behavior remains unchanged (serialize/deserialize as String)

## Visual Design
No visual assets for this specification.

## Existing Code to Leverage

**DiagramNodeEntity.java - JSON mapping pattern**
- Uses `@Type(JsonType.class)` from hypersistence-utils for jsonb columns
- Combines with `@Column(columnDefinition = "jsonb")` for schema validation
- Already imports `io.hypersistence.utils.hibernate.type.json.JsonType` and `org.hibernate.annotations.Type`
- This is the established pattern in the codebase - follow it for consistency

**DiagramEdgeEntity.java - JSON mapping pattern**
- Same pattern as DiagramNodeEntity for styleOverride and edgePoints fields
- Demonstrates the pattern works for both Map and List types
- Confirms hypersistence-utils is properly configured in the project

**pom.xml - hypersistence-utils dependency**
- Dependency `io.hypersistence:hypersistence-utils-hibernate-63:3.7.3` already present
- No additional dependencies required for this fix
- Compatible with Hibernate 6.3+ used in this Spring Boot project

**application.yml - PostgreSQL dialect**
- PostgreSQLDialect already configured at `spring.jpa.properties.hibernate.dialect`
- `ddl-auto: validate` confirms schema validation is enabled
- No configuration changes needed

## Out of Scope
- Changing database schema or Liquibase migrations
- Converting String fields to typed objects (Map, List, or custom DTOs)
- Adding JSON validation logic
- Modifying service, controller, or mapper layers
- Using native Hibernate 6 `@JdbcTypeCode(SqlTypes.JSON)` instead of hypersistence-utils pattern
- Adding indexes on JSON columns
- Implementing JSON path queries
- Changing API serialization behavior
- Modifying other entity classes
- Adding unit tests for JSON serialization
