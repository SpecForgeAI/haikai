# Finding: GitNexus extracts zero HTTP routes

**Status:** Confirmed empirically across two Java repos (2026-05-01).
**Significance:** Central differentiator for V2; reinforces priority of spec #91 (api_impact + route_map).

## The observation

After running `gitnexus analyze` on `spring-petclinic` (30 files) and `openmrs-core` (1,273 files), the persisted LadybugDB graph contains:

- **0 `Route` nodes**
- **0 standard HTTP framework annotations** — searched for `@Mapping`, `@Controller`, `@Path`, `@GET`, `@POST`, `@RestController`, `@RequestMapping`. None present.
- **15 `Annotation` nodes total** in openmrs-core — every one is a custom `@interface` declaration (`Verifies`, `StartModule`, `Authorized`, etc.). No annotations *applied to* methods are captured as graph nodes.

## What this means

GitNexus has no persisted concept of an HTTP endpoint. Their abstraction is the call graph plus annotation declarations — they do not lift framework conventions (Spring `@GetMapping`, JAX-RS `@Path`) into first-class graph nodes during AST extraction.

To answer "what endpoints does this service expose?" using GitNexus, a downstream agent would need to:
1. Cypher-query for methods inside `*Controller.java` files (heuristic, lossy)
2. Re-read source files to find applied annotations
3. Reconstruct route information itself

## Contrast with V2

V2 (this project) produces 17 endpoints in petclinic and 13 in openmrs via its [[../../../playbooks]]-driven LLM discovery. The route concept is first-class in V2's pipeline, materialized as endpoint records with method, path, and handler symbol.

## Why GitNexus might have made this choice

Speculative — we have not read their architectural rationale:
- Routes are framework-specific; Spring routes differ from FastAPI routes differ from Express routes. Maintaining first-class route nodes requires per-framework extraction logic.
- AST-only extraction (no LLM) cannot generalize across frameworks without explicit per-framework rules.
- The user can always Cypher-walk to controllers and reconstruct routes if needed.

## Implication for spec #91

Spec #91 (api_impact + route_map) is the right next investment. The empirical comparison confirms: **no off-the-shelf code-analysis tool we've evaluated provides route-aware impact analysis.** That capability is the V2-specific value proposition.

## What we did about it (update — same day, 2026-05-01)

Within hours of this finding, we shipped [[../concepts/openapi-canonicalization]] — the first concrete step toward a richer route abstraction than GitNexus has. That work moves Kibana from 2,597 reverse-engineered endpoints to 611 canonical ones, and establishes the pattern: when a project ships a spec, treat it as authoritative. Spec #91 (route_map) builds on this: route abstraction across frameworks, with OpenAPI as the highest-confidence source.

[[../concepts/refactoring-engines]] (also shipped 2026-05-01) adds the *impact* half: change_detector + the route abstraction will let us answer "what API consumers does this PR break?" — the api_impact half of spec #91.

## Sources

- [[../../raw/2026-05-01_gitnexus_session]]
- [[../../raw/2026-05-01_commit-batch]]
- Related: [[../tools/gitnexus]], [[../comparisons/gitnexus-vs-v2]], [[../concepts/openapi-canonicalization]], [[../concepts/refactoring-engines]]
