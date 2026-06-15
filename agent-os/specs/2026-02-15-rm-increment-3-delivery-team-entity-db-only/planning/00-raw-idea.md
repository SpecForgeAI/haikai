# Raw Idea

## Title
RM Increment 3 – DeliveryTeam Entity (DB Only, No UI)

## Description
Introduce Delivery Teams as first-class, DB-backed entities so future roadmap planning can assign Initiatives/Epics to delivery teams (internal/external). This increment adds backend persistence + minimal REST endpoints only. No UI changes and no roadmap logic changes.

## Scope Includes
- architecture-model-service: DeliveryTeam JPA entity + table
- architecture-model-service: minimal CRUD endpoints for delivery teams
- architecture-model-service: add nullable delivery_team_id FK to work_item
- DTOs + service layer + repository

## Scope Excludes
- any frontend/UI work
- any gateway changes
- any assignment logic in roadmap conversation
- any Jira sync logic
- any changes to work item creation flows

## Primary System
architecture-model-service

## Data Model
New delivery_teams table:
- UUID PK
- project_id FK
- name
- type ENUM INTERNAL/EXTERNAL
- description
- timestamps
- UNIQUE(project_id, name)

WorkItem updates:
- Add nullable delivery_team_id FK with ON DELETE SET NULL

## JPA Entities
- DeliveryTeam entity
- WorkItem updated with deliveryTeamId field
- DeliveryTeamRepository with findByProjectId and findByProjectIdAndName
- DeliveryTeamService with list/create/update/delete

## REST API
Endpoint: /api/projects/{projectId}/delivery-teams

Operations:
- GET (list) - 200
- POST (create) - 201
- PUT /{teamId} (update) - 200
- DELETE /{teamId} (204, sets linked work_items to NULL)

## DTO
DeliveryTeamDto Java record:
- id
- projectId
- name
- type
- description
- createdAt
- updatedAt

## Validation
- name: non-empty, max 120 chars
- type: required
- 409 on duplicate name per project

## Migrations
- Create delivery_teams table
- Add work_item.delivery_team_id FK

## Non-Functional Requirements
- No frontend changes
- No gateway changes
- No changes to existing roadmap/backlog behavior
- Existing work items valid with null delivery_team_id
- Deleting team must not delete work items
