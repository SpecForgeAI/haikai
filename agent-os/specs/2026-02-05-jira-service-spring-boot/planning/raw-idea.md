# Raw Idea

## Title
New Jira Service (Spring Boot) — GET /jira/work-items with configurable type mapping + optional child expansion

## Intent
Introduce a dedicated Jira integration service (Java/Spring Boot) whose first capability is to query Jira Cloud using JQL and return results mapped into the tool's WorkItemDto shape (not raw Jira DTOs). Support optional parent/child expansion using modern Jira Cloud parent.key linkage. Include toolProjectId request param to set WorkItemDto.projectId (tool project, not Jira project).

## Date Initiated
2026-02-05
