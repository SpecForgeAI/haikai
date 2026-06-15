/**
 * wxWidgets Framework Pack (V3 `FrameworkPack`).
 *
 * Spec: V3 Pack Migration Batch (Task Group 10)
 *
 * Stage 2 producer for C++ + wxWidgets desktop UI codebases. Consumes
 * the IR map emitted by `cppLangPack` (the V3 Stage 1 producer) and
 * delegates to the existing deterministic `runWxwidgetsAdapter` to
 * emit `DiscoveryCandidate[]` tagged with `_addedBy: 'wxwidgets-adapter'`.
 *
 * The V2 adapter signature takes a flat `SourceFileIR[]` plus `runId`.
 * The V3 `FrameworkPack.adapt` contract passes
 * `Map<string, SourceFileIR>`; we convert the map's values into the
 * flat array here so no adapter-logic change is needed.
 *
 * Applicability predicate (`when`) requires BOTH `language: 'C++'`
 * AND `technology: 'wxWidgets'` — per-field AND semantics preserved by
 * `matchesPredicate`. Oatpp C++ techHints do NOT match; they flow to
 * `oatppFrameworkPack`.
 *
 * What the adapter detects (preserved exactly from V2):
 *  - Classes inheriting from `wxFrame` / `wxDialog` / `wxWindow` /
 *    `wxTopLevelWindow` → emitted as `ui_screen` candidates.
 *  - Classes inheriting from `wxPanel` / `wxButton` / `wxControl` /
 *    `wxChoice` / `wxComboBox` / `wxListCtrl` / `wxTreeCtrl` /
 *    `wxTextCtrl` / `wxStaticText` / `wxCheckBox` / `wxRadioButton` /
 *    `wxSpinCtrl` / `wxNotebook` / `wxSizer` / `wxBoxSizer` /
 *    `wxGridSizer` / `wxFlexGridSizer` → emitted as `ui_component`
 *    candidates with `component_type: 'other'`.
 *
 * What the adapter MISSES (covered by `prompts/frameworks/wxwidgets.md`):
 *  - Event-table macros (`BEGIN_EVENT_TABLE` / `EVT_BUTTON` /
 *    `EVT_MENU` / `EVT_CHECKBOX`) — these wire UI events to handler
 *    methods but live inside macro bodies tree-sitter cannot traverse.
 *  - XRC `.xrc` XML resource files — declarative UI trees authored
 *    outside `.cpp` source entirely.
 *  - Sizer layout intent (which child belongs to which `wxBoxSizer` /
 *    `wxGridSizer` parent).
 *  - Custom event class declarations via `DECLARE_EVENT_TYPE` /
 *    `DEFINE_EVENT_TYPE` macros.
 *  - `wxConfig` persistence read/write call graphs.
 *  - i18n via `_()` / `wxGetTranslation()` macros (these tag user-
 *    visible strings as candidates for translation, useful for
 *    surfacing user-facing text inventories).
 *
 * The V2 baseline on the upstream `wxwidgets` reference repo is 258
 * candidates (per `C:/tmp/pack-validation/summary.tsv` row 19); the
 * per-pack 98% gate requires V3 to emit ≥ 253 to pass.
 */

import type { FrameworkPack, TechHints } from '../../packTypes';
import type { SourceFileIR } from '../../languageIR';
import type { DiscoveryCandidate } from '../../../../types/candidate';
import { runWxwidgetsAdapter } from '../../frameworkAdapters/wxwidgets';

export const wxwidgetsFrameworkPack: FrameworkPack = {
  id: 'wxwidgets',
  when: { language: 'C++', technology: 'wxWidgets' },

  adapt(
    irFiles: Map<string, SourceFileIR>,
    runId: string,
    _techHints: TechHints,
  ): DiscoveryCandidate[] {
    // V2 adapter takes a flat IR array; convert the Map values to preserve
    // the existing adapter shape without changing any adapter logic.
    const irArray = Array.from(irFiles.values());
    const candidates = runWxwidgetsAdapter(irArray, runId);
    console.log(
      `[wxwidgets] Emitted ${candidates.length} candidates from ${irArray.length} IR files.`,
    );
    return candidates;
  },
};
