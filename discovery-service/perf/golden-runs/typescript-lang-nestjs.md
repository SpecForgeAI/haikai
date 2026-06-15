# Golden Run — typescript-lang / nestjs

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `40014761-ead1-4e1e-845c-5f2f11d1d930`
**Score:** 4.1 / 5.0
**Date:** 2026-04-25
**Adapter share:** 100%
**Total candidates:** 98

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 5 |
| `endpoints` | 21 |
| `logical_data_entities` | 10 |
| `logical_data_attributes` | 20 |
| `physical_data_entities` | 5 |
| `physical_data_attributes` | 22 |
| `logical_data_entity_relationships` | 5 |
| `interface_logical_entities` | 0 |
| `business_logics` | 10 |
| `ui_screens` | 0 |
| `ui_components` | 0 |

## Notable observations from the scoring LLM

- This is the first scored run for the typescript-lang / nestjs pack, so the score is not baseline-anchored.
- Adapter extraction is strong across controllers, routes, DTOs, TypeORM entities, columns, and relationships, with no deterministic flags raised.
- The run is 100% adapter and 0% LLM. That avoids hallucination risk, but it suggests the gap-fill stage did not contribute and likely explains the missing interface_logical_entities mappings.
- Business logic extraction includes a few infrastructure methods, so reviewers should separate domain behavior from framework plumbing.

---

<!--GOLDEN_DATA:{"runId":"40014761-ead1-4e1e-845c-5f2f11d1d930","score":4.1,"date":"2026-04-25","perType":{"interfaces":5,"endpoints":21,"logical_data_entities":10,"logical_data_attributes":20,"physical_data_entities":5,"physical_data_attributes":22,"logical_data_entity_relationships":5,"interface_logical_entities":0,"business_logics":10,"ui_screens":0,"ui_components":0},"adapterShare":1}-->
