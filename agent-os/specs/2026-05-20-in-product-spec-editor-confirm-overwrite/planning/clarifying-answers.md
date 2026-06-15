# Clarifying Answers: In-Product Spec Editor + Confirm-Overwrite

User confirmed "all defaults" on 2026-05-20. Each recommended answer below is the confirmed decision and is binding for the spec-writer.

---

**Q1. Editor library choice.**
**Answer (confirmed):** CodeMirror 6 — modern, tree-shakeable, ~50KB gzipped for Markdown mode, idiomatic for "code editor in a panel" use cases, avoids Monaco's heavier bundle / worker-loader complexity. Not Monaco, not plain textarea.

---

**Q2. Save keyboard shortcut.**
**Answer (confirmed):** Cmd/Ctrl+S inside the editor triggers Save, with `preventDefault` so the browser's "Save Page" dialog does not appear. Matches every code editor users already know. Shortcut is in addition to the Save button, not a replacement.

---

**Q3. Discard confirmation.**
**Answer (confirmed):** Ask before discarding when dirty. Confirmation prompt: "You have unsaved changes. Discard them?" Symmetric with the Save flow; prevents accidental loss when the toggle is clicked by mistake. Not a silent revert.

---

**Q4. "Edited" chip placement.**
**Answer (confirmed):** Both the hierarchy node AND the drawer header. Node placement so users can scan which specs in the tree are manually touched without opening them; drawer placement so the audit context is visible while viewing/editing.

---

**Q5. Audit `editedBy` source.**
**Answer (confirmed):** Request header (`X-User-Id` or existing auth header), consistent with how other audit fields are populated across AMS endpoints. Clients do not send identity in the body.

---

**Q6. Confirm-overwrite ordering vs cost-preview in Generate-all.**
**Answer (confirmed):** Two-step. Cost-preview first; then, if any rows are manually-edited, show the per-row overwrite picker as a second step. Keeps the existing cost-preview affordance intact and treats "are you sure about clobbering edits" as a distinct decision from "are you sure about the cost". Not a single merged modal.

---

**Q7. Skip-manually-edited default in bulk modal.**
**Answer (confirmed):** Default = Skip (checkbox unchecked for manually-edited rows). Safer default, aligns with the spirit of the confirm-overwrite gate. Users who really want to regenerate can flip Overwrite-all.

---

**Q8. Re-score-after-save UX.**
**Answer (confirmed):** Auto-refresh. The save call already re-runs parser + scorer server-side, so the drawer and hierarchy node reflect the new grade/fields immediately without a manual reload click. No "Refresh grade" button.

---

**Q9. Save endpoint failure UX.**
**Answer (confirmed):** Keep the editor open with the user's text intact and surface an error toast. Do not close the drawer and do not discard in-flight edits on transient 500s.

---

**Q10. Diff styling.**
**Answer (confirmed):** Inline line-by-line (unified diff, additions/deletions interleaved). Fits the narrow drawer width better than side-by-side and is the standard for Markdown prose diffs (GitHub PR view default). Not side-by-side.
