# Spec Requirements: Organisation Model + DB + API DTOs (Backend Foundation)

## Initial Description

Extend the Architecture Model Service to persist and expose new Organisation fields needed for future "global standards generation". This iteration is backend-only: no UI changes and no external standards service calls.

**Scope Summary:**
- Database schema update for organisations
- Update Organisation JPA entity + persistence mapping
- Update Organisation API DTOs + controller/service plumbing
- Ensure list-organisations endpoint exposes organisation names for uniqueness checks
- Ensure import/export (project snapshot / model serialization) round-trips the new organisation fields
- Add/adjust backend tests for persistence + DTO mapping + uniqueness constraint

**New Fields to Add:**
- docsAppliedToAllSources: List<String> (nullable -> treated as empty list)
- docsAppliedToTechStack: List<String> (nullable -> treated as empty list)
- docsAppliedToCodingStyles: List<String> (nullable -> treated as empty list)
- docsAppliedToConventions: List<String> (nullable -> treated as empty list)
- docsAppliedToErrorHandling: List<String> (nullable -> treated as empty list)
- docsAppliedToValidation: List<String> (nullable -> treated as empty list)
- techStandardsGenerated: boolean (default false)

## Requirements Discussion

### First Round Questions

**Q1:** The spec mentions "the Architecture Model Service." I assume that refers to the Spring Boot backend and the existing Organisation entity/repository/controller will be extended in place within its existing src/main/java package structure. Is that correct?
**Answer:** Yes - the Architecture Model Service is the Spring Boot backend and already contains Organisation entity/repo/controller in its existing src/main/java package structure.

**Q2:** For the database migration, I assume we should use Flyway or Liquibase (whichever the service currently uses). Which migration framework is already in place?
**Answer:** Use Flyway (the service's existing migration approach).

**Q3:** For the unique constraint on Organisation.name, should the uniqueness be case-sensitive (e.g., "Acme" and "acme" would be allowed as separate organisations) or case-insensitive (they would conflict)?
**Answer:** Make Organisation.name uniqueness case-insensitive (e.g., "Acme" and "acme" should conflict).

**Q4:** For the JPA AttributeConverter that serializes List<String> to JSON, I assume we should use Jackson (the typical Spring Boot JSON library). Is that correct, or is there a different JSON library in use?
**Answer:** Yes, use Jackson for the List<String> JSON AttributeConverter.

**Q5:** The spec mentions updating "project snapshot / model serialization" for import/export. I assume there's an existing snapshot service or serialization utility that handles Organisation objects. Can you confirm the location or name of this existing import/export mechanism (e.g., ProjectSnapshotService, ModelExportService)?
**Answer:** Yes - use the existing ProjectSnapshot/Snapshot export-import services (ProjectSnapshotService + ProjectSnapshotImportService and related serialization utilities) where organisations are currently included.

**Q6:** For error responses (e.g., 409 Conflict on duplicate name), I assume we should follow the existing global exception handler pattern in the service. Is there an existing error response DTO format to match?
**Answer:** Yes - follow the service's existing global exception/error response format; duplicate name should map to the existing 409 style.

**Q7:** For the Flyway migration column ordering, is there a preference for how the new columns should be ordered in the ALTER TABLE statement (e.g., alphabetically, grouped by purpose, or docsAppliedTo* fields first then techStandardsGenerated)?
**Answer:** No strong preference - group all docsAppliedTo* columns together, with techStandardsGenerated at the end.

**Q8:** Are there any additional exclusions or edge cases to be aware of? For example: soft-delete handling, audit columns, or specific validation rules beyond uniqueness?
**Answer:** Exclude all frontend/gateway/external standards calls; no orchestration/job work; only persist + expose fields + snapshot round-trip + uniqueness enforcement.

### Existing Code to Reference

**Similar Features Identified:**
- Feature: Organisation entity/repository/controller - Path: existing src/main/java package structure in Architecture Model Service
- Feature: ProjectSnapshotService + ProjectSnapshotImportService - Path: existing snapshot/serialization utilities in Architecture Model Service
- Components to potentially reuse: Existing global exception handler and 409 error response format
- Backend logic to reference: Existing Flyway migrations for migration pattern

### Follow-up Questions

No follow-up questions were needed. The user's answers were comprehensive and addressed all necessary technical details for this backend-only iteration.

## Visual Assets

### Files Provided:
No visual assets provided.

### Visual Insights:
Not applicable - this is a backend-only iteration with no UI changes.

## Requirements Summary

### Functional Requirements
- Add six new List<String> fields to Organisation for document categorization (docsAppliedToAllSources, docsAppliedToTechStack, docsAppliedToCodingStyles, docsAppliedToConventions, docsAppliedToErrorHandling, docsAppliedToValidation)
- Add boolean field techStandardsGenerated (defaults to false)
- Store List<String> fields as JSON text columns using a reusable JPA AttributeConverter with Jackson
- Enforce case-insensitive uniqueness on Organisation.name at the database level
- Update Organisation DTOs to include all new fields
- Ensure list-organisations endpoint returns organisation names (for client-side uniqueness validation)
- Update ProjectSnapshotService and ProjectSnapshotImportService to include new fields in export/import
- Handle missing fields during import gracefully (default to empty lists / false)
- Return 409 Conflict error using existing error response format when duplicate name is detected

### Reusability Opportunities
- Extend existing Organisation entity, repository, and controller in place
- Follow existing Flyway migration patterns for schema changes
- Use existing global exception handler for 409 Conflict responses
- Leverage existing ProjectSnapshotService and ProjectSnapshotImportService for serialization

### Scope Boundaries

**In Scope:**
- Flyway migration adding new columns to organisations table
- Case-insensitive unique constraint/index on organisation name
- Organisation JPA entity updates with new fields
- Reusable JPA AttributeConverter for List<String> <-> JSON using Jackson
- Organisation DTO updates
- Controller/service plumbing for CRUD operations with new fields
- Snapshot export including new fields
- Snapshot import handling new fields (with defaults for missing data)
- Backend tests for persistence, DTO mapping, uniqueness, and snapshot round-trip

**Out of Scope:**
- Frontend Create Organisation modal or any UI changes
- Gateway changes
- Calling external /api/v1/standards/global/generate
- Any orchestration/job handling
- Soft-delete handling
- Audit columns
- Validation rules beyond name uniqueness

### Technical Considerations
- Use Flyway for database migration
- Use Jackson for JSON serialization in the AttributeConverter
- Case-insensitive uniqueness requires appropriate database constraint (e.g., LOWER(name) unique index or citext type)
- Column ordering: group docsAppliedTo* columns together, techStandardsGenerated at the end
- Null list values in DB should normalize to empty lists in service responses
- Follow existing Spring Boot patterns in the Architecture Model Service
- Maintain backward compatibility for existing data (backfill techStandardsGenerated=false, list fields empty/null)
