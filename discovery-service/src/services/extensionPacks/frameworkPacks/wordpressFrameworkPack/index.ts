/**
 * WordPress Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 6)
 *
 * Stage 2 producer for PHP + WordPress codebases. Consumes the IR map
 * emitted by `phpLangPack` (the V3 Stage 1 producer) and delegates to
 * the existing deterministic `runWordpressAdapter` to emit
 * `DiscoveryCandidate[]` tagged with `_addedBy: 'wordpress-adapter'`.
 *
 * The V2 `runWordpressAdapter` signature takes a flat `SourceFileIR[]`
 * array plus `runId`. The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the flat
 * array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'PHP'` AND
 * `technology: 'WordPress'` — per-field AND semantics preserved by
 * `matchesPredicate`. Symfony techHints (`{ technology: 'Symfony' }`)
 * and Magento techHints (`{ technology: 'Magento' }`) do NOT match;
 * they flow to `symfonyFrameworkPack` / `magentoFrameworkPack`
 * respectively.
 *
 * Candidate tagging (`_addedBy: 'wordpress-adapter'`) is unchanged from
 * V2 — downstream consumers and per-pack baseline gates rely on this
 * tag shape.
 *
 * Detection surface (broadened 2026-04-25 to fix ISS-001 — see
 * `discovery-service/perf/KNOWN_ISSUES.md`):
 *   - endpoint: `register_rest_route('ns', '/path', ...)` calls.
 *   - physical_entity: `register_post_type` + `register_taxonomy` calls.
 *   - logical_entity: `register_setting('group', 'option', ...)` calls.
 *   - business_logic: `add_action` / `add_filter` hook registrations
 *     (the dominant WordPress wiring pattern).
 *   - ui_screen: `add_menu_page` family (`add_submenu_page`,
 *     `add_options_page`, `add_management_page`, etc.).
 *   - ui_component: `register_sidebar`, `register_widget`, plus classes
 *     extending `WP_Widget`, `WP_List_Table`, `WP_Screen`, or
 *     `WP_Customize_*`.
 *   - interface: classes extending `WP_REST_Controller` (matched by
 *     bare or namespace-qualified parent class names).
 *
 * The adapter consumes `SourceFileIR.allCalls` (populated by the PHP
 * language extractor) so it sees both file-level and function-internal
 * calls — WordPress core wires most of itself through top-level
 * `add_action` / `add_filter` calls outside any function definition.
 *
 * Still out of scope (left to the framework prompt / LLM follow-up):
 *   - Template files / theme partials / shortcodes.
 *   - Cron events via wp_schedule_event.
 *   - `do_action` / `apply_filters` invocation sites (only registrations).
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runWordpressAdapter } from '../../frameworkAdapters/wordpress';

export const wordpressFrameworkPack: FrameworkPack = {
  id: 'wordpress',
  when: { language: 'PHP', technology: 'WordPress' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runWordpressAdapter(irArray, runId);
    console.log(
      `[wordpress] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
