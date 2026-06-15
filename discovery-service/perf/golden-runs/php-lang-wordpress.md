# Golden Run — php-lang / wordpress

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `6d965189-34f9-4dc4-b6b4-e56b0d969a2e`
**Score:** 1.8 / 5.0
**Date:** 2026-04-25
**Adapter share:** 0%
**Total candidates:** 705

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 0 |
| `endpoints` | 2 |
| `logical_data_entities` | 33 |
| `logical_data_attributes` | 80 |
| `physical_data_entities` | 0 |
| `physical_data_attributes` | 0 |
| `logical_data_entity_relationships` | 12 |
| `interface_logical_entities` | 0 |
| `business_logics` | 350 |
| `ui_screens` | 5 |
| `ui_components` | 223 |

## Notable observations from the scoring LLM

- This is the first scored php-lang/wordpress run, so the result is not baseline-anchored.
- The run is 100% LLM-emitted with 0 adapter candidates, directly matching the over-relying-on-llm and pure-llm-run warnings.
- Major WordPress surfaces are missing or nearly missing: interfaces, physical data entities, physical data attributes, interface-logical mappings, and broad endpoint coverage.
- The LLM output appears partially grounded in real WordPress JavaScript/admin concepts, but it is skewed toward client-side Backbone/UI structures and misses deterministic PHP/WordPress framework extraction.
- Cost could not be judged precisely because duration and spend were not provided; the score assumes moderate concern due to 705 LLM-only candidates rather than a measured runaway.

---

<!--GOLDEN_DATA:{"runId":"6d965189-34f9-4dc4-b6b4-e56b0d969a2e","score":1.8,"date":"2026-04-25","perType":{"interfaces":0,"endpoints":2,"logical_data_entities":33,"logical_data_attributes":80,"physical_data_entities":0,"physical_data_attributes":0,"logical_data_entity_relationships":12,"interface_logical_entities":0,"business_logics":350,"ui_screens":5,"ui_components":223},"adapterShare":0}-->
