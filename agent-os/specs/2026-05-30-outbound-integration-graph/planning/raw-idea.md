# Raw Idea: Outbound Integration Graph for Discovery

**HAIKAI Phase-2 "oracle perfection" — Spec #5 of 6.**

To migrate a service as a black box, the specification oracle must know what the
service **CALLS OUT TO**: the migration target has to reproduce the same
downstream calls and published messages. Today discovery is **outbound-blind** —
it captures inbound endpoints and data entities, but the outbound side (HTTP
clients, messaging producers, secondary stores, files, email/SMS, third-party
SDKs) is structurally invisible.

## Root cause

The Java extractor **discards call-argument literals**. `toCallIR` in
`languageExtractors/java/extract.ts` hardcodes `args: []`, and `astUtils.ts`
captures only `argCount`. So the URL in `restTemplate.getForObject(...)` and the
topic in `kafkaTemplate.send(...)` never reach any resolver. The today-only
outbound detection (springClassic `processOutboundIntegrations`) is a
**regex over raw file text**, **literal-URL only** (non-literal URLs skipped),
emits an **orphan `endpoints` candidate with no edge** back to the caller, and
covers only `@FeignClient` / `RestTemplate` / `WebClient`. springBoot has **no**
`processOutboundIntegrations` at all.

## The fix (decision-complete; see requirements.md)

1. **Root-cause:** retain call-argument literals on `CallIR.args` (the field
   already exists, typed `string[]`, just never populated) so an outbound
   resolver can read targets the way Spec 1's DB resolver reads repository
   methods. SHARED with Spec #6 (SQL-text capture) — land it here FIRST.
2. **New outbound resolver** (analogous to `endpointDataEffectResolver`):
   detect outbound calls + resolve targets (HTTP clients, messaging producers,
   caches/secondary stores, files/S3/FTP, email/SMS, third-party SDKs). Reuse
   Spec 1's endpoint→service call-graph walk to attribute each outbound edge to
   the calling endpoint/service.
3. **Meta-model edge = `data_movements`** (REUSE the existing relationship type —
   no new type). Emit a `data_movements` candidate from the calling
   endpoint/service's `application_point` to the dependency. NEVER create
   `application_points`/`data_entity_points` directly (auto-managed). ADD the
   missing `data_movements` producer to `candidateSaveBackService.ts`.
4. **External vs modellable:** in-model target → `data_movements` connects to it;
   purely external target (bare URL/topic/store) → rich **Finding** (verbatim
   target + payload hint), NOT an invented external architecture entity.
   Message-payload shapes → Findings (defer, like Spec 4).
5. **Deterministic core** (literals are statically present); LLM is the existing
   fallback only.
6. **Scope:** Java/Spring-Classic + Spring-Boot (add the missing springBoot
   outbound detection). No new AMS table — `data_movements` already persists.

All decisions FINAL and pre-approved. Autonomous build, no questions.
