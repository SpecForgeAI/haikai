# Golden Run — go-lang / kratos

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `3505485d-5c31-4540-b98b-40e543fb0152`
**Score:** 3.5 / 5.0
**Date:** 2026-04-25
**Adapter share:** 65%
**Total candidates:** 957

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 11 |
| `endpoints` | 46 |
| `logical_data_entities` | 116 |
| `logical_data_attributes` | 605 |
| `physical_data_entities` | 7 |
| `physical_data_attributes` | 41 |
| `logical_data_entity_relationships` | 21 |
| `interface_logical_entities` | 93 |
| `business_logics` | 17 |
| `ui_screens` | 0 |
| `ui_components` | 0 |

## Notable observations from the scoring LLM

- No deterministic flags were raised, and all backend-relevant surfaces have nonzero coverage.
- Overall adapter share is healthy at 65%, but adapter provenance is concentrated almost entirely in logical entities and attributes; interfaces, endpoints, physical data, relationships, interface mappings, and business logic are all LLM-only.
- Logical entity and attribute counts are much higher than the golden anchor and appear to include generated/config structures and some duplicates.
- Physical data samples show possible duplicate modeling of Beer versus beers, reducing confidence in physical schema accuracy.
- Business logic metadata is notably weak because sampled structured data omits the required method name field.

---

<!--GOLDEN_DATA:{"runId":"3505485d-5c31-4540-b98b-40e543fb0152","score":3.5,"date":"2026-04-25","perType":{"interfaces":11,"endpoints":46,"logical_data_entities":116,"logical_data_attributes":605,"physical_data_entities":7,"physical_data_attributes":41,"logical_data_entity_relationships":21,"interface_logical_entities":93,"business_logics":17,"ui_screens":0,"ui_components":0},"adapterShare":0.6541274817136886}-->
