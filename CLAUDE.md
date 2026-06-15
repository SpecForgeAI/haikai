# Repository Guidance for Claude Code

This file holds repository-wide guidance for AI coding agents working in this
monorepo. Per-feature spec material lives under `agent-os/specs/`; this file
captures only conventions that span the whole repo.

## AMS wire format

AMS (the `architecture-model-service` Spring Boot module) speaks `snake_case`
at the wire by default. The global is configured via
`spring.jackson.property-naming-strategy: SNAKE_CASE` in
`architecture-model-service/src/main/resources/application.yml` (and the
matching test `application.yml`). The majority of AMS consumers depend on
that wire format -- the gateway proxies, the `discovery-service` AMS client,
the `api-migration-validation-service` AMS client, and the frontend's
snake_case-typed API modules all self-document the dependency.

DTOs whose consumers expect `camelCase` are marked `@CamelCaseWire`
(`com.example.architecturemodel.jackson.CamelCaseWire`) -- currently 19 files
covering Selective Copy, target-state architecture, and the captured-decisions
data plane. The annotation is a meta-annotation that resolves to
`@JsonNaming(PropertyNamingStrategies.LowerCamelCaseStrategy.class)` and is
runtime-identical to the raw Jackson annotation it replaced; the goal of the
named marker is purely legibility.

When adding a new DTO:

- New `camelCase` consumers: apply `@CamelCaseWire` on the DTO class / record.
- New `snake_case` consumers: no annotation needed; the global default does the
  right thing. Belt-and-braces explicit `@JsonProperty("snake_case_name")`
  declarations are also common in the existing codebase and are intentional.

Forward pointer for any future global-flip migration:
`frontend/src/api/epicCapturedDecisionsApi.ts` implements a dual-tolerance
`coerce(snake, camel)` pattern that lets the client read both wire shapes.
That is the idiom a future consumer-first migration would use to prepare
clients safely before any wire change. See
`agent-os/specs/2026-05-25-ams-dto-json-naming-audit-sweep/planning/requirements.md`
for the row-by-row consumer audit.
