# Golden Run — javascript-lang / angularjs-classic

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `95d16402-5f3e-43de-83ad-a3274a2ed8de`
**Score:** 4.9 / 5.0
**Date:** 2026-04-29
**Adapter share:** 83%
**Total candidates:** 24

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 3 |
| `endpoints` | 0 |
| `logical_data_entities` | 0 |
| `logical_data_attributes` | 0 |
| `physical_data_entities` | 0 |
| `physical_data_attributes` | 0 |
| `logical_data_entity_relationships` | 0 |
| `interface_logical_entities` | 0 |
| `logical_data_entity_physical_data_entities` | 0 |
| `logical_data_attribute_physical_data_attributes` | 0 |
| `business_logics` | 12 |
| `ui_screens` | 2 |
| `ui_components` | 7 |

## Notable observations from the scoring LLM

- No golden anchor exists for javascript-lang / angularjs-classic, so this score is absolute and confidence is no-baseline.
- The run is small with 24 total candidates, but the candidate mix is coherent for a compact AngularJS SPA: modules, routes, directives, and services/factories.
- Adapter share is high at 83%, which is appropriate for statically declared AngularJS modules, routes, factories, providers, and directives; the LLM contribution is limited to plausible gap-fill business logic.
- LLM business-logic rows are sparse, so hallucination risk is not zero, but the sampled names are plausible and no clearly ungrounded rows are visible.
- No deterministic flags fired; all count-zero types are treated as correct absences under the rubric.

---

<!--GOLDEN_DATA:{"runId":"95d16402-5f3e-43de-83ad-a3274a2ed8de","score":4.9,"date":"2026-04-29","perType":{"interfaces":3,"endpoints":0,"logical_data_entities":0,"logical_data_attributes":0,"physical_data_entities":0,"physical_data_attributes":0,"logical_data_entity_relationships":0,"interface_logical_entities":0,"logical_data_entity_physical_data_entities":0,"logical_data_attribute_physical_data_attributes":0,"business_logics":12,"ui_screens":2,"ui_components":7},"adapterShare":0.8333333333333334,"perTypeAxes":{"interfaces":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"endpoints":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"logical_data_entities":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"logical_data_attributes":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"physical_data_entities":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"physical_data_attributes":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"logical_data_entity_relationships":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"interface_logical_entities":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"logical_data_entity_physical_data_entities":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"logical_data_attribute_physical_data_attributes":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"business_logics":{"coverage":4,"accuracy":5,"metadataRichness":4,"provenanceBalance":4},"ui_screens":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5},"ui_components":{"coverage":5,"accuracy":5,"metadataRichness":5,"provenanceBalance":5}}}-->
