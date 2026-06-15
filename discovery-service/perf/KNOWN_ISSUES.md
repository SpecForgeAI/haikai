# Discovery Pack Known Issues

A backlog of concrete pack bugs and gaps found by analysing discovery
runs and per-run scoring output. Each issue describes a specific
extraction or behaviour gap — not just "run scored low" (the scoresheet
already shows that). Issues feed pack improvement work; resolved
entries are kept as a historical record of what was fixed.

Each issue is tagged with the language pack(s) and/or framework
pack(s) it relates to. Authoring is manual — diagnostic claims need
human analysis. `performancePostRun.ts` only maintains the file's
operational metadata: it updates `Last Seen` when a run on a tagged
pack lands, and surfaces `Auto-suggested leads` for human triage. It
never edits an issue's title, description, or severity, and never
auto-resolves a manual entry.

**Severity:**
- `blocker` — pack is unusable for real repos
- `high` — major coverage or accuracy gap
- `medium` — one extraction type missing, noisy, or under-engaging
- `low` — minor polish

**Source:**
- `manual` — diagnosed and authored by hand
- `auto-suggested` — surfaced from deterministic flags or LLM
  anomalies in `Auto-suggested leads`; promoted to a real Open entry
  only after human review

ID series is shared across Open / Resolved / Won't Fix — issues keep
their ID for life. Auto-suggested leads do not allocate IDs.

## How to author an Open issue (template)

Each Open issue has TWO things: a single row in the Open table at the
top of the section, and a richer block below. The block must be
self-contained enough that a fresh Claude Code session, given only
this file and the codebase (no prior conversation context), can
implement the fix without further questions.

The block format below is mandatory for Open issues — see ISS-002 for
a worked example. `performancePostRun.ts` only auto-edits the table
row's `Last Seen` cell and the "Auto-suggested leads" table; it never
touches the rich block.

```markdown
### ISS-### — <one-line title>

- **Severity:** blocker / high / medium / low
- **Language pack(s):** `<id>` (or `_n/a_`)
- **Framework pack(s):** `<id>` (or `_n/a_`)
- **First seen:** run `<full-runId>` on YYYY-MM-DD
- **Last seen:** same / `<runId>` on YYYY-MM-DD (auto-updated)
- **Source:** manual
- **Evidence (per-run report):** [link](runs/<file>.md) — read the
  per-type reasoning + sampled candidates here before changing code.
- **Test repo / service:** `<repoUrl>` (project `<projectId>`,
  service `<serviceId>` — see `test-repos-projects.md`).

**Symptom.** Concrete observation (counts, scores, what's missing).

**Hypothesis.** Best current theory of the cause, with caveats.

**Files to edit / investigate.**
- `discovery-service/src/services/...` — what's expected to change here
- `discovery-service/src/services/...` — second file if applicable

**Reference implementation (if any).** Point at an existing pack /
adapter / extractor that already handles the similar case, with
specific function names or line ranges.

**Test fixture & expected output.** A small input snippet (or a path
to a fixture file) plus the candidates the fix should emit. Lets the
implementing session write a unit test before re-running discovery.

**Verification recipe.**
- Pre-fix baseline: adapter % `<X>`, overall `<Y>` (band `<Z>`).
- After fix re-run via the manual recipe in
  [`OPERATOR_GUIDE.md`](./OPERATOR_GUIDE.md) §5 against
  service `<serviceId>`. Expected: adapter % ≥ `<N>`, overall ≥ `<M>`
  (band `<target-band>`).
- Concrete commands:
  ```bash
  curl -sS -X POST http://localhost:8080/api/projects/<pid>/activate
  curl -sS -X POST http://localhost:8091/discovery/runs \
    -H "Content-Type: application/json" \
    -d '{"projectId":"<pid>","serviceId":"<sid>","confirmLlmSolo":true}'
  ```

**Acceptance criteria.**
- Bullet 1 (concrete, testable)
- Bullet 2
- All existing pack tests still pass.
```

After fixing, move the table row from `## Open` to `## Resolved`,
preserve the ID, condense the rich block down to one `Resolved` row
with a concise "Resolution" cell summarising what was changed and why.

---

## Open

| ID | Severity | Lang Pack | Framework Pack | First Seen | Last Seen | Title |
|----|----------|-----------|----------------|------------|-----------|-------|
| ISS-002 | medium | `javascript-lang` | `react-javascript` | 2026-04-25 / `7258022c` | 2026-04-25 / `7258022c` | react-javascript pack matches but extracts very little (6 % adapter) on react-redux |
| ISS-003 | low | `java-lang` | `spring-classic` | 2026-04-25 / `d6b40127` | 2026-04-25 / `d6b40127` | OpenMRS api/ module has no `@Controller` — REST is in a separate module, so the pack reports lower endpoint coverage on this repo (structural, may be Won't Fix once confirmed) |

### ISS-002 — react-javascript pack under-engages on react-redux repo

- **Severity:** medium
- **Language pack(s):** `javascript-lang`
- **Framework pack(s):** `react-javascript`
- **First seen:** run `7258022c-2fb7-47e2-807f-7ed7c8460201` on 2026-04-25
- **Last seen:** same
- **Source:** manual
- **Evidence (per-run report):** [link](runs/2026-04-25-7258022c-svc-modrxy6b.md) — see per-type reasoning especially for `interfaces`, `business_logics`, and `ui_components`; the LLM scorer noted very low adapter participation across the board.
- **Test repo / service:** `https://github.com/gothinkster/react-redux-realworld-example-app`
  (project `9c6f0fb5-7a72-4eef-b868-cc18ac036a96`,
  service `svc-modrxy6b-4prqe` — see `test-repos-projects.md`).

**Symptom.** Pack engaged (it produced rows) but adapter share was only
**6 %** out of 108 candidates; LLM gap-fill carried the rest. Score
**2.4 (Poor band)**. The companion `react-typescript` pack scored 4.1 on
a comparable repo (Scenarios Frontend), so the gap is on the JS side
specifically.

**Hypothesis.** Note that `reactJavascriptFrameworkPack` and
`reactTypescriptFrameworkPack` **both delegate to the same shared
adapter** `frameworkAdapters/reactAxios/index.ts` — see the file
headers, line 1–20 of each. So the divergence must come from the
**language extractor** (the IR feeding the adapter), not the adapter
itself. Most likely candidates:
1. The JavaScript extractor under-populates fields the adapter relies
   on — JSX detection, function-component identification, axios/fetch
   call-site capture, ES module shape (named exports, default exports).
2. The Redux idioms in this repo (action-type constants, reducer
   functions, selector functions, `connect(mapStateToProps,
   mapDispatchToProps)(Component)`) produce module-level expressions
   the adapter currently doesn't look for.

**Files to edit / investigate.**
- `discovery-service/src/services/extensionPacks/languageExtractors/javascript/extract.ts` — primary suspect; diff against the typescript extractor below.
- `discovery-service/src/services/extensionPacks/languageExtractors/typescript/extract.ts` — reference: what does it populate that the JS one doesn't? Check `allCalls`, `rawContent`, JSX handling, decorator/annotation collection.
- `discovery-service/src/services/extensionPacks/frameworkAdapters/reactAxios/index.ts` — the shared adapter. If the IR is right but the adapter only emits when certain TS-only fields are present, broaden it here.
- `discovery-service/src/__tests__/reactAxiosAdapter.smoke.test.ts` (and any `reactJavascript*.test.ts`) — extend with Redux-pattern fixtures.

**Reference implementation.** The Spring Boot adapter's path
`processController` (in `frameworkAdapters/springBoot/index.ts`,
~line 350) shows the shape: extract metadata from annotations, emit a
parent `interfaces` candidate, then iterate methods emitting child
candidates with `parentCandidateId`. For React the analogue is: emit
the component class/function as `interfaces` (or `ui_components`), then
walk its render tree / hooks / Redux wiring for child candidates.

**Test fixture & expected output.** A minimal Redux + React module:

```js
// counter/actions.js
export const INCREMENT = 'counter/INCREMENT';
export const increment = () => ({ type: INCREMENT });

// counter/reducer.js
import { INCREMENT } from './actions';
export default function counter(state = 0, action) {
  switch (action.type) {
    case INCREMENT: return state + 1;
    default: return state;
  }
}

// counter/Counter.jsx
import React from 'react';
import { connect } from 'react-redux';
import { increment } from './actions';
function Counter({ count, increment }) {
  return <button onClick={increment}>{count}</button>;
}
export default connect(s => ({ count: s.counter }), { increment })(Counter);
```

Expected adapter emissions (at minimum):
- `ui_components` — `Counter` (functional component returning JSX)
- `business_logics` — `counter` (reducer; subtype `redux-reducer`)
- `business_logics` — `increment` (action creator; subtype `redux-action-creator`) OR a `logical_data_entities` row for the action type constant — pick whichever maps cleanest, document the choice in code comments

**Verification recipe.**
- Pre-fix baseline: 108 cands, 6 % adapter, overall 2.4 (Poor).
- After fix re-run via the manual recipe in
  [`OPERATOR_GUIDE.md`](./OPERATOR_GUIDE.md) §5 against
  service `svc-modrxy6b-4prqe`. Expected: adapter % ≥ 50, overall ≥
  3.0 (Mixed band or better).
- Concrete commands:
  ```bash
  curl -sS -X POST http://localhost:8080/api/projects/9c6f0fb5-7a72-4eef-b868-cc18ac036a96/activate
  curl -sS -X POST http://localhost:8091/discovery/runs \
    -H "Content-Type: application/json" \
    -d '{"projectId":"9c6f0fb5-7a72-4eef-b868-cc18ac036a96","serviceId":"svc-modrxy6b-4prqe","confirmLlmSolo":true}'
  # poll until status=COMPLETED, then:
  grep "<runIdPrefix>" discovery-service/perf/scoresheet.md
  ```

**Acceptance criteria.**
- Adapter share ≥ 50 % on the verification re-run.
- Overall score ≥ 3.0 (Mixed band or better).
- A new unit test in `src/__tests__/` covering at least the reducer
  + action-creator + functional-component detection from the fixture
  above passes.
- `Scenarios Frontend` re-run does NOT regress (still ≥ 4.0) — the
  same shared adapter is in play.
- All existing pack tests still pass.

---

### ISS-003 — spring-classic: OpenMRS api/ module has no @Controller

- **Severity:** low
- **Language pack(s):** `java-lang`
- **Framework pack(s):** `spring-classic`
- **First seen:** run `d6b40127-309a-44ee-8c8b-aba475e6457c` on 2026-04-25
- **Last seen:** same
- **Source:** manual
- **Evidence (per-run report):** [link](runs/2026-04-25-d6b40127-svc-mo4mclfb.md) — note especially the `endpoints` per-type reasoning (the LLM scorer flagged the missing REST surface).
- **Test repo / service:** `https://github.com/openmrs/openmrs-core` (currently scoped to `api/`)
  (project `332726ca-770c-495c-a811-da542e4e1a04`,
  service `svc-mo4mclfb-213cv` — see `test-repos-projects.md`).

**Symptom.** Adapter share 65 % (otherwise healthy), overall 4.0 (Good).
The `api/` folder has no `@Controller` annotations because OpenMRS
publishes REST endpoints from a separate Maven module
(`openmrs-module-webservices.rest`, repo
`openmrs/openmrs-module-webservices.rest`) that isn't in the current
scan scope. Almost certainly **not a pack bug** — the pack correctly
extracted what was there.

**Hypothesis.** Either widen the scope of the existing service entity
to include the REST module, or accept the limitation and close as
Won't Fix. There's no pack-side change required to validate this.

**Files to edit / investigate.** *(scope-only change; no source code
changes expected unless the investigation surprises us)*
- `discovery-service/perf/test-repos-projects.md` — the `OpenMRS` row's
  `Repo Subfolder` cell would need to be updated (or cleared for a
  whole-repo scan).
- The service entity's `repo_subfolder` / `repo_location` in the
  architecture-model-service may need re-pointing at the rest module's
  repo URL OR at a multi-module checkout.

**Reference implementation.** N/A — this is a service-entity scope
adjustment, not a pack improvement.

**Test fixture & expected output.** N/A.

**Verification recipe.**
- Pre-fix baseline: 3,511 cands, 65 % adapter, overall 4.0 (Good).
- After widening scope, re-run via the manual recipe in
  [`OPERATOR_GUIDE.md`](./OPERATOR_GUIDE.md) §5 against service
  `svc-mo4mclfb-213cv`. Expected: endpoints count rises noticeably
  (the REST module typically registers dozens), adapter % stays high.
- If endpoints count rises and overall stays ≥ 4.0, close the issue
  with the new scope captured in `test-repos-projects.md`.
- If counts don't rise, that confirms the REST module wasn't picked up
  by the scope change → investigate scan plan / file selection.

**Acceptance criteria.** *(only one of:)*
- Re-run shows endpoints ≥ 30 and adapter % ≥ 60 — close as Resolved
  with the scope change documented.
- Or: investigation confirms multi-module monorepos aren't currently
  supported and adding support is out of scope — close as Won't Fix.

---

## Investigating

| ID | Severity | Lang Pack | Framework Pack | First Seen | Last Seen | Title |
|----|----------|-----------|----------------|------------|-----------|-------|
| _no issues currently being investigated_ | | | | | | |

---

## Resolved

Historical record of pack bugs that were diagnosed and fixed. Useful
when reasoning about whether a regression has reappeared.

| ID | Severity | Lang Pack | Framework Pack | First Seen | Resolved | Title | Resolution |
|----|----------|-----------|----------------|------------|----------|-------|------------|
| ISS-004 | high | `java-lang` | `spring-classic` | 2026-04-22 (pre-perf) | 2026-04-23 | spring-classic adapter missed `@Configuration` / `@Bean` / `@Import` / `@ComponentScan` | Extended `frameworkAdapters/springClassic/index.ts` to capture them; added `@Enable*` annotation handling and bean-class collapse so duplicate bean names don't fragment. Verified against current working tree (897-line diff in that file). |
| ISS-005 | high | `java-lang` | `spring-classic` | 2026-04-22 (pre-perf) | 2026-04-23 | HBM XML parser didn't handle Hibernate inheritance forms | Added `joined-subclass`, `subclass`, and `union-subclass` support in `languageExtractors/java/hbmXmlParser.ts` (with `stripNestedSubclassBlocks` helper). 98-line diff in that file. |
| ISS-006 | medium | `java-lang` | `spring-classic` | 2026-04-23 | 2026-04-24 | No support for legacy Spring `applicationContext.xml` bean definitions | Added new `languageExtractors/java/springBeansXmlParser.ts` and wired it into the Java extractor (`extract.ts` 5-line addition). |
| ISS-007 | medium | `java-lang` | `spring-classic` | 2026-04-23 | 2026-04-24 | AOP, message-driven, and outbound-integration patterns weren't captured | Extended adapter to detect AOP advice, JMS/AMQP listeners, and outbound integration beans (RestTemplate / WebClient / FeignClient call sites). |
| ISS-008 | low | _all_ | _all_ | 2026-04-23 | 2026-04-24 | LLM gap-fill emitted ALL_CAPS interface names and arrow-function placeholder names | Added structured-metadata gate, ALL_CAPS interface drop, arrow-name auto-enrich in `llmGapFillStep.ts` (194-line diff). |
| ISS-001 | high | `php-lang` | `wordpress` | 2026-04-25 / `6d965189` | 2026-04-25 | wordpress framework pack didn't engage on real WordPress repo (0 % adapter) | Root cause: PHP IR captured calls only inside function/method bodies, but WordPress core wires most of its architecture through file-level `add_action` / `add_filter` calls that sit outside any function — the adapter had nothing to look at on the core repo. Fix: (1) `languageExtractors/php/extract.ts` now populates `SourceFileIR.allCalls` with every call in the file regardless of nesting (the field existed for typescript already; PHP just didn't fill it in). (2) `frameworkAdapters/wordpress/index.ts` rewritten to consume `file.allCalls` and broaden its detection surface — adds `business_logics` for `add_action` / `add_filter`, `ui_screens` for the `add_menu_page` family, `logical_data_entities` for `register_setting`, `ui_components` for `register_sidebar` / `register_widget`, plus class-side detection for `WP_List_Table`, `WP_Screen`, and `WP_Customize_*`. REST-controller match now handles namespace-qualified parent names (e.g. `\WP_REST_Controller`). Smoke test 4/4 (5 → 7 candidates on the fixture). Real-WordPress re-run pending. |
| ISS-009 | high | _all_ | _all_ | 2026-04-27 (Kiro session) | 2026-04-27 | Runtime pack selector and tier gate disagreed: tier gate trusted `core_tech_framework_packs` (pack IDs); runtime trusted `core_tech_resolved.frameworks[].name` (LLM-resolver free text). Resolver wrote `"Spring Framework"`, predicate wanted bare `"Spring"` → no match → 0 % adapter | Root cause: dual-source-of-truth between the tier gate (`computeTier` reads pack IDs) and the runtime pack selector (`techHintsFromResolvedColumns` → `findFrameworkPacks` reads free-text names that the LLM resolver may emit in any predicate-incompatible form). Diagnosed during a Kiro session on the work machine; this codebase received the equivalent fix on 2026-04-27. Fix (option C from Kiro's three options): added `getLanguagePackById` / `getFrameworkPackById` to `extensionPackRegistry.ts`. `techHintsFromResolvedColumns` (in `runManager.ts`) now takes `core_tech_language_pack` + `core_tech_framework_packs` alongside `core_tech_resolved` and prefers the registered pack's `when`-clause values when a pack ID is set — guaranteeing the runtime selector matches what the tier gate validated. Resolved free-text names remain a fallback for tier-C runs without pack IDs. Tests in `discoveryV3Pipeline.techHints.test.ts` + `extensionPackRegistryV3.test.ts` still pass; type-check clean. **Side effects:** the manual workaround in `fix-test-repo-tech-hints.py` (writing predicate-compatible names by hand) is no longer required when pack IDs are set, and `OPERATOR_GUIDE.md` §4 can be relaxed accordingly. **Companion fixes from the same Kiro session, applied here at the same time:** (a) gateway `discoveryPerformanceScore.ts` switched from importing `sendChatRequest` directly out of `openaiClient` to going through `getLlmClient()` so it routes via Azure when `LLM_PROVIDER=azure-openai`; (b) added `POST /:runId/rescore` to discovery-service `runs.ts` + the matching `/runs/:runId/rescore` proxy in gateway `discovery.ts` for re-scoring an existing COMPLETED run synchronously; (c) gateway `discoveryPerformanceScore.ts` now forwards the real LLM error message in 500 responses, and discovery-service `gatewayClient.ts.scoreDiscoveryPerformance` includes the gateway response body in the thrown error so debug files surface the real upstream cause. |

---

## Won't Fix

| ID | Severity | Lang Pack | Framework Pack | First Seen | Closed | Title | Reason |
|----|----------|-----------|----------------|------------|--------|-------|--------|
| _no won't-fix issues yet_ | | | | | | | |

---

## Auto-suggested leads

Surfaced automatically by `performancePostRun.ts` from deterministic
flags and LLM `anomalies` arrays in the per-run scoring. **Not
issues** — these are rough hints. Promote a lead to an Open issue
only after human analysis (open the per-run MD, look at samples,
form a real diagnosis). Leads are never auto-pruned; clear them
manually when triaged.

| First Seen | Last Seen | Lang Pack | Framework Pack | Source | Lead |
|------------|-----------|-----------|----------------|--------|------|
| 2026-04-26 / `f31548a7` | 2026-04-26 / `f31548a7` | `php-lang` | `wordpress` | LLM anomaly | The run is 100% LLM-emitted with 0 adapter candidates, directly matching the over-relying-on-llm and pure-llm-run warnings. |
| 2026-04-26 / `f31548a7` | 2026-04-26 / `f31548a7` | `php-lang` | `wordpress` | LLM anomaly | Counts are broadly similar to the low-scoring golden anchor, so this appears to reproduce the same systemic extraction failure rather than improve the pack. |
| 2026-04-26 / `f31548a7` | 2026-04-26 / `f31548a7` | `php-lang` | `wordpress` | LLM anomaly | Major fullstack WordPress surfaces are absent: interfaces, endpoints, physical data entities, physical data attributes, and interface-logical mappings all have zero candidates. |
| 2026-04-26 / `f31548a7` | 2026-04-26 / `f31548a7` | `php-lang` | `wordpress` | LLM anomaly | Nonzero samples are often plausible and metadata-rich, especially business logic and UI components, but the lack of deterministic provenance makes review burden high. |
| 2026-04-26 / `f31548a7` | 2026-04-26 / `f31548a7` | `php-lang` | `wordpress` | LLM anomaly | Duration and cost details are unknown, so cost is scored neutral rather than penalized for runaway usage. |
| 2026-04-26 / `f31548a7` | 2026-04-26 / `f31548a7` | `php-lang` | `wordpress` | flag:over-relying-on-llm | Adapter share is 0% (target 50-70% for annotation-rich packs). Either the language pack is failing to extract IR (parser issue) or the framework pack predicate is not matching (techHints mismatch). |
| 2026-04-26 / `f31548a7` | 2026-04-26 / `f31548a7` | `php-lang` | `wordpress` | flag:pure-llm-run | 100% LLM-emitted candidates, 0% adapter. Either the language pack didn't fire (Tier C) or the framework pack predicate didn't match. |
| 2026-04-26 / `c639f908` | 2026-04-26 / `c639f908` | `java-lang` | `java-spring-boot` | LLM anomaly | No deterministic flags were raised, and all major Spring Boot backend surfaces are present. |
| 2026-04-26 / `c639f908` | 2026-04-26 / `c639f908` | `java-lang` | `java-spring-boot` | LLM anomaly | Counts are very close to the golden anchor: interfaces, physical entities, physical attributes, and relationships match exactly; endpoints and DTO-derived logical surfaces are slightly higher. |
| 2026-04-26 / `c639f908` | 2026-04-26 / `c639f908` | `java-lang` | `java-spring-boot` | LLM anomaly | Adapter provenance is extremely high at 529 of 531 candidates, which is appropriate for annotation-rich Spring/JPA extraction and matches the historical anchor, though it leaves little LLM gap-fill contribution to assess. |
| 2026-04-26 / `c639f908` | 2026-04-26 / `c639f908` | `java-lang` | `java-spring-boot` | LLM anomaly | Duration and concrete cost were not provided, but total candidate volume and provenance mix do not suggest runaway prompt usage. |
| 2026-04-29 / `95d16402` | 2026-04-29 / `95d16402` | `javascript-lang` | `angularjs-classic` | LLM anomaly | No golden anchor exists for javascript-lang / angularjs-classic, so this score is absolute and confidence is no-baseline. |
| 2026-04-29 / `95d16402` | 2026-04-29 / `95d16402` | `javascript-lang` | `angularjs-classic` | LLM anomaly | The run is small with 24 total candidates, but the candidate mix is coherent for a compact AngularJS SPA: modules, routes, directives, and services/factories. |
| 2026-04-29 / `95d16402` | 2026-04-29 / `95d16402` | `javascript-lang` | `angularjs-classic` | LLM anomaly | Adapter share is high at 83%, which is appropriate for statically declared AngularJS modules, routes, factories, providers, and directives; the LLM contribution is limited to plausible gap-fill business logic. |
| 2026-04-29 / `95d16402` | 2026-04-29 / `95d16402` | `javascript-lang` | `angularjs-classic` | LLM anomaly | LLM business-logic rows are sparse, so hallucination risk is not zero, but the sampled names are plausible and no clearly ungrounded rows are visible. |
| 2026-04-29 / `95d16402` | 2026-04-29 / `95d16402` | `javascript-lang` | `angularjs-classic` | LLM anomaly | No deterministic flags fired; all count-zero types are treated as correct absences under the rubric. |
