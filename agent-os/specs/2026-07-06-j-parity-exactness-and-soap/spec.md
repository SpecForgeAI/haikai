# Spec J — Parity Exactness & First-Class SOAP

**Program:** Code-Tier Oracle (see `agent-os/planning/2026-07-06-code-tier-oracle-gap-analysis.md`)
**Closes:** Gap P2 — the comparator cannot assert exactness, and SOAP is envelope-blind.
**User decision binding this spec:** apps under migration may be **100% SOAP** or 100% REST —
SOAP support is core, not conditional. HTML/view parity is OUT (API-only for now).

## Goal

The parity harness can PROVE "THE EXACT response": a strict comparison mode with
byte-level fidelity and explicit, durable, reasoned waivers for every tolerated
difference — and it speaks SOAP end-to-end (WSDL-driven capture, envelope replay,
XML-aware comparison) with the same rigor as JSON/REST.

## Evidence / current behaviour (all in `api-migration-validation-service`)

- No strict/canonical/byte mode exists (verified). Comparator (`jsonShapeComparator.ts`)
  is parse-then-walk: whitespace/key-order/numeric-literal formatting (`1.0` vs `1.00`)
  are invisible; non-volatile array reorder classifies `body_ordering_drift` (advisory per
  spec 2026-06-17).
- Header policy is a fixed 18-name allowlist in code; value drift on allowlisted names is
  tolerated, presence drift always breaks; `Content-Type` not allowlisted (good).
- Raw response BYTES are not persisted — `response_json` stores the parsed body; strict
  byte comparison is impossible retroactively.
- SOAP: WSDL upload 400-rejected (`contractFormatDetector.ts:15–17,156`); capture sessions
  CAN pre-populate SOAP operations from committed model metadata (seven `x-amvs-soap`
  fields; `captureSessionActions.soapPrepop.test.ts`) but envelope construction is left to
  the capture LLM and XML bodies compare as blunt strings (a reformat = value drift; no
  volatility pathing inside XML).
- Volatility science (k=3 probes, per-path envelopes, endpoint signals) is GOOD — retained.

## Scope

### 1. Raw-body fidelity (prerequisite for strictness)

- Persist the raw response body bytes (or, where size-prohibitive, a canonical-form digest
  + declared charset + length) alongside the parsed body for BOTH current captures and
  target replays. AMS `api_behaviour` tables gain the column(s) via a NEW Liquibase
  changeset. Existing rows: null = "raw unavailable" → strict mode degrades to
  structural-strict with an explicit `raw_unavailable` marker (nothing silent).

### 2. Comparison profiles

- `comparison_profile` on diff creation: `standard` (today's semantics, default for
  backward compatibility) | `strict`.
- **Strict semantics:**
  - Bodies: byte equality of raw bodies AFTER (a) applying redaction consistently and
    (b) masking ONLY explicitly waived/probed-volatile paths (masking is positional over
    the parsed tree, re-serialized canonically for the compare; the unmasked remainder
    must be byte-identical in canonical form; if NO masks apply, compare raw bytes
    directly).
  - Arrays: order always significant.
  - Headers: any value or presence drift breaks unless waived (see §3). The in-code
    allowlist is REPLACED by seeded waiver rows.
  - Status: exact.
  - Numeric/format fidelity follows from byte comparison.
- Classification vocabulary gains `byte_drift` (strict-only) while retaining existing
  classes for standard mode; finding-emission rules extended accordingly.

### 3. Durable comparison-policy waivers

- AMS-persisted waiver records: scope (endpoint or global) × dimension (header name |
  body path/pointer | XML XPath | ordering-at-path) × reason × author × created_at.
  Supersedes/extends Spec I's interim break-fingerprint waivers (same table, richer scope).
- Default seeds: today's 18 header names inserted as visible, editable waiver rows
  (provenance `seed:legacy-allowlist`).
- Diff results annotate every tolerated difference with the waiver id — an "exact" verdict
  is therefore exact-modulo-enumerated-waivers, and the enumeration is part of the verdict.

### 4. First-class SOAP

- **WSDL ingestion:** accept WSDL upload (reuse/port `discovery-service`'s
  `springClassicSoap/wsdlParser.ts` — verified capable) → operations into the OAS-equivalent
  inventory (operation name, soap_action, input/output message shapes from XSD, endpoint
  address templates). The 400 rejection path is removed.
- **Envelope construction:** deterministic envelope builder from WSDL message parts +
  committed `x-amvs-soap` metadata (namespaces, root elements) + scenario values; capture
  LLM fills VALUES only, never structure. SOAPAction header set; POST to the endpoint
  address.
- **Replay:** target replay reuses the captured raw envelope verbatim (byte-identical
  request replay — no re-generation drift).
- **XML-aware comparison:** parse-compare with namespace normalization (prefix-insensitive,
  URI-sensitive), attribute-order insensitivity, explicit whitespace policy
  (element-content significant, inter-element ignorable per XML canonicalization rules);
  volatility/waiver paths addressed by XPath; strict mode compares C14N-canonical bytes.
  SOAP Fault responses are first-class comparable payloads (faultcode/faultstring/detail).
- **Volatility probing for SOAP:** k-replay probe permitted for operations whose committed
  data effects say read-only (`safe_to_execute` seed logic already exists AMS-side);
  otherwise `not_probed` as today.
- HTML/binary: out of scope for exactness work (API-only decision); behaviour unchanged
  (documented).

## Non-goals

- Multi-step/stateful scenario composition beyond the existing sequence support.
- UI redesign (waiver management can live on existing diff/review surfaces minimally).
- HTML/view parity (future UI-migration program).

## Acceptance criteria

1. **STRICT PIN:** two bodies equal-as-JSON but differing in key order / numeric literal
   (`1.0` vs `1.00`) / whitespace → `standard` says match, `strict` says `byte_drift`.
2. **MASK PIN:** strict + a probed-volatile path → that path masked, remainder
   byte-compared; a drift OUTSIDE the mask still breaks.
3. **ORDER PIN:** non-volatile array reorder → strict breaks (hard), standard classifies
   `body_ordering_drift` as today.
4. **WAIVER PIN:** header value drift on a seeded-waiver name → tolerated WITH waiver id
   on the diff entry; deleting the waiver row → same diff breaks. No in-code allowlist
   remains.
5. **WSDL PIN:** WSDL upload → operations parsed into inventory (golden fixture);
   the old 400 path is gone.
6. **ENVELOPE PIN:** envelope built from fixture WSDL + metadata is schema-valid and
   byte-stable across runs; target replay sends the captured envelope byte-identically.
7. **XML PIN:** namespace-prefix-only difference → match; element value difference →
   value drift with XPath; strict compares C14N bytes; SOAP Fault vs success → status+body
   drift, fault fields addressable.
8. **RAW PIN:** legacy rows without raw bytes → strict verdict carries `raw_unavailable`
   degradation marker, never a false "exact".

## Test plan

Comparator unit suites (pins 1–3,7,8) extending the existing jsonShapeComparator test
family; waiver-store tests + seed migration test (pin 4); WSDL/envelope golden tests
(pins 5–6) with the Spring-WS fixture set already used by discovery; diffRunner integration
with `comparison_profile` threading; finding-emission rule updates. AMS changeset tests for
new columns/tables (NEW changesets only). Baseline discipline as per program.

## Dependencies & sizing

Depends on: nothing in G/H/I (I consumes it transparently). Shares waiver storage with I
(I's interim model is this table's v1). Size: **L** (SOAP is the bulk). For 100%-SOAP
estates this spec is a prerequisite for meaningful parity — build alongside/before I.
