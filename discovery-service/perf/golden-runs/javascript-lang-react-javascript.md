# Golden Run — javascript-lang / react-javascript

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `7258022c-2fb7-47e2-807f-7ed7c8460201`
**Score:** 2.4 / 5.0
**Date:** 2026-04-25
**Adapter share:** 6%
**Total candidates:** 108

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 0 |
| `endpoints` | 22 |
| `logical_data_entities` | 2 |
| `logical_data_attributes` | 0 |
| `physical_data_entities` | 0 |
| `physical_data_attributes` | 0 |
| `logical_data_entity_relationships` | 0 |
| `interface_logical_entities` | 0 |
| `business_logics` | 51 |
| `ui_screens` | 4 |
| `ui_components` | 29 |

## Notable observations from the scoring LLM

- No golden anchor exists for javascript-lang / react-javascript, so the score is absolute and tagged no-baseline.
- Adapter share is only 6%, matching the deterministic over-relying-on-llm warning and strongly lowering determinism and provenance-balance scores.
- The strongest surfaces are endpoints and UI components, but both are heavily LLM-derived; this increases review burden even when samples look plausible.
- Major frontend architectural gaps remain: zero interfaces, zero logical data attributes, zero interface-to-logical-entity mappings, and only four UI screens.
- Business logic contains plausible React/Redux methods but also boilerplate or generic helper-like entries, suggesting a moderate LLM noise risk rather than a clean deterministic extraction.

---

<!--GOLDEN_DATA:{"runId":"7258022c-2fb7-47e2-807f-7ed7c8460201","score":2.4,"date":"2026-04-25","perType":{"interfaces":0,"endpoints":22,"logical_data_entities":2,"logical_data_attributes":0,"physical_data_entities":0,"physical_data_attributes":0,"logical_data_entity_relationships":0,"interface_logical_entities":0,"business_logics":51,"ui_screens":4,"ui_components":29},"adapterShare":0.06481481481481481}-->
