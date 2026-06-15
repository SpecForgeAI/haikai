# Raw Idea

## Title
Fix db-disabled.yml Activation So JPA Auto-Config Is Only Disabled When include-database=false

## Description
Correct the Spring Boot config activation condition for the "db-disabled" configuration so that DB/JPA/Liquibase auto-configuration is excluded ONLY when app.features.include-database is explicitly false. Currently, the db-disabled config is being applied even when include-database=true, preventing entityManagerFactory creation and causing repository wiring failures.
