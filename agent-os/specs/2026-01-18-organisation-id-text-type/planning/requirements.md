# Requirements: Change Organisation ID Type from UUID to TEXT for Consistency

## Overview

**Title:** Change Organisation ID Type from UUID to TEXT for Consistency

**Context:** The newly introduced Organisation entity currently defines `organisation.id` as a UUID. However, the existing database schema and services consistently use TEXT-based IDs (e.g. prefixed IDs like "org-xxxx", "proj-xxxx") rather than UUIDs. This mismatch causes insertion errors and inconsistency across the data model.

**Goal:** Make Organisation IDs consistent with the rest of the system by changing `organisation.id` from UUID to TEXT and updating all related service code accordingly.

## Scope

### In Scope
- Database schema and migration
- architecture-model-service persistence layer and DTOs
- Gateway and API client type updates

### Out of Scope
- No UI changes required
- No change to ID generation strategy beyond using existing TEXT IDs

## Requirements

### 1. Database Schema Change
- Modify the `organisations` table so that:
  - `id` column type is TEXT (not UUID)
  - `id` remains the PRIMARY KEY
- Ensure `projects.organisation_id` (FK) is also TEXT and references `organisations.id`
- If a UUID-based table already exists:
  - Provide a migration that:
    a) drops the existing FK constraint (if any)
    b) alters `organisations.id` from UUID to TEXT
    c) alters `projects.organisation_id` from UUID to TEXT
    d) re-adds the FK constraint referencing TEXT
- No UUID generation or pgcrypto dependency should remain for organisations

### 2. ID Generation Strategy
- Organisation IDs must follow the same TEXT ID strategy as other entities (e.g. prefixed IDs such as "org-<generated-suffix>")
- Reuse the existing ID generation utility/mechanism already used for projects or other top-level entities

### 3. Service Model Updates (architecture-model-service)
- Update Organisation domain model/entity so `id` is typed as string/TEXT
- Update any repository/DAO mappings to reflect TEXT id type
- Update Organisation DTOs and API contracts to treat `id` as string
- Ensure organisation lookup by name and project association logic continues to function unchanged

### 4. Gateway and Client Updates
- Update any gateway proxy types or API client models that currently assume organisation.id is a UUID to use string instead
- Ensure no UUID parsing/casting is performed for organisation IDs

### 5. Regression Validation
- Verify that:
  - An organisation can be created using a TEXT id
  - A project can be created and linked to an organisation via organisation_id
  - Listing organisations returns string IDs
  - No UUID-related errors occur during inserts or queries

## Acceptance Criteria
1. `organisations.id` and `projects.organisation_id` are TEXT in the database
2. Organisation creation works with prefixed/string IDs
3. Project ↔ Organisation relationship functions correctly
4. No remaining UUID assumptions exist in service or gateway code

## Non-Goals
- No changes to organisation name uniqueness rules
- No UI changes
- No migration/backfill of existing organisation rows beyond type change
