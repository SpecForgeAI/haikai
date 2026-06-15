# Raw Idea: Inbound Surface Completeness for Discovery

**HAIKAI Phase-2 "oracle perfection" — Spec #4 of 6.** Built strictly sequentially
after Specs #1–#3.

The API migration test harness (`api-migration-validation-service`) can only
fire requests at — and therefore only prove equivalence for — endpoints that
discovery actually finds. Today discovery's inbound-endpoint detection keys off
a fixed 6-name Spring-MVC annotation set matched by simple name
(`springClassic/index.ts:51-68`). Whole classes of inbound surface are therefore
INVISIBLE, so the harness silently never tests them:

- **JAX-RS** (`@Path`/`@GET`/`@POST`/`@Produces`/`@Consumes`) — entirely undetected
  (common in the Java-8-era migration source).
- **Raw servlets / `web.xml` servlet-mappings / `@WebServlet`** — `web.xml` is
  detected by filename only (`springClassicFindingScanner.ts:1005`), with no URL
  extraction; `HttpServlet`/`doGet`/`doPost` undetected.
- **WebFlux `RouterFunction`** functional routes — undetected (annotation-only).
- **Meta-annotated / composed mapping annotations** (`@ApiV2Get` meta-annotated
  with `@GetMapping`) — undetected (exact-simple-name match, no meta-annotation
  resolution; `astUtils.ts:296` records `nameNode.text` verbatim). Fully-qualified
  `@org.springframework...GetMapping` also false-negatives.
- **Inherited / abstract base-controller mappings** — no `extends` walk for
  controllers (only `@MappedSuperclass` JPA fields are walked).
- **JAX-WS SEIs declared as a Java `interface`** — missed
  (`jaxWsScanner.ts:73` `CLASS_DECL_REGEX` matches `class` only).
- `consumes`/`produces`/`headers`/`params` discriminators dropped → distinct
  endpoints on the same path+verb collapse; `@RequestParam`/`@RequestHeader`
  inputs not captured (so the harness cannot vary them).

A carved quick-win **W1** is ALREADY DONE on HEAD: multi-method
`@RequestMapping(method={...})` and multi-path `@GetMapping({"/a","/b"})` now fan
out one endpoint per (verb × path) in `springClassic/index.ts`. W1 left a
`TODO(oracle-W1)` (`springClassic/index.ts:247`) to align the two single-value
`extractHttpMethod` mirrors (`endpointDataEffectResolver.ts:367`,
`springBoot/index.ts:284`). THIS spec EXTENDS W1 and closes that TODO.

**Decision (user pre-approved, autonomous build): stop defaulting to cuts —
INCLUDE all listed inbound surfaces in v1.** Detect them all as
`endpoints`/`interfaces` candidates flowing through the EXISTING candidate +
save-back path. NO new meta-model entity types (`endpoints`/`interfaces` already
exist). Deterministic; no LLM in the core path (the LLM gap-fill stage stays the
safety net, and its "what the adapter misses" prompt list is updated to drop the
now-covered surfaces). Scope = the Java-era classic stacks that ARE the migration
source.

**Out of scope:** GraphQL / gRPC / WebSocket-STOMP / Spring Batch as entry points
(emit a Finding noting their presence, defer full modelling); non-Java stacks;
Actuator endpoints.

North-star reference: memory `project_migration_ultimate_goal`. Sibling specs:
#1 endpoint→data-effect graph, #2 business-logic behaviour, #3 DB structural
fidelity (all built); this spec heavily SHARES the `springClassic` adapter +
`astUtils.ts` + the gap-fill prompt with #1, and `emissionSources.ts` with #1/#3,
so it is built AFTER them to extend their committed code.
