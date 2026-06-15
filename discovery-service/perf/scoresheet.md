# Discovery Performance Scoresheet

Every auto-scored discovery run appends one row here. The "Best per
pack combo" section below is regenerated each time a run lands; it
shows the highest-scoring run per (language, framework) tuple.

Score interpretation (per `RUBRIC.md`):

- **4.5–5.0** — Excellent. Trust the run with light review.
- **3.5–4.4** — Good. Standard review burden.
- **2.5–3.4** — Mixed. Major type missing or noisy.
- **1.5–2.4** — Poor. Don't trust without re-scanning.
- **0–1.4** — Failed.

Rubric version: see the `rubricVersion` column. Cross-version comparisons should be made with care.

The `MM Types` column counts how many meta-model entity and relationship types the run was scored against (currently 13 — `interfaces`, `endpoints`, `logical_data_entities`, `logical_data_attributes`, `physical_data_entities`, `physical_data_attributes`, `logical_data_entity_relationships`, `interface_logical_entities`, `logical_data_entity_physical_data_entities`, `logical_data_attribute_physical_data_attributes`, `business_logics`, `ui_screens`, `ui_components`).

Within each score band below, rows are sorted by `(MM Types DESC, Score DESC)` — a run scoring 4.0 against 13 meta-model types ranks above a run scoring 4.4 against 11 types, since broader coverage is the primary progress signal.

---

## Best per pack combo

Updated automatically by `performancePostRun.ts` after every scored run.

**Canonical pack IDs** — only combos using one of the registered language packs (`cpp-lang`, `csharp-lang`, `go-lang`, `java-lang`, `javascript-lang`, `php-lang`, `python-lang`, `ruby-lang`, `typescript-lang`) and one of the registered framework packs (`angular`, `angularjs-classic`, `asp-net-core`, `asp-net-framework`, `django`, `flask`, `jquery`, `kratos`, `magento`, `nestjs`, `oatpp`, `rails`, `react-javascript`, `react-typescript`, `java-spring-boot`, `spring-classic`, `symfony`, `wordpress`, `wxwidgets`) appear here. New packs are added only when explicitly requested.

Each combo lives in exactly one band table below, determined by its current best score. When a new run beats the recorded best, `performancePostRun.ts` removes the row from its old band and inserts it into the band matching the new score.

### Excellent (4.5–5.0)

| Language | Framework(s) | Best Run | Score | Date | MM Types | Per-run | Notes |
|----------|--------------|----------|------:|------|---------:|---------|-------|
| `javascript-lang` | `angularjs-classic` | 95d16402-5f3e-43de-83ad-a3274a2ed8de | 4.9 | 2026-04-29 | 13 | [link](runs/2026-04-29-95d16402-svc-moaeh6n0.md) | HotTowel Reference. 83% adapter, 24 cands. |
| `java-lang` | `java-spring-boot` | c639f908-f001-460f-a8a3-5c8c759c1854 | 4.7 | 2026-04-26 | 11 | [link](runs/2026-04-26-c639f908-svc-mo19xx2z.md) | model-logic-service. 100% adapter, 531 cands. (new golden) |

### Good (3.5–4.4)

| Language | Framework(s) | Best Run | Score | Date | MM Types | Per-run | Notes |
|----------|--------------|----------|------:|------|---------:|---------|-------|
| `java-lang` | `spring-classic` | d6b40127-309a-44ee-8c8b-aba475e6457c | 4.0 | 2026-04-25 | 11 | [link](runs/2026-04-25-d6b40127-svc-mo4mclfb.md) | OpenMRS Core (golden). Strong on physical_data_entities, relationships, business_logics. api/ has no @Controller (REST in separate module). |
| `typescript-lang` | `react-typescript` | 9c4f51d6-ec16-4baf-b345-233180e47fb3 | 4.1 | 2026-04-25 | 11 | [link](runs/2026-04-25-9c4f51d6-svc-mo19xwmy.md) | Scenarios Frontend (golden). Strong on endpoints, ui_screens, ui_components. |
| `typescript-lang` | `angular` | 5ae44f56-2cfa-4498-a609-7ef864e0704e | 3.9 | 2026-04-25 | 11 | [link](runs/2026-04-25-5ae44f56-svc-moyv6pl2.md) | angular-realworld. 85% adapter. |
| `typescript-lang` | `nestjs` | 40014761-ead1-4e1e-845c-5f2f11d1d930 | 4.1 | 2026-04-25 | 11 | [link](runs/2026-04-25-40014761-svc-mo8nsfj7.md) | nestjs-realworld. 100% adapter, seed golden for combo. |
| `go-lang` | `kratos` | 3505485d-5c31-4540-b98b-40e543fb0152 | 3.5 | 2026-04-25 | 11 | [link](runs/2026-04-25-3505485d-svc-moas6iuv.md) | beer-shop-go. 65% adapter. |

### Mixed (2.5–3.4)

| Language | Framework(s) | Best Run | Score | Date | MM Types | Per-run | Notes |
|----------|--------------|----------|------:|------|---------:|---------|-------|
| `python-lang` | `django` | 7aff55ba-a5e7-4e52-a159-a5265d6838ad | 3.1 | 2026-04-25 | 11 | [link](runs/2026-04-25-7aff55ba-svc-mosqw9pa.md) | Saleor. 93% adapter, 1,293 candidates. |
| `python-lang` | `flask` | 13707813-0896-4c9b-8c24-0cda1badfc2f | 2.9 | 2026-04-25 | 11 | [link](runs/2026-04-25-13707813-svc-mo2c3k9k.md) | flask-microblog. 100% adapter. |
| `ruby-lang` | `rails` | f02178d8-9024-4441-9532-a915a6155524 | 3.0 | 2026-04-25 | 11 | [link](runs/2026-04-25-f02178d8-svc-mowyibpn.md) | Redmine. 87% adapter. (Discourse run failed on Windows long-paths.) |

### Poor (1.5–2.4)

| Language | Framework(s) | Best Run | Score | Date | MM Types | Per-run | Notes |
|----------|--------------|----------|------:|------|---------:|---------|-------|
| `javascript-lang` | `react-javascript` | 7258022c-2fb7-47e2-807f-7ed7c8460201 | 2.4 | 2026-04-25 | 11 | [link](runs/2026-04-25-7258022c-svc-modrxy6b.md) | react-redux-realworld. 6% adapter — pack room to improve. |
| `php-lang` | `wordpress` | 6d965189-34f9-4dc4-b6b4-e56b0d969a2e | 1.8 | 2026-04-25 | 11 | [link](runs/2026-04-25-6d965189-svc-moat53u0.md) | WordPress. 0% adapter — pack room to improve. |

### Failed (0–1.4)

| Language | Framework(s) | Best Run | Score | Date | MM Types | Per-run | Notes |
|----------|--------------|----------|------:|------|---------:|---------|-------|
| _no combos in this band yet_ | | | | | | | |

### Awaiting first run

Combos for registered packs that haven't yet had a successful scored run. Not a score band — listed here so we can see what's still on the to-do list. When a row in this list gets its first scored run, it moves into one of the band tables above.

| Language | Framework(s) | Notes |
|----------|--------------|-------|
| `csharp-lang` | `asp-net-core` | eShopOnWeb run hung server-side on LLM analysis; needs retry. |
| `csharp-lang` | `asp-net-framework` | eShopLegacyMVC clone failed (Windows long-paths fix applied; needs retry). |
| `php-lang` | `symfony` | OrangeHRM run hung server-side on LLM analysis; needs retry. |
| `php-lang` | `magento` | magento-lts run hung server-side on LLM analysis; needs retry. |
| `javascript-lang` | `jquery` | jquery-ui run hung server-side on LLM analysis; needs retry. |
| `cpp-lang` | `wxwidgets` | wxWidgets never attempted. |
| `cpp-lang` | `oatpp` | oatpp-crud never attempted. |

---

## All scored runs

| Date | RunId | Service | Language | Framework(s) | Mode | Tier | Total cands | Adapter % | Overall | Conf. | Rubric | MM Types | Golden | Per-run |
|------|-------|---------|----------|--------------|------|------|------------:|----------:|--------:|-------|-------:|---------:|:------:|---------|
| 2026-04-25 | d6b40127... | svc-mo4mclfb-213cv (OpenMRS Core) | java-lang | spring-classic | service-scoped | A | 3,511 | 65% | 4.0 | no-baseline | 1 | 11 | ✓ | [link](runs/2026-04-25-d6b40127-svc-mo4mclfb.md) |
| 2026-04-25 | 9c4f51d6... | svc-mo19xwmy-114u1 (Scenarios Frontend) | typescript-lang | react-typescript | service-scoped | A | 782 | 65% | 4.1 | no-baseline | 1 | 11 | ✓ | [link](runs/2026-04-25-9c4f51d6-svc-mo19xwmy.md) |
| 2026-04-25 | 526f24fa... | svc-mo19xx2z-1nw9s (Scenarios Service) | java-lang | java-spring-boot | service-scoped | A | 493 | 100% | 4.4 | no-baseline | 1 | 11 | ✓ | [link](runs/2026-04-25-526f24fa-svc-mo19xx2z.md) |
| 2026-04-25 | a7dc5c6c... | svc-mob4f5ai-h4yfj (PetClinic) | java-lang | java-spring-boot | A | A | 57 | 100% | 3.7 | baseline-anchored | 1 | 11 |  | [link](runs/2026-04-25-a7dc5c6c-svc-mob4f5ai.md) |
| 2026-04-25 | 5ae44f56... | svc-moyv6pl2-hxrbg (angular-realworld) | typescript-lang | angular | A | A | 155 | 85% | 3.9 | baseline-anchored | 1 | 11 | ✓ | [link](runs/2026-04-25-5ae44f56-svc-moyv6pl2.md) |
| 2026-04-25 | 40014761... | svc-mo8nsfj7-57h4r (nestjs-realworld) | typescript-lang | nestjs | A | A | 98 | 100% | 4.1 | no-baseline | 1 | 11 | ✓ | [link](runs/2026-04-25-40014761-svc-mo8nsfj7.md) |
| 2026-04-25 | 7aff55ba... | svc-mosqw9pa-5jlxc (Saleor) | python-lang | django | A | A | 1,293 | 93% | 3.1 | no-baseline | 1 | 11 | ✓ | [link](runs/2026-04-25-7aff55ba-svc-mosqw9pa.md) |
| 2026-04-25 | 7258022c... | svc-modrxy6b-4prqe (react-redux-realworld) | javascript-lang | react-javascript | A | A | 108 | 6% | 2.4 | no-baseline | 1 | 11 | ✓ | [link](runs/2026-04-25-7258022c-svc-modrxy6b.md) |
| 2026-04-25 | 13707813... | svc-mo2c3k9k-bdeas (flask-microblog) | python-lang | flask | A | A | 75 | 100% | 2.9 | baseline-anchored | 1 | 11 | ✓ | [link](runs/2026-04-25-13707813-svc-mo2c3k9k.md) |
| 2026-04-25 | f02178d8... | svc-mowyibpn-fecnk (Redmine) | ruby-lang | rails | A | A | 543 | 87% | 3.0 | no-baseline | 1 | 11 | ✓ | [link](runs/2026-04-25-f02178d8-svc-mowyibpn.md) |
| 2026-04-25 | 6d965189... | svc-moat53u0-gfnwb (WordPress) | php-lang | wordpress | A | A | 705 | 0% | 1.8 | no-baseline | 1 | 11 | ✓ | [link](runs/2026-04-25-6d965189-svc-moat53u0.md) |
| 2026-04-25 | 3505485d... | svc-moas6iuv-hh084 (beer-shop-go) | go-lang | kratos | A | A | 957 | 65% | 3.5 | baseline-anchored | 1 | 11 | ✓ | [link](runs/2026-04-25-3505485d-svc-moas6iuv.md) |
| 2026-04-26 | f31548a7... | svc-moat53u0-gfnwb (WordPress) | php-lang | wordpress | A | A | 721 | 0% | 1.8 | baseline-anchored | 1 | 11 |  | [link](runs/2026-04-26-f31548a7-svc-moat53u0.md) |
| 2026-04-26 | c639f908... | svc-mo19xx2z-1nw9s (model-logic-service) | java-lang | java-spring-boot | A | A | 531 | 100% | 4.7 | baseline-anchored | 1 | 11 | ✓ | [link](runs/2026-04-26-c639f908-svc-mo19xx2z.md) |
| 2026-04-29 | 95d16402... | svc-moaeh6n0-jogml (HotTowel Reference) | javascript-lang | angularjs-classic | A | A | 24 | 83% | 4.9 | no-baseline | 1 | 13 | ✓ | [link](runs/2026-04-29-95d16402-svc-moaeh6n0.md) |

---

Pack-level bugs and gaps surfaced by these runs are tracked in [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).
