# Performance Score — Run aa6b5ab6...

Scored at: 2026-04-25T19:44:26.972Z  ·  Rubric v1  ·  Confidence: no-baseline

**Overall: 2.0 / 5.0**

## Run identification

- **runId:** `aa6b5ab6-2a9b-490f-bb7b-3e169bd5bba5`
- **service:** svc-moas6iuv
- **pack combo:** go-lang / kratos
- **weight set:** backend-service
- **mode:** A, tier A

## Golden-anchor comparison

- No prior golden for this pack; this run becomes the seed golden if scoring succeeds.

## Deterministic flags

- **[warn] over-relying-on-llm** — Adapter share is 0% (target 50-70% for annotation-rich packs). Either the language pack is failing to extract IR (parser issue) or the framework pack predicate is not matching (techHints mismatch).
- **[warn] pure-llm-run** — 100% LLM-emitted candidates, 0% adapter. Either the language pack didn't fire (Tier C) or the framework pack predicate didn't match.

## Per-type scores

| Type | Count | Coverage | Accuracy | Metadata | Provenance | Score | Reasoning |
|---|--:|--:|--:|--:|--:|--:|---|
| `interfaces` | 2 | 1 | 1 | 2 | 0 | **1.0** | Coverage looks very thin for a Go/Kratos service, and the two samples appear misclassified as repository/interface-like classes rather than transport or service interfaces. Metadata only satisfies the minimal className fallback, and the type is entirely LLM-emitted despite the run being expected to have some deterministic extraction. |
| `endpoints` | 14 | 3 | 2 | 4 | 0 | **2.3** | There is plausible surface coverage for RPC-style operations, but several rows use invented HTTP methods like REGISTER, LOGIN, and LISTADDRESS rather than canonical verbs or clearly typed RPC/message metadata. Required endpoint fields are mostly populated, yet the all-LLM provenance and protocol confusion materially reduce confidence. |
| `logical_data_entities` | 18 | 3 | 3 | 4 | 2 | **3.0** | The entity count is plausible for a small-to-medium commerce-style service, and most sampled names look like real domain concepts. Some rows are sparse and a few omit className, but this type is more acceptable as LLM-heavy than adapter-heavy structural types. |
| `logical_data_attributes` | 28 | 3 | 3 | 5 | 2 | **3.3** | The attributes mostly align with the logical entities and appear internally consistent, with required logicalEntityName and fieldName populated in the samples. Coverage seems reasonable but not clearly comprehensive, and the lack of adapter support lowers confidence somewhat without making the type unusable. |
| `physical_data_entities` | 8 | 3 | 2 | 3 | 0 | **2.0** | Some persistence-layer coverage is present, but the samples show inconsistent normalization and likely duplication such as Users/User, Addresses/Address, Cards/card. Metadata is partially populated through tableName or entityClassName, but the pure-LLM provenance is a serious weakness for a type that should be more grounded. |
| `physical_data_attributes` | 65 | 4 | 2 | 5 | 0 | **2.8** | The attribute count is substantial and required fields are consistently populated in sample rows, suggesting decent structural detail. However, accuracy is dampened by likely schema hallucination or denormalized guessing around entities like Cards.user_cards and the broader absence of deterministic extraction. |
| `logical_data_entity_relationships` | 6 | 3 | 2 | 4 | 1 | **2.5** | Several relationships are plausible for the domain, but the set mixes logical and physical naming conventions such as User/Address alongside Users/Addresses, which suggests duplication or inferred rather than extracted structure. Cardinality is helpful metadata, yet provenance remains too LLM-heavy for strong trust. |
| `interface_logical_entities` | 0 | 0 | 0 | 0 | 0 | **0.0** | No interface-to-entity links were produced. For a backend-service run with endpoints and domain entities present, this leaves an important integration surface unmodeled. |
| `business_logics` | 47 | 4 | 3 | 2 | 0 | **2.3** | The business logic count is healthy and many sampled methods look like real use-case or service operations. But metadata richness is weak because sampled rows often only carry className without the required method name field in structured metadata, and the complete lack of adapter provenance is a major concern. |
| `ui_screens` | 0 | 0 | 0 | 0 | 0 | **0.0** | No UI screens were emitted. This is expected for a backend-service pack and does not affect the weighted overall because this type is skipped. |
| `ui_components` | 0 | 0 | 0 | 0 | 0 | **0.0** | No UI components were emitted. This is expected for a backend-service pack and does not affect the weighted overall because this type is skipped. |

## Cross-cutting axes

| Axis | Score |
|---|--:|
| Determinism | 0 |
| Hallucination rate | 2 |
| Coverage of obvious gaps | 2 |
| Cost | 3 |

## Anomalies

- This is a pure-LLM run: 188/188 candidates are LLM-emitted and adapter share is 0%, directly matching both deterministic warning flags.
- Endpoint samples show protocol/method confusion, with RPC-like operations mixed with nonstandard HTTP verbs such as REGISTER, LOGIN, and LISTADDRESS.
- Persistence modeling appears partially duplicated or inconsistently normalized, with singular/plural and case variants like User/Users, Addresses/Address, Cards/card.
- business_logics samples often lack the required structured method name in metadata even when the display label implies one, lowering metadata richness.
- interface_logical_entities is entirely missing despite the presence of endpoints, entities, and business logic, leaving cross-surface linkage weak.
- No cost baseline or duration was provided, so cost was scored conservatively rather than against pack-relative norms.

---

## Raw score JSON

```json
{
  "runId": "aa6b5ab6-2a9b-490f-bb7b-3e169bd5bba5",
  "scoredAt": "2026-04-25T19:44:26.972Z",
  "rubricVersion": "1",
  "packCombo": {
    "language": "go-lang",
    "frameworks": [
      "kratos"
    ]
  },
  "weightSet": "backend-service",
  "goldenAnchor": {
    "runId": null,
    "score": null
  },
  "deterministicFlags": [
    {
      "code": "over-relying-on-llm",
      "severity": "warn",
      "message": "Adapter share is 0% (target 50-70% for annotation-rich packs). Either the language pack is failing to extract IR (parser issue) or the framework pack predicate is not matching (techHints mismatch)."
    },
    {
      "code": "pure-llm-run",
      "severity": "warn",
      "message": "100% LLM-emitted candidates, 0% adapter. Either the language pack didn't fire (Tier C) or the framework pack predicate didn't match."
    }
  ],
  "perType": {
    "interfaces": {
      "count": 2,
      "axes": {
        "coverage": 1,
        "accuracy": 1,
        "metadataRichness": 2,
        "provenanceBalance": 0
      },
      "score": 1,
      "reasoning": "Coverage looks very thin for a Go/Kratos service, and the two samples appear misclassified as repository/interface-like classes rather than transport or service interfaces. Metadata only satisfies the minimal className fallback, and the type is entirely LLM-emitted despite the run being expected to have some deterministic extraction."
    },
    "endpoints": {
      "count": 14,
      "axes": {
        "coverage": 3,
        "accuracy": 2,
        "metadataRichness": 4,
        "provenanceBalance": 0
      },
      "score": 2.3,
      "reasoning": "There is plausible surface coverage for RPC-style operations, but several rows use invented HTTP methods like REGISTER, LOGIN, and LISTADDRESS rather than canonical verbs or clearly typed RPC/message metadata. Required endpoint fields are mostly populated, yet the all-LLM provenance and protocol confusion materially reduce confidence."
    },
    "logical_data_entities": {
      "count": 18,
      "axes": {
        "coverage": 3,
        "accuracy": 3,
        "metadataRichness": 4,
        "provenanceBalance": 2
      },
      "score": 3,
      "reasoning": "The entity count is plausible for a small-to-medium commerce-style service, and most sampled names look like real domain concepts. Some rows are sparse and a few omit className, but this type is more acceptable as LLM-heavy than adapter-heavy structural types."
    },
    "logical_data_attributes": {
      "count": 28,
      "axes": {
        "coverage": 3,
        "accuracy": 3,
        "metadataRichness": 5,
        "provenanceBalance": 2
      },
      "score": 3.3,
      "reasoning": "The attributes mostly align with the logical entities and appear internally consistent, with required logicalEntityName and fieldName populated in the samples. Coverage seems reasonable but not clearly comprehensive, and the lack of adapter support lowers confidence somewhat without making the type unusable."
    },
    "physical_data_entities": {
      "count": 8,
      "axes": {
        "coverage": 3,
        "accuracy": 2,
        "metadataRichness": 3,
        "provenanceBalance": 0
      },
      "score": 2,
      "reasoning": "Some persistence-layer coverage is present, but the samples show inconsistent normalization and likely duplication such as Users/User, Addresses/Address, Cards/card. Metadata is partially populated through tableName or entityClassName, but the pure-LLM provenance is a serious weakness for a type that should be more grounded."
    },
    "physical_data_attributes": {
      "count": 65,
      "axes": {
        "coverage": 4,
        "accuracy": 2,
        "metadataRichness": 5,
        "provenanceBalance": 0
      },
      "score": 2.8,
      "reasoning": "The attribute count is substantial and required fields are consistently populated in sample rows, suggesting decent structural detail. However, accuracy is dampened by likely schema hallucination or denormalized guessing around entities like Cards.user_cards and the broader absence of deterministic extraction."
    },
    "logical_data_entity_relationships": {
      "count": 6,
      "axes": {
        "coverage": 3,
        "accuracy": 2,
        "metadataRichness": 4,
        "provenanceBalance": 1
      },
      "score": 2.5,
      "reasoning": "Several relationships are plausible for the domain, but the set mixes logical and physical naming conventions such as User/Address alongside Users/Addresses, which suggests duplication or inferred rather than extracted structure. Cardinality is helpful metadata, yet provenance remains too LLM-heavy for strong trust."
    },
    "interface_logical_entities": {
      "count": 0,
      "axes": {
        "coverage": 0,
        "accuracy": 0,
        "metadataRichness": 0,
        "provenanceBalance": 0
      },
      "score": 0,
      "reasoning": "No interface-to-entity links were produced. For a backend-service run with endpoints and domain entities present, this leaves an important integration surface unmodeled."
    },
    "business_logics": {
      "count": 47,
      "axes": {
        "coverage": 4,
        "accuracy": 3,
        "metadataRichness": 2,
        "provenanceBalance": 0
      },
      "score": 2.3,
      "reasoning": "The business logic count is healthy and many sampled methods look like real use-case or service operations. But metadata richness is weak because sampled rows often only carry className without the required method name field in structured metadata, and the complete lack of adapter provenance is a major concern."
    },
    "ui_screens": {
      "count": 0,
      "axes": {
        "coverage": 0,
        "accuracy": 0,
        "metadataRichness": 0,
        "provenanceBalance": 0
      },
      "score": 0,
      "reasoning": "No UI screens were emitted. This is expected for a backend-service pack and does not affect the weighted overall because this type is skipped."
    },
    "ui_components": {
      "count": 0,
      "axes": {
        "coverage": 0,
        "accuracy": 0,
        "metadataRichness": 0,
        "provenanceBalance": 0
      },
      "score": 0,
      "reasoning": "No UI components were emitted. This is expected for a backend-service pack and does not affect the weighted overall because this type is skipped."
    }
  },
  "crossCutting": {
    "determinism": 0,
    "hallucinationRate": 2,
    "coverageOfObviousGaps": 2,
    "cost": 3
  },
  "overall": 2,
  "confidence": "no-baseline",
  "anomalies": [
    "This is a pure-LLM run: 188/188 candidates are LLM-emitted and adapter share is 0%, directly matching both deterministic warning flags.",
    "Endpoint samples show protocol/method confusion, with RPC-like operations mixed with nonstandard HTTP verbs such as REGISTER, LOGIN, and LISTADDRESS.",
    "Persistence modeling appears partially duplicated or inconsistently normalized, with singular/plural and case variants like User/Users, Addresses/Address, Cards/card.",
    "business_logics samples often lack the required structured method name in metadata even when the display label implies one, lowering metadata richness.",
    "interface_logical_entities is entirely missing despite the presence of endpoints, entities, and business logic, leaving cross-surface linkage weak.",
    "No cost baseline or duration was provided, so cost was scored conservatively rather than against pack-relative norms."
  ]
}
```
