---
title: Fix Hibernate schema-validation mismatch for methods.parameters_json (map String fields to PostgreSQL jsonb)

intent:
  - Resolve runtime startup failure:
      Schema-validation: wrong column type encountered in column [parameters_json] in table [methods];
      found [jsonb], but expecting [varchar(255)]
  - Keep DB column types as jsonb (per existing Liquibase/SQL migration), and update JPA mapping so Hibernate expects JSON instead of VARCHAR.

scope:
  in:
    - architecture-model-service only
    - JPA entity mapping for MethodEntity JSON fields
  out:
    - DB migration changes (no schema change required if methods.*_json are already jsonb)
    - application logic changes (service/controller/mapper remain unchanged)

acceptance_criteria:
  - `docker compose up` starts arch-model-service successfully (no EntityManagerFactory schema-validation errors)
  - Hibernate validation expects JSON/OTHER type for:
      methods.parameters_json, methods.returns_json, methods.throws_json
  - Existing endpoints continue to serialize/deserialize these fields as Strings (raw JSON text) for now.

diagnosis:
  - Table `methods` has columns `parameters_json`/`returns_json`/`throws_json` created as `jsonb` (Types#OTHER).
  - MethodEntity maps these columns as `String` with default @Column mapping, so Hibernate expects VARCHAR(255).
  - Fix is to explicitly map these fields as JSON using Hibernate 6 annotations.

implementation_steps:

  1) Update MethodEntity to map *_json columns as JSON (Hibernate 6)
    file: src/main/java/com/example/architecturemodel/model/entity/MethodEntity.java

    - Add imports:
        import org.hibernate.annotations.JdbcTypeCode;
        import org.hibernate.type.SqlTypes;

    - For each JSON column (parametersJson, returnsJson, throwsJson):
        - add @JdbcTypeCode(SqlTypes.JSON)
        - set columnDefinition to jsonb

    Example:
      @JdbcTypeCode(SqlTypes.JSON)
      @Column(name = "parameters_json", columnDefinition = "jsonb")
      private String parametersJson;

  2) Ensure PostgreSQL dialect is configured (only if not already)
    file: src/main/resources/application.yml (or application.properties)
    - Confirm spring.jpa.database-platform=org.hibernate.dialect.PostgreSQLDialect

  3) No Liquibase changes required
    - Existing migration creates columns as jsonb - do not change

verification:
  - Run: docker compose up --build arch-model-service
  - Confirm no SchemaManagementException for parameters_json
  - Smoke test: call model load endpoint

deliverable:
  - MethodEntity JSON columns correctly mapped as PostgreSQL jsonb via @JdbcTypeCode(SqlTypes.JSON)
---
