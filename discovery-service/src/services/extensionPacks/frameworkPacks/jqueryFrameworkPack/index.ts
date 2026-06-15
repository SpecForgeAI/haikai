/**
 * jQuery Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 9)
 *
 * Stage 2 producer for jQuery codebases. Consumes the IR map emitted
 * by `javascriptLangPack` (the V3 Stage 1 producer) and delegates to
 * the existing deterministic `runJqueryAdapter` to emit
 * `DiscoveryCandidate[]` tagged with `_addedBy: 'jquery-adapter'`.
 *
 * The V2 adapter signature takes a flat `SourceFileIR[]` plus `runId`.
 * The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the
 * flat array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'JavaScript'`
 * AND `technology: 'jQuery'` — per-field AND semantics preserved by
 * `matchesPredicate`. React (JS) techHints do NOT match; they flow to
 * `reactJavascriptFrameworkPack`.
 *
 * Note on `javascript-es5` IR tag: the V2 `jqueryPackV2` used a thin
 * `extractJavaScriptES5IR` wrapper that re-tagged IR's `language`
 * field as `'javascript-es5'`. The jQuery adapter does NOT inspect
 * the `language` field — it keys off call-expression callee shapes
 * (`$.ajax`, `$.get`, `$.widget`, etc.) — so the single shared
 * `javascriptLangPack` (producing `language: 'javascript'` IR) is
 * functionally equivalent. Same pattern as `csharpLangPack` covering
 * both asp-net-core and asp-net-framework, and `phpLangPack` covering
 * both modern PHP and `php-legacy`.
 *
 * Known severe under-emission on real-world repos (see the
 * migrate-first + TODOs section in `evaluation/FIXTURES-TODO.md`):
 *  - V2 baseline on `jquery-ui` is 0 candidates across the entire
 *    repo. The deterministic adapter is looking for very specific
 *    call-expression shapes (`$.ajax({...})` with literal options
 *    object, `$.widget('namespace.name', ...)` with literal-string
 *    first argument, `$.get/post/put/delete` with literal-string URL)
 *    that simply do not occur in jquery-ui's source — jquery-ui
 *    defines widgets via the prototype-based `$.widget.bridge` /
 *    `$.fn.<name>` pattern with an externally-passed prototype
 *    object, not via the `$.widget('ui.<name>', { ... })` literal
 *    pattern the adapter checks for. Structural migration to V3
 *    preserves the V2 behaviour exactly — fixing the detection logic
 *    is Spec-4 follow-up work. The prompt layer
 *    (`prompts/frameworks/jquery.md`) enumerates the missed patterns
 *    so the LLM gap-fill stage can compensate.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runJqueryAdapter } from '../../frameworkAdapters/jquery';

export const jqueryFrameworkPack: FrameworkPack = {
  id: 'jquery',
  when: { language: 'JavaScript', technology: 'jQuery' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runJqueryAdapter(irArray, runId);
    console.log(
      `[jquery] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
