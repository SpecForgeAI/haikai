# Golden Run — csharp-lang / asp-net-core

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `27291bc9-bb6c-4090-8455-47f46304c393`
**Score:** 2.1 / 5.0
**Date:** 2026-04-25
**Adapter share:** 0%
**Total candidates:** 204

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 7 |
| `endpoints` | 30 |
| `logical_data_entities` | 27 |
| `logical_data_attributes` | 90 |
| `physical_data_entities` | 0 |
| `physical_data_attributes` | 0 |
| `logical_data_entity_relationships` | 1 |
| `interface_logical_entities` | 16 |
| `business_logics` | 27 |
| `ui_screens` | 6 |
| `ui_components` | 0 |

## Notable observations from the scoring LLM

- This is a pure-LLM run: 204/204 candidates were emitted by LLM gap-fill and 0 by adapters, which is far below the expected adapter share for C#/ASP.NET Core.
- Endpoints look mostly grounded, but several core adapter-friendly surfaces such as interfaces/controllers and business logic are under-supported by deterministic extraction.
- The persistence layer is effectively missing: 0 physical_data_entities and 0 physical_data_attributes is a major architectural blind spot for a backend-service run.
- Some interface samples look misclassified or weakly grounded, including Basket appearing as an interface-like element and page models being mixed with controller abstractions.
- Because there is no golden baseline for this pack, scoring is absolute and confidence is limited to no-baseline.

---

<!--GOLDEN_DATA:{"runId":"27291bc9-bb6c-4090-8455-47f46304c393","score":2.1,"date":"2026-04-25","perType":{"interfaces":7,"endpoints":30,"logical_data_entities":27,"logical_data_attributes":90,"physical_data_entities":0,"physical_data_attributes":0,"logical_data_entity_relationships":1,"interface_logical_entities":16,"business_logics":27,"ui_screens":6,"ui_components":0},"adapterShare":0}-->
