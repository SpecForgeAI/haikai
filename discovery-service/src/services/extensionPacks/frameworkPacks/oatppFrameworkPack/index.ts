/**
 * Oatpp Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 10)
 *
 * Stage 2 producer for C++ + Oatpp REST-server codebases. Consumes the
 * IR map emitted by `cppLangPack` (the V3 Stage 1 producer) AND the
 * raw-source side channel maintained by `cppLangPack`'s
 * `setCppRawSources` cache, then delegates to the existing
 * deterministic `runOatppAdapter` to emit `DiscoveryCandidate[]` tagged
 * with `_addedBy: 'oatpp-adapter'`.
 *
 * Why the side-channel raw-source cache:
 *
 *   Oatpp uses heavy macro-based code generation. A typical controller
 *   reads:
 *
 *     class UserController : public oatpp::web::server::api::ApiController {
 *     public:
 *       ENDPOINT("GET", "/users/{id}", getUser, PATH(Int32, id)) { ... }
 *       ENDPOINT("POST", "/users", createUser) { ... }
 *     };
 *
 *   Tree-sitter-cpp cannot parse the `ENDPOINT(...)` macro body — the
 *   nested `PATH(Int32, id)` arguments confuse its grammar and the
 *   parser bails on the entire enclosing `class_specifier` node,
 *   emitting it as an `ERROR` node with no extractable members. As a
 *   result the IR map for an Oatpp file has zero `classes` and zero
 *   `functions`. The V2 adapter (`runOatppAdapter`) therefore takes a
 *   `rawSources: Map<string, string>` argument and runs two regex
 *   passes:
 *
 *     1. `class\s+(\w+)\s*:\s*public\s+[\w:]*ApiController` to find
 *        controller class names.
 *     2. `ENDPOINT\s*\(\s*"([A-Z]+)"\s*,\s*"([^"]+)"\s*,\s*(\w+)`
 *        to extract endpoint signatures.
 *
 *   The V3 `FrameworkPack.adapt(irFiles, runId, techHints)` contract
 *   does not pass raw source by design — IR is meant to be sufficient
 *   for every pack. Oatpp is the one outlier. Rather than mutate the
 *   contract for one pack, we route raw source through the
 *   `cppLangPack.rawSourceCache` module-level cache; see
 *   `languagePacks/cppLangPack/rawSourceCache.ts` for the full
 *   rationale.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'C++'`
 * AND `technology: 'Oatpp'` — per-field AND semantics preserved by
 * `matchesPredicate`. wxWidgets C++ techHints do NOT match; they flow
 * to `wxwidgetsFrameworkPack`.
 *
 * What the adapter detects (preserved exactly from V2):
 *  - Classes inheriting from any namespace-qualified `ApiController`
 *    base (regex-detected from raw source) → emitted as `interface`
 *    candidates with `controllerType: 'OatppController'`.
 *  - `ENDPOINT("METHOD", "/url", handlerName, ...)` macro invocations
 *    inside any file that contains an `ApiController` subclass →
 *    emitted as `endpoint` candidates with `httpMethod`, `fullPath`,
 *    `methodName`, and `controllerClassName` data.
 *
 * What the adapter MISSES (covered by `prompts/frameworks/oatpp.md`):
 *  - DTO definition macros (`DTO_INIT` / `DTO_FIELD`) — these declare
 *    the request/response object schema invisibly to both tree-sitter
 *    and the regex.
 *  - Object-mapping macros (`OBJECT_MAPPER` registration).
 *  - Component provider registration via `OATPP_CREATE_COMPONENT` /
 *    `OATPP_COMPONENT` (Oatpp's DI container).
 *  - Connection-handler chains (`HttpConnectionHandler` /
 *    `WebSocketConnectionHandler` configuration).
 *  - Swagger/OpenAPI generation macros (`API_INFO_BUILDER`).
 *  - WebSocket endpoint handlers (registered separately from
 *    `ENDPOINT()`).
 *
 * The V2 baseline on the upstream `oatpp-crud` reference repo is 8
 * candidates (per `C:/tmp/pack-validation/summary.tsv` row 22 — small
 * because the demo CRUD app has only one ApiController with seven
 * endpoints + one interface emission); the per-pack 98% gate requires
 * V3 to emit ≥ 8 to pass (no drop allowed at this absolute scale).
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runOatppAdapter } from '../../frameworkAdapters/oatpp';
import { getCppRawSources } from '../../languagePacks/cppLangPack/rawSourceCache';

export const oatppFrameworkPack: FrameworkPack = {
  id: 'oatpp',
  when: { language: 'C++', technology: 'Oatpp' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array PLUS a raw-source map (see file
    // header for the regex-fallback rationale). The raw-source map comes
    // from the side-channel cache populated by `cppLangPack.extract`
    // immediately before this adapt call — same pipeline run, same
    // process, sequential invocation per `runHarness` / `pipelineInvoker`.
    const irArray = Array.from(irFiles.values());
    const rawSources = getCppRawSources();
    const candidates = runOatppAdapter(irArray, runId, rawSources);
    console.log(
      `[oatpp] Emitted ${candidates.length} candidates from ${irArray.length} IR files (raw-source map size=${rawSources.size}).`,
    );
    return candidates;
  },
};
