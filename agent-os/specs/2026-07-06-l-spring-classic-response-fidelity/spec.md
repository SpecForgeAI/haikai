# Spec L — Spring Classic Pack Depth, Wave 1: Response Fidelity

**Program:** Code-Tier Oracle (see `agent-os/planning/2026-07-06-code-tier-oracle-gap-analysis.md`)
**Closes:** Gap P5 — response-shaping constructs a classic Spring estate uses that the scan
does not capture, so neither the spec nor the parity harness knows about them.
**User decision binding this spec:** parity scope is API-only — view-serving endpoints are
DETECTED and MARKED out-of-scope (visible finding), not given HTML parity.

## Goal

Everything that shapes an HTTP response in a classic Spring MVC application (XML + annotation
config, WAR, web.xml) is captured into the committed contracts: the full web.xml surface,
code-set headers, charset, interceptor/filter chains mapped onto endpoints, XML-defined MVC,
XML transaction advice, content negotiation, and view-endpoint classification.

All work lands in `discovery-service` (Spring Classic adapter + scanners + prompts) and
flows into the EXISTING `request_contract`/`response_contract` JSONB — no AMS schema change.

## Evidence / current gaps (pack audit, file refs in the gap analysis §5)

web.xml: only `<servlet-mapping>` parsed (`webXmlServletParser.ts`); filters/listeners/
error-pages/session-config/init-params ignored. Code-set headers
(`response.setHeader/addHeader`, `ResponseEntity` builder chains) not extracted; redirects
not extracted; `@CookieValue`/`@MatrixVariable`/multipart not in contracts; charset config
invisible; view resolution invisible (view endpoints indistinguishable from JSON);
pre-annotation XML MVC (SimpleUrl/BeanName handler mappings, Controller-interface impls)
not detected as endpoints; `mvc:interceptors`/HandlerInterceptors/filters are FINDINGS only,
never mapped onto the endpoints they wrap; XML `tx:advice`/`aop:config` transaction
boundaries not folded into transactional flags; ContentNegotiationManager + custom
HttpMessageConverters not captured; Security chain XML best-effort→`unresolved`.

## Scope

### 1. web.xml full extraction (`webXmlServletParser.ts` extension)

- `<filter>`/`<filter-mapping>`: class, url-patterns, dispatcher types, ORDER (document
  order is the chain order) → per-endpoint `response_contract.filters[]` (matched by
  url-pattern against endpoint paths) + app-level fact.
- `<error-page>` (error-code and exception-type forms) → merged into affected endpoints'
  `response_contract.error_responses[]` with `source: 'web-xml-error-page'` (app-global
  scope noted).
- `<listener>` → surfaced as candidates/findings (shared boundary with Spec M's
  ServletContextListener work — the PARSE lives here, the internal-process semantics there).
- `<session-config>` (timeout, cookie config), `<context-param>`/`<init-param>`,
  `<mime-mapping>` → app-level facts on the interface/application candidate.
- Encoding filters (CharacterEncodingFilter and equivalents) → `serialization.charset`
  fact per affected endpoint.

### 2. Code-set response facts (endpoint-reachable method scan)

New deterministic scanner over IR method bodies on endpoint paths:

- `HttpServletResponse.setHeader/addHeader/setContentType/setStatus/sendError/sendRedirect`
- `ResponseEntity` builder chains: `.header(...)`, `.contentType(...)`, `.location(...)`,
  `.cacheControl(...)`, status factory methods
- Cookie writes (`Cookie` + `addCookie`, `Set-Cookie` header writes)
→ `response_contract.headers[]` entries `{name, value_or_expression, source, conditional}`
(literal values verbatim; non-literal expressions carried as expressions with
`resolved:false` — nothing guessed) + `redirects[]` facts. Unresolvable dynamic header
names emit a `response_header_unresolved` evidence-gap finding (idiom of
`request_format_unresolved`).

### 3. Request-side completions (`requestContractScanner.ts`)

`@CookieValue`, `@MatrixVariable`, `@RequestPart`/`MultipartFile` metadata →
`request_contract.param_formats[]` with location cookie|matrix|multipart.

### 4. XML-defined MVC (new springClassic adapter passes)

- `SimpleUrlHandlerMapping`/`BeanNameUrlHandlerMapping`/`ControllerClassNameHandlerMapping`
  beans + `Controller`/`AbstractController` interface implementations → endpoint candidates
  (subtype `xml-mvc`), path from the mapping, verb defaulting per handler semantics
  (documented; `unknown_verb` marked, never guessed).
- `mvc:interceptors` + `HandlerInterceptor` registrations (XML and Java-config) →
  per-endpoint `response_contract.interceptors[]` (class, order, matched-pattern) —
  upgrading today's finding-only detection to endpoint-mapped facts.
- Spring Security XML: `intercept-url` patterns statically mapped → per-endpoint auth
  requirements where derivable; remainder keeps the explicit `unresolved` marker.

### 5. Transactions from XML

`tx:advice` + `aop:config` pointcut parsing → transactional flags on matched service
methods → flows into existing data-effect `transactional` derivation (today only
`@Transactional` annotations set it).

### 6. Content negotiation, converters, views

- ContentNegotiationManager config (XML/Java) + registered `HttpMessageConverter`s →
  `serialization` facts (media-type precedence, converter classes; custom converter
  classes flagged `serialization_converter_unresolved` when their wire effect is not
  statically derivable).
- View resolution: ViewResolver beans + view-returning handler methods
  (String view names, `ModelAndView`) → endpoint `response_kind: 'view-html'`
  (JSON/XML endpoints get `response_kind` too: `json`|`xml`). View endpoints emit finding
  `view_endpoint_out_of_parity_scope` (info) and are EXCLUDED from parity-scope inventory
  (Specs G/I/K consume `response_kind`) — visible, not silent.

### 7. Prompt + coverage updates

`prompts/frameworks/spring-classic.md` checklist updated to match (adapter-covered items
moved to the "do NOT re-emit" list); specification-coverage scanner unchanged (data-effect
bar stays authoritative).

## Non-goals

- HTML parity (future UI program). Quartz/Batch/JMS-XML/MyBatis-XML (Spec M).
  Locale/i18n and HttpSession-usage semantics (recorded as facts only if trivially
  available; full treatment deferred — listed in the program log as a known residual).

## Acceptance criteria

1. **WEB-XML PIN:** fixture web.xml with 2 filters (ordered), error-pages (code+exception),
   session-config, encoding filter → endpoint contracts carry filters in order, merged
   error_responses, charset; app facts present.
2. **HEADER PIN:** handler setting a literal header + a computed header → literal captured
   verbatim, computed carried as expression + `response_header_unresolved` finding.
3. **XML-MVC PIN:** SimpleUrlHandlerMapping fixture → endpoints emitted with paths;
   interceptor mapped onto exactly the endpoints its pattern matches.
4. **TX PIN:** `tx:advice` pointcut fixture → matched service method's data-effect edge
   `transactional: true` (annotation-free code).
5. **VIEW PIN:** ModelAndView handler → `response_kind: 'view-html'` +
   `view_endpoint_out_of_parity_scope` finding; JSON sibling gets `response_kind: 'json'`.
6. **COOKIE PIN:** `@CookieValue` param lands in request_contract with location cookie.
7. Cross-process wire-contract test extended (idiom:
   `springClassicCodeFormatWireContract.crossProcess.test.ts`) so gateway/AMS see the new
   contract fields unchanged through the wire.

## Test plan

Fixture-driven unit tests per scanner (pins 1–6) following the existing smoke/fixture
conventions; wire-contract cross-process test (pin 7); regression: existing springClassic
adapter suites stay green (baseline-red discipline). Contract-field additions are additive
JSONB — assert old consumers unaffected.

## Dependencies & sizing

Depends on: nothing (pure discovery depth). Feeds: H (richer verbatim facts), K (more
derivable dimensions), G/I (`response_kind` exclusion). Size: **L**. Build in parallel
with G/H; before M.
