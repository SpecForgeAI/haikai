# Golden Run — typescript-lang / angular

This file pins the historical anchor for this pack combo. Updated automatically when a new run beats the recorded score by more than 0.1.

**Current golden:** `5ae44f56-2cfa-4498-a609-7ef864e0704e`
**Score:** 3.9 / 5.0
**Date:** 2026-04-25
**Adapter share:** 85%
**Total candidates:** 155

## Anchor counts (per-type)

| Type | Count |
|---|--:|
| `interfaces` | 0 |
| `endpoints` | 25 |
| `logical_data_entities` | 15 |
| `logical_data_attributes` | 58 |
| `physical_data_entities` | 0 |
| `physical_data_attributes` | 0 |
| `logical_data_entity_relationships` | 0 |
| `interface_logical_entities` | 0 |
| `business_logics` | 28 |
| `ui_screens` | 8 |
| `ui_components` | 21 |

## Notable observations from the scoring LLM

- Adapter share rose to 85%, a major improvement over the 0% golden anchor, and deterministic extraction now covers endpoints, logical models, attributes, business methods, and components.
- The endpoints-missing-structure warning materially affects endpoint quality: 9 of 25 endpoint candidates lack a concrete path/url despite having an httpMethod.
- UI screens appear accurate but are entirely LLM-derived, suggesting Angular route extraction is still missing or not firing.
- interface_logical_entities is empty even though endpoints, components, and logical entities were detected; this is the most important remaining weighted coverage gap.
- No physical persistence candidates were emitted, which is appropriate for the Angular frontend-spa weight set.
- Cost appears in line with expectations for a 155-candidate run with only 15% LLM contribution; no runaway prompt or duration evidence was provided.

---

<!--GOLDEN_DATA:{"runId":"5ae44f56-2cfa-4498-a609-7ef864e0704e","score":3.9,"date":"2026-04-25","perType":{"interfaces":0,"endpoints":25,"logical_data_entities":15,"logical_data_attributes":58,"physical_data_entities":0,"physical_data_attributes":0,"logical_data_entity_relationships":0,"interface_logical_entities":0,"business_logics":28,"ui_screens":8,"ui_components":21},"adapterShare":0.8451612903225807}-->
