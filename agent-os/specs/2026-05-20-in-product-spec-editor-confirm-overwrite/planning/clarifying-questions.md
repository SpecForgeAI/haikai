# Clarifying Questions: In-Product Spec Editor + Confirm-Overwrite

These are the genuinely open product questions remaining after the 10 working assumptions were locked. For each I've stated my recommended default — just say "all defaults" if you agree.

1. **Editor library choice.** I recommend **CodeMirror 6** — modern, tree-shakeable, ~50KB gzipped for Markdown mode, already idiomatic for "code editor in a panel" use cases, and avoids Monaco's heavier bundle / worker-loader complexity. Custom textarea would be lighter still but lose syntax highlighting and gutter affordances. Go with CodeMirror 6, or prefer Monaco / plain textarea?

2. **Save keyboard shortcut.** I recommend **Cmd/Ctrl+S inside the editor triggers Save** (with `preventDefault` so the browser's "Save Page" dialog doesn't appear), matching every code editor users already know. Add the shortcut, or button-only?

3. **Discard confirmation.** I recommend **ask before discarding when dirty** ("You have unsaved changes. Discard them?") — symmetric with the Save flow and prevents accidental loss when the toggle is clicked by mistake. Confirm-on-discard, or silent revert?

4. **"Edited" chip placement.** I recommend **both the hierarchy node AND the drawer header** — node placement so users can scan which specs in the tree are manually touched without opening them, drawer placement so the audit context is visible while viewing/editing. Both, or drawer-only / node-only?

5. **Audit `editedBy` source.** I recommend **request header** (`X-User-Id` or existing auth header), consistent with how other audit fields are populated across AMS endpoints and avoids clients having to send identity in the body. Header, or body field on the manual-edit payload?

6. **Confirm-overwrite ordering vs cost-preview in Generate-all.** Today Generate-all shows a cost-preview modal before firing. I recommend **cost-preview first, then if any rows are manually-edited show the per-row overwrite picker as a second step** — keeps the existing affordance intact and treats "are you sure about clobbering edits" as a distinct decision from "are you sure about the cost". Two-step, or merge into a single combined modal?

7. **Skip-manually-edited default in bulk modal.** I recommend **default = Skip (checkbox unchecked for manually-edited rows)** — safer default, aligns with the spirit of the confirm-overwrite gate; users who really want to regenerate can flip Overwrite-all. Default-skip, or default-overwrite?

8. **Re-score-after-save UX.** I recommend **auto-refresh** — the save call already re-runs parser + scorer server-side, so the drawer and hierarchy node should reflect the new grade/fields immediately without a manual reload click. Auto-refresh, or show a "Refresh grade" button?

9. **Save endpoint failure UX.** I recommend **keep the editor open with the user's text intact and surface an error toast** — losing in-flight edits because of a transient 500 would be the worst-possible failure mode. Keep editor state, or close drawer and show error?

10. **Diff styling.** I recommend **inline line-by-line** (unified diff, additions/deletions interleaved) — fits the narrow drawer width better than side-by-side and is the standard for Markdown prose diffs (GitHub PR view default). Inline unified, or side-by-side?
