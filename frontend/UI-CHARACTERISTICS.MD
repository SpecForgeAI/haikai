# UI Characteristics – Capture Guide (Risk Function)

This document explains the **four types of UI Characteristics** that can be captured in the Architecture & Design → UI section for **Risk** UIs.  
The goal is to provide a **consistent, lightweight current-state view** of frontend UIs that supports target-state design, platform decisions, and investment prioritisation.

Each UI Characteristic is linked to an **Application Point** (Application, Application Component, or Application Service).

---

## Summary of UI Characteristic Types

| Type | Description | Example (Risk) | Automated Discoverability |
|-----|-------------|----------------|----------------------------|
| **Business Feature** | Business-facing feature area the UI enables | View and analyse risk sensitivities | ~50–60% |
| **UI Capability** | Generic, cross-domain UI capability | Slice and dice sensitivities by desk and tenor | ~80–90% |
| **Interaction Complexity** | Structural characteristics of how users interact with the UI | Table-centric UI with deep drill-down | ~70–85% |
| **Technical Shape** | High-level technical traits of the frontend | React UI using Redux and REST APIs | ~90–100% |

> **Automated Discoverability** indicates how much of this information can typically be inferred by scanning the UI code repository (routes, components, dependencies, configuration), without manual analysis.

---

## 1. Business Feature

**Type:** `business_feature`

### What this captures
A **business-meaningful feature or capability** that the UI provides to Risk users.  
These align closely with *what the UI exists to do* from a Risk function perspective and often resemble delivery epics.

### Risk examples
- View risk sensitivities (Delta, Gamma, Vega)
- Analyse Value at Risk (VaR)
- Monitor stress test results
- Review limit breaches
- Investigate P&L explain
- Configure risk calculation parameters
- Validate market data inputs

### How to use it
- Use clear Risk-domain language
- Describe **user intent**, not UI mechanics
- Keep the scope broad but meaningful

### Key field behavior
- The **Key** field is free text
- No autocomplete suggestions are provided
- Keys are optional

### Automated discoverability (~50–60%)
Often inferred from:
- Route and screen names
- Navigation labels
- Feature/module folder names
- API domains (e.g. `riskSensitivityApi`, `varApi`)

Some interpretation is usually required.

---

## 2. UI Capability

**Type:** `ui_capability`

### What this captures
A **generic UI capability** provided by the UI, independent of the Risk domain.

These are especially useful for:
- comparing Risk UIs
- identifying duplicated functionality
- spotting candidates for shared UI/platform capabilities

### Risk-oriented examples
- Search trades or risk factors
- Filter sensitivities by book, desk, or currency
- Slice and dice VaR by portfolio and horizon
- Sort positions by risk contribution
- Drill down from firm-wide VaR to trade-level detail
- Compare stress scenarios side by side
- Export risk reports to CSV or Excel
- Receive alerts on limit breaches

### How to use it
- Capture **presence**, not quality
- One capability per row
- Use description sparingly for context

### Key field behavior
- Autocomplete suggests known capability keys
- Suggested keys may be selected or overridden
- Free text is always allowed

### Automated discoverability (~80–90%)
Usually detectable via:
- Table/grid and filter component usage
- Query-state and URL parameter patterns
- Export endpoints or libraries
- Bulk-selection UI patterns
- Notification/toast libraries

---

## 3. Interaction Complexity

**Type:** `interaction_complexity`

### What this captures
High-level **structural interaction characteristics** of the UI.  
This avoids subjective UX scoring and focuses on observable patterns.

### Risk examples
- Table-centric UI with large sensitivity grids
- Deep drill-down from portfolio → book → trade
- Multi-screen workflows for VaR approval
- Dashboard-style overview with KPIs and charts
- Single-entity focus (e.g. one portfolio at a time)
- Multi-entity comparison (e.g. portfolios side by side)

### How to use it
- Record factual, structural traits
- Focus on patterns that affect usability and change complexity
- Capture only the most relevant characteristics

### Key field behavior
- Autocomplete suggests common interaction keys
- Suggested keys may be overridden with free text

### Automated discoverability (~70–85%)
Often inferred from:
- Route and page counts
- Navigation depth
- Dominant component types (tables, forms, dashboards)
- Presence of stepper or wizard components

---

## 4. Technical Shape

**Type:** `technical_shape`

### What this captures
A **high-level technical snapshot** of the Risk UI implementation.  
This supports architectural alignment and platform discussions without deep code analysis.

### Risk examples
- React frontend using Redux Toolkit
- Angular UI with NgRx
- REST-based integration with risk calculation services
- GraphQL market data queries
- Shared internal Risk design system
- Unit and end-to-end test coverage present

### How to use it
- Capture stable, meaningful technical traits
- Avoid low-level implementation details
- One technical characteristic per row

### Key field behavior
- Autocomplete suggests common technical keys
- Suggested keys may be overridden with free text

### Automated discoverability (~90–100%)
Almost entirely derivable from:
- `package.json` dependencies
- Framework and build configuration
- State management setup
- API client libraries
- Test configuration files

---

## General Guidance

- UI Characteristics are designed to be **fast to capture** and **easy to compare**
- Consistency across Risk UIs is more important than perfect precision
- Avoid over-detailing; this is not a UX audit
- Use **Evidence** to note how a characteristic was identified (e.g. routes, components, APIs)
- Together, these characteristics help inform:
    - Risk UI target-state design
    - platform and capability consolidation
    - architectural and investment decisions
